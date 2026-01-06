import { readFileSync } from 'fs';
import { join } from 'path';
import {
  arbitrum,
  mainnet,
  optimism,
  polygon,
  base,
  avalanche,
  bsc,
  gnosis,
} from 'viem/chains';
import type { Chain, PublicClient } from 'viem';
import type { Config } from './types';

// Chain registry mapping names to viem chain objects
const chainRegistry: Record<string, Chain> = {
  arbitrum,
  mainnet,
  optimism,
  polygon,
  base,
  avalanche,
  bsc,
  gnosis,
};

let cachedConfig: Config | null = null;

/**
 * Load and cache config.json
 */
export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = join(process.cwd(), 'config.json');
  const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as Config;

  // Validate config
  validateConfig(rawConfig);

  cachedConfig = rawConfig;
  return rawConfig;
}

/**
 * Clear the config cache (useful for testing or hot reloading)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get viem chain object from chainName in config
 */
export function getChain(): Chain {
  const config = getConfig();
  const chain = chainRegistry[config.chainName];
  if (!chain) {
    throw new Error(
      `Unsupported chain: ${config.chainName}. Supported chains: ${Object.keys(chainRegistry).join(', ')}`
    );
  }
  return chain;
}

/**
 * Get L1 chain object for timestamp conversions (e.g., mainnet for Arbitrum)
 */
export function getL1Chain(): Chain | null {
  const config = getConfig();
  if (!config.l1ChainName) return null;
  const chain = chainRegistry[config.l1ChainName];
  if (!chain) {
    throw new Error(
      `Unsupported L1 chain: ${config.l1ChainName}. Supported chains: ${Object.keys(chainRegistry).join(', ')}`
    );
  }
  return chain;
}

/**
 * Resolve endBlock - returns the actual block number
 * If endBlock is "latest", fetches current block from the client
 */
export async function resolveEndBlock(client: PublicClient): Promise<bigint> {
  const config = getConfig();
  if (config.endBlock === 'latest') {
    return await client.getBlockNumber();
  }
  return BigInt(config.endBlock);
}

/**
 * Get the start block from config
 */
export function getStartBlock(): bigint {
  const config = getConfig();
  return BigInt(config.startBlock);
}

/**
 * Validate config has all required fields and correct formats
 */
function validateConfig(config: Config): void {
  // Address format validation (0x prefix, 42 chars)
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;

  // Required fields validation
  if (!config.delegateAddress) {
    throw new Error('Config validation error: delegateAddress is required');
  }
  if (!config.tokenAddress) {
    throw new Error('Config validation error: tokenAddress is required');
  }
  if (!config.chainId) {
    throw new Error('Config validation error: chainId is required');
  }
  if (!config.chainName) {
    throw new Error('Config validation error: chainName is required');
  }
  if (config.startBlock === undefined || config.startBlock === null) {
    throw new Error('Config validation error: startBlock is required');
  }

  // Address format validation
  if (!addressRegex.test(config.delegateAddress)) {
    throw new Error('Config validation error: delegateAddress must be a valid Ethereum address');
  }
  if (!addressRegex.test(config.tokenAddress)) {
    throw new Error('Config validation error: tokenAddress must be a valid Ethereum address');
  }

  // Chain validation
  if (!chainRegistry[config.chainName]) {
    throw new Error(
      `Config validation error: chainName must be one of: ${Object.keys(chainRegistry).join(', ')}`
    );
  }

  // Block number validation
  if (typeof config.startBlock !== 'number' || config.startBlock < 0) {
    throw new Error('Config validation error: startBlock must be a non-negative number');
  }

  // endBlock can be number or "latest"
  if (config.endBlock !== undefined && config.endBlock !== 'latest') {
    if (typeof config.endBlock !== 'number' || config.endBlock < 0) {
      throw new Error('Config validation error: endBlock must be a non-negative number or "latest"');
    }
  }

  // Optional governor address validation
  if (config.governors) {
    if (config.governors.core && !addressRegex.test(config.governors.core)) {
      throw new Error('Config validation error: governors.core must be a valid Ethereum address');
    }
    if (config.governors.treasury && !addressRegex.test(config.governors.treasury)) {
      throw new Error('Config validation error: governors.treasury must be a valid Ethereum address');
    }
  }

  // Optional fundsWallet validation
  if (config.fundsWallet) {
    if (!addressRegex.test(config.fundsWallet.address)) {
      throw new Error('Config validation error: fundsWallet.address must be a valid Ethereum address');
    }
    if (!config.fundsWallet.chainPrefix || typeof config.fundsWallet.chainPrefix !== 'string') {
      throw new Error('Config validation error: fundsWallet.chainPrefix is required');
    }
    if (!config.fundsWallet.chainId || typeof config.fundsWallet.chainId !== 'number') {
      throw new Error('Config validation error: fundsWallet.chainId must be a number');
    }
  }

  // Optional fundsWalletTokens validation
  if (config.fundsWalletTokens) {
    if (!Array.isArray(config.fundsWalletTokens)) {
      throw new Error('Config validation error: fundsWalletTokens must be an array');
    }
    for (const token of config.fundsWalletTokens) {
      if (!addressRegex.test(token.address)) {
        throw new Error(`Config validation error: fundsWalletTokens token address ${token.address} is invalid`);
      }
      if (!token.symbol || typeof token.symbol !== 'string') {
        throw new Error('Config validation error: fundsWalletTokens token symbol is required');
      }
      if (typeof token.decimals !== 'number' || token.decimals < 0) {
        throw new Error('Config validation error: fundsWalletTokens token decimals must be a non-negative number');
      }
      if (!token.coingeckoId || typeof token.coingeckoId !== 'string') {
        throw new Error('Config validation error: fundsWalletTokens token coingeckoId is required');
      }
    }
  }
}
