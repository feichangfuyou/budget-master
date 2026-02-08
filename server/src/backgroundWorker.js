"use strict";
// ═══════════════════════════════════════════════════════════
// 24/7 BACKGROUND WORKER (AUTO-PROCESSING PIPELINE)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackgroundWorker = void 0;
const redis_1 = require("@upstash/redis");
const anomalyDetector_js_1 = require("./anomalyDetector.js");
const predictiveBudget_js_1 = require("./predictiveBudget.js");
const receiptOCR_js_1 = require("./receiptOCR.js");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class BackgroundWorker {
    constructor() {
        this.running = false;
        const url = process.env.UPSTASH_REDIS_URL;
        const token = process.env.UPSTASH_REDIS_TOKEN;
        if (!url || !token)
            throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
        this.redis = new redis_1.Redis({ url, token });
        this.anomalyDetector = new anomalyDetector_js_1.RealtimeAnomalyDetector();
        this.budgetEngine = new predictiveBudget_js_1.PredictiveBudgetEngine();
        this.ocrProcessor = new receiptOCR_js_1.ReceiptOCRProcessor();
    }
    async start() {
        this.running = true;
        console.log('🔄 Background worker started - 24/7 mode');
        await this.ocrProcessor.init();
        Promise.all([
            this.receiptProcessingWorker(),
            this.anomalyDetectionWorker(),
            this.budgetForecastWorker(),
            this.alertNotificationWorker(),
        ]).catch((err) => console.error('Worker error:', err));
    }
    async stop() {
        this.running = false;
        await this.ocrProcessor.terminate();
        console.log('⏹️  Background worker stopped');
    }
    async receiptProcessingWorker() {
        while (this.running) {
            try {
                const receipt = await this.redis.lpop('receipt_queue');
                if (receipt) {
                    const { userId, imageBuffer } = JSON.parse(receipt);
                    console.log(`📸 Processing receipt for user ${userId}`);
                    const data = await this.ocrProcessor.processReceipt(Buffer.from(imageBuffer, 'base64'));
                    const transaction = {
                        id: crypto.randomUUID(),
                        date: data.date,
                        amount: data.amount,
                        description: `${data.merchant} - ${data.items.length} items`,
                        category: data.category,
                        merchant: data.merchant,
                    };
                    await this.redis.hset(`user:${userId}:transactions`, transaction.id, JSON.stringify(transaction));
                    await this.redis.hset(`user:${userId}:receipts`, transaction.id, JSON.stringify(data));
                    console.log(`✅ Receipt processed: ${data.merchant} - $${data.amount}`);
                    await this.redis.lpush('anomaly_queue', JSON.stringify({ userId, transactionId: transaction.id }));
                }
                await sleep(1000);
            }
            catch (error) {
                console.error('Receipt processing error:', error);
                await sleep(5000);
            }
        }
    }
    async anomalyDetectionWorker() {
        while (this.running) {
            try {
                const item = await this.redis.lpop('anomaly_queue');
                if (item) {
                    const { userId, transactionId } = JSON.parse(item);
                    const txData = await this.redis.hget(`user:${userId}:transactions`, transactionId);
                    if (!txData) {
                        await sleep(100);
                        continue;
                    }
                    const transaction = JSON.parse(txData);
                    transaction.date = new Date(transaction.date);
                    const historyKeys = (await this.redis.hkeys(`user:${userId}:transactions`));
                    const historyData = await Promise.all(historyKeys.map((k) => this.redis.hget(`user:${userId}:transactions`, k)));
                    const history = historyData
                        .filter(Boolean)
                        .map((d) => {
                        const t = JSON.parse(d);
                        t.date = new Date(t.date);
                        return t;
                    })
                        .filter((t) => t.id !== transactionId);
                    const anomalies = await this.anomalyDetector.detect(transaction, history);
                    if (anomalies.length > 0) {
                        console.log(`🚨 ${anomalies.length} anomalies detected for transaction ${transactionId}`);
                        for (const anomaly of anomalies) {
                            if (anomaly.severity === 'high' || anomaly.severity === 'critical') {
                                await this.redis.lpush('alert_queue', JSON.stringify({ userId, transactionId, anomaly }));
                            }
                        }
                    }
                }
                await sleep(500);
            }
            catch (error) {
                console.error('Anomaly detection error:', error);
                await sleep(5000);
            }
        }
    }
    async budgetForecastWorker() {
        while (this.running) {
            try {
                console.log('📊 Generating budget forecasts...');
                const userKeys = (await this.redis.keys('user:*:transactions'));
                for (const userKey of userKeys.slice(0, 10)) {
                    const parts = userKey.split(':');
                    const userId = parts[1];
                    if (!userId)
                        continue;
                    const txKeys = (await this.redis.hkeys(userKey));
                    const txData = await Promise.all(txKeys.map((k) => this.redis.hget(userKey, k)));
                    const transactions = txData
                        .filter(Boolean)
                        .map((d) => {
                        const t = JSON.parse(d);
                        t.date = new Date(t.date);
                        return t;
                    });
                    const categories = Array.from(new Set(transactions.map((t) => t.category).filter(Boolean)));
                    for (const category of categories) {
                        const forecast = await this.budgetEngine.forecast(category, transactions, 30);
                        await this.redis.setex(`user:${userId}:forecast:${category}`, 21600, JSON.stringify(forecast));
                        console.log(`✅ Forecast generated for ${userId} - ${category}`);
                    }
                }
                await sleep(21600000); // 6 hours
            }
            catch (error) {
                console.error('Budget forecast error:', error);
                await sleep(300000);
            }
        }
    }
    async alertNotificationWorker() {
        while (this.running) {
            try {
                const alert = await this.redis.lpop('alert_queue');
                if (alert) {
                    const { userId, transactionId, anomaly } = JSON.parse(alert);
                    await this.sendAlert(userId, transactionId, anomaly);
                    console.log(`📧 Alert sent to user ${userId} for transaction ${transactionId}`);
                }
                await sleep(1000);
            }
            catch (error) {
                console.error('Alert notification error:', error);
                await sleep(5000);
            }
        }
    }
    async sendAlert(userId, transactionId, anomaly) {
        await this.redis.lpush(`user:${userId}:alerts`, JSON.stringify({
            transactionId,
            anomaly,
            timestamp: Date.now(),
            read: false,
        }));
    }
}
exports.BackgroundWorker = BackgroundWorker;
//# sourceMappingURL=backgroundWorker.js.map