// ═══════════════════════════════════════════════════════════
// COST TRACKER — SERVER (IN-MEMORY DAILY METRICS)
// ═══════════════════════════════════════════════════════════

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

interface DayRecord {
  cost: number;
  queries: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
}

const byDate: Record<string, DayRecord> = {};

export function recordRequest(opts: {
  cost: number;
  cacheHit?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const d = today();
  const prev = byDate[d] ?? {
    cost: 0,
    queries: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  byDate[d] = {
    cost: prev.cost + opts.cost,
    queries: prev.queries + 1,
    cacheHits: prev.cacheHits + (opts.cacheHit ? 1 : 0),
    inputTokens: prev.inputTokens + (opts.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (opts.outputTokens ?? 0),
  };
}

export function getReport(): string {
  const d = today();
  const row = byDate[d];
  if (!row) return '💰 Budget Master — No requests today yet.';
  const cacheRate = row.queries > 0 ? (row.cacheHits / row.queries) * 100 : 0;
  return [
    '💰 Budget Master — Cost & Savings',
    '',
    `Today: $${row.cost.toFixed(4)} | ${row.queries} queries | ${row.cacheHits} cache hits`,
    `Cache hit rate: ${cacheRate.toFixed(1)}%`,
  ].join('\n');
}

export class CostTracker {
  getReport(): string {
    return getReport();
  }
}
