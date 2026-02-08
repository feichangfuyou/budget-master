"use strict";
// ═══════════════════════════════════════════════════════════
// LOCAL AI ENGINE (0 TOKENS — RULE-BASED CATEGORIZATION)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAIEngine = void 0;
const CATEGORY_KEYWORDS = {
    dining: ['restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'sushi', 'grill', 'bar', 'pub', 'food', 'eat', 'dine', 'doordash', 'uber eats', 'grubhub'],
    groceries: ['grocery', 'supermarket', 'market', 'whole foods', 'trader joe', 'kroger', 'safeway', 'aldi', 'costco', 'walmart'],
    entertainment: ['netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'movie', 'game', 'steam', 'xbox', 'playstation', 'concert', 'theater'],
    transport: ['gas', 'fuel', 'uber', 'lyft', 'parking', 'transit', 'metro', 'bus', 'train', 'airline', 'flight'],
    utilities: ['electric', 'water', 'gas bill', 'internet', 'phone', 'verizon', 'att', 'comcast'],
    shopping: ['amazon', 'ebay', 'target', 'best buy', 'apple store', 'shop', 'store'],
    health: ['pharmacy', 'cvs', 'walgreens', 'doctor', 'hospital', 'medical', 'gym', 'fitness'],
    subscriptions: ['subscription', 'monthly', 'annual', 'recurring'],
};
class LocalAIEngine {
    constructor() {
        this.initialized = false;
    }
    async init() {
        this.initialized = true;
    }
    async categorizeTransaction(description) {
        const lower = description.toLowerCase();
        for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            if (keywords.some((kw) => lower.includes(kw))) {
                return { category };
            }
        }
        return { category: 'other' };
    }
}
exports.LocalAIEngine = LocalAIEngine;
//# sourceMappingURL=localAI.js.map