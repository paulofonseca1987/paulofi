import { type PublicClient, type Address } from 'viem';
import { createArchiveClient } from './blockchain';
import type { VerificationResult } from './types';

/**
 * Verify all delegators' balances against current on-chain state
 */
export async function verifyAllDelegatorBalances(
  tokenAddress: Address,
  delegateAddress: Address,
  currentDelegators: Record<string, string>,
  options: {
    fix?: boolean;
    threshold?: string;
  } = {}
): Promise<VerificationResult> {
  const archiveClient = createArchiveClient();
  const threshold = BigInt(options.threshold || '0');

  const discrepancies: Array<{
    address: string;
    stored: string;
    actual: string;
    difference: string;
  }> = [];

  let verified = 0;
  let failed = 0;

  const delegatorAddresses = Object.keys(currentDelegators);
  const BATCH_SIZE = 5;

  // Get current block for consistency
  const currentBlock = await archiveClient.getBlockNumber();

  console.log(`[Verification] Starting verification of ${delegatorAddresses.length} delegators at block ${currentBlock}`);

  for (let i = 0; i < delegatorAddresses.length; i += BATCH_SIZE) {
    const batch = delegatorAddresses.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (addr) => {
        try {
          const [balance, delegateTo] = await Promise.all([
            archiveClient.readContract({
              address: tokenAddress,
              abi: [{
                name: 'balanceOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: '', type: 'uint256' }],
              }],
              functionName: 'balanceOf',
              args: [addr as Address],
              blockNumber: currentBlock,
            }) as Promise<bigint>,
            archiveClient.readContract({
              address: tokenAddress,
              abi: [{
                name: 'delegates',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: '', type: 'address' }],
              }],
              functionName: 'delegates',
              args: [addr as Address],
              blockNumber: currentBlock,
            }) as Promise<Address>,
          ]);

          return { addr, balance, delegateTo, success: true };
        } catch (error) {
          console.error(`[Verification] Failed to verify ${addr}:`, error);
          return { addr, balance: 0n, delegateTo: null as Address | null, success: false };
        }
      })
    );

    for (const result of results) {
      if (!result.success) {
        failed++;
        continue;
      }

      const storedBalance = BigInt(currentDelegators[result.addr] || '0');
      const actualBalance = result.balance;

      // Check if still delegating to our delegate
      const stillDelegating =
        result.delegateTo?.toLowerCase() === delegateAddress.toLowerCase();

      // If not delegating to us anymore, effective balance should be 0 for our purposes
      const effectiveBalance = stillDelegating ? actualBalance : 0n;

      const difference = effectiveBalance - storedBalance;

      if (difference !== 0n && (difference < 0n ? -difference : difference) > threshold) {
        discrepancies.push({
          address: result.addr,
          stored: storedBalance.toString(),
          actual: effectiveBalance.toString(),
          difference: difference.toString(),
        });

        console.log(`[Verification] Discrepancy found for ${result.addr}:`);
        console.log(`  Stored: ${storedBalance.toString()}`);
        console.log(`  Actual: ${effectiveBalance.toString()}`);
        console.log(`  Difference: ${difference.toString()}`);
        console.log(`  Still delegating: ${stillDelegating}`);
      }

      verified++;
    }

    // Rate limiting
    if (i + BATCH_SIZE < delegatorAddresses.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`[Verification] Complete. Verified: ${verified}, Failed: ${failed}, Discrepancies: ${discrepancies.length}`);

  return {
    verified,
    discrepancies,
    failed,
    timestamp: Math.floor(Date.now() / 1000), // Convert to Unix seconds for consistency with sync
    verifiedAtBlock: Number(currentBlock),
  };
}

/**
 * Apply verification fixes to current state
 */
export function applyVerificationFixes(
  currentDelegators: Record<string, string>,
  discrepancies: Array<{
    address: string;
    stored: string;
    actual: string;
    difference: string;
  }>
): {
  updatedDelegators: Record<string, string>;
  removed: string[];
  updated: string[];
} {
  const updated = { ...currentDelegators };
  const removed: string[] = [];
  const updatedAddrs: string[] = [];

  for (const disc of discrepancies) {
    const addr = disc.address.toLowerCase();
    const actualBalance = BigInt(disc.actual);

    // Always update the balance, even if it's 0 (keep delegators with 0 balance)
    updated[addr] = actualBalance.toString();
    updatedAddrs.push(addr);
    console.log(`[Verification Fix] Updating ${addr} balance to ${actualBalance.toString()}`);
  }

  return {
    updatedDelegators: updated,
    removed,
    updated: updatedAddrs,
  };
}
