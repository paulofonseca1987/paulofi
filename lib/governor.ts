/**
 * On-chain Governor contract client for fetching VoteCast events
 */

import { createPublicClient, http, type PublicClient, type Address, parseAbiItem } from 'viem';
import { arbitrum, mainnet } from 'viem/chains';

// Free RPC endpoints that support larger block ranges
const FREE_RPC_ENDPOINTS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.llamarpc.com',
  'https://rpc.ankr.com/arbitrum',
  'https://arbitrum-one.public.blastapi.io',
];

// Ethereum mainnet RPC endpoints
const ETH_RPC_ENDPOINTS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
  'https://1rpc.io/eth',
];

// VoteCast event ABI (OpenZeppelin Governor standard)
const VOTE_CAST_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'voter', type: 'address' },
      { indexed: false, name: 'proposalId', type: 'uint256' },
      { indexed: false, name: 'support', type: 'uint8' },
      { indexed: false, name: 'weight', type: 'uint256' },
      { indexed: false, name: 'reason', type: 'string' },
    ],
    name: 'VoteCast',
    type: 'event',
  },
] as const;

// VoteCastWithParams event ABI (for governors that use params)
const VOTE_CAST_WITH_PARAMS_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'voter', type: 'address' },
      { indexed: false, name: 'proposalId', type: 'uint256' },
      { indexed: false, name: 'support', type: 'uint8' },
      { indexed: false, name: 'weight', type: 'uint256' },
      { indexed: false, name: 'reason', type: 'string' },
      { indexed: false, name: 'params', type: 'bytes' },
    ],
    name: 'VoteCastWithParams',
    type: 'event',
  },
] as const;

