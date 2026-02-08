"use strict";
// ═══════════════════════════════════════════════════════════
// PREDICTIVE BUDGETING (0 TOKENS - TENSORFLOW.JS)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictiveBudgetEngine = void 0;
const tf = require("@tensorflow/tfjs-node");
const redis_1 = require("@upstash/redis");
class PredictiveBudgetEngine {
    constructor() {
        this.models = new Map();
        const url = process.env.UPSTASH_REDIS_URL;
        const token = process.env.UPSTASH_REDIS_TOKEN;
        if (!url || !token)
            throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
        this.redis = new redis_1.Redis({ url, token });
    }
    async forecast(category, transactions, daysAhead = 30) {
        const categoryTxs = transactions
            .filter((t) => t.category === category)
            .sort((a, b) => (a.date instanceof Date ? a.date : new Date(a.date)).getTime() -
            (b.date instanceof Date ? b.date : new Date(b.date)).getTime());
        if (categoryTxs.length < 30) {
            return this.insufficientDataForecast(category);
        }
        const dailySpending = this.aggregateByDay(categoryTxs);
        const model = await this.getOrTrainModel(category, dailySpending);
        const predictions = await this.generatePredictions(model, dailySpending, daysAhead);
        const trend = this.detectTrend(dailySpending);
        const seasonality = this.detectSeasonality(dailySpending);
        const recommendations = this.generateRecommendations(category, predictions, trend, seasonality);
        return {
            category,
            predictions,
            trend: trend.direction,
            trendStrength: trend.strength,
            seasonality,
            recommendations,
        };
    }
    aggregateByDay(transactions) {
        const dailyMap = new Map();
        for (const tx of transactions) {
            const d = tx.date instanceof Date ? tx.date : new Date(tx.date);
            const dateKey = d.toISOString().split('T')[0];
            dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + tx.amount);
        }
        const sorted = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        if (sorted.length === 0)
            return [];
        const start = new Date(sorted[0][0]);
        const end = new Date(sorted[sorted.length - 1][0]);
        const result = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = d.toISOString().split('T')[0];
            result.push({
                date: new Date(d),
                amount: dailyMap.get(key) ?? 0,
            });
        }
        return result;
    }
    async getOrTrainModel(category, data) {
        const existing = this.models.get(category);
        if (existing)
            return existing;
        try {
            const modelPath = `file://./models/${category}`;
            const model = await tf.loadLayersModel(modelPath + '/model.json');
            this.models.set(category, model);
            return model;
        }
        catch {
            const model = await this.trainModel(data);
            this.models.set(category, model);
            try {
                await model.save(`file://./models/${category}`);
            }
            catch {
                // ignore save errors (e.g. no fs in serverless)
            }
            return model;
        }
    }
    async trainModel(data) {
        const lookback = 14;
        const { inputs, targets } = this.prepareSequences(data, lookback);
        const model = tf.sequential({
            layers: [
                tf.layers.lstm({
                    units: 32,
                    returnSequences: true,
                    inputShape: [lookback, 1],
                }),
                tf.layers.dropout({ rate: 0.2 }),
                tf.layers.lstm({ units: 16, returnSequences: false }),
                tf.layers.dropout({ rate: 0.2 }),
                tf.layers.dense({ units: 1 }),
            ],
        });
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae'],
        });
        await model.fit(inputs, targets, {
            epochs: 50,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 10 === 0 && logs?.loss != null) {
                        console.log(`Epoch ${epoch}: loss = ${Number(logs.loss).toFixed(4)}`);
                    }
                },
            },
        });
        inputs.dispose();
        targets.dispose();
        return model;
    }
    prepareSequences(data, lookback) {
        const sequences = [];
        const targets = [];
        const amounts = data.map((d) => d.amount);
        const max = Math.max(...amounts);
        const min = Math.min(...amounts);
        const range = max - min + 1e-8;
        const normalized = amounts.map((a) => (a - min) / range);
        for (let i = 0; i < normalized.length - lookback; i++) {
            sequences.push(normalized.slice(i, i + lookback));
            targets.push(normalized[i + lookback]);
        }
        const inputTensor = tf.tensor3d(sequences.map((s) => s.map((v) => [v])));
        const targetTensor = tf.tensor2d(targets.map((t) => [t]));
        return { inputs: inputTensor, targets: targetTensor };
    }
    async generatePredictions(model, history, daysAhead) {
        const lookback = 14;
        const amounts = history.map((d) => d.amount);
        const max = Math.max(...amounts);
        const min = Math.min(...amounts);
        const range = max - min + 1e-8;
        let sequence = amounts
            .slice(-lookback)
            .map((a) => (a - min) / range);
        const lastDate = history[history.length - 1].date;
        const predictions = [];
        const recentAmounts = amounts.slice(-30);
        const stdDev = this.calculateStdDev(recentAmounts);
        for (let i = 0; i < daysAhead; i++) {
            const input = tf.tensor3d([sequence.map((v) => [v])]);
            const pred = model.predict(input);
            const predValue = (await pred.data())[0];
            input.dispose();
            pred.dispose();
            const actual = predValue * range + min;
            const lower = Math.max(0, actual - 1.96 * stdDev);
            const upper = actual + 1.96 * stdDev;
            const predDate = new Date(lastDate);
            predDate.setDate(predDate.getDate() + i + 1);
            predictions.push({
                date: predDate,
                predicted: Math.round(actual * 100) / 100,
                confidence: {
                    lower: Math.round(lower * 100) / 100,
                    upper: Math.round(upper * 100) / 100,
                },
            });
            sequence = [...sequence.slice(1), predValue];
        }
        return predictions;
    }
    detectTrend(data) {
        if (data.length < 7)
            return { direction: 'stable', strength: 0 };
        const x = data.map((_, i) => i);
        const y = data.map((d) => d.amount);
        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX + 1e-10);
        const intercept = (sumY - slope * sumX) / n;
        const yMean = sumY / n;
        const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
        const ssRes = y.reduce((sum, yi, i) => {
            const predicted = slope * x[i] + intercept;
            return sum + Math.pow(yi - predicted, 2);
        }, 0);
        const rSquared = ssTotal > 0 ? 1 - ssRes / ssTotal : 0;
        const direction = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
        return { direction, strength: Math.abs(rSquared) };
    }
    detectSeasonality(data) {
        if (data.length < 28)
            return false;
        const series = data.map((d) => d.amount);
        const weeklyCorr = this.autocorrelation(series, 7);
        const monthlyCorr = this.autocorrelation(series, 30);
        return weeklyCorr > 0.3 || monthlyCorr > 0.3;
    }
    autocorrelation(series, lag) {
        if (series.length <= lag)
            return 0;
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < series.length - lag; i++) {
            numerator += (series[i] - mean) * (series[i + lag] - mean);
        }
        for (let i = 0; i < series.length; i++) {
            denominator += Math.pow(series[i] - mean, 2);
        }
        return denominator > 0 ? numerator / denominator : 0;
    }
    generateRecommendations(category, predictions, trend, seasonality) {
        const recs = [];
        const totalPredicted = predictions.reduce((sum, p) => sum + p.predicted, 0);
        const avgDaily = predictions.length > 0 ? totalPredicted / predictions.length : 0;
        if (trend.direction === 'increasing' && trend.strength > 0.5) {
            recs.push(`📈 ${category} spending is trending up (+${(trend.strength * 100).toFixed(0)}% confidence). Expected ${(avgDaily * 30).toFixed(0)}/month. Consider setting a budget cap.`);
        }
        else if (trend.direction === 'decreasing' && trend.strength > 0.5) {
            recs.push(`📉 Great job! ${category} spending is trending down. You're on track to save $${(avgDaily * 30).toFixed(0)}/month.`);
        }
        if (seasonality) {
            recs.push(`🔄 ${category} shows seasonal patterns. Budget for peak periods.`);
        }
        const categoryAdvice = {
            dining: 'Try meal prepping on Sundays to reduce dining out costs',
            groceries: 'Shop with a list and avoid grocery runs when hungry',
            entertainment: 'Look for free local events or streaming alternatives',
            transport: 'Consider carpooling or public transit for regular commutes',
            utilities: 'Check for energy-efficient upgrades and smart thermostats',
        };
        if (categoryAdvice[category]) {
            recs.push(`💡 ${categoryAdvice[category]}`);
        }
        return recs;
    }
    insufficientDataForecast(category) {
        return {
            category,
            predictions: [],
            trend: 'stable',
            trendStrength: 0,
            seasonality: false,
            recommendations: [
                `Need more transaction history for ${category} to generate accurate predictions. Keep tracking!`,
            ],
        };
    }
    calculateStdDev(values) {
        if (values.length === 0)
            return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }
    async exportModel(category) {
        const model = this.models.get(category);
        if (model) {
            await model.save(`file://./models/${category}`);
            console.log(`✅ Model saved for ${category}`);
        }
    }
}
exports.PredictiveBudgetEngine = PredictiveBudgetEngine;
//# sourceMappingURL=predictiveBudget.js.map