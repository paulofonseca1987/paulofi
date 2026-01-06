import { createPublicClient, http, type Address } from 'viem';
import { arbitrum } from 'viem/chains';
import { getConfig } from './config';
import type { FundsWalletData, FundsWalletTokenData, FundsWalletTokenConfig } from './types';

// ERC20 balanceOf ABI
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Cache for funds wallet data (60 second TTL)
let cachedData: FundsWalletData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

// Chain registry for funds wallet
const fundsWalletChainRegistry: Record<number, typeof arbitrum> = {
  42161: arbitrum,
};

/**
 * Create a client for fetching balances from the funds wallet
 */
function createFundsWalletClient(chainId: number) {
  const chain = fundsWalletChainRegistry[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID for funds wallet: ${chainId}`);
  }

  // Use public RPC endpoints
  const rpcUrls = [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.llamarpc.com',
  ];

  return createPublicClient({
    chain,
    transport: http(rpcUrls[0], {
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

/**
 * Fetch token balance from the funds wallet
 */
async function fetchTokenBalance(
  walletAddress: Address,
  tokenAddress: Address,
  chainId: number
): Promise<bigint> {
  const client = createFundsWalletClient(chainId);

  try {
    const balance = await client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    return balance;
  } catch (error) {
    console.error(`Failed to fetch balance for token ${tokenAddress}:`, error);
    return 0n;
  }
}

/**
 * Fetch USD prices from CoinGecko API
 */
async function fetchTokenPrices(
  coingeckoIds: string[]
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  if (coingeckoIds.length === 0) {
    return prices;
  }

  try {
    const idsParam = coingeckoIds.join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    for (const id of coingeckoIds) {
      if (data[id]?.usd !== undefined) {
        prices[id] = data[id].usd;
      } else {
        // Fallback: assume stablecoins are $1.00
        if (id === 'usd-coin' || id === 'tether' || id === 'dai') {
          prices[id] = 1.0;
        } else {
          console.warn(`No price found for ${id}, defaulting to 0`);
          prices[id] = 0;
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch prices from CoinGecko:', error);

    // Fallback prices for common stablecoins
    for (const id of coingeckoIds) {
      if (id === 'usd-coin' || id === 'tether' || id === 'dai') {
        prices[id] = 1.0;
      } else {
        prices[id] = 0;
      }
    }
  }

  return prices;
}

/**
 * Format token balance from wei to human-readable string
 */
function formatBalance(balance: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = balance / divisor;
  const fractionalPart = balance % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Truncate to 2 decimal places for display
  const truncatedFractional = fractionalStr.slice(0, 2);

  if (truncatedFractional === '00') {
    return integerPart.toString();
  }

  return `${integerPart}.${truncatedFractional}`;
}

/**
 * Fetch all funds wallet data (balances + prices)
 * Caches result for 60 seconds
 */
export async function getFundsWalletData(): Promise<FundsWalletData | null> {
  const config = getConfig();

  // Check if funds wallet is configured
  if (!config.fundsWallet || !config.fundsWalletTokens || config.fundsWalletTokens.length === 0) {
    return null;
  }

  // Return cached data if still valid
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData;
  }

  const { fundsWallet, fundsWalletTokens } = config;

  try {
    // Fetch all token balances in parallel
    const balancePromises = fundsWalletTokens.map((token) =>
      fetchTokenBalance(
        fundsWallet.address as Address,
        token.address as Address,
        fundsWallet.chainId
      )
    );

    // Fetch all prices
    const coingeckoIds = fundsWalletTokens.map((t) => t.coingeckoId);
    const [balances, prices] = await Promise.all([
      Promise.all(balancePromises),
      fetchTokenPrices(coingeckoIds),
    ]);

    // Build token data array
    const tokens: FundsWalletTokenData[] = fundsWalletTokens.map((token, i) => {
      const balance = balances[i];
      const formattedBalance = formatBalance(balance, token.decimals);
      const usdPrice = prices[token.coingeckoId] || 0;

      // Calculate USD value
      // Convert balance to number (may lose precision for very large balances)
      const balanceNum = Number(balance) / Math.pow(10, token.decimals);
      const usdValue = balanceNum * usdPrice;

      return {
        symbol: token.symbol,
        balance: formattedBalance,
        balanceRaw: balance.toString(),
        usdPrice,
        usdValue,
      };
    });

    // Calculate total USD value
    const totalUsdValue = tokens.reduce((sum, t) => sum + t.usdValue, 0);

    const data: FundsWalletData = {
      tokens,
      totalUsdValue,
      lastUpdated: now,
    };

    // Update cache
    cachedData = data;
    cacheTimestamp = now;

    return data;
  } catch (error) {
    console.error('Failed to fetch funds wallet data:', error);

    // Return cached data if available (even if stale)
    if (cachedData) {
      return cachedData;
    }

    return null;
  }
}

/**
 * Clear the funds wallet cache (useful for testing or forcing refresh)
 */
export function clearFundsWalletCache(): void {
  cachedData = null;
  cacheTimestamp = 0;
}

/**
 * Calculate delegator's share value based on their reward percentage
 */
export function calculateDelegatorShareValue(
  rewardPercentage: number,
  fundsWalletData: FundsWalletData
): {
  totalUsdValue: number;
  tokenBreakdown: Array<{ symbol: string; amount: string }>;
} {
  const shareRatio = rewardPercentage / 100;

  const tokenBreakdown = fundsWalletData.tokens.map((token) => {
    // Parse the balance and multiply by share ratio
    const fullBalance = Number(token.balanceRaw) / Math.pow(10, getTokenDecimals(token.symbol));
    const shareAmount = fullBalance * shareRatio;

    // Format based on token type (stablecoins get 2 decimals, others get more precision)
    const decimals = token.symbol === 'USDC' || token.symbol === 'USDT' || token.symbol === 'DAI' ? 2 : 2;
    const formattedAmount = shareAmount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });

    return {
      symbol: token.symbol,
      amount: formattedAmount,
    };
  });

  return {
    totalUsdValue: fundsWalletData.totalUsdValue * shareRatio,
    tokenBreakdown,
  };
}

/**
 * Helper to get token decimals by symbol
 */
function getTokenDecimals(symbol: string): number {
  const config = getConfig();
  const token = config.fundsWalletTokens?.find((t) => t.symbol === symbol);
  return token?.decimals || 18;
}
