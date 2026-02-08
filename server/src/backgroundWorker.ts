// ═══════════════════════════════════════════════════════════
// 24/7 BACKGROUND WORKER (AUTO-PROCESSING PIPELINE)
// ═══════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';
import { RealtimeAnomalyDetector } from './anomalyDetector.js';
import { PredictiveBudgetEngine } from './predictiveBudget.js';
import { ReceiptOCRProcessor } from './receiptOCR.js';
import type { Transaction, AnomalyResult } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BackgroundWorker {
  private anomalyDetector: RealtimeAnomalyDetector;
  private budgetEngine: PredictiveBudgetEngine;
  private ocrProcessor: ReceiptOCRProcessor;
  private redis: Redis;
  private running = false;

  constructor() {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token) throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
    this.redis = new Redis({ url, token });
    this.anomalyDetector = new RealtimeAnomalyDetector();
    this.budgetEngine = new PredictiveBudgetEngine();
    this.ocrProcessor = new ReceiptOCRProcessor();
  }

  async start(): Promise<void> {
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

  async stop(): Promise<void> {
    this.running = false;
    await this.ocrProcessor.terminate();
    console.log('⏹️  Background worker stopped');
  }

  private async receiptProcessingWorker(): Promise<void> {
    while (this.running) {
      try {
        const receipt = await this.redis.lpop('receipt_queue');
        if (receipt) {
          const { userId, imageBuffer } = JSON.parse(receipt as string) as {
            userId: string;
            imageBuffer: string;
          };
          console.log(`📸 Processing receipt for user ${userId}`);
          const data = await this.ocrProcessor.processReceipt(
            Buffer.from(imageBuffer, 'base64')
          );
          const transaction: Transaction = {
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
          await this.redis.lpush(
            'anomaly_queue',
            JSON.stringify({ userId, transactionId: transaction.id })
          );
        }
        await sleep(1000);
      } catch (error) {
        console.error('Receipt processing error:', error);
        await sleep(5000);
      }
    }
  }

  private async anomalyDetectionWorker(): Promise<void> {
    while (this.running) {
      try {
        const item = await this.redis.lpop('anomaly_queue');
        if (item) {
          const { userId, transactionId } = JSON.parse(item as string) as {
            userId: string;
            transactionId: string;
          };
          const txData = await this.redis.hget(`user:${userId}:transactions`, transactionId);
          if (!txData) {
            await sleep(100);
            continue;
          }
          const transaction = JSON.parse(txData as string) as Transaction;
          transaction.date = new Date(transaction.date);

          const historyKeys = (await this.redis.hkeys(`user:${userId}:transactions`)) as string[];
          const historyData = await Promise.all(
            historyKeys.map((k) => this.redis.hget(`user:${userId}:transactions`, k))
          );
          const history = historyData
            .filter(Boolean)
            .map((d) => {
              const t = JSON.parse(d as string) as Transaction;
              t.date = new Date(t.date);
              return t;
            })
            .filter((t) => t.id !== transactionId);

          const anomalies = await this.anomalyDetector.detect(transaction, history);
          if (anomalies.length > 0) {
            console.log(`🚨 ${anomalies.length} anomalies detected for transaction ${transactionId}`);
            for (const anomaly of anomalies) {
              if (anomaly.severity === 'high' || anomaly.severity === 'critical') {
                await this.redis.lpush(
                  'alert_queue',
                  JSON.stringify({ userId, transactionId, anomaly })
                );
              }
            }
          }
        }
        await sleep(500);
      } catch (error) {
        console.error('Anomaly detection error:', error);
        await sleep(5000);
      }
    }
  }

  private async budgetForecastWorker(): Promise<void> {
    while (this.running) {
      try {
        console.log('📊 Generating budget forecasts...');
        const userKeys = (await this.redis.keys('user:*:transactions')) as string[];
        for (const userKey of userKeys.slice(0, 10)) {
          const parts = userKey.split(':');
          const userId = parts[1];
          if (!userId) continue;
          const txKeys = (await this.redis.hkeys(userKey)) as string[];
          const txData = await Promise.all(
            txKeys.map((k) => this.redis.hget(userKey, k))
          );
          const transactions = txData
            .filter(Boolean)
            .map((d) => {
              const t = JSON.parse(d as string) as Transaction;
              t.date = new Date(t.date);
              return t;
            });

          const categories = Array.from(
            new Set(transactions.map((t) => t.category).filter(Boolean))
          ) as string[];

          for (const category of categories) {
            const forecast = await this.budgetEngine.forecast(
              category,
              transactions,
              30
            );
            await this.redis.setex(
              `user:${userId}:forecast:${category}`,
              21600,
              JSON.stringify(forecast)
            );
            console.log(`✅ Forecast generated for ${userId} - ${category}`);
          }
        }
        await sleep(21600000); // 6 hours
      } catch (error) {
        console.error('Budget forecast error:', error);
        await sleep(300000);
      }
    }
  }

  private async alertNotificationWorker(): Promise<void> {
    while (this.running) {
      try {
        const alert = await this.redis.lpop('alert_queue');
        if (alert) {
          const { userId, transactionId, anomaly } = JSON.parse(alert as string) as {
            userId: string;
            transactionId: string;
            anomaly: AnomalyResult;
          };
          await this.sendAlert(userId, transactionId, anomaly);
          console.log(`📧 Alert sent to user ${userId} for transaction ${transactionId}`);
        }
        await sleep(1000);
      } catch (error) {
        console.error('Alert notification error:', error);
        await sleep(5000);
      }
    }
  }

  private async sendAlert(
    userId: string,
    transactionId: string,
    anomaly: AnomalyResult
  ): Promise<void> {
    await this.redis.lpush(
      `user:${userId}:alerts`,
      JSON.stringify({
        transactionId,
        anomaly,
        timestamp: Date.now(),
        read: false,
      })
    );
  }
}
