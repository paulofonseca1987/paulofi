'use client';

import { useState } from 'react';
import type { TimelineEntry, DelegatorRewardShare } from '@/lib/types';

interface DelegatorsListProps {
  delegators: Record<string, string>;
  timeline: TimelineEntry[];
  rewardShares?: Record<string, DelegatorRewardShare>;
}

interface DelegatorInfo {
  address: string;
  dateStart: number | null;
  dateEnd: number | null;
  currentBalance: bigint;
  rewardContribution: bigint;
  rewardVoteCount: number;
  rewardPercentage: number;
}

export default function DelegatorsList({ delegators, timeline, rewardShares }: DelegatorsListProps) {
  const [sortColumn, setSortColumn] = useState<'dateStart' | 'currentBalance' | 'rewardPercentage'>('rewardPercentage');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Process timeline to get all delegators (past and current) with dates
  const allDelegators = new Map<string, DelegatorInfo>();

  // Extract all unique delegators from timeline
  timeline.forEach((entry) => {
    Object.keys(entry.delegators).forEach((address) => {
      const addrLower = address.toLowerCase();
      if (!allDelegators.has(addrLower)) {
        allDelegators.set(addrLower, {
          address: addrLower,
          dateStart: entry.timestamp,
          dateEnd: null,
          currentBalance: 0n,
          rewardContribution: 0n,
          rewardVoteCount: 0,
          rewardPercentage: 0,
        });
      }
    });
  });

  // Update with current balances and determine end dates
  allDelegators.forEach((info, address) => {
    const currentBalance = delegators[address];
    if (currentBalance) {
      // Still delegating
      info.currentBalance = BigInt(currentBalance);
      info.dateEnd = null;
    } else {
      // No longer delegating - find last appearance in timeline
      for (let i = timeline.length - 1; i >= 0; i--) {
        if (timeline[i].delegators[address]) {
          info.dateEnd = timeline[i].timestamp;
          break;
        }
      }
      info.currentBalance = 0n;
    }
  });

  // Add reward data for each delegator
  if (rewardShares) {
    // First, add any delegators that are in rewardShares but not in timeline
    for (const address of Object.keys(rewardShares)) {
      const addrLower = address.toLowerCase();
      if (!allDelegators.has(addrLower)) {
        allDelegators.set(addrLower, {
          address: addrLower,
          dateStart: null,
          dateEnd: null,
          currentBalance: 0n,
          rewardContribution: 0n,
          rewardVoteCount: 0,
          rewardPercentage: 0,
        });
      }
    }

    // Then update all delegators with their reward data
    allDelegators.forEach((info, address) => {
      const rewardData = rewardShares[address];
      if (rewardData) {
        info.rewardContribution = BigInt(rewardData.totalContribution);
        info.rewardVoteCount = rewardData.voteCount;
        info.rewardPercentage = rewardData.rewardPercentage;
      }
    });
  }

  const delegatorEntries = Array.from(allDelegators.values())
    .sort((a, b) => {
      let comparison = 0;

      if (sortColumn === 'currentBalance') {
        // Sort by current balance
        if (a.currentBalance > b.currentBalance) comparison = 1;
        else if (a.currentBalance < b.currentBalance) comparison = -1;
      } else if (sortColumn === 'dateStart') {
        // Sort by start date
        const dateA = a.dateStart || 0;
        const dateB = b.dateStart || 0;
        comparison = dateA - dateB;
      } else if (sortColumn === 'rewardPercentage') {
        // Sort by reward percentage
        comparison = a.rewardPercentage - b.rewardPercentage;
      }

      // Reverse if descending
      if (sortDirection === 'desc') comparison = -comparison;

      // Secondary sort by address if primary is equal
      if (comparison === 0) {
        comparison = a.address.localeCompare(b.address);
      }

      return comparison;
    });

  const totalBalance = delegatorEntries.reduce((sum, d) => sum + d.currentBalance, 0n);

  if (delegatorEntries.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Delegators</h2>
        <p className="text-gray-500 dark:text-gray-400">No delegators found</p>
      </div>
    );
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatBalance = (balance: bigint) => {
    const arb = Number(balance) / 1e18;
    return arb.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDelegationPeriod = (dateStart: number | null, dateEnd: number | null) => {
    if (!dateStart) return '-';
    const startDate = formatDate(dateStart);

    if (!dateEnd) {
      // Still active
      return `from ${startDate} until Today`;
    } else {
      // No longer active
      const endDate = formatDate(dateEnd);
      return `from ${startDate} until ${endDate}`;
    }
  };

  const getPercentage = (balance: bigint) => {
    if (totalBalance === 0n) return 0;
    return (Number(balance) / Number(totalBalance)) * 100;
  };

  const handleSort = (column: 'dateStart' | 'currentBalance' | 'rewardPercentage') => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to descending
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ column }: { column: 'dateStart' | 'currentBalance' | 'rewardPercentage' }) => {
    if (sortColumn !== column) {
      return (
        <svg className="w-4 h-4 ml-1 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 dark:text-white">Delegators</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('dateStart')}
              >
                <div className="flex items-center">
                  Token Holder
                  <SortIcon column="dateStart" />
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('currentBalance')}
              >
                <div className="flex items-center">
                  Voting Power (on Jan 1, 2026)
                  <SortIcon column="currentBalance" />
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('rewardPercentage')}
              >
                <div className="flex items-center">
                  Reward Share
                  <SortIcon column="rewardPercentage" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {delegatorEntries.map((info) => (
              <tr
                key={info.address}
                className="hover:bg-gray-50 dark:hover:bg-gray-700"
                style={{ opacity: info.currentBalance === 0n ? 0.5 : 1 }}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center">
                    <a
                      href={`https://arbiscan.io/address/${info.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {info.address}
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(info.address)}
                      className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Copy address"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatDelegationPeriod(info.dateStart, info.dateEnd)}
                  </p>
                </td>
                <td className="px-6 py-4">
                  {info.currentBalance === 0n ? (
                    <span className="text-sm text-gray-500 dark:text-gray-400">0 ARB Voting Power on Jan 1, 2026</span>
                  ) : (
                    <div>
                      <div className="flex items-center">
                        <span className="text-sm font-medium dark:text-gray-200 mr-2">
                          {formatBalance(info.currentBalance)} ARB
                        </span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {getPercentage(info.currentBalance).toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${getPercentage(info.currentBalance)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  {info.rewardPercentage > 0 ? (
                    <div>
                      <div className="flex items-center">
                        <span className="text-sm font-bold dark:text-gray-200 mr-2">
                          {info.rewardVoteCount} Votes
                        </span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {info.rewardPercentage.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1">
                        <div
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${Math.min(info.rewardPercentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

