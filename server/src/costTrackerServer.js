"use strict";
// ═══════════════════════════════════════════════════════════
// COST TRACKER — SERVER (IN-MEMORY DAILY METRICS)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostTracker = void 0;
exports.recordRequest = recordRequest;
exports.getReport = getReport;
function today() {
    return new Date().toISOString().split('T')[0];
}
const byDate = {};
function recordRequest(opts) {
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
function getReport() {
    const d = today();
    const row = byDate[d];
    if (!row)
        return '💰 Budget Master — No requests today yet.';
    const cacheRate = row.queries > 0 ? (row.cacheHits / row.queries) * 100 : 0;
    return [
        '💰 Budget Master — Cost & Savings',
        '',
        `Today: $${row.cost.toFixed(4)} | ${row.queries} queries | ${row.cacheHits} cache hits`,
        `Cache hit rate: ${cacheRate.toFixed(1)}%`,
    ].join('\n');
}
class CostTracker {
    getReport() {
        return getReport();
    }
}
exports.CostTracker = CostTracker;
//# sourceMappingURL=costTrackerServer.js.map