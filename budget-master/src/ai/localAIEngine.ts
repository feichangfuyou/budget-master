/**
 * Layer 0: Local AI Engine — 0 tokens.
 * Rule-based categorization + optional @xenova/transformers (zero-shot, NER, embeddings).
 * Fallback: rules and deterministic pseudo-embedding when transformers unavailable.
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  groceries: [
    'grocery', 'supermarket', 'market', 'whole foods', 'trader joe', 'kroger',
    'safeway', 'aldi', 'costco', 'walmart', 'food', 'produce',
  ],
  dining: [
    'restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'sushi', 'grill', 'bar',
    'pub', 'doordash', 'uber eats', 'grubhub', 'eat', 'dine',
  ],
  entertainment: [
    'netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'movie', 'game',
    'steam', 'xbox', 'playstation', 'concert', 'theater',
  ],
  transport: [
    'gas', 'fuel', 'uber', 'lyft', 'parking', 'transit', 'metro', 'bus',
    'train', 'airline', 'flight',
  ],
  utilities: [
    'electric', 'water', 'gas bill', 'internet', 'phone', 'verizon', 'att',
    'comcast',
  ],
  shopping: [
    'amazon', 'ebay', 'target', 'best buy', 'apple store', 'shop', 'store',
  ],
  healthcare: [
    'pharmacy', 'cvs', 'walgreens', 'doctor', 'hospital', 'medical', 'gym',
    'fitness', 'health',
  ],
  travel: ['hotel', 'airbnb', 'booking', 'travel', 'vacation'],
};

const CANDIDATE_LABELS = Object.keys(CATEGORY_KEYWORDS);

export interface CategorizeResult {
  category: string;
  confidence: number;
  merchant?: string;
  amount?: number;
}

const EMBEDDING_DIM = 384;

export class LocalAIEngine {
  private initialized = false;
  private pipeline: {
    featureExtraction?: (text: string, opts?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array }>;
    zeroShot?: (text: string, labels: string[]) => Promise<{ labels: string[]; scores: number[] }>;
    ner?: (text: string) => Promise<Array<{ entity: string; word: string }>>;
  } = {};

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const mod = await import('@xenova/transformers');
      const pipeline = (mod as { pipeline: (task: string, model: string, opts?: object) => Promise<(...args: unknown[]) => unknown> }).pipeline;
      const env = (mod as { env?: { allowLocalModels?: boolean; allowRemoteModels?: boolean } }).env;
      if (env) {
        env.allowLocalModels = true;
        env.allowRemoteModels = true;
      }
      const feat = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true })) as (t: string, o?: object) => Promise<{ data: Float32Array }>;
      this.pipeline.featureExtraction = async (text: string, opts?: { pooling?: string; normalize?: boolean }) => feat(text, opts);
      const zs = (await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', { quantized: true })) as (t: string, o: { candidate_labels: string[] }) => Promise<{ labels: string[]; scores: number[] }>;
      this.pipeline.zeroShot = async (text: string, labels: string[]) => zs(text, { candidate_labels: labels });
      const ner = (await pipeline('token-classification', 'Xenova/bert-base-NER', { quantized: true })) as (t: string) => Promise<Array<{ entity: string; word: string }>>;
      this.pipeline.ner = (text: string) => ner(text);
    } catch (e) {
      console.warn('LocalAIEngine: transformers not loaded, using rules and pseudo-embedding:', (e as Error).message);
    }
    this.initialized = true;
  }

  async categorizeTransaction(description: string): Promise<CategorizeResult> {
    const lower = description.toLowerCase();

    if (this.pipeline.zeroShot && this.pipeline.ner) {
      try {
        const [zeroshot, entities] = await Promise.all([
          this.pipeline.zeroShot(lower, CANDIDATE_LABELS),
          this.pipeline.ner(lower),
        ]);
        const category = zeroshot.labels[0] ?? 'other';
        const confidence = zeroshot.scores[0] ?? 0.5;
        const merchant = this.extractMerchantFromEntities(entities);
        const amount = this.extractAmount(description);
        return { category, confidence, merchant, amount };
      } catch {
        // fall through to rules
      }
    }

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return {
          category,
          confidence: 0.9,
          amount: this.extractAmount(description),
        };
      }
    }
    return {
      category: 'other',
      confidence: 0.5,
      amount: this.extractAmount(description),
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (this.pipeline.featureExtraction) {
      try {
        const output = await this.pipeline.featureExtraction(text, {
          pooling: 'mean',
          normalize: true,
        });
        return Array.from(output.data);
      } catch {
        // fall through to pseudo-embedding
      }
    }
    return this.pseudoEmbedding(text);
  }

  private pseudoEmbedding(text: string): number[] {
    const tokens = text.toLowerCase().match(/\b\w+\b/g) ?? [];
    const vec = new Array(EMBEDDING_DIM).fill(0);
    const bucketSize = Math.max(1, Math.floor(EMBEDDING_DIM / 16));
    for (let i = 0; i < tokens.length; i++) {
      const hash = this.hashString(tokens[i]!);
      const bucket = Math.abs(hash) % EMBEDDING_DIM;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  private hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  private extractMerchantFromEntities(
    entities: Array<{ entity: string; word: string }>
  ): string | undefined {
    const org = entities.find((e) => e.entity === 'ORG' || e.entity?.endsWith('ORG'));
    return org?.word;
  }

  private extractAmount(text: string): number | undefined {
    const match = text.match(/\$?([\d,]+\.?\d*)/);
    return match ? parseFloat(match[1].replace(/,/g, '')) : undefined;
  }
}
