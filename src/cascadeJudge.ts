/**
 * Cascade Judge: deterministic checks to decide if a cheap-model response is good enough.
 * If the judge fails, the request is escalated to an expensive model.
 */

export interface JudgeResult {
    pass: boolean;
    reason?: string;
}

const FAIL_PHRASES = [
    /i cannot\b/i,
    /i'm unable\b/i,
    /i am unable\b/i,
    /i don't have access\b/i,
    /i do not have access\b/i,
    /as an ai(?!\s*,\s*I can)/i,
    /I'm sorry,?\s*I can't/i,
    /I'm not able to/i,
    /error\s*:\s*(could not|failed)/i,
    /\[error\]/i,
];

/** Minimum length (chars) for a response to be considered non-empty. */
const MIN_RESPONSE_LENGTH = 10;

/**
 * Judge a response from the cheap model. Returns pass: true if we should keep it;
 * pass: false means escalate to the expensive model.
 */
export function judge(
    prompt: string,
    response: string,
    options: { strict?: boolean; expectJson?: boolean } = {}
): JudgeResult {
    const r = (response || '').trim();
    if (r.length < MIN_RESPONSE_LENGTH) {
        return { pass: false, reason: 'Response too short or empty' };
    }
    for (const re of FAIL_PHRASES) {
        if (re.test(r)) {
            return { pass: false, reason: 'Response contains refusal or error phrasing' };
        }
    }
    if (options.expectJson) {
        const jsonMatch = r.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, r];
        const toParse = (jsonMatch[1] ?? r).trim();
        try {
            JSON.parse(toParse);
        } catch {
            return { pass: false, reason: 'Expected JSON but parse failed' };
        }
    }
    if (options.strict) {
        const codeBlockMatch = r.match(/```(\w+)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            const lang = (codeBlockMatch[1] || '').toLowerCase();
            const code = (codeBlockMatch[2] || '').trim();
            if (lang === 'json' || (!lang && code.startsWith('{'))) {
                try {
                    JSON.parse(code);
                } catch {
                    return { pass: false, reason: 'Code block contains invalid JSON' };
                }
            }
        }
    }
    return { pass: true };
}

/**
 * Detect if the user prompt asks for JSON (so we can set expectJson for the judge).
 */
export function promptExpectsJson(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    return (
        /\b(json|return\s+json|output\s+json|in\s+json)\b/.test(lower) ||
        /as\s+(valid\s+)?json\b/.test(lower)
    );
}
