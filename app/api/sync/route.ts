import { NextRequest, NextResponse } from 'next/server';
import { createEventFetchingClient, createArchiveClient, fetchDelegationEvents, fetchTransferEvents, getCurrentBlockNumber, getTokenCreationBlock } from '@/lib/blockchain';
import {
  getVotingPowerData,
  acquireSyncLock,
  releaseSyncLock,
  getMetadata,
  getCurrentState,
  storeMetadata,
  storeCurrentState,
  appendTimelineEntries,
  clearCache,
  updateSyncProgress,
  clearSyncProgress
} from '@/lib/storage';
import { getConfig, resolveEndBlock } from '@/lib/config';
import type { Address } from 'viem';
import type { VotingPowerData, TimelineEntry, DelegationEvent, MetadataSchema, CurrentStateSchema } from '@/lib/types';

export const maxDuration = 300; // 5 minutes for Vercel

async function processEvents(
  events: DelegationEvent[],
  delegateAddress: Address,
  initialDelegators: Record<string, bigint> = {}
): Promise<{ timeline: TimelineEntry[]; currentDelegators: Record<string, string> }> {
  const delegators: Record<string, bigint> = { ...initialDelegators };
  const timeline: TimelineEntry[] = [];

  // Group events by block number to merge events in the same block
  const eventsByBlock = new Map<number, DelegationEvent[]>();
  for (const event of events) {
    const blockEvents = eventsByBlock.get(event.blockNumber) || [];
    blockEvents.push(event);
    eventsByBlock.set(event.blockNumber, blockEvents);
  }

  // Process each block's events and create one timeline entry per block
  const sortedBlocks = Array.from(eventsByBlock.keys()).sort((a, b) => a - b);

  for (const blockNumber of sortedBlocks) {
    const blockEvents = eventsByBlock.get(blockNumber)!;
    let stateChanged = false;

    // Process all events in this block
    for (const event of blockEvents) {
      const delegateAddrLower = delegateAddress.toLowerCase();
      const fromLower = event.from.toLowerCase();
      const toLower = event.to.toLowerCase();

      if (event.eventType === 'DELEGATE_CHANGED') {
        // Handle delegation relationship changes
        if (toLower === delegateAddrLower) {
          // Someone is delegating TO our delegate
          // Keep them even if balance is 0 (they're still delegating)
          delegators[fromLower] = event.newBalance;
          stateChanged = true;
        } else if (fromLower === delegateAddrLower) {
          // Someone is delegating FROM our delegate to someone else
          for (const [addr, balance] of Object.entries(delegators)) {
            if (balance === event.previousBalance) {
              delete delegators[addr];
              stateChanged = true;
              break;
            }
          }
        } else {
          // Delegator changing their delegation away from us
          if (delegators[fromLower] !== undefined) {
            delete delegators[fromLower];
            stateChanged = true;
          }
        }
      } else if (event.eventType === 'BALANCE_CHANGED') {
        // Handle balance changes without delegation changes
        const delegatorAddr = event.delegator!.toLowerCase();

        if (delegators[delegatorAddr] !== undefined) {
          const oldBalance = delegators[delegatorAddr];
          const newBalance = event.newBalance;

          // Keep delegator even if balance goes to 0 (they're still delegating to us)
          delegators[delegatorAddr] = newBalance;

          // Mark state as changed if balance actually changed
          if (oldBalance !== newBalance) {
            stateChanged = true;
          }
        }
      }
    }

    // Create one timeline entry for this block if state changed
    if (stateChanged) {
      const totalVotingPower = Object.values(delegators).reduce(
        (sum, balance) => sum + balance,
        0n
      );

      timeline.push({
        timestamp: blockEvents[0].timestamp, // All events in same block have same timestamp
        blockNumber: blockNumber,
        totalVotingPower: totalVotingPower.toString(),
        delegators: Object.fromEntries(
          Object.entries(delegators).map(([addr, balance]) => [addr, balance.toString()])
        ),
      });
    }
  }

  // Convert current delegators to strings
  const currentDelegators: Record<string, string> = Object.fromEntries(
    Object.entries(delegators).map(([addr, balance]) => [addr, balance.toString()])
  );

  return { timeline, currentDelegators };
}

