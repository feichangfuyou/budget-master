"use strict";
/**
 * Receipt OCR Processor — 0 tokens. Sharp preprocessing + Tesseract + optional Local AI categorization.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptOCRProcessor = void 0;
const tesseract_js_1 = require("tesseract.js");
const sharp_1 = require("sharp");
const localAIEngine_js_1 = require("./localAIEngine.js");
class ReceiptOCRProcessor {
    constructor() {
        this.worker = null;
        this.localAI = null;
    }
    async init() {
        this.worker = await (0, tesseract_js_1.createWorker)('eng', 1, { logger: () => { } });
        try {
            this.localAI = new localAIEngine_js_1.LocalAIEngine();
            await this.localAI.init();
        }
        catch {
            this.localAI = null;
        }
    }
    async processReceipt(imageBuffer) {
        const preprocessed = await this.preprocessImage(imageBuffer);
        const worker = this.worker ?? (await (0, tesseract_js_1.createWorker)('eng', 1, { logger: () => { } }));
        const { data: { text, confidence }, } = await worker.recognize(preprocessed);
        const rawText = text || '';
        const conf = confidence ? confidence / 100 : 0.5;
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
        let merchant = 'Unknown';
        let amount = 0;
        const items = [];
        const totalRegex = /(?:total|amount due|balance)\s*[\$:]?\s*([\d,]+\.?\d*)/i;
        const priceRegex = /[\$]?\s*([\d,]+\.?\d{2})/g;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const totalMatch = line.match(totalRegex);
            if (totalMatch) {
                amount = parseFloat(totalMatch[1].replace(/,/g, ''));
            }
            if (i < 3 && line.length > 2 && line.length < 50) {
                if (!/^\d|total|sub|tax|tip/i.test(line))
                    merchant = line.trim();
            }
            const prices = [...line.matchAll(priceRegex)];
            if (prices.length === 1 && !totalRegex.test(line)) {
                const p = parseFloat(prices[0][1].replace(/,/g, ''));
                if (p > 0 && p < 10000) {
                    items.push({ name: line.replace(priceRegex, '').trim() || 'Item', price: p });
                }
            }
        }
        if (amount <= 0 && items.length > 0) {
            amount = items.reduce((s, i) => s + i.price, 0);
        }
        if (amount <= 0)
            amount = 0;
        let category = inferCategory(merchant, items);
        if (category === 'Other' && this.localAI) {
            try {
                const desc = [merchant, ...items.map((i) => i.name)].join(' ');
                const result = await this.localAI.categorizeTransaction(desc);
                category = result.category;
            }
            catch {
                // keep Other
            }
        }
        const date = extractDate(rawText);
        return {
            rawText,
            merchant,
            amount,
            date,
            category,
            items,
            confidence: conf,
        };
    }
    async preprocessImage(buffer) {
        try {
            return await (0, sharp_1.default)(buffer)
                .resize(1500, undefined, { fit: 'inside', withoutEnlargement: false })
                .grayscale()
                .normalize()
                .threshold(128)
                .median(3)
                .toBuffer();
        }
        catch {
            return buffer;
        }
    }
}
exports.ReceiptOCRProcessor = ReceiptOCRProcessor;
function extractDate(text) {
    const patterns = [
        /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
        /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            try {
                return new Date(m[0]);
            }
            catch {
                // continue
            }
        }
    }
    return new Date();
}
function inferCategory(merchant, items) {
    const m = merchant.toLowerCase();
    if (/grocery|market|food|restaurant|cafe|coffee|pizza|burger/i.test(m))
        return 'Food';
    if (/gas|fuel|shell|chevron|exxon/i.test(m))
        return 'Transport';
    if (/amazon|walmart|target|store/i.test(m))
        return 'Shopping';
    if (/netflix|spotify|apple|subscription/i.test(m))
        return 'Subscriptions';
    return 'Other';
}
//# sourceMappingURL=receiptOcrProcessor.js.map