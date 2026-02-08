/**
 * Layer 6: Function calling — tools for query_transactions, spending_summary, set_budget, detect_anomalies.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { TransactionRow } from '../types/transaction.js';

export const BUDGET_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'query_transactions',
    description: 'Query transactions with filters. Returns matching transactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['groceries', 'dining', 'transport', 'utilities', 'entertainment', 'healthcare', 'shopping', 'travel', 'other'],
          description: 'Filter by category',
        },
        minAmount: { type: 'number', description: 'Minimum transaction amount' },
        maxAmount: { type: 'number', description: 'Maximum transaction amount' },
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        merchant: { type: 'string', description: 'Filter by merchant name' },
        limit: { type: 'number', description: 'Max results', default: 50 },
      },
    },
  },
  {
    name: 'calculate_spending_summary',
    description: 'Spending statistics for a period',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        groupBy: {
          type: 'string',
          enum: ['category', 'merchant', 'day', 'week', 'month'],
          default: 'category',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'set_budget',
    description: 'Set or update budget for a category',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' },
        amount: { type: 'number' },
        period: { type: 'string', enum: ['weekly', 'monthly', 'yearly'], default: 'monthly' },
      },
      required: ['category', 'amount'],
    },
  },
  {
    name: 'detect_anomalies',
    description: 'Detect unusual spending patterns',
    input_schema: {
      type: 'object' as const,
      properties: {
        lookbackDays: { type: 'number', description: 'Days to analyze', default: 30 },
        sensitivity: { type: 'number', description: '1-10', default: 5 },
      },
    },
  },
];

export interface ToolCallHandlers {
  query_transactions: (params: {
    category?: string;
    minAmount?: number;
    maxAmount?: number;
    startDate?: string;
    endDate?: string;
    merchant?: string;
    limit?: number;
  }) => Promise<TransactionRow[]>;
  calculate_spending_summary: (params: {
    startDate: string;
    endDate: string;
    groupBy?: string;
  }) => Promise<Record<string, number> | string>;
  set_budget: (params: { category: string; amount: number; period?: string }) => Promise<string>;
  detect_anomalies: (params: { lookbackDays?: number; sensitivity?: number }) => Promise<string>;
}

export function createDefaultToolHandlers(
  getTransactions: () => TransactionRow[]
): ToolCallHandlers {
  const txs = () => getTransactions();
  return {
    async query_transactions(params) {
      let list = txs();
      if (params.category) list = list.filter((t) => (t.category ?? '').toLowerCase() === params.category!.toLowerCase());
      if (params.minAmount != null) list = list.filter((t) => t.amount >= params.minAmount!);
      if (params.maxAmount != null) list = list.filter((t) => t.amount <= params.maxAmount!);
      if (params.startDate) list = list.filter((t) => new Date(t.date).toISOString().slice(0, 10) >= params.startDate!);
      if (params.endDate) list = list.filter((t) => new Date(t.date).toISOString().slice(0, 10) <= params.endDate!);
      if (params.merchant) list = list.filter((t) => (t.merchant ?? '').toLowerCase().includes(params.merchant!.toLowerCase()));
      const limit = params.limit ?? 50;
      return list.slice(0, limit);
    },
    async calculate_spending_summary(params) {
      const list = txs().filter((t) => {
        const d = new Date(t.date).toISOString().slice(0, 10);
        return d >= params.startDate && d <= params.endDate;
      });
      const groupBy = params.groupBy ?? 'category';
      const out: Record<string, number> = {};
      for (const t of list) {
        const key = groupBy === 'category' ? (t.category ?? 'other') : groupBy === 'merchant' ? (t.merchant ?? 'unknown') : new Date(t.date).toISOString().slice(0, 10);
        out[key] = (out[key] ?? 0) + t.amount;
      }
      return out;
    },
    async set_budget() {
      return 'Budget recorded. Use the budgets API to persist.';
    },
    async detect_anomalies() {
      return 'Anomaly detection runs on new transactions. Check the anomalies API for results.';
    },
  };
}
