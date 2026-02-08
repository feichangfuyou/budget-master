// ═══════════════════════════════════════════════════════════
// REAL-TIME ANOMALY DETECTION (0 TOKENS - PURE STATS)
// ═══════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';
import type { Transaction, AnomalyResult } from './types.js';

export class RealtimeAnomalyDetector {
  private redis: Redis;
  private alertThresholds = {
    low: 0.7,
    medium: 0.8,
    high: 0.9,
    critical: 0.95,
  };

  constructor() {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token) throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
    this.redis = new Redis({ url, token });
  }

  async detect(
    transaction: Transaction,
    userHistory: Transaction[]
  ): Promise<AnomalyResult[]> {
    const anomalies: AnomalyResult[] = [];

    const amountAnomaly = this.detectAmountAnomaly(transaction, userHistory);
    if (amountAnomaly.isAnomaly) anomalies.push(amountAnomaly);

    const frequencyAnomaly = await this.detectFrequencyAnomaly(transaction, userHistory);
    if (frequencyAnomaly.isAnomaly) anomalies.push(frequencyAnomaly);

    const merchantAnomaly = this.detectNewMerchant(transaction, userHistory);
    if (merchantAnomaly.isAnomaly) anomalies.push(merchantAnomaly);

    const categoryAnomaly = this.detectCategoryShift(transaction, userHistory);
    if (categoryAnomaly.isAnomaly) anomalies.push(categoryAnomaly);

    const timeAnomaly = this.detectTimeAnomaly(transaction, userHistory);
    if (timeAnomaly.isAnomaly) anomalies.push(timeAnomaly);

    await this.storeAnomalies(transaction.id, anomalies);
    return anomalies;
  }

  private detectAmountAnomaly(
    transaction: Transaction,
    history: Transaction[]
  ): AnomalyResult {
    const sameCategory = history.filter((t) => t.category === transaction.category);

    if (sameCategory.length < 5) {
      return {
        isAnomaly: false,
        score: 0,
        type: 'amount',
        severity: 'low',
        explanation: 'Insufficient history for analysis',
        baseline: 0,
        actual: transaction.amount,
      };
    }

    const amounts = sameCategory.map((t) => t.amount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const zScore = stdDev > 0 ? Math.abs((transaction.amount - mean) / stdDev) : 0;

    const medianAbsoluteDeviation = this.calculateMAD(amounts);
    const modifiedZScore =
      medianAbsoluteDeviation > 0
        ? (0.6745 * (transaction.amount - mean)) / medianAbsoluteDeviation
        : 0;

    const score = Math.min(Math.abs(modifiedZScore) / 3.5, 1);
    const isAnomaly = score > this.alertThresholds.low;
    const severity = this.getSeverity(score);

    return {
      isAnomaly,
      score,
      type: 'amount',
      severity,
      explanation: `${transaction.category ?? 'Uncategorized'} purchase of $${transaction.amount} is ${zScore.toFixed(1)}σ from your average of $${mean.toFixed(2)}`,
      baseline: mean,
      actual: transaction.amount,
      recommendation: isAnomaly
        ? `This is ${((transaction.amount / mean - 1) * 100).toFixed(0)}% higher than normal. Verify this transaction.`
        : undefined,
    };
  }

  private async detectFrequencyAnomaly(
    transaction: Transaction,
    history: Transaction[]
  ): Promise<AnomalyResult> {
    const merchant = transaction.merchant ?? transaction.description;

    const sameMerchant = history.filter(
      (t) => (t.merchant ?? t.description) === merchant
    );

    if (sameMerchant.length < 2) {
      return {
        isAnomaly: false,
        score: 0,
        type: 'frequency',
        severity: 'low',
        explanation: 'First or second transaction with this merchant',
        baseline: 0,
        actual: 1,
      };
    }

    const sortedDates = sameMerchant
      .map((t) => (t.date instanceof Date ? t.date : new Date(t.date)).getTime())
      .sort((a, b) => a - b);

    const dayMs = 1000 * 60 * 60 * 24;
    const intervals: number[] = [];
    for (let i = 1; i < sortedDates.length; i++) {
      intervals.push((sortedDates[i] - sortedDates[i - 1]) / dayMs);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const txTime =
      transaction.date instanceof Date
        ? transaction.date.getTime()
        : new Date(transaction.date).getTime();
    const lastTransactionDays = (txTime - sortedDates[sortedDates.length - 1]) / dayMs;

    const lambda = 1 / Math.max(avgInterval, 0.01);
    const k = Math.min(Math.floor(lastTransactionDays), 170);
    const expectedProb =
      (Math.pow(lambda * lastTransactionDays, k) * Math.exp(-lambda * lastTransactionDays)) /
      this.factorial(k);

    const score = expectedProb < 0.05 ? 0.8 : 0;
    const isAnomaly = score > this.alertThresholds.low;

    return {
      isAnomaly,
      score,
      type: 'frequency',
      severity: this.getSeverity(score),
      explanation: `Usually ${avgInterval.toFixed(0)} days between purchases at ${merchant}, been ${lastTransactionDays.toFixed(0)} days`,
      baseline: avgInterval,
      actual: lastTransactionDays,
      recommendation: isAnomaly
        ? `Unusual timing for ${merchant}. You typically shop here every ${avgInterval.toFixed(0)} days.`
        : undefined,
    };
  }

  private detectNewMerchant(
    transaction: Transaction,
    history: Transaction[]
  ): AnomalyResult {
    const merchant = transaction.merchant ?? transaction.description;
    const seen = history.some((t) => (t.merchant ?? t.description) === merchant);

    return {
      isAnomaly: !seen && transaction.amount > 50,
      score: seen ? 0 : 0.6,
      type: 'merchant',
      severity: seen ? 'low' : 'medium',
      explanation: seen ? `Known merchant: ${merchant}` : `First transaction with ${merchant}`,
      baseline: 0,
      actual: 1,
      recommendation: !seen
        ? `New merchant detected. Verify this is a legitimate charge.`
        : undefined,
    };
  }

  private detectCategoryShift(
    transaction: Transaction,
    history: Transaction[]
  ): AnomalyResult {
    if (!transaction.category) {
      return {
        isAnomaly: false,
        score: 0,
        type: 'category',
        severity: 'low',
        explanation: 'No category assigned',
        baseline: 0,
        actual: 0,
      };
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = history.filter((t) => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= thirtyDaysAgo;
    });

    const categoryCount = recent.reduce(
      (acc, t) => {
        if (t.category) acc[t.category] = (acc[t.category] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const total = Object.values(categoryCount).reduce((a, b) => a + b, 0);
    const currentCategoryFreq = total > 0 ? (categoryCount[transaction.category] ?? 0) / total : 0;

    const isRareCategory = currentCategoryFreq < 0.1;
    const isLargeAmount = transaction.amount > 100;
    const score = isRareCategory && isLargeAmount ? 0.7 : 0;

    return {
      isAnomaly: score > this.alertThresholds.low,
      score,
      type: 'category',
      severity: this.getSeverity(score),
      explanation: `${transaction.category} represents ${(currentCategoryFreq * 100).toFixed(1)}% of recent spending`,
      baseline: currentCategoryFreq * 100,
      actual: transaction.amount,
      recommendation:
        score > this.alertThresholds.low
          ? `Unusual ${transaction.category} purchase. This category is typically ${(currentCategoryFreq * 100).toFixed(1)}% of your spending.`
          : undefined,
    };
  }

  private detectTimeAnomaly(
    transaction: Transaction,
    history: Transaction[]
  ): AnomalyResult {
    const d = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
    const hour = d.getHours();
    const timeProfile = history.reduce(
      (acc, t) => {
        const h = (t.date instanceof Date ? t.date : new Date(t.date)).getHours();
        acc[h] = (acc[h] ?? 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    const totalTxs = Object.values(timeProfile).reduce((a, b) => a + b, 0);
    const hourFreq = totalTxs > 0 ? (timeProfile[hour] ?? 0) / totalTxs : 0;

    const isUnusualHour = hourFreq < 0.05 && totalTxs > 20;
    const isLateNight = hour >= 0 && hour < 6;
    const score = isUnusualHour || isLateNight ? 0.65 : 0;

    return {
      isAnomaly: score > this.alertThresholds.low,
      score,
      type: 'time',
      severity: this.getSeverity(score),
      explanation: `Transaction at ${hour}:00 (${(hourFreq * 100).toFixed(1)}% of your usual activity)`,
      baseline: hourFreq * 100,
      actual: hour,
      recommendation:
        score > this.alertThresholds.low
          ? `Unusual transaction time. You rarely make purchases at ${hour}:00.`
          : undefined,
    };
  }

  private calculateMAD(values: number[]): number {
    const median = this.median(values);
    const deviations = values.map((v) => Math.abs(v - median));
    return this.median(deviations);
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
  }

  private getSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= this.alertThresholds.critical) return 'critical';
    if (score >= this.alertThresholds.high) return 'high';
    if (score >= this.alertThresholds.medium) return 'medium';
    return 'low';
  }

  private async storeAnomalies(transactionId: string, anomalies: AnomalyResult[]): Promise<void> {
    if (anomalies.length > 0) {
      await this.redis.setex(
        `anomalies:${transactionId}`,
        86400 * 7,
        JSON.stringify(anomalies)
      );
      const critical = anomalies.filter((a) => a.severity === 'critical');
      if (critical.length > 0) {
        await this.redis.lpush(
          'critical_alerts',
          JSON.stringify({
            transactionId,
            anomalies: critical,
            timestamp: Date.now(),
          })
        );
      }
    }
  }

  async getCriticalAlerts(limit = 10): Promise<unknown[]> {
    const alerts = await this.redis.lrange('critical_alerts', 0, limit - 1);
    return (alerts ?? []).map((a) => JSON.parse(a as string));
  }
}
