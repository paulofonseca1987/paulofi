import { NextRequest, NextResponse } from 'next/server';
import {
  getMetadata,
  getCurrentState,
  getFullTimeline,
  getTimelineRange
} from '@/lib/storage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const endpoint = searchParams.get('endpoint') || 'full';

    switch (endpoint) {
      case 'metadata': {
        const metadata = await getMetadata();
        return NextResponse.json(metadata || null);
      }

      case 'current': {
        const currentState = await getCurrentState();
        return NextResponse.json(currentState || null);
      }

      case 'timeline': {
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        if (from && to) {
          // Return timeline range
          const fromBlock = parseInt(from);
          const toBlock = parseInt(to);

          if (isNaN(fromBlock) || isNaN(toBlock)) {
            return NextResponse.json(
              { error: 'Invalid from or to block number' },
              { status: 400 }
            );
          }

          const timeline = await getTimelineRange(fromBlock, toBlock);
          return NextResponse.json(timeline);
        } else {
          // Return full timeline
          const timeline = await getFullTimeline();
          return NextResponse.json(timeline);
        }
      }

      default: {
        // Legacy full data endpoint for backward compatibility
        const [metadata, currentState, timeline] = await Promise.all([
          getMetadata(),
          getCurrentState(),
          getFullTimeline()
        ]);

        if (!metadata || !currentState) {
          return NextResponse.json(
            { error: 'No data found. Please run sync first.' },
            { status: 404 }
          );
        }

        // Return in legacy VotingPowerData format
        return NextResponse.json({
          lastSyncedBlock: metadata.lastSyncedBlock,
          timeline,
          currentDelegators: currentState.delegators
        });
      }
    }
  } catch (error: any) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
