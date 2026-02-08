import { cn } from '../lib/utils';

interface SeverityBadgeProps {
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const styles: Record<string, string> = {
    low: 'bg-amber-100 text-amber-800 border-amber-200',
    medium: 'bg-orange-100 text-orange-800 border-orange-200',
    high: 'bg-red-100 text-red-800 border-red-200',
    critical: 'bg-red-200 text-red-900 border-red-300',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums',
        styles[severity] ?? 'bg-gray-100 text-gray-700 border-gray-200'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          severity === 'low' && 'bg-amber-600',
          severity === 'medium' && 'bg-orange-600',
          severity === 'high' && 'bg-red-600',
          severity === 'critical' && 'bg-red-800'
        )}
        aria-hidden="true"
      />
      {severity}
    </span>
  );
}
