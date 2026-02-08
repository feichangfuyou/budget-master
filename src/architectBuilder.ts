/**
 * Architect & Builder: top-tier model produces a short plan; cheaper model executes.
 */

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; mime: string; base64: string };
export type MessageContent = string | ContentPart[];

export interface CallModelResult {
    text: string;
    inputTokens: number;
    outputTokens: number;
}

export type CallModelFn = (
    modelId: string,
    messages: { role: 'user' | 'assistant'; content: string | ContentPart[] }[],
    maxTokens?: number
) => Promise<CallModelResult>;

export interface ArchitectBuilderResult {
    plan: string;
    planInputTokens: number;
    planOutputTokens: number;
    response: string;
    responseInputTokens: number;
    responseOutputTokens: number;
}

function getTextFromContent(c: string | ContentPart[]): string {
    if (typeof c === 'string') return c;
    return c.map(p => p.type === 'text' ? p.text : '').join('\n');
}

export async function runArchitectBuilder(
    architectModel: string,
    builderModel: string,
    messagesWithContext: { role: 'user' | 'assistant'; content: string | ContentPart[] }[],
    callModel: CallModelFn
): Promise<ArchitectBuilderResult> {
    const lastContent = messagesWithContext[messagesWithContext.length - 1]?.content ?? '';
    const userRequestText = getTextFromContent(lastContent);
    const planPrompt = `You are an architect. For the following request, output ONLY a concise step-by-step plan or outline. No code, no long prose. Keep it under 1000 tokens.\n\nUser request:\n${userRequestText}`;
    const planMessages = [
        ...messagesWithContext.slice(0, -1),
        { role: 'user' as const, content: planPrompt }
    ];
    const planResult = await callModel(architectModel, planMessages, 1024);

    const builderPrompt = `Follow this plan exactly to answer the user's request.\n\nPlan:\n${planResult.text}\n\nUser request:\n${userRequestText}`;
    const builderMessages = [
        ...messagesWithContext.slice(0, -1),
        { role: 'user' as const, content: builderPrompt }
    ];
    const builderResult = await callModel(builderModel, builderMessages);

    return {
        plan: planResult.text,
        planInputTokens: planResult.inputTokens,
        planOutputTokens: planResult.outputTokens,
        response: builderResult.text,
        responseInputTokens: builderResult.inputTokens,
        responseOutputTokens: builderResult.outputTokens,
    };
}
