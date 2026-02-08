/**
 * Predictive Budget Engine — 0 tokens. LSTM (TensorFlow.js) when data sufficient; else simple trend + moving average.
 */

import type { TransactionRow } from '../types/transaction.js';

interface PredictionPoint {
  date: string;
  predicted: number;
  confidence: { lower: number; upper: number };
}

export interface ForecastResult {
  category: string;
  predictions: PredictionPoint[];
  trend: 'increasing' | 'decreasing' | 'stable';
  trendStrength: number;
  seasonality: boolean;
  recommendations: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TF = any;

function byCategory(txs: TransactionRow[], category: string): TransactionRow[] {
  const c = category.toLowerCase();
  return txs.filter(
    (t) => t.category?.toLowerCase() === c || (!t.category && c === 'uncategorized')
  );
}

function aggregateByDay(txs: TransactionRow[]): Array<{ date: Date; amount: number }> {
  const dailyMap = new Map<string, number>();
  for (const t of txs) {
    const d = new Date(t.date);
    const key = d.toISOString().split('T')[0]!;
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + t.amount);
  }
  const sorted = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length === 0) return [];
  const start = new Date(sorted[0]![0]);
  const end = new Date(sorted[sorted.length - 1]![0]);
  const result: Array<{ date: Date; amount: number }> = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0]!;
    result.push({ date: new Date(d), amount: dailyMap.get(key) ?? 0 });
  }
  return result;
}

function insufficientDataForecast(category: string): ForecastResult {
  return {
    category,
    predictions: [],
    trend: 'stable',
    trendStrength: 0,
    seasonality: false,
    recommendations: [`Need more transaction history for ${category} to generate accurate predictions. Keep tracking!`],
  };
}

function simpleForecast(
  category: string,
  filtered: TransactionRow[],
  daysAhead: number
): ForecastResult {
  const monthly = new Map<string, number>();
  for (const t of filtered) {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.set(key, (monthly.get(key) ?? 0) + t.amount);
  }
  const values = Array.from(monthly.values());
  const n = values.length;
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  let trendStrength = 0;
  let avgMonthly = 0;

  if (n >= 2) {
    avgMonthly = values.reduce((a, b) => a + b, 0) / n;
    const firstHalf = values.slice(0, Math.floor(n / 2));
    const secondHalf = values.slice(Math.floor(n / 2));
    const mean1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const mean2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const diff = mean2 - mean1;
    const range = Math.max(1, Math.max(...values) - Math.min(...values));
    trendStrength = Math.min(1, Math.abs(diff) / range);
    if (diff > range * 0.1) trend = 'increasing';
    else if (diff < -range * 0.1) trend = 'decreasing';
  } else if (n === 1) {
    avgMonthly = values[0]!;
  }

  const dailyAvg = avgMonthly / 30;
  const confidenceWidth = dailyAvg * 0.3;
  const predictions: PredictionPoint[] = [];
  const start = new Date();
  for (let i = 0; i < Math.min(daysAhead, 30); i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    predictions.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.round(dailyAvg * 100) / 100,
      confidence: { lower: Math.max(0, dailyAvg - confidenceWidth), upper: dailyAvg + confidenceWidth },
    });
  }

  const recommendations: string[] = [];
  if (trend === 'increasing' && trendStrength > 0.3) recommendations.push(`${category} spending is trending up. Consider setting a monthly cap.`);
  else if (trend === 'decreasing' && trendStrength > 0.3) recommendations.push(`Great — ${category} spending is trending down.`);
  if (n < 3) recommendations.push('Add more transactions for better forecasts.');

  return { category, predictions, trend, trendStrength, seasonality: false, recommendations };
}

function detectTrend(data: Array<{ date: Date; amount: number }>): { direction: 'increasing' | 'decreasing' | 'stable'; strength: number } {
  if (data.length < 7) return { direction: 'stable', strength: 0 };
  const x = data.map((_, i) => i);
  const y = data.map((d) => d.amount);
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i]!, 0);
  const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX + 1e-10);
  const yMean = sumY / n;
  const ssTotal = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce((s, yi, i) => s + (yi - (slope * x[i]! + (sumY - slope * sumX) / n)) ** 2, 0);
  const rSquared = ssTotal > 0 ? 1 - ssRes / ssTotal : 0;
  const direction = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
  return { direction, strength: Math.abs(rSquared) };
}

function detectSeasonality(data: Array<{ date: Date; amount: number }>): boolean {
  if (data.length < 28) return false;
  const series = data.map((d) => d.amount);
  const m = series.reduce((a, b) => a + b, 0) / series.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < series.length - 7; i++) num += (series[i]! - m) * (series[i + 7]! - m);
  for (let i = 0; i < series.length; i++) den += (series[i]! - m) ** 2;
  const weekly = den > 0 ? num / den : 0;
  num = 0;
  for (let i = 0; i < series.length - 30; i++) num += (series[i]! - m) * (series[i + 30]! - m);
  const monthly = den > 0 ? num / den : 0;
  return weekly > 0.3 || monthly > 0.3;
}

export class PredictiveBudgetEngine {
  private models = new Map<string, TF>();
  private tf: TF | null = null;
  private modelDir = 'models';

  private async loadTf(): Promise<TF | null> {
    if (this.tf) return this.tf;
    try {
      this.tf = await import('@tensorflow/tfjs-node');
      return this.tf;
    } catch {
      return null;
    }
  }

