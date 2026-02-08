"use strict";
// ═══════════════════════════════════════════════════════════
// TOKEN-OPTIMIZED BUDGET AI — SEMANTIC CACHE + FALLBACK LLM
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenOptimizedBudgetAI = void 0;
const crypto = require("crypto");
const costTrackerServer_js_1 = require("./costTrackerServer.js");
const memoryCache = new Map();
function normalizePrompt(prompt) {
    return prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(please|can|you|tell|me|what|is|the|does|how|budget|spend|save)\b/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .trim() || '_';
}
function getContextHash(context) {
    return crypto.createHash('md5').update(context).digest('hex');
}
class TokenOptimizedBudgetAI {
    constructor() {
        this.initialized = false;
    }
    async init() {
        this.initialized = true;
    }
    async ask(prompt, context = '') {
        const key = `${normalizePrompt(prompt)}::${getContextHash(context)}`;
        const cached = memoryCache.get(key);
        if (cached) {
            (0, costTrackerServer_js_1.recordRequest)({ cost: 0, cacheHit: true });
            return cached.response;
        }
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            try {
                const { Anthropic } = await Promise.resolve().then(() => require('@anthropic-ai/sdk'));
                const client = new Anthropic({ apiKey });
                const msg = await client.messages.create({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 512,
                    messages: [{ role: 'user', content: `${prompt}\n\nContext: ${context || 'None'}` }],
                });
                const text = msg.content.find((c) => c.type === 'text')?.type === 'text'
                    ? msg.content.find((c) => c.type === 'text').text
                    : '';
                (0, costTrackerServer_js_1.recordRequest)({
                    cost: 0.00025 * ((msg.usage?.input_tokens ?? 0) / 1000) + 0.00125 * ((msg.usage?.output_tokens ?? 0) / 1000),
                    cacheHit: false,
                    inputTokens: msg.usage?.input_tokens ?? 0,
                    outputTokens: msg.usage?.output_tokens ?? 0,
                });
                memoryCache.set(key, { response: text, timestamp: Date.now() });
                return text;
            }
            catch (e) {
                console.warn('Anthropic fallback failed:', e);
            }
        }
        const fallback = 'Budget advice is limited without API key. Use the dashboard for anomaly detection and forecasts.';
        memoryCache.set(key, { response: fallback, timestamp: Date.now() });
        (0, costTrackerServer_js_1.recordRequest)({ cost: 0, cacheHit: false });
        return fallback;
    }
}
exports.TokenOptimizedBudgetAI = TokenOptimizedBudgetAI;
//# sourceMappingURL=tokenOptimizedAI.js.map