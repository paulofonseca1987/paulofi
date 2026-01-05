import { NextRequest, NextResponse } from 'next/server';
import { truncateTimelineAfterBlock } from '@/lib/storage';
import { getConfig, resolveEndBlock } from '@/lib/config';
import { createEventFetchingClient } from '@/lib/blockchain';

export async function POST(request: NextRequest) {
  // Validate sync token
  const token = request.headers.get('X-Sync-Token');
  const syncSecret = process.env.SYNC_SECRET || 'default-secret';

  if (token !== syncSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get maxBlock from config (resolve "latest" if needed)
    const config = getConfig();
    const client = createEventFetchingClient();
    const maxBlock = config.endBlock === 'latest'
      ? Number(await client.getBlockNumber())
      : config.endBlock;

    console.log(`[Cleanup] Starting truncation to block ${maxBlock}...`);

    const result = await truncateTimelineAfterBlock(maxBlock);

    return NextResponse.json({
      message: 'Cleanup completed',
      maxBlock: maxBlock,
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
