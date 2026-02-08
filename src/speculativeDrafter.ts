/**
 * Speculative Drafter — Output cost optimization.
 * 1. Cheap model drafts the answer.
 * 2. Expensive model audits (approve or rewrite).
 * 3. On [APPROVED], we pay mostly for the cheap draft; on reject we pay for the rewrite.
 */

export interface DrafterResult {
    content: string;
    modelUsed: string;
    wasAudited: boolean;
    auditStatus: 'APPROVED' | 'REWRITTEN';
    /** Token usage for cost tracking. Present when model functions return usage. */
    draftInputTokens?: number;
    draftOutputTokens?: number;
    auditInputTokens?: number;
    auditOutputTokens?: number;
}

/** Model function can return plain text or text + optional token usage. */
export type ModelCallResult = string | { text: string; inputTokens?: number; outputTokens?: number };

function normalizeResult(raw: ModelCallResult): { text: string; inputTokens: number; outputTokens: number } {
    if (typeof raw === 'string') {
        const n = Math.ceil((raw.length || 0) / 4);
        return { text: raw, inputTokens: 0, outputTokens: n };
    }
    return {
        text: raw.text,
        inputTokens: raw.inputTokens ?? 0,
        outputTokens: raw.outputTokens ?? Math.ceil((raw.text?.length || 0) / 4),
    };
}

/**
 * THE SPECULATIVE DRAFTER
 * 1. Cheap model tries first.
 * 2. Expensive model reviews.
 * 3. If expensive model approves, we save most of the output cost.
 */
export async function runSpeculativeDraft(
    userPrompt: string,
    context: string,
    cheapModelFunc: (prompt: string) => Promise<ModelCallResult>,
    expensiveModelFunc: (prompt: string) => Promise<ModelCallResult>
): Promise<DrafterResult> {
    // --- STEP 1: THE DRAFT (Cheap & Fast) ---
    const draftSystemPrompt = `You are an expert coder. Write the code for the user. Be concise.`;
    const fullDraftPrompt = `${draftSystemPrompt}\nContext:\n${context}\nUser:\n${userPrompt}`;

    const draftRaw = await cheapModelFunc(fullDraftPrompt);
    const draft = normalizeResult(draftRaw);

    // --- STEP 2: THE AUDIT (Expensive & Smart) ---
    const auditorSystemPrompt = `
You are a Senior Code Auditor.
Review the DRAFT provided below against the USER REQUEST.

Rules:
1. If the DRAFT is correct and efficient, output ONLY the string: [APPROVED]
2. If the DRAFT has bugs, security issues, or ignores instructions, REWRITE the code completely.
`;

    const auditPayload = `
USER REQUEST: ${userPrompt}

CONTEXT SUMMARY: (Hidden for brevity)

DRAFT TO REVIEW:
${draft.text}
`;

    const fullAuditPrompt = `${auditorSystemPrompt}\n${auditPayload}`;
    const auditRaw = await expensiveModelFunc(fullAuditPrompt);
    const audit = normalizeResult(auditRaw);

    // --- STEP 3: DECISION ---
    if (audit.text.trim().includes('[APPROVED]')) {
        return {
            content: draft.text,
            modelUsed: 'Flash (Audited by Sonnet)',
            wasAudited: true,
            auditStatus: 'APPROVED',
            draftInputTokens: draft.inputTokens,
            draftOutputTokens: draft.outputTokens,
            auditInputTokens: audit.inputTokens,
            auditOutputTokens: audit.outputTokens,
        };
    }
    return {
        content: audit.text,
        modelUsed: 'Sonnet (Rewrite)',
        wasAudited: true,
        auditStatus: 'REWRITTEN',
        draftInputTokens: draft.inputTokens,
        draftOutputTokens: draft.outputTokens,
        auditInputTokens: audit.inputTokens,
        auditOutputTokens: audit.outputTokens,
    };
}
