'use client';

import { useState, useMemo } from 'react';
import type { VoteEntry, VoteSource } from '@/lib/types';

interface VotesListProps {
  votes: VoteEntry[];
}

type SortColumn = 'voteTimestamp' | 'votingPower' | 'delegatorCount';

// Source display names and colors
const SOURCE_CONFIG: Record<VoteSource, { label: string; color: string; bgColor: string }> = {
  'snapshot': {
    label: 'Snapshot',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30'
  },
  'onchain-core': {
    label: 'Arbitrum Core',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30'
  },
  'onchain-treasury': {
    label: 'Arbitrum Treasury',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30'
  },
};

// Onchain vote choice mapping (OpenZeppelin Governor standard)
const ONCHAIN_CHOICES: Record<number, { label: string; color: string }> = {
  0: { label: 'Against', color: 'text-red-600 dark:text-red-400' },
  1: { label: 'For', color: 'text-green-600 dark:text-green-400' },
  2: { label: 'Abstain', color: 'text-gray-600 dark:text-gray-400' },
};

export default function VotesList({ votes }: VotesListProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('voteTimestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());

  // Sort votes
  const sortedVotes = useMemo(() => {
    return [...votes].sort((a, b) => {
      let comparison = 0;

      if (sortColumn === 'voteTimestamp') {
        comparison = a.voteTimestamp - b.voteTimestamp;
      } else if (sortColumn === 'votingPower') {
        comparison = Number(BigInt(a.votingPower) - BigInt(b.votingPower));
      } else if (sortColumn === 'delegatorCount') {
        comparison = Object.keys(a.delegatorBreakdown).length - Object.keys(b.delegatorBreakdown).length;
      }

      if (sortDirection === 'desc') comparison = -comparison;
      return comparison;
    });
  }, [votes, sortColumn, sortDirection]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatVotingPower = (votingPower: string) => {
    const arb = Number(BigInt(votingPower)) / 1e18;
    return arb.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatChoice = (vote: VoteEntry): { label: string; color: string } => {
    if (vote.source === 'snapshot') {
      // Snapshot votes can be single choice or ranked choice
      if (Array.isArray(vote.choice)) {
        // Ranked choice - show the ranking
        return {
          label: `Ranked: ${vote.choice.join(' > ')}`,
          color: 'text-gray-700 dark:text-gray-300'
        };
      } else {
        // Single choice - typically 1=For, 2=Against but varies by proposal
        // Show the choice number since we don't have the proposal's choice labels
        const choiceNum = vote.choice as number;
        if (choiceNum === 1) {
          return { label: 'For', color: 'text-green-600 dark:text-green-400' };
        } else if (choiceNum === 2) {
          return { label: 'Against', color: 'text-red-600 dark:text-red-400' };
        } else if (choiceNum === 3) {
          return { label: 'Abstain', color: 'text-gray-600 dark:text-gray-400' };
        }
        return { label: `Choice ${choiceNum}`, color: 'text-gray-700 dark:text-gray-300' };
      }
    } else {
      // Onchain votes use standard OpenZeppelin encoding
      const choice = vote.choice as number;
      return ONCHAIN_CHOICES[choice] || { label: `Choice ${choice}`, color: 'text-gray-700 dark:text-gray-300' };
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const toggleReason = (proposalId: string) => {
    const newExpanded = new Set(expandedReasons);
    if (newExpanded.has(proposalId)) {
      newExpanded.delete(proposalId);
    } else {
      newExpanded.add(proposalId);
    }
    setExpandedReasons(newExpanded);
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
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

  if (votes.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Votes</h2>
        <p className="text-gray-500 dark:text-gray-400">No votes found</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 dark:text-white">Votes</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Proposal Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Vote Choice
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Vote Reason
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('votingPower')}
              >
                <div className="flex items-center">
                  Voting Power
                  <SortIcon column="votingPower" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('delegatorCount')}
              >
                <div className="flex items-center">
                  Delegators
                  <SortIcon column="delegatorCount" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => handleSort('voteTimestamp')}
              >
                <div className="flex items-center">
                  Date
                  <SortIcon column="voteTimestamp" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {sortedVotes.map((vote) => {
              const sourceConfig = SOURCE_CONFIG[vote.source];
              const choiceInfo = formatChoice(vote);
              const delegatorCount = Object.keys(vote.delegatorBreakdown).length;
              const hasReason = vote.reason && vote.reason.trim().length > 0;
              const isExpanded = expandedReasons.has(vote.proposalId);
              const reasonText = vote.reason || '';
              const shouldTruncate = reasonText.length > 100;

              return (
                <tr
                  key={`${vote.source}-${vote.proposalId}`}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sourceConfig.bgColor} ${sourceConfig.color}`}>
                      {sourceConfig.label}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate" title={vote.proposalTitle || vote.proposalId}>
                      {vote.proposalTitle || `Proposal ${vote.proposalId.slice(0, 8)}...`}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${choiceInfo.color}`}>
                      {choiceInfo.label}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {hasReason ? (
                      <div className="max-w-xs">
                        <p className={`text-sm text-gray-700 dark:text-gray-300 ${!isExpanded && shouldTruncate ? 'line-clamp-2' : ''}`}>
                          {reasonText}
                        </p>
                        {shouldTruncate && (
                          <button
                            onClick={() => toggleReason(vote.proposalId)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                          >
                            {isExpanded ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatVotingPower(vote.votingPower)} ARB
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {delegatorCount}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(vote.voteTimestamp)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
