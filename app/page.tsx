'use client';

import { useState, useEffect } from 'react';
import TimelineChart from './components/TimelineChart';
import DelegatorsList from './components/DelegatorsList';
import type { VotingPowerData } from '@/lib/types';

export default function Home() {
  const [data, setData] = useState<VotingPowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/data');
      if (!response.ok) {
        if (response.status === 404) {
          setError('No data found. Please sync first.');
        } else {
          throw new Error('Failed to fetch data');
        }
        return;
      }
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncStatus('Starting sync...');
      const response = await fetch('/api/sync', { method: 'POST' });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Sync failed');
      }

      setSyncStatus(
        `Sync completed! Processed ${result.eventsProcessed} events. Timeline entries: ${result.timelineEntries}, Delegators: ${result.currentDelegators}`
      );

      // Refresh data after sync
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Sync failed');
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Voting Power Tracker</h1>
          <p className="text-gray-600">ARB Token Delegation on Arbitrum</p>
        </div>

        <div className="mb-6 flex gap-4 items-center">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {syncing ? 'Syncing...' : 'Sync Data'}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          {syncStatus && (
            <p className="text-sm text-green-600">{syncStatus}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-96">
            <p className="text-gray-500">Loading data...</p>
          </div>
        ) : data ? (
          <>
            <div className="mb-8 bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-semibold mb-4">Voting Power Timeline</h2>
              <TimelineChart timeline={data.timeline} />
            </div>
            <div className="mb-8">
              <DelegatorsList delegators={data.currentDelegators} />
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

