import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { arbitrum } from 'viem/chains';
import type { DelegationEvent } from './types';

// Arbitrum free RPC endpoints with fallback
const ARBITRUM_RPC_ENDPOINTS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.llamarpc.com',
  'https://rpc.ankr.com/arbitrum',
  'https://arbitrum-one.public.blastapi.io',
];

// ERC20Votes DelegationVotesChanged event ABI
const DELEGATION_VOTES_CHANGED_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'previousBalance', type: 'uint256' },
      { indexed: false, name: 'newBalance', type: 'uint256' },
    ],
    name: 'DelegationVotesChanged',
    type: 'event',
  },
] as const;

/**
 * Creates a Viem public client with fallback RPC endpoints
 */
export function createArbitrumClient(): PublicClient {
  let client: PublicClient | null = null;

  // Try to create client with first available RPC
  for (const rpcUrl of ARBITRUM_RPC_ENDPOINTS) {
    try {
      client = createPublicClient({
        chain: arbitrum,
        transport: http(rpcUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });
      break;
    } catch (error) {
      console.warn(`Failed to connect to ${rpcUrl}, trying next...`);
    }
  }

  if (!client) {
    throw new Error('Failed to connect to any Arbitrum RPC endpoint');
  }

  return client;
}

/**
 * Fetches DelegationVotesChanged events for a specific delegate
 */
export async function fetchDelegationEvents(
  client: PublicClient,
  tokenAddress: Address,
  delegateAddress: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<DelegationEvent[]> {
  try {
    const logs = await client.getLogs({
      address: tokenAddress,
      event: DELEGATION_VOTES_CHANGED_ABI[0],
      args: {
        to: delegateAddress,
      },
      fromBlock,
      toBlock,
    });

    // Also fetch events where 'from' is the delegate (undelegations)
    const fromLogs = await client.getLogs({
      address: tokenAddress,
      event: DELEGATION_VOTES_CHANGED_ABI[0],
      args: {
        from: delegateAddress,
      },
      fromBlock,
      toBlock,
    });

    // Combine and deduplicate
    const allLogs = [...logs, ...fromLogs];
    const uniqueLogs = Array.from(
      new Map(allLogs.map((log) => [`${log.blockNumber}-${log.logIndex}`, log])).values()
    );

    // Fetch block timestamps in parallel
    const events: DelegationEvent[] = await Promise.all(
      uniqueLogs.map(async (log) => {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        return {
          from: log.args.from as Address,
          to: log.args.to as Address,
          previousBalance: log.args.previousBalance as bigint,
          newBalance: log.args.newBalance as bigint,
          blockNumber: Number(log.blockNumber),
          timestamp: Number(block.timestamp),
        };
      })
    );

    // Sort by block number
    events.sort((a, b) => a.blockNumber - b.blockNumber);

    return events;
  } catch (error) {
    console.error('Error fetching delegation events:', error);
    throw error;
  }
}

/**
 * Gets the current block number
 */
export async function getCurrentBlockNumber(client: PublicClient): Promise<number> {
  const block = await client.getBlockNumber();
  return Number(block);
}

/**
 * Gets the token creation block (approximation: first block with events)
 */
export async function getTokenCreationBlock(
  client: PublicClient,
  tokenAddress: Address
): Promise<number> {
  try {
    // Try to find the first block where the contract exists
    // We'll search backwards from a reasonable starting point
    const currentBlock = await getCurrentBlockNumber(client);
    const searchStart = Math.max(0, currentBlock - 1000000); // Search last ~1M blocks

    // Get first event to approximate creation
    const logs = await client.getLogs({
      address: tokenAddress,
      event: DELEGATION_VOTES_CHANGED_ABI[0],
      fromBlock: BigInt(searchStart),
      toBlock: 'latest',
    });

    if (logs.length > 0) {
      return Number(logs[0].blockNumber);
    }

    // Fallback: use a reasonable default (Arbitrum launch block)
    return 0;
  } catch (error) {
    console.warn('Could not determine token creation block, using 0:', error);
    return 0;
  }
}

