"use strict";
/**
 * Cost tracker — Redis-backed metrics; in-memory fallback when Redis unavailable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostTracker = void 0;
const redis_1 = require("@upstash/redis");
const inMemoryByDate = {};
function today() {
    return new Date().toISOString().split('T')[0];
}
class CostTracker {
    constructor() {
        this.redis = null;
        this.inMemory = [];
        const url = process.env.UPSTASH_REDIS_URL;
        const token = process.env.UPSTASH_REDIS_TOKEN;
        if (url && token) {
            try {
                this.redis = new redis_1.Redis({ url, token });
            }
            catch {
                this.redis = null;
            }
        }
    }
    async track(metric) {
        this.inMemory.push(metric);
        if (this.redis) {
            try {
                await this.redis.lpush('cost_metrics', JSON.stringify({ ...metric, timestamp: metric.timestamp.toISOString() }));
                await this.redis.ltrim('cost_metrics', 0, 9999);
                const day = metric.timestamp.toISOString().split('T')[0];
                await this.redis.hincrby(`daily:${day}`, 'cost', Math.round(metric.cost * 100));
                await this.redis.hincrby(`daily:${day}`, 'queries', 1);
                if (metric.cacheHit)
                    await this.redis.hincrby(`daily:${day}`, 'cacheHits', 1);
            }
            catch (e) {
                console.warn('CostTracker Redis failed:', e.message);
            }
        }
        else {
            const day = today();
            const prev = inMemoryByDate[day] ?? { cost: 0, queries: 0, cacheHits: 0 };
            inMemoryByDate[day] = {
                cost: prev.cost + metric.cost,
                queries: prev.queries + 1,
                cacheHits: prev.cacheHits + (metric.cacheHit ? 1 : 0),
            };
        }
    }
    async getDailyCost(date = new Date()) {
        const key = date.toISOString().split('T')[0];
        if (this.redis) {
            try {
                const cost = await this.redis.hget(`daily:${key}`, 'cost');
                return cost != null ? parseInt(String(cost), 10) / 100 : 0;
            }
            catch {
                return inMemoryByDate[key]?.cost ?? 0;
            }
        }
        return inMemoryByDate[key]?.cost ?? 0;
    }
    async getMonthlyProjection() {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const currentDay = now.getDate();
        let totalCost = 0;
        for (let i = 1; i <= currentDay; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), i);
            totalCost += await this.getDailyCost(d);
        }
        const avgDaily = currentDay > 0 ? totalCost / currentDay : 0;
        const projectedCost = avgDaily * daysInMonth;
        const dayKey = now.toISOString().split('T')[0];
        const row = inMemoryByDate[dayKey];
        const cacheHits = row?.cacheHits ?? 0;
        const queries = row?.queries ?? 1;
        const savingsRate = queries > 0 ? cacheHits / queries : 0;
        return { currentCost: totalCost, projectedCost, savingsRate };
    }
    getReport() {
        const total = this.inMemory.reduce((s, m) => s + m.cost, 0);
        const count = this.inMemory.length;
        const avgCost = count ? total / count : 0;
        const cacheHits = this.inMemory.filter((m) => m.cacheHit).length;
        const cacheRate = count ? cacheHits / count : 0;
        const byModel = {};
        for (const m of this.inMemory) {
            byModel[m.model] = (byModel[m.model] ?? 0) + 1;
        }
        const lines = [
            'Cost optimization report',
            '',
            `Total queries: ${count}`,
            `Total cost: $${total.toFixed(4)}`,
            `Avg cost/query: $${avgCost.toFixed(4)}`,
            `Cache hit rate: ${(cacheRate * 100).toFixed(1)}%`,
            `Cache hits: ${cacheHits}`,
            '',
            'Model usage:',
            ...Object.entries(byModel).map(([model, n]) => `  ${model}: ${n} (${count ? ((n / count) * 100).toFixed(1) : 0}%)`),
        ];
        return lines.join('\n');
    }
}
exports.CostTracker = CostTracker;
//# sourceMappingURL=costTracker.js.map