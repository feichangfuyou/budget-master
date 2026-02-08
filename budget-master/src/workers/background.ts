/**
 * Background workers — DB-only anomaly + forecast; optional Redis queues (receipt, anomaly, alert).
 * Run: npm run worker
 */

import 'dotenv/config';
import { db } from '../db/index.js';
import { transactions, anomalies, forecasts, receipts } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { RealtimeAnomalyDetector } from '../ai/realtimeAnomalyDetector.js';
import { PredictiveBudgetEngine } from '../ai/predictiveBudgetEngine.js';
import { ReceiptOCRProcessor } from '../ai/receiptOcrProcessor.js';

const anomalyDetector = new RealtimeAnomalyDetector();
const budgetEngine = new PredictiveBudgetEngine();
const ocrProcessor = new ReceiptOCRProcessor();

let redis: { lpop: (key: string) => Promise<string | null>; lpush: (key: string, ...values: string[]) => Promise<unknown>; hset: (key: string, field: string, value: string) => Promise<unknown>; hget: (key: string, field: string) => Promise<string | null>; hkeys: (key: string) => Promise<string[]> } | null = null;

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url, token });
    return redis;
  } catch {
    return null;
  }
}

async function runAnomalyPass(): Promise<void> {
  const recent = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.date))
    .limit(200);
  const byUser = new Map<string, typeof recent>();
  for (const t of recent) {
    const list = byUser.get(t.userId) ?? [];
    list.push(t);
    byUser.set(t.userId, list);
  }
  for (const [userId, txs] of byUser) {
    const latest = txs[0];
    if (!latest) continue;
    const existing = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.transactionId, latest.id));
    if (existing.length > 0) continue;
    const results = anomalyDetector.detect(latest, txs.slice(1));
    if (results.length > 0) {
      await db.insert(anomalies).values(
        results.map((a) => ({
          userId,
          transactionId: latest.id,
          type: a.type,
          severity: a.severity,
          score: a.score,
          explanation: a.explanation,
          recommendation: a.recommendation,
        }))
      );
    }
  }
}

async function runForecastPass(): Promise<void> {
  const categories = ['Food', 'Transport', 'Shopping', 'Subscriptions', 'Other', 'groceries', 'dining', 'entertainment', 'transport', 'utilities', 'healthcare', 'shopping', 'travel'];
  const rows = await db.selectDistinct({ userId: transactions.userId }).from(transactions);
  for (const { userId } of rows) {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date));
    for (const category of categories) {
      try {
        const forecast = await budgetEngine.forecast(category, txs, 30);
        await db.insert(forecasts).values({
          userId,
          category: forecast.category,
          predictions: forecast.predictions,
          trend: forecast.trend,
          trendStrength: forecast.trendStrength,
          seasonality: forecast.seasonality,
          recommendations: forecast.recommendations,
        });
      } catch {
        // skip category
      }
    }
  }
}

async function processReceiptQueue(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const raw = await r.lpop('receipt_queue');
  if (!raw) return;
  try {
    const { userId, imageBuffer } = JSON.parse(raw) as { userId: string; imageBuffer: string };
    const buffer = Buffer.from(imageBuffer, 'base64');
    const data = await ocrProcessor.processReceipt(buffer);
    const [receipt] = await db
      .insert(receipts)
      .values({
        userId,
        imageUrl: `receipts/${Date.now()}.jpg`,
        rawText: data.rawText,
        merchant: data.merchant,
        items: data.items,
        tax: data.tax,
        tip: data.tip,
        confidence: data.confidence,
        processedAt: new Date(),
      })
      .returning();
    if (receipt) {
      const [tx] = await db
        .insert(transactions)
        .values({
          userId,
          receiptId: receipt.id,
          date: data.date,
          amount: data.amount,
          description: `${data.merchant} - ${data.items.length} items`,
          category: data.category,
          merchant: data.merchant,
        })
        .returning();
      if (tx) await r.lpush('anomaly_queue', JSON.stringify({ userId, transactionId: tx.id }));
    }
  } catch (e) {
    console.error('Receipt queue processing error:', e);
  }
}

async function processAnomalyQueue(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const raw = await r.lpop('anomaly_queue');
  if (!raw) return;
  try {
    const { userId, transactionId } = JSON.parse(raw) as { userId: string; transactionId: string };
    const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    if (!tx) return;
    const history = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date));
    const others = history.filter((t: { id: string }) => t.id !== transactionId);
    const results = anomalyDetector.detect(tx, others);
    if (results.length > 0) {
      await db.insert(anomalies).values(
        results.map((a) => ({
          userId,
          transactionId: tx.id,
          type: a.type,
          severity: a.severity,
          score: a.score,
          explanation: a.explanation,
          recommendation: a.recommendation,
        }))
      );
      const critical = results.filter((a) => a.severity === 'critical' || a.severity === 'high');
      if (critical.length > 0) {
        await r.lpush('alert_queue', JSON.stringify({ userId, transactionId, anomalies: critical }));
      }
    }
  } catch (e) {
    console.error('Anomaly queue processing error:', e);
  }
}

async function loop(): Promise<void> {
  try {
    await runAnomalyPass();
    await runForecastPass();
    await processReceiptQueue();
    await processAnomalyQueue();
  } catch (e) {
    console.error('Worker error:', e);
  }
  setTimeout(loop, 60_000);
}

async function main(): Promise<void> {
  await ocrProcessor.init();
  const r = getRedis();
  console.log('Budget Master workers started (anomaly + forecast every 60s).' + (r ? ' Redis queues enabled.' : ''));
  loop();
}

main();
