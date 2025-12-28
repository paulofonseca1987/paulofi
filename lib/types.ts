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
}

