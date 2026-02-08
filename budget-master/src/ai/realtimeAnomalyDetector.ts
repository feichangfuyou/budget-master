/**
 * Realtime Anomaly Detector — 0 tokens. Five types: amount (Z-score + MAD), frequency, new merchant, category shift, time.
 */

import type { TransactionRow } from '../types/transaction.js';
import type { AnomalyResult } from '../types/transaction.js';

const ALERT_THRESHOLDS = { low: 0.7, medium: 0.8, high: 0.9, critical: 0.95 };

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function getSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= ALERT_THRESHOLDS.critical) return 'critical';
  if (score >= ALERT_THRESHOLDS.high) return 'high';
  if (score >= ALERT_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function toResult(
  isAnomaly: boolean,
  score: number,
  type: AnomalyResult['type'],
  explanation: string,
  recommendation?: string
): AnomalyResult | null {
  if (!isAnomaly) return null;
  return { type, severity: getSeverity(score), score, explanation, recommendation };
}

export class RealtimeAnomalyDetector {
  detect(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult[] {
    const results: AnomalyResult[] = [];

    const amountRes = this.detectAmountAnomaly(transaction, history);
    if (amountRes) results.push(amountRes);

    const freqRes = this.detectFrequencyAnomaly(transaction, history);
    if (freqRes) results.push(freqRes);

    const merchantRes = this.detectNewMerchant(transaction, history);
    if (merchantRes) results.push(merchantRes);

    const categoryRes = this.detectCategoryShift(transaction, history);
    if (categoryRes) results.push(categoryRes);

    const timeRes = this.detectTimeAnomaly(transaction, history);
    if (timeRes) results.push(timeRes);

    return results;
  }

  private detectAmountAnomaly(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult | null {
    const sameCategory = history.filter((t) => t.category === transaction.category);
    if (sameCategory.length < 5) return null;

    const amounts = sameCategory.map((t) => t.amount);
    const avg = mean(amounts);
    const variance = amounts.reduce((sum, val) => sum + (val - avg) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const zScore = stdDev > 0 ? Math.abs((transaction.amount - avg) / stdDev) : 0;

    const mad = this.calculateMAD(amounts);
    const modifiedZ = mad > 0 ? Math.abs((0.6745 * (transaction.amount - avg)) / mad) : 0;
    const score = Math.min(modifiedZ / 3.5, 1);
    const isAnomaly = score > ALERT_THRESHOLDS.low;

    return toResult(
      isAnomaly,
      score,
      'amount',
      `${transaction.category ?? 'Uncategorized'} purchase of $${transaction.amount.toFixed(2)} is ${zScore.toFixed(1)}σ from your average of $${avg.toFixed(2)}`,
      isAnomaly ? `This is ${((transaction.amount / avg - 1) * 100).toFixed(0)}% higher than normal. Verify this transaction.` : undefined
    );
  }

  private detectFrequencyAnomaly(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult | null {
    const merchant = transaction.merchant ?? transaction.description;
    const sameMerchant = history.filter((t) => (t.merchant ?? t.description) === merchant);
    if (sameMerchant.length < 2) return null;

    const sortedDates = sameMerchant
      .map((t) => new Date(t.date).getTime())
      .sort((a, b) => a - b);
    const dayMs = 1000 * 60 * 60 * 24;
    const intervals: number[] = [];
    for (let i = 1; i < sortedDates.length; i++) {
      intervals.push((sortedDates[i]! - sortedDates[i - 1]!) / dayMs);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const txTime = new Date(transaction.date).getTime();
    const lastTransactionDays = (txTime - sortedDates[sortedDates.length - 1]!) / dayMs;

    const lambda = 1 / Math.max(avgInterval, 0.01);
    const k = Math.min(Math.floor(lastTransactionDays), 170);
    const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
    const expectedProb = (Math.pow(lambda * lastTransactionDays, k) * Math.exp(-lambda * lastTransactionDays)) / factorial(k);
    const score = expectedProb < 0.05 ? 0.8 : 0;
    const isAnomaly = score > ALERT_THRESHOLDS.low;

    return toResult(
      isAnomaly,
      score,
      'frequency',
      `Usually ${avgInterval.toFixed(0)} days between purchases at ${merchant}, been ${lastTransactionDays.toFixed(0)} days`,
      isAnomaly ? `Unusual timing for ${merchant}. You typically shop here every ${avgInterval.toFixed(0)} days.` : undefined
    );
  }

  private detectNewMerchant(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult | null {
    const merchant = transaction.merchant ?? transaction.description;
    const seen = history.some((t) => (t.merchant ?? t.description) === merchant);
    const isAnomaly = !seen && transaction.amount > 50;
    const score = seen ? 0 : 0.6;
    return toResult(
      isAnomaly,
      score,
      'merchant',
      seen ? `Known merchant: ${merchant}` : `First transaction with ${merchant}`,
      !seen ? 'New merchant detected. Verify this is a legitimate charge.' : undefined
    );
  }

  private detectCategoryShift(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult | null {
    if (!transaction.category) return null;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = history.filter((t) => new Date(t.date) >= thirtyDaysAgo);
    const categoryCount: Record<string, number> = {};
    for (const t of recent) {
      if (t.category) categoryCount[t.category] = (categoryCount[t.category] ?? 0) + 1;
    }
    const total = Object.values(categoryCount).reduce((a, b) => a + b, 0);
    const currentCategoryFreq = total > 0 ? (categoryCount[transaction.category] ?? 0) / total : 0;

    const isRareCategory = currentCategoryFreq < 0.1;
    const isLargeAmount = transaction.amount > 100;
    const score = isRareCategory && isLargeAmount ? 0.7 : 0;
    const isAnomaly = score > ALERT_THRESHOLDS.low;

    return toResult(
      isAnomaly,
      score,
      'category',
      `${transaction.category} represents ${(currentCategoryFreq * 100).toFixed(1)}% of recent spending`,
      isAnomaly ? `Unusual ${transaction.category} purchase. This category is typically ${(currentCategoryFreq * 100).toFixed(1)}% of your spending.` : undefined
    );
  }

  private detectTimeAnomaly(transaction: TransactionRow, history: TransactionRow[]): AnomalyResult | null {
    const hour = new Date(transaction.date).getHours();
    const timeProfile: Record<number, number> = {};
    for (const t of history) {
      const h = new Date(t.date).getHours();
      timeProfile[h] = (timeProfile[h] ?? 0) + 1;
    }
    const totalTxs = Object.values(timeProfile).reduce((a, b) => a + b, 0);
    const hourFreq = totalTxs > 0 ? (timeProfile[hour] ?? 0) / totalTxs : 0;

    const isUnusualHour = hourFreq < 0.05 && totalTxs > 20;
    const isLateNight = hour >= 0 && hour < 6;
    const score = isUnusualHour || isLateNight ? 0.65 : 0;
    const isAnomaly = score > ALERT_THRESHOLDS.low;

    return toResult(
      isAnomaly,
      score,
      'time',
      `Transaction at ${hour}:00 (${(hourFreq * 100).toFixed(1)}% of your usual activity)`,
      isAnomaly ? `Unusual transaction time. You rarely make purchases at ${hour}:00.` : undefined
    );
  }

  private calculateMAD(values: number[]): number {
    const m = median(values);
    const deviations = values.map((v) => Math.abs(v - m));
    return median(deviations);
  }
}
