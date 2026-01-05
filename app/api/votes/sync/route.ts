import { NextResponse } from 'next/server';
import type { Config, VoteEntry, TimelineEntry } from '@/lib/types';
import { fetchSnapshotVotes } from '@/lib/snapshot';
import { createGovernorClient, createArchiveGovernorClient, createEthereumClient, fetchGovernorVotesWithSnapshots } from '@/lib/governor';
import { appendVotes, getVotesMetadata, clearVotesCache } from '@/lib/votesStorage';
import { getFullTimeline } from '@/lib/storage';
import { getConfig, resolveEndBlock } from '@/lib/config';
import type { Address } from 'viem';

/**
 * Find the timeline entry at or before a given block
 * If targetBlock is before the first entry, returns the first entry's delegators
 */
function getDelegatorBreakdownAtBlock(
  timeline: TimelineEntry[],
  targetBlock: number
): Record<string, string> {
  if (timeline.length === 0) return {};

  // If target block is before our timeline, use the first entry
  if (targetBlock < timeline[0].blockNumber) {
    return timeline[0].delegators;
  }

  let match: TimelineEntry | null = null;

  for (const entry of timeline) {
    if (entry.blockNumber <= targetBlock) {
      match = entry;
    } else {
      break; // Timeline is sorted by block
    }
  }

  return match?.delegators || {};
}

