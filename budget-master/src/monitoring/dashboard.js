"use strict";
/**
 * CLI dashboard for cost and usage (reads from Redis if configured).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDashboard = generateDashboard;
const redis_1 = require("@upstash/redis");
async function generateDashboard() {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    let dailyCost = 0;
    let queries = 0;
    if (redisUrl && redisToken) {
        const redis = new redis_1.Redis({ url: redisUrl, token: redisToken });
        const today = new Date().toISOString().split('T')[0];
        const cost = await redis.hget(`daily:${today}`, 'cost');
        const q = await redis.hget(`daily:${today}`, 'queries');
        dailyCost = Number(cost ?? 0) / 100;
        queries = Number(q ?? 0);
    }
    const today = new Date().toISOString().split('T')[0];
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   BUDGET MASTER DASHBOARD                 ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  📅 Date: ${today}                                        ║
║  💰 Cost Today: $${dailyCost.toFixed(2).padStart(8)}                        ║
║  📊 Queries: ${String(queries).padStart(10)}                            ║
║                                                           ║
║  🎯 TARGETS:                                              ║
║     Daily: $1.75  |  Monthly: $52.50                     ║
║                                                           ║
║  ⚡ OPTIMIZATIONS ACTIVE:                                 ║
║     ✅ Semantic Cache (when Upstash Vector set)           ║
║     ✅ Local AI (simple Q&A without API)                  ║
║     ✅ Context Pruning                                    ║
║                                                           ║
║  🚀 ZERO-TOKEN FEATURES:                                  ║
║     ✅ Anomaly Detection (Pure statistics)                ║
║     ✅ Budget Forecasting (Trend engine)                  ║
║     ✅ Receipt OCR (Tesseract.js)                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
}
//# sourceMappingURL=dashboard.js.map