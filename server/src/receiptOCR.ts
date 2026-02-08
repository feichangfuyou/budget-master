// ═══════════════════════════════════════════════════════════
// OCR RECEIPT PROCESSING (0 TOKENS - TESSERACT + LOCAL AI)
// ═══════════════════════════════════════════════════════════

import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { LocalAIEngine } from './localAI.js';
import type { ReceiptData } from './types.js';

export class ReceiptOCRProcessor {
  private worker: Tesseract.Worker | null = null;
  private localAI: LocalAIEngine;

  constructor() {
    this.localAI = new LocalAIEngine();
  }

  async init(): Promise<void> {
    this.worker = await Tesseract.createWorker('eng');
    await this.localAI.init();
    console.log('📸 OCR processor initialized');
  }

  async processReceipt(imageBuffer: Buffer): Promise<ReceiptData> {
    if (!this.worker) await this.init();

    const preprocessed = await this.preprocessImage(imageBuffer);
    const { data } = await this.worker!.recognize(preprocessed);
    const rawText = data.text;
    const extracted = this.extractReceiptData(rawText);

    if (!extracted.category && extracted.merchant) {
      const categoryResult = await this.localAI.categorizeTransaction(
        `${extracted.merchant} ${extracted.items.map((i) => i.name).join(' ')}`
      );
      extracted.category = categoryResult.category;
    }

    return {
      ...extracted,
      rawText,
      confidence: data.confidence / 100,
    };
  }

  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(1500, undefined, { fit: 'inside', withoutEnlargement: false })
      .greyscale()
      .normalize()
      .threshold(128)
      .median(3)
      .toBuffer();
  }

  private extractReceiptData(
    text: string
  ): Omit<ReceiptData, 'rawText' | 'confidence'> {
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

  private extractMerchant(lines: string[]): string {
    const keywords = ['store', 'shop', 'market', 'restaurant', 'cafe', 'inc', 'llc', 'ltd'];
    for (const line of lines.slice(0, 5)) {
      const lower = line.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) return line;
      if (line === line.toUpperCase() && line.split(/\s+/).length >= 2) return line;
    }
    return lines[0] ?? 'Unknown Merchant';
  }

  private extractDate(text: string): Date {
    const patterns = [
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          return new Date(match[0]!);
        } catch {
          //
        }
      }
    }
    return new Date();
  }

  private extractTotal(text: string): number {
    const totalPatterns = [
      /total[:\s]*\$?\s*(\d+\.?\d*)/i,
      /amount[:\s]*\$?\s*(\d+\.?\d*)/i,
      /balance[:\s]*\$?\s*(\d+\.?\d*)/i,
      /grand\s+total[:\s]*\$?\s*(\d+\.?\d*)/i,
    ];
    for (const pattern of totalPatterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]!);
    }
    const amounts = text.match(/\$?\d+\.\d{2}/g) ?? [];
    const values = amounts.map((a) => parseFloat(a.replace('$', '')));
    return values.length > 0 ? Math.max(...values, 0) : 0;
  }

  private extractLineItems(
    lines: string[]
  ): Array<{ name: string; price: number; quantity?: number }> {
    const items: Array<{ name: string; price: number; quantity?: number }> = [];
    for (const line of lines) {
      if (/^(subtotal|tax|tip|total|thank you|receipt)/i.test(line)) continue;
      const match = line.match(/^(.+?)\s+(\d*\.?\d+)\s*$/);
      if (match) {
        const name = match[1]!.trim();
        const price = parseFloat(match[2]!);
        const qtyMatch = name.match(/(\d+)\s*x\s*(.+)/i);
        if (qtyMatch) {
          items.push({
            name: qtyMatch[2]!.trim(),
            price,
            quantity: parseInt(qtyMatch[1]!, 10),
          });
        } else {
          items.push({ name, price });
        }
      }
    }
    return items;
  }

  private extractTax(text: string): number | undefined {
    const match = text.match(/tax[:\s]*\$?\s*(\d+\.?\d*)/i);
    return match ? parseFloat(match[1]!) : undefined;
  }

  private extractTip(text: string): number | undefined {
    const match = text.match(/tip[:\s]*\$?\s*(\d+\.?\d*)/i);
    return match ? parseFloat(match[1]!) : undefined;
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
