/**
 * Layer 2: Context optimizer — semantic filtering, top-K relevant, statistical summary.
 * Uses Local AI embeddings; no LLM tokens.
 */

import type { TransactionRow } from '../types/transaction.js';
import { LocalAIEngine } from './localAIEngine.js';

export interface PreparedContext {
  relevant: TransactionRow[];
  summary: string;
  metadata: {
    totalTransactions: number;
    totalAmount: number;
    averageAmount: number;
    uniqueCategories: number;
    dateRange: { start: number; end: number };
  };
  estimatedTokens: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

function groupByCategory(txs: TransactionRow[]): Record<string, { total: number; count: number }> {
  const acc: Record<string, { total: number; count: number }> = {};
  for (const t of txs) {
    const cat = t.category ?? 'uncategorized';
    if (!acc[cat]) acc[cat] = { total: 0, count: 0 };
    acc[cat].total += t.amount;
    acc[cat].count += 1;
  }
  return acc;
}

export class ContextOptimizer {
  private localAI: LocalAIEngine;
  private topK: number;
  private maxTokens: number;

  constructor(localAI?: LocalAIEngine, topK = 20, maxTokens = 4000) {
    this.localAI = localAI ?? new LocalAIEngine();
    this.topK = topK;
    this.maxTokens = maxTokens;
  }

  async prepareContext(
    transactions: TransactionRow[],
    query: string
  ): Promise<PreparedContext> {
    if (transactions.length === 0) {
      return {
        relevant: [],
        summary: '',
        metadata: {
          totalTransactions: 0,
          totalAmount: 0,
          averageAmount: 0,
          uniqueCategories: 0,
          dateRange: { start: 0, end: 0 },
        },
        estimatedTokens: 0,
      };
    }

    const queryEmbedding = await this.localAI.generateEmbedding(query);

    const scored = await Promise.all(
      transactions.map(async (tx) => {
        const text = [tx.description, tx.category, tx.merchant].filter(Boolean).join(' ');
        const txEmbedding = await this.localAI.generateEmbedding(text);
        const similarity = cosineSimilarity(queryEmbedding, txEmbedding);
        return { tx, similarity };
      })
    );

    scored.sort((a, b) => b.similarity - a.similarity);
    const relevant = scored.slice(0, this.topK).map((s) => s.tx);
    const rest = scored.slice(this.topK).map((s) => s.tx);

    const summary = this.buildStatisticalSummary(rest);
    const metadata = this.extractMetadata(transactions);
    const estimatedTokens = this.estimateTokens(relevant, summary);

    return { relevant, summary, metadata, estimatedTokens };
  }

  private buildStatisticalSummary(txs: TransactionRow[]): string {
    if (txs.length === 0) return '';
    const total = txs.reduce((s, t) => s + t.amount, 0);
    const byCat = groupByCategory(txs);
    const topCategories = Object.entries(byCat)
      .map(([category, { total: t }]) => ({ category, total: t }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const dates = txs.map((t) => new Date(t.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    return [
      `Remaining ${txs.length} transactions summary:`,
      `- Total: $${total.toFixed(2)}`,
      `- Top categories: ${topCategories.map((c) => `${c.category} ($${c.total.toFixed(2)})`).join(', ')}`,
      `- Date range: ${new Date(minDate).toISOString().slice(0, 10)} to ${new Date(maxDate).toISOString().slice(0, 10)}`,
    ].join('\n');
  }

  private extractMetadata(txs: TransactionRow[]) {
    const total = txs.reduce((s, t) => s + t.amount, 0);
    const categories = new Set(txs.map((t) => t.category).filter(Boolean));
    const dates = txs.map((t) => new Date(t.date).getTime());
    return {
      totalTransactions: txs.length,
      totalAmount: total,
      averageAmount: txs.length ? total / txs.length : 0,
      uniqueCategories: categories.size,
      dateRange: {
        start: dates.length ? Math.min(...dates) : 0,
        end: dates.length ? Math.max(...dates) : 0,
      },
    };
  }

  private estimateTokens(relevant: TransactionRow[], summary: string): number {
    const txStr = relevant.map((t) => JSON.stringify(t)).join('');
    return Math.ceil((txStr.length + summary.length) / 4);
  }
}
