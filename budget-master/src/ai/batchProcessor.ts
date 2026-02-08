/**
 * Layer 7: Batch processor — queue queries, process in one API call (optional).
 */

interface QueuedItem {
  query: string;
  context: unknown;
  resolve: (value: string) => void;
  reject: (err: unknown) => void;
}

export class BatchProcessor {
  private queue: QueuedItem[] = [];
  private processing = false;
  private batchSize = 5;
  private batchDelayMs = 100;

  async process(query: string, context: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ query, context, resolve, reject });
      this.scheduleBatch();
    });
  }

  private scheduleBatch(): void {
    if (this.processing) return;
    setTimeout(() => this.runBatch(), this.batchDelayMs);
  }

  private async runBatch(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const batch = this.queue.splice(0, this.batchSize);
    try {
      const combined = batch.map((item, i) => ({
        role: 'user' as const,
        content: `[Query ${i + 1}]: ${item.query}\n[Context ${i + 1}]: ${JSON.stringify(item.context).slice(0, 2000)}`,
      }));
      const { Anthropic } = await import('@anthropic-ai/sdk');
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        batch.forEach((b) => b.resolve('API key not configured.'));
        this.processing = false;
        if (this.queue.length > 0) this.scheduleBatch();
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
    } catch (err) {
      batch.forEach((item) => item.reject(err));
    }
    this.processing = false;
    if (this.queue.length > 0) this.scheduleBatch();
  }

  private splitBatchResponse(text: string, count: number): string[] {
    const parts = text.split(/\[Response\s*\d+\]:/i);
    return parts.slice(1, count + 1).map((p) => p.trim()) as string[];
  }
}
