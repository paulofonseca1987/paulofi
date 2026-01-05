'use client';

import { useState, useMemo } from 'react';
import type { VoteEntry, VoteSource } from '@/lib/types';

interface VotesListProps {
  votes: VoteEntry[];
}

type SortColumn = 'voteTimestamp' | 'votingPower' | 'delegatorCount';

// Source display names and colors
const SOURCE_CONFIG: Record<VoteSource, { label: string; color: string }> = {
  'snapshot': {
    label: 'Snapshot',
    color: 'text-orange-500',
  },
  'onchain-core': {
    label: 'Arbitrum Core',
    color: 'text-blue-500',
  },
  'onchain-treasury': {
    label: 'Arbitrum Treasury',
    color: 'text-green-500',
  },
};

// Onchain vote choice mapping (OpenZeppelin Governor standard)
const ONCHAIN_CHOICES: Record<number, { label: string; color: string }> = {
  0: { label: 'Against', color: 'text-red-600 dark:text-red-400' },
  1: { label: 'For', color: 'text-green-600 dark:text-green-400' },
  2: { label: 'Abstain', color: 'text-yellow-600 dark:text-yellow-400' },
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

  const formatChoice = (vote: VoteEntry): { label: string; color: string; multiline?: boolean } => {
    if (vote.source === 'snapshot') {
      const choices = vote.proposalChoices || [];

      // Helper to get choice label from index (1-based for Snapshot)
      const getChoiceLabel = (choiceNum: number): string => {
        if (choices.length > 0 && choiceNum >= 1 && choiceNum <= choices.length) {
          return choices[choiceNum - 1];
        }
        return `Choice ${choiceNum}`;
      };

      // Check if it's a weighted vote (object with choice -> percentage)
      if (typeof vote.choice === 'object' && !Array.isArray(vote.choice)) {
        const weightedChoice = vote.choice as Record<string, number>;
        const entries = Object.entries(weightedChoice);

        if (entries.length === 0) {
          return { label: 'No choice', color: 'text-gray-500 dark:text-gray-400' };
        }

        // Format weighted choices, each on its own line
        // Snapshot weighted votes use ratios: {"5": 1} and {"5": 100} both mean 100%
        // {"3": 20, "5": 80} means 20% and 80% respectively (20/(20+80) and 80/(20+80))
        const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
        const weightedLines = entries
          .sort(([, a], [, b]) => b - a) // Sort by weight descending
          .map(([choiceKey, weight]) => {
            const choiceNum = parseInt(choiceKey, 10);
            const label = getChoiceLabel(choiceNum);
            const pct = totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;
            return `${pct}% ${label}`;
          });

        return {
          label: weightedLines.join('\n'),
          color: 'text-gray-700 dark:text-gray-300',
          multiline: true
        };
      }

      // Multiple choice (array) - could be ranked-choice or approval
      if (Array.isArray(vote.choice)) {
        const choiceLabels = vote.choice.map((choiceNum) => getChoiceLabel(choiceNum));

        // Approval voting - just list the approved options
        if (vote.proposalType === 'approval') {
          return {
            label: choiceLabels.join(', '),
            color: 'text-gray-700 dark:text-gray-300'
          };
        }

        // Ranked choice - show each option with ordinal prefix on its own line
        const getOrdinal = (n: number): string => {
          const s = ['th', 'st', 'nd', 'rd'];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };

        const rankedLines = choiceLabels.map((label, i) => `${getOrdinal(i + 1)} ${label}`);
        return {
          label: rankedLines.join('\n'),
          color: 'text-gray-700 dark:text-gray-300',
          multiline: true
        };
      }

      // Single choice
      const choiceNum = vote.choice as number;
      const choiceLabel = getChoiceLabel(choiceNum);

      // Color based on common patterns
      const lowerLabel = choiceLabel.toLowerCase();
      if (lowerLabel === 'for' || lowerLabel === 'yes' || lowerLabel.includes('approve')) {
        return { label: choiceLabel, color: 'text-green-600 dark:text-green-400' };
      } else if (lowerLabel === 'against' || lowerLabel === 'no' || lowerLabel.includes('reject')) {
        return { label: choiceLabel, color: 'text-red-600 dark:text-red-400' };
      } else if (lowerLabel === 'abstain') {
        const abstainColor = vote.proposalType === 'basic'
          ? 'text-yellow-600 dark:text-yellow-400'
          : 'text-gray-600 dark:text-gray-400';
        return { label: choiceLabel, color: abstainColor };
      }

      return { label: choiceLabel, color: 'text-gray-700 dark:text-gray-300' };
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

  // Convert URLs in text to clickable links
  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const getProposalUrl = (vote: VoteEntry): string => {
    if (vote.source === 'snapshot') {
      return `https://snapshot.box/#/s:arbitrumfoundation.eth/proposal/${vote.proposalId}`;
    }
    // onchain-core and onchain-treasury both use Tally
    return `https://www.tally.xyz/gov/arbitrum/proposal/${vote.proposalId}`;
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
              <th className="px-2 py-3">
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Proposal
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Vote
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
                  Vote Date
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
                  <td className="px-2 py-4 whitespace-nowrap text-center">
                    <span className={`${sourceConfig.color}`} title={sourceConfig.label}>
                      ◆
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <a
                      href={getProposalUrl(vote)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline max-w-xs line-clamp-3"
                      title={vote.proposalTitle || vote.proposalId}
                    >
                      {vote.proposalTitle || `Proposal ${vote.proposalId.slice(0, 8)}...`}
                    </a>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-xs">
                      <span className={`text-sm font-medium ${choiceInfo.color} ${choiceInfo.multiline ? 'whitespace-pre-line' : ''}`}>
                        {choiceInfo.label}
                      </span>
                      {hasReason && (
                        <>
                          <p className={`text-sm text-gray-700 dark:text-gray-300 mt-1 ${!isExpanded && shouldTruncate ? 'line-clamp-2' : ''}`}>
                            {renderTextWithLinks(reasonText)}
                          </p>
                          {shouldTruncate && (
                            <button
                              onClick={() => toggleReason(vote.proposalId)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                            >
                              {isExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
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
