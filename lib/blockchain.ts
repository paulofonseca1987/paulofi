import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { arbitrum } from 'viem/chains';
import type { DelegationEvent } from './types';

// Free RPC endpoints for event fetching (support larger block ranges)
const FREE_RPC_ENDPOINTS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.llamarpc.com',
  'https://rpc.ankr.com/arbitrum',
  'https://arbitrum-one.public.blastapi.io',
];

// ERC20Votes DelegateChanged event ABI
const DELEGATE_CHANGED_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'delegator', type: 'address' },
      { indexed: true, name: 'fromDelegate', type: 'address' },
      { indexed: true, name: 'toDelegate', type: 'address' },
    ],
    name: 'DelegateChanged',
    type: 'event',
  },
] as const;

// ERC20Votes DelegateVotesChanged event ABI
const DELEGATE_VOTES_CHANGED_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'delegate', type: 'address' },
      { indexed: false, name: 'previousBalance', type: 'uint256' },
      { indexed: false, name: 'newBalance', type: 'uint256' },
    ],
    name: 'DelegateVotesChanged',
    type: 'event',
  },
] as const;

/**
 * Creates a client optimized for event fetching (getLogs)
 * Uses free public RPCs that support larger block ranges (10k+ blocks)
 */
export function createEventFetchingClient(): PublicClient {
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
 * Creates a client for historical state queries (archive node)
 * Uses DRPC or other archive-enabled endpoint for balanceOf with blockNumber
 */
export function createArchiveClient(): PublicClient {
  const rpcUrl = process.env.DRPC_RPC_URL || process.env.ARBITRUM_RPC_URL;

  if (!rpcUrl) {
    throw new Error('DRPC_RPC_URL or ARBITRUM_RPC_URL must be set for archive queries');
  }

  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

/**
 * @deprecated Use createEventFetchingClient() or createArchiveClient() instead
 * Creates an Arbitrum client (defaults to archive client for backward compatibility)
 */
export function createArbitrumClient(): PublicClient {
  return createArchiveClient();
}

/**
 * Helper to deduplicate DelegateChanged and DelegateVotesChanged events
 * DelegateChanged events always trigger DelegateVotesChanged, so we skip the redundant ones
 */
function deduplicateEvents(
  delegateChangedLogs: any[],
  votesChangedLogs: any[]
): Array<{ type: 'DELEGATE_CHANGED' | 'VOTES_CHANGED'; log: any }> {
  // Group all events by transaction hash
  const eventsByTx = new Map<string, { changed: any[]; votes: any[] }>();

  for (const log of delegateChangedLogs) {
    const txHash = log.transactionHash;
    if (!eventsByTx.has(txHash)) {
      eventsByTx.set(txHash, { changed: [], votes: [] });
    }
    eventsByTx.get(txHash)!.changed.push(log);
  }

  for (const log of votesChangedLogs) {
    const txHash = log.transactionHash;
    if (!eventsByTx.has(txHash)) {
      eventsByTx.set(txHash, { changed: [], votes: [] });
    }
    eventsByTx.get(txHash)!.votes.push(log);
  }

  // Build deduplicated list
  const deduplicated: Array<{ type: 'DELEGATE_CHANGED' | 'VOTES_CHANGED'; log: any }> = [];

  for (const [txHash, events] of eventsByTx) {
    if (events.changed.length > 0) {
      // Has DelegateChanged - use those (more informative)
      for (const log of events.changed) {
        deduplicated.push({ type: 'DELEGATE_CHANGED', log });
      }
    } else {
      // Only has VotesChanged - this is a pure balance change
      for (const log of events.votes) {
        deduplicated.push({ type: 'VOTES_CHANGED', log });
      }
    }
  }

  // Sort chronologically by block number and log index
  deduplicated.sort((a, b) => {
    if (a.log.blockNumber !== b.log.blockNumber) {
      return Number(a.log.blockNumber - b.log.blockNumber);
    }
    return a.log.logIndex - b.log.logIndex;
  });

  return deduplicated;
}

/**
 * Helper to query balances for all delegators at a specific block
 * Batches queries to avoid rate limits
 */
async function queryAllDelegatorBalances(
  archiveClient: PublicClient,
  tokenAddress: Address,
  delegators: string[],
  blockNumber: bigint
): Promise<Map<string, bigint>> {
  const results = new Map<string, bigint>();
  const BATCH_SIZE = 10;

  for (let i = 0; i < delegators.length; i += BATCH_SIZE) {
    const batch = delegators.slice(i, i + BATCH_SIZE);

    const balances = await Promise.all(
      batch.map((addr) =>
        archiveClient.readContract({
          address: tokenAddress,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ],
          functionName: 'balanceOf',
          args: [addr as Address],
          blockNumber,
        })
      )
    );

    batch.forEach((addr, idx) => {
      results.set(addr.toLowerCase(), balances[idx] as bigint);
    });

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < delegators.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return results;
}

/**
 * Fetches DelegateChanged events for a specific delegate and gets delegator balances
 * Also tracks DelegateVotesChanged events to capture balance changes
 * @param eventClient - Client for fetching events (can use free RPC with larger block ranges)
 * @param archiveClient - Client for historical balance queries (requires archive node)
 * @param currentDelegators - List of current delegator addresses for balance change tracking
 */
export async function fetchDelegationEvents(
  eventClient: PublicClient,
  archiveClient: PublicClient,
  tokenAddress: Address,
  delegateAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  currentDelegators: string[] = []
): Promise<DelegationEvent[]> {
  try {
    // Fetch 3 types of events in parallel:
    // 1. DelegateChanged TO our target (delegations)
    // 2. DelegateChanged FROM our target (undelegations)
    // 3. DelegateVotesChanged FOR our target (all voting power changes)
    const [delegateChangedLogs, undelegateLogs, votesChangedLogs] = await Promise.all([
      eventClient.getLogs({
        address: tokenAddress,
        event: DELEGATE_CHANGED_ABI[0],
        args: { toDelegate: delegateAddress },
        fromBlock,
        toBlock,
      }),
      eventClient.getLogs({
        address: tokenAddress,
        event: DELEGATE_CHANGED_ABI[0],
        args: { fromDelegate: delegateAddress },
        fromBlock,
        toBlock,
      }),
      eventClient.getLogs({
        address: tokenAddress,
        event: DELEGATE_VOTES_CHANGED_ABI[0],
        args: { delegate: delegateAddress },
        fromBlock,
        toBlock,
      }),
    ]);

    // Combine DelegateChanged logs
    const allDelegateChangedLogs = [...delegateChangedLogs, ...undelegateLogs];
    const uniqueDelegateChangedLogs = Array.from(
      new Map(
        allDelegateChangedLogs.map((log) => [`${log.blockNumber}-${log.logIndex}`, log])
      ).values()
    );

    // Deduplicate events (DelegateChanged triggers DelegateVotesChanged)
    const deduplicatedEvents = deduplicateEvents(uniqueDelegateChangedLogs, votesChangedLogs);

    // Track previous balances for comparison
    const previousBalances = new Map<string, bigint>();

    // Process each event based on type
    const events: DelegationEvent[] = [];

    for (const { type, log } of deduplicatedEvents) {
      const block = await eventClient.getBlock({ blockNumber: log.blockNumber });
      const timestamp = Number(block.timestamp);
      const blockNumber = Number(log.blockNumber);

      if (type === 'DELEGATE_CHANGED') {
        // Existing DelegateChanged logic
        const delegator = log.args.delegator!;

        // Get the delegator's token balance at the delegation block
        const balance = await archiveClient.readContract({
          address: tokenAddress,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ],
          functionName: 'balanceOf',
          args: [delegator],
          blockNumber: log.blockNumber,
        }) as bigint;

        const isDelegatingTo = log.args.toDelegate === delegateAddress;

        events.push({
          from: isDelegatingTo ? delegator : delegateAddress,
          to: isDelegatingTo ? delegateAddress : (log.args.toDelegate || delegateAddress),
          previousBalance: isDelegatingTo ? 0n : balance,
          newBalance: isDelegatingTo ? balance : 0n,
          blockNumber,
          timestamp,
          eventType: 'DELEGATE_CHANGED',
        });

        // Update previous balance tracking
        previousBalances.set(delegator.toLowerCase(), balance);
      } else if (type === 'VOTES_CHANGED') {
        // NEW: Handle DelegateVotesChanged-only events (pure balance changes)
        if (currentDelegators.length === 0) {
          // No delegators to track yet, skip
          continue;
        }

        // Query all current delegators' balances to find who changed
        const newBalances = await queryAllDelegatorBalances(
          archiveClient,
          tokenAddress,
          currentDelegators,
          log.blockNumber
        );

        // Find which delegator(s) had balance changes
        for (const [delegatorAddr, newBalance] of newBalances) {
          const oldBalance = previousBalances.get(delegatorAddr) || 0n;

          if (newBalance !== oldBalance) {
            // This delegator's balance changed
            events.push({
              from: delegatorAddr,
              to: delegateAddress,
              previousBalance: oldBalance,
              newBalance: newBalance,
              blockNumber,
              timestamp,
              eventType: 'BALANCE_CHANGED',
              delegator: delegatorAddr,
            });

            // Update tracking
            previousBalances.set(delegatorAddr, newBalance);
          }
        }
      }
    }

    // Sort by block number and timestamp
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.timestamp - b.timestamp;
    });

    return events;
  } catch (error) {
    console.error('Error fetching delegation events:', error);
    throw error;
  }
}

/**
 * Gets the current block number
 * @param client - Client to use for fetching block number (can use either eventClient or archiveClient)
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
      event: DELEGATE_CHANGED_ABI[0],
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

