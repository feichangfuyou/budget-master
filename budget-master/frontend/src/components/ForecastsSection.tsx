import { formatCurrency } from '../lib/utils';

interface Forecast {
  id?: string;
  category: string;
  predictions?: Array<{
    date: string;
    predicted: number;
    confidence: { lower: number; upper: number };
  }>;
  trend: string;
  recommendations?: string[];
}

interface ForecastsSectionProps {
  forecasts: Forecast[];
  onGenerate: () => void;
  isLoading?: boolean;
}

export function ForecastsSection({ forecasts, onGenerate, isLoading }: ForecastsSectionProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-balance text-base font-semibold text-gray-900">
          Budget Forecasts
        </h2>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="size-4 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Generating...
            </span>
          ) : (
            'Generate Forecast'
          )}
        </button>
      </div>

      {isLoading && forecasts.length === 0 ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
              <div className="mt-2 h-4 w-full animate-pulse rounded bg-gray-200" />
              <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : forecasts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-100">
            <svg
              className="size-6 text-blue-600"
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
          </div>
          <p className="mt-3 text-pretty text-sm font-medium text-gray-900">
            No forecasts yet
          </p>
          <p className="mt-1 text-pretty text-sm text-gray-500">
            Generate your first budget prediction to see spending trends.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={isLoading}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Generate First Forecast
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {forecasts.map((f, i) => (
            <div
              key={f.id ?? f.category + i}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize text-gray-900">
                  {f.category}
                </h3>
                <svg
                  className="size-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
              <p className="mt-2 text-pretty text-sm text-gray-600">
                {f.trend}
              </p>
              {f.predictions?.length && (
                <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">30-day estimate</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                    {formatCurrency(
                      f.predictions.reduce((s, p) => s + p.predicted, 0)
                    )}
                  </p>
                </div>
              )}
              {f.recommendations?.length && (
                <div className="mt-3 space-y-1">
                  {f.recommendations.map((rec, j) => (
                    <p key={j} className="text-pretty text-xs text-gray-600">
                      • {rec}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
