import { SeverityBadge } from './SeverityBadge';

interface Anomaly {
  id: string;
  transactionId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  explanation: string;
  recommendation?: string | null;
  acknowledged: boolean;
}

interface AlertsSectionProps {
  anomalies: Anomaly[];
  onAcknowledge: (id: string) => void;
  isLoading?: boolean;
}

export function AlertsSection({ anomalies, onAcknowledge, isLoading }: AlertsSectionProps) {
  if (isLoading) {
    return (
      <section>
        <h2 className="text-balance mb-3 text-base font-semibold text-gray-900">
          Active Alerts
        </h2>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (anomalies.length === 0) {
    return (
      <section>
        <h2 className="text-balance mb-3 text-base font-semibold text-gray-900">
          Active Alerts
        </h2>
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100">
            <svg
              className="size-6 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="mt-3 text-pretty text-sm font-medium text-gray-900">
            All clear!
          </p>
          <p className="mt-1 text-pretty text-sm text-gray-500">
            No anomalies detected in your recent transactions.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-balance text-base font-semibold text-gray-900">
          Active Alerts
        </h2>
        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 tabular-nums">
          {anomalies.length}
        </span>
      </div>
      <div className="space-y-3">
        {anomalies.slice(0, 5).map((anomaly) => (
          <div
            key={anomaly.id}
            className="flex items-start gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={anomaly.severity} />
                <span className="text-xs text-gray-500">{anomaly.type}</span>
              </div>
              <p className="mt-2 text-pretty text-sm text-gray-900">
                {anomaly.explanation}
              </p>
              {anomaly.recommendation && (
                <div className="mt-2 rounded-lg bg-white/50 px-3 py-2">
                  <p className="text-pretty text-xs text-gray-700">
                    <span className="font-medium">Recommendation:</span> {anomaly.recommendation}
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onAcknowledge(anomaly.id)}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              aria-label="Acknowledge alert"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
