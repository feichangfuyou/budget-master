"use strict";
/**
 * Layer 7: Batch processor — queue queries, process in one API call (optional).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchProcessor = void 0;
class BatchProcessor {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.batchSize = 5;
        this.batchDelayMs = 100;
    }
    async process(query, context) {
        return new Promise((resolve, reject) => {
            this.queue.push({ query, context, resolve, reject });
            this.scheduleBatch();
        });
    }
    scheduleBatch() {
        if (this.processing)
            return;
        setTimeout(() => this.runBatch(), this.batchDelayMs);
    }
    async runBatch() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }
        this.processing = true;
        const batch = this.queue.splice(0, this.batchSize);
        try {
            const combined = batch.map((item, i) => ({
                role: 'user',
                content: `[Query ${i + 1}]: ${item.query}\n[Context ${i + 1}]: ${JSON.stringify(item.context).slice(0, 2000)}`,
            }));
            const { Anthropic } = await Promise.resolve().then(() => require('@anthropic-ai/sdk'));
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                batch.forEach((b) => b.resolve('API key not configured.'));
                this.processing = false;
                if (this.queue.length > 0)
                    this.scheduleBatch();
                return;
            }
            const client = new Anthropic({ apiKey });
            const response = await client.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 2000,
                messages: combined,
            });
            const textBlock = response.content.find((c) => c.type === 'text');
            const text = textBlock?.type === 'text' ? textBlock.text : '';
            const parts = this.splitBatchResponse(text, batch.length);
            batch.forEach((item, i) => item.resolve(parts[i] ?? ''));
        }
        catch (err) {
            batch.forEach((item) => item.reject(err));
        }
        this.processing = false;
        if (this.queue.length > 0)
            this.scheduleBatch();
    }
    splitBatchResponse(text, count) {
        const parts = text.split(/\[Response\s*\d+\]:/i);
        return parts.slice(1, count + 1).map((p) => p.trim());
    }
}
exports.BatchProcessor = BatchProcessor;
//# sourceMappingURL=batchProcessor.js.map