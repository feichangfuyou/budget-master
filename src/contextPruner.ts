/**
 * Context Pruner — Smart context pruning without embeddings.
 * Keeps only the most relevant chunks to the query and summarizes the rest.
 * Massive token savings when context is huge (e.g. full file or log).
 */

import { estimateTokens } from './contextCache';

export interface PruneOptions {
    /** Max number of relevant chunks (e.g. lines or blocks) to keep in full. */
    topK?: number;
    /** Max context tokens after pruning (soft cap). */
    maxTokens?: number;
    /** Chunk by: 'line' or 'block' (paragraphs separated by blank lines). */
    chunkBy?: 'line' | 'block';
}

export interface PruneResult {
    /** Pruned context to send (relevant chunks + short summary of rest). */
    text: string;
    applied: boolean;
    originalTokens: number;
    prunedTokens: number;
    reductionPercent: number;
    /** Number of chunks kept in full. */
    keptChunks: number;
    /** Number of chunks summarized. */
    summarizedChunks: number;
}

const DEFAULT_OPTIONS: Required<PruneOptions> = {
    topK: 25,
    maxTokens: 4000,
    chunkBy: 'line',
};

/**
 * Simple relevance: overlap of normalized words between query and chunk.
 * No API/embeddings; good for code and prose.
 */
function relevanceScore(query: string, chunk: string): number {
    const qWords = new Set(
        query.toLowerCase().match(/\b\w+\b/g) || []
    );
    const cWords = (chunk.toLowerCase().match(/\b\w+\b/g) || []);
    if (qWords.size === 0) return 0;
    let hits = 0;
    for (const w of cWords) {
        if (qWords.has(w)) hits++;
    }
    return qWords.size > 0 ? hits / qWords.size : 0;
}

/**
 * Split text into chunks (lines or blocks).
 */
function chunkText(text: string, by: 'line' | 'block'): string[] {
    if (by === 'line') {
        return text.split(/\n/).filter((line) => line.trim().length > 0);
    }
    return text.split(/\n\s*\n/).filter((block) => block.trim().length > 0);
}

/**
 * Build a short statistical summary of pruned chunks (0 tokens to model semantics).
 */
function summarizeChunks(chunks: string[], maxSummaryLines = 5): string {
    if (chunks.length === 0) return '';
    const totalChars = chunks.reduce((s, c) => s + c.length, 0);
    const totalLines = chunks.reduce((s, c) => s + c.split(/\n/).length, 0);
    const sample = chunks.slice(0, 2).map((c) => c.slice(0, 80).replace(/\n/g, ' ')).join(' … ');
    return `[Summary: ${chunks.length} sections omitted, ~${totalLines} lines, ${totalChars} chars. Sample: ${sample}…]`;
}

/**
 * Prune context: keep top-K chunks by relevance to query, summarize the rest.
 */
export function pruneContext(
    context: string,
    query: string,
    options: PruneOptions = {}
): PruneResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const originalTokens = estimateTokens(context);

    if (!context || !context.trim() || originalTokens <= opts.maxTokens) {
        return {
            text: context,
            applied: false,
            originalTokens,
            prunedTokens: originalTokens,
            reductionPercent: 0,
            keptChunks: 0,
            summarizedChunks: 0,
        };
    }

    const chunks = chunkText(context, opts.chunkBy);
    if (chunks.length <= opts.topK) {
        return {
            text: context,
            applied: false,
            originalTokens,
            prunedTokens: originalTokens,
            reductionPercent: 0,
            keptChunks: chunks.length,
            summarizedChunks: 0,
        };
    }

    const scored = chunks.map((chunk) => ({
        chunk,
        score: relevanceScore(query, chunk),
    }));
    scored.sort((a, b) => b.score - a.score);

    const kept = scored.slice(0, opts.topK);
    const omitted = scored.slice(opts.topK);

    const keptText = kept.map((s) => s.chunk).join('\n');
    const summary = summarizeChunks(omitted.map((s) => s.chunk));
    const pruned = `${keptText}\n\n${summary}`.trim();
    const prunedTokens = estimateTokens(pruned);
    const reductionPercent =
        originalTokens > 0 ? (originalTokens - prunedTokens) / originalTokens : 0;

    return {
        text: pruned,
        applied: true,
        originalTokens,
        prunedTokens,
        reductionPercent,
        keptChunks: kept.length,
        summarizedChunks: omitted.length,
    };
}
