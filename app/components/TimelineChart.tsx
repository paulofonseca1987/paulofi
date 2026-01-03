"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { TimelineEntry } from "@/lib/types";

interface TimelineChartProps {
  timeline: TimelineEntry[];
}

export default function TimelineChart({ timeline }: TimelineChartProps) {
  const [hiddenDelegates, setHiddenDelegates] = useState<Set<string>>(new Set());

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <p className="text-gray-500">No timeline data available</p>
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

  // Add vertical lines: for each delegator's first appearance, add a 0 value at the previous timestamp
  const seenDelegators = new Set<string>();
  chartData.forEach((dataPoint, index) => {
    delegatorAddresses.forEach((addr) => {
      // If this delegator appears for the first time
      if (dataPoint[addr] !== undefined && !seenDelegators.has(addr)) {
        // Mark as seen
        seenDelegators.add(addr);
        // If there's a previous data point, add a 0 value for this delegator
        if (index > 0) {
          chartData[index - 1][addr] = 0;
        }
      }
    });
  });

  // Extend to January 1st, 2026 with the same values as the last entry
  const jan1_2026 = new Date("2026-01-01").getTime() / 1000; // Unix timestamp
  if (chartData.length > 0) {
    const lastEntry = chartData[chartData.length - 1];
    const extendedDataPoint: any = {
      timestamp: jan1_2026,
      date: format(new Date(jan1_2026 * 1000), "MMM dd, yyyy HH:mm"),
      blockNumber: lastEntry.blockNumber, // Use same block number
      total: lastEntry.total,
    };

    // Copy only the delegator balances that exist in the last entry
    delegatorAddresses.forEach((addr) => {
      if (lastEntry[addr] !== undefined) {
        extendedDataPoint[addr] = lastEntry[addr];
      }
    });

    chartData.push(extendedDataPoint);
  }

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
    })
  );
  // Round up to nearest nice number, with a minimum of 1000 ARB
  const maxYAxis = Math.max(1000, Math.ceil(maxTotal / 1000) * 1000); // Round to nearest 1k, min 1000

  // Generate ticks at 1k intervals
  const yAxisTicks: number[] = [];
  for (let i = 0; i <= maxYAxis; i += 1000) {
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
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{payload[0].payload.date}</p>
          <p className="text-sm text-gray-600 mb-1">
            Block: {payload[0].payload.blockNumber}
          </p>
          <p className="text-sm font-medium mb-2">
            Total:{" "}
            {payload[0].payload.total.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            ARB
          </p>
          <div className="space-y-1">
            {delegatorList.map((addr, idx) => {
              const value = payload[0].payload[addr] || 0;
              if (value === 0) return null;
              return (
                <p key={addr} className="text-xs">
                  <span
                    className="inline-block w-3 h-3 rounded mr-2"
                    style={{ backgroundColor: colors[idx % colors.length] }}
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
  const endDate = new Date("2026-01-01").getTime() / 1000; // Unix timestamp

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

  return (
    <div className="w-full" style={{ height: "768px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
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
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) =>
              format(new Date(value * 1000), "MMM yyyy")
            }
            type="number"
            scale="time"
            domain={[startDate, endDate]}
            ticks={monthlyTicks}
            tick={{ fontSize: 10 }}
            interval={0}
          />
          <YAxis
            tickFormatter={(value) => value === 0 ? '' : `${value / 1000}k`}
            label={{
              value: "Voting Power (ARB)",
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, maxYAxis]}
            ticks={yAxisTicks}
            tick={{ fontSize: 10 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: "20px", cursor: "pointer" }}
            formatter={(value: string) => {
              const addr = value;
              return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
