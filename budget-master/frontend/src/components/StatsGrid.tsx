import { formatCurrency } from '../lib/utils';

interface StatsGridProps {
  totalSpent: number;
  transactionCount: number;
  averageTransaction: number;
  topCategory?: string;
}

export function StatsGrid({ totalSpent, transactionCount, averageTransaction, topCategory }: StatsGridProps) {
  const stats = [
    {
      label: 'Total Spent',
      value: formatCurrency(totalSpent),
      icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      color: 'blue',
    },
    {
      label: 'Transactions',
      value: transactionCount.toString(),
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      color: 'green',
    },
    {
      label: 'Average',
      value: formatCurrency(averageTransaction),
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
      color: 'purple',
    },
    {
      label: 'Top Category',
      value: topCategory || 'N/A',
      icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
      color: 'amber',
    },
  ];

  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    amber: 'bg-amber-100 text-amber-600',
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-balance text-sm font-medium text-gray-600">
                {stat.label}
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">
                {stat.value}
              </p>
            </div>
            <div className={`flex size-12 items-center justify-center rounded-lg ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
              <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
              </svg>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
