import { NextRequest, NextResponse } from 'next/server';
import { createArbitrumClient, fetchDelegationEvents, getCurrentBlockNumber, getTokenCreationBlock } from '@/lib/blockchain';
import { storeVotingPowerData, getVotingPowerData } from '@/lib/storage';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Address } from 'viem';
import type { VotingPowerData, TimelineEntry, DelegationEvent } from '@/lib/types';

const configPath = join(process.cwd(), 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  delegateAddress: string;
  tokenAddress: string;
  chainId: number;
};

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

    // Update delegator balances based on delegation changes
    if (toLower === delegateAddrLower) {
      // Someone is delegating TO our delegate
      // The 'from' address is the delegator, 'newBalance' is what they're delegating to us
      if (event.newBalance > 0n) {
        delegators[fromLower] = event.newBalance;
      } else {
        // If newBalance is 0, they're undelegating
        delete delegators[fromLower];
      }
    } else if (fromLower === delegateAddrLower) {
      // This shouldn't happen for our use case, but handle it anyway
      // Someone is delegating FROM our delegate to someone else
      // This means a delegator changed their delegation away from us
      // We need to find which delegator this was by checking previousBalance
      for (const [addr, balance] of Object.entries(delegators)) {
        if (balance === event.previousBalance) {
          delete delegators[addr];
          break;
        }
      }
    } else {
      // This event doesn't directly involve our delegate
      // But it might be a delegator changing their delegation amount
      // Check if this delegator was previously delegating to us
      if (delegators[fromLower] !== undefined) {
        // This delegator was delegating to us, now they're delegating to someone else
        delete delegators[fromLower];
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
  try {
    const client = createArbitrumClient();
    const delegateAddress = config.delegateAddress as Address;
    const tokenAddress = config.tokenAddress as Address;

    // Get existing data to determine sync range
    const existingData = await getVotingPowerData();
    const fromBlock = existingData
      ? BigInt(existingData.lastSyncedBlock + 1)
      : BigInt(await getTokenCreationBlock(client, tokenAddress));
    const toBlock = BigInt(await getCurrentBlockNumber(client));

    if (fromBlock > toBlock) {
      return NextResponse.json({
        message: 'Already up to date',
        lastSyncedBlock: Number(toBlock),
      });
    }

    // Fetch events in chunks to avoid rate limits
    const chunkSize = 10000n; // Process 10k blocks at a time
    let allEvents: DelegationEvent[] = [];
    let currentFrom = fromBlock;

    while (currentFrom <= toBlock) {
      const currentTo = currentFrom + chunkSize > toBlock ? toBlock : currentFrom + chunkSize;
      
      console.log(`Fetching events from block ${currentFrom} to ${currentTo}`);
      const events = await fetchDelegationEvents(
        client,
        tokenAddress,
        delegateAddress,
        currentFrom,
        currentTo
      );
      
      allEvents.push(...events);
      currentFrom = currentTo + 1n;

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`Fetched ${allEvents.length} delegation events`);

    // If we have existing data, we need to rebuild from scratch or merge carefully
    // For simplicity, if this is an incremental sync, we'll process all events together
    let eventsToProcess = allEvents;
    let initialDelegators: Record<string, bigint> = {};

    if (existingData && existingData.timeline.length > 0) {
      // For incremental sync, start with the last known state
      // Convert existing delegators to bigint for processing
      for (const [addr, balance] of Object.entries(existingData.currentDelegators)) {
        initialDelegators[addr.toLowerCase()] = BigInt(balance);
      }
    }

    // Process events (this will create new timeline entries)
    const { timeline: newTimelineEntries, currentDelegators } = await processEvents(
      eventsToProcess,
      delegateAddress,
      initialDelegators
    );

    // Merge with existing timeline if it exists
    let finalTimeline: TimelineEntry[] = newTimelineEntries;
    if (existingData && existingData.timeline.length > 0) {
      finalTimeline = [...existingData.timeline, ...newTimelineEntries];
      // Sort by block number
      finalTimeline.sort((a, b) => a.blockNumber - b.blockNumber);
    }

    // Store updated data
    const data: VotingPowerData = {
      lastSyncedBlock: Number(toBlock),
      timeline: finalTimeline,
      currentDelegators,
    };

    await storeVotingPowerData(data);

    return NextResponse.json({
      message: 'Sync completed',
      eventsProcessed: allEvents.length,
      lastSyncedBlock: Number(toBlock),
      timelineEntries: finalTimeline.length,
      currentDelegators: Object.keys(currentDelegators).length,
    });
  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync data' },
      { status: 500 }
    );
  }
}

