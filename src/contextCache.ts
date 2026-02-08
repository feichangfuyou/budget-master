/**
 * Context caching: reuse large context via provider-specific cache (Anthropic prompt cache, Gemini cached content).
 * When no cache is used, this module helps build messages with optional pinned context and images.
 */

type Provider = 'openai' | 'anthropic' | 'xai' | 'google' | 'kimi';

export interface ContextCacheState {
    cacheId: string | null;
    cachedContent: string;
    provider: Provider | null;
    model: string | null;
}

/** Content part for multimodal messages (text + images). */
export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; mime: string; base64: string };

export type MessageContent = string | ContentPart[];

/** Build messages array with optional pinned context and optional attached images. */
export function buildMessagesWithPinnedContext(
    history: { role: 'user' | 'assistant'; content: string }[],
    currentPrompt: string,
    pinnedContext: string | null,
    attachedImages?: { mime: string; base64: string }[]
): { role: 'user' | 'assistant'; content: string | ContentPart[] }[] {
    const base: { role: 'user' | 'assistant'; content: string | ContentPart[] }[] = history.map(m => ({ role: m.role, content: m.content }));
    const hasContext = pinnedContext && pinnedContext.trim();
    const combinedPrompt = hasContext
        ? `[Context]\n${pinnedContext!.trim()}\n\n[User question]\n${currentPrompt}`
        : currentPrompt;
    const hasImages = attachedImages && attachedImages.length > 0;
    if (hasImages) {
        const parts: ContentPart[] = [{ type: 'text', text: combinedPrompt }];
        for (const img of attachedImages) {
            parts.push({ type: 'image', mime: img.mime, base64: img.base64 });
        }
        base.push({ role: 'user', content: parts });
    } else {
        base.push({ role: 'user', content: combinedPrompt });
    }
    return base;
}

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
    return Math.ceil((text || '').length / 4);
}

/** Whether to use context cache for this content size (above threshold). */
export function shouldUseContextCache(
    pinnedContext: string | null,
    thresholdTokens: number
): boolean {
    if (!pinnedContext || !pinnedContext.trim()) return false;
    return estimateTokens(pinnedContext) >= thresholdTokens;
}
