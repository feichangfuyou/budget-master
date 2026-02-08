/**
 * Layer 1: Vector semantic cache — one-time embedding cost, 0 tokens on hit.
 * Upstash Vector + Redis. No-op when UPSTASH_VECTOR_* or UPSTASH_REDIS_* missing.
 */

import { Index } from '@upstash/vector';
import { Redis } from '@upstash/redis';
import { LocalAIEngine } from './localAIEngine.js';

export interface SemanticCacheConfig {
  vectorUrl?: string;
  vectorToken?: string;
  redisUrl?: string;
  redisToken?: string;
  similarityThreshold?: number;
  defaultTtlSeconds?: number;
}

export class SemanticCache {
  private vector: Index | null = null;
  private redis: Redis | null = null;
  private localAI: LocalAIEngine;
  private threshold: number;
  private defaultTtl: number;
  private enabled: boolean;

  constructor(config: SemanticCacheConfig = {}, localAI?: LocalAIEngine) {
    this.localAI = localAI ?? new LocalAIEngine();
    this.threshold = config.similarityThreshold ?? 0.92;
    this.defaultTtl = config.defaultTtlSeconds ?? 86400 * 7;

    const vectorUrl = config.vectorUrl ?? process.env.UPSTASH_VECTOR_URL;
    const vectorToken = config.vectorToken ?? process.env.UPSTASH_VECTOR_TOKEN;
    const redisUrl = config.redisUrl ?? process.env.UPSTASH_REDIS_URL;
    const redisToken = config.redisToken ?? process.env.UPSTASH_REDIS_TOKEN;

    this.enabled = !!(vectorUrl && vectorToken && redisUrl && redisToken);

    if (this.enabled) {
      try {
        this.vector = new Index({ url: vectorUrl!, token: vectorToken! });
        this.redis = new Redis({ url: redisUrl!, token: redisToken! });
      } catch (e) {
        console.warn('SemanticCache: Upstash client init failed, cache disabled:', (e as Error).message);
        this.enabled = false;
      }
    }
  }

  async query(userQuery: string, userId: string = 'global'): Promise<string | null> {
    if (!this.enabled || !this.vector) return null;
    try {
      const embedding = await this.localAI.generateEmbedding(userQuery);
      const results = await this.vector.query({
        vector: embedding,
        topK: 1,
        includeMetadata: true,
      });
      const first = results[0];
      const score = first?.score ?? 0;
      if (score >= this.threshold && first?.metadata?.response) {
        return first.metadata.response as string;
      }
      return null;
    } catch (e) {
      console.warn('SemanticCache query failed:', (e as Error).message);
      return null;
    }
  }

  async store(
    query: string,
    response: string,
    userId: string = 'global',
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.enabled || !this.vector || !this.redis) return;
    const ttl = ttlSeconds ?? this.defaultTtl;
    try {
      const embedding = await this.localAI.generateEmbedding(query);
      const id = crypto.randomUUID();
      await this.vector.upsert([
        {
          id,
          vector: embedding,
          metadata: { query, response, timestamp: Date.now(), userId },
        },
      ]);
      await this.redis.setex(`cache:${id}`, ttl, JSON.stringify({ query, response }));
    } catch (e) {
      console.warn('SemanticCache store failed:', (e as Error).message);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  estimateTokensSaved(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