export async function POST(request: NextRequest) {
  // Acquire sync lock
  const lockAcquired = await acquireSyncLock();
  if (!lockAcquired) {
    return NextResponse.json(
      { error: 'Sync already in progress' },
      { status: 409 }
    );
  }

  try {
    const config = getConfig();
    const eventClient = createEventFetchingClient(); // Free RPC for event fetching
    const archiveClient = createArchiveClient(); // DRPC for historical balance queries
    const delegateAddress = config.delegateAddress as Address;
    const tokenAddress = config.tokenAddress as Address;

    // Get existing data to determine sync range
    const metadata = await getMetadata();
    const currentState = await getCurrentState();

    // Full sync from configured startBlock to endBlock (or current block if "latest")
    const startBlock = BigInt(config.startBlock);
    const maxBlock = await resolveEndBlock(eventClient);
    const fromBlock = metadata
      ? BigInt(metadata.lastSyncedBlock + 1)
      : startBlock;
    const currentBlock = BigInt(await getCurrentBlockNumber(eventClient));
    const toBlock = currentBlock > maxBlock ? maxBlock : currentBlock;

    if (fromBlock > toBlock) {
      await releaseSyncLock();
      return NextResponse.json({
        message: 'Already up to date',
        lastSyncedBlock: Number(toBlock),
      });
    }

    // Fetch and save events incrementally every 1M blocks
    const chunkSize = 10000n; // Process 10k blocks at a time (free RPCs support large ranges)
    const saveInterval = 1000000n; // Save data every 1M blocks

    let currentFrom = fromBlock;
    let lastSaveBlock = fromBlock;
    let accumulatedEvents: DelegationEvent[] = [];
    let totalEventsProcessed = 0;

    const totalBlocks = Number(toBlock - fromBlock);
    const syncStartTime = Date.now();

    // Initialize delegators state from existing data
    let delegatorsState: Record<string, bigint> = {};
    if (currentState) {
      for (const [addr, balance] of Object.entries(currentState.delegators)) {
        delegatorsState[addr.toLowerCase()] = BigInt(balance);
      }
    }

    let totalTimelineEntries = metadata?.totalTimelineEntries || 0;

    // Save initial state for timeline processing
    let checkpointStartState: Record<string, bigint> = { ...delegatorsState };

    while (currentFrom <= toBlock) {
      const currentTo = currentFrom + chunkSize > toBlock ? toBlock : currentFrom + chunkSize;

      console.log(`Fetching events from block ${currentFrom} to ${currentTo}`);

      // Extract current delegator addresses for balance change tracking
      const currentDelegatorAddrs = Object.keys(delegatorsState);

      // Fetch delegation events (DelegateChanged + DelegateVotesChanged)
      const delegationEvents = await fetchDelegationEvents(
        eventClient,
        archiveClient,
        tokenAddress,
        delegateAddress,
        currentFrom,
        currentTo,
        currentDelegatorAddrs
      );

      // Fetch Transfer events for current delegators to track all balance changes
      const transferEvents = await fetchTransferEvents(
        eventClient,
        archiveClient,
        tokenAddress,
        delegateAddress,
        currentDelegatorAddrs,
        currentFrom,
        currentTo
      );

      // Merge and deduplicate events (delegation events take priority)
      const events = [...delegationEvents, ...transferEvents].sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        return a.timestamp - b.timestamp;
      });

      accumulatedEvents.push(...events);

      // Update delegatorsState after each chunk to track who is currently delegating
      // This ensures we stop fetching Transfer events for addresses that undelegate
      // We only update the delegator list here, NOT create timeline entries
      if (events.length > 0) {
        for (const event of events) {
          const delegateAddrLower = delegateAddress.toLowerCase();
          const fromLower = event.from.toLowerCase();
          const toLower = event.to.toLowerCase();

          if (event.eventType === 'DELEGATE_CHANGED') {
            if (toLower === delegateAddrLower) {
              delegatorsState[fromLower] = event.newBalance;
            } else if (delegatorsState[fromLower] !== undefined) {
              delete delegatorsState[fromLower];
            }
          } else if (event.eventType === 'BALANCE_CHANGED') {
            const delegatorAddr = event.delegator!.toLowerCase();
            if (delegatorsState[delegatorAddr] !== undefined) {
              delegatorsState[delegatorAddr] = event.newBalance;
            }
          }
        }
      }

      // Check if we should save (every 1M blocks or at the end)
      const shouldSave = (currentTo - lastSaveBlock >= saveInterval) || currentTo >= toBlock;

      if (shouldSave) {
        console.log(`[Checkpoint] Reached at block ${currentTo}, processing ${accumulatedEvents.length} accumulated events...`);

        // Process accumulated events (even if empty, to maintain state)
        let newTimelineEntries: TimelineEntry[] = [];
        let currentDelegators: Record<string, string> = {};

        if (accumulatedEvents.length > 0) {
          const result = await processEvents(
            accumulatedEvents,
            delegateAddress,
            checkpointStartState  // Use state from START of checkpoint interval
          );
          newTimelineEntries = result.timeline;
          currentDelegators = result.currentDelegators;

          // Update delegators state
          delegatorsState = {};
          for (const [addr, balance] of Object.entries(currentDelegators)) {
            delegatorsState[addr] = BigInt(balance);
          }
        } else {
          // No events, use current state
          currentDelegators = Object.fromEntries(
            Object.entries(delegatorsState).map(([addr, balance]) => [addr, balance.toString()])
          );
        }

        // Calculate total voting power
        let totalVotingPower = BigInt(0);
        for (const balance of Object.values(currentDelegators)) {
          totalVotingPower += BigInt(balance);
        }

        totalTimelineEntries += newTimelineEntries.length;

        // Store updated data
        const newMetadata: MetadataSchema = {
          lastSyncedBlock: Number(currentTo),
          lastSyncTimestamp: Date.now(),
          totalVotingPower: totalVotingPower.toString(),
          totalDelegators: Object.keys(currentDelegators).length,
          totalTimelineEntries,
          timelinePartitions: Math.ceil(totalTimelineEntries / 1000),
          delegateAddress: delegateAddress.toLowerCase()
        };

        const newCurrentState: CurrentStateSchema = {
          asOfBlock: Number(currentTo),
          asOfTimestamp: Date.now(),
          delegators: currentDelegators
        };

        await storeMetadata(newMetadata);
        await storeCurrentState(newCurrentState);

        if (newTimelineEntries.length > 0) {
          await appendTimelineEntries(newTimelineEntries);
        }

        // Update total events counter BEFORE clearing accumulated events
        totalEventsProcessed += accumulatedEvents.length;

        // Clear cache and reset for next batch
        clearCache();
        accumulatedEvents = [];
        lastSaveBlock = currentTo;

        // Reset checkpoint start state for next interval
        checkpointStartState = { ...delegatorsState };

        console.log(`[Checkpoint] Saved at block ${currentTo}:`);
        console.log(`  - Events processed: ${totalEventsProcessed}`);
        console.log(`  - Timeline entries: ${newTimelineEntries.length}`);
        console.log(`  - Total delegators: ${Object.keys(currentDelegators).length}`);
        console.log(`  - Total voting power: ${(Number(totalVotingPower) / 1e18).toFixed(2)} ARB`);
      }

      // Update progress
      const blocksProcessed = Number(currentFrom - fromBlock);
      const percentComplete = Math.min((blocksProcessed / totalBlocks) * 100, 100);
      const elapsed = Date.now() - syncStartTime;
      const estimatedTotal = elapsed / (percentComplete / 100);
      const estimatedTimeRemaining = estimatedTotal - elapsed;

      await updateSyncProgress({
        isActive: true,
        currentBlock: Number(currentFrom),
        targetBlock: Number(toBlock),
        startBlock: Number(fromBlock),
        eventsProcessed: totalEventsProcessed,
        percentComplete,
        estimatedTimeRemaining,
        startedAt: syncStartTime
      });

      currentFrom = currentTo + 1n;

      // Delay to avoid rate limits (increased to reduce 429 errors)
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`Sync completed: ${totalEventsProcessed} total events processed`);

    // Clear progress and release lock
    await clearSyncProgress();
    await releaseSyncLock();

    // Get final metadata for response
    const finalMetadata = await getMetadata();
    const finalState = await getCurrentState();

    return NextResponse.json({
      message: 'Sync completed',
      eventsProcessed: totalEventsProcessed,
      lastSyncedBlock: Number(toBlock),
      timelineEntries: finalMetadata?.totalTimelineEntries || 0,
      currentDelegators: finalState ? Object.keys(finalState.delegators).length : 0,
    });
  } catch (error: any) {
    console.error('Sync error:', error);
    // Clear progress and release lock on error
    await clearSyncProgress();
    await releaseSyncLock();
    return NextResponse.json(
      { error: error.message || 'Failed to sync data' },
      { status: 500 }
    );
  }
}

