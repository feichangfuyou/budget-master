"use strict";
// ═══════════════════════════════════════════════════════════
// OCR RECEIPT PROCESSING (0 TOKENS - TESSERACT + LOCAL AI)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptOCRProcessor = void 0;
const tesseract_js_1 = require("tesseract.js");
const sharp_1 = require("sharp");
const localAI_js_1 = require("./localAI.js");
class ReceiptOCRProcessor {
    constructor() {
        this.worker = null;
        this.localAI = new localAI_js_1.LocalAIEngine();
    }
    async init() {
        this.worker = await tesseract_js_1.default.createWorker('eng');
        await this.localAI.init();
        console.log('📸 OCR processor initialized');
    }
    async processReceipt(imageBuffer) {
        if (!this.worker)
            await this.init();
        const preprocessed = await this.preprocessImage(imageBuffer);
        const { data } = await this.worker.recognize(preprocessed);
        const rawText = data.text;
        const extracted = this.extractReceiptData(rawText);
        if (!extracted.category && extracted.merchant) {
            const categoryResult = await this.localAI.categorizeTransaction(`${extracted.merchant} ${extracted.items.map((i) => i.name).join(' ')}`);
            extracted.category = categoryResult.category;
        }
        return {
            ...extracted,
            rawText,
            confidence: data.confidence / 100,
        };
    }
    async preprocessImage(buffer) {
        return (0, sharp_1.default)(buffer)
            .resize(1500, undefined, { fit: 'inside', withoutEnlargement: false })
            .greyscale()
            .normalize()
            .threshold(128)
            .median(3)
            .toBuffer();
    }
    extractReceiptData(text) {
        const lines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        return {
            merchant: this.extractMerchant(lines),
            date: this.extractDate(text),
            amount: this.extractTotal(text),
            items: this.extractLineItems(lines),
            tax: this.extractTax(text),
            tip: this.extractTip(text),
        };
    }
    extractMerchant(lines) {
        const keywords = ['store', 'shop', 'market', 'restaurant', 'cafe', 'inc', 'llc', 'ltd'];
        for (const line of lines.slice(0, 5)) {
            const lower = line.toLowerCase();
            if (keywords.some((kw) => lower.includes(kw)))
                return line;
            if (line === line.toUpperCase() && line.split(/\s+/).length >= 2)
                return line;
        }
        return lines[0] ?? 'Unknown Merchant';
    }
    extractDate(text) {
        const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
            /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                try {
                    return new Date(match[0]);
                }
                catch {
                    //
                }
            }
        }
        return new Date();
    }
    extractTotal(text) {
        const totalPatterns = [
            /total[:\s]*\$?\s*(\d+\.?\d*)/i,
            /amount[:\s]*\$?\s*(\d+\.?\d*)/i,
            /balance[:\s]*\$?\s*(\d+\.?\d*)/i,
            /grand\s+total[:\s]*\$?\s*(\d+\.?\d*)/i,
        ];
        for (const pattern of totalPatterns) {
            const match = text.match(pattern);
            if (match)
                return parseFloat(match[1]);
        }
        const amounts = text.match(/\$?\d+\.\d{2}/g) ?? [];
        const values = amounts.map((a) => parseFloat(a.replace('$', '')));
        return values.length > 0 ? Math.max(...values, 0) : 0;
    }
    extractLineItems(lines) {
        const items = [];
        for (const line of lines) {
            if (/^(subtotal|tax|tip|total|thank you|receipt)/i.test(line))
                continue;
            const match = line.match(/^(.+?)\s+(\d*\.?\d+)\s*$/);
            if (match) {
                const name = match[1].trim();
                const price = parseFloat(match[2]);
                const qtyMatch = name.match(/(\d+)\s*x\s*(.+)/i);
                if (qtyMatch) {
                    items.push({
                        name: qtyMatch[2].trim(),
                        price,
                        quantity: parseInt(qtyMatch[1], 10),
                    });
                }
                else {
                    items.push({ name, price });
                }
            }
        }
        return items;
    }
    extractTax(text) {
        const match = text.match(/tax[:\s]*\$?\s*(\d+\.?\d*)/i);
        return match ? parseFloat(match[1]) : undefined;
    }
    extractTip(text) {
        const match = text.match(/tip[:\s]*\$?\s*(\d+\.?\d*)/i);
        return match ? parseFloat(match[1]) : undefined;
    }
    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}
exports.ReceiptOCRProcessor = ReceiptOCRProcessor;
//# sourceMappingURL=receiptOCR.js.map