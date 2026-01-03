import { NextRequest, NextResponse } from 'next/server';
import {
  getCurrentState,
  getMetadata,
  storeCurrentState,
  storeMetadata,
  appendTimelineEntries,
  acquireSyncLock,
  releaseSyncLock,
} from '@/lib/storage';
import { verifyAllDelegatorBalances, applyVerificationFixes } from '@/lib/balanceVerification';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Address } from 'viem';
import type { CurrentStateSchema, MetadataSchema, TimelineEntry } from '@/lib/types';

function getConfig() {
  const configPath = join(process.cwd(), 'config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8')) as {
    delegateAddress: string;
    tokenAddress: string;
    chainId: number;
  };
}

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Validate auth token
  const token = request.headers.get('X-Sync-Token');
  const syncSecret = process.env.SYNC_SECRET || 'default-secret';

  if (token !== syncSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acquire sync lock to prevent concurrent modifications
  const lockAcquired = await acquireSyncLock();
  if (!lockAcquired) {
    return NextResponse.json(
      { error: 'Sync or verification already in progress' },
      { status: 409 }
    );
  }

  try {
    // Parse request body
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || 'check';
    const threshold = body.threshold || '0';

    console.log(`[Verification] Starting in ${mode} mode with threshold ${threshold}`);

    const config = getConfig();
    const tokenAddress = config.tokenAddress as Address;
    const delegateAddress = config.delegateAddress as Address;

    // Get current state
    const currentState = await getCurrentState();
    if (!currentState) {
      await releaseSyncLock();
      return NextResponse.json(
        { error: 'No current state found. Run sync first.' },
        { status: 404 }
      );
    }

    const metadata = await getMetadata();
    if (!metadata) {
      await releaseSyncLock();
      return NextResponse.json(
        { error: 'No metadata found. Run sync first.' },
        { status: 404 }
      );
    }

    console.log(`[Verification] Verifying ${Object.keys(currentState.delegators).length} delegators`);

    // Run verification
    const result = await verifyAllDelegatorBalances(
      tokenAddress,
      delegateAddress,
      currentState.delegators,
      { threshold }
    );

    console.log(`[Verification] Verified ${result.verified} delegators`);
    console.log(`[Verification] Found ${result.discrepancies.length} discrepancies`);
    console.log(`[Verification] Failed ${result.failed} queries`);

    // Apply fixes if mode is 'fix' and discrepancies found
    let updated = false;
    let fixDetails: any = null;

    if (mode === 'fix' && result.discrepancies.length > 0) {
      console.log(`[Verification] Applying fixes...`);

      const fixes = applyVerificationFixes(
        currentState.delegators,
        result.discrepancies
      );

      // Calculate new total voting power
      let newTotalVotingPower = 0n;
      for (const balance of Object.values(fixes.updatedDelegators)) {
        newTotalVotingPower += BigInt(balance);
      }

      // Update current state
      const newCurrentState: CurrentStateSchema = {
        asOfBlock: result.verifiedAtBlock,
        asOfTimestamp: result.timestamp,
        delegators: fixes.updatedDelegators,
      };

      // Update metadata
      const newMetadata: MetadataSchema = {
        ...metadata,
        totalVotingPower: newTotalVotingPower.toString(),
        totalDelegators: Object.keys(fixes.updatedDelegators).length,
        lastSyncTimestamp: result.timestamp,
      };

      // Create timeline entry for the correction
      const timelineEntry: TimelineEntry = {
        timestamp: result.timestamp,
        blockNumber: result.verifiedAtBlock,
        totalVotingPower: newTotalVotingPower.toString(),
        delegators: fixes.updatedDelegators,
      };

      // Store updates
      await storeCurrentState(newCurrentState);
      await storeMetadata(newMetadata);
      await appendTimelineEntries([timelineEntry]);

      updated = true;
      fixDetails = {
        removed: fixes.removed,
        updated: fixes.updated,
        totalVotingPowerBefore: metadata.totalVotingPower,
        totalVotingPowerAfter: newTotalVotingPower.toString(),
        delegatorCountBefore: metadata.totalDelegators,
        delegatorCountAfter: Object.keys(fixes.updatedDelegators).length,
      };

      console.log(`[Verification] Fixes applied successfully`);
      console.log(`[Verification] Removed ${fixes.removed.length} delegators`);
      console.log(`[Verification] Updated ${fixes.updated.length} delegators`);
      console.log(`[Verification] Total voting power: ${metadata.totalVotingPower} → ${newTotalVotingPower.toString()}`);
    }

    await releaseSyncLock();

    return NextResponse.json({
      status: 'completed',
      mode,
      timestamp: result.timestamp,
      verifiedAt: result.verifiedAtBlock,
      summary: {
        totalDelegators: Object.keys(currentState.delegators).length,
        verified: result.verified,
        discrepancies: result.discrepancies.length,
        failed: result.failed,
        updated,
      },
      discrepancies: result.discrepancies.map((d) => ({
        ...d,
        action: mode === 'fix'
          ? BigInt(d.actual) === 0n
            ? 'balance_set_to_zero'
            : 'balance_corrected'
          : 'none',
      })),
      fixes: mode === 'fix' ? fixDetails : null,
    });
  } catch (error: any) {
    console.error('[Verification] Error:', error);
    await releaseSyncLock();
    return NextResponse.json(
      { error: error.message || 'Verification failed' },
      { status: 500 }
    );
  }
}
