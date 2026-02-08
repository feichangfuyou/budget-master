// ═══════════════════════════════════════════════════════════
// SHARED TYPES — Budget Master
// ═══════════════════════════════════════════════════════════

export interface Transaction {
  id: string;
  date: Date;
  amount: number;
  description: string;
  category?: string;
  merchant?: string;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  type: 'amount' | 'frequency' | 'merchant' | 'category' | 'time';
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  baseline: number;
  actual: number;
  recommendation?: string;
}

export interface BudgetForecast {
  category: string;
  predictions: Array<{
    date: Date;
    predicted: number;
    confidence: { lower: number; upper: number };
  }>;
  trend: 'increasing' | 'decreasing' | 'stable';
  trendStrength: number;
  seasonality: boolean;
  recommendations: string[];
}

export interface ReceiptData {
  merchant: string;
  amount: number;
  date: Date;
  category?: string;
  items: Array<{
    name: string;
    price: number;
    quantity?: number;
  }>;
  tax?: number;
  tip?: number;
  confidence: number;
  rawText: string;
}
