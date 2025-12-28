'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import type { TimelineEntry } from '@/lib/types';

interface TimelineChartProps {
  timeline: TimelineEntry[];
}

export default function TimelineChart({ timeline }: TimelineChartProps) {
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
    Object.keys(entry.delegators).forEach((addr) => delegatorAddresses.add(addr));
  });

  // Prepare data for chart
  const chartData = timeline.map((entry) => {
    const dataPoint: any = {
      timestamp: entry.timestamp,
      date: format(new Date(entry.timestamp * 1000), 'MMM dd, yyyy HH:mm'),
      blockNumber: entry.blockNumber,
      total: parseFloat(entry.totalVotingPower) / 1e18, // Convert from wei
    };

    // Add each delegator's balance
    delegatorAddresses.forEach((addr) => {
      const balance = entry.delegators[addr] || '0';
      dataPoint[addr] = parseFloat(balance) / 1e18;
    });

    return dataPoint;
  });

  // Generate colors for delegators
  const colors = [
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff7300',
    '#8dd1e1',
    '#d084d0',
    '#ffb347',
    '#87ceeb',
  ];

  const delegatorList = Array.from(delegatorAddresses);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{payload[0].payload.date}</p>
          <p className="text-sm text-gray-600 mb-1">Block: {payload[0].payload.blockNumber}</p>
          <p className="text-sm font-medium mb-2">
            Total: {payload[0].payload.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ARB
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
                  {addr.slice(0, 6)}...{addr.slice(-4)}: {value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ARB
                </p>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-96 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            {delegatorList.map((addr, idx) => (
              <linearGradient key={addr} id={`color${addr}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[idx % colors.length]} stopOpacity={0.8} />
                <stop offset="95%" stopColor={colors[idx % colors.length]} stopOpacity={0.1} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) => format(new Date(value * 1000), 'MMM dd')}
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
          />
          <YAxis
            tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
            label={{ value: 'Voting Power (ARB)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            formatter={(value: string) => {
              const addr = value;
              return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
            }}
          />
          {delegatorList.map((addr, idx) => (
            <Area
              key={addr}
              type="monotone"
              dataKey={addr}
              stackId="1"
              stroke={colors[idx % colors.length]}
              fill={`url(#color${addr})`}
              name={addr}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

