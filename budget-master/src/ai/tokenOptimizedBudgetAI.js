"use strict";
/**
 * Layer 8: Token-Optimized Budget AI — master orchestrator.
 * Semantic cache → Local AI → Context prune → Compress → Route → Stream + cache.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenOptimizedBudgetAI = void 0;
const sdk_1 = require("@anthropic-ai/sdk");
const localAIEngine_js_1 = require("./localAIEngine.js");
const semanticCache_js_1 = require("./semanticCache.js");
const contextOptimizer_js_1 = require("./contextOptimizer.js");
const promptCompressor_js_1 = require("./promptCompressor.js");
const intelligentRouter_js_1 = require("./intelligentRouter.js");
const streamingCache_js_1 = require("./streamingCache.js");
function formatRelevant(txs, maxLen = 30) {
    return txs
        .map((t) => `${new Date(t.date).toISOString().slice(0, 10)}|${t.category ?? '?'}|$${t.amount.toFixed(2)}|${(t.description ?? '').slice(0, maxLen)}`)
        .join('\n');
}
async function hashQuery(query) {
    const enc = new TextEncoder();
    const data = enc.encode(query);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
function tryLocalAnswer(query, txs) {
    const q = query.toLowerCase();
    const amounts = txs.map((t) => t.amount);
    const total = amounts.reduce((a, b) => a + b, 0);
    const avg = txs.length ? total / txs.length : 0;
    if (/\bhow much\b.*\bspent\b|\btotal\b.*\bspend\b|\bspending\b.*\btotal\b/i.test(q)) {
        return `Total spending in this period: $${total.toFixed(2)} across ${txs.length} transactions. Average per transaction: $${avg.toFixed(2)}.`;
    }
    if (/\bhow many\b.*\btransaction/i.test(q)) {
        return `You have ${txs.length} transactions in this set.`;
    }
    return null;
}
class TokenOptimizedBudgetAI {
    constructor() {
        this.anthropic = null;
        this.metrics = {
            totalQueries: 0,
            cacheHits: 0,
            localAIHits: 0,
            haikuCalls: 0,
            sonnetCalls: 0,
            opusCalls: 0,
            cloudCalls: 0,
            estimatedCostUsd: 0,
            lastReset: new Date().toISOString(),
        };
        this.localAI = new localAIEngine_js_1.LocalAIEngine();
        this.semanticCache = new semanticCache_js_1.SemanticCache({}, this.localAI);
        this.contextOptimizer = new contextOptimizer_js_1.ContextOptimizer(this.localAI);
        this.compressor = new promptCompressor_js_1.PromptCompressor();
        this.router = new intelligentRouter_js_1.IntelligentRouter();
    }
    async init() {
        await this.localAI.init();
        if (process.env.ANTHROPIC_API_KEY) {
            this.anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
        }
    }
    async *query(userQuery, txs, userId = 'global') {
        this.metrics.totalQueries += 1;
        const cached = await this.semanticCache.query(userQuery, userId);
        if (cached != null) {
            this.metrics.cacheHits += 1;
            yield cached;
            return;
        }
        const simpleLocal = tryLocalAnswer(userQuery, txs);
        if (simpleLocal != null) {
            this.metrics.localAIHits += 1;
            await this.semanticCache.store(userQuery, simpleLocal, userId);
            yield simpleLocal;
            return;
        }
        const tier = this.router.route(userQuery, { transactions: txs });
        if (tier === 'local') {
            const tx = txs.find((t) => !t.category) ?? txs[0];
            if (tx) {
                const result = await this.localAI.categorizeTransaction(tx.description);
                const text = `Category: ${result.category} (confidence ${(result.confidence * 100).toFixed(1)}%)${result.merchant ? `. Merchant: ${result.merchant}` : ''}`;
                this.metrics.localAIHits += 1;
                await this.semanticCache.store(userQuery, text, userId);
                yield text;
                return;
            }
        }
        if (!this.anthropic) {
            const fallback = 'Configure ANTHROPIC_API_KEY for full AI. Summary: ' + (txs.length ? `${txs.length} transactions.` : 'No transactions.');
            yield fallback;
            return;
        }
        this.metrics.cloudCalls += 1;
        const { relevant, summary, metadata } = await this.contextOptimizer.prepareContext(txs, userQuery);
        const compressedSummary = this.compressor.compress(summary, 0.6);
        const modelTier = tier === 'local' ? 'haiku' : tier;
        const modelConfig = intelligentRouter_js_1.MODELS[modelTier];
        this.recordModelUsage(modelTier);
        this.metrics.estimatedCostUsd += (modelConfig.costPer1MTokens * (metadata.totalTransactions / 250000)) + 0.001;
        const prompt = `Q: ${userQuery}\n\nRecent transactions (${relevant.length}):\n${formatRelevant(relevant)}\n\n${compressedSummary}\n\nStats: ${metadata.totalTransactions} total, $${metadata.totalAmount.toFixed(2)} spent. Answer concisely.`;
        const cacheKey = `query:${await hashQuery(userQuery)}`;
        const redis = (0, streamingCache_js_1.getStreamingCacheRedis)();
        const self = this;
        yield* (0, streamingCache_js_1.streamWithCache)(this.anthropic, [{ role: 'user', content: prompt }], modelConfig.name, Math.min(modelConfig.maxTokens, 1024), {
            redis,
            cacheKey,
            ttlSeconds: 3600,
            onComplete: (fullResponse) => self.semanticCache.store(userQuery, fullResponse, userId),
        });
    }
    recordModelUsage(tier) {
        if (tier === 'haiku')
            this.metrics.haikuCalls += 1;
        else if (tier === 'sonnet')
            this.metrics.sonnetCalls += 1;
        else if (tier === 'opus')
            this.metrics.opusCalls += 1;
    }
    getMetrics() {
        return { ...this.metrics };
    }
}
exports.TokenOptimizedBudgetAI = TokenOptimizedBudgetAI;
//# sourceMappingURL=tokenOptimizedBudgetAI.js.map