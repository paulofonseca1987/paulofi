import { put, head, del } from '@vercel/blob';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type {
  VotingPowerData,
  MetadataSchema,
  CurrentStateSchema,
  TimelineEntry,
  TimelineIndex,
  TimelinePartition,
  TimelinePartitionInfo,
  SyncLock,
  SyncProgress
} from './types';

const PARTITION_SIZE = 1000;
const LEGACY_BLOB_NAME = 'voting-power-data.json';
const LOCAL_DATA_DIR = join(process.cwd(), 'data');

// Check if we should use local storage (development mode)
const USE_LOCAL_STORAGE = !process.env.BLOB_READ_WRITE_TOKEN;

// Cache storage with TTL
const cache = new Map<string, { data: any; expiresAt: number }>();

// Ensure data directory exists for local storage
if (USE_LOCAL_STORAGE && typeof window === 'undefined') {
  console.log('📁 Using LOCAL FILE STORAGE for development (data/ directory)');
  try {
    if (!existsSync(LOCAL_DATA_DIR)) {
      mkdirSync(LOCAL_DATA_DIR, { recursive: true });
      console.log('✓ Created data directory:', LOCAL_DATA_DIR);
    }
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
} else if (!USE_LOCAL_STORAGE && typeof window === 'undefined') {
  console.log('☁️  Using VERCEL BLOB STORAGE for production');
}

/**
 * Get data from cache
 */
function getCachedData<T>(key: string): T | null {
  const cached = cache.get(key);
  if (!cached || Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }
  return cached.data as T;
}

/**
 * Set data in cache with TTL
 */
function setCachedData<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Safe storage read (local file or blob)
 */
async function safeGetBlob(blobName: string): Promise<string | null> {
  if (USE_LOCAL_STORAGE) {
    // Use local file storage
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
    // Use Vercel Blob storage
    try {
      const blob = await head(blobName);
      if (!blob || !blob.url) return null;

      // Fetch the blob content from the URL
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
 * Safe storage write (local file or blob)
 */
async function safePutBlob(blobName: string, data: string): Promise<boolean> {
  if (USE_LOCAL_STORAGE) {
    // Use local file storage
    try {
      const filePath = join(LOCAL_DATA_DIR, blobName);
      writeFileSync(filePath, data, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Error writing local file ${blobName}:`, error);
      throw error;
    }
  } else {
    // Use Vercel Blob storage
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
// LOCK MANAGEMENT
// ============================================================================

const LOCK_BLOB_NAME = 'data-sync-lock.json';
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PROGRESS_BLOB_NAME = 'data-sync-progress.json';

/**
 * Check if sync lock exists and is valid
 */
export async function checkSyncLock(): Promise<SyncLock | null> {
  const lockData = await safeGetBlob(LOCK_BLOB_NAME);
  if (!lockData) return null;

  try {
    const lock: SyncLock = JSON.parse(lockData);
    const now = Date.now();

    // Check if lock is stale
    if (now - lock.startedAt > LOCK_TIMEOUT_MS) {
      console.warn('Stale lock detected, releasing...');
      await releaseSyncLock();
      return null;
    }

    return lock;
  } catch (error) {
    console.error('Error parsing lock file:', error);
    return null;
  }
}

/**
 * Acquire sync lock
 */
export async function acquireSyncLock(): Promise<boolean> {
  const existingLock = await checkSyncLock();
  if (existingLock) {
    console.log('Sync already in progress');
    return false;
  }

  const lock: SyncLock = {
    syncInProgress: true,
    startedAt: Date.now(),
    pid: process.pid.toString()
  };

  await safePutBlob(LOCK_BLOB_NAME, JSON.stringify(lock));
  return true;
}

/**
 * Release sync lock
 */
export async function releaseSyncLock(): Promise<void> {
  if (USE_LOCAL_STORAGE) {
    // Use local file storage
    try {
      const filePath = join(LOCAL_DATA_DIR, LOCK_BLOB_NAME);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Error releasing lock:', error);
    }
  } else {
    // Use Vercel Blob storage
    try {
      await del(LOCK_BLOB_NAME);
    } catch (error: any) {
      // Ignore 404 errors
      if (error.status !== 404 && error.statusCode !== 404) {
        console.error('Error releasing lock:', error);
      }
    }
  }
}

// ============================================================================
// METADATA STORAGE
// ============================================================================

const METADATA_BLOB_NAME = 'data-metadata.json';
const METADATA_CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Store metadata
 */
export async function storeMetadata(data: MetadataSchema): Promise<void> {
  await safePutBlob(METADATA_BLOB_NAME, JSON.stringify(data, null, 2));
  setCachedData(METADATA_BLOB_NAME, data, METADATA_CACHE_TTL);
}

/**
 * Get metadata with caching
 */
export async function getMetadata(): Promise<MetadataSchema | null> {
  // Check cache first
  const cached = getCachedData<MetadataSchema>(METADATA_BLOB_NAME);
  if (cached) return cached;

  const data = await safeGetBlob(METADATA_BLOB_NAME);
  if (!data) return null;

  try {
    const metadata: MetadataSchema = JSON.parse(data);
    setCachedData(METADATA_BLOB_NAME, metadata, METADATA_CACHE_TTL);
    return metadata;
  } catch (error) {
    console.error('Error parsing metadata:', error);
    return null;
  }
}

// ============================================================================
// CURRENT STATE STORAGE
// ============================================================================

const CURRENT_STATE_BLOB_NAME = 'data-current-state.json';
const CURRENT_STATE_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Store current state
 */
export async function storeCurrentState(data: CurrentStateSchema): Promise<void> {
  await safePutBlob(CURRENT_STATE_BLOB_NAME, JSON.stringify(data, null, 2));
  setCachedData(CURRENT_STATE_BLOB_NAME, data, CURRENT_STATE_CACHE_TTL);
}

/**
 * Get current state with caching
 */
export async function getCurrentState(): Promise<CurrentStateSchema | null> {
  // Check cache first
  const cached = getCachedData<CurrentStateSchema>(CURRENT_STATE_BLOB_NAME);
  if (cached) return cached;

  const data = await safeGetBlob(CURRENT_STATE_BLOB_NAME);
  if (!data) return null;

  try {
    const currentState: CurrentStateSchema = JSON.parse(data);
    setCachedData(CURRENT_STATE_BLOB_NAME, currentState, CURRENT_STATE_CACHE_TTL);
    return currentState;
  } catch (error) {
    console.error('Error parsing current state:', error);
    return null;
  }
}

// ============================================================================
// TIMELINE STORAGE
// ============================================================================

const TIMELINE_INDEX_BLOB_NAME = 'data-timeline-index.json';
const TIMELINE_INDEX_CACHE_TTL = 60 * 1000; // 60 seconds
const TIMELINE_PARTITION_CACHE_TTL = 300 * 1000; // 300 seconds

/**
 * Store timeline index
 */
async function storeTimelineIndex(index: TimelineIndex): Promise<void> {
  await safePutBlob(TIMELINE_INDEX_BLOB_NAME, JSON.stringify(index, null, 2));
  setCachedData(TIMELINE_INDEX_BLOB_NAME, index, TIMELINE_INDEX_CACHE_TTL);
}

/**
 * Get timeline index with caching
 */
async function getTimelineIndex(): Promise<TimelineIndex | null> {
  // Check cache first
  const cached = getCachedData<TimelineIndex>(TIMELINE_INDEX_BLOB_NAME);
  if (cached) return cached;

  const data = await safeGetBlob(TIMELINE_INDEX_BLOB_NAME);
  if (!data) return null;

  try {
    const index: TimelineIndex = JSON.parse(data);
    setCachedData(TIMELINE_INDEX_BLOB_NAME, index, TIMELINE_INDEX_CACHE_TTL);
    return index;
  } catch (error) {
    console.error('Error parsing timeline index:', error);
    return null;
  }
}

/**
 * Store timeline partition
 */
async function storeTimelinePartition(partitionId: number, partition: TimelinePartition): Promise<void> {
  const blobName = `data-timeline-entries-${partitionId}.json`;
  await safePutBlob(blobName, JSON.stringify(partition, null, 2));
  setCachedData(blobName, partition, TIMELINE_PARTITION_CACHE_TTL);
}

/**
 * Get timeline partition with caching
 */
export async function getTimelinePartition(partitionId: number): Promise<TimelinePartition | null> {
  const blobName = `data-timeline-entries-${partitionId}.json`;

  // Check cache first
  const cached = getCachedData<TimelinePartition>(blobName);
  if (cached) return cached;

  const data = await safeGetBlob(blobName);
  if (!data) return null;

  try {
    const partition: TimelinePartition = JSON.parse(data);
    setCachedData(blobName, partition, TIMELINE_PARTITION_CACHE_TTL);
    return partition;
  } catch (error) {
    console.error(`Error parsing partition ${partitionId}:`, error);
    return null;
  }
}

/**
 * Append timeline entries, creating new partitions as needed
 */
export async function appendTimelineEntries(newEntries: TimelineEntry[]): Promise<void> {
  if (newEntries.length === 0) return;

  let index = await getTimelineIndex();

  // Initialize index if it doesn't exist
  if (!index) {
    index = {
      totalEntries: 0,
      partitionSize: PARTITION_SIZE,
      partitions: []
    };
  }

  let entriesToAdd = [...newEntries];

  // If no partitions exist, create the first one
  if (index.partitions.length === 0) {
    index.partitions.push({
      id: 0,
      startBlock: entriesToAdd[0].blockNumber,
      endBlock: entriesToAdd[0].blockNumber,
      entryCount: 0,
      fileName: 'data-timeline-entries-0.json'
    });
  }

  // Process entries
  while (entriesToAdd.length > 0) {
    const lastPartition = index.partitions[index.partitions.length - 1];
    const currentPartitionId = lastPartition.id;

    // Load existing partition
    let partition = await getTimelinePartition(currentPartitionId);
    if (!partition) {
      partition = {
        partitionId: currentPartitionId,
        entries: []
      };
    }

    // Calculate space available in current partition
    const spaceInPartition = PARTITION_SIZE - partition.entries.length;
    const batch = entriesToAdd.splice(0, spaceInPartition);

    // Append entries to partition
    partition.entries.push(...batch);
    await storeTimelinePartition(currentPartitionId, partition);

    // Update partition info
    lastPartition.entryCount = partition.entries.length;
    lastPartition.endBlock = partition.entries[partition.entries.length - 1].blockNumber;
    if (partition.entries.length === 1) {
      lastPartition.startBlock = partition.entries[0].blockNumber;
    }

    // If partition is full and more entries remain, create new partition
    if (partition.entries.length >= PARTITION_SIZE && entriesToAdd.length > 0) {
      const newPartitionId = currentPartitionId + 1;
      index.partitions.push({
        id: newPartitionId,
        startBlock: entriesToAdd[0].blockNumber,
        endBlock: entriesToAdd[0].blockNumber,
        entryCount: 0,
        fileName: `data-timeline-entries-${newPartitionId}.json`
      });
    }
  }

  // Update total entries count
  index.totalEntries = index.partitions.reduce((sum, p) => sum + p.entryCount, 0);

  // Store updated index
  await storeTimelineIndex(index);
}

/**
 * Get full timeline (all partitions)
 */
export async function getFullTimeline(): Promise<TimelineEntry[]> {
  const index = await getTimelineIndex();
  if (!index || index.partitions.length === 0) return [];

  const allEntries: TimelineEntry[] = [];

  for (const partitionInfo of index.partitions) {
    const partition = await getTimelinePartition(partitionInfo.id);
    if (partition) {
      allEntries.push(...partition.entries);
    }
  }

  return allEntries;
}

/**
 * Get timeline range by block numbers
 */
export async function getTimelineRange(fromBlock: number, toBlock: number): Promise<TimelineEntry[]> {
  const index = await getTimelineIndex();
  if (!index || index.partitions.length === 0) return [];

  const entries: TimelineEntry[] = [];

  // Find relevant partitions
  const relevantPartitions = index.partitions.filter(p =>
    p.endBlock >= fromBlock && p.startBlock <= toBlock
  );

  for (const partitionInfo of relevantPartitions) {
    const partition = await getTimelinePartition(partitionInfo.id);
    if (partition) {
      const filtered = partition.entries.filter(e =>
        e.blockNumber >= fromBlock && e.blockNumber <= toBlock
      );
      entries.push(...filtered);
    }
  }

  return entries;
}

// ============================================================================
// MIGRATION FROM LEGACY BLOB
// ============================================================================

/**
 * Get legacy voting power data
 */
async function getLegacyBlob(): Promise<VotingPowerData | null> {
  const data = await safeGetBlob(LEGACY_BLOB_NAME);
  if (!data) return null;

  try {
    return JSON.parse(data) as VotingPowerData;
  } catch (error) {
    console.error('Error parsing legacy blob:', error);
    return null;
  }
}

/**
 * Calculate total voting power from delegators
 */
function calculateTotalVotingPower(delegators: Record<string, string>): string {
  let total = BigInt(0);
  for (const balance of Object.values(delegators)) {
    total += BigInt(balance);
  }
  return total.toString();
}

/**
 * Migrate from legacy blob to new multi-file structure
 */
export async function migrateFromLegacyBlob(): Promise<boolean> {
  console.log('Checking for migration...');

  // Check if already migrated
  const metadata = await getMetadata();
  if (metadata) {
    console.log('Already migrated to new structure');
    return true;
  }

  // Check for legacy blob
  const legacyData = await getLegacyBlob();
  if (!legacyData) {
    console.log('No legacy data found, will initialize fresh on first sync');
    return false;
  }

  console.log('Legacy data found, starting migration...');

  try {
    // Create metadata
    const newMetadata: MetadataSchema = {
      lastSyncedBlock: legacyData.lastSyncedBlock,
      lastSyncTimestamp: Date.now(),
      totalVotingPower: calculateTotalVotingPower(legacyData.currentDelegators),
      totalDelegators: Object.keys(legacyData.currentDelegators).length,
      totalTimelineEntries: legacyData.timeline.length,
      timelinePartitions: Math.ceil(legacyData.timeline.length / PARTITION_SIZE)
    };

    // Create current state
    const currentState: CurrentStateSchema = {
      asOfBlock: legacyData.lastSyncedBlock,
      asOfTimestamp: Date.now(),
      delegators: legacyData.currentDelegators
    };

    // Store metadata and current state
    await storeMetadata(newMetadata);
    await storeCurrentState(currentState);

    // Migrate timeline with partitioning
    if (legacyData.timeline.length > 0) {
      await appendTimelineEntries(legacyData.timeline);
    }

    console.log('Migration completed successfully!');
    console.log(`- Migrated ${legacyData.timeline.length} timeline entries`);
    console.log(`- Created ${Math.ceil(legacyData.timeline.length / PARTITION_SIZE)} partition(s)`);
    console.log(`- Preserved ${Object.keys(legacyData.currentDelegators).length} delegators`);

    return true;
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

/**
 * Store voting power data (legacy format)
 * Now stores data in new multi-file structure
 */
export async function storeVotingPowerData(data: VotingPowerData): Promise<void> {
  // Store in new format
  const metadata: MetadataSchema = {
    lastSyncedBlock: data.lastSyncedBlock,
    lastSyncTimestamp: Date.now(),
    totalVotingPower: calculateTotalVotingPower(data.currentDelegators),
    totalDelegators: Object.keys(data.currentDelegators).length,
    totalTimelineEntries: data.timeline.length,
    timelinePartitions: Math.ceil(data.timeline.length / PARTITION_SIZE)
  };

  const currentState: CurrentStateSchema = {
    asOfBlock: data.lastSyncedBlock,
    asOfTimestamp: Date.now(),
    delegators: data.currentDelegators
  };

  await storeMetadata(metadata);
  await storeCurrentState(currentState);

  // Clear existing timeline and recreate
  await appendTimelineEntries(data.timeline);
}

/**
 * Get voting power data (legacy format)
 * Reads from new multi-file structure and converts to legacy format
 */
export async function getVotingPowerData(): Promise<VotingPowerData | null> {
  // Try to read from new structure first
  const metadata = await getMetadata();

  // If new structure doesn't exist, try migration
  if (!metadata) {
    const migrated = await migrateFromLegacyBlob();
    if (!migrated) {
      return null;
    }
    // Try reading again after migration
    return await getVotingPowerData();
  }

  const currentState = await getCurrentState();
  const timeline = await getFullTimeline();

  if (!currentState) return null;

  return {
    lastSyncedBlock: metadata.lastSyncedBlock,
    timeline,
    currentDelegators: currentState.delegators
  };
}

// ============================================================================
// SYNC PROGRESS TRACKING
// ============================================================================

/**
 * Update sync progress
 */
export async function updateSyncProgress(progress: SyncProgress): Promise<void> {
  await safePutBlob(PROGRESS_BLOB_NAME, JSON.stringify(progress));
}

/**
 * Get sync progress
 */
export async function getSyncProgress(): Promise<SyncProgress | null> {
  const data = await safeGetBlob(PROGRESS_BLOB_NAME);
  if (!data) return null;

  try {
    return JSON.parse(data) as SyncProgress;
  } catch (error) {
    console.error('Error parsing sync progress:', error);
    return null;
  }
}

/**
 * Clear sync progress
 */
export async function clearSyncProgress(): Promise<void> {
  if (USE_LOCAL_STORAGE) {
    try {
      const filePath = join(LOCAL_DATA_DIR, PROGRESS_BLOB_NAME);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Error clearing sync progress:', error);
    }
  } else {
    try {
      await del(PROGRESS_BLOB_NAME);
    } catch (error: any) {
      // Ignore 404 errors
      if (error.status !== 404 && error.statusCode !== 404) {
        console.error('Error clearing sync progress:', error);
      }
    }
  }
}
