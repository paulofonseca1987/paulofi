import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { getChain } from './config';
import type { DelegationEvent } from './types';

// Failed query tracking
const failedQueries = {
  balanceQueries: [] as Array<{ address: string; block: number; timestamp: number; error: string }>,
  eventQueries: [] as Array<{ fromBlock: number; toBlock: number; timestamp: number; error: string }>,
};

export function getFailedQueries() {
  return { ...failedQueries };
}

export function clearFailedQueries() {
  failedQueries.balanceQueries = [];
  failedQueries.eventQueries = [];
}

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

// ERC20 Transfer event ABI
const TRANSFER_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
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
    chain: getChain(),
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
    chain: getChain(),
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
 * Retry a function with exponential backoff
 * Returns null if all retries fail (graceful degradation)
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelayMs: number = 1000,
  context?: { address?: string; block?: number }
): Promise<T | null> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on certain errors (invalid params, etc)
      if (isNonRetryableError(error)) {
        console.warn(`[Retry] Non-retryable error, skipping:`, error.message);
        // Track the failure
        if (context?.address) {
          failedQueries.balanceQueries.push({
            address: context.address,
            block: context.block || 0,
            timestamp: Date.now(),
            error: error.message || 'Non-retryable error',
          });
        }
        return null;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying after ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.error(`[Retry] Failed after ${maxRetries} retries:`, lastError?.message || 'Unknown error');
  // Track the failure
  if (context?.address) {
    failedQueries.balanceQueries.push({
      address: context.address,
      block: context.block || 0,
      timestamp: Date.now(),
      error: lastError?.message || 'Unknown error after retries',
    });
  }
  return null; // Return null instead of throwing
}

/**
 * Check if an error should not be retried
 */
function isNonRetryableError(error: any): boolean {
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('invalid') ||
    message.includes('bad request') ||
    message.includes('unsupported')
  );
}

/**
 * Helper to query balances for all delegators at a specific block
 * Batches queries to avoid rate limits with retry logic and graceful degradation
 */
