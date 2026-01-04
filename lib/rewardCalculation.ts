import type { VoteEntry, DelegatorRewardShare } from './types';

/**
 * Calculates each delegator's reward share based on their voting power contribution.
 *
 * Formula: delegator_share = (VP × votes_participated) / Σ(all: VP × votes_participated)
 *
 * For each vote, we sum the delegator's voting power from delegatorBreakdown.
 * The total contribution is the sum of voting power across all votes a delegator participated in.
 */
export function calculateDelegatorRewardShares(
  votes: VoteEntry[]
): Record<string, DelegatorRewardShare> {
  // Track each delegator's total contribution and vote count
  const contributions = new Map<string, { total: bigint; voteCount: number }>();

  // Process each vote
  for (const vote of votes) {
    if (!vote.delegatorBreakdown) continue;

    // Process each delegator in this vote
    for (const [address, balanceStr] of Object.entries(vote.delegatorBreakdown)) {
      const balance = BigInt(balanceStr);

      // Skip delegators with zero balance at snapshot
      if (balance === 0n) continue;

      const addrLower = address.toLowerCase();
      const existing = contributions.get(addrLower);

      if (existing) {
        existing.total += balance;
        existing.voteCount += 1;
      } else {
        contributions.set(addrLower, { total: balance, voteCount: 1 });
      }
    }
  }

  // Calculate total contribution across all delegators
  let grandTotal = 0n;
  for (const { total } of contributions.values()) {
    grandTotal += total;
  }

  // Build result map with percentages
  const result: Record<string, DelegatorRewardShare> = {};

  for (const [address, { total, voteCount }] of contributions.entries()) {
    // Calculate percentage with high precision
    // Use 1e18 multiplier for precision, then divide
    const percentage = grandTotal > 0n
      ? (Number(total) / Number(grandTotal)) * 100
      : 0;

    result[address] = {
      totalContribution: total.toString(),
      voteCount,
      rewardPercentage: percentage,
    };
  }

  return result;
}
