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

// Cache storage with TTL
const cache = new Map<string, { data: any; expiresAt: number }>();

// Ensure data directory exists
if (typeof window === 'undefined') {
  console.log('📁 Using LOCAL FILE STORAGE (data/ directory)');
  try {
    if (!existsSync(LOCAL_DATA_DIR)) {
      mkdirSync(LOCAL_DATA_DIR, { recursive: true });
      console.log('✓ Created data directory:', LOCAL_DATA_DIR);
    }
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
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

/**
 * Delete local file
 */
function deleteLocalFile(fileName: string): boolean {
  try {
    const filePath = join(LOCAL_DATA_DIR, fileName);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    console.error(`Error deleting local file ${fileName}:`, error);
    return false;
  }
}

// ============================================================================
// LOCK MANAGEMENT
// ============================================================================

const LOCK_FILE_NAME = 'data-sync-lock.json';
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PROGRESS_FILE_NAME = 'data-sync-progress.json';

/**
 * Check if sync lock exists and is valid
 */
export async function checkSyncLock(): Promise<SyncLock | null> {
  const lockData = readLocalFile(LOCK_FILE_NAME);
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

  writeLocalFile(LOCK_FILE_NAME, JSON.stringify(lock));
  return true;
}

/**
 * Release sync lock
 */
export async function releaseSyncLock(): Promise<void> {
  try {
    deleteLocalFile(LOCK_FILE_NAME);
  } catch (error) {
    console.error('Error releasing lock:', error);
  }
}

// ============================================================================
// METADATA STORAGE
// ============================================================================

const METADATA_FILE_NAME = 'data-metadata.json';
const METADATA_CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Store metadata
 */
export async function storeMetadata(data: MetadataSchema): Promise<void> {
  writeLocalFile(METADATA_FILE_NAME, JSON.stringify(data, null, 2));
  setCachedData(METADATA_FILE_NAME, data, METADATA_CACHE_TTL);
}

/**
 * Get metadata with caching
 */
export async function getMetadata(): Promise<MetadataSchema | null> {
  // Check cache first
  const cached = getCachedData<MetadataSchema>(METADATA_FILE_NAME);
  if (cached) return cached;

  const data = readLocalFile(METADATA_FILE_NAME);
  if (!data) return null;

  try {
    const metadata: MetadataSchema = JSON.parse(data);
    setCachedData(METADATA_FILE_NAME, metadata, METADATA_CACHE_TTL);
    return metadata;
  } catch (error) {
    console.error('Error parsing metadata:', error);
    return null;
  }
}

// ============================================================================
// CURRENT STATE STORAGE
// ============================================================================

const CURRENT_STATE_FILE_NAME = 'data-current-state.json';
const CURRENT_STATE_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Store current state
 */
export async function storeCurrentState(data: CurrentStateSchema): Promise<void> {
  writeLocalFile(CURRENT_STATE_FILE_NAME, JSON.stringify(data, null, 2));
  setCachedData(CURRENT_STATE_FILE_NAME, data, CURRENT_STATE_CACHE_TTL);
}

/**
 * Get current state with caching
 */
export async function getCurrentState(): Promise<CurrentStateSchema | null> {
  // Check cache first
  const cached = getCachedData<CurrentStateSchema>(CURRENT_STATE_FILE_NAME);
  if (cached) return cached;

  const data = readLocalFile(CURRENT_STATE_FILE_NAME);
  if (!data) return null;

  try {
    const currentState: CurrentStateSchema = JSON.parse(data);
    setCachedData(CURRENT_STATE_FILE_NAME, currentState, CURRENT_STATE_CACHE_TTL);
    return currentState;
  } catch (error) {
    console.error('Error parsing current state:', error);
    return null;
  }
}

// ============================================================================
// TIMELINE STORAGE
// ============================================================================

const TIMELINE_INDEX_FILE_NAME = 'data-timeline-index.json';
const TIMELINE_INDEX_CACHE_TTL = 60 * 1000; // 60 seconds
const TIMELINE_PARTITION_CACHE_TTL = 300 * 1000; // 300 seconds

/**
 * Store timeline index
 */
async function storeTimelineIndex(index: TimelineIndex): Promise<void> {
  writeLocalFile(TIMELINE_INDEX_FILE_NAME, JSON.stringify(index, null, 2));
  setCachedData(TIMELINE_INDEX_FILE_NAME, index, TIMELINE_INDEX_CACHE_TTL);
}

/**
 * Get timeline index with caching
 */
async function getTimelineIndex(): Promise<TimelineIndex | null> {
  // Check cache first
  const cached = getCachedData<TimelineIndex>(TIMELINE_INDEX_FILE_NAME);
  if (cached) return cached;

  const data = readLocalFile(TIMELINE_INDEX_FILE_NAME);
  if (!data) return null;

  try {
    const index: TimelineIndex = JSON.parse(data);
    setCachedData(TIMELINE_INDEX_FILE_NAME, index, TIMELINE_INDEX_CACHE_TTL);
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
  const fileName = `data-timeline-entries-${partitionId}.json`;
  writeLocalFile(fileName, JSON.stringify(partition, null, 2));
  setCachedData(fileName, partition, TIMELINE_PARTITION_CACHE_TTL);
}

/**
 * Get timeline partition with caching
 */
export async function getTimelinePartition(partitionId: number): Promise<TimelinePartition | null> {
  const fileName = `data-timeline-entries-${partitionId}.json`;

  // Check cache first
  const cached = getCachedData<TimelinePartition>(fileName);
  if (cached) return cached;

  const data = readLocalFile(fileName);
  if (!data) return null;

  try {
    const partition: TimelinePartition = JSON.parse(data);
    setCachedData(fileName, partition, TIMELINE_PARTITION_CACHE_TTL);
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
// MIGRATION FROM LEGACY FILE
// ============================================================================

/**
 * Get legacy voting power data
 */
async function getLegacyData(): Promise<VotingPowerData | null> {
  const data = readLocalFile(LEGACY_BLOB_NAME);
  if (!data) return null;

  try {
    return JSON.parse(data) as VotingPowerData;
  } catch (error) {
    console.error('Error parsing legacy data:', error);
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
 * Migrate from legacy file to new multi-file structure
 */
export async function migrateFromLegacyBlob(): Promise<boolean> {
  console.log('Checking for migration...');

  // Check if already migrated
  const metadata = await getMetadata();
  if (metadata) {
    console.log('Already migrated to new structure');
    return true;
  }

  // Check for legacy data
  const legacyData = await getLegacyData();
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
  writeLocalFile(PROGRESS_FILE_NAME, JSON.stringify(progress));
}

/**
 * Get sync progress
 */
export async function getSyncProgress(): Promise<SyncProgress | null> {
  const data = readLocalFile(PROGRESS_FILE_NAME);
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
  try {
    deleteLocalFile(PROGRESS_FILE_NAME);
  } catch (error) {
    console.error('Error clearing sync progress:', error);
  }
}

// ============================================================================
// TIMELINE TRUNCATION
// ============================================================================

/**
 * Truncate timeline data after a specific block number
 * Removes all entries with blockNumber > maxBlock
 */
export async function truncateTimelineAfterBlock(maxBlock: number): Promise<{
  success: boolean;
  entriesRemoved: number;
  partitionsRemoved: number;
  lastBlockNumber: number;
}> {
  console.log(`[Truncate] Truncating timeline data after block ${maxBlock}...`);

  const index = await getTimelineIndex();
  if (!index || index.partitions.length === 0) {
    return { success: true, entriesRemoved: 0, partitionsRemoved: 0, lastBlockNumber: 0 };
  }

  const originalEntryCount = index.totalEntries;
  let entriesRemoved = 0;
  let partitionsRemoved = 0;
  let lastBlockNumber = 0;

  // Find partitions to keep (those that have entries <= maxBlock)
  const partitionsToKeep: TimelinePartitionInfo[] = [];
  const partitionsToDelete: TimelinePartitionInfo[] = [];

  for (const partition of index.partitions) {
    if (partition.startBlock > maxBlock) {
      // Entire partition is after maxBlock, delete it
      partitionsToDelete.push(partition);
    } else {
      partitionsToKeep.push(partition);
    }
  }

  // Process the last partition that we're keeping (may need trimming)
  if (partitionsToKeep.length > 0) {
    const lastPartition = partitionsToKeep[partitionsToKeep.length - 1];

    if (lastPartition.endBlock > maxBlock) {
      // Need to trim entries from this partition
      const partition = await getTimelinePartition(lastPartition.id);
      if (partition) {
        const originalLength = partition.entries.length;
        partition.entries = partition.entries.filter(e => e.blockNumber <= maxBlock);
        const trimmedCount = originalLength - partition.entries.length;
        entriesRemoved += trimmedCount;

        if (partition.entries.length > 0) {
          // Update partition with trimmed entries
          await storeTimelinePartition(lastPartition.id, partition);
          lastPartition.entryCount = partition.entries.length;
          lastPartition.endBlock = partition.entries[partition.entries.length - 1].blockNumber;
          lastBlockNumber = lastPartition.endBlock;
        } else {
          // Partition is now empty, delete it
          partitionsToDelete.push(lastPartition);
          partitionsToKeep.pop();
        }
      }
    } else {
      lastBlockNumber = lastPartition.endBlock;
    }
  }

  // Delete orphaned partitions
  for (const partition of partitionsToDelete) {
    const fileName = `data-timeline-entries-${partition.id}.json`;
    deleteLocalFile(fileName);
    entriesRemoved += partition.entryCount;
    partitionsRemoved++;
    console.log(`[Truncate] Deleted partition ${partition.id} (${partition.entryCount} entries)`);
  }

  // Update index
  index.partitions = partitionsToKeep;
  index.totalEntries = index.partitions.reduce((sum, p) => sum + p.entryCount, 0);
  await storeTimelineIndex(index);

  // Update metadata
  const metadata = await getMetadata();
  if (metadata) {
    metadata.lastSyncedBlock = maxBlock;
    metadata.totalTimelineEntries = index.totalEntries;
    metadata.timelinePartitions = index.partitions.length;
    await storeMetadata(metadata);
  }

  // Update current state
  const currentState = await getCurrentState();
  if (currentState) {
    currentState.asOfBlock = maxBlock;
    await storeCurrentState(currentState);
  }

  // Clear cache
  clearCache();

  console.log(`[Truncate] Complete:`);
  console.log(`  - Entries removed: ${entriesRemoved}`);
  console.log(`  - Partitions removed: ${partitionsRemoved}`);
  console.log(`  - New total entries: ${index.totalEntries}`);
  console.log(`  - Last block number: ${lastBlockNumber}`);

  return {
    success: true,
    entriesRemoved,
    partitionsRemoved,
    lastBlockNumber
  };
}
