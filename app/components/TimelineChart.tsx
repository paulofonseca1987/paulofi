"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  Area,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
  "onchain-core": "#8b5cf6", // purple (constitutional)
  "onchain-treasury": "#3b82f6", // blue (non-constitutional)
};

export default function TimelineChart({
  timeline,
  votes = [],
}: TimelineChartProps) {
  const [hiddenDelegates, setHiddenDelegates] = useState<Set<string>>(
    new Set(),
  );
  const [isDark, setIsDark] = useState(false);
  const [hoveredVote, setHoveredVote] = useState<VoteEntry | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
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

  // Prepare vote data for scatter plot
  const voteData = votes.map((vote) => {
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

  // Calculate dynamic Y-axis scale based on visible data
  const maxTotal = Math.max(
    ...chartData.map((d) => {
      // Sum only visible delegates
      let sum = 0;
      delegatorAddresses.forEach((addr) => {
        if (!hiddenDelegates.has(addr)) {
          sum += d[addr] || 0;
        }
      });
      return sum;
    }),
  );
  // Round up to nearest nice number, with a minimum of 100000 ARB
  const maxYAxis = Math.max(100000, Math.ceil(maxTotal / 100000) * 100000); // Round to nearest 100k, min 100k

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

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      // Check if this is a vote point
      const votePayload = payload.find((p: any) => p.dataKey === "votingPower");
      if (votePayload && votePayload.payload.vote) {
        const vote = votePayload.payload.vote as VoteEntry;
        const sourceLabels = {
          snapshot: "Snapshot",
          "onchain-core": "Core Governor",
          "onchain-treasury": "Treasury Governor",
        };

        // Calculate total and breakdown
        let totalVP = BigInt(0);
        const breakdown: { addr: string; balance: bigint }[] = [];
        for (const [addr, balance] of Object.entries(vote.delegatorBreakdown)) {
          const bal = BigInt(balance);
          totalVP += bal;
          breakdown.push({ addr, balance: bal });
        }
        // Sort by balance descending
        breakdown.sort((a, b) => (b.balance > a.balance ? 1 : -1));

        return (
          <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-w-sm">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: VOTE_COLORS[vote.source] }}
              />
              <span className="font-semibold dark:text-white">
                {sourceLabels[vote.source]}
              </span>
            </div>
            {vote.proposalTitle && (
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 line-clamp-2">
                {vote.proposalTitle}
              </p>
            )}
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
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {breakdown.slice(0, 10).map(({ addr, balance }) => {
                  const percentage =
                    totalVP > BigInt(0)
                      ? (Number(balance) / Number(totalVP)) * 100
                      : 0;
                  return (
                    <p
                      key={addr}
                      className="text-xs dark:text-gray-300 flex justify-between"
                    >
                      <span>
                        {addr.slice(0, 6)}...{addr.slice(-4)}
                      </span>
                      <span>
                        {(Number(balance) / 1e18).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}{" "}
                        ARB
                        <span className="text-gray-500 ml-1">
                          ({percentage.toFixed(1)}%)
                        </span>
                      </span>
                    </p>
                  );
                })}
                {breakdown.length > 10 && (
                  <p className="text-xs text-gray-500">
                    +{breakdown.length - 10} more
                  </p>
                )}
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

      return (
        <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-semibold mb-2 dark:text-white">
            {currentPoint.date}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Block: {currentPoint.blockNumber}
          </p>
          <p className="text-sm font-medium mb-2 dark:text-gray-200">
            Total:{" "}
            {visibleTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            ARB
          </p>
          <div className="space-y-1">
            {visibleDelegators.map((addr) => {
              const value = delegateValues[addr];
              if (value === 0) return null;
              // Find the original index to get the correct color
              const originalIdx = delegatorList.indexOf(addr);
              return (
                <p key={addr} className="text-xs dark:text-gray-300">
                  <span
                    className="inline-block w-3 h-3 rounded mr-2"
                    style={{
                      backgroundColor: colors[originalIdx % colors.length],
                    }}
                  />
                  {addr.slice(0, 6)}...{addr.slice(-4)}:{" "}
                  {value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  ARB
                </p>
              );
            })}
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
  const monthlyTicks: number[] = [];
  for (let year = 2024; year <= 2026; year++) {
    const startMonth = year === 2024 ? 8 : 0; // September (8) for 2024, January (0) for others
    const endMonth = year === 2026 ? 0 : 11; // January (0) for 2026, December (11) for others

    for (let month = startMonth; month <= endMonth; month++) {
      const monthStart = new Date(year, month, 1).getTime() / 1000;
      monthlyTicks.push(monthStart);
    }
  }

  // Custom diamond shape for vote markers
  const DiamondShape = (props: any) => {
    const { cx, cy, fill } = props;
    const size = 8;
    return (
      <polygon
        points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
        fill={fill}
        stroke={isDark ? "#1f2937" : "#ffffff"}
        strokeWidth={2}
      />
    );
  };

  return (
    <div className="w-full" style={{ height: "768px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{
              paddingTop: "20px",
              cursor: "pointer",
              color: isDark ? "#d1d5db" : "#374151",
            }}
            formatter={(value: string) => {
              const addr = value;
              return (
                <span
                  style={{ color: isDark ? "#d1d5db" : "#374151" }}
                >{`${addr.slice(0, 6)}...${addr.slice(-4)}`}</span>
              );
            }}
            onClick={handleLegendClick}
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
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
