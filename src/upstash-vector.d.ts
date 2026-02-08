/**
 * Optional dependency: @upstash/vector.
 * When not installed, require() will throw and semantic vector cache is disabled.
 */
declare module '@upstash/vector' {
    export class Index {
        constructor(config: { url: string; token: string });
        query(opts: { vector: number[]; topK: number; includeMetadata: boolean }): Promise<{ score: number; metadata?: { response?: string } }[]>;
        upsert(opts: { id: string; vector: number[]; metadata: Record<string, unknown> }): Promise<unknown>;
    }
}
