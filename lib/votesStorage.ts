/**
 * Storage layer for vote data
 * Follows the same pattern as storage.ts
 */

import { put, head } from '@vercel/blob';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { VoteEntry, VotesMetadata, VotesData } from './types';

const LOCAL_DATA_DIR = join(process.cwd(), 'data');
const USE_LOCAL_STORAGE = !process.env.BLOB_READ_WRITE_TOKEN;

const VOTES_METADATA_BLOB = 'data-votes-metadata.json';
const VOTES_DATA_BLOB = 'data-votes.json';

// Cache storage with TTL
const votesCache = new Map<string, { data: any; expiresAt: number }>();

// Ensure data directory exists
if (USE_LOCAL_STORAGE && typeof window === 'undefined') {
  try {
    if (!existsSync(LOCAL_DATA_DIR)) {
      mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
}

/**
 * Get cached data
 */
function getCachedData<T>(key: string): T | null {
  const cached = votesCache.get(key);
  if (!cached || Date.now() > cached.expiresAt) {
    votesCache.delete(key);
    return null;
  }
  return cached.data as T;
}

/**
 * Set cached data with TTL
 */
function setCachedData<T>(key: string, data: T, ttlMs: number): void {
  votesCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clear votes cache
 */
export function clearVotesCache(): void {
  votesCache.clear();
}

/**
 * Safe storage read
 */
async function safeGetBlob(blobName: string): Promise<string | null> {
  if (USE_LOCAL_STORAGE) {
    try {
      const filePath = join(LOCAL_DATA_DIR, blobName);
      if (!existsSync(filePath)) {
        return null;
      }
      return readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`Error reading local file ${blobName}:`, error);
      return null;
    }
  } else {
    try {
      const blob = await head(blobName);
      if (!blob || !blob.url) return null;

      const response = await fetch(blob.url);
      if (!response.ok) return null;

      return await response.text();
    } catch (error: any) {
      if (error.status === 404 || error.statusCode === 404) {
        return null;
      }
      console.error(`Error reading blob ${blobName}:`, error);
      return null;
    }
  }
}

/**
 * Safe storage write
 */
async function safePutBlob(blobName: string, data: string): Promise<boolean> {
  if (USE_LOCAL_STORAGE) {
    try {
      const filePath = join(LOCAL_DATA_DIR, blobName);
      writeFileSync(filePath, data, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Error writing local file ${blobName}:`, error);
      throw error;
    }
  } else {
    try {
      await put(blobName, data, {
        access: 'public',
        contentType: 'application/json',
      });
      return true;
    } catch (error) {
      console.error(`Error writing blob ${blobName}:`, error);
      throw error;
    }
  }
}

// ============================================================================
// VOTES METADATA
// ============================================================================

/**
 * Get votes metadata
 */
export async function getVotesMetadata(): Promise<VotesMetadata | null> {
  // Check cache first
  const cached = getCachedData<VotesMetadata>('votes-metadata');
  if (cached) return cached;

  const data = await safeGetBlob(VOTES_METADATA_BLOB);
  if (!data) return null;

  try {
    const metadata = JSON.parse(data) as VotesMetadata;
    setCachedData('votes-metadata', metadata, 30000); // 30 second cache
    return metadata;
  } catch (error) {
    console.error('Error parsing votes metadata:', error);
    return null;
  }
}

/**
 * Save votes metadata
 */
export async function saveVotesMetadata(metadata: VotesMetadata): Promise<void> {
  await safePutBlob(VOTES_METADATA_BLOB, JSON.stringify(metadata, null, 2));
  setCachedData('votes-metadata', metadata, 30000);
}

// ============================================================================
// VOTES DATA
// ============================================================================

/**
 * Get all votes
 */
export async function getVotesData(): Promise<VotesData | null> {
  // Check cache first
  const cached = getCachedData<VotesData>('votes-data');
  if (cached) return cached;

  const data = await safeGetBlob(VOTES_DATA_BLOB);
  if (!data) return null;

  try {
    const votesData = JSON.parse(data) as VotesData;
    setCachedData('votes-data', votesData, 60000); // 60 second cache
    return votesData;
  } catch (error) {
    console.error('Error parsing votes data:', error);
    return null;
  }
}

/**
 * Save all votes
 */
export async function saveVotesData(data: VotesData): Promise<void> {
  await safePutBlob(VOTES_DATA_BLOB, JSON.stringify(data, null, 2));
  setCachedData('votes-data', data, 60000);
}

/**
 * Add new votes (merging with existing, avoiding duplicates)
 */
export async function appendVotes(newVotes: VoteEntry[]): Promise<VotesData> {
  const existingData = await getVotesData();
  const existingVotes = existingData?.votes || [];

  // Create a map of existing votes by proposalId + source for deduplication
  const existingMap = new Map<string, VoteEntry>();
  for (const vote of existingVotes) {
    const key = `${vote.proposalId}-${vote.source}`;
    existingMap.set(key, vote);
  }

  // Add or update with new votes
  for (const vote of newVotes) {
    const key = `${vote.proposalId}-${vote.source}`;
    existingMap.set(key, vote);
  }

  // Convert back to array and sort by snapshot timestamp
  const allVotes = Array.from(existingMap.values());
  allVotes.sort((a, b) => a.snapshotTimestamp - b.snapshotTimestamp);

  const updatedData: VotesData = { votes: allVotes };
  await saveVotesData(updatedData);

  // Update metadata
  const metadata: VotesMetadata = {
    lastSyncTimestamp: Date.now(),
    totalVotes: allVotes.length,
    snapshotVotes: allVotes.filter((v) => v.source === 'snapshot').length,
    onchainCoreVotes: allVotes.filter((v) => v.source === 'onchain-core').length,
    onchainTreasuryVotes: allVotes.filter((v) => v.source === 'onchain-treasury').length,
  };
  await saveVotesMetadata(metadata);

  return updatedData;
}

/**
 * Get votes filtered by timestamp range
 */
export async function getVotesInRange(
  fromTimestamp?: number,
  toTimestamp?: number
): Promise<VoteEntry[]> {
  const data = await getVotesData();
  if (!data) return [];

  return data.votes.filter((vote) => {
    if (fromTimestamp && vote.snapshotTimestamp < fromTimestamp) return false;
    if (toTimestamp && vote.snapshotTimestamp > toTimestamp) return false;
    return true;
  });
}
