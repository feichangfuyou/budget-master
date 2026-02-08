"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboard = exports.db = exports.httpServer = exports.app = void 0;
exports.startApi = startApi;
const express_1 = require("express");
const cors_1 = require("cors");
const http_1 = require("http");
const zod_1 = require("zod");
const index_js_1 = require("../db/index.js");
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return index_js_1.db; } });
const schema_js_1 = require("../db/schema.js");
const drizzle_orm_1 = require("drizzle-orm");
const index_js_2 = require("../ai/index.js");
const app = (0, express_1.default)();
exports.app = app;
const httpServer = (0, http_1.createServer)(app);
exports.httpServer = httpServer;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
const ai = new index_js_2.TokenOptimizedBudgetAI();
const anomalyDetector = new index_js_2.RealtimeAnomalyDetector();
const budgetEngine = new index_js_2.PredictiveBudgetEngine();
const ocrProcessor = new index_js_2.ReceiptOCRProcessor();
const dashboard = new index_js_2.RealtimeDashboard(httpServer, {
    getStatsOnSubscribe: async (userId) => {
        const txs = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date))
            .limit(500);
        const totalSpent = txs.reduce((s, t) => s + t.amount, 0);
        const categories = {};
        for (const t of txs) {
            const c = t.category ?? 'Other';
            categories[c] = (categories[c] ?? 0) + t.amount;
        }
        const alerts = await index_js_1.db
            .select()
            .from(schema_js_1.anomalies)
            .where((0, drizzle_orm_1.eq)(schema_js_1.anomalies.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.anomalies.createdAt))
            .limit(10);
        return {
            totalSpent,
            transactionCount: txs.length,
            categories,
            alerts,
        };
    },
});
exports.dashboard = dashboard;
function getUserId(req) {
    return req.headers['x-user-id'] || 'demo-user';
}
// ─── TRANSACTIONS ───────────────────────────────────────────────────────────
app.get('/api/transactions', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { startDate, endDate, category } = req.query;
        const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId)];
        if (startDate && typeof startDate === 'string') {
            conditions.push((0, drizzle_orm_1.gte)(schema_js_1.transactions.date, new Date(startDate)));
        }
        if (endDate && typeof endDate === 'string') {
            conditions.push((0, drizzle_orm_1.lte)(schema_js_1.transactions.date, new Date(endDate)));
        }
        if (category && typeof category === 'string') {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.transactions.category, category));
        }
        const results = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date));
        res.json({ transactions: results });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});
app.post('/api/transactions', async (req, res) => {
    try {
        const userId = getUserId(req);
        const schema = zod_1.z.object({
            date: zod_1.z.string().transform((s) => new Date(s)),
            amount: zod_1.z.number(),
            description: zod_1.z.string().min(1),
            category: zod_1.z.string().optional(),
            merchant: zod_1.z.string().optional(),
        });
        const data = schema.parse(req.body);
        const [transaction] = await index_js_1.db
            .insert(schema_js_1.transactions)
            .values({
            userId,
            ...data,
        })
            .returning();
        if (!transaction) {
            return res.status(500).json({ error: 'Insert failed' });
        }
        const history = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date))
            .limit(100);
        const anomalyResults = anomalyDetector.detect(transaction, history);
        if (anomalyResults.length > 0) {
            await index_js_1.db.insert(schema_js_1.anomalies).values(anomalyResults.map((a) => ({
                userId,
                transactionId: transaction.id,
                type: a.type,
                severity: a.severity,
                score: a.score,
                explanation: a.explanation,
                recommendation: a.recommendation,
            })));
            dashboard.emitNewAlerts(userId, anomalyResults);
        }
        dashboard.emitNewTransactions(userId, [transaction]);
        res.json({
            transaction,
            anomalies: anomalyResults,
        });
    }
    catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Invalid transaction data' });
    }
});
// ─── RECEIPTS (OCR) ───────────────────────────────────────────────────────
app.post('/api/receipts/upload', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Missing image (base64)' });
        }
        const buffer = Buffer.from(image, 'base64');
        const receiptData = await ocrProcessor.processReceipt(buffer);
        const [receipt] = await index_js_1.db
            .insert(schema_js_1.receipts)
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
        const [transaction] = await index_js_1.db
            .insert(schema_js_1.transactions)
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Receipt processing failed' });
    }
});
// ─── ANOMALIES ─────────────────────────────────────────────────────────────
app.get('/api/anomalies', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { acknowledged } = req.query;
        const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.anomalies.userId, userId)];
        if (acknowledged !== undefined) {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.anomalies.acknowledged, acknowledged === 'true'));
        }
        const results = await index_js_1.db
            .select()
            .from(schema_js_1.anomalies)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.anomalies.createdAt))
            .limit(50);
        res.json({ anomalies: results });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch anomalies' });
    }
});
app.post('/api/anomalies/:id/acknowledge', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;
        await index_js_1.db
            .update(schema_js_1.anomalies)
            .set({ acknowledged: true })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.anomalies.id, id), (0, drizzle_orm_1.eq)(schema_js_1.anomalies.userId, userId)));
        res.json({ success: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to acknowledge anomaly' });
    }
});
// ─── FORECASTS ─────────────────────────────────────────────────────────────
app.get('/api/forecasts', async (req, res) => {
    try {
        const userId = getUserId(req);
        const results = await index_js_1.db
            .select()
            .from(schema_js_1.forecasts)
            .where((0, drizzle_orm_1.eq)(schema_js_1.forecasts.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.forecasts.generatedAt));
        res.json({ forecasts: results });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch forecasts' });
    }
});
app.post('/api/forecasts/generate', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { category = 'Food', daysAhead = 30 } = req.body;
        const txs = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date));
        const forecast = await budgetEngine.forecast(category, txs, daysAhead);
        await index_js_1.db.insert(schema_js_1.forecasts).values({
            userId,
            category: forecast.category,
            predictions: forecast.predictions,
            trend: forecast.trend,
            trendStrength: forecast.trendStrength,
            seasonality: forecast.seasonality,
            recommendations: forecast.recommendations,
        });
        res.json({ forecast });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Forecast generation failed' });
    }
});
// ─── AI CHAT ───────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { query: userQuery } = req.body;
        if (!userQuery || typeof userQuery !== 'string') {
            return res.status(400).json({ error: 'Missing query' });
        }
        const txs = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date))
            .limit(500);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        for await (const chunk of ai.query(userQuery, txs, userId)) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    }
    catch (error) {
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
    }
    catch (error) {
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
async function startApi() {
    await ai.init();
    await ocrProcessor.init();
    const PORT = Number(process.env.PORT) || 3000;
    httpServer.listen(PORT, () => {
        console.log(`🚀 Budget Master API running on http://localhost:${PORT}`);
    });
}
//# sourceMappingURL=index.js.map