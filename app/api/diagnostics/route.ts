import { NextResponse } from 'next/server';
import { getMetadata, getCurrentState, getSyncProgress } from '@/lib/storage';
import { getCurrentBlockNumber, createEventFetchingClient } from '@/lib/blockchain';

export async function GET() {
  try {
    const [metadata, currentState, syncProgress] = await Promise.all([
      getMetadata(),
      getCurrentState(),
      getSyncProgress(),
    ]);

    const eventClient = createEventFetchingClient();
    const currentBlockchainBlock = await getCurrentBlockNumber(eventClient);

    const blocksBehind = metadata
      ? currentBlockchainBlock - metadata.lastSyncedBlock
      : null;

    const hoursSinceLastSync = metadata
      ? (Date.now() - metadata.lastSyncTimestamp) / (1000 * 60 * 60)
      : null;

    // Determine health status
    let health: 'healthy' | 'syncing' | 'stale' | 'unknown';
    if (syncProgress?.isActive) {
      health = 'syncing';
    } else if (!metadata) {
      health = 'unknown';
    } else if (blocksBehind && blocksBehind > 100000) {
      health = 'stale';
    } else {
      health = 'healthy';
    }

    // Format voting power in ARB
    const totalVotingPowerARB = metadata
      ? (Number(metadata.totalVotingPower) / 1e18).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '0.00';

    return NextResponse.json({
      sync: {
        lastSyncedBlock: metadata?.lastSyncedBlock || null,
        currentBlockchainBlock,
        blocksBehind,
        lastSyncTimestamp: metadata?.lastSyncTimestamp || null,
        hoursSinceLastSync: hoursSinceLastSync ? Number(hoursSinceLastSync.toFixed(2)) : null,
      },
      state: {
        totalDelegators: metadata?.totalDelegators || 0,
        totalVotingPower: metadata?.totalVotingPower || '0',
        totalVotingPowerARB,
        totalTimelineEntries: metadata?.totalTimelineEntries || 0,
        asOfBlock: currentState?.asOfBlock || null,
        asOfTimestamp: currentState?.asOfTimestamp || null,
      },
      syncProgress: syncProgress || null,
      health,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('Error fetching diagnostics:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch diagnostics' },
      { status: 500 }
    );
  }
}
