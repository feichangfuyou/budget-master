import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  date: timestamp('date').notNull(),
  amount: real('amount').notNull(),
  description: text('description').notNull(),
  category: text('category'),
  merchant: text('merchant'),
  receiptId: uuid('receipt_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const receipts = pgTable('receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  imageUrl: text('image_url').notNull(),
  rawText: text('raw_text'),
  merchant: text('merchant'),
  items: jsonb('items').$type<
    Array<{ name: string; price: number; quantity?: number }>
  >(),
  tax: real('tax'),
  tip: real('tip'),
  confidence: real('confidence'),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const anomalies = pgTable('anomalies', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  transactionId: uuid('transaction_id')
    .references(() => transactions.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull(), // 'amount' | 'frequency' | 'merchant' | 'category' | 'time'
  severity: text('severity').notNull(), // 'low' | 'medium' | 'high' | 'critical'
  score: real('score').notNull(),
  explanation: text('explanation').notNull(),
  recommendation: text('recommendation'),
  acknowledged: boolean('acknowledged').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  category: text('category').notNull(),
  amount: real('amount').notNull(),
  period: text('period').notNull(), // 'weekly' | 'monthly' | 'yearly'
  startDate: timestamp('start_date').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const forecasts = pgTable('forecasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  category: text('category').notNull(),
  predictions: jsonb('predictions').$type<
    Array<{
      date: string;
      predicted: number;
      confidence: { lower: number; upper: number };
    }>
  >(),
  trend: text('trend').notNull(),
  trendStrength: real('trend_strength').notNull(),
  seasonality: boolean('seasonality').notNull(),
  recommendations: jsonb('recommendations').$type<string[]>(),
  generatedAt: timestamp('generated_at').defaultNow(),
});
