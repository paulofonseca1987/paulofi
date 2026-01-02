import { NextResponse } from 'next/server';
import { getSyncProgress } from '@/lib/storage';

export async function GET() {
  try {
    const progress = await getSyncProgress();

    if (!progress) {
      return NextResponse.json({
        isActive: false,
        currentBlock: 0,
        targetBlock: 0,
        startBlock: 0,
        eventsProcessed: 0,
        percentComplete: 0,
        startedAt: 0
      });
    }

    return NextResponse.json(progress);
  } catch (error: any) {
    console.error('Error fetching sync progress:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch progress' },
      { status: 500 }
    );
  }
}
