/**
 * Grammar checking for prompts: local rules (always) + optional LanguageTool API.
 * Makes prompt correction highly intelligent while keeping local-only default.
 */

export interface GrammarChange {
    from: string;
    to: string;
}

export interface GrammarResult {
    corrected: string;
    changes: GrammarChange[];
}

/** Apply local grammar rules. No network. */
export function applyLocalGrammarRules(text: string): GrammarResult {
    const changes: GrammarChange[] = [];
    if (!text || !text.trim()) return { corrected: text, changes };

    let out = text;

    // —— Could/would/should of → have (very common) ——
    const ofToHave = /\b(could|would|should|might|must) of\b/gi;
    out = out.replace(ofToHave, (_, verb) => {
        changes.push({ from: `${verb} of`, to: `${verb} have` });
        return `${verb} have`;
    });

    // —— Repeated words (the the, a a, is is, etc.) ——
    const repeatedWord = /\b(\w+)\s+\1\b/gi;
    out = out.replace(repeatedWord, (match, word) => {
        changes.push({ from: match, to: word });
        return word;
    });

    // —— Double spaces (preserve newlines) ——
    const doubleSpace = /[^\S\n]{2,}/g;
    out = out.replace(doubleSpace, (m) => {
        if (m.length > 1) {
            changes.push({ from: m, to: ' ' });
            return ' ';
        }
        return m;
    });

    // —— Common homophones: whole-word only ——
    const homophones: Array<{ pattern: RegExp; replacement: string }> = [
        { pattern: /\byour'e\b/gi, replacement: "you're" },
        { pattern: /\byoure\b/gi, replacement: "you're" },
        { pattern: /\btheir're\b/gi, replacement: "they're" },
        { pattern: /\btheres\b/gi, replacement: "there's" },
        { pattern: /\bwhos\b/gi, replacement: "who's" },
        { pattern: /\balot\b/gi, replacement: 'a lot' },
        { pattern: /\bnoone\b/gi, replacement: 'no one' },
        { pattern: /\beverytime\b/gi, replacement: 'every time' },
        { pattern: /\bincase\b/gi, replacement: 'in case' },
        { pattern: /\binturn\b/gi, replacement: 'in turn' },
        { pattern: /\binsteadof\b/gi, replacement: 'instead of' },
        { pattern: /\bkindof\b/gi, replacement: 'kind of' },
        { pattern: /\bsortof\b/gi, replacement: 'sort of' },
        { pattern: /\boutof\b/gi, replacement: 'out of' },
        { pattern: /\blotsof\b/gi, replacement: 'lots of' },
        { pattern: /\bdont\b/gi, replacement: "don't" },
        { pattern: /\bdoesnt\b/gi, replacement: "doesn't" },
        { pattern: /\bwont\b/gi, replacement: "won't" },
        { pattern: /\bcant\b/gi, replacement: "can't" },
        { pattern: /\bisnt\b/gi, replacement: "isn't" },
        { pattern: /\bwasnt\b/gi, replacement: "wasn't" },
        { pattern: /\barent\b/gi, replacement: "aren't" },
        { pattern: /\bwerent\b/gi, replacement: "weren't" },
        { pattern: /\bhavent\b/gi, replacement: "haven't" },
        { pattern: /\bhasnt\b/gi, replacement: "hasn't" },
        { pattern: /\bhadnt\b/gi, replacement: "hadn't" },
        { pattern: /\bwouldnt\b/gi, replacement: "wouldn't" },
        { pattern: /\bcouldnt\b/gi, replacement: "couldn't" },
        { pattern: /\bshouldnt\b/gi, replacement: "shouldn't" },
        { pattern: /\bdoes'nt\b/gi, replacement: "doesn't" },
        { pattern: /\bit's\b/gi, replacement: "it's" },
    ];
    for (const { pattern, replacement } of homophones) {
        out = out.replace(pattern, (match) => {
            if (match !== replacement) {
                changes.push({ from: match, to: replacement });
                return replacement;
            }
            return match;
        });
    }

    // —— Article "a" before vowel sound: a apple → an apple (simple: an before a,e,i,o,u) ——
    out = out.replace(/\ba ([aeiouAEIOU])/g, (_, letter) => {
        const repl = `an ${letter}`;
        changes.push({ from: `a ${letter}`, to: repl });
        return repl;
    });
    out = out.replace(/\bAn ([^aeiouAEIOU\s])/g, (_, letter) => {
        const repl = `A ${letter}`;
        changes.push({ from: `An ${letter}`, to: repl });
        return repl;
    });

    // —— Sentence start capitalization (after . ? !) ——
    out = out.replace(/([.?!]\s+)([a-z])/g, (_, punctSpace, letter) => {
        const repl = punctSpace + letter.toUpperCase();
        changes.push({ from: punctSpace + letter, to: repl });
        return repl;
    });
    const firstChar = out.charAt(0);
    if (firstChar && /[a-z]/.test(firstChar)) {
        out = out.charAt(0).toUpperCase() + out.slice(1);
        changes.push({ from: firstChar, to: firstChar.toUpperCase() });
    }

    return { corrected: out, changes };
}

const LANGUAGETOOL_API = 'https://api.languagetool.org/v2/check';
const MAX_TEXT_LENGTH = 20000; // API limit 20KB; stay under
const LT_TIMEOUT_MS = 8000;

export interface LanguageToolMatch {
    offset: number;
    length: number;
    message: string;
    replacements: Array<{ value: string }>;
}

export interface LanguageToolResponse {
    matches?: LanguageToolMatch[];
    software?: unknown;
}

/**
 * Fetch grammar suggestions from LanguageTool public API.
 * Rate limit: 20 req/min per IP. Use sparingly (opt-in).
 */
export interface LanguageToolResult {
    corrected: string;
    changes: GrammarChange[];
}

export async function fetchLanguageToolSuggestions(text: string, language = 'en-US'): Promise<LanguageToolResult> {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return { corrected: trimmed, changes: [] };

    const body = new URLSearchParams({
        text: trimmed,
        language,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LT_TIMEOUT_MS);
    try {
        const res = await fetch(LANGUAGETOOL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return { corrected: trimmed, changes: [] };
        const data = (await res.json()) as LanguageToolResponse;
        const matches = data.matches ?? [];
        const changes: GrammarChange[] = [];
        const sorted = [...matches].sort((a, b) => b.offset - a.offset);
        let current = trimmed;
        for (const m of sorted) {
            const rep = m.replacements?.[0]?.value;
            if (!rep || m.offset < 0 || m.length <= 0) continue;
            const from = current.slice(m.offset, m.offset + m.length);
            if (from === rep) continue;
            changes.push({ from, to: rep });
            current = current.slice(0, m.offset) + rep + current.slice(m.offset + m.length);
        }
        return { corrected: current, changes };
    } catch {
        clearTimeout(timeout);
        return { corrected: trimmed, changes: [] };
    }
}