// Governor function ABIs
const GOVERNOR_FUNCTIONS_ABI = [
  {
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    name: 'proposalSnapshot',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    name: 'proposalDeadline',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface GovernorVote {
  voter: string;
  proposalId: string;
  support: number;
  weight: string;
  reason: string;
  blockNumber: number;
  transactionHash: string;
}

export interface GovernorVoteWithSnapshot extends GovernorVote {
  snapshotBlock: number;        // Original Ethereum block number from proposalSnapshot()
  snapshotTimestamp: number;    // Timestamp of the Ethereum block
  arbitrumSnapshotBlock: number; // Converted Arbitrum block number for timeline lookup
}

/**
 * Create a client for governor event queries (uses free RPCs that support larger ranges)
 */
export function createGovernorClient(): PublicClient {
  const rpcUrl = process.env.FREE_RPC_URL || FREE_RPC_ENDPOINTS[0];

  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

/**
 * Create an archive client for state queries (needs archive node)
 */
export function createArchiveGovernorClient(): PublicClient {
  const rpcUrl = process.env.DRPC_RPC_URL || process.env.ARBITRUM_RPC_URL || FREE_RPC_ENDPOINTS[0];

  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

/**
 * Create an Ethereum mainnet client for fetching L1 block timestamps
 */
export function createEthereumClient(): PublicClient {
  const rpcUrl = process.env.ETH_RPC_URL || ETH_RPC_ENDPOINTS[0];

  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

/**
 * Get the timestamp of an Ethereum mainnet block
 */
export async function getEthBlockTimestamp(
  ethClient: PublicClient,
  blockNumber: number
): Promise<number> {
  const block = await ethClient.getBlock({
    blockNumber: BigInt(blockNumber),
  });
  return Number(block.timestamp);
}

/**
 * Find the Arbitrum block number closest to a given timestamp using binary search
 */
export async function findArbitrumBlockByTimestamp(
  arbClient: PublicClient,
  targetTimestamp: number
): Promise<number> {
  // Get latest block for upper bound
  const latestBlock = await arbClient.getBlock();
  let high = Number(latestBlock.number);
  let low = 1;

  // Binary search to find the block closest to target timestamp
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await arbClient.getBlock({ blockNumber: BigInt(mid) });
    const blockTimestamp = Number(block.timestamp);

    if (blockTimestamp < targetTimestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Convert an Ethereum mainnet block number to the corresponding Arbitrum block number
 * by matching timestamps
 */
export async function convertEthBlockToArbitrumBlock(
  ethClient: PublicClient,
  arbClient: PublicClient,
  ethBlockNumber: number
): Promise<{ arbitrumBlock: number; timestamp: number }> {
  // Get the timestamp of the Ethereum block
  const ethTimestamp = await getEthBlockTimestamp(ethClient, ethBlockNumber);

  // Find the Arbitrum block at that timestamp
  const arbitrumBlock = await findArbitrumBlockByTimestamp(arbClient, ethTimestamp);

  return {
    arbitrumBlock,
    timestamp: ethTimestamp,
  };
}

// Chunk size for block range queries (free RPCs support much larger ranges)
const CHUNK_SIZE = 1000000n; // 1 million blocks per chunk

/**
 * Fetch VoteCast events from a governor contract (chunked to handle RPC limits)
 */
export async function fetchGovernorVotes(
  client: PublicClient,
  governorAddress: Address,
  voterAddress: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<GovernorVote[]> {
  const votes: GovernorVote[] = [];

  // Process in chunks to avoid RPC block range limits
  let currentFrom = fromBlock;

  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + CHUNK_SIZE - 1n > toBlock ? toBlock : currentFrom + CHUNK_SIZE - 1n;

    // Fetch VoteCast events for this chunk
    try {
      const voteCastLogs = await client.getLogs({
        address: governorAddress,
        event: parseAbiItem('event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)'),
        args: {
          voter: voterAddress,
        },
        fromBlock: currentFrom,
        toBlock: currentTo,
      });

      for (const log of voteCastLogs) {
        votes.push({
          voter: log.args.voter as string,
          proposalId: (log.args.proposalId as bigint).toString(),
          support: log.args.support as number,
          weight: (log.args.weight as bigint).toString(),
          reason: log.args.reason as string || '',
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
        });
      }
    } catch (error: any) {
      // Only log if not a "no logs found" type error
      if (!error.message?.includes('no logs')) {
        console.error(`Error fetching VoteCast events (blocks ${currentFrom}-${currentTo}):`, error.message || error);
      }
    }

    // Also try VoteCastWithParams for this chunk
    try {
      const voteCastWithParamsLogs = await client.getLogs({
        address: governorAddress,
        event: parseAbiItem('event VoteCastWithParams(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason, bytes params)'),
        args: {
          voter: voterAddress,
        },
        fromBlock: currentFrom,
        toBlock: currentTo,
      });

      for (const log of voteCastWithParamsLogs) {
        // Check if we already have this vote (avoid duplicates)
        const existingVote = votes.find(
          (v) => v.proposalId === (log.args.proposalId as bigint).toString() && v.blockNumber === Number(log.blockNumber)
        );
        if (!existingVote) {
          votes.push({
            voter: log.args.voter as string,
            proposalId: (log.args.proposalId as bigint).toString(),
            support: log.args.support as number,
            weight: (log.args.weight as bigint).toString(),
            reason: log.args.reason as string || '',
            blockNumber: Number(log.blockNumber),
            transactionHash: log.transactionHash,
          });
        }
      }
    } catch (error: any) {
      // VoteCastWithParams might not exist on some governors - silently skip
    }

    currentFrom = currentTo + 1n;

    // Small delay between chunks to avoid rate limiting
    if (currentFrom <= toBlock) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return votes;
}

/**
 * Get the snapshot block for a proposal
 */
export async function getProposalSnapshot(
  client: PublicClient,
  governorAddress: Address,
  proposalId: string
): Promise<number> {
  try {
    const snapshotBlock = await client.readContract({
      address: governorAddress,
      abi: GOVERNOR_FUNCTIONS_ABI,
      functionName: 'proposalSnapshot',
      args: [BigInt(proposalId)],
    });

    return Number(snapshotBlock);
  } catch (error) {
    console.error(`Error getting proposal snapshot for ${proposalId}:`, error);
    throw error;
  }
}

/**
 * Get block timestamp
 */
export async function getBlockTimestamp(
  client: PublicClient,
  blockNumber: number
): Promise<number> {
  try {
    const block = await client.getBlock({
      blockNumber: BigInt(blockNumber),
    });
    return Number(block.timestamp);
  } catch (error) {
    console.error(`Error getting block timestamp for ${blockNumber}:`, error);
    throw error;
  }
}

/**
 * Fetch votes with snapshot information
 * Uses eventClient for getLogs and archiveClient for contract reads
 * ethClient is used to get Ethereum block timestamps for conversion to Arbitrum blocks
 */
export async function fetchGovernorVotesWithSnapshots(
  eventClient: PublicClient,
  governorAddress: Address,
  voterAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  archiveClient?: PublicClient,
  ethClient?: PublicClient
): Promise<GovernorVoteWithSnapshot[]> {
  const votes = await fetchGovernorVotes(eventClient, governorAddress, voterAddress, fromBlock, toBlock);
  const votesWithSnapshots: GovernorVoteWithSnapshot[] = [];

  // Use archive client for state queries if provided, otherwise use event client
  const stateClient = archiveClient || eventClient;

  // Cache for snapshot blocks (same proposal = same snapshot)
  const snapshotCache = new Map<string, { ethBlock: number; timestamp: number; arbBlock: number }>();

  for (const vote of votes) {
    let snapshotInfo = snapshotCache.get(vote.proposalId);

    if (!snapshotInfo) {
      try {
        // Get the Ethereum snapshot block from the governor contract
        const ethSnapshotBlock = await getProposalSnapshot(stateClient, governorAddress, vote.proposalId);

        let snapshotTimestamp: number;
        let arbSnapshotBlock: number;

        if (ethClient) {
          // Convert Ethereum block to Arbitrum block via timestamp
          const conversion = await convertEthBlockToArbitrumBlock(ethClient, stateClient, ethSnapshotBlock);
          snapshotTimestamp = conversion.timestamp;
          arbSnapshotBlock = conversion.arbitrumBlock;
          console.log(`  Converted ETH block ${ethSnapshotBlock} -> ARB block ${arbSnapshotBlock} (ts: ${snapshotTimestamp})`);
        } else {
          // Fallback: use arbitrum client to get timestamp (won't be accurate for ETH blocks)
          snapshotTimestamp = await getBlockTimestamp(stateClient, ethSnapshotBlock);
          arbSnapshotBlock = ethSnapshotBlock; // No conversion
        }

        snapshotInfo = { ethBlock: ethSnapshotBlock, timestamp: snapshotTimestamp, arbBlock: arbSnapshotBlock };
        snapshotCache.set(vote.proposalId, snapshotInfo);
      } catch (error) {
        console.error(`Failed to get snapshot for proposal ${vote.proposalId}, skipping:`, error);
        continue;
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    votesWithSnapshots.push({
      ...vote,
      snapshotBlock: snapshotInfo.ethBlock,
      snapshotTimestamp: snapshotInfo.timestamp,
      arbitrumSnapshotBlock: snapshotInfo.arbBlock,
    });
  }

  return votesWithSnapshots;
}