export async function POST() {
  console.log('🗳️ Starting votes sync...');

  try {
    const config = getConfig();
    const delegateAddress = config.delegateAddress;
    const snapshotSpace = config.snapshotSpace;
    const governors = config.governors;

    if (!snapshotSpace) {
      return NextResponse.json(
        { error: 'snapshotSpace not configured in config.json' },
        { status: 400 }
      );
    }

    if (!governors) {
      return NextResponse.json(
        { error: 'governors not configured in config.json' },
        { status: 400 }
      );
    }

    // Get block range from config
    const governorClient = createGovernorClient();
    const startBlock = config.startBlock;
    const maxBlock = config.endBlock === 'latest'
      ? Number(await governorClient.getBlockNumber())
      : config.endBlock;

    // Load timeline for delegator breakdown lookup
    console.log('📊 Loading timeline data...');
    const timeline = await getFullTimeline();
    console.log(`  Loaded ${timeline.length} timeline entries`);

    const allVotes: VoteEntry[] = [];

    // =========================================================================
    // FETCH SNAPSHOT.ORG VOTES
    // =========================================================================
    console.log(`\n📸 Fetching Snapshot.org votes for ${delegateAddress} in ${snapshotSpace}...`);

    try {
      const snapshotVotes = await fetchSnapshotVotes(
        delegateAddress,
        snapshotSpace,
        startBlock,
        maxBlock
      );

      console.log(`  Found ${snapshotVotes.length} Snapshot votes`);

      for (const vote of snapshotVotes) {
        const snapshotBlock = parseInt(vote.proposal.snapshot, 10);
        const delegatorBreakdown = getDelegatorBreakdownAtBlock(timeline, snapshotBlock);

        // Calculate total voting power from breakdown
        let totalVotingPower = BigInt(0);
        for (const balance of Object.values(delegatorBreakdown)) {
          totalVotingPower += BigInt(balance);
        }

        allVotes.push({
          proposalId: vote.proposal.id,
          source: 'snapshot',
          votingPower: totalVotingPower.toString(),
          snapshotTimestamp: vote.proposal.created,
          snapshotBlockNumber: snapshotBlock,
          voteTimestamp: vote.created,
          choice: vote.choice,
          reason: vote.reason || undefined,
          proposalTitle: vote.proposal.title,
          proposalType: vote.proposal.type,
          proposalChoices: vote.proposal.choices,
          delegatorBreakdown,
        });
      }
    } catch (error) {
      console.error('Error fetching Snapshot votes:', error);
    }

    // =========================================================================
    // FETCH CORE GOVERNOR VOTES
    // =========================================================================
    console.log(`\n🏛️ Fetching Core Governor votes from ${governors.core}...`);

    const eventClient = createGovernorClient();
    const archiveClient = createArchiveGovernorClient();
    const ethClient = createEthereumClient();

    try {
      const coreVotes = await fetchGovernorVotesWithSnapshots(
        eventClient,
        governors.core as Address,
        delegateAddress as Address,
        BigInt(startBlock),
        BigInt(maxBlock),
        archiveClient,
        ethClient
      );

      console.log(`  Found ${coreVotes.length} Core Governor votes`);

      for (const vote of coreVotes) {
        // Use the converted Arbitrum block for timeline lookup
        const delegatorBreakdown = getDelegatorBreakdownAtBlock(timeline, vote.arbitrumSnapshotBlock);

        // Calculate total voting power from breakdown
        let totalVotingPower = BigInt(0);
        for (const balance of Object.values(delegatorBreakdown)) {
          totalVotingPower += BigInt(balance);
        }

        allVotes.push({
          proposalId: vote.proposalId,
          source: 'onchain-core',
          votingPower: totalVotingPower.toString(),
          snapshotTimestamp: vote.snapshotTimestamp,
          snapshotBlockNumber: vote.arbitrumSnapshotBlock, // Use converted Arbitrum block
          voteTimestamp: vote.snapshotTimestamp,
          voteBlockNumber: vote.blockNumber,
          choice: vote.support,
          reason: vote.reason || undefined,
          proposalTitle: vote.proposalTitle,
          delegatorBreakdown,
        });
      }
    } catch (error) {
      console.error('Error fetching Core Governor votes:', error);
    }

    // =========================================================================
    // FETCH TREASURY GOVERNOR VOTES
    // =========================================================================
    console.log(`\n💰 Fetching Treasury Governor votes from ${governors.treasury}...`);

    try {
      const treasuryVotes = await fetchGovernorVotesWithSnapshots(
        eventClient,
        governors.treasury as Address,
        delegateAddress as Address,
        BigInt(startBlock),
        BigInt(maxBlock),
        archiveClient,
        ethClient
      );

      console.log(`  Found ${treasuryVotes.length} Treasury Governor votes`);

      for (const vote of treasuryVotes) {
        // Use the converted Arbitrum block for timeline lookup
        const delegatorBreakdown = getDelegatorBreakdownAtBlock(timeline, vote.arbitrumSnapshotBlock);

        // Calculate total voting power from breakdown
        let totalVotingPower = BigInt(0);
        for (const balance of Object.values(delegatorBreakdown)) {
          totalVotingPower += BigInt(balance);
        }

        allVotes.push({
          proposalId: vote.proposalId,
          source: 'onchain-treasury',
          votingPower: totalVotingPower.toString(),
          snapshotTimestamp: vote.snapshotTimestamp,
          snapshotBlockNumber: vote.arbitrumSnapshotBlock, // Use converted Arbitrum block
          voteTimestamp: vote.snapshotTimestamp,
          voteBlockNumber: vote.blockNumber,
          choice: vote.support,
          reason: vote.reason || undefined,
          proposalTitle: vote.proposalTitle,
          delegatorBreakdown,
        });
      }
    } catch (error) {
      console.error('Error fetching Treasury Governor votes:', error);
    }

    // =========================================================================
    // SAVE VOTES
    // =========================================================================
    console.log(`\n💾 Saving ${allVotes.length} votes...`);
    clearVotesCache();
    const savedData = await appendVotes(allVotes);

    const result = {
      message: 'Votes sync completed',
      totalVotes: savedData.votes.length,
      snapshotVotes: savedData.votes.filter((v) => v.source === 'snapshot').length,
      onchainCoreVotes: savedData.votes.filter((v) => v.source === 'onchain-core').length,
      onchainTreasuryVotes: savedData.votes.filter((v) => v.source === 'onchain-treasury').length,
    };

    console.log('✅ Votes sync complete:', result);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('❌ Votes sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync votes' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // GET request returns current sync status/metadata
  const metadata = await getVotesMetadata();

  if (!metadata) {
    return NextResponse.json({
      message: 'No votes synced yet',
      totalVotes: 0,
    });
  }

  return NextResponse.json(metadata);
}