  async forecast(
    category: string,
    txs: TransactionRow[],
    daysAhead: number = 30
  ): Promise<ForecastResult> {
    const filtered = byCategory(txs, category);
    const dailySpending = aggregateByDay(filtered);

    if (filtered.length < 30 || dailySpending.length < 30) {
      return simpleForecast(category, filtered, daysAhead);
    }

    const tf = await this.loadTf();
    if (!tf) return simpleForecast(category, filtered, daysAhead);

    try {
      const model = await this.getOrTrainModel(category, dailySpending, tf);
      const predictions = await this.generatePredictions(model, dailySpending, daysAhead, tf);
      const trend = detectTrend(dailySpending);
      const seasonality = detectSeasonality(dailySpending);
      const recommendations = this.recommendations(category, predictions, trend, seasonality);
      return {
        category,
        predictions: predictions.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          predicted: p.predicted,
          confidence: p.confidence,
        })),
        trend: trend.direction,
        trendStrength: trend.strength,
        seasonality,
        recommendations,
      };
    } catch (e) {
      console.warn('LSTM forecast failed, using simple:', (e as Error).message);
      return simpleForecast(category, filtered, daysAhead);
    }
  }

  private async getOrTrainModel(
    category: string,
    data: Array<{ date: Date; amount: number }>,
    tf: TF
  ): Promise<TF> {
    const existing = this.models.get(category);
    if (existing) return existing;

    try {
      const path = `file://${process.cwd()}/${this.modelDir}/${category}/model.json`;
      const model = await tf.loadLayersModel(path);
      this.models.set(category, model);
      return model;
    } catch {
      const model = await this.trainModel(data, tf);
      this.models.set(category, model);
      try {
        await model.save(`file://${process.cwd()}/${this.modelDir}/${category}`);
      } catch {
        // ignore
      }
      return model;
    }
  }

  private async trainModel(
    data: Array<{ date: Date; amount: number }>,
    tf: TF
  ): Promise<TF> {
    const lookback = 14;
    const amounts = data.map((d) => d.amount);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    const range = max - min + 1e-8;
    const normalized = amounts.map((a) => (a - min) / range);

    const sequences: number[][] = [];
    const targets: number[] = [];
    for (let i = 0; i < normalized.length - lookback; i++) {
      sequences.push(normalized.slice(i, i + lookback));
      targets.push(normalized[i + lookback]!);
    }

    const inputTensor = tf.tensor3d(sequences.map((s) => s.map((v) => [v])));
    const targetTensor = tf.tensor2d(targets.map((t) => [t]));

    const model = tf.sequential({
      layers: [
        tf.layers.lstm({ units: 32, returnSequences: true, inputShape: [lookback, 1] }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.lstm({ units: 16, returnSequences: false }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 1 }),
      ],
    });

    model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError', metrics: ['mae'] });
    await model.fit(inputTensor, targetTensor, { epochs: 50, batchSize: 32, validationSplit: 0.2 });
    inputTensor.dispose();
    targetTensor.dispose();
    return model;
  }

  private async generatePredictions(
    model: TF,
    history: Array<{ date: Date; amount: number }>,
    daysAhead: number,
    tf: TF
  ): Promise<Array<{ date: Date; predicted: number; confidence: { lower: number; upper: number } }>> {
    const lookback = 14;
    const amounts = history.map((d) => d.amount);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    const range = max - min + 1e-8;
    let sequence = amounts.slice(-lookback).map((a) => (a - min) / range);
    const lastDate = history[history.length - 1]!.date;
    const recent = amounts.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const stdDev = Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length) || 0;

    const out: Array<{ date: Date; predicted: number; confidence: { lower: number; upper: number } }> = [];
    for (let i = 0; i < daysAhead; i++) {
      const input = tf.tensor3d([sequence.map((v) => [v])]);
      const pred = model.predict(input);
      const predVal = (await pred.data())[0] as number;
      input.dispose();
      pred.dispose();

      const actual = predVal * range + min;
      const predDate = new Date(lastDate);
      predDate.setDate(predDate.getDate() + i + 1);
      out.push({
        date: predDate,
        predicted: Math.round(actual * 100) / 100,
        confidence: {
          lower: Math.round(Math.max(0, actual - 1.96 * stdDev) * 100) / 100,
          upper: Math.round((actual + 1.96 * stdDev) * 100) / 100,
        },
      });
      sequence = [...sequence.slice(1), predVal];
    }
    return out;
  }

  private recommendations(
    category: string,
    predictions: Array<{ predicted: number }>,
    trend: { direction: string; strength: number },
    seasonality: boolean
  ): string[] {
    const recs: string[] = [];
    const avgDaily = predictions.length ? predictions.reduce((s, p) => s + p.predicted, 0) / predictions.length : 0;
    if (trend.direction === 'increasing' && trend.strength > 0.5) {
      recs.push(`📈 ${category} spending is trending up. Expected ~$${(avgDaily * 30).toFixed(0)}/month. Consider a budget cap.`);
    } else if (trend.direction === 'decreasing' && trend.strength > 0.5) {
      recs.push(`📉 ${category} spending is trending down. On track to save ~$${(avgDaily * 30).toFixed(0)}/month.`);
    }
    if (seasonality) recs.push(`🔄 ${category} shows seasonal patterns. Budget for peak periods.`);
    const tips: Record<string, string> = {
      dining: 'Try meal prepping to reduce dining out.',
      groceries: 'Shop with a list to avoid overspending.',
      entertainment: 'Look for free events or streaming alternatives.',
      transport: 'Consider carpooling or public transit.',
    };
    if (tips[category]) recs.push(`💡 ${tips[category]}`);
    return recs;
  }
}
