export interface Config {
  delegateAddress: string;
  tokenAddress: string;
  chainId: number;
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

