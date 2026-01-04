import { NextRequest, NextResponse } from 'next/server';
import { truncateTimelineAfterBlock } from '@/lib/storage';

const MAX_BLOCK = 416593978;

export async function POST(request: NextRequest) {
  // Validate sync token
  const token = request.headers.get('X-Sync-Token');
  const syncSecret = process.env.SYNC_SECRET || 'default-secret';

  if (token !== syncSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[Cleanup] Starting truncation to block ${MAX_BLOCK}...`);

    const result = await truncateTimelineAfterBlock(MAX_BLOCK);

    return NextResponse.json({
      message: 'Cleanup completed',
      maxBlock: MAX_BLOCK,
      ...result
    });
  } catch (error: any) {
    console.error('[Cleanup] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup data' },
      { status: 500 }
    );
  }
}
