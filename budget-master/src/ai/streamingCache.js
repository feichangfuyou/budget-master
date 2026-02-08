"use strict";
/**
 * Layer 5: Streaming + response cache — stream from Anthropic, cache full response in Redis.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamWithCache = streamWithCache;
exports.getStreamingCacheRedis = getStreamingCacheRedis;
const redis_1 = require("@upstash/redis");
async function* streamWithCache(anthropic, messages, model, maxTokens, options) {
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
        }
        catch (e) {
            console.warn('StreamingCache: Redis setex failed:', e.message);
        }
    }
    if (options.onComplete && fullResponse) {
        try {
            await options.onComplete(fullResponse);
        }
        catch (e) {
            console.warn('StreamingCache onComplete failed:', e.message);
        }
    }
}
function getStreamingCacheRedis() {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token)
        return null;
    try {
        return new redis_1.Redis({ url, token });
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=streamingCache.js.map