import { NextResponse } from 'next/server';
import { getVotesData, getVotesMetadata, getVotesInRange } from '@/lib/votesStorage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'votes';

  try {
    if (endpoint === 'metadata') {
      const metadata = await getVotesMetadata();

      if (!metadata) {
        return NextResponse.json({
          lastSyncTimestamp: 0,
          totalVotes: 0,
          snapshotVotes: 0,
          onchainCoreVotes: 0,
          onchainTreasuryVotes: 0,
        });
      }

      return NextResponse.json(metadata);
    }

    if (endpoint === 'votes') {
      // Optional timestamp range filtering
      const fromTimestamp = searchParams.get('from');
      const toTimestamp = searchParams.get('to');

      if (fromTimestamp || toTimestamp) {
        const votes = await getVotesInRange(
          fromTimestamp ? parseInt(fromTimestamp, 10) : undefined,
          toTimestamp ? parseInt(toTimestamp, 10) : undefined
        );
        return NextResponse.json({ votes });
      }

      const data = await getVotesData();

      if (!data) {
        return NextResponse.json({ votes: [] });
      }

      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: `Unknown endpoint: ${endpoint}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error fetching votes:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch votes' },
      { status: 500 }
    );
  }
}
