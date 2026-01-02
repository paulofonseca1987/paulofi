'use client';

import { useState, useEffect } from 'react';
import TimelineChart from './components/TimelineChart';
import DelegatorsList from './components/DelegatorsList';
import type { MetadataSchema, CurrentStateSchema, TimelineEntry, SyncProgress } from '@/lib/types';

export default function Home() {
  const [metadata, setMetadata] = useState<MetadataSchema | null>(null);
  const [currentState, setCurrentState] = useState<CurrentStateSchema | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load critical data first (metadata + current state) - fast
      const [metadataRes, currentRes] = await Promise.all([
        fetch('/api/data?endpoint=metadata'),
        fetch('/api/data?endpoint=current')
      ]);

      if (!metadataRes.ok || !currentRes.ok) {
        if (metadataRes.status === 404 || currentRes.status === 404) {
          // No data yet, but don't show error if sync is active
          const progressRes = await fetch('/api/sync/progress');
          if (progressRes.ok) {
            const progress = await progressRes.json();
            if (!progress.isActive) {
              setError('No data found. Please sync first.');
            }
          } else {
            setError('No data found. Please sync first.');
          }
          setLoading(false);
          return;
        }
        throw new Error('Failed to fetch data');
      }

      const metadataData = await metadataRes.json();
      const currentStateData = await currentRes.json();

      setMetadata(metadataData);
      setCurrentState(currentStateData);
      setLoading(false);

      // Load timeline in background - slower
      setTimelineLoading(true);
      const timelineRes = await fetch('/api/data?endpoint=timeline');

      if (timelineRes.ok) {
        const timelineData = await timelineRes.json();
        setTimeline(timelineData);
      }
      setTimelineLoading(false);

    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      setLoading(false);
      setTimelineLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncStatus('Starting sync...');

      // Start the sync request (non-blocking)
      fetch('/api/sync', { method: 'POST' })
        .then(async (response) => {
          const result = await response.json();
          if (response.ok) {
            setSyncStatus(
              `Sync completed! Processed ${result.eventsProcessed} events. Timeline entries: ${result.timelineEntries}, Delegators: ${result.currentDelegators}`
            );
          } else {
            throw new Error(result.error || 'Sync failed');
          }
        })
        .catch((err: any) => {
          setError(err.message || 'Sync failed');
          setSyncStatus(null);
          setSyncing(false);
        });

    } catch (err: any) {
      setError(err.message || 'Sync failed');
      setSyncStatus(null);
      setSyncing(false);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatTimeSince = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const fetchSyncProgress = async () => {
    try {
      const response = await fetch('/api/sync/progress');
      if (response.ok) {
        const progress = await response.json();
        setSyncProgress(progress);

        // Update syncing state based on progress
        if (progress.isActive) {
          setSyncing(true);
        } else {
          // Sync completed
          setSyncing(false);
          setSyncProgress(null);
          // Refresh data after sync completes
          await fetchData();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch sync progress:', err);
    }
  };

  useEffect(() => {
    // Check if sync is already in progress FIRST
    fetchSyncProgress();

    // Then fetch data
    fetchData();

    // Auto-sync: Check if data is stale and trigger background sync
    const checkAndAutoSync = async () => {
      try {
        const metadataRes = await fetch('/api/data?endpoint=metadata');
        if (metadataRes.ok) {
          const metadata = await metadataRes.json();
          const now = Date.now();
          const oneHour = 60 * 60 * 1000;

          // If data is older than 1 hour, trigger background sync
          if (now - metadata.lastSyncTimestamp > oneHour) {
            console.log('Data is stale, triggering background sync...');
            fetch('/api/sync/background', {
              method: 'POST',
              headers: { 'X-Sync-Token': process.env.NEXT_PUBLIC_SYNC_SECRET || 'default-secret' }
            }).catch(err => console.warn('Background sync failed:', err));
          }
        }
      } catch (err) {
        console.warn('Auto-sync check failed:', err);
      }
    };

    checkAndAutoSync();
  }, []);

  // Poll for sync progress
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (syncing) {
      // Poll every 2 seconds while syncing
      fetchSyncProgress();
      intervalId = setInterval(fetchSyncProgress, 2000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [syncing]);

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Voting Power Tracker</h1>
          <p className="text-gray-600">ARB Token Delegation on Arbitrum</p>
        </div>

        <div className="mb-6 flex gap-4 items-center flex-wrap">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {syncing ? 'Syncing...' : 'Sync Data'}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          {metadata && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <p className="text-sm text-green-800">
                Last sync: {formatTimeSince(metadata.lastSyncTimestamp)}
              </p>
            </div>
          )}

          {syncStatus && (
            <p className="text-sm text-green-600">{syncStatus}</p>
          )}
        </div>

        {/* Sync Progress Visualization */}
        {syncProgress && syncProgress.isActive && (
          <div className="mb-6 bg-white rounded-lg shadow p-6">
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-gray-800">Syncing Blockchain Data</h3>
                <span className="text-sm font-medium text-blue-600">
                  {syncProgress.percentComplete.toFixed(1)}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                  style={{ width: `${syncProgress.percentComplete}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-shimmer"></div>
                </div>
              </div>
            </div>

            {/* Progress Details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-600 mb-1">Current Block</p>
                <p className="font-semibold text-gray-900">{syncProgress.currentBlock.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-600 mb-1">Target Block</p>
                <p className="font-semibold text-gray-900">{syncProgress.targetBlock.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-600 mb-1">Events Processed</p>
                <p className="font-semibold text-gray-900">{syncProgress.eventsProcessed.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-600 mb-1">Time Remaining</p>
                <p className="font-semibold text-gray-900">
                  {syncProgress.estimatedTimeRemaining
                    ? formatDuration(syncProgress.estimatedTimeRemaining)
                    : 'Calculating...'}
                </p>
              </div>
            </div>

            {/* Block Range Info */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Processing blocks {syncProgress.startBlock.toLocaleString()} to {syncProgress.targetBlock.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-500">Loading data...</p>
            </div>
          </div>
        ) : metadata && currentState ? (
          <>
            {/* Summary Stats */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Total Voting Power</h3>
                <p className="text-2xl font-bold text-blue-600">
                  {(Number(metadata.totalVotingPower) / 1e18).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })} ARB
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Total Delegators</h3>
                <p className="text-2xl font-bold text-purple-600">{metadata.totalDelegators}</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Timeline Entries</h3>
                <p className="text-2xl font-bold text-green-600">{metadata.totalTimelineEntries}</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Last Synced Block</h3>
                <p className="text-2xl font-bold text-orange-600">{metadata.lastSyncedBlock.toLocaleString()}</p>
              </div>
            </div>

            {/* Timeline Chart */}
            <div className="mb-8 bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-semibold mb-4">Voting Power Timeline</h2>
              {timelineLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                    <p className="text-sm text-gray-500">Loading timeline data...</p>
                  </div>
                </div>
              ) : timeline.length > 0 ? (
                <TimelineChart timeline={timeline} />
              ) : (
                <p className="text-gray-500">No timeline data available.</p>
              )}
            </div>

            {/* Delegators List */}
            <div className="mb-8">
              <DelegatorsList delegators={currentState.delegators} />
            </div>

            {/* Metadata Info */}
            <div className="mb-8 bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-3 text-gray-700">System Info</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Last Sync Time:</span>
                  <span className="ml-2 font-medium">{formatTimestamp(metadata.lastSyncTimestamp)}</span>
                </div>
                <div>
                  <span className="text-gray-600">Data Partitions:</span>
                  <span className="ml-2 font-medium">{metadata.timelinePartitions}</span>
                </div>
                <div>
                  <span className="text-gray-600">As of Block:</span>
                  <span className="ml-2 font-medium">{currentState.asOfBlock.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-600">Auto-sync:</span>
                  <span className="ml-2 font-medium text-green-600">Active</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-500">No data available. Click "Sync Data" to start tracking.</p>
          </div>
        )}
      </div>
    </main>
  );
}
