"use client";

import { useState, useEffect, useRef } from "react";
import {
  ComposedChart,
  Area,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { TimelineEntry, VoteEntry } from "@/lib/types";

interface TimelineChartProps {
  timeline: TimelineEntry[];
  votes?: VoteEntry[];
}

// Vote source colors
const VOTE_COLORS = {
  snapshot: "#f97316", // orange
  "onchain-treasury": "#22c55e", // green (treasury)
  "onchain-core": "#3b82f6", // blue (core)
};

// Vote type labels for display
const VOTE_LABELS = {
  snapshot: "Snapshot",
  "onchain-treasury": "Arbitrum Treasury",
  "onchain-core": "Arbitrum Core",
};

type VoteSource = keyof typeof VOTE_COLORS;

export default function TimelineChart({
  timeline,
  votes = [],
}: TimelineChartProps) {
  const [hiddenDelegates, setHiddenDelegates] = useState<Set<string>>(
    new Set(),
  );
  const [hiddenVoteTypes, setHiddenVoteTypes] = useState<Set<VoteSource>>(
    new Set(),
  );
  const [isDark, setIsDark] = useState(false);
  const [hoveredVote, setHoveredVote] = useState<VoteEntry | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const containerRef = useRef<HTMLDivElement>(null);

  // Toggle vote type visibility
  const toggleVoteType = (voteType: VoteSource) => {
    setHiddenVoteTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(voteType)) {
        newSet.delete(voteType);
      } else {
        newSet.add(voteType);
      }
      return newSet;
    });
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Track container width for dynamic tick calculation
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <p className="text-gray-500 dark:text-gray-400">
          No timeline data available
        </p>
      </div>
    );
  }

  // Get all unique delegator addresses
  const delegatorAddresses = new Set<string>();
  timeline.forEach((entry) => {
    Object.keys(entry.delegators).forEach((addr) =>
      delegatorAddresses.add(addr),
    );
  });

  // Prepare data for chart
  const chartData = timeline.map((entry) => {
    const dataPoint: any = {
      timestamp: entry.timestamp,
      date: format(new Date(entry.timestamp * 1000), "MMM dd, yyyy HH:mm"),
      blockNumber: entry.blockNumber,
      total: parseFloat(entry.totalVotingPower) / 1e18, // Convert from wei
    };

    // Add each delegator's balance only if they exist in this entry
    delegatorAddresses.forEach((addr) => {
      if (entry.delegators[addr]) {
        const balance = entry.delegators[addr];
        dataPoint[addr] = parseFloat(balance) / 1e18;
      }
      // Don't add the property if the delegator doesn't exist in this entry
    });

    return dataPoint;
  });

  // Add a synthetic data point at end of chart domain to extend lines
  const endDate = new Date("2026-01-01").getTime() / 1000;
  if (chartData.length > 0) {
    const lastEntry = chartData[chartData.length - 1];
    if (lastEntry.timestamp < endDate) {
      const syntheticPoint: any = {
        timestamp: endDate,
        date: format(new Date(endDate * 1000), "MMM dd, yyyy HH:mm"),
        blockNumber: lastEntry.blockNumber,
        total: lastEntry.total,
        _hasChanges: false,
      };
      // Copy all delegator values from last entry
      delegatorAddresses.forEach((addr) => {
        if (lastEntry[addr] !== undefined) {
          syntheticPoint[addr] = lastEntry[addr];
        }
      });
      chartData.push(syntheticPoint);
    }
  }

  // Mark data points that have actual changes
  chartData.forEach((dataPoint, index) => {
    if (index === 0) {
      // First point always has changes (it's the start)
      dataPoint._hasChanges = true;
    } else {
      const prevPoint = chartData[index - 1];
      let hasChange = false;

      // Check if any delegator's value changed
      delegatorAddresses.forEach((addr) => {
        const currentValue = dataPoint[addr];
        const prevValue = prevPoint[addr];

        // Check if value changed (including appearing/disappearing)
        if (currentValue !== prevValue) {
          hasChange = true;
        }
      });

      dataPoint._hasChanges = hasChange;
    }
  });

  // Prepare vote data for scatter plot (filtered by hidden vote types)
  const voteData = votes
    .filter((vote) => !hiddenVoteTypes.has(vote.source as VoteSource))
    .map((vote) => {
      // Find the total voting power at the vote's snapshot timestamp
      let votingPowerAtSnapshot = 0;
      for (let i = chartData.length - 1; i >= 0; i--) {
        if (chartData[i].timestamp <= vote.snapshotTimestamp) {
          // Sum visible delegates
          delegatorAddresses.forEach((addr) => {
            if (!hiddenDelegates.has(addr)) {
              votingPowerAtSnapshot += chartData[i][addr] || 0;
            }
          });
          break;
        }
      }

      return {
        timestamp: vote.snapshotTimestamp,
        votingPower: parseFloat(vote.votingPower) / 1e18,
        vote,
        fill: VOTE_COLORS[vote.source],
      };
    });

  // Fixed Y-axis scale at 750k
  const maxYAxis = 750000;

  // Generate ticks at 100k intervals
  const yAxisTicks: number[] = [];
  for (let i = 0; i <= maxYAxis; i += 100000) {
    yAxisTicks.push(i);
  }

  // Handle legend click to toggle delegate visibility
  const handleLegendClick = (data: any) => {
    const address = data.value;
    setHiddenDelegates((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(address)) {
        newSet.delete(address);
      } else {
        newSet.add(address);
      }
      return newSet;
    });
  };

  // Generate colors for delegators
  const colors = [
    "#8884d8",
    "#82ca9d",
    "#ffc658",
    "#ff7300",
    "#8dd1e1",
    "#d084d0",
    "#ffb347",
    "#87ceeb",
  ];

  const delegatorList = Array.from(delegatorAddresses);

  // Calculate responsive tooltip width based on container width
  const isMobile = containerWidth < 640;
  const tooltipWidth = isMobile ? Math.min(containerWidth - 24, 352) : 352;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      // Check if this is a vote point
      const votePayload = payload.find((p: any) => p.dataKey === "votingPower");
      if (votePayload && votePayload.payload.vote) {
        const vote = votePayload.payload.vote as VoteEntry;
        const sourceLabels = VOTE_LABELS;

        // Calculate total and breakdown
        let totalVP = BigInt(0);
        const breakdown: { addr: string; balance: bigint }[] = [];
        for (const [addr, balance] of Object.entries(vote.delegatorBreakdown)) {
          const bal = BigInt(balance);
          totalVP += bal;
          breakdown.push({ addr, balance: bal });
        }
        // Sort by balance descending and filter out zero balances (must have > 1 wei)
        breakdown.sort((a, b) => (b.balance > a.balance ? 1 : -1));
        const nonZeroBreakdown = breakdown.filter((d) => d.balance > BigInt(1));

        const title = vote.proposalTitle || sourceLabels[vote.source];

        return (
          <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg" style={{ width: tooltipWidth }}>
            <div className="flex items-center gap-2 mb-2 h-12">
              <span
                className="inline-block w-2 h-2 rotate-45 flex-shrink-0"
                style={{
                  backgroundColor: `${VOTE_COLORS[vote.source]}80`,
                  border: `1px solid ${VOTE_COLORS[vote.source]}`
                }}
              />
              <span className="font-semibold dark:text-white line-clamp-2">
                {title}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Snapshot:{" "}
              {format(
                new Date(vote.snapshotTimestamp * 1000),
                "MMM dd, yyyy HH:mm",
              )}
            </p>
            <p className="text-sm font-medium mb-2 dark:text-gray-200">
              Voting Power:{" "}
              {(Number(totalVP) / 1e18).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              ARB
            </p>
            <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Delegator Breakdown:
              </p>
              <div className="space-y-1">
                {nonZeroBreakdown.map(({ addr, balance }) => {
                  const percentage =
                    totalVP > BigInt(0)
                      ? (Number(balance) / Number(totalVP)) * 100
                      : 0;
                  return (
                    <p
                      key={addr}
                      className="text-xs dark:text-gray-300 flex gap-2"
                    >
                      <span className="flex-shrink-0">
                        {addr.slice(0, 6)}...{addr.slice(-4)}
                      </span>
                      <span className="flex-grow text-right">
                        {(Number(balance) / 1e18).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ARB
                      </span>
                      <span className="text-gray-500 text-right w-14 flex-shrink-0">
                        {percentage.toFixed(2)}%
                      </span>
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }

      // Regular timeline point tooltip
      const currentPoint = payload[0].payload;
      const currentIndex = chartData.findIndex(
        (d) => d.timestamp === currentPoint.timestamp,
      );

      // For each visible delegate, get their current value or last known value
      const delegateValues: { [key: string]: number } = {};
      const visibleDelegators = delegatorList.filter(
        (addr) => !hiddenDelegates.has(addr),
      );

      visibleDelegators.forEach((addr) => {
        let value = currentPoint[addr];

        // If value is undefined at current point, look backwards for last known value
        if (value === undefined && currentIndex > 0) {
          for (let i = currentIndex - 1; i >= 0; i--) {
            if (chartData[i][addr] !== undefined) {
              value = chartData[i][addr];
              break;
            }
          }
        }

        delegateValues[addr] = value || 0;
      });

      // Calculate total for visible delegates
      const visibleTotal = Object.values(delegateValues).reduce(
        (sum, val) => sum + val,
        0,
      );

      // Filter out zero-value delegators
      const nonZeroDelegators = visibleDelegators.filter(
        (addr) => delegateValues[addr] > 0,
      );

      return (
        <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg" style={{ width: tooltipWidth }}>
          <p className="font-semibold mb-2 dark:text-white">
            {currentPoint.date}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            Block: {currentPoint.blockNumber}
          </p>
          <p className="text-sm font-medium mb-2 dark:text-gray-200">
            Voting Power:{" "}
            {visibleTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            ARB
          </p>
          <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Delegator Breakdown:
            </p>
            <div className="space-y-1">
              {nonZeroDelegators.map((addr) => {
                const value = delegateValues[addr];
                const percentage =
                  visibleTotal > 0 ? (value / visibleTotal) * 100 : 0;
                return (
                  <p
                    key={addr}
                    className="text-xs dark:text-gray-300 flex gap-2"
                  >
                    <span className="flex-shrink-0">
                      {addr.slice(0, 6)}...{addr.slice(-4)}
                    </span>
                    <span className="flex-grow text-right">
                      {value.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ARB
                    </span>
                    <span className="text-gray-500 text-right w-14 flex-shrink-0">
                      {percentage.toFixed(2)}%
                    </span>
                  </p>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Set fixed date range: September 1st 2024 to January 1st 2026
  const startDate = new Date("2024-09-01").getTime() / 1000; // Unix timestamp
  // endDate is defined earlier (for synthetic point)

  // Generate ticks for the 1st of each month
  const allMonthlyTicks: number[] = [];
  for (let year = 2024; year <= 2026; year++) {
    const startMonth = year === 2024 ? 8 : 0; // September (8) for 2024, January (0) for others
    const endMonth = year === 2026 ? 0 : 11; // January (0) for 2026, December (11) for others

    for (let month = startMonth; month <= endMonth; month++) {
      const monthStart = new Date(year, month, 1).getTime() / 1000;
      allMonthlyTicks.push(monthStart);
    }
  }

  // Calculate how many ticks to show based on container width
  // Approximate 70px per label
  const maxLabels = Math.max(2, Math.floor(containerWidth / 70));
  const tickInterval = Math.ceil(allMonthlyTicks.length / maxLabels);
  const monthlyTicks = allMonthlyTicks.filter((_, index) => index % tickInterval === 0);

  // Custom diamond shape for vote markers
  const DiamondShape = (props: any) => {
    const { cx, cy, fill } = props;
    const size = 6;
    return (
      <polygon
        points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
        fill={fill}
        fillOpacity={0.5}
        stroke={fill}
        strokeWidth={1}
        style={{ transition: "opacity 0.3s ease-in-out" }}
      />
    );
  };

  // Toggle all delegators visibility
  const toggleAllDelegators = () => {
    if (hiddenDelegates.size === delegatorList.length) {
      // All hidden, show all
      setHiddenDelegates(new Set());
    } else {
      // Some or none hidden, hide all
      setHiddenDelegates(new Set(delegatorList));
    }
  };

  // Toggle all votes visibility
  const toggleAllVotes = () => {
    const allVoteTypes = Object.keys(VOTE_COLORS) as VoteSource[];
    if (hiddenVoteTypes.size === allVoteTypes.length) {
      // All hidden, show all
      setHiddenVoteTypes(new Set());
    } else {
      // Some or none hidden, hide all
      setHiddenVoteTypes(new Set(allVoteTypes));
    }
  };

  // Eye icon component
  const EyeIcon = ({ visible, className = "" }: { visible: boolean; className?: string }) => (
    <svg
      className={`w-4 h-4 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {visible ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );

  return (
    <div className="w-full flex flex-col lg:flex-row gap-4">
      {/* Chart container */}
      <div className="flex-1" style={{ height: "663px" }} ref={containerRef}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: -26, bottom: 0 }}>
          <defs>
            {delegatorList.map((addr, idx) => (
              <linearGradient
                key={addr}
                id={`color${addr}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={colors[idx % colors.length]}
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={colors[idx % colors.length]}
                  stopOpacity={0.1}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={isDark ? "#374151" : "#e5e7eb"}
          />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) =>
              format(new Date(value * 1000), "MMM yyyy")
            }
            type="number"
            scale="time"
            domain={[startDate, endDate]}
            ticks={monthlyTicks}
            tick={{ fontSize: 10, fill: isDark ? "#9ca3af" : "#4b5563" }}
            interval={0}
            stroke={isDark ? "#4b5563" : "#9ca3af"}
            allowDuplicatedCategory={false}
          />
          <YAxis
            tickFormatter={(value) => (value === 0 ? "" : `${value / 1000}k`)}
            label={{}}
            domain={[0, maxYAxis]}
            ticks={yAxisTicks}
            tick={{ fontSize: 10, fill: isDark ? "#9ca3af" : "#4b5563" }}
            stroke={isDark ? "#4b5563" : "#9ca3af"}
          />
          <Tooltip
            content={<CustomTooltip />}
            position={isMobile ? { x: 12, y: 20 } : { x: 34, y: 20 }}
            wrapperStyle={{ pointerEvents: 'none', marginLeft: isMobile ? 0 : 12 }}
          />
          {delegatorList.map((addr, idx) => (
            <Area
              key={addr}
              type="stepAfter"
              dataKey={addr}
              stackId="1"
              stroke={colors[idx % colors.length]}
              fill={`url(#color${addr})`}
              name={addr}
              hide={hiddenDelegates.has(addr)}
            />
          ))}
          {/* Vote markers */}
          {voteData.length > 0 && (
            <Scatter
              data={voteData}
              dataKey="votingPower"
              shape={<DiamondShape />}
              legendType="none"
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* Layers Panel */}
      <div className="w-full lg:w-48 flex-shrink-0 lg:h-full overflow-y-auto flex flex-col">
          {/* Votes Section */}
          {votes.length > 0 && (
            <div className="w-full border-b border-gray-200 dark:border-gray-700">
              {/* Section Header */}
              <button
                onClick={toggleAllVotes}
                className="w-full px-4 py-2 flex items-center gap-3 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all cursor-pointer rounded"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Votes
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-500">
                  {Object.keys(VOTE_COLORS).length - hiddenVoteTypes.size}/{Object.keys(VOTE_COLORS).length}
                </span>
                <EyeIcon
                  visible={hiddenVoteTypes.size !== Object.keys(VOTE_COLORS).length}
                  className={`flex-shrink-0 ml-auto ${
                    hiddenVoteTypes.size === Object.keys(VOTE_COLORS).length
                      ? "text-gray-400 dark:text-gray-600"
                      : "text-gray-600 dark:text-gray-400"
                  }`}
                />
              </button>

              {/* Individual Vote Types */}
              <div className="pb-2">
                {(Object.keys(VOTE_COLORS) as VoteSource[]).map((voteType) => {
                  const isVisible = !hiddenVoteTypes.has(voteType);
                  return (
                    <button
                      key={voteType}
                      onClick={() => toggleVoteType(voteType)}
                      className={`w-full px-4 py-1.5 flex items-center gap-3 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all cursor-pointer rounded ${
                        !isVisible ? "opacity-50" : ""
                      }`}
                    >
                      <span
                        className="w-2 h-2 rotate-45 flex-shrink-0"
                        style={{
                          backgroundColor: `${VOTE_COLORS[voteType]}80`,
                          border: `1px solid ${VOTE_COLORS[voteType]}`
                        }}
                      />
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {VOTE_LABELS[voteType]}
                      </span>
                      <EyeIcon
                        visible={isVisible}
                        className={`flex-shrink-0 ml-auto ${
                          isVisible
                            ? "text-gray-600 dark:text-gray-400"
                            : "text-gray-400 dark:text-gray-600"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Delegators Section */}
          <div className="w-full">
            {/* Section Header */}
            <button
              onClick={toggleAllDelegators}
              className="w-full px-4 py-2 flex items-center gap-3 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all cursor-pointer rounded"
            >
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Delegators
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {delegatorList.length - hiddenDelegates.size}/{delegatorList.length}
              </span>
              <EyeIcon
                visible={hiddenDelegates.size !== delegatorList.length}
                className={`flex-shrink-0 ml-auto ${
                  hiddenDelegates.size === delegatorList.length
                    ? "text-gray-400 dark:text-gray-600"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              />
            </button>

            {/* Individual Delegators */}
            <div className="pb-2">
              {[...delegatorList].reverse().map((addr) => {
                const idx = delegatorList.indexOf(addr);
                const isVisible = !hiddenDelegates.has(addr);
                return (
                  <button
                    key={addr}
                    onClick={() => handleLegendClick({ value: addr })}
                    className={`w-full px-4 py-1.5 flex items-center gap-3 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all cursor-pointer rounded ${
                      !isVisible ? "opacity-50" : ""
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{
                        backgroundColor: `${colors[idx % colors.length]}80`,
                        border: `1px solid ${colors[idx % colors.length]}`
                      }}
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400 font-mono truncate">
                      {addr.slice(0, 6)}...{addr.slice(-4)}
                    </span>
                    <EyeIcon
                      visible={isVisible}
                      className={`flex-shrink-0 ml-auto ${
                        isVisible
                          ? "text-gray-600 dark:text-gray-400"
                          : "text-gray-400 dark:text-gray-600"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
      </div>
    </div>
  );
}
