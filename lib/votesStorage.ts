/**
 * Storage layer for vote data
 * Uses local file storage in data/ directory
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { VoteEntry, VotesMetadata, VotesData } from './types';

const LOCAL_DATA_DIR = join(process.cwd(), 'data');

const VOTES_METADATA_FILE = 'data-votes-metadata.json';
const VOTES_DATA_FILE = 'data-votes.json';

// Cache storage with TTL
const votesCache = new Map<string, { data: any; expiresAt: number }>();

// Ensure data directory exists
if (typeof window === 'undefined') {
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
 * Read data from local file
 */
function readLocalFile(fileName: string): string | null {
  try {
    const filePath = join(LOCAL_DATA_DIR, fileName);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading local file ${fileName}:`, error);
    return null;
  }
}

/**
 * Write data to local file
 */
function writeLocalFile(fileName: string, data: string): boolean {
  try {
    const filePath = join(LOCAL_DATA_DIR, fileName);
    writeFileSync(filePath, data, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Error writing local file ${fileName}:`, error);
    throw error;
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

  const data = readLocalFile(VOTES_METADATA_FILE);
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
  writeLocalFile(VOTES_METADATA_FILE, JSON.stringify(metadata, null, 2));
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

  const data = readLocalFile(VOTES_DATA_FILE);
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
  writeLocalFile(VOTES_DATA_FILE, JSON.stringify(data, null, 2));
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
