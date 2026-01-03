import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const configPath = join(process.cwd(), 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      delegateAddress: string;
      tokenAddress: string;
      chainId: number;
    };

    return NextResponse.json({
      delegateAddress: config.delegateAddress.toLowerCase(),
      tokenAddress: config.tokenAddress,
      chainId: config.chainId
    });
  } catch (error) {
    console.error('Error reading config.json:', error);
    return NextResponse.json(
      { error: 'Failed to read config' },
      { status: 500 }
    );
  }
}
