import { formatCurrency } from '../lib/utils';

interface SummaryCardProps {
  totalSpent: number;
  transactionCount: number;
  isLoading?: boolean;
}

export function SummaryCard({ totalSpent, transactionCount, isLoading }: SummaryCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 h-10 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-3 w-32 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-balance text-sm font-medium text-gray-600">
            Total Spending
          </h2>
          <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
            {formatCurrency(totalSpent)}
          </p>
          <p className="mt-1 text-pretty text-sm text-gray-500">
            Across {transactionCount} {transactionCount === 1 ? 'transaction' : 'transactions'}
          </p>
        </div>
        <div className="flex size-16 items-center justify-center rounded-full bg-blue-100">
          <svg
            className="size-8 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
