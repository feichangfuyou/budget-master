import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  transactions,
  receipts,
  anomalies,
  forecasts,
} from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import {
  TokenOptimizedBudgetAI,
  RealtimeAnomalyDetector,
  PredictiveBudgetEngine,
  ReceiptOCRProcessor,
  RealtimeDashboard,
} from '../ai/index.js';

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ai = new TokenOptimizedBudgetAI();
const anomalyDetector = new RealtimeAnomalyDetector();
const budgetEngine = new PredictiveBudgetEngine();
const ocrProcessor = new ReceiptOCRProcessor();
const dashboard = new RealtimeDashboard(httpServer, {
  getStatsOnSubscribe: async (userId: string) => {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId as string))
      .orderBy(desc(transactions.date))
      .limit(500);
    const totalSpent = txs.reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    const categories: Record<string, number> = {};
    for (const t of txs) {
      const c = t.category ?? 'Other';
      categories[c] = (categories[c] ?? 0) + t.amount;
    }
    const alerts = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, userId as string))
      .orderBy(desc(anomalies.createdAt))
      .limit(10);
    return {
      totalSpent,
      transactionCount: txs.length,
      categories,
      alerts,
    };
  },
});

function getUserId(req: express.Request): string {
  return (req.headers['x-user-id'] as string) || 'demo-user';
}

// ─── TRANSACTIONS ───────────────────────────────────────────────────────────

app.get('/api/transactions', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { startDate, endDate, category } = req.query;

    const conditions = [eq(transactions.userId, userId)];
    if (startDate && typeof startDate === 'string') {
      conditions.push(gte(transactions.date, new Date(startDate)));
    }
    if (endDate && typeof endDate === 'string') {
      conditions.push(lte(transactions.date, new Date(endDate)));
    }
    if (category && typeof category === 'string') {
      conditions.push(eq(transactions.category, category));
    }

    const results = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date));

    res.json({ transactions: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const userId = getUserId(req);

    const schema = z.object({
      date: z.string().transform((s) => new Date(s)),
      amount: z.number(),
      description: z.string().min(1),
      category: z.string().optional(),
      merchant: z.string().optional(),
    });

    const data = schema.parse(req.body);

    const [transaction] = await db
      .insert(transactions)
      .values({
        userId,
        ...data,
      })
      .returning();

    if (!transaction) {
      return res.status(500).json({ error: 'Insert failed' });
    }

    const history = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date))
      .limit(100);

    const anomalyResults = anomalyDetector.detect(transaction, history);

    if (anomalyResults.length > 0) {
      await db.insert(anomalies).values(
        anomalyResults.map((a) => ({
          userId,
          transactionId: transaction.id,
          type: a.type,
          severity: a.severity,
          score: a.score,
          explanation: a.explanation,
          recommendation: a.recommendation,
        }))
      );
      dashboard.emitNewAlerts(userId, anomalyResults);
    }

    dashboard.emitNewTransactions(userId, [transaction]);

    res.json({
      transaction,
      anomalies: anomalyResults,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'Invalid transaction data' });
  }
});

// ─── RECEIPTS (OCR) ───────────────────────────────────────────────────────

app.post('/api/receipts/upload', async (req, res) => {
  try {
    const userId = getUserId(req);

    const { image } = req.body as { image?: string };
    if (!image) {
      return res.status(400).json({ error: 'Missing image (base64)' });
    }
    const buffer = Buffer.from(image, 'base64');

    const receiptData = await ocrProcessor.processReceipt(buffer);

    const [receipt] = await db
      .insert(receipts)
      .values({
        userId,
        imageUrl: `receipts/${Date.now()}.jpg`,
        rawText: receiptData.rawText,
        merchant: receiptData.merchant,
        items: receiptData.items,
        tax: receiptData.tax,
        tip: receiptData.tip,
        confidence: receiptData.confidence,
        processedAt: new Date(),
      })
      .returning();

    if (!receipt) {
      return res.status(500).json({ error: 'Receipt insert failed' });
    }

    const [transaction] = await db
      .insert(transactions)
      .values({
        userId,
        receiptId: receipt.id,
        date: receiptData.date,
        amount: receiptData.amount,
        description: `${receiptData.merchant} - ${receiptData.items.length} items`,
        category: receiptData.category,
        merchant: receiptData.merchant,
      })
      .returning();

    res.json({
      receipt,
      transaction: transaction ?? null,
      confidence: receiptData.confidence,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Receipt processing failed' });
  }
});

// ─── ANOMALIES ─────────────────────────────────────────────────────────────

app.get('/api/anomalies', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { acknowledged } = req.query;

    const conditions = [eq(anomalies.userId, userId)];
    if (acknowledged !== undefined) {
      conditions.push(eq(anomalies.acknowledged, acknowledged === 'true'));
    }

    const results = await db
      .select()
      .from(anomalies)
      .where(and(...conditions))
      .orderBy(desc(anomalies.createdAt))
      .limit(50);

    res.json({ anomalies: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
});

app.post('/api/anomalies/:id/acknowledge', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await db
      .update(anomalies)
      .set({ acknowledged: true })
      .where(and(eq(anomalies.id, id), eq(anomalies.userId, userId)));

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to acknowledge anomaly' });
  }
});

// ─── FORECASTS ─────────────────────────────────────────────────────────────

app.get('/api/forecasts', async (req, res) => {
  try {
    const userId = getUserId(req);

    const results = await db
      .select()
      .from(forecasts)
      .where(eq(forecasts.userId, userId))
      .orderBy(desc(forecasts.generatedAt));

    res.json({ forecasts: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch forecasts' });
  }
});

app.post('/api/forecasts/generate', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { category = 'Food', daysAhead = 30 } = req.body as {
      category?: string;
      daysAhead?: number;
    };

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date));

    const forecast = await budgetEngine.forecast(category, txs, daysAhead);

    await db.insert(forecasts).values({
      userId,
      category: forecast.category,
      predictions: forecast.predictions,
      trend: forecast.trend,
      trendStrength: forecast.trendStrength,
      seasonality: forecast.seasonality,
      recommendations: forecast.recommendations,
    });

    res.json({ forecast });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Forecast generation failed' });
  }
});

// ─── AI CHAT ───────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { query: userQuery } = req.body as { query?: string };

    if (!userQuery || typeof userQuery !== 'string') {
      return res.status(400).json({ error: 'Missing query' });
    }

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date))
      .limit(500);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of ai.query(userQuery, txs, userId)) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// ─── METRICS & HEALTH ───────────────────────────────────────────────────────

app.get('/api/metrics', async (req, res) => {
  try {
    const metrics = ai.getMetrics();
    res.json({
      ...metrics,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export async function startApi(): Promise<void> {
  await ai.init();
  await ocrProcessor.init();

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, () => {
    console.log(`🚀 Budget Master API running on http://localhost:${PORT}`);
  });
}

export { app, httpServer, db, dashboard };
