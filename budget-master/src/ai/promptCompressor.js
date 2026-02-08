"use strict";
/**
 * Layer 3: Prompt compressor — extractive summarization, 50–80% token reduction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptCompressor = void 0;
const KEYWORDS = ['total', 'budget', 'spent', 'category', 'month', 'year', 'amount', 'transaction'];
function scoreSentence(sentence) {
    const words = sentence.toLowerCase().match(/\b\w+\b/g) ?? [];
    const unique = new Set(words);
    let score = 0;
    if (words.length > 5 && words.length < 30)
        score += 2;
    for (const kw of KEYWORDS) {
        if (sentence.toLowerCase().includes(kw))
            score += 3;
    }
    score += words.length > 0 ? unique.size / words.length : 0;
    return score;
}
class PromptCompressor {
    compress(text, ratio = 0.5) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) ?? text.split(/\n+/).filter((s) => s.trim());
        if (sentences.length === 0)
            return text;
        const scored = sentences.map((s) => ({ text: s.trim(), score: scoreSentence(s) }));
        scored.sort((a, b) => b.score - a.score);
        const keep = Math.max(1, Math.ceil(sentences.length * ratio));
        const selected = scored.slice(0, keep);
        selected.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
        return selected.map((s) => s.text).join(' ');
    }
}
exports.PromptCompressor = PromptCompressor;
//# sourceMappingURL=promptCompressor.js.map