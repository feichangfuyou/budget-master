/**
 * Tokenizer Arbitrage: compare token efficiency across models.
 * Uses a single generic estimate (chars/4) for now; can plug in model-specific tokenizers later
 * (e.g. tiktoken for OpenAI) to show "Model B uses ~20% fewer tokens for this text."
 */

import { estimateTokens } from './contextCache';

export interface TokenEstimate {
    /** Generic estimate (chars/4) — works for all models as baseline. */
    generic: number;
    /** Optional note about tokenizer variance. */
    note?: string;
}

/** Get token estimate for the given text. Include context length if building full prompt. */
export function getTokenEstimates(
    promptText: string,
    contextChars: number = 0
): TokenEstimate {
    const totalChars = promptText.length + contextChars;
    const generic = estimateTokens(promptText) + Math.ceil(contextChars / 4);
    return {
        generic,
        note: 'Estimates use ~4 chars/token. Token counts vary by model tokenizer; cheaper models may use similar tokens.',
    };
}

/** Suggest the cheapest model for a given input/output token estimate using price list. */
export function suggestCheapestModel(
    inputTokens: number,
    outputTokens: number,
    prices: Record<string, { input: number; output: number }>
): { modelId: string; estimatedCost: number } | null {
    let best: { modelId: string; cost: number } | null = null;
    for (const [modelId, p] of Object.entries(prices)) {
        const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
        if (best === null || cost < best.cost) best = { modelId, cost };
    }
    return best ? { modelId: best.modelId, estimatedCost: best.cost } : null;
}
