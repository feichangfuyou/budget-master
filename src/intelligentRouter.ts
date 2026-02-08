/**
 * Intelligent Router — Route by complexity to Haiku → Sonnet → Opus.
 * Saves cost by using cheap models for simple queries and Opus only when needed.
 */

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface RouterConfig {
    haikuModel: string;
    sonnetModel: string;
    opusModel: string;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
    haikuModel: 'claude-haiku-4-5-20251001',
    sonnetModel: 'claude-sonnet-4-5-20250929',
    opusModel: 'claude-opus-4-6',
};

/**
 * Assess query + context complexity (0–10). Higher = need smarter model.
 */
export function assessComplexity(
    query: string,
    contextLength: number,
    hasImages: boolean
): number {
    const q = query.toLowerCase();
    let score = 0;

    // Multi-step / conditional reasoning
    if (/\b(and then|based on|first.*then|step by step)\b/.test(q)) score += 2;
    if (/\b(compare|versus|vs\.?|difference between|contrast)\b/.test(q)) score += 2;

    // Time / trend / forecasting
    if (/\b(trend|forecast|predict|pattern|over time)\b/.test(q)) score += 2;

    // Creative / open-ended
    if (/\b(suggest|recommend|advice|ideas|alternatives|best practice)\b/.test(q)) score += 2;

    // Code / architecture
    if (/\b(architecture|refactor|optimize|design|implement|debug)\b/.test(q)) score += 2;
    if (/\b(explain|why does|how does)\b/.test(q)) score += 1;

    // Math / logic
    if (/\b(calculate|sum|total|average|percentage|formula)\b/.test(q)) score += 1;

    // Long context
    const contextTokens = Math.ceil(contextLength / 4);
    if (contextTokens > 8000) score += 2;
    else if (contextTokens > 4000) score += 1;

    if (hasImages) score += 1;

    return Math.min(10, score);
}

/**
 * Route to tier: haiku (0–3), sonnet (4–6), opus (7+).
 * Thresholds can be tuned for more aggressive savings (e.g. sonnet 5–8, opus 9+).
 */
export function routeToTier(
    complexity: number,
    preferCheap: boolean = false
): ModelTier {
    if (preferCheap) {
        if (complexity <= 5) return 'haiku';
        if (complexity <= 8) return 'sonnet';
        return 'opus';
    }
    if (complexity <= 3) return 'haiku';
    if (complexity <= 6) return 'sonnet';
    return 'opus';
}

/**
 * Get the model id for the given tier using config.
 */
export function getModelForTier(
    tier: ModelTier,
    config: Partial<RouterConfig> = {}
): string {
    const c = { ...DEFAULT_ROUTER_CONFIG, ...config };
    switch (tier) {
        case 'haiku': return c.haikuModel!;
        case 'sonnet': return c.sonnetModel!;
        case 'opus': return c.opusModel!;
    }
}
