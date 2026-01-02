'use client';

import type { VotingPowerData } from '@/lib/types';

interface DelegatorsListProps {
  delegators: Record<string, string>;
}

export default function DelegatorsList({ delegators }: DelegatorsListProps) {
  const delegatorEntries = Object.entries(delegators)
    .map(([address, balance]) => ({
      address,
      balance: BigInt(balance),
    }))
    .sort((a, b) => {
      if (b.balance > a.balance) return 1;
      if (b.balance < a.balance) return -1;
      return 0;
    });

  const totalBalance = delegatorEntries.reduce((sum, d) => sum + d.balance, 0n);

  if (delegatorEntries.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Current Delegators</h2>
        <p className="text-gray-500">No delegators found</p>
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

  const getPercentage = (balance: bigint) => {
    if (totalBalance === 0n) return 0;
    return (Number(balance) / Number(totalBalance)) * 100;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Current Delegators</h2>
      <div className="mb-4 text-sm text-gray-600">
        Total Voting Power: {formatBalance(totalBalance)} ARB
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Delegated Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Percentage
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {delegatorEntries.map(({ address, balance }) => (
              <tr key={address} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <span className="font-mono text-sm">{formatAddress(address)}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(address)}
                      className="ml-2 text-gray-400 hover:text-gray-600"
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
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {formatBalance(balance)} ARB
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${getPercentage(balance)}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600">
                      {getPercentage(balance).toFixed(2)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

