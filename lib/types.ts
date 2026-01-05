export interface Config {
  delegateAddress: string;
  tokenAddress: string;
  chainId: number;
  chainName: string;
  l1ChainName?: string;
  startBlock: number;
  endBlock: number | 'latest';
  tallyDaoName?: string;
  snapshotSpace?: string;
  governors?: {
    core: string;
    treasury: string;
  };
}

// Vote types
export type VoteSource = 'snapshot' | 'onchain-core' | 'onchain-treasury';

export interface VoteEntry {
  proposalId: string;
  source: VoteSource;
  votingPower: string;              // wei
  snapshotTimestamp: number;        // when VP was snapshotted
  snapshotBlockNumber: number;
  voteTimestamp: number;            // when vote was cast
  voteBlockNumber?: number;
  choice: number | number[] | Record<string, number>;  // single, ranked, or weighted
  reason?: string;                  // vote reason/rationale
  proposalTitle?: string;
  proposalType?: string;            // basic, single-choice, ranked-choice, weighted, etc.
  proposalChoices?: string[];       // array of choice labels for the proposal
  delegatorBreakdown: Record<string, string>;  // from timeline at snapshot
}

export interface VotesMetadata {
  lastSyncTimestamp: number;
  totalVotes: number;
  snapshotVotes: number;
  onchainCoreVotes: number;
  onchainTreasuryVotes: number;
}

export interface DelegatorRewardShare {
  totalContribution: string;     // wei string for precision
  voteCount: number;
  rewardPercentage: number;
}

export interface VotesData {
  votes: VoteEntry[];
}

export interface TimelineEntry {
  timestamp: number;
  blockNumber: number;
  totalVotingPower: string;
  delegators: Record<string, string>; // address -> balance
}

export interface VotingPowerData {
  lastSyncedBlock: number;
  timeline: TimelineEntry[];
  currentDelegators: Record<string, string>; // address -> balance
}

export interface DelegationEvent {
  from: string;
  to: string;
  previousBalance: bigint;
  newBalance: bigint;
  blockNumber: number;
  timestamp: number;
  eventType: 'DELEGATE_CHANGED' | 'BALANCE_CHANGED';
  delegator?: string; // Specific delegator address for BALANCE_CHANGED events
}

export interface MetadataSchema {
  lastSyncedBlock: number;
  lastSyncTimestamp: number;
  totalVotingPower: string;
  totalDelegators: number;
  totalTimelineEntries: number;
  timelinePartitions: number;
  delegateAddress?: string;
}

export interface CurrentStateSchema {
  asOfBlock: number;
  asOfTimestamp: number;
  delegators: Record<string, string>; // address -> balance
}

export interface TimelinePartitionInfo {
  id: number;
  startBlock: number;
  endBlock: number;
  entryCount: number;
  fileName: string;
}

export interface TimelineIndex {
  totalEntries: number;
  partitionSize: number;
  partitions: TimelinePartitionInfo[];
}

export interface TimelinePartition {
  partitionId: number;
  entries: TimelineEntry[];
}

export interface SyncLock {
  syncInProgress: boolean;
  startedAt: number;
  pid: string;
}

export interface SyncProgress {
  isActive: boolean;
  currentBlock: number;
  targetBlock: number;
  startBlock: number;
  eventsProcessed: number;
  percentComplete: number;
  estimatedTimeRemaining?: number;
  startedAt: number;
}

export interface VerificationResult {
  verified: number;
  discrepancies: Array<{
    address: string;
    stored: string;
    actual: string;
    difference: string;
  }>;
  failed: number;
  timestamp: number;
  verifiedAtBlock: number;
}

