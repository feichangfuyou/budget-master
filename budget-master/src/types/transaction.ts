export interface TransactionRow {
  id: string;
  userId: string;
  date: Date;
  amount: number;
  description: string;
  category: string | null;
  merchant: string | null;
  receiptId: string | null;
  createdAt: Date | null;
}

export interface AnomalyResult {
  type: 'amount' | 'frequency' | 'merchant' | 'category' | 'time';
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  explanation: string;
  recommendation?: string;
}
