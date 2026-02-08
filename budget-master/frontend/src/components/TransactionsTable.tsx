import { formatCurrency } from '../lib/utils';

interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
  merchant?: string | null;
}

interface TransactionsTableProps {
  transactions: Transaction[];
  onRefresh: () => void;
  isLoading?: boolean;
}

export function TransactionsTable({ transactions, onRefresh, isLoading }: TransactionsTableProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-balance text-base font-semibold text-gray-900">
          Recent Transactions
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          aria-label="Refresh transactions"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {isLoading && transactions.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto size-8 animate-pulse rounded-full bg-gray-200" />
          <p className="mt-3 text-pretty text-sm text-gray-500">Loading transactions...</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="size-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <p className="mt-3 text-pretty text-sm font-medium text-gray-900">
            No transactions yet
          </p>
          <p className="mt-1 text-pretty text-sm text-gray-500">
            Upload a receipt or add a transaction to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {transactions.slice(0, 20).map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        <p className="truncate text-sm font-medium text-gray-900" title={tx.description}>
                          {tx.description}
                        </p>
                        {tx.merchant && (
                          <p className="mt-0.5 truncate text-xs text-gray-500">
                            {tx.merchant}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {tx.category ? (
                        <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          {tx.category}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-600">
                      {new Date(tx.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(Number(tx.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