async function queryAllDelegatorBalances(
  archiveClient: PublicClient,
  tokenAddress: Address,
  delegators: string[],
  blockNumber: bigint
): Promise<Map<string, bigint>> {
  const results = new Map<string, bigint>();
  const BATCH_SIZE = 5; // Reduced from 10 to 5 for better reliability
  let failedQueries = 0;

  for (let i = 0; i < delegators.length; i += BATCH_SIZE) {
    const batch = delegators.slice(i, i + BATCH_SIZE);

    const balances = await Promise.all(
      batch.map(async (addr) => {
        return retryWithBackoff(
          async () => {
            return archiveClient.readContract({
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
            }) as Promise<bigint>;
          },
          5,
          1000,
          { address: addr, block: Number(blockNumber) }
        );
      })
    );

    batch.forEach((addr, idx) => {
      const balance = balances[idx];
      if (balance !== null) {
        results.set(addr.toLowerCase(), balance);
      } else {
        failedQueries++;
        console.warn(`[Balance Query] Failed to query balance for ${addr} at block ${blockNumber}`);
        // Don't add to results - will use previous balance
      }
    });

    // Increased delay between batches to reduce rate limit pressure
    if (i + BATCH_SIZE < delegators.length) {
      await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms instead of 50ms
    }
  }

  if (failedQueries > 0) {
    console.log(`[Balance Query] Warning: ${failedQueries} balance queries failed, using previous balances`);
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
    // Fetch 3 types of events in parallel with retry logic:
    // 1. DelegateChanged TO our target (delegations)
    // 2. DelegateChanged FROM our target (undelegations)
    // 3. DelegateVotesChanged FOR our target (all voting power changes)
    const [delegateChangedLogs, undelegateLogs, votesChangedLogs] = await Promise.all([
      retryWithBackoff(async () => {
        return eventClient.getLogs({
          address: tokenAddress,
          event: DELEGATE_CHANGED_ABI[0],
          args: { toDelegate: delegateAddress },
          fromBlock,
          toBlock,
        });
      }, 5, 2000), // 5 retries, starting at 2s delay (2s, 4s, 8s, 16s, 32s)
      retryWithBackoff(async () => {
        return eventClient.getLogs({
          address: tokenAddress,
          event: DELEGATE_CHANGED_ABI[0],
          args: { fromDelegate: delegateAddress },
          fromBlock,
          toBlock,
        });
      }, 5, 2000),
      retryWithBackoff(async () => {
        return eventClient.getLogs({
          address: tokenAddress,
          event: DELEGATE_VOTES_CHANGED_ABI[0],
          args: { delegate: delegateAddress },
          fromBlock,
          toBlock,
        });
      }, 5, 2000),
    ]);

    // Check if any getLogs failed after retries
    if (!delegateChangedLogs || !undelegateLogs || !votesChangedLogs) {
      console.error(`[Event Fetching] Failed to fetch events for block range ${fromBlock}-${toBlock} after retries`);
      failedQueries.eventQueries.push({
        fromBlock: Number(fromBlock),
        toBlock: Number(toBlock),
        timestamp: Date.now(),
        error: 'One or more event queries failed after retries',
      });
      return []; // Return empty array to allow sync to continue
    }

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

        // Get the delegator's token balance at the delegation block with retry logic
        const balance = await retryWithBackoff(
          async () => {
            return archiveClient.readContract({
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
            }) as Promise<bigint>;
          },
          5,
          1000,
          { address: delegator, block: Number(log.blockNumber) }
        );

        // Skip this event if balance query failed after retries
        if (balance === null) {
          console.warn(`[DELEGATE_CHANGED] Skipping event at block ${blockNumber} - balance query failed for ${delegator}`);
          continue;
        }

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
 * Fetch Transfer events for specific delegators to track balance changes
 * This ensures we capture all balance changes even if DelegateVotesChanged events are missed
 */
export async function fetchTransferEvents(
  eventClient: PublicClient,
  archiveClient: PublicClient,
  tokenAddress: Address,
  delegateAddress: Address,
  delegators: string[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<DelegationEvent[]> {
  if (delegators.length === 0) {
    return [];
  }

  try {
    console.log(`[Transfer Events] Fetching for ${delegators.length} delegators from block ${fromBlock} to ${toBlock}`);

    const events: DelegationEvent[] = [];

    // Fetch Transfer events FROM and TO each delegator (tokens leaving or entering their address)
    // We batch these queries to avoid overwhelming the RPC
    const BATCH_SIZE = 10;

    for (let i = 0; i < delegators.length; i += BATCH_SIZE) {
      const batch = delegators.slice(i, i + BATCH_SIZE);

      // Fetch both Transfer OUT (from delegator) and Transfer IN (to delegator)
      const [transferOutLogs, transferInLogs] = await Promise.all([
        Promise.all(
          batch.map(async (delegator) => {
            return retryWithBackoff(async () => {
              return eventClient.getLogs({
                address: tokenAddress,
                event: TRANSFER_ABI[0],
                args: { from: delegator as Address },
                fromBlock,
                toBlock,
              });
            }, 5, 2000);
          })
        ),
        Promise.all(
          batch.map(async (delegator) => {
            return retryWithBackoff(async () => {
              return eventClient.getLogs({
                address: tokenAddress,
                event: TRANSFER_ABI[0],
                args: { to: delegator as Address },
                fromBlock,
                toBlock,
              });
            }, 5, 2000);
          })
        ),
      ]);

      // Process each delegator's transfers (both IN and OUT)
      for (let j = 0; j < batch.length; j++) {
        const delegator = batch[j];
        const outLogs = transferOutLogs[j] || [];
        const inLogs = transferInLogs[j] || [];

        // Combine and deduplicate transfers by transaction hash + log index
        const allLogs = [...outLogs, ...inLogs];
        const uniqueLogs = new Map();
        for (const log of allLogs) {
          const key = `${log.transactionHash}-${log.logIndex}`;
          if (!uniqueLogs.has(key)) {
            uniqueLogs.set(key, log);
          }
        }

        for (const log of uniqueLogs.values()) {
          // Get block timestamp
          const block = await eventClient.getBlock({ blockNumber: log.blockNumber });
          const timestamp = Number(block.timestamp);
          const blockNumber = Number(log.blockNumber);

          // Query the delegator's new balance after this transfer
          const newBalance = await retryWithBackoff(
            async () => {
              return archiveClient.readContract({
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
                args: [delegator as Address],
                blockNumber: log.blockNumber,
              }) as Promise<bigint>;
            },
            5,
            1000,
            { address: delegator, block: blockNumber }
          );

          if (newBalance === null) {
            console.warn(`[Transfer] Skipping transfer at block ${blockNumber} - balance query failed for ${delegator}`);
            continue;
          }

          // Track the balance change for all current delegators
          // Even if they stopped delegating at this block, we need to track the balance change
          // The sync logic will handle updating their status appropriately
          events.push({
            from: delegator,
            to: delegateAddress,
            previousBalance: 0n, // We don't know the previous balance from Transfer event alone
            newBalance: newBalance,
            blockNumber,
            timestamp,
            eventType: 'BALANCE_CHANGED',
            delegator: delegator,
          });
        }
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < delegators.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[Transfer Events] Found ${events.length} balance changes from transfers`);
    return events;
  } catch (error) {
    console.error('Error fetching transfer events:', error);
    return []; // Return empty array instead of throwing to allow sync to continue
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

/**
 * Get the current ARB token balance of an address
 */
export async function getTokenBalance(
  client: PublicClient,
  tokenAddress: Address,
  accountAddress: Address
): Promise<bigint> {
  try {
    const balance = await client.readContract({
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
      args: [accountAddress],
    });
    return balance as bigint;
  } catch (error) {
    console.error(`Failed to get balance for ${accountAddress}:`, error);
    return 0n;
  }
}

