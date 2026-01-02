import { NextRequest, NextResponse } from 'next/server';
import { createEventFetchingClient, createArchiveClient, fetchDelegationEvents, getCurrentBlockNumber, getTokenCreationBlock } from '@/lib/blockchain';
import {
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
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Address } from 'viem';
import type { TimelineEntry, DelegationEvent, MetadataSchema, CurrentStateSchema } from '@/lib/types';

function getConfig() {
  try {
    const configPath = join(process.cwd(), 'config.json');
    return JSON.parse(readFileSync(configPath, 'utf-8')) as {
      delegateAddress: string;
      tokenAddress: string;
      chainId: number;
    };
  } catch (error) {
    console.error('Error reading config.json:', error);
    throw new Error('Failed to read config.json. Please ensure it exists and is valid JSON.');
  }
}

export const maxDuration = 300; // 5 minutes for Vercel

async function processEvents(
  events: DelegationEvent[],
  delegateAddress: Address,
  initialDelegators: Record<string, bigint> = {}
): Promise<{ timeline: TimelineEntry[]; currentDelegators: Record<string, string> }> {
  const delegators: Record<string, bigint> = { ...initialDelegators };
  const timeline: TimelineEntry[] = [];

  for (const event of events) {
    const delegateAddrLower = delegateAddress.toLowerCase();
    const fromLower = event.from.toLowerCase();
    const toLower = event.to.toLowerCase();

    if (event.eventType === 'DELEGATE_CHANGED') {
      // Handle delegation relationship changes
      if (toLower === delegateAddrLower) {
        if (event.newBalance > 0n) {
          delegators[fromLower] = event.newBalance;
        } else {
          delete delegators[fromLower];
        }
      } else if (fromLower === delegateAddrLower) {
        for (const [addr, balance] of Object.entries(delegators)) {
          if (balance === event.previousBalance) {
            delete delegators[addr];
            break;
          }
        }
      } else {
        if (delegators[fromLower] !== undefined) {
          delete delegators[fromLower];
        }
      }
    } else if (event.eventType === 'BALANCE_CHANGED') {
      // Handle balance changes without delegation changes
      const delegatorAddr = event.delegator!.toLowerCase();

      if (delegators[delegatorAddr] !== undefined) {
        const oldBalance = delegators[delegatorAddr];
        const newBalance = event.newBalance;

        if (newBalance > 0n) {
          delegators[delegatorAddr] = newBalance;
        } else {
          delete delegators[delegatorAddr];
        }

        // Only create timeline entry if balance actually changed
        if (oldBalance === newBalance) {
          continue;
        }
      } else {
        continue;
      }
    }

    // Calculate total voting power
    const totalVotingPower = Object.values(delegators).reduce(
      (sum, balance) => sum + balance,
      0n
    );

    // Create timeline entry
    timeline.push({
      timestamp: event.timestamp,
      blockNumber: event.blockNumber,
      totalVotingPower: totalVotingPower.toString(),
      delegators: Object.fromEntries(
        Object.entries(delegators).map(([addr, balance]) => [addr, balance.toString()])
      ),
    });
  }

  // Convert current delegators to strings
  const currentDelegators: Record<string, string> = Object.fromEntries(
    Object.entries(delegators).map(([addr, balance]) => [addr, balance.toString()])
  );

  return { timeline, currentDelegators };
}

