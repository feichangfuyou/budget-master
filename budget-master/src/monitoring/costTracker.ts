/**
 * Cost tracker — Redis-backed metrics; in-memory fallback when Redis unavailable.
 */

import { Redis } from '@upstash/redis';

export interface CostMetric {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  cacheHit: boolean;
  query?: string;
}

const inMemoryByDate: Record<string, { cost: number; queries: number; cacheHits: number }> = {};

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

export class CostTracker {
  private redis: Redis | null = null;
  private inMemory: CostMetric[] = [];

  constructor() {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (url && token) {
      try {
        this.redis = new Redis({ url, token });
      } catch {
        this.redis = null;
      }
    }
  }

  async track(metric: CostMetric): Promise<void> {
    this.inMemory.push(metric);

    if (this.redis) {
      try {
        await this.redis.lpush('cost_metrics', JSON.stringify({ ...metric, timestamp: metric.timestamp.toISOString() }));
        await this.redis.ltrim('cost_metrics', 0, 9999);
        const day = metric.timestamp.toISOString().split('T')[0]!;
        await this.redis.hincrby(`daily:${day}`, 'cost', Math.round(metric.cost * 100));
        await this.redis.hincrby(`daily:${day}`, 'queries', 1);
        if (metric.cacheHit) await this.redis.hincrby(`daily:${day}`, 'cacheHits', 1);
      } catch (e) {
        console.warn('CostTracker Redis failed:', (e as Error).message);
      }
    } else {
      const day = today();
      const prev = inMemoryByDate[day] ?? { cost: 0, queries: 0, cacheHits: 0 };
      inMemoryByDate[day] = {
        cost: prev.cost + metric.cost,
        queries: prev.queries + 1,
        cacheHits: prev.cacheHits + (metric.cacheHit ? 1 : 0),
      };
    }
  }

  async getDailyCost(date: Date = new Date()): Promise<number> {
    const key = date.toISOString().split('T')[0]!;
    if (this.redis) {
      try {
        const cost = await this.redis.hget(`daily:${key}`, 'cost');
        return cost != null ? parseInt(String(cost), 10) / 100 : 0;
      } catch {
        return inMemoryByDate[key]?.cost ?? 0;
      }
    }
    return inMemoryByDate[key]?.cost ?? 0;
  }

  async getMonthlyProjection(): Promise<{
    currentCost: number;
    projectedCost: number;
    savingsRate: number;
  }> {
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

    const dayKey = now.toISOString().split('T')[0]!;
    const row = inMemoryByDate[dayKey];
    const cacheHits = row?.cacheHits ?? 0;
    const queries = row?.queries ?? 1;
    const savingsRate = queries > 0 ? cacheHits / queries : 0;

    return { currentCost: totalCost, projectedCost, savingsRate };
  }

  getReport(): string {
    const total = this.inMemory.reduce((s, m) => s + m.cost, 0);
    const count = this.inMemory.length;
    const avgCost = count ? total / count : 0;
    const cacheHits = this.inMemory.filter((m) => m.cacheHit).length;
    const cacheRate = count ? cacheHits / count : 0;

    const byModel: Record<string, number> = {};
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
