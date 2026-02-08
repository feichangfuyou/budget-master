"use strict";
/**
 * Layer 1: Vector semantic cache — one-time embedding cost, 0 tokens on hit.
 * Upstash Vector + Redis. No-op when UPSTASH_VECTOR_* or UPSTASH_REDIS_* missing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticCache = void 0;
const vector_1 = require("@upstash/vector");
const redis_1 = require("@upstash/redis");
const localAIEngine_js_1 = require("./localAIEngine.js");
class SemanticCache {
    constructor(config = {}, localAI) {
        this.vector = null;
        this.redis = null;
        this.localAI = localAI ?? new localAIEngine_js_1.LocalAIEngine();
        this.threshold = config.similarityThreshold ?? 0.92;
        this.defaultTtl = config.defaultTtlSeconds ?? 86400 * 7;
        const vectorUrl = config.vectorUrl ?? process.env.UPSTASH_VECTOR_URL;
        const vectorToken = config.vectorToken ?? process.env.UPSTASH_VECTOR_TOKEN;
        const redisUrl = config.redisUrl ?? process.env.UPSTASH_REDIS_URL;
        const redisToken = config.redisToken ?? process.env.UPSTASH_REDIS_TOKEN;
        this.enabled = !!(vectorUrl && vectorToken && redisUrl && redisToken);
        if (this.enabled) {
            try {
                this.vector = new vector_1.Index({ url: vectorUrl, token: vectorToken });
                this.redis = new redis_1.Redis({ url: redisUrl, token: redisToken });
            }
            catch (e) {
                console.warn('SemanticCache: Upstash client init failed, cache disabled:', e.message);
                this.enabled = false;
            }
        }
    }
    async query(userQuery, userId = 'global') {
        if (!this.enabled || !this.vector)
            return null;
        try {
            const embedding = await this.localAI.generateEmbedding(userQuery);
            const results = await this.vector.query({
                vector: embedding,
                topK: 1,
                includeMetadata: true,
            });
            const first = results[0];
            const score = first?.score ?? 0;
            if (score >= this.threshold && first?.metadata?.response) {
                return first.metadata.response;
            }
            return null;
        }
        catch (e) {
            console.warn('SemanticCache query failed:', e.message);
            return null;
        }
    }
    async store(query, response, userId = 'global', ttlSeconds) {
        if (!this.enabled || !this.vector || !this.redis)
            return;
        const ttl = ttlSeconds ?? this.defaultTtl;
        try {
            const embedding = await this.localAI.generateEmbedding(query);
            const id = crypto.randomUUID();
            await this.vector.upsert([
                {
                    id,
                    vector: embedding,
                    metadata: { query, response, timestamp: Date.now(), userId },
                },
            ]);
            await this.redis.setex(`cache:${id}`, ttl, JSON.stringify({ query, response }));
        }
        catch (e) {
            console.warn('SemanticCache store failed:', e.message);
        }
    }
    isEnabled() {
        return this.enabled;
    }
    estimateTokensSaved(text) {
        return Math.ceil(text.length / 4);
    }
}
exports.SemanticCache = SemanticCache;
//# sourceMappingURL=semanticCache.js.map