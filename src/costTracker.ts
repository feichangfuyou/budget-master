/**
 * Cost Tracker — Persist daily/session metrics for 24/7 visibility.
 * Stores in extension globalState so we can show "today's cost" and savings rate.
 */

export interface CostRecord {
    date: string; // YYYY-MM-DD
    cost: number;
    queries: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
}

export interface CostTrackerState {
    byDate: Record<string, Omit<CostRecord, 'date'>>;
    lastUpdated: number;
}

const STATE_KEY = 'budgetMaster.costTracker';

function today(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Load persisted state from storage (call with globalState.get).
 */
export function loadCostState(
    globalState: { get: (key: string) => CostTrackerState | undefined }
): CostTrackerState {
    const raw = globalState.get(STATE_KEY);
    if (raw && typeof raw === 'object' && raw.byDate) {
        return raw as CostTrackerState;
    }
    return { byDate: {}, lastUpdated: 0 };
}

/**
 * Record one request (cost, tokens, cache hit).
 */
export function recordRequest(
    state: CostTrackerState,
    opts: {
        cost: number;
        cacheHit?: boolean;
        inputTokens?: number;
        outputTokens?: number;
    }
): CostTrackerState {
    const d = today();
    const prev = state.byDate[d] ?? {
        cost: 0,
        queries: 0,
        cacheHits: 0,
        inputTokens: 0,
        outputTokens: 0,
    };
    state.byDate[d] = {
        cost: prev.cost + opts.cost,
        queries: prev.queries + 1,
        cacheHits: prev.cacheHits + (opts.cacheHit ? 1 : 0),
        inputTokens: prev.inputTokens + (opts.inputTokens ?? 0),
        outputTokens: prev.outputTokens + (opts.outputTokens ?? 0),
    };
    state.lastUpdated = Date.now();
    return state;
}

/**
 * Persist state (call with globalState.update).
 */
export function persistCostState(
    globalState: { update: (key: string, value: unknown) => Thenable<void> },
    state: CostTrackerState
): Thenable<void> {
    return globalState.update(STATE_KEY, state);
}

/**
 * Get today's totals.
 */
export function getTodayTotals(state: CostTrackerState): CostRecord | null {
    const d = today();
    const row = state.byDate[d];
    if (!row) return null;
    return { date: d, ...row };
}

/**
 * Get monthly projection (current month cost + projected to end of month).
 */
export function getMonthlyProjection(state: CostTrackerState): {
    currentCost: number;
    daysElapsed: number;
    daysInMonth: number;
    projectedCost: number;
    cacheHitRate: number;
} {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysElapsed = now.getDate();

    let currentCost = 0;
    let totalQueries = 0;
    let cacheHits = 0;

    for (let day = 1; day <= daysElapsed; day++) {
        const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const row = state.byDate[d];
        if (row) {
            currentCost += row.cost;
            totalQueries += row.queries;
            cacheHits += row.cacheHits;
        }
    }

    const avgDailyCost = daysElapsed > 0 ? currentCost / daysElapsed : 0;
    const projectedCost = avgDailyCost * daysInMonth;
    const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;

    return {
        currentCost,
        daysElapsed,
        daysInMonth,
        projectedCost,
        cacheHitRate,
    };
}

/**
 * Format a short report string for UI or copy.
 */
export function formatCostReport(state: CostTrackerState): string {
    const todayRec = getTodayTotals(state);
    const proj = getMonthlyProjection(state);
    const lines: string[] = [];
    lines.push('💰 Budget Master — Cost & Savings');
    lines.push('');
    if (todayRec) {
        lines.push(`Today: $${todayRec.cost.toFixed(4)} | ${todayRec.queries} queries | ${todayRec.cacheHits} cache hits`);
    }
    lines.push(`This month: $${proj.currentCost.toFixed(4)} (projected $${proj.projectedCost.toFixed(2)})`);
    lines.push(`Cache hit rate: ${(proj.cacheHitRate * 100).toFixed(1)}%`);
    return lines.join('\n');
}
