import { formatCurrency } from '../lib/utils';

interface Transaction {
  id: string;
  date: string;
  amount: number;
  category?: string | null;
}

interface SpendingChartProps {
  transactions: Transaction[];
}

export function SpendingChart({ transactions }: SpendingChartProps) {
  // Group transactions by category
  const categoryTotals = transactions.reduce((acc, tx) => {
    const category = tx.category || 'Uncategorized';
    acc[category] = (acc[category] || 0) + tx.amount;
    return acc;
  }, {} as Record<string, number>);

  const sortedCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  const maxAmount = Math.max(...sortedCategories.map(([, amount]) => amount));

  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-amber-500',
    'bg-pink-500',
    'bg-indigo-500',
  ];

  if (sortedCategories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <svg
          className="mx-auto size-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <p className="mt-3 text-pretty text-sm text-gray-500">
          No spending data available yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-balance text-base font-semibold text-gray-900">
        Spending by Category
      </h3>
      <div className="mt-6 space-y-4">
        {sortedCategories.map(([category, amount], index) => {
          const percentage = (amount / maxAmount) * 100;
          return (
            <div key={category}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900">{category}</span>
                <span className="tabular-nums text-gray-600">
                  {formatCurrency(amount)}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${colors[index % colors.length]}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