export async function POST(request: NextRequest) {
  // Validate sync token
  const token = request.headers.get('X-Sync-Token');
  const syncSecret = process.env.SYNC_SECRET || 'default-secret';

  if (token !== syncSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acquire sync lock
  const lockAcquired = await acquireSyncLock();
  if (!lockAcquired) {
    return NextResponse.json({
      message: 'Sync already in progress'
    });
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

    // Full sync from 250M to current block
    const START_BLOCK = 250000000;
    const fromBlock = metadata
      ? BigInt(metadata.lastSyncedBlock + 1)
      : BigInt(START_BLOCK);
    const toBlock = BigInt(await getCurrentBlockNumber(eventClient));

    if (fromBlock > toBlock) {
      await releaseSyncLock();
      return NextResponse.json({
        message: 'Already up to date',
        lastSyncedBlock: Number(toBlock),
      });
    }

    // Fetch events in chunks to avoid rate limits
    const chunkSize = 10000n; // Free RPCs support large block ranges
    let allEvents: DelegationEvent[] = [];
    let currentFrom = fromBlock;
    let totalEventsProcessed = 0;

    const totalBlocks = Number(toBlock - fromBlock);
    const syncStartTime = Date.now();

    // Track delegators across chunks for balance change tracking
    let delegatorsForTracking: string[] = [];

    // Initialize from existing state if available
    if (currentState) {
      delegatorsForTracking = Object.keys(currentState.delegators);
    }

    while (currentFrom <= toBlock) {
      const currentTo = currentFrom + chunkSize > toBlock ? toBlock : currentFrom + chunkSize;

      console.log(`[Background Sync] Fetching events from block ${currentFrom} to ${currentTo}`);
      const events = await fetchDelegationEvents(
        eventClient,
        archiveClient,
        tokenAddress,
        delegateAddress,
        currentFrom,
        currentTo,
        delegatorsForTracking
      );

      // Update delegators list for next chunk
      // Extract new delegators from delegation events
      for (const event of events) {
        if (event.eventType === 'DELEGATE_CHANGED') {
          const delegator = event.from.toLowerCase();
          if (event.to.toLowerCase() === delegateAddress.toLowerCase()) {
            // New delegation
            if (!delegatorsForTracking.includes(delegator)) {
              delegatorsForTracking.push(delegator);
            }
          } else if (event.from.toLowerCase() === delegateAddress.toLowerCase()) {
            // Undelegation
            delegatorsForTracking = delegatorsForTracking.filter(addr => addr !== delegator);
          }
        }
      }

      allEvents.push(...events);
      totalEventsProcessed += events.length;

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

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    console.log(`[Background Sync] Fetched ${allEvents.length} delegation events`);

    // If we have existing data, start with the last known state
    let initialDelegators: Record<string, bigint> = {};

    if (currentState) {
      for (const [addr, balance] of Object.entries(currentState.delegators)) {
        initialDelegators[addr.toLowerCase()] = BigInt(balance);
      }
    }

    // Process events
    const { timeline: newTimelineEntries, currentDelegators } = await processEvents(
      allEvents,
      delegateAddress,
      initialDelegators
    );

    // Calculate total voting power
    let totalVotingPower = BigInt(0);
    for (const balance of Object.values(currentDelegators)) {
      totalVotingPower += BigInt(balance);
    }

    // Store updated data
    const newMetadata: MetadataSchema = {
      lastSyncedBlock: Number(toBlock),
      lastSyncTimestamp: Date.now(),
      totalVotingPower: totalVotingPower.toString(),
      totalDelegators: Object.keys(currentDelegators).length,
      totalTimelineEntries: (metadata?.totalTimelineEntries || 0) + newTimelineEntries.length,
      timelinePartitions: Math.ceil(((metadata?.totalTimelineEntries || 0) + newTimelineEntries.length) / 1000)
    };

    const newCurrentState: CurrentStateSchema = {
      asOfBlock: Number(toBlock),
      asOfTimestamp: Date.now(),
      delegators: currentDelegators
    };

    await storeMetadata(newMetadata);
    await storeCurrentState(newCurrentState);

    if (newTimelineEntries.length > 0) {
      await appendTimelineEntries(newTimelineEntries);
    }

    clearCache();
    await clearSyncProgress();
    await releaseSyncLock();

    console.log(`[Background Sync] Sync completed successfully`);

    return NextResponse.json({
      message: 'Background sync completed',
      eventsProcessed: allEvents.length,
      lastSyncedBlock: Number(toBlock),
      timelineEntries: newMetadata.totalTimelineEntries,
      currentDelegators: Object.keys(currentDelegators).length,
    });
  } catch (error: any) {
    console.error('[Background Sync] Error:', error);
    await clearSyncProgress();
    await releaseSyncLock();
    return NextResponse.json(
      { error: error.message || 'Failed to sync data' },
      { status: 500 }
    );
  }
}
