/**
 * Semantic Cache (Vector) — Optional Upstash Vector layer for intent similarity.
 * When UPSTASH_VECTOR_URL and UPSTASH_VECTOR_TOKEN are set, queries are embedded
 * and checked against the vector index. High-similarity hits return cached response (0 LLM tokens).
 * Falls back to no-op when not configured.
 */

import * as crypto from 'crypto';
import { embedTexts } from './vectorVault';

const SIMILARITY_THRESHOLD = 0.92;

let IndexClass: typeof import('@upstash/vector').Index | null = null;
try {
    IndexClass = require('@upstash/vector').Index;
} catch {
    // Optional dependency
}

export interface VectorCacheConfig {
    url: string;
    token: string;
}

export function isVectorCacheAvailable(): boolean {
    return Boolean(
        process.env.UPSTASH_VECTOR_URL &&
        process.env.UPSTASH_VECTOR_TOKEN &&
        IndexClass
    );
}

/**
 * Check vector cache for a semantically similar query (same prompt + context key).
 * Uses contextHash to scope cache (e.g. same file = same context).
 */
export async function vectorCacheGet(
    prompt: string,
    contextKey: string,
    openaiKey: string | undefined
): Promise<string | null> {
    if (!openaiKey || !IndexClass || !process.env.UPSTASH_VECTOR_URL || !process.env.UPSTASH_VECTOR_TOKEN) {
        return null;
    }
    try {
        const fullKey = `${prompt}\n---\n${contextKey}`;
        const [embedding] = await embedTexts([fullKey], openaiKey);
        const index = new IndexClass({
            url: process.env.UPSTASH_VECTOR_URL,
            token: process.env.UPSTASH_VECTOR_TOKEN,
        });
        const results = await index.query({
            vector: embedding,
            topK: 1,
            includeMetadata: true,
        });
        const top = results[0];
        if (top && top.score >= SIMILARITY_THRESHOLD && top.metadata?.response) {
            return top.metadata.response as string;
        }
    } catch {
        // Network or config error; fall back to file cache
    }
    return null;
}

/**
 * Store response in vector cache for future similar queries.
 */
export async function vectorCacheSet(
    prompt: string,
    contextKey: string,
    response: string,
    openaiKey: string | undefined
): Promise<void> {
    if (!openaiKey || !IndexClass || !process.env.UPSTASH_VECTOR_URL || !process.env.UPSTASH_VECTOR_TOKEN) {
        return;
    }
    try {
        const fullKey = `${prompt}\n---\n${contextKey}`;
        const [embedding] = await embedTexts([fullKey], openaiKey);
        const index = new IndexClass({
            url: process.env.UPSTASH_VECTOR_URL,
            token: process.env.UPSTASH_VECTOR_TOKEN,
        });
        const id = crypto.randomUUID?.() ?? `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await index.upsert({
            id,
            vector: embedding,
            metadata: { response, timestamp: Date.now(), contextKey: contextKey.slice(0, 200) },
        });
    } catch {
        // Ignore store failures
    }
}
