import { NextResponse } from 'next/server';
import { getFundsWalletData } from '@/lib/fundsWallet';
import { getConfig } from '@/lib/config';

export async function GET() {
  try {
    const config = getConfig();

    // Check if funds wallet is configured
    if (!config.fundsWallet || !config.fundsWalletTokens) {
      return NextResponse.json(
        { error: 'Funds wallet not configured' },
        { status: 404 }
      );
    }

    const data = await getFundsWalletData();

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to fetch funds wallet data' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching funds wallet data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch funds wallet data' },
      { status: 500 }
    );
  }
}
