/**
 * Token Mapping (output efficiency): ask the model to reply with a code (e.g. 1, 2, 3)
 * and map it back to a human-readable label in the UI. Saves output tokens.
 */

export interface OutputSchema {
    id: string;
    name: string;
    instruction: string;
    /** Map raw model output (trimmed, first line/first token) to display label. */
    map: Record<string, string>;
    /** If true, we only accept keys in map; otherwise show raw if no match. */
    strict?: boolean;
}

export const BUILTIN_SCHEMAS: OutputSchema[] = [
    {
        id: 'sentiment',
        name: 'Sentiment',
        instruction: 'Read the content. Reply with ONLY one digit: 1 = angry, 2 = happy, 3 = neutral. No other text.',
        map: { '1': 'Angry', '2': 'Happy', '3': 'Neutral' },
        strict: true,
    },
    {
        id: 'priority',
        name: 'Priority',
        instruction: 'Reply with ONLY one digit for priority: 1 = low, 2 = medium, 3 = high, 4 = urgent. No other text.',
        map: { '1': 'Low', '2': 'Medium', '3': 'High', '4': 'Urgent' },
        strict: true,
    },
    {
        id: 'yesno',
        name: 'Yes/No',
        instruction: 'Reply with ONLY 1 for Yes or 2 for No. No other text.',
        map: { '1': 'Yes', '2': 'No' },
        strict: true,
    },
    {
        id: 'category',
        name: 'Category (1–5)',
        instruction: 'Reply with ONLY one digit 1–5: 1 = support, 2 = sales, 3 = billing, 4 = technical, 5 = other. No other text.',
        map: { '1': 'Support', '2': 'Sales', '3': 'Billing', '4': 'Technical', '5': 'Other' },
        strict: true,
    },
];

export function getSchemaById(id: string): OutputSchema | undefined {
    return BUILTIN_SCHEMAS.find(s => s.id === id);
}

/** Wrap user prompt with schema instruction so the model outputs only the code. */
export function wrapPromptForSchema(userPrompt: string, schema: OutputSchema): string {
    return `${schema.instruction}\n\nContent to classify:\n${userPrompt}`;
}

/** Extract code from model reply (first line, first word, trim). */
function extractCode(raw: string): string {
    const firstLine = (raw || '').trim().split(/\n/)[0]?.trim() ?? '';
    const firstWord = firstLine.split(/\s+/)[0]?.trim() ?? '';
    return firstWord;
}

/** Decode model output to display label; fallback to raw if no match and not strict. */
export function decodeResponse(rawText: string, schema: OutputSchema): { displayText: string; code: string } {
    const code = extractCode(rawText);
    const label = schema.map[code];
    if (label !== undefined) return { displayText: label, code };
    if (schema.strict) return { displayText: `[${code || '?'}]`, code };
    return { displayText: rawText.trim() || '[empty]', code };
}
