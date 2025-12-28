import { NextResponse } from 'next/server';
import { getVotingPowerData } from '@/lib/storage';

export async function GET() {
  try {
    const data = await getVotingPowerData();

    if (!data) {
      return NextResponse.json(
        { error: 'No data found. Please run sync first.' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

