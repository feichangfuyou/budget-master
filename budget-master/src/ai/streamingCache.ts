/**
 * Layer 5: Streaming + response cache — stream from Anthropic, cache full response in Redis.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Redis } from '@upstash/redis';

export interface StreamWithCacheOptions {
  redis: Redis | null;
  cacheKey: string;
  ttlSeconds?: number;
  onComplete?: (fullResponse: string) => void | Promise<void>;
}

export async function* streamWithCache(
  anthropic: Anthropic,
  messages: Anthropic.Messages.MessageParam[],
  model: string,
  maxTokens: number,
  options: StreamWithCacheOptions
): AsyncGenerator<string, void, unknown> {
  let fullResponse = '';

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const chunk = event.delta.text;
      fullResponse += chunk;
      yield chunk;
    }
  }

  if (options.redis && fullResponse) {
    const ttl = options.ttlSeconds ?? 3600;
    try {
      await options.redis.setex(options.cacheKey, ttl, fullResponse);
    } catch (e) {
      console.warn('StreamingCache: Redis setex failed:', (e as Error).message);
    }
  }
  if (options.onComplete && fullResponse) {
    try {
      await options.onComplete(fullResponse);
    } catch (e) {
      console.warn('StreamingCache onComplete failed:', (e as Error).message);
    }
  }
}

export function getStreamingCacheRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}
