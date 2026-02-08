/**
 * Vector Vault (RAG): turn context into vectors, retrieve only relevant chunks for each query.
 * Saves cost by sending the expensive model only the paragraphs that match the question.
 */

import { estimateTokens } from './contextCache';

const CHUNK_SIZE_TOKENS = 400;
const OVERLAP_TOKENS = 50;
const TOP_K = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';

export interface VectorChunk {
    text: string;
    embedding: number[];
}

export interface VectorVaultState {
    sourceHash: string;
    chunks: VectorChunk[];
    createdAt: number;
}

function simpleHash(text: string): string {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

/** Split text into overlapping chunks by approximate token count. */
export function chunkText(text: string, chunkTokens: number = CHUNK_SIZE_TOKENS, overlapTokens: number = OVERLAP_TOKENS): string[] {
    const chunks: string[] = [];
    const lines = text.split(/\n+/);
    let current = '';
    let currentTokens = 0;
    const overlapChars = Math.max(0, overlapTokens * 4);

    for (const line of lines) {
        const lineTokens = estimateTokens(line);
        if (currentTokens + lineTokens > chunkTokens && current.trim()) {
            chunks.push(current.trim());
            const overlap = current.slice(-overlapChars);
            current = overlap ? overlap + '\n' + line : line;
            currentTokens = estimateTokens(current);
        } else {
            current += (current ? '\n' : '') + line;
            currentTokens += lineTokens;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/** Call OpenAI embeddings API (cheap model). */
export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
    if (texts.length === 0) return [];
    const openai = (await import('openai')).default;
    const client = new openai({ apiKey });
    const res = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
    });
    const order = res.data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return order.map(d => d.embedding);
}

/** Build vault from full context: chunk and embed. */
export async function buildVault(fullContext: string, apiKey: string): Promise<VectorVaultState> {
    const chunks = chunkText(fullContext);
    if (chunks.length === 0) return { sourceHash: simpleHash(fullContext), chunks: [], createdAt: Date.now() };
    const embeddings = await embedTexts(chunks, apiKey);
    const vectorChunks: VectorChunk[] = chunks.map((text, i) => ({ text, embedding: embeddings[i] ?? [] }));
    return {
        sourceHash: simpleHash(fullContext),
        chunks: vectorChunks,
        createdAt: Date.now(),
    };
}

/** Retrieve top-k chunks by similarity to query embedding. */
export function retrieveTopK(queryEmbedding: number[], vault: VectorVaultState, k: number = TOP_K): string[] {
    if (vault.chunks.length === 0) return [];
    const withScore = vault.chunks.map(c => ({ text: c.text, score: cosineSimilarity(queryEmbedding, c.embedding) }));
    withScore.sort((a, b) => b.score - a.score);
    return withScore.slice(0, k).map(x => x.text);
}

/** Full RAG flow: embed query, retrieve chunks, return combined context to send to the model. */
export async function getRAGContext(
    fullContext: string,
    userQuery: string,
    apiKey: string,
    vaultFromStorage: VectorVaultState | null
): Promise<{ contextToUse: string; vault: VectorVaultState }> {
    const sourceHash = simpleHash(fullContext);
    let vault = vaultFromStorage;
    if (!vault || vault.sourceHash !== sourceHash || vault.chunks.length === 0) {
        vault = await buildVault(fullContext, apiKey);
    }
    if (vault.chunks.length === 0) return { contextToUse: fullContext, vault };

    const [queryEmbedding] = await embedTexts([userQuery], apiKey);
    const topChunks = retrieveTopK(queryEmbedding, vault, TOP_K);
    const contextToUse = topChunks.join('\n\n---\n\n');
    return { contextToUse, vault };
}
