"use strict";
/**
 * Background workers — DB-only anomaly + forecast; optional Redis queues (receipt, anomaly, alert).
 * Run: npm run worker
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const index_js_1 = require("../db/index.js");
const schema_js_1 = require("../db/schema.js");
const drizzle_orm_1 = require("drizzle-orm");
const realtimeAnomalyDetector_js_1 = require("../ai/realtimeAnomalyDetector.js");
const predictiveBudgetEngine_js_1 = require("../ai/predictiveBudgetEngine.js");
const receiptOcrProcessor_js_1 = require("../ai/receiptOcrProcessor.js");
const anomalyDetector = new realtimeAnomalyDetector_js_1.RealtimeAnomalyDetector();
const budgetEngine = new predictiveBudgetEngine_js_1.PredictiveBudgetEngine();
const ocrProcessor = new receiptOcrProcessor_js_1.ReceiptOCRProcessor();
let redis = null;
function getRedis() {
    if (redis)
        return redis;
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token)
        return null;
    try {
        const { Redis } = require('@upstash/redis');
        redis = new Redis({ url, token });
        return redis;
    }
    catch {
        return null;
    }
}
async function runAnomalyPass() {
    const recent = await index_js_1.db
        .select()
        .from(schema_js_1.transactions)
        .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date))
        .limit(200);
    const byUser = new Map();
    for (const t of recent) {
        const list = byUser.get(t.userId) ?? [];
        list.push(t);
        byUser.set(t.userId, list);
    }
    for (const [userId, txs] of byUser) {
        const latest = txs[0];
        if (!latest)
            continue;
        const existing = await index_js_1.db
            .select()
            .from(schema_js_1.anomalies)
            .where((0, drizzle_orm_1.eq)(schema_js_1.anomalies.transactionId, latest.id));
        if (existing.length > 0)
            continue;
        const results = anomalyDetector.detect(latest, txs.slice(1));
        if (results.length > 0) {
            await index_js_1.db.insert(schema_js_1.anomalies).values(results.map((a) => ({
                userId,
                transactionId: latest.id,
                type: a.type,
                severity: a.severity,
                score: a.score,
                explanation: a.explanation,
                recommendation: a.recommendation,
            })));
        }
    }
}
async function runForecastPass() {
    const categories = ['Food', 'Transport', 'Shopping', 'Subscriptions', 'Other', 'groceries', 'dining', 'entertainment', 'transport', 'utilities', 'healthcare', 'shopping', 'travel'];
    const rows = await index_js_1.db.selectDistinct({ userId: schema_js_1.transactions.userId }).from(schema_js_1.transactions);
    for (const { userId } of rows) {
        const txs = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date));
        for (const category of categories) {
            try {
                const forecast = await budgetEngine.forecast(category, txs, 30);
                await index_js_1.db.insert(schema_js_1.forecasts).values({
                    userId,
                    category: forecast.category,
                    predictions: forecast.predictions,
                    trend: forecast.trend,
                    trendStrength: forecast.trendStrength,
                    seasonality: forecast.seasonality,
                    recommendations: forecast.recommendations,
                });
            }
            catch {
                // skip category
            }
        }
    }
}
async function processReceiptQueue() {
    const r = getRedis();
    if (!r)
        return;
    const raw = await r.lpop('receipt_queue');
    if (!raw)
        return;
    try {
        const { userId, imageBuffer } = JSON.parse(raw);
        const buffer = Buffer.from(imageBuffer, 'base64');
        const data = await ocrProcessor.processReceipt(buffer);
        const [receipt] = await index_js_1.db
            .insert(schema_js_1.receipts)
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
            const [tx] = await index_js_1.db
                .insert(schema_js_1.transactions)
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
            if (tx)
                await r.lpush('anomaly_queue', JSON.stringify({ userId, transactionId: tx.id }));
        }
    }
    catch (e) {
        console.error('Receipt queue processing error:', e);
    }
}
async function processAnomalyQueue() {
    const r = getRedis();
    if (!r)
        return;
    const raw = await r.lpop('anomaly_queue');
    if (!raw)
        return;
    try {
        const { userId, transactionId } = JSON.parse(raw);
        const [tx] = await index_js_1.db.select().from(schema_js_1.transactions).where((0, drizzle_orm_1.eq)(schema_js_1.transactions.id, transactionId));
        if (!tx)
            return;
        const history = await index_js_1.db
            .select()
            .from(schema_js_1.transactions)
            .where((0, drizzle_orm_1.eq)(schema_js_1.transactions.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.transactions.date));
        const others = history.filter((t) => t.id !== transactionId);
        const results = anomalyDetector.detect(tx, others);
        if (results.length > 0) {
            await index_js_1.db.insert(schema_js_1.anomalies).values(results.map((a) => ({
                userId,
                transactionId: tx.id,
                type: a.type,
                severity: a.severity,
                score: a.score,
                explanation: a.explanation,
                recommendation: a.recommendation,
            })));
            const critical = results.filter((a) => a.severity === 'critical' || a.severity === 'high');
            if (critical.length > 0) {
                await r.lpush('alert_queue', JSON.stringify({ userId, transactionId, anomalies: critical }));
            }
        }
    }
    catch (e) {
        console.error('Anomaly queue processing error:', e);
    }
}
async function loop() {
    try {
        await runAnomalyPass();
        await runForecastPass();
        await processReceiptQueue();
        await processAnomalyQueue();
    }
    catch (e) {
        console.error('Worker error:', e);
    }
    setTimeout(loop, 60000);
}
async function main() {
    await ocrProcessor.init();
    const r = getRedis();
    console.log('Budget Master workers started (anomaly + forecast every 60s).' + (r ? ' Redis queues enabled.' : ''));
    loop();
}
main();
//# sourceMappingURL=background.js.map