/**
 * Prompt Compressor — LongLLMLingua-style extractive compression.
 * Reduces token count 30–50% on long context by keeping high-value sentences.
 * Runs after context squeezer; preserves keywords so the model still gets signal.
 */

import { estimateTokens } from './contextCache';

export interface CompressOptions {
    /** Target ratio of output to input length (0.5 = 50% compression). */
    targetRatio?: number;
    /** Keywords that must be preserved (e.g. "transaction", "budget", "category"). */
    preserveKeywords?: string[];
    /** Min context length (chars) to run compression; below this, return as-is. */
    minCharsToCompress?: number;
}

export interface CompressResult {
    text: string;
    applied: boolean;
    originalTokens: number;
    compressedTokens: number;
    reductionPercent: number;
}

const DEFAULT_OPTIONS: Required<CompressOptions> = {
    targetRatio: 0.5,
    preserveKeywords: [],
    minCharsToCompress: 2000,
};

/**
 * Score a sentence by importance (TF-style + keyword bonus).
 */
function scoreSentence(
    sentence: string,
    fullText: string,
    preserveKeywords: string[]
): number {
    const words = sentence.toLowerCase().match(/\b\w+\b/g) || [];
    if (words.length === 0) return 0;

    let score = 0;

    // Prefer medium-length sentences (not fragments, not run-ons)
    if (words.length >= 5 && words.length <= 40) score += 2;

    // Keyword bonus
    const sentLower = sentence.toLowerCase();
    for (const kw of preserveKeywords) {
        if (sentLower.includes(kw.toLowerCase())) score += 3;
    }

    // Generic high-value terms (code/budget/analysis)
    const highValue = [
        'error', 'exception', 'function', 'return', 'import', 'export',
        'total', 'budget', 'spent', 'category', 'month', 'year', 'sum',
        'def ', 'class ', 'const ', 'let ', 'var ', 'if ', 'for ', 'while',
    ];
    for (const term of highValue) {
        if (sentLower.includes(term)) score += 1;
    }

    // Uniqueness (avoid redundant sentences)
    const uniqueWords = new Set(words);
    score += uniqueWords.size / Math.max(1, words.length);

    return score;
}

/**
 * Compress long prompt by keeping only the most relevant sentences.
 * Sentences are scored and top N by ratio are kept, in original order.
 */
export function compressPrompt(
    text: string,
    options: CompressOptions = {}
): CompressResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const originalTokens = estimateTokens(text);

    if (!text || text.length < opts.minCharsToCompress) {
        return {
            text,
            applied: false,
            originalTokens,
            compressedTokens: originalTokens,
            reductionPercent: 0,
        };
    }

    const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || text.split(/\n+/).filter(Boolean);
    if (sentences.length <= 3) {
        return { text, applied: false, originalTokens, compressedTokens: originalTokens, reductionPercent: 0 };
    }

    const scored = sentences.map((s) => ({
        text: s.trim(),
        score: scoreSentence(s, text, opts.preserveKeywords),
    }));

    scored.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(3, Math.ceil(sentences.length * opts.targetRatio));
    const selected = scored.slice(0, keepCount);

    // Restore original order so context stays coherent
    const orderMap = new Map(sentences.map((s, i) => [s.trim(), i]));
    selected.sort((a, b) => (orderMap.get(a.text) ?? 0) - (orderMap.get(b.text) ?? 0));

    const compressed = selected.map((s) => s.text).join(' ').trim() || text;
    const compressedTokens = estimateTokens(compressed);
    const reductionPercent =
        originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0;

    return {
        text: compressed,
        applied: compressedTokens < originalTokens,
        originalTokens,
        compressedTokens,
        reductionPercent,
    };
}
