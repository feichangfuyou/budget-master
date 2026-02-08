"use strict";
/**
 * Layer 0: Local AI Engine — 0 tokens.
 * Rule-based categorization + optional @xenova/transformers (zero-shot, NER, embeddings).
 * Fallback: rules and deterministic pseudo-embedding when transformers unavailable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAIEngine = void 0;
const CATEGORY_KEYWORDS = {
    groceries: [
        'grocery', 'supermarket', 'market', 'whole foods', 'trader joe', 'kroger',
        'safeway', 'aldi', 'costco', 'walmart', 'food', 'produce',
    ],
    dining: [
        'restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'sushi', 'grill', 'bar',
        'pub', 'doordash', 'uber eats', 'grubhub', 'eat', 'dine',
    ],
    entertainment: [
        'netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'movie', 'game',
        'steam', 'xbox', 'playstation', 'concert', 'theater',
    ],
    transport: [
        'gas', 'fuel', 'uber', 'lyft', 'parking', 'transit', 'metro', 'bus',
        'train', 'airline', 'flight',
    ],
    utilities: [
        'electric', 'water', 'gas bill', 'internet', 'phone', 'verizon', 'att',
        'comcast',
    ],
    shopping: [
        'amazon', 'ebay', 'target', 'best buy', 'apple store', 'shop', 'store',
    ],
    healthcare: [
        'pharmacy', 'cvs', 'walgreens', 'doctor', 'hospital', 'medical', 'gym',
        'fitness', 'health',
    ],
    travel: ['hotel', 'airbnb', 'booking', 'travel', 'vacation'],
};
const CANDIDATE_LABELS = Object.keys(CATEGORY_KEYWORDS);
const EMBEDDING_DIM = 384;
class LocalAIEngine {
    constructor() {
        this.initialized = false;
        this.pipeline = {};
    }
    async init() {
        if (this.initialized)
            return;
        try {
            const mod = await Promise.resolve().then(() => require('@xenova/transformers'));
            const pipeline = mod.pipeline;
            const env = mod.env;
            if (env) {
                env.allowLocalModels = true;
                env.allowRemoteModels = true;
            }
            const feat = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true }));
            this.pipeline.featureExtraction = async (text, opts) => feat(text, opts);
            const zs = (await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', { quantized: true }));
            this.pipeline.zeroShot = async (text, labels) => zs(text, { candidate_labels: labels });
            const ner = (await pipeline('token-classification', 'Xenova/bert-base-NER', { quantized: true }));
            this.pipeline.ner = (text) => ner(text);
        }
        catch (e) {
            console.warn('LocalAIEngine: transformers not loaded, using rules and pseudo-embedding:', e.message);
        }
        this.initialized = true;
    }
    async categorizeTransaction(description) {
        const lower = description.toLowerCase();
        if (this.pipeline.zeroShot && this.pipeline.ner) {
            try {
                const [zeroshot, entities] = await Promise.all([
                    this.pipeline.zeroShot(lower, CANDIDATE_LABELS),
                    this.pipeline.ner(lower),
                ]);
                const category = zeroshot.labels[0] ?? 'other';
                const confidence = zeroshot.scores[0] ?? 0.5;
                const merchant = this.extractMerchantFromEntities(entities);
                const amount = this.extractAmount(description);
                return { category, confidence, merchant, amount };
            }
            catch {
                // fall through to rules
            }
        }
        for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            if (keywords.some((kw) => lower.includes(kw))) {
                return {
                    category,
                    confidence: 0.9,
                    amount: this.extractAmount(description),
                };
            }
        }
        return {
            category: 'other',
            confidence: 0.5,
            amount: this.extractAmount(description),
        };
    }
    async generateEmbedding(text) {
        if (this.pipeline.featureExtraction) {
            try {
                const output = await this.pipeline.featureExtraction(text, {
                    pooling: 'mean',
                    normalize: true,
                });
                return Array.from(output.data);
            }
            catch {
                // fall through to pseudo-embedding
            }
        }
        return this.pseudoEmbedding(text);
    }
    pseudoEmbedding(text) {
        const tokens = text.toLowerCase().match(/\b\w+\b/g) ?? [];
        const vec = new Array(EMBEDDING_DIM).fill(0);
        const bucketSize = Math.max(1, Math.floor(EMBEDDING_DIM / 16));
        for (let i = 0; i < tokens.length; i++) {
            const hash = this.hashString(tokens[i]);
            const bucket = Math.abs(hash) % EMBEDDING_DIM;
            vec[bucket] = (vec[bucket] ?? 0) + 1;
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map((v) => v / norm);
    }
    hashString(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = (h << 5) - h + s.charCodeAt(i);
            h |= 0;
        }
        return h;
    }
    extractMerchantFromEntities(entities) {
        const org = entities.find((e) => e.entity === 'ORG' || e.entity?.endsWith('ORG'));
        return org?.word;
    }
    extractAmount(text) {
        const match = text.match(/\$?([\d,]+\.?\d*)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : undefined;
    }
}
exports.LocalAIEngine = LocalAIEngine;
//# sourceMappingURL=localAIEngine.js.map