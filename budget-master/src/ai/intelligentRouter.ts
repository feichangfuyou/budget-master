/**
 * Layer 4: Intelligent model router — Haiku / Sonnet / Opus by complexity.
 */

export type ModelTier = 'local' | 'haiku' | 'sonnet' | 'opus';

export interface ModelConfig {
  tier: ModelTier;
  name: string;
  costPer1MTokens: number;
  maxTokens: number;
}

export const MODELS: Record<ModelTier, ModelConfig> = {
  local: {
    tier: 'local',
    name: 'browser-local',
    costPer1MTokens: 0,
    maxTokens: 512,
  },
  haiku: {
    tier: 'haiku',
    name: 'claude-3-5-haiku-20241022',
    costPer1MTokens: 1.0,
    maxTokens: 8192,
  },
  sonnet: {
    tier: 'sonnet',
    name: 'claude-sonnet-4-20250514',
    costPer1MTokens: 3.0,
    maxTokens: 8192,
  },
  opus: {
    tier: 'opus',
    name: 'claude-sonnet-4-20250514',
    costPer1MTokens: 15.0,
    maxTokens: 16384,
  },
};

const SIMPLE_CATEGORIZATION_PATTERNS = [
  /categorize\s+(this\s+)?transaction/i,
  /what\s+category\s+is/i,
  /classify\s+.*transaction/i,
  /is\s+this\s+(groceries|dining|transport|utilities|entertainment|healthcare|shopping|travel)/i,
];

export class IntelligentRouter {
  route(query: string, context: { relevant?: unknown[]; transactions?: unknown[] }): ModelTier {
    if (this.isSimpleCategorization(query)) return 'local';

    const complexity = this.assessComplexity(query, context);
    if (complexity < 3) return 'haiku';
    if (complexity < 7) return 'sonnet';
    return 'opus';
  }

  private isSimpleCategorization(query: string): boolean {
    return SIMPLE_CATEGORIZATION_PATTERNS.some((p) => p.test(query));
  }

  private assessComplexity(query: string, context: { relevant?: unknown[]; transactions?: unknown[] }): number {
    let score = 0;
    if (/and then|based on/.test(query)) score += 3;
    const count = context.relevant?.length ?? context.transactions?.length ?? 0;
    if (count > 50) score += 2;
    if (/trend|forecast|predict|pattern/i.test(query)) score += 3;
    if (/compare|versus|vs\.?|difference/i.test(query)) score += 2;
    if (/calculate|sum|total|average|percentage/i.test(query)) score += 1;
    if (/suggest|recommend|advice|ideas/i.test(query)) score += 4;
    return score;
  }
}
