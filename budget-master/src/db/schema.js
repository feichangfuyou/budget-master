"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forecasts = exports.budgets = exports.anomalies = exports.receipts = exports.transactions = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    name: (0, pg_core_1.text)('name'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
});
exports.transactions = (0, pg_core_1.pgTable)('transactions', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id')
        .references(() => exports.users.id, { onDelete: 'cascade' })
        .notNull(),
    date: (0, pg_core_1.timestamp)('date').notNull(),
    amount: (0, pg_core_1.real)('amount').notNull(),
    description: (0, pg_core_1.text)('description').notNull(),
    category: (0, pg_core_1.text)('category'),
    merchant: (0, pg_core_1.text)('merchant'),
    receiptId: (0, pg_core_1.uuid)('receipt_id'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
});
exports.receipts = (0, pg_core_1.pgTable)('receipts', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id')
        .references(() => exports.users.id, { onDelete: 'cascade' })
        .notNull(),
    transactionId: (0, pg_core_1.uuid)('transaction_id').references(() => exports.transactions.id),
    imageUrl: (0, pg_core_1.text)('image_url').notNull(),
    rawText: (0, pg_core_1.text)('raw_text'),
    merchant: (0, pg_core_1.text)('merchant'),
    items: (0, pg_core_1.jsonb)('items').$type(),
    tax: (0, pg_core_1.real)('tax'),
    tip: (0, pg_core_1.real)('tip'),
    confidence: (0, pg_core_1.real)('confidence'),
    processedAt: (0, pg_core_1.timestamp)('processed_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
});
exports.anomalies = (0, pg_core_1.pgTable)('anomalies', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id')
        .references(() => exports.users.id, { onDelete: 'cascade' })
        .notNull(),
    transactionId: (0, pg_core_1.uuid)('transaction_id')
        .references(() => exports.transactions.id, { onDelete: 'cascade' })
        .notNull(),
    type: (0, pg_core_1.text)('type').notNull(), // 'amount' | 'frequency' | 'merchant' | 'category' | 'time'
    severity: (0, pg_core_1.text)('severity').notNull(), // 'low' | 'medium' | 'high' | 'critical'
    score: (0, pg_core_1.real)('score').notNull(),
    explanation: (0, pg_core_1.text)('explanation').notNull(),
    recommendation: (0, pg_core_1.text)('recommendation'),
    acknowledged: (0, pg_core_1.boolean)('acknowledged').default(false),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
});
exports.budgets = (0, pg_core_1.pgTable)('budgets', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id')
        .references(() => exports.users.id, { onDelete: 'cascade' })
        .notNull(),
    category: (0, pg_core_1.text)('category').notNull(),
    amount: (0, pg_core_1.real)('amount').notNull(),
    period: (0, pg_core_1.text)('period').notNull(), // 'weekly' | 'monthly' | 'yearly'
    startDate: (0, pg_core_1.timestamp)('start_date').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
});
exports.forecasts = (0, pg_core_1.pgTable)('forecasts', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id')
        .references(() => exports.users.id, { onDelete: 'cascade' })
        .notNull(),
    category: (0, pg_core_1.text)('category').notNull(),
    predictions: (0, pg_core_1.jsonb)('predictions').$type(),
    trend: (0, pg_core_1.text)('trend').notNull(),
    trendStrength: (0, pg_core_1.real)('trend_strength').notNull(),
    seasonality: (0, pg_core_1.boolean)('seasonality').notNull(),
    recommendations: (0, pg_core_1.jsonb)('recommendations').$type(),
    generatedAt: (0, pg_core_1.timestamp)('generated_at').defaultNow(),
});
//# sourceMappingURL=schema.js.map