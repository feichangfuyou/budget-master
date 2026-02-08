/**
 * Receipt OCR Processor — 0 tokens. Sharp preprocessing + Tesseract + optional Local AI categorization.
 */

import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { LocalAIEngine } from './localAIEngine.js';

export interface ReceiptData {
  rawText: string;
  merchant: string;
  amount: number;
  date: Date;
  category: string;
  items: Array<{ name: string; price: number; quantity?: number }>;
  tax?: number;
  tip?: number;
  confidence: number;
}

export class ReceiptOCRProcessor {
  private worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  private localAI: LocalAIEngine | null = null;

  async init(): Promise<void> {
    this.worker = await createWorker('eng', 1, { logger: () => {} });
    try {
      this.localAI = new LocalAIEngine();
      await this.localAI.init();
    } catch {
      this.localAI = null;
    }
  }

  async processReceipt(imageBuffer: Buffer): Promise<ReceiptData> {
    const preprocessed = await this.preprocessImage(imageBuffer);
    const worker = this.worker ?? (await createWorker('eng', 1, { logger: () => {} }));
    const {
      data: { text, confidence },
    } = await worker.recognize(preprocessed);
    const rawText = text || '';
    const conf = confidence ? confidence / 100 : 0.5;

    const lines = rawText.split(/\r?\n/).filter((l: string) => l.trim());
    let merchant = 'Unknown';
    let amount = 0;
    const items: Array<{ name: string; price: number; quantity?: number }> = [];

    const totalRegex = /(?:total|amount due|balance)\s*[\$:]?\s*([\d,]+\.?\d*)/i;
    const priceRegex = /[\$]?\s*([\d,]+\.?\d{2})/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const totalMatch = line.match(totalRegex);
      if (totalMatch) {
        amount = parseFloat(totalMatch[1].replace(/,/g, ''));
      }
      if (i < 3 && line.length > 2 && line.length < 50) {
        if (!/^\d|total|sub|tax|tip/i.test(line)) merchant = line.trim();
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
    if (amount <= 0) amount = 0;

    let category = inferCategory(merchant, items);
    if (category === 'Other' && this.localAI) {
      try {
        const desc = [merchant, ...items.map((i) => i.name)].join(' ');
        const result = await this.localAI.categorizeTransaction(desc);
        category = result.category;
      } catch {
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

  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(1500, undefined, { fit: 'inside', withoutEnlargement: false })
        .grayscale()
        .normalize()
        .threshold(128)
        .median(3)
        .toBuffer();
    } catch {
      return buffer;
    }
  }
}

function extractDate(text: string): Date {
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
      } catch {
        // continue
      }
    }
  }
  return new Date();
}

function inferCategory(
  merchant: string,
  items: Array<{ name: string; price: number }>
): string {
  const m = merchant.toLowerCase();
  if (/grocery|market|food|restaurant|cafe|coffee|pizza|burger/i.test(m))
    return 'Food';
  if (/gas|fuel|shell|chevron|exxon/i.test(m)) return 'Transport';
  if (/amazon|walmart|target|store/i.test(m)) return 'Shopping';
  if (/netflix|spotify|apple|subscription/i.test(m)) return 'Subscriptions';
  return 'Other';
}
