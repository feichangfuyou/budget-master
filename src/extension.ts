import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { judge, promptExpectsJson } from './cascadeJudge';
import { runArchitectBuilder } from './architectBuilder';
import { buildMessagesWithPinnedContext, estimateTokens, type ContentPart } from './contextCache';
import { premiumModels, freeModels } from './supportedModels';
import { correctPrompt } from './promptCorrector';
import { getRAGContext, type VectorVaultState } from './vectorVault';
import { getSchemaById, wrapPromptForSchema, decodeResponse } from './tokenMapping';
import { getTokenEstimates, suggestCheapestModel } from './tokenizerArbitrage';
import { squeezeContext } from './contextSqueezer';
import { runSpeculativeDraft } from './speculativeDrafter';
import { checkCache, saveToCache, setCacheStoragePath, loadFromDisk } from './semanticCache';

// --- 💰 PRICE LIST (Per 1 Million Tokens) — Cursor docs + provider APIs ---
const PRICES: Record<string, { input: number; output: number }> = {
    // Cursor lineup (same as editor)
    "claude-sonnet-4-5-20250929": { input: 3.00, output: 15.00 },   // Claude 4.5 Sonnet
    "claude-opus-4-6": { input: 5.00, output: 25.00 },             // Claude 4.6 Opus
    "gemini-3-flash-preview": { input: 0.50, output: 3.00 },       // Gemini 3 Flash
    "gemini-3-pro-preview": { input: 2.00, output: 12.00 },        // Gemini 3 Pro
    "gemini-2.5-pro": { input: 1.25, output: 10.00 },             // Gemini 2.5 Pro
    "gemini-2.5-flash": { input: 0.30, output: 2.50 },            // Gemini 2.5 Flash
    "gemini-2.5-flash-lite": { input: 0.15, output: 0.60 },      // Gemini 2.5 Flash Lite
    "gemini-2.0-flash-001": { input: 0.20, output: 0.80 },       // Gemini 2.0 Flash
    "gemini-2.0-flash-lite-001": { input: 0.10, output: 0.40 },  // Gemini 2.0 Flash Lite
    "gpt-5.2": { input: 1.75, output: 14.00 },
    "gpt-5.2-codex": { input: 1.75, output: 14.00 },
    "grok-code-fast-1": { input: 0.20, output: 1.50 },             // Grok Code
    // OpenAI
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4-turbo": { input: 10.00, output: 30.00 },
    "gpt-4": { input: 30.00, output: 60.00 },
    "gpt-3.5-turbo": { input: 0.50, output: 1.50 },
    "gpt-4.1": { input: 2.00, output: 8.00 },
    "gpt-4.1-mini": { input: 0.40, output: 1.60 },
    "gpt-4.1-nano": { input: 0.10, output: 0.40 },
    "o1": { input: 15.00, output: 60.00 },
    "o1-mini": { input: 3.00, output: 12.00 },
    "o3": { input: 15.00, output: 60.00 },
    "o3-mini": { input: 3.00, output: 12.00 },
    // Claude
    "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
    "claude-3-5-sonnet-20240620": { input: 3.00, output: 15.00 },
    "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
    "claude-3-opus-20240229": { input: 15.00, output: 75.00 },
    // Grok (xAI)
    "grok-4": { input: 3.00, output: 15.00 },
    "grok-4-fast-reasoning": { input: 0.20, output: 0.50 },
    "grok-4-1-fast-reasoning": { input: 0.20, output: 0.50 },
    "grok-4-fast-non-reasoning": { input: 0.20, output: 0.50 },
    "grok-4-1-fast-non-reasoning": { input: 0.20, output: 0.50 },
    "grok-3": { input: 2.00, output: 10.00 },
    "grok-3-mini": { input: 0.20, output: 0.50 },
    // Kimi (Moonshot AI)
    "kimi-k2.5": { input: 0.60, output: 3.00 },
    "kimi-k2-0905-preview": { input: 0.60, output: 2.50 },
    "kimi-k2-0711-preview": { input: 0.60, output: 2.50 },
    "kimi-k2-turbo-preview": { input: 1.15, output: 8.00 },
    "kimi-k2-thinking": { input: 0.60, output: 2.50 },
    "kimi-k2-thinking-turbo": { input: 1.15, output: 8.00 },
    "moonshot-v1-8k": { input: 0.20, output: 2.00 },
    "moonshot-v1-32k": { input: 1.00, output: 3.00 },
    "moonshot-v1-128k": { input: 2.00, output: 5.00 },
    "moonshot-v1-8k-vision-preview": { input: 0.20, output: 2.00 },
    "moonshot-v1-32k-vision-preview": { input: 1.00, output: 3.00 },
    "moonshot-v1-128k-vision-preview": { input: 2.00, output: 5.00 },
};

// --- 🖼️ IMAGE GENERATION (per image) ---
const IMAGE_PRICES: Record<string, { perImage: number }> = {
    "dall-e-3": { perImage: 0.016 },           // DALL·E 3 Standard (1024)
    "dall-e-3-hd": { perImage: 0.040 },       // DALL·E 3 HD
    "dall-e-2": { perImage: 0.020 },          // DALL·E 2 1024×1024
};

function isImageModel(modelId: string): boolean {
    return modelId in IMAGE_PRICES;
}

// --- 🎤 AUDIO (Speech-to-Text: $/min; Text-to-Speech: $/1k chars) ---
const AUDIO_PRICES: Record<string, { kind: 'stt'; perMinute: number } | { kind: 'tts'; perThousandChars: number }> = {
    "whisper-1": { kind: 'stt', perMinute: 0.006 },
    "gpt-4o-transcribe": { kind: 'stt', perMinute: 0.006 },
    "gpt-4o-mini-transcribe": { kind: 'stt', perMinute: 0.003 },
    "tts-1": { kind: 'tts', perThousandChars: 0.015 },
    "tts-1-hd": { kind: 'tts', perThousandChars: 0.03 },
    "gpt-4o-mini-tts": { kind: 'tts', perThousandChars: 0.015 },
};

function isAudioModel(modelId: string): modelId is keyof typeof AUDIO_PRICES {
    return modelId in AUDIO_PRICES;
}
function isSTTModel(modelId: string): boolean {
    const p = AUDIO_PRICES[modelId];
    return p ? p.kind === 'stt' : false;
}
function isTTSModel(modelId: string): boolean {
    const p = AUDIO_PRICES[modelId];
    return p ? p.kind === 'tts' : false;
}

type Provider = 'openai' | 'anthropic' | 'xai' | 'google' | 'kimi';
const MODEL_PROVIDER: Record<string, Provider> = {
    "gpt-5.2": "openai", "gpt-5.2-codex": "openai",
    "gpt-4o-mini": "openai", "gpt-4o": "openai", "gpt-4-turbo": "openai", "gpt-4": "openai",
    "gpt-3.5-turbo": "openai", "gpt-4.1": "openai", "gpt-4.1-mini": "openai", "gpt-4.1-nano": "openai",
    "o1": "openai", "o1-mini": "openai", "o3": "openai", "o3-mini": "openai",
    "claude-opus-4-6": "anthropic", "claude-sonnet-4-5-20250929": "anthropic", "claude-haiku-4-5-20251001": "anthropic",
    "claude-3-5-sonnet-20240620": "anthropic", "claude-3-5-haiku-20241022": "anthropic", "claude-3-opus-20240229": "anthropic",
    "gemini-3-flash-preview": "google", "gemini-3-pro-preview": "google",
    "gemini-2.5-pro": "google", "gemini-2.5-flash": "google", "gemini-2.5-flash-lite": "google",
    "gemini-2.0-flash-001": "google", "gemini-2.0-flash-lite-001": "google",
    "grok-4": "xai", "grok-code-fast-1": "xai", "grok-4-fast-reasoning": "xai", "grok-4-1-fast-reasoning": "xai",
    "grok-4-fast-non-reasoning": "xai", "grok-4-1-fast-non-reasoning": "xai",
    "grok-3": "xai", "grok-3-mini": "xai",
    "kimi-k2.5": "kimi", "kimi-k2-0905-preview": "kimi", "kimi-k2-0711-preview": "kimi",
    "kimi-k2-turbo-preview": "kimi", "kimi-k2-thinking": "kimi", "kimi-k2-thinking-turbo": "kimi",
    "moonshot-v1-8k": "kimi", "moonshot-v1-32k": "kimi", "moonshot-v1-128k": "kimi",
    "moonshot-v1-8k-vision-preview": "kimi", "moonshot-v1-32k-vision-preview": "kimi", "moonshot-v1-128k-vision-preview": "kimi",
    "whisper-1": "openai", "gpt-4o-transcribe": "openai", "gpt-4o-mini-transcribe": "openai",
    "tts-1": "openai", "tts-1-hd": "openai", "gpt-4o-mini-tts": "openai",
};

/** Model tier by $/1M input: cheap < $0.50, mid $0.50–3, premium > $3. Used for benchmark label. */
function getModelTier(modelId: string): 'cheap' | 'mid' | 'premium' {
    const p = PRICES[modelId];
    if (!p) return 'mid';
    if (p.input < 0.50) return 'cheap';
    if (p.input <= 3) return 'mid';
    return 'premium';
}

export function activate(context: vscode.ExtensionContext) {
    if (context.globalStorageUri) {
        setCacheStoragePath(context.globalStorageUri.fsPath);
        loadFromDisk();
    }
    const provider = new BudgetChatProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("budgetMaster.chatView", provider)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.useSelectionAsContext', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const text = editor.document.getText(editor.selection);
                provider.setPinnedContext(text || null);
                vscode.window.showInformationMessage(text ? `Budget Master: ${Math.ceil(text.length / 4)} tokens attached as context` : 'Budget Master: selection empty');
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.clearPinnedContext', () => {
            provider.setPinnedContext(null);
            vscode.window.showInformationMessage('Budget Master: context cleared');
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.attachFileAsContext', () => provider.attachFilesFromPicker())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.attachLinkAsContext', () => provider.attachLinksFromInput())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.resetSession', () => provider.resetSession())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.copySessionSummary', async () => {
            const summary = provider.getSessionSummary();
            const savedPart = summary.sessionSaved > 0 ? ` (Saved $${summary.sessionSaved.toFixed(2)} this session)` : '';
            const text = `Budget Master session: $${summary.totalCost.toFixed(4)}${savedPart} | ${formatTokens(summary.totalInputTokens + summary.totalOutputTokens)} tokens (${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out)`;
            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage('Budget Master: Session summary copied to clipboard.');
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.newChat', () => provider.newChat())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.openChatHistory', () => provider.focusAndShowHistory())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.searchWorkspace', () => provider.searchWorkspaceAsContext())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.chatWithSelection', () => provider.chatWithSelection())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('budgetMaster.refreshWebview', () => {
            provider.refreshWebview();
        })
    );
}
function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

const MAX_HISTORY_MESSAGES = 20; // 10 user + 10 assistant rounds of context

const CHAT_HISTORY_KEY = 'budgetMaster.chatHistory';
const VAULT_STATE_KEY = 'budgetMaster.vectorVault';
const MAX_SAVED_CHATS = 50;

/** Per-model usage within a session (for "all models" token measurement). */
export interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    cost: number;
}

export interface SavedChat {
    id: string;
    title: string;
    createdAt: number;
    messages: { role: 'user' | 'assistant'; content: string }[];
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    /** Token/cost breakdown by model (all models used in this chat). */
    byModel?: Record<string, ModelUsage>;
}

class BudgetChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _totalCost: number = 0;
    private _totalInputTokens: number = 0;
    private _totalOutputTokens: number = 0;
    /** Session savings from cache hits and speculative draft (vs full expensive model). */
    private _sessionSaved: number = 0;
    /** Per-model usage so token measurement is for all models used in this session. */
    private _byModel: Record<string, ModelUsage> = {};
    private _history: { role: 'user' | 'assistant'; content: string }[] = [];
    private _pinnedContext: string | null = null;
    private _attachedImages: { name: string; mime: string; base64: string }[] = [];
    private _attachedAudio: { name: string; mime: string; base64: string }[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {}

    public setPinnedContext(text: string | null) {
        this._pinnedContext = text;
        this._attachedImages = [];
        this._attachedAudio = [];
        if (!text) this._context.globalState.update(VAULT_STATE_KEY, undefined);
        this._notifyContextUpdated();
    }

    public getPinnedContext(): string | null {
        return this._pinnedContext;
    }

    public resetSession(): void {
        this._history = [];
        this._totalCost = 0;
        this._totalInputTokens = 0;
        this._totalOutputTokens = 0;
        this._sessionSaved = 0;
        this._byModel = {};
        this._view?.webview.postMessage({ type: 'sessionReset', byModel: {}, sessionSaved: 0 });
        vscode.window.showInformationMessage('Budget Master: Session reset.');
    }

    /** Save current session to past chats (if not empty), then reset. */
    public newChat(): void {
        this._saveCurrentSessionToHistory();
        this.resetSession();
        vscode.window.showInformationMessage('Budget Master: New chat started.');
    }

    /** Ensure chat view is visible and tell webview to show history list. */
    public focusAndShowHistory(): void {
        this._view?.show?.(true);
        this._postChatHistoryList();
        this._view?.webview.postMessage({ type: 'showChatHistory' });
    }

    /** Focus chat and use current selection as context (Cursor-like: chat with selection). */
    public chatWithSelection(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const text = editor.document.getText(editor.selection);
            this.setPinnedContext(text || null);
            this._notifyContextUpdated();
        }
        this._view?.show?.(true);
        this._view?.webview.postMessage({ type: 'focusPrompt' });
        if (editor?.selection && !editor.selection.isEmpty) {
            vscode.window.showInformationMessage(`Budget Master: Selection attached (~${Math.ceil((editor.document.getText(editor.selection).length) / 4)} tokens). Type and send.`);
        }
    }

    public getChatHistory(): SavedChat[] {
        const raw = this._context.globalState.get<SavedChat[]>(CHAT_HISTORY_KEY);
        return Array.isArray(raw) ? raw : [];
    }

    /** Save current session to globalState (prepend, cap at MAX_SAVED_CHATS). */
    private _saveCurrentSessionToHistory(): void {
        if (this._history.length === 0) return;
        const firstUser = this._history.find(m => m.role === 'user');
        const title = firstUser
            ? (typeof firstUser.content === 'string' ? firstUser.content.slice(0, 60) : '').trim() || 'Chat'
            : 'Chat';
        const saved: SavedChat = {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            title: title + (title.length >= 60 ? '…' : ''),
            createdAt: Date.now(),
            messages: [...this._history],
            totalCost: this._totalCost,
            totalInputTokens: this._totalInputTokens,
            totalOutputTokens: this._totalOutputTokens,
            byModel: Object.keys(this._byModel).length ? this._byModel : undefined,
        };
        const list = this.getChatHistory();
        list.unshift(saved);
        this._context.globalState.update(CHAT_HISTORY_KEY, list.slice(0, MAX_SAVED_CHATS));
    }

    private _postChatHistoryList(): void {
        if (!this._view) return;
        this._view.webview.postMessage({
            type: 'chatHistoryList',
            chats: this.getChatHistory().map(c => ({
                id: c.id,
                title: c.title,
                createdAt: c.createdAt,
                totalCost: c.totalCost,
                totalInputTokens: c.totalInputTokens,
                totalOutputTokens: c.totalOutputTokens,
            })),
        });
    }

    /** Load a past chat by id into current session (read-only display; totals shown). */
    public loadChat(id: string): void {
        const list = this.getChatHistory();
        const chat = list.find(c => c.id === id);
        if (!chat) {
            vscode.window.showWarningMessage('Budget Master: Chat not found.');
            return;
        }
        this._history = [...chat.messages];
        this._totalCost = chat.totalCost;
        this._totalInputTokens = chat.totalInputTokens;
        this._totalOutputTokens = chat.totalOutputTokens;
        this._byModel = chat.byModel ? { ...chat.byModel } : {};
        this._view?.webview.postMessage({
            type: 'loadChat',
            messages: chat.messages,
            totalCost: chat.totalCost,
            totalInputTokens: chat.totalInputTokens,
            totalOutputTokens: chat.totalOutputTokens,
            sessionSaved: 0,
            byModel: this._byModel,
            modelLabels: this._getModelLabels(this._byModel),
        });
        vscode.window.showInformationMessage(`Budget Master: Opened "${chat.title.slice(0, 40)}…".`);
    }

    /** Delete a saved chat from history. */
    public deleteChat(id: string): void {
        const list = this.getChatHistory().filter(c => c.id !== id);
        this._context.globalState.update(CHAT_HISTORY_KEY, list);
        this._postChatHistoryList();
    }

    public getSessionSummary(): { totalCost: number; totalInputTokens: number; totalOutputTokens: number; sessionSaved: number } {
        return {
            totalCost: this._totalCost,
            totalInputTokens: this._totalInputTokens,
            totalOutputTokens: this._totalOutputTokens,
            sessionSaved: this._sessionSaved,
        };
    }

    // Image types accepted by all providers (OpenAI, Anthropic, Google Gemini, xAI Grok)
    private static readonly IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    private static readonly IMAGE_MIME: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
    };
    // Audio for STT (Whisper): flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
    private static readonly AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.webm', '.ogg', '.flac', '.mp4', '.mpeg', '.mpga']);
    private static readonly AUDIO_MIME: Record<string, string> = {
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
        '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'audio/mp4', '.mpeg': 'audio/mpeg', '.mpga': 'audio/mpeg',
    };

    /** Open file picker; attach all file types: text as context, images as vision, audio for STT, other binary as a note. */
    public async attachFilesFromPicker(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach as context',
            title: 'Attach any file(s) as context',
        });
        if (!uris?.length) return;
        let textAppended = '';
        let textCount = 0;
        let imageCount = 0;
        let audioCount = 0;
        let binaryCount = 0;
        for (const uri of uris) {
            try {
                const buf = await vscode.workspace.fs.readFile(uri);
                const pathSegs = uri.path.split(/[/\\]/);
                const name = pathSegs[pathSegs.length - 1] || uri.fsPath.split(/[/\\]/).pop() || 'file';
                const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
                if (BudgetChatProvider.IMAGE_EXT.has(ext)) {
                    const mime = BudgetChatProvider.IMAGE_MIME[ext] || 'image/png';
                    this._attachedImages.push({ name, mime, base64: Buffer.from(buf).toString('base64') });
                    imageCount++;
                    continue;
                }
                if (BudgetChatProvider.AUDIO_EXT.has(ext)) {
                    const mime = BudgetChatProvider.AUDIO_MIME[ext] || 'audio/mpeg';
                    this._attachedAudio.push({ name, mime, base64: Buffer.from(buf).toString('base64') });
                    audioCount++;
                    continue;
                }
                const raw = Buffer.from(buf).toString('utf8');
                const replacementCount = (raw.match(/\uFFFD/g) || []).length;
                const looksBinary = buf.length > 0 && (raw.length === 0 || (buf.length > 100 && replacementCount / raw.length > 0.2));
                if (looksBinary) {
                    textAppended += (textAppended ? '\n' : '') + `[Attached: ${name} (binary, ${buf.length} bytes)]`;
                    binaryCount++;
                } else {
                    textAppended += (textAppended ? '\n\n' : '') + `[File: ${name}]\n${raw}`;
                    textCount++;
                }
            } catch {
                binaryCount++;
                textAppended += (textAppended ? '\n' : '') + `[Attached: (file read failed)]`;
            }
        }
        if (textAppended) {
            const current = this._pinnedContext || '';
            this._pinnedContext = current ? current + '\n\n' + textAppended : textAppended;
        }
        this._notifyContextUpdated();
        const parts: string[] = [];
        if (textCount) parts.push(`${textCount} text`);
        if (imageCount) parts.push(`${imageCount} image(s)`);
        if (binaryCount) parts.push(`${binaryCount} other`);
        vscode.window.showInformationMessage(`Budget Master: Attached ${parts.join(', ')}.`);
    }

    private static readonly FETCH_TIMEOUT_MS = 15000;
    private static readonly FETCH_MAX_BYTES = 512 * 1024; // 512KB per URL

    /** Strip HTML tags and decode entities roughly for readable text. */
    private static _htmlToText(html: string): string {
        let s = html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return s.slice(0, BudgetChatProvider.FETCH_MAX_BYTES);
    }

    /** Fetch URL content and return as text; HTML is stripped to plain text. */
    public async attachLinksFromInput(): Promise<void> {
        const raw = await vscode.window.showInputBox({
            title: 'Attach link(s) as context',
            prompt: 'Enter one or more URLs (comma or newline separated)',
            placeHolder: 'https://example.com/page',
            validateInput: (value) => {
                const urls = value.split(/[\s,]+/).map(u => u.trim()).filter(Boolean);
                for (const u of urls) {
                    try {
                        const parsed = new URL(u);
                        if (!['http:', 'https:'].includes(parsed.protocol)) return `Only http/https allowed: ${u}`;
                    } catch {
                        return `Invalid URL: ${u}`;
                    }
                }
                return null;
            },
        });
        if (!raw?.trim()) return;
        const urls = raw.split(/[\s,]+/).map(u => u.trim()).filter(Boolean);
        let appended = '';
        let ok = 0;
        let failed = 0;
        for (const url of urls) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), BudgetChatProvider.FETCH_TIMEOUT_MS);
                const res = await fetch(url, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'BudgetMaster/1.0 (VS Code extension)' },
                });
                clearTimeout(timeout);
                if (!res.ok) {
                    failed++;
                    appended += `[Link: ${url}]\n(HTTP ${res.status})\n\n`;
                    continue;
                }
                const contentType = (res.headers.get('content-type') || '').toLowerCase();
                const body = await res.text();
                const text = body.length > BudgetChatProvider.FETCH_MAX_BYTES
                    ? body.slice(0, BudgetChatProvider.FETCH_MAX_BYTES) + '\n… [truncated]'
                    : body;
                const isHtml = contentType.includes('text/html');
                const content = isHtml ? BudgetChatProvider._htmlToText(text) : text;
                if (content.trim()) {
                    appended += (appended ? '\n\n' : '') + `[Link: ${url}]\n${content.trim()}`;
                    ok++;
                } else {
                    appended += (appended ? '\n\n' : '') + `[Link: ${url}]\n(no text content)\n`;
                }
            } catch (e: unknown) {
                failed++;
                const err = e instanceof Error ? e.message : String(e);
                appended += (appended ? '\n\n' : '') + `[Link: ${url}]\n(Failed: ${err})\n`;
            }
        }
        if (!appended) {
            vscode.window.showWarningMessage('Budget Master: No content could be fetched from the given URL(s).');
            return;
        }
        const current = this._pinnedContext || '';
        this._pinnedContext = current ? current + '\n\n' + appended : appended;
        this._notifyContextUpdated();
        const msg = ok > 0
            ? `Budget Master: Fetched ${ok} link(s).${failed ? ` ${failed} failed.` : ''}`
            : `Budget Master: All ${failed} link(s) failed to fetch.`;
        vscode.window.showInformationMessage(msg);
    }

    private _notifyContextUpdated() {
        if (!this._view) return;
        const text = this._pinnedContext || '';
        const hasAny = text.length > 0 || this._attachedImages.length > 0 || this._attachedAudio.length > 0;
        this._view.webview.postMessage({
            type: 'contextUpdated',
            hasContext: hasAny,
            charCount: text.length,
            tokenEstimate: Math.ceil(text.length / 4),
            imageCount: this._attachedImages.length,
            audioCount: this._attachedAudio.length,
        });
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // LISTEN FOR MESSAGES FROM THE UI
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'askAI') {
                await this._handleRequest(data.prompt, data.model);
            } else if (data.type === 'openSettings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'budgetMaster');
            } else if (data.type === 'getEstimate') {
                this._postEstimate(data.prompt || '', data.estimatedOutputTokens || 512);
            } else if (data.type === 'attachFile') {
                await this.attachFilesFromPicker();
            } else if (data.type === 'attachLink') {
                await this.attachLinksFromInput();
            } else if (data.type === 'clearContext') {
                this.setPinnedContext(null);
                vscode.window.showInformationMessage('Budget Master: context cleared');
            } else if (data.type === 'resetSession') {
                this.resetSession();
            } else if (data.type === 'newChat') {
                this.newChat();
            } else if (data.type === 'getChatHistory') {
                this._postChatHistoryList();
            } else if (data.type === 'loadChat') {
                if (data.id) this.loadChat(data.id);
            } else if (data.type === 'deleteChat') {
                if (data.id) this.deleteChat(data.id);
            } else if (data.type === 'applyCodeBlock') {
                await this._applyCodeBlock(data.code ?? '', data.language ?? '', data.path ?? null);
            } else if (data.type === 'runInTerminal') {
                this._runInTerminal(data.command ?? '');
            } else if (data.type === 'searchWorkspace') {
                await this.searchWorkspaceAsContext();
            }
        });
        this._notifyContextUpdated();
    }

    /** Reload the webview HTML (use after updating UI so the new design is visible). */
    public refreshWebview(): void {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            vscode.window.showInformationMessage('Budget Master: UI refreshed.');
        }
    }

    private async _applyCodeBlock(code: string, _language: string, path: string | null) {
        const text = (code || '').trim();
        if (!text) {
            vscode.window.showWarningMessage('Budget Master: No code to apply.');
            return;
        }
        let editor: vscode.TextEditor | undefined;
        if (path) {
            const uri = vscode.Uri.file(path);
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                editor = await vscode.window.showTextDocument(doc);
            } catch {
                editor = vscode.window.activeTextEditor;
            }
        } else {
            editor = vscode.window.activeTextEditor;
        }
        if (!editor) {
            vscode.window.showWarningMessage('Budget Master: Open a file first, or attach a file path.');
            return;
        }
        const selection = editor.selection;
        const hasSelection = !selection.isEmpty;
        await editor.edit((eb) => {
            if (hasSelection) {
                eb.replace(selection, text);
            } else {
                eb.insert(selection.active, text);
            }
        });
        vscode.window.showInformationMessage('Budget Master: Code applied.');
    }

    private _runInTerminal(command: string) {
        const cmd = (command || '').trim();
        if (!cmd) {
            vscode.window.showWarningMessage('Budget Master: No command to run.');
            return;
        }
        const term = vscode.window.createTerminal('Budget Master');
        term.show();
        term.sendText(cmd);
        vscode.window.showInformationMessage(`Budget Master: Running in terminal: ${cmd.slice(0, 50)}${cmd.length > 50 ? '…' : ''}`);
    }

    public async searchWorkspaceAsContext(): Promise<void> {
        const query = await vscode.window.showInputBox({
            title: 'Budget Master: Search workspace',
            prompt: 'Enter text to search in workspace files (content search). Results will be attached as context.',
            placeHolder: 'e.g. function login or TODO',
        });
        if (query === undefined || query === '') return;
        const files = await vscode.workspace.findFiles(
            '**/*',
            '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**}',
            100
        );
        const snippets: string[] = [];
        let count = 0;
        const maxSnippets = 30;
        const maxLength = 8000;
        let totalLen = 0;
        for (const uri of files) {
            if (count >= maxSnippets || totalLen >= maxLength) break;
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText();
                const lowerQuery = query.toLowerCase();
                const lowerText = text.toLowerCase();
                if (!lowerText.includes(lowerQuery)) continue;
                const rel = vscode.workspace.asRelativePath(uri);
                const idx = lowerText.indexOf(lowerQuery);
                const start = Math.max(0, idx - 120);
                const end = Math.min(text.length, idx + query.length + 200);
                const snippet = `[${rel}]\n${text.slice(start, end)}\n`;
                snippets.push(snippet);
                totalLen += snippet.length;
                count++;
            } catch {
                // skip binary or large files
            }
        }
        if (snippets.length === 0) {
            vscode.window.showInformationMessage('Budget Master: No matches found.');
            return;
        }
        const combined = snippets.join('\n---\n');
        this.setPinnedContext(combined);
        this._notifyContextUpdated();
        vscode.window.showInformationMessage(`Budget Master: ${snippets.length} snippet(s) attached as context (~${Math.ceil(combined.length / 4)} tokens).`);
    }

    private async _handleRequest(prompt: string, selectedModel?: string) {
        if (!this._view) return;

        const config = vscode.workspace.getConfiguration('budgetMaster');
        const promptCorrectionEnabled = config.get<boolean>('promptCorrectionEnabled') ?? true;
        const grammarCheckUseLanguageTool = config.get<boolean>('grammarCheckUseLanguageTool') ?? false;
        let promptToUse = prompt;
        let promptWasCorrected = false;
        if (promptCorrectionEnabled && prompt.trim()) {
            const { corrected, changes } = await correctPrompt(prompt, { useLanguageTool: grammarCheckUseLanguageTool });
            if (changes.length > 0) {
                promptToUse = corrected;
                promptWasCorrected = true;
            }
        }

        const sessionBudgetCap = config.get<number>('sessionBudgetCap') ?? 0;
        const sessionBudgetPause = config.get<boolean>('sessionBudgetPause') ?? false;
        if (sessionBudgetCap > 0 && this._totalCost >= sessionBudgetCap && sessionBudgetPause) {
            this._view.webview.postMessage({ type: 'error', text: `Session budget cap ($${sessionBudgetCap.toFixed(2)}) reached. Reset session or increase cap in settings.` });
            return;
        }
        const openaiKey = config.get<string>('openaiKey');
        const anthropicKey = config.get<string>('anthropicKey');
        const xaiKey = config.get<string>('xaiKey');
        const googleKey = config.get<string>('googleKey');
        const kimiKey = config.get<string>('kimiKey');

        const historySlice = this._history.slice(-MAX_HISTORY_MESSAGES);
        const imagesForContext = this._attachedImages.length > 0
            ? this._attachedImages.map(i => ({ mime: i.mime, base64: i.base64 }))
            : undefined;

        const tokenMappingSchemaId = config.get<string>('tokenMappingSchema') ?? '';
        const outputSchema = tokenMappingSchemaId ? getSchemaById(tokenMappingSchemaId) : undefined;
        if (outputSchema) promptToUse = wrapPromptForSchema(promptToUse, outputSchema);

        let effectiveContext: string | null = this._pinnedContext;
        const vectorVaultEnabled = config.get<boolean>('vectorVaultEnabled') ?? false;
        const vectorVaultMinTokens = config.get<number>('vectorVaultMinContextTokens') ?? 2000;
        if (vectorVaultEnabled && this._pinnedContext && openaiKey && estimateTokens(this._pinnedContext) >= vectorVaultMinTokens) {
            try {
                const storedVault = this._context.globalState.get<VectorVaultState>(VAULT_STATE_KEY) ?? null;
                const { contextToUse, vault } = await getRAGContext(this._pinnedContext, promptToUse, openaiKey, storedVault);
                effectiveContext = contextToUse;
                await this._context.globalState.update(VAULT_STATE_KEY, vault);
            } catch (e) {
                this._view?.webview.postMessage({ type: 'status', text: 'Vector Vault failed; using full context. ' + (e instanceof Error ? e.message : String(e)) });
            }
        }
        const contextSqueezerEnabled = config.get<boolean>('contextSqueezerEnabled') ?? true;
        const contextSqueezerStripComments = config.get<boolean>('contextSqueezerStripComments') ?? true;
        const contextSqueezerStripBlankLines = config.get<boolean>('contextSqueezerStripBlankLines') ?? true;
        const contextSqueezerMinChars = config.get<number>('contextSqueezerMinChars') ?? 500;
        if (contextSqueezerEnabled && effectiveContext && effectiveContext.length >= contextSqueezerMinChars) {
            const squeezed = squeezeContext(effectiveContext, {
                stripComments: contextSqueezerStripComments,
                stripBlankLines: contextSqueezerStripBlankLines,
                minCharsToSqueeze: contextSqueezerMinChars,
            });
            if (squeezed.applied && squeezed.reductionPercent > 0) {
                effectiveContext = squeezed.text;
                this._view?.webview.postMessage({
                    type: 'status',
                    text: `Context Squeezer: ${squeezed.originalTokens} → ${squeezed.squeezedTokens} tokens (${Math.round(squeezed.reductionPercent * 100)}% reduction)`,
                });
            }
        }
        const messages = buildMessagesWithPinnedContext(historySlice, promptToUse, effectiveContext, imagesForContext);

        // --- Layer 1: Semantic Cache (Deja Vu) — gatekeeper before any API call ---
        const semanticCacheEnabled = config.get<boolean>('semanticCacheEnabled') ?? true;
        if (semanticCacheEnabled) {
            const activeContext = effectiveContext ?? '';
            const cachedAnswer = checkCache(promptToUse, activeContext);
            if (cachedAnswer) {
                this._history.push({ role: 'user', content: promptToUse });
                this._history.push({ role: 'assistant', content: cachedAnswer });
                if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                // Estimate avoided cost (typical single Sonnet-sized request: ~$0.02)
                const ESTIMATED_COST_AVOIDED_PER_CACHE_HIT = 0.02;
                this._sessionSaved += ESTIMATED_COST_AVOIDED_PER_CACHE_HIT;
                this._view.webview.postMessage({ type: 'status', text: '⚡ Semantic Cache HIT ($0.00)' });
                this._view.webview.postMessage({
                    type: 'response',
                    text: cachedAnswer,
                    cost: 0,
                    total: this._totalCost,
                    sessionSaved: this._sessionSaved,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalInputTokens: this._totalInputTokens,
                    totalOutputTokens: this._totalOutputTokens,
                    byModel: this._byModel,
                    modelLabels: this._getModelLabels(this._byModel),
                    meta: 'Semantic Cache HIT',
                });
                return;
            }
        }

        const checkKey = (p: Provider) => {
            if (p === 'openai' && !openaiKey) { this._view!.webview.postMessage({ type: 'error', text: "⚠️ Set your OpenAI API Key in Settings." }); return false; }
            if (p === 'anthropic' && !anthropicKey) { this._view!.webview.postMessage({ type: 'error', text: "⚠️ Set your Anthropic API Key in Settings." }); return false; }
            if (p === 'xai' && !xaiKey) { this._view!.webview.postMessage({ type: 'error', text: "⚠️ Set your xAI API Key in Settings." }); return false; }
            if (p === 'google' && !googleKey) { this._view!.webview.postMessage({ type: 'error', text: "⚠️ Set your Google API Key in Settings." }); return false; }
            if (p === 'kimi' && !kimiKey) { this._view!.webview.postMessage({ type: 'error', text: "⚠️ Set your Kimi (Moonshot) API Key in Settings." }); return false; }
            return true;
        };

        const toOpenAIContent = (c: string | ContentPart[]): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> => {
            if (typeof c === 'string') return c;
            return c.map(p => p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image_url' as const, image_url: { url: `data:${p.mime};base64,${p.base64}` } });
        };
        type AnthropicMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        const toAnthropicContent = (c: string | ContentPart[]): Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: AnthropicMediaType; data: string } }> => {
            if (typeof c === 'string') return [{ type: 'text', text: c }];
            const allowed: AnthropicMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            return c.map(p => p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image' as const, source: { type: 'base64' as const, media_type: (allowed.includes(p.mime as AnthropicMediaType) ? p.mime : 'image/png') as AnthropicMediaType, data: p.base64 } });
        };
        const toGeminiParts = (c: string | ContentPart[]): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> => {
            if (typeof c === 'string') return [{ text: c }];
            return c.map(p => p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.base64 } });
        };

        type Msg = { role: 'user' | 'assistant'; content: string | ContentPart[] };
        const is429 = (e: unknown): boolean =>
            (e as { status?: number })?.status === 429 ||
            (e as { response?: { status?: number } })?.response?.status === 429 ||
            String((e as Error)?.message ?? '').includes('429');
        const callModel = async (modelId: string, msgs: Msg[], maxTokens = 4096): Promise<{ text: string; inputTokens: number; outputTokens: number }> => {
            try {
                const prov = MODEL_PROVIDER[modelId];
                if (prov === 'anthropic') {
                    const anthropic = new Anthropic({ apiKey: anthropicKey! });
                    const messages = msgs.map(m => ({ role: m.role, content: toAnthropicContent(m.content) }));
                    const msg = await anthropic.messages.create({ model: modelId, max_tokens: maxTokens, messages });
                    const text = (msg.content[0] as { text?: string }).text ?? '';
                    return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
                }
                if (prov === 'google') {
                    const ai = new GoogleGenAI({ apiKey: googleKey! });
                    const geminiContents = msgs.map(m => ({ role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model', parts: toGeminiParts(m.content) }));
                    const response = await ai.models.generateContent({ model: modelId, contents: geminiContents, config: { maxOutputTokens: maxTokens } });
                    const um = response.usageMetadata;
                    const usage = um as { candidatesTokenCount?: number; responseTokenCount?: number } | undefined;
                    return { text: response.text ?? '', inputTokens: um?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? usage?.responseTokenCount ?? 0 };
                }
                if (prov === 'xai') {
                    const xai = new OpenAI({ apiKey: xaiKey!, baseURL: 'https://api.x.ai/v1' });
                    const messages = msgs.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })) as Parameters<OpenAI['chat']['completions']['create']>[0]['messages'];
                    const completion = await xai.chat.completions.create({ messages, model: modelId, max_tokens: maxTokens });
                    return { text: completion.choices[0].message.content || "", inputTokens: completion.usage?.prompt_tokens || 0, outputTokens: completion.usage?.completion_tokens || 0 };
                }
                if (prov === 'kimi') {
                    const kimi = new OpenAI({ apiKey: kimiKey!, baseURL: 'https://api.moonshot.ai/v1' });
                    const messages = msgs.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })) as Parameters<OpenAI['chat']['completions']['create']>[0]['messages'];
                    const completion = await kimi.chat.completions.create({ messages, model: modelId, max_tokens: maxTokens });
                    return { text: completion.choices[0].message.content || "", inputTokens: completion.usage?.prompt_tokens || 0, outputTokens: completion.usage?.completion_tokens || 0 };
                }
                const openai = new OpenAI({ apiKey: openaiKey! });
                const messages = msgs.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })) as Parameters<OpenAI['chat']['completions']['create']>[0]['messages'];
                const completion = await openai.chat.completions.create({ messages, model: modelId, max_tokens: maxTokens });
                return { text: completion.choices[0].message.content || "", inputTokens: completion.usage?.prompt_tokens || 0, outputTokens: completion.usage?.completion_tokens || 0 };
            } catch (e) {
                if (is429(e)) throw new Error('Rate limited (429). Try again in a moment or use another model.');
                throw e;
            }
        };

        const applyCostAndHistory = (replyText: string, inputTokens: number, outputTokens: number, modelId: string, meta?: string, promptCorrected?: boolean) => {
            this._history.push({ role: 'user', content: promptToUse });
            this._history.push({ role: 'assistant', content: replyText });
            if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
            const pricing = PRICES[modelId];
            const cost = pricing ? (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output) : 0;
            this._totalCost += cost;
            this._totalInputTokens += inputTokens;
            this._totalOutputTokens += outputTokens;
            // Track tokens for all models used this session
            if (!this._byModel[modelId]) this._byModel[modelId] = { inputTokens: 0, outputTokens: 0, cost: 0 };
            this._byModel[modelId].inputTokens += inputTokens;
            this._byModel[modelId].outputTokens += outputTokens;
            this._byModel[modelId].cost += cost;
            const cap = config.get<number>('sessionBudgetCap') ?? 0;
            const pause = config.get<boolean>('sessionBudgetPause') ?? false;
            if (cap > 0 && this._totalCost >= cap && !pause) {
                this._view!.webview.postMessage({ type: 'budgetWarn', text: `Session budget cap ($${cap.toFixed(2)}) exceeded. Consider resetting session.` });
            }
            const tier = getModelTier(modelId);
            const benchmarkLabel = `Benchmark: ${tier} (${this._getModelLabel(modelId)})`;
            const metaParts = [benchmarkLabel];
            if (promptCorrected) metaParts.push('Prompt corrected');
            if (meta) metaParts.push(meta);
            this._view!.webview.postMessage({
                type: 'response',
                text: replyText,
                cost,
                total: this._totalCost,
                sessionSaved: this._sessionSaved,
                inputTokens,
                outputTokens,
                totalInputTokens: this._totalInputTokens,
                totalOutputTokens: this._totalOutputTokens,
                byModel: this._byModel,
                modelLabels: this._getModelLabels(this._byModel),
                meta: metaParts.join(' · '),
            });
        };

        try {
            // --- 🎤 Audio: STT (transcribe attached audio) or TTS (speech from prompt) ---
            if (selectedModel && isSTTModel(selectedModel) && this._attachedAudio.length > 0) {
                if (!checkKey(MODEL_PROVIDER[selectedModel])) return;
                this._view.webview.postMessage({ type: 'status', text: `Transcribing with ${this._getModelLabel(selectedModel)}…` });
                const openai = new OpenAI({ apiKey: openaiKey! });
                const audio = this._attachedAudio[0];
                const buf = Buffer.from(audio.base64, 'base64');
                const file = new File([buf], audio.name, { type: audio.mime });
                const pricing = AUDIO_PRICES[selectedModel];
                if (pricing.kind !== 'stt') return;
                try {
                    const transcription = await openai.audio.transcriptions.create({
                        file,
                        model: selectedModel,
                        response_format: 'verbose_json',
                    }) as { text: string; duration?: number };
                    const durationMinutes = (transcription.duration ?? (buf.length * 8 / (128 * 1024))) / 60;
                    const cost = durationMinutes * pricing.perMinute;
                    this._totalCost += cost;
                    const outToks = Math.ceil(transcription.text.length / 4);
                    if (!this._byModel[selectedModel]) this._byModel[selectedModel] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                    this._byModel[selectedModel].outputTokens += outToks;
                    this._byModel[selectedModel].cost += cost;
                    const replyText = `[Transcript]\n${transcription.text}`;
                    this._history.push({ role: 'user', content: `[Audio: ${audio.name}]` });
                    this._history.push({ role: 'assistant', content: replyText });
                    if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                    this._view.webview.postMessage({
                        type: 'response',
                        text: replyText,
                        cost,
                        total: this._totalCost,
                        sessionSaved: this._sessionSaved,
                        inputTokens: 0,
                        outputTokens: outToks,
                        totalInputTokens: this._totalInputTokens,
                        totalOutputTokens: this._totalOutputTokens,
                        byModel: this._byModel,
                        modelLabels: this._getModelLabels(this._byModel),
                        meta: `STT: ${(durationMinutes * 60).toFixed(1)}s · $${cost.toFixed(5)}`,
                    });
                } catch (err: unknown) {
                    this._view.webview.postMessage({ type: 'error', text: `Transcription failed: ${err instanceof Error ? err.message : String(err)}` });
                }
                return;
            }
            if (selectedModel && isTTSModel(selectedModel) && prompt.trim()) {
                if (!checkKey(MODEL_PROVIDER[selectedModel])) return;
                this._view.webview.postMessage({ type: 'status', text: `Generating speech with ${this._getModelLabel(selectedModel)}…` });
                const openai = new OpenAI({ apiKey: openaiKey! });
                const pricing = AUDIO_PRICES[selectedModel];
                if (pricing.kind !== 'tts') return;
                try {
                    const response = await openai.audio.speech.create({
                        model: selectedModel,
                        input: prompt.trim().slice(0, 4096),
                        voice: 'alloy',
                    });
                    const arrayBuffer = await response.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const cost = (prompt.trim().length / 1000) * pricing.perThousandChars;
                    this._totalCost += cost;
                    if (!this._byModel[selectedModel]) this._byModel[selectedModel] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                    this._byModel[selectedModel].cost += cost;
                    this._history.push({ role: 'user', content: prompt });
                    this._history.push({ role: 'assistant', content: '[Audio generated]' });
                    if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                    this._view.webview.postMessage({
                        type: 'response',
                        text: '[Audio generated]',
                        cost,
                        total: this._totalCost,
                        sessionSaved: this._sessionSaved,
                        inputTokens: 0,
                        outputTokens: 0,
                        totalInputTokens: this._totalInputTokens,
                        totalOutputTokens: this._totalOutputTokens,
                        byModel: this._byModel,
                        modelLabels: this._getModelLabels(this._byModel),
                        meta: `TTS: $${cost.toFixed(5)}`,
                    });
                    this._view.webview.postMessage({ type: 'audioResponse', base64, mime: 'audio/mpeg' });
                } catch (err: unknown) {
                    this._view.webview.postMessage({ type: 'error', text: `TTS failed: ${err instanceof Error ? err.message : String(err)}` });
                }
                return;
            }

            // Speculative Drafter: cheap model drafts, expensive model audits (approve or rewrite)
            const speculativeEnabled = config.get<boolean>('speculativeDrafterEnabled') ?? false;
            const isComplexRequest = promptToUse.length > 20;
            if (speculativeEnabled && isComplexRequest) {
                const cheapModel = config.get<string>('cascadeCheapModel') || 'gemini-3-flash-preview';
                const expensiveModel = config.get<string>('cascadeExpensiveModel') || 'claude-3-5-sonnet-20240620';
                if (checkKey(MODEL_PROVIDER[cheapModel]) && checkKey(MODEL_PROVIDER[expensiveModel])) {
                    this._view.webview.postMessage({ type: 'status', text: 'Speculative Drafter: Drafting…' });
                    const cheapModelFunc = async (p: string) => {
                        const res = await callModel(cheapModel, [{ role: 'user', content: p }]);
                        return { text: res.text, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
                    };
                    const expensiveModelFunc = async (p: string) => {
                        const res = await callModel(expensiveModel, [{ role: 'user', content: p }]);
                        return { text: res.text, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
                    };
                    try {
                        const result = await runSpeculativeDraft(
                            promptToUse,
                            effectiveContext ?? '',
                            cheapModelFunc,
                            expensiveModelFunc
                        );
                        if (result.auditStatus === 'APPROVED') {
                            this._view.webview.postMessage({ type: 'status', text: 'Speculative Drafter: Draft APPROVED. Cost saved: ~90%.' });
                        } else {
                            this._view.webview.postMessage({ type: 'status', text: 'Speculative Drafter: Draft REJECTED. Auditor rewrote the code.' });
                        }
                        const di = result.draftInputTokens ?? 0;
                        const draftOut = result.draftOutputTokens ?? 0;
                        const ai = result.auditInputTokens ?? 0;
                        const ao = result.auditOutputTokens ?? 0;
                        const cheapCost = PRICES[cheapModel] ? (di / 1_000_000 * PRICES[cheapModel].input) + (draftOut / 1_000_000 * PRICES[cheapModel].output) : 0;
                        const expPricing = PRICES[expensiveModel];
                        const auditCost = expPricing ? (ai / 1_000_000 * expPricing.input) + (ao / 1_000_000 * expPricing.output) : 0;
                        const totalCost = cheapCost + auditCost;
                        // Savings: if expensive model had done full response (same I/O) minus what we paid
                        if (expPricing && result.auditStatus === 'APPROVED') {
                            const fullExpensiveCost = (di + ai) / 1_000_000 * expPricing.input + (draftOut + ao) / 1_000_000 * expPricing.output;
                            this._sessionSaved += Math.max(0, fullExpensiveCost - totalCost);
                        }
                        this._history.push({ role: 'user', content: promptToUse });
                        this._history.push({ role: 'assistant', content: result.content });
                        if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                        this._totalCost += totalCost;
                        this._totalInputTokens += di + ai;
                        this._totalOutputTokens += draftOut + ao;
                        for (const [mid, usage] of [
                            [cheapModel, { inputTokens: di, outputTokens: draftOut, cost: cheapCost }],
                            [expensiveModel, { inputTokens: ai, outputTokens: ao, cost: auditCost }],
                        ] as const) {
                            if (!this._byModel[mid]) this._byModel[mid] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                            this._byModel[mid].inputTokens += usage.inputTokens;
                            this._byModel[mid].outputTokens += usage.outputTokens;
                            this._byModel[mid].cost += usage.cost;
                        }
                        const cap = config.get<number>('sessionBudgetCap') ?? 0;
                        if (cap > 0 && this._totalCost >= cap && !config.get<boolean>('sessionBudgetPause')) {
                            this._view.webview.postMessage({ type: 'budgetWarn', text: `Session budget cap ($${cap.toFixed(2)}) exceeded. Consider resetting session.` });
                        }
                        const textToShow = outputSchema ? decodeResponse(result.content, outputSchema).displayText : result.content;
                        const metaParts = [`Speculative: ${result.modelUsed}`];
                        if (promptWasCorrected) metaParts.push('Prompt corrected');
                        this._view.webview.postMessage({
                            type: 'response',
                            text: textToShow,
                            cost: totalCost,
                            total: this._totalCost,
                            sessionSaved: this._sessionSaved,
                            inputTokens: di + ai,
                            outputTokens: draftOut + ao,
                            totalInputTokens: this._totalInputTokens,
                            totalOutputTokens: this._totalOutputTokens,
                            byModel: this._byModel,
                            modelLabels: this._getModelLabels(this._byModel),
                            meta: metaParts.join(' · '),
                        });
                        saveToCache(promptToUse, effectiveContext ?? '', textToShow);
                    } catch (err: unknown) {
                        this._view.webview.postMessage({ type: 'error', text: `Speculative Drafter failed: ${err instanceof Error ? err.message : String(err)}` });
                    }
                    return;
                }
            }

            // Auto = Cascade (try cheap first, escalate): use your keys, Cursor-like routing on auto
            if (selectedModel === 'cascade' || selectedModel === 'auto') {
                const cheapModel = config.get<string>('cascadeCheapModel') || 'gemini-3-flash-preview';
                const expensiveModel = config.get<string>('cascadeExpensiveModel') || 'claude-3-5-sonnet-20240620';
                if (!checkKey(MODEL_PROVIDER[cheapModel]) || !checkKey(MODEL_PROVIDER[expensiveModel])) return;
                this._view.webview.postMessage({ type: 'status', text: selectedModel === 'auto' ? `Auto: trying ${this._getModelLabel(cheapModel)} first` : `Cascade: trying ${this._getModelLabel(cheapModel)} first` });
                const cheapResult = await callModel(cheapModel, messages);
                const judgeStrict = config.get<boolean>('cascadeJudgeStrict') ?? false;
                const expectJson = promptExpectsJson(prompt);
                const result = judge(prompt, cheapResult.text, { strict: judgeStrict, expectJson });
                if (result.pass) {
                    const textToShow = outputSchema ? decodeResponse(cheapResult.text, outputSchema).displayText : cheapResult.text;
                    const routeLabel = selectedModel === 'auto' ? 'Auto' : 'Cascade';
                    applyCostAndHistory(textToShow, cheapResult.inputTokens, cheapResult.outputTokens, cheapModel, `${routeLabel}: ${this._getModelLabel(cheapModel)}`, promptWasCorrected);
                    saveToCache(promptToUse, effectiveContext ?? '', textToShow);
                } else {
                    this._view.webview.postMessage({ type: 'status', text: (selectedModel === 'auto' ? 'Auto: ' : 'Cascade: ') + `escalated to ${this._getModelLabel(expensiveModel)}` });
                    const expensiveResult = await callModel(expensiveModel, messages);
                    const cheapCost = PRICES[cheapModel] ? (cheapResult.inputTokens / 1_000_000 * PRICES[cheapModel].input) + (cheapResult.outputTokens / 1_000_000 * PRICES[cheapModel].output) : 0;
                    this._history.push({ role: 'user', content: promptToUse });
                    this._history.push({ role: 'assistant', content: expensiveResult.text });
                    if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                    const expPricing = PRICES[expensiveModel];
                    const expCost = expPricing ? (expensiveResult.inputTokens / 1_000_000 * expPricing.input) + (expensiveResult.outputTokens / 1_000_000 * expPricing.output) : 0;
                    this._totalCost += cheapCost + expCost;
                    this._totalInputTokens += cheapResult.inputTokens + expensiveResult.inputTokens;
                    this._totalOutputTokens += cheapResult.outputTokens + expensiveResult.outputTokens;
                    for (const [mid, usage] of [
                        [cheapModel, { inputTokens: cheapResult.inputTokens, outputTokens: cheapResult.outputTokens, cost: cheapCost }],
                        [expensiveModel, { inputTokens: expensiveResult.inputTokens, outputTokens: expensiveResult.outputTokens, cost: expCost }],
                    ] as const) {
                        if (!this._byModel[mid]) this._byModel[mid] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                        this._byModel[mid].inputTokens += usage.inputTokens;
                        this._byModel[mid].outputTokens += usage.outputTokens;
                        this._byModel[mid].cost += usage.cost;
                    }
                    const cap = config.get<number>('sessionBudgetCap') ?? 0;
                    const pause = config.get<boolean>('sessionBudgetPause') ?? false;
                    if (cap > 0 && this._totalCost >= cap && !pause) {
                        this._view.webview.postMessage({ type: 'budgetWarn', text: `Session budget cap ($${cap.toFixed(2)}) exceeded. Consider resetting session.` });
                    }
                    const tier = getModelTier(expensiveModel);
                    const benchmarkLabel = `Benchmark: ${tier} (${this._getModelLabel(expensiveModel)})`;
                    const routeLabel = selectedModel === 'auto' ? 'Auto' : 'Cascade';
                    const metaParts = [benchmarkLabel, `${routeLabel}: escalated (${this._getModelLabel(cheapModel)} + ${this._getModelLabel(expensiveModel)})`];
                    if (promptWasCorrected) metaParts.push('Prompt corrected');
                    this._view.webview.postMessage({
                        type: 'response',
                        text: expensiveResult.text,
                        cost: cheapCost + expCost,
                        total: this._totalCost,
                        sessionSaved: this._sessionSaved,
                        inputTokens: cheapResult.inputTokens + expensiveResult.inputTokens,
                        outputTokens: cheapResult.outputTokens + expensiveResult.outputTokens,
                        totalInputTokens: this._totalInputTokens,
                        totalOutputTokens: this._totalOutputTokens,
                        byModel: this._byModel,
                        modelLabels: this._getModelLabels(this._byModel),
                        meta: metaParts.join(' · '),
                    });
                    saveToCache(promptToUse, effectiveContext ?? '', expensiveResult.text);
                }
                return;
            }

            if (selectedModel === 'architect-builder') {
                const architectModel = config.get<string>('architectModel') || 'claude-opus-4-6';
                const builderModel = config.get<string>('builderModel') || 'gemini-3-flash-preview';
                if (!checkKey(MODEL_PROVIDER[architectModel]) || !checkKey(MODEL_PROVIDER[builderModel])) return;
                this._view.webview.postMessage({ type: 'status', text: `Smart: Architect (${this._getModelLabel(architectModel)}) + Builder (${this._getModelLabel(builderModel)})` });
                const ab = await runArchitectBuilder(architectModel, builderModel, messages, callModel);
                const planCost = PRICES[architectModel] ? (ab.planInputTokens / 1_000_000 * PRICES[architectModel].input) + (ab.planOutputTokens / 1_000_000 * PRICES[architectModel].output) : 0;
                const buildCost = PRICES[builderModel] ? (ab.responseInputTokens / 1_000_000 * PRICES[builderModel].input) + (ab.responseOutputTokens / 1_000_000 * PRICES[builderModel].output) : 0;
                const abTextToShow = outputSchema ? decodeResponse(ab.response, outputSchema).displayText : ab.response;
                this._history.push({ role: 'user', content: promptToUse });
                this._history.push({ role: 'assistant', content: abTextToShow });
                if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                this._totalCost += planCost + buildCost;
                this._totalInputTokens += ab.planInputTokens + ab.responseInputTokens;
                this._totalOutputTokens += ab.planOutputTokens + ab.responseOutputTokens;
                const archId = config.get<string>('architectModel') || 'claude-opus-4-6';
                const buildId = config.get<string>('builderModel') || 'gemini-3-flash-preview';
                for (const [mid, usage] of [
                    [archId, { inputTokens: ab.planInputTokens, outputTokens: ab.planOutputTokens, cost: planCost }],
                    [buildId, { inputTokens: ab.responseInputTokens, outputTokens: ab.responseOutputTokens, cost: buildCost }],
                ] as const) {
                    if (!this._byModel[mid]) this._byModel[mid] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                    this._byModel[mid].inputTokens += usage.inputTokens;
                    this._byModel[mid].outputTokens += usage.outputTokens;
                    this._byModel[mid].cost += usage.cost;
                }
                const cap = config.get<number>('sessionBudgetCap') ?? 0;
                const pause = config.get<boolean>('sessionBudgetPause') ?? false;
                if (cap > 0 && this._totalCost >= cap && !pause) {
                    this._view.webview.postMessage({ type: 'budgetWarn', text: `Session budget cap ($${cap.toFixed(2)}) exceeded. Consider resetting session.` });
                }
                const buildTier = getModelTier(buildId);
                const metaParts = [`Benchmark: ${buildTier} (${this._getModelLabel(buildId)})`, `Architect: $${planCost.toFixed(5)} · Builder: $${buildCost.toFixed(5)}`];
                if (promptWasCorrected) metaParts.push('Prompt corrected');
                this._view.webview.postMessage({
                    type: 'response',
                    text: abTextToShow,
                    cost: planCost + buildCost,
                    total: this._totalCost,
                    sessionSaved: this._sessionSaved,
                    inputTokens: ab.planInputTokens + ab.responseInputTokens,
                    outputTokens: ab.planOutputTokens + ab.responseOutputTokens,
                    totalInputTokens: this._totalInputTokens,
                    totalOutputTokens: this._totalOutputTokens,
                    byModel: this._byModel,
                    modelLabels: this._getModelLabels(this._byModel),
                    meta: metaParts.join(' · '),
                });
                saveToCache(promptToUse, effectiveContext ?? '', abTextToShow);
                return;
            }

            // Image generation (DALL·E)
            if (selectedModel && isImageModel(selectedModel)) {
                if (!checkKey('openai')) return;
                const modelLabel = this._getModelLabel(selectedModel);
                this._view.webview.postMessage({ type: 'status', text: `Generating image: ${modelLabel}` });
                const openai = new OpenAI({ apiKey: openaiKey! });
                const isD3 = selectedModel.startsWith('dall-e-3');
                const isHd = selectedModel === 'dall-e-3-hd';
                const apiModel = isD3 ? 'dall-e-3' : 'dall-e-2';
                const size = isD3 ? '1024x1024' as const : '1024x1024' as const;
                const quality = isD3 ? (isHd ? 'hd' as const : 'standard' as const) : undefined;
                const imagePrompt = [this._pinnedContext, promptToUse].filter(Boolean).join('\n\n') || promptToUse;
                const genParams = {
                    model: apiModel,
                    prompt: imagePrompt.slice(0, 4000),
                    n: 1 as const,
                    size,
                    response_format: 'b64_json' as const,
                    ...(quality && { quality }),
                };
                const imageResponse = await openai.images.generate(genParams);
                const b64 = (imageResponse.data?.[0] as { b64_json?: string } | undefined)?.b64_json;
                const cost = IMAGE_PRICES[selectedModel].perImage;
                this._totalCost += cost;
                if (!this._byModel[selectedModel]) this._byModel[selectedModel] = { inputTokens: 0, outputTokens: 0, cost: 0 };
                this._byModel[selectedModel].cost += cost;
                this._history.push({ role: 'user', content: promptToUse });
                this._history.push({ role: 'assistant', content: '[Generated image]' });
                if (this._history.length > MAX_HISTORY_MESSAGES) this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
                let imageMeta = `Benchmark: image (${modelLabel}) · 1 image`;
                if (promptWasCorrected) imageMeta = 'Prompt corrected · ' + imageMeta;
                this._view.webview.postMessage({
                    type: 'response',
                    text: '',
                    imageBase64: b64 ?? null,
                    cost,
                    total: this._totalCost,
                    sessionSaved: this._sessionSaved,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalInputTokens: this._totalInputTokens,
                    totalOutputTokens: this._totalOutputTokens,
                    byModel: this._byModel,
                    modelLabels: this._getModelLabels(this._byModel),
                    meta: imageMeta,
                });
                return;
            }

            const isHardTask = /code|function|debug|complex|architecture|optimize|refactor|explain|implement|write/.test(promptToUse.toLowerCase());
            const model = (selectedModel && selectedModel !== 'auto' && MODEL_PROVIDER[selectedModel])
                ? selectedModel
                : (isHardTask ? "claude-3-5-sonnet-20240620" : "gpt-4o-mini");
            const provider = MODEL_PROVIDER[model];
            if (!checkKey(provider)) return;
            const modelLabel = this._getModelLabel(model);
            this._view.webview.postMessage({ type: 'status', text: selectedModel === 'auto' ? `Auto: ${modelLabel}` : `Using: ${modelLabel}` });
            const result = await callModel(model, messages);
            const textToShow = outputSchema ? decodeResponse(result.text, outputSchema).displayText : result.text;
            applyCostAndHistory(textToShow, result.inputTokens, result.outputTokens, model, undefined, promptWasCorrected);
            saveToCache(promptToUse, effectiveContext ?? '', textToShow);
        } catch (error: any) {
            this._view.webview.postMessage({ type: 'error', text: `Error: ${error.message}` });
        }
    }

    /** Rough token estimate: ~4 chars per token for English/code. */
    private _estimateInputTokens(prompt: string): number {
        const historyChars = this._history.reduce((s, m) => s + m.content.length, 0);
        return Math.ceil((historyChars + prompt.length) / 4);
    }

    private _postEstimate(prompt: string, estimatedOutputTokens: number) {
        if (!this._view) return;
        const config = vscode.workspace.getConfiguration('budgetMaster');
        const contextChars = (this._pinnedContext || '').length;
        const estInput = this._estimateInputTokens(prompt);
        const tokenEstimates = getTokenEstimates(prompt, contextChars);
        const entries: { model: string; label: string; cost: number }[] = [];
        for (const [modelId, p] of Object.entries(PRICES)) {
            const cost = (estInput / 1_000_000) * p.input + (estimatedOutputTokens / 1_000_000) * p.output;
            entries.push({ model: modelId, label: this._getModelLabel(modelId), cost });
        }
        for (const [modelId, p] of Object.entries(IMAGE_PRICES)) {
            entries.push({ model: modelId, label: this._getModelLabel(modelId), cost: p.perImage });
        }
        for (const [modelId, p] of Object.entries(AUDIO_PRICES)) {
            const cost = p.kind === 'stt' ? p.perMinute : (prompt.length / 1000) * p.perThousandChars;
            entries.push({ model: modelId, label: this._getModelLabel(modelId), cost });
        }
        entries.sort((a, b) => a.cost - b.cost);
        const suggestion = suggestCheapestModel(estInput, estimatedOutputTokens, PRICES);
        const tokenizerArbitrageNote = config.get<boolean>('tokenizerArbitrageNote') ?? true;
        this._view.webview.postMessage({
            type: 'estimate',
            estimatedInputTokens: estInput,
            estimatedOutputTokens,
            costs: entries,
            tokenizerNote: tokenizerArbitrageNote ? tokenEstimates.note : undefined,
            suggestedModel: suggestion ? { modelId: suggestion.modelId, label: this._getModelLabel(suggestion.modelId), cost: suggestion.estimatedCost } : undefined,
        });
    }

    private _getModelLabels(byModel: Record<string, ModelUsage>): Record<string, string> {
        const out: Record<string, string> = {};
        for (const id of Object.keys(byModel || {})) out[id] = this._getModelLabel(id);
        return out;
    }

    private _getModelLabel(modelId: string): string {
        const labels: Record<string, string> = {
            "gpt-5.2": "GPT-5.2", "gpt-5.2-codex": "GPT-5.2 Codex",
            "gpt-4o-mini": "GPT-4o Mini", "gpt-4o": "GPT-4o", "gpt-4-turbo": "GPT-4 Turbo", "gpt-4": "GPT-4",
            "gpt-3.5-turbo": "GPT-3.5 Turbo", "gpt-4.1": "GPT-4.1", "gpt-4.1-mini": "GPT-4.1 Mini", "gpt-4.1-nano": "GPT-4.1 Nano",
            "o1": "O1", "o1-mini": "O1 Mini", "o3": "O3", "o3-mini": "O3 Mini",
            "claude-opus-4-6": "Claude 4.6 Opus", "claude-sonnet-4-5-20250929": "Claude 4.5 Sonnet", "claude-haiku-4-5-20251001": "Claude 4.5 Haiku",
            "claude-3-5-sonnet-20240620": "Claude 3.5 Sonnet", "claude-3-5-haiku-20241022": "Claude 3.5 Haiku", "claude-3-opus-20240229": "Claude 3 Opus",
            "gemini-3-flash-preview": "Gemini 3 Flash", "gemini-3-pro-preview": "Gemini 3 Pro",
            "gemini-2.5-pro": "Gemini 2.5 Pro", "gemini-2.5-flash": "Gemini 2.5 Flash", "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
            "gemini-2.0-flash-001": "Gemini 2.0 Flash", "gemini-2.0-flash-lite-001": "Gemini 2.0 Flash Lite",
            "grok-4": "Grok 4", "grok-code-fast-1": "Grok Code", "grok-4-fast-reasoning": "Grok 4 Fast (reasoning)", "grok-4-1-fast-reasoning": "Grok 4.1 Fast (reasoning)",
            "grok-4-fast-non-reasoning": "Grok 4 Fast", "grok-4-1-fast-non-reasoning": "Grok 4.1 Fast",
            "grok-3": "Grok 3", "grok-3-mini": "Grok 3 Mini",
            "kimi-k2.5": "Kimi K2.5", "kimi-k2-0905-preview": "Kimi K2 (0905)", "kimi-k2-0711-preview": "Kimi K2 (0711)",
            "kimi-k2-turbo-preview": "Kimi K2 Turbo", "kimi-k2-thinking": "Kimi K2 Thinking", "kimi-k2-thinking-turbo": "Kimi K2 Thinking Turbo",
            "moonshot-v1-8k": "Moonshot v1 8k", "moonshot-v1-32k": "Moonshot v1 32k", "moonshot-v1-128k": "Moonshot v1 128k",
            "moonshot-v1-8k-vision-preview": "Moonshot v1 8k Vision", "moonshot-v1-32k-vision-preview": "Moonshot v1 32k Vision", "moonshot-v1-128k-vision-preview": "Moonshot v1 128k Vision",
            "dall-e-3": "DALL·E 3 Standard", "dall-e-3-hd": "DALL·E 3 HD", "dall-e-2": "DALL·E 2",
            "whisper-1": "Whisper (STT)", "gpt-4o-transcribe": "GPT-4o Transcribe", "gpt-4o-mini-transcribe": "GPT-4o Mini Transcribe",
            "tts-1": "TTS-1", "tts-1-hd": "TTS-1 HD", "gpt-4o-mini-tts": "GPT-4o Mini TTS",
        };
        return labels[modelId] || modelId;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('budgetMaster');
        const defaultModel = (config.get<string>('defaultModel') ?? 'auto').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const supportedModelsData = { premium: premiumModels, free: freeModels };
        const logoPath = path.join(this._extensionUri.fsPath, 'media', 'logo.png');
        let logoSrc = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'logo.png')).toString();
        try {
            if (fs.existsSync(logoPath)) {
                const buf = fs.readFileSync(logoPath);
                logoSrc = 'data:image/png;base64,' + buf.toString('base64');
            }
        } catch (_) { /* keep URI fallback */ }
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script>window.SUPPORTED_MODELS = ${JSON.stringify(supportedModelsData).replace(/<\/script/gi, '<\\/script')}; window.BUDGET_MASTER_DEFAULT_MODEL = '${defaultModel}';</script>
            <style>
                * { box-sizing: border-box; }
                :root {
                    --bg: #000000;
                    --bg-soft: #1c1c1e;
                    --bg-tertiary: #2c2c2e;
                    --fg: #ffffff;
                    --fg-secondary: rgba(255,255,255,0.85);
                    --fg-tertiary: rgba(255,255,255,0.55);
                    --bubble-user: #007AFF;
                    --bubble-ai: #2C2C2E;
                    --border: rgba(255,255,255,0.1);
                    --radius-lg: 18px;
                    --radius-sm: 12px;
                    --radius-pill: 22px;
                    --shadow: 0 1px 2px rgba(0,0,0,0.3);
                    --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
                }
                html, body {
                    height: 100%;
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                }
                body {
                    font-family: var(--font);
                    font-size: 15px;
                    line-height: 1.4;
                    color: var(--fg);
                    background: #000000;
                    display: flex;
                    flex-direction: column;
                    -webkit-font-smoothing: antialiased;
                }
                .header {
                    flex-shrink: 0;
                    padding: 16px 20px 16px;
                    padding-top: max(16px, env(safe-area-inset-top, 16px));
                    display: flex;
                    align-items: center;
                    justify-content: flex-start;
                    gap: 16px;
                    flex-wrap: wrap;
                    background: linear-gradient(180deg, #0a0a0a 0%, #000000 100%);
                    position: relative;
                    border-bottom: none;
                }
                .header::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20px;
                    right: 20px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
                    pointer-events: none;
                }
                .header-logo {
                    width: 56px;
                    height: 56px;
                    object-fit: contain;
                    flex-shrink: 0;
                    filter: drop-shadow(0 2px 8px rgba(0,122,255,0.25));
                    transition: transform 0.2s ease, filter 0.2s ease;
                }
                .header-logo:hover {
                    transform: scale(1.05);
                    filter: drop-shadow(0 4px 12px rgba(0,122,255,0.35));
                }
                .header-title {
                    font-weight: 700;
                    font-size: 20px;
                    letter-spacing: -0.5px;
                    color: var(--fg);
                    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                }
                .header-badge {
                    display: inline-block;
                    margin-left: 8px;
                    padding: 2px 8px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: rgba(0,122,255,0.95);
                    background: rgba(0,122,255,0.15);
                    border-radius: 6px;
                    vertical-align: middle;
                }
                .header-brand {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }
                .header-right {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                    margin-left: auto;
                }
                .session-cost {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    background: rgba(20,20,20,0.9);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: var(--radius-sm);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
                }
                .session-cost-label {
                    font-size: 11px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-tertiary);
                }
                .session-cost-amount {
                    font-size: 15px;
                    font-weight: 600;
                    letter-spacing: -0.02em;
                    color: #34C759;
                }
                .session-cost-amount::before { content: '$'; opacity: 0.8; font-weight: 500; }
                .session-saved {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--fg-tertiary);
                    margin-left: 4px;
                }
                .session-tokens {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    background: rgba(20,20,20,0.9);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: var(--radius-sm);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
                }
                .session-tokens-label {
                    font-size: 11px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-tertiary);
                }
                .session-tokens-amount {
                    font-size: 13px;
                    font-weight: 600;
                    letter-spacing: -0.02em;
                    color: var(--fg);
                }
                .header-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-wrap: wrap;
                }
                .header-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 12px;
                    background: rgba(20,20,20,0.9);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: var(--radius-sm);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
                    color: var(--fg-secondary);
                    font-family: var(--font);
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .header-pill:hover {
                    color: var(--fg);
                    background: rgba(30,30,30,0.95);
                    border-color: rgba(255,255,255,0.12);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
                }
                .header-pill .chevron { font-size: 9px; opacity: 0.9; transition: transform 0.2s; }
                .header-pill.expanded .chevron { transform: rotate(90deg); }
                .header-drawer {
                    flex-shrink: 0;
                    display: none;
                    background: linear-gradient(180deg, #0a0a0a 0%, #000000 100%);
                    border-bottom: none;
                    position: relative;
                }
                .header-drawer::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20px;
                    right: 20px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
                    pointer-events: none;
                }
                .header-drawer.visible {
                    display: block;
                }
                .header-drawer .supported-models-panel { padding: 12px 16px 16px; }
                .header-drawer .by-model-panel { padding: 8px 16px 12px; }
                .header-drawer-all-models { padding: 8px 16px 12px; }
                .icon-btn {
                    width: 32px;
                    height: 32px;
                    border: none;
                    background: transparent;
                    color: var(--fg-tertiary);
                    cursor: pointer;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: color 0.2s, background 0.2s;
                }
                .icon-btn:hover {
                    color: var(--fg);
                    background: var(--bg-tertiary);
                }
                .icon-btn svg { width: 18px; height: 18px; }
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    -webkit-overflow-scrolling: touch;
                    padding: 16px 20px 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    min-height: 0;
                    background: #000000;
                }
                .msg {
                    position: relative;
                    padding: 14px 18px 20px 18px;
                    max-width: 85%;
                    word-wrap: break-word;
                    font-size: 16px;
                    line-height: 1.4;
                    letter-spacing: -0.32px;
                    overflow: visible;
                }
                .msg.user {
                    align-self: flex-end;
                    background: linear-gradient(135deg, #007AFF 0%, #0055CC 100%);
                    color: #fff;
                    border: none;
                    border-radius: 20px 20px 6px 20px;
                    box-shadow: 0 2px 12px rgba(0,122,255,0.3);
                }
                .msg.user::after {
                    content: '';
                    position: absolute;
                    right: -2px;
                    bottom: -1px;
                    width: 14px;
                    height: 12px;
                    background: #0055CC;
                    border-radius: 0 0 12px 0;
                }
                .msg.ai {
                    align-self: flex-start;
                    background: rgba(30,30,30,0.95);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 20px 20px 20px 6px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
                }
                .msg.ai::after {
                    content: '';
                    position: absolute;
                    left: -2px;
                    bottom: -1px;
                    width: 14px;
                    height: 12px;
                    background: rgba(30,30,30,0.95);
                    border-radius: 0 0 0 12px;
                }
                .msg .meta {
                    font-size: 11px;
                    color: var(--fg-tertiary);
                    margin-top: 6px;
                }
                .msg.user .meta { color: var(--fg-secondary); }
                .input-row {
                    flex-shrink: 0;
                    padding: 12px 20px 20px;
                    display: flex;
                    gap: 10px;
                    align-items: flex-end;
                    background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.5) 100%);
                }
                .input-wrap {
                    flex: 1;
                    min-width: 0;
                    background: rgba(20,20,20,0.95);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: var(--radius-pill);
                    padding: 12px 18px;
                    min-height: 48px;
                    max-height: 120px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03);
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }
                .input-wrap:focus-within {
                    border-color: rgba(0,122,255,0.4);
                    box-shadow: 0 2px 16px rgba(0,122,255,0.15), inset 0 1px 0 rgba(255,255,255,0.03);
                }
                #prompt {
                    width: 100%;
                    min-height: 24px;
                    max-height: 96px;
                    border: none;
                    background: transparent;
                    color: var(--fg);
                    font-family: var(--font);
                    font-size: 16px;
                    line-height: 1.35;
                    outline: none;
                    resize: none;
                    overflow-y: auto;
                    display: block;
                }
                #prompt::placeholder { color: var(--fg-tertiary); }
                .send-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    border: none;
                    background: linear-gradient(135deg, #007AFF 0%, #0055CC 100%);
                    color: #fff;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 12px rgba(0,122,255,0.35);
                }
                .send-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(0,122,255,0.45);
                }
                .send-btn:active { transform: scale(0.95) translateY(0); }
                .send-btn svg { width: 22px; height: 22px; }
                .model-bar {
                    flex-shrink: 0;
                    padding: 10px 20px;
                    border-bottom: none;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(10,10,10,0.8);
                    position: relative;
                }
                .model-bar::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20px;
                    right: 20px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
                }
                .model-bar label {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--fg-tertiary);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .model-select {
                    flex: 1;
                    min-width: 0;
                    padding: 8px 12px;
                    font-family: var(--font);
                    font-size: 13px;
                    color: var(--fg);
                    background: rgba(20,20,20,0.9);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
                    transition: border-color 0.2s ease;
                }
                .model-select:hover {
                    border-color: rgba(255,255,255,0.12);
                }
                .model-select:focus {
                    outline: none;
                    border-color: rgba(0,122,255,0.4);
                }
                .estimate-panel {
                    flex-shrink: 0;
                    padding: 12px 20px;
                    border-bottom: none;
                    background: rgba(10,10,10,0.6);
                    position: relative;
                }
                .estimate-panel::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20px;
                    right: 20px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
                }
                .estimate-panel .row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                    font-size: 12px;
                }
                .estimate-panel .est-label {
                    color: var(--fg-tertiary);
                    font-weight: 500;
                }
                .estimate-panel .est-value {
                    font-weight: 600;
                    color: #34C759;
                }
                .estimate-panel .est-value::before { content: '$'; opacity: 0.8; font-weight: 500; }
                .estimate-panel .cheaper-title {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-tertiary);
                    margin-top: 8px;
                    margin-bottom: 4px;
                }
                .estimate-panel .cheaper-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .estimate-panel .cheaper-btn {
                    padding: 4px 10px;
                    font-size: 11px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--bg-soft);
                    color: var(--fg);
                    cursor: pointer;
                    font-family: var(--font);
                }
                .estimate-panel .cheaper-btn:hover {
                    background: var(--bubble-user);
                    color: #fff;
                    border-color: var(--bubble-user);
                }
                .estimate-panel .est-tokens {
                    font-size: 11px;
                    color: var(--fg-tertiary);
                }
                .message-toolbar {
                    flex-shrink: 0;
                    padding: 6px 16px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    background: var(--bg-soft);
                }
                .message-toolbar .icon-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                }
                .message-toolbar .icon-btn svg {
                    width: 16px;
                    height: 16px;
                }
                .context-bar {
                    flex-shrink: 0;
                    padding: 6px 16px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    flex-wrap: wrap;
                    background: var(--bg-soft);
                }
                .context-bar:empty, .context-bar .context-summary:empty { display: none; }
                .context-summary {
                    font-size: 12px;
                    color: var(--fg-tertiary);
                }
                .context-actions { display: flex; gap: 8px; align-items: center; }
                .text-btn {
                    padding: 4px 10px;
                    font-size: 12px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--bg-soft);
                    color: var(--fg);
                    cursor: pointer;
                    font-family: var(--font);
                }
                .text-btn:hover {
                    background: var(--bg-tertiary);
                }
                .text-btn.hidden { display: none; }
                .top-controls-scroll {
                    flex-shrink: 0;
                    max-height: 42vh;
                    overflow-y: auto;
                    overflow-x: hidden;
                    -webkit-overflow-scrolling: touch;
                    border-bottom: none;
                    background: linear-gradient(180deg, rgba(10,10,10,0.8) 0%, rgba(0,0,0,0.9) 100%);
                    position: relative;
                }
                .top-controls-scroll::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20px;
                    right: 20px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
                }
                .supported-models-wrap {
                    background: transparent;
                }
                .supported-models-toggle {
                    width: 100%;
                    padding: 8px 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    border: none;
                    background: transparent;
                    color: var(--fg);
                    font-family: var(--font);
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    text-align: left;
                }
                .supported-models-toggle:hover { background: var(--bg-tertiary); }
                .supported-models-toggle .chevron { transition: transform 0.2s; }
                .supported-models-toggle.expanded .chevron { transform: rotate(90deg); }
                .supported-models-panel {
                    display: none;
                    padding: 12px 16px 16px;
                    max-height: none;
                    overflow-x: auto;
                    overflow-y: visible;
                }
                .supported-models-panel.visible { display: block; }
                .supported-models-panel h4 {
                    margin: 0 0 8px 0;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-tertiary);
                }
                .supported-models-panel table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .supported-models-panel th,
                .supported-models-panel td {
                    padding: 6px 10px;
                    text-align: left;
                    border: 1px solid var(--border);
                }
                .supported-models-panel th {
                    background: var(--bg-soft);
                    font-weight: 600;
                }
                .supported-models-panel td.check { color: #34C759; }
                .history-panel {
                    display: none;
                    flex-shrink: 0;
                    flex-direction: column;
                    border-bottom: 1px solid var(--border);
                    background: var(--bg-soft);
                    max-height: 220px;
                    overflow: hidden;
                }
                .history-panel.visible { display: flex; }
                .history-panel-header {
                    padding: 8px 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--fg-secondary);
                }
                .history-panel-list {
                    overflow-y: auto;
                    padding: 4px 8px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .history-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 8px 12px;
                    border-radius: var(--radius-sm);
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border);
                    cursor: pointer;
                    text-align: left;
                    font-size: 13px;
                    color: var(--fg);
                    font-family: var(--font);
                }
                .history-item:hover {
                    background: rgba(255,255,255,0.08);
                    border-color: rgba(10,132,255,0.4);
                }
                .history-item-title {
                    flex: 1;
                    min-width: 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .history-item-meta {
                    flex-shrink: 0;
                    font-size: 11px;
                    color: var(--fg-tertiary);
                }
                .history-item-delete {
                    flex-shrink: 0;
                    width: 24px;
                    height: 24px;
                    border: none;
                    background: transparent;
                    color: var(--fg-tertiary);
                    cursor: pointer;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                }
                .history-item-delete:hover {
                    color: #ff453a;
                    background: rgba(255,69,58,0.15);
                }
                .history-item-delete svg { width: 14px; height: 14px; }
                .code-block-wrap { margin: 8px 0; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border); background: var(--bg-tertiary); }
                .code-block-wrap pre { margin: 0; padding: 10px 12px; overflow-x: auto; font-size: 13px; line-height: 1.4; white-space: pre; }
                .code-block-wrap .code-actions { padding: 6px 10px; border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; }
                .code-block-wrap .code-actions button { padding: 4px 10px; font-size: 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-soft); color: var(--fg); cursor: pointer; font-family: var(--font); }
                .code-block-wrap .code-actions button:hover { background: var(--bubble-user); color: #fff; border-color: var(--bubble-user); }
                .history-empty {
                    padding: 16px;
                    font-size: 12px;
                    color: var(--fg-tertiary);
                    text-align: center;
                }
                .cursor-style-hint {
                    margin: 6px 12px 0;
                    padding: 0;
                    font-size: 11px;
                    color: var(--fg-tertiary);
                    line-height: 1.3;
                }
                .cursor-style-hint strong { font-weight: 600; color: var(--fg-secondary); }
                .by-model-wrap {
                    flex-shrink: 0;
                    background: transparent;
                }
                .by-model-toggle {
                    width: 100%;
                    padding: 6px 0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    border: none;
                    background: transparent;
                    color: var(--fg-tertiary);
                    font-family: var(--font);
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    cursor: pointer;
                    text-align: left;
                }
                .by-model-toggle:hover { color: var(--fg); }
                .by-model-toggle .chevron { transition: transform 0.2s; }
                .by-model-toggle.expanded .chevron { transform: rotate(90deg); }
                .by-model-panel {
                    display: none;
                    padding: 8px 16px 12px;
                    font-size: 12px;
                }
                .by-model-panel.visible { display: block; }
                .by-model-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 4px 0;
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                }
                .by-model-row:last-child { border-bottom: none; }
                .by-model-name { color: var(--fg-secondary); }
                .by-model-meta { color: var(--fg-tertiary); font-size: 11px; }
                .all-models-toggle {
                    padding: 4px 0;
                    font-size: 11px;
                    color: var(--fg-tertiary);
                    cursor: pointer;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .all-models-toggle:hover { color: var(--fg); }
                .all-models-list { display: none; margin-top: 6px; }
                .all-models-list.visible { display: block; }
            </style>
        </head>
        <body data-ui-version="message-toolbar">
            <header class="header">
                <div class="header-brand">
                    <img src="${logoSrc.replace(/"/g, '&quot;')}" alt="Budget Master" class="header-logo" width="56" height="56" />
                    <span class="header-title">Budget Master<span class="header-badge">updated</span></span>
                </div>
                <div class="header-right">
                    <div class="session-tokens">
                        <span class="session-tokens-label">Tokens</span>
                        <span class="session-tokens-amount" id="total-tokens">0</span>
                    </div>
                    <div class="session-cost">
                        <span class="session-cost-label">Session</span>
                        <span class="session-cost-amount" id="total-cost">0.0000</span>
                        <span class="session-saved" id="session-saved"></span>
                    </div>
                </div>
                <div class="header-actions">
                    <button type="button" class="header-pill" id="supported-models-toggle" aria-expanded="false">
                        <span class="chevron">▶</span>
                        <span>Supported</span>
                    </button>
                    <button type="button" class="header-pill" id="by-model-toggle" aria-expanded="false">
                        <span class="chevron">▶</span>
                        <span>Tokens by model</span>
                    </button>
                    <button type="button" class="header-pill" id="all-models-toggle" aria-expanded="false">
                        <span class="chevron">▶</span>
                        <span>All models (est.)</span>
                    </button>
                </div>
            </header>
            <div class="header-drawer" id="header-drawer">
                <div class="supported-models-wrap">
                    <div class="supported-models-panel" id="supported-models-panel">
                        <h4>Premium models (require login / API key)</h4>
                        <table id="supported-premium-table">
                            <thead><tr><th>Model</th><th>Browser</th><th>API</th><th>Login required</th></tr></thead>
                            <tbody></tbody>
                        </table>
                        <h4 style="margin-top: 14px;">Free models (no signup / API key required)</h4>
                        <table id="supported-free-table">
                            <thead><tr><th>Model</th><th>Provider</th><th>Free tier</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
                <div class="by-model-wrap" id="by-model-wrap">
                    <div class="by-model-panel" id="by-model-panel">
                        <div id="by-model-list"></div>
                    </div>
                </div>
                <div class="header-drawer-all-models">
                    <div class="all-models-list" id="all-models-list"></div>
                </div>
            </div>
            <div class="history-panel" id="history-panel">
                <div class="history-panel-header">
                    <span>Past chats</span>
                    <button type="button" class="text-btn" id="history-close-btn" style="font-size: 11px;">Close</button>
                </div>
                <div class="history-panel-list" id="history-list"></div>
            </div>
            <div class="top-controls-scroll">
            <div class="model-bar">
                <label for="model-select">Model</label>
                <select id="model-select" class="model-select" aria-label="Choose AI model">
                    <option value="auto">Auto (smart routing)</option>
                    <option value="cascade">Cascade (try cheap first)</option>
                    <option value="architect-builder">Smart (Architect + Builder)</option>
                    <optgroup label="Cursor (same as editor)">
                        <option value="claude-sonnet-4-5-20250929">Claude 4.5 Sonnet</option>
                        <option value="claude-opus-4-6">Claude 4.6 Opus</option>
                        <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                        <option value="gpt-5.2">GPT-5.2</option>
                        <option value="gpt-5.2-codex">GPT-5.2 Codex</option>
                        <option value="grok-code-fast-1">Grok Code</option>
                    </optgroup>
                    <optgroup label="OpenAI (ChatGPT)">
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                        <option value="gpt-4">GPT-4</option>
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                        <option value="gpt-4.1">GPT-4.1</option>
                        <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                        <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                        <option value="o1">O1</option>
                        <option value="o1-mini">O1 Mini</option>
                        <option value="o3">O3</option>
                        <option value="o3-mini">O3 Mini</option>
                    </optgroup>
                    <optgroup label="Claude (Anthropic)">
                        <option value="claude-haiku-4-5-20251001">Claude 4.5 Haiku</option>
                        <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet</option>
                        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                        <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    </optgroup>
                    <optgroup label="Gemini (Google)">
                        <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                        <option value="gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                        <option value="gemini-2.0-flash-lite-001">Gemini 2.0 Flash Lite</option>
                    </optgroup>
                    <optgroup label="Grok (xAI)">
                        <option value="grok-4">Grok 4</option>
                        <option value="grok-4-1-fast-reasoning">Grok 4.1 Fast (reasoning)</option>
                        <option value="grok-4-fast-reasoning">Grok 4 Fast (reasoning)</option>
                        <option value="grok-4-1-fast-non-reasoning">Grok 4.1 Fast</option>
                        <option value="grok-4-fast-non-reasoning">Grok 4 Fast</option>
                        <option value="grok-3">Grok 3</option>
                        <option value="grok-3-mini">Grok 3 Mini</option>
                    </optgroup>
                    <optgroup label="Image generation">
                        <option value="dall-e-3">DALL·E 3 Standard</option>
                        <option value="dall-e-3-hd">DALL·E 3 HD</option>
                        <option value="dall-e-2">DALL·E 2</option>
                    </optgroup>
                    <optgroup label="Kimi (Moonshot AI)">
                        <option value="kimi-k2.5">Kimi K2.5</option>
                        <option value="kimi-k2-turbo-preview">Kimi K2 Turbo</option>
                        <option value="kimi-k2-0905-preview">Kimi K2 (0905)</option>
                        <option value="kimi-k2-0711-preview">Kimi K2 (0711)</option>
                        <option value="kimi-k2-thinking">Kimi K2 Thinking</option>
                        <option value="kimi-k2-thinking-turbo">Kimi K2 Thinking Turbo</option>
                        <option value="moonshot-v1-8k">Moonshot v1 8k</option>
                        <option value="moonshot-v1-32k">Moonshot v1 32k</option>
                        <option value="moonshot-v1-128k">Moonshot v1 128k</option>
                        <option value="moonshot-v1-8k-vision-preview">Moonshot v1 8k Vision</option>
                        <option value="moonshot-v1-32k-vision-preview">Moonshot v1 32k Vision</option>
                        <option value="moonshot-v1-128k-vision-preview">Moonshot v1 128k Vision</option>
                    </optgroup>
                </select>
            </div>
            <div class="estimate-panel" id="estimate-panel">
                <div class="row">
                    <span class="est-label">Before you send (est.):</span>
                    <span class="est-value" id="est-selected">—</span>
                    <span class="est-tokens" id="est-tokens"></span>
                </div>
                <div class="cheaper-title">Same result, cheaper — pick one to save:</div>
                <div class="cheaper-list" id="cheaper-list"></div>
                <div class="tokenizer-note" id="tokenizer-note" style="font-size: 11px; color: var(--fg-tertiary); margin-top: 6px;"></div>
            </div>
            </div>
            <div class="chat-container" id="chat"></div>
            <div class="message-toolbar">
                <button type="button" class="icon-btn" id="new-chat-btn" aria-label="New chat" title="New chat (current chat saved to history)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                <button type="button" class="icon-btn" id="history-btn" aria-label="Past chats" title="Past chats">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </button>
                <button type="button" class="icon-btn" id="reset-session-btn" aria-label="Reset session" title="Reset session (clear history & cost)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
                <button type="button" class="icon-btn" id="settings-btn" aria-label="Open Budget Master settings" title="Settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            </div>
            <div class="context-bar" id="context-bar">
                <span class="context-summary" id="context-summary"></span>
                <div class="context-actions">
                    <button type="button" class="text-btn" id="attach-btn" title="Attach any file(s) as context">Attach file(s)</button>
                    <button type="button" class="text-btn" id="attach-link-btn" title="Fetch URL(s) and attach as context">Attach link(s)</button>
                    <button type="button" class="text-btn" id="search-workspace-btn" title="Search workspace and attach matches as context">Search workspace</button>
                    <button type="button" class="text-btn hidden" id="clear-context-btn" title="Clear attached context">Clear context</button>
                </div>
            </div>
            <div class="input-row">
                <div class="input-wrap">
                    <textarea id="prompt" placeholder="Ask anything..." autocomplete="off" rows="1"></textarea>
                </div>
                <button type="button" class="send-btn" id="send" aria-label="Send">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
            <p class="cursor-style-hint">Like Cursor chat: use <strong>Apply to editor</strong> and <strong>Run in terminal</strong> on code blocks; <strong>Search workspace</strong> for context.</p>
            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const prompt = document.getElementById('prompt');
                const totalCostEl = document.getElementById('total-cost');
                const totalTokensEl = document.getElementById('total-tokens');
                const sessionSavedEl = document.getElementById('session-saved');
                const sendBtn = document.getElementById('send');
                const estSelectedEl = document.getElementById('est-selected');
                const estTokensEl = document.getElementById('est-tokens');
                const cheaperListEl = document.getElementById('cheaper-list');
                const modelSelect = document.getElementById('model-select');
                const contextSummaryEl = document.getElementById('context-summary');
                const attachBtn = document.getElementById('attach-btn');
                const clearContextBtn = document.getElementById('clear-context-btn');
                const contextBarEl = document.getElementById('context-bar');
                const byModelWrap = document.getElementById('by-model-wrap');
                const byModelToggle = document.getElementById('by-model-toggle');
                const byModelPanel = document.getElementById('by-model-panel');
                const byModelListEl = document.getElementById('by-model-list');
                const allModelsToggle = document.getElementById('all-models-toggle');
                const allModelsListEl = document.getElementById('all-models-list');

                if (window.BUDGET_MASTER_DEFAULT_MODEL && modelSelect.querySelector('option[value="' + String(window.BUDGET_MASTER_DEFAULT_MODEL).replace(/"/g, '&quot;') + '"]')) {
                    modelSelect.value = window.BUDGET_MASTER_DEFAULT_MODEL;
                }

                function formatTokens(n) {
                    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
                    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
                    return String(n);
                }

                let estimateDebounce;
                function requestEstimate() {
                    clearTimeout(estimateDebounce);
                    estimateDebounce = setTimeout(() => {
                        const p = (prompt.value || '').trim();
                        vscode.postMessage({ type: 'getEstimate', prompt: p, estimatedOutputTokens: 512 });
                    }, 300);
                }

                function send() {
                    const text = (prompt.value || '').trim();
                    if (!text) return;
                    const model = document.getElementById('model-select').value;
                    addMessage(text, 'user');
                    vscode.postMessage({ type: 'askAI', prompt: text, model: model });
                    prompt.value = '';
                    resizePrompt();
                }

                function resizePrompt() {
                    prompt.style.height = 'auto';
                    prompt.style.height = Math.min(prompt.scrollHeight, 96) + 'px';
                }
                prompt.addEventListener('input', function() { requestEstimate(); resizePrompt(); });
                prompt.addEventListener('focus', requestEstimate);
                prompt.addEventListener('paste', function() { setTimeout(resizePrompt, 0); });
                modelSelect.addEventListener('change', requestEstimate);
                prompt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                });
                sendBtn.addEventListener('click', send);
                document.getElementById('reset-session-btn').addEventListener('click', () => vscode.postMessage({ type: 'resetSession' }));
                document.getElementById('new-chat-btn').addEventListener('click', () => vscode.postMessage({ type: 'newChat' }));
                document.getElementById('history-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'getChatHistory' });
                });
                document.getElementById('settings-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'openSettings' });
                });
                const historyPanel = document.getElementById('history-panel');
                const historyListEl = document.getElementById('history-list');
                document.getElementById('history-close-btn').addEventListener('click', () => {
                    historyPanel.classList.remove('visible');
                });

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.type === 'estimate') {
                        const costs = msg.costs || [];
                        const selected = modelSelect.value;
                        const selectedEntry = costs.find(e => e.model === selected);
                        const forAuto = costs.length ? costs[0] : null;
                        const displayModel = (selected === 'auto' && forAuto) ? forAuto : selectedEntry;
                        if (displayModel) {
                            estSelectedEl.textContent = displayModel.cost.toFixed(5);
                        } else {
                            estSelectedEl.textContent = '—';
                        }
                        const imageModels = ['dall-e-3', 'dall-e-3-hd', 'dall-e-2'];
                        const sel = modelSelect.value;
                        estTokensEl.textContent = imageModels.includes(sel)
                            ? '1 image'
                            : '~' + formatTokens(msg.estimatedInputTokens || 0) + ' in / ~' + formatTokens(msg.estimatedOutputTokens || 0) + ' out';
                        cheaperListEl.innerHTML = '';
                        const show = costs.slice(0, 8);
                        show.forEach(entry => {
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'cheaper-btn';
                            btn.textContent = entry.label + ' ($' + entry.cost.toFixed(5) + ')';
                            btn.title = 'Use ' + entry.label + ' instead (same quality, lower cost)';
                            btn.addEventListener('click', () => {
                                modelSelect.value = entry.model;
                                requestEstimate();
                            });
                            cheaperListEl.appendChild(btn);
                        });
                        if (allModelsListEl) {
                            allModelsListEl.innerHTML = costs.map(entry => {
                                return '<div class="by-model-row"><span class="by-model-name">' + escapeHtml(entry.label) + '</span><span class="by-model-meta">$' + entry.cost.toFixed(5) + '</span></div>';
                            }).join('');
                        }
                        const tokenizerNoteEl = document.getElementById('tokenizer-note');
                        if (tokenizerNoteEl) {
                            const parts = [];
                            if (msg.tokenizerNote) parts.push(msg.tokenizerNote);
                            if (msg.suggestedModel) parts.push('Suggested (cheapest): ' + msg.suggestedModel.label + ' ($' + msg.suggestedModel.cost.toFixed(5) + ').');
                            tokenizerNoteEl.textContent = parts.join(' ');
                        }
                    } else if (msg.type === 'response') {
                        addMessage(msg.text, 'ai', msg.cost, msg.inputTokens, msg.outputTokens, msg.meta, msg.imageBase64);
                        totalCostEl.textContent = msg.total.toFixed(4);
                        if (sessionSavedEl) sessionSavedEl.textContent = (msg.sessionSaved > 0) ? '(Saved $' + msg.sessionSaved.toFixed(2) + ' this session)' : '';
                        const totalIn = msg.totalInputTokens || 0;
                        const totalOut = msg.totalOutputTokens || 0;
                        totalTokensEl.textContent = formatTokens(totalIn + totalOut) + ' (in: ' + formatTokens(totalIn) + ' / out: ' + formatTokens(totalOut) + ')';
                        renderByModel(msg.byModel, msg.modelLabels);
                    } else if (msg.type === 'status') {
                        addMessage("⚙️ " + msg.text, 'ai');
                    } else if (msg.type === 'error') {
                        addMessage("❌ " + msg.text, 'ai');
                    } else if (msg.type === 'audioResponse') {
                        const lastAi = chat.querySelector('.msg.ai:last-of-type');
                        if (lastAi && msg.base64) {
                            const audio = document.createElement('audio');
                            audio.controls = true;
                            audio.src = 'data:' + (msg.mime || 'audio/mpeg') + ';base64,' + msg.base64;
                            audio.style.marginTop = '8px';
                            audio.style.maxWidth = '100%';
                            lastAi.appendChild(audio);
                        }
                    } else if (msg.type === 'sessionReset') {
                        chat.innerHTML = '';
                        totalCostEl.textContent = '0.0000';
                        if (sessionSavedEl) sessionSavedEl.textContent = '';
                        totalTokensEl.textContent = '0';
                        renderByModel(msg.byModel || {}, {});
                    } else if (msg.type === 'budgetWarn') {
                        addMessage('⚠️ ' + (msg.text || 'Session budget cap exceeded.'), 'ai');
                    } else if (msg.type === 'contextUpdated') {
                        const hasContext = msg.hasContext === true;
                        if (hasContext) {
                            const parts = [];
                            if ((msg.tokenEstimate || 0) > 0) parts.push('~' + formatTokens(msg.tokenEstimate) + ' tokens');
                            if ((msg.imageCount || 0) > 0) parts.push(msg.imageCount + ' image(s)');
                            if ((msg.audioCount || 0) > 0) parts.push(msg.audioCount + ' audio');
                            contextSummaryEl.textContent = 'Context: ' + (parts.length ? parts.join(', ') : 'attached');
                            clearContextBtn.classList.remove('hidden');
                        } else {
                            contextSummaryEl.textContent = '';
                            clearContextBtn.classList.add('hidden');
                        }
                    } else if (msg.type === 'chatHistoryList') {
                        const chats = msg.chats || [];
                        historyListEl.innerHTML = '';
                        if (chats.length === 0) {
                            const empty = document.createElement('div');
                            empty.className = 'history-empty';
                            empty.textContent = 'No past chats. Start a chat and use "New chat" to save the current one here.';
                            historyListEl.appendChild(empty);
                        } else {
                            chats.forEach(function(c) {
                                const item = document.createElement('div');
                                item.className = 'history-item';
                                item.setAttribute('data-id', c.id);
                                const title = document.createElement('span');
                                title.className = 'history-item-title';
                                title.textContent = c.title || 'Chat';
                                const meta = document.createElement('span');
                                meta.className = 'history-item-meta';
                                const date = new Date(c.createdAt);
                                meta.textContent = date.toLocaleDateString() + ' · $' + (c.totalCost || 0).toFixed(4);
                                const delBtn = document.createElement('button');
                                delBtn.type = 'button';
                                delBtn.className = 'history-item-delete';
                                delBtn.setAttribute('aria-label', 'Delete chat');
                                delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
                                delBtn.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({ type: 'deleteChat', id: c.id }); });
                                item.appendChild(title);
                                item.appendChild(meta);
                                item.appendChild(delBtn);
                                item.addEventListener('click', function(e) { if (!e.target.closest('.history-item-delete')) { vscode.postMessage({ type: 'loadChat', id: c.id }); historyPanel.classList.remove('visible'); } });
                                historyListEl.appendChild(item);
                            });
                        }
                        historyPanel.classList.add('visible');
                    } else if (msg.type === 'showChatHistory') {
                        vscode.postMessage({ type: 'getChatHistory' });
                    } else if (msg.type === 'focusPrompt') {
                        const promptEl = document.getElementById('prompt');
                        if (promptEl) { promptEl.focus(); requestEstimate(); }
                    } else if (msg.type === 'loadChat') {
                        chat.innerHTML = '';
                        const msgs = msg.messages || [];
                        msgs.forEach(function(m) {
                            addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
                        });
                        totalCostEl.textContent = (msg.totalCost != null ? msg.totalCost : 0).toFixed(4);
                        if (sessionSavedEl) sessionSavedEl.textContent = (msg.sessionSaved > 0) ? '(Saved $' + msg.sessionSaved.toFixed(2) + ' this session)' : '';
                        const totalIn = msg.totalInputTokens || 0;
                        const totalOut = msg.totalOutputTokens || 0;
                        totalTokensEl.textContent = formatTokens(totalIn + totalOut) + ' (in: ' + formatTokens(totalIn) + ' / out: ' + formatTokens(totalOut) + ')';
                        renderByModel(msg.byModel || {}, msg.modelLabels || {});
                        historyPanel.classList.remove('visible');
                    }
                });

                function renderByModel(byModel, modelLabels) {
                    if (!byModelListEl) return;
                    const keys = Object.keys(byModel || {});
                    if (keys.length === 0) {
                        byModelListEl.innerHTML = '<div class="by-model-row"><span class="by-model-name">No model usage yet</span></div>';
                        return;
                    }
                    byModelListEl.innerHTML = keys.map(function(id) {
                        const u = byModel[id];
                        const label = (modelLabels && modelLabels[id]) || id;
                        const inOut = (u.inputTokens || u.outputTokens) ? (formatTokens(u.inputTokens || 0) + ' in / ' + formatTokens(u.outputTokens || 0) + ' out') : '';
                        const costStr = u.cost != null ? '$' + u.cost.toFixed(5) : '';
                        return '<div class="by-model-row"><span class="by-model-name">' + escapeHtml(label) + '</span><span class="by-model-meta">' + (inOut ? inOut + ' · ' : '') + costStr + '</span></div>';
                    }).join('');
                }
                function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

                const headerDrawer = document.getElementById('header-drawer');
                const supportedPanel = document.getElementById('supported-models-panel');
                function updateHeaderDrawerVisibility() {
                    const anyVisible = (supportedPanel && supportedPanel.classList.contains('visible')) ||
                        (byModelPanel && byModelPanel.classList.contains('visible')) ||
                        (allModelsListEl && allModelsListEl.classList.contains('visible'));
                    if (headerDrawer) headerDrawer.classList.toggle('visible', !!anyVisible);
                }
                if (byModelToggle && byModelPanel) {
                    byModelToggle.addEventListener('click', () => {
                        const on = byModelToggle.classList.toggle('expanded');
                        byModelPanel.classList.toggle('visible', on);
                        byModelToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
                        updateHeaderDrawerVisibility();
                    });
                }
                if (allModelsToggle && allModelsListEl) {
                    allModelsToggle.addEventListener('click', () => {
                        const on = allModelsListEl.classList.toggle('visible');
                        allModelsToggle.classList.toggle('expanded', on);
                        allModelsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
                        updateHeaderDrawerVisibility();
                    });
                }
                attachBtn.addEventListener('click', () => vscode.postMessage({ type: 'attachFile' }));
                document.getElementById('attach-link-btn').addEventListener('click', () => vscode.postMessage({ type: 'attachLink' }));
                document.getElementById('search-workspace-btn').addEventListener('click', () => vscode.postMessage({ type: 'searchWorkspace' }));
                clearContextBtn.addEventListener('click', () => vscode.postMessage({ type: 'clearContext' }));

                chat.addEventListener('click', function(e) {
                    const btn = e.target.closest('.code-action-btn');
                    if (!btn) return;
                    const wrap = btn.closest('.code-block-wrap');
                    const codeEl = wrap && wrap.querySelector('pre code');
                    const code = codeEl ? codeEl.textContent : '';
                    if (btn.dataset.action === 'apply') vscode.postMessage({ type: 'applyCodeBlock', code: code });
                    else if (btn.dataset.action === 'run') vscode.postMessage({ type: 'runInTerminal', command: code });
                });

                function renderMessageContent(text) {
                    if (!text) return '';
                    var bt = String.fromCharCode(96);
                    var re = new RegExp(bt + bt + bt + '(\\\\w*)\\\\n?([\\\\s\\\\S]*?)' + bt + bt + bt, 'g');
                    var parts = [];
                    var lastIndex = 0;
                    var m;
                    while ((m = re.exec(text)) !== null) {
                        if (m.index > lastIndex) {
                            var plain = text.slice(lastIndex, m.index);
                            parts.push('<span class="msg-plain">' + escapeHtml(plain).replace(/\\n/g, '<br>') + '</span>');
                        }
                        var lang = (m[1] || '').toLowerCase();
                        var code = m[2].replace(/^\\n/, '').replace(/\\n$/, '');
                        var codeId = 'cb-' + Math.random().toString(36).slice(2, 9);
                        var isShell = ['bash','sh','shell','zsh','powershell','ps1','cmd'].indexOf(lang) >= 0;
                        var actionsHtml = '<button type="button" class="code-action-btn" data-action="apply" data-id="' + codeId + '">Apply to editor</button>';
                        if (isShell) actionsHtml += ' <button type="button" class="code-action-btn" data-action="run" data-id="' + codeId + '">Run in terminal</button>';
                        parts.push('<div class="code-block-wrap"><pre><code id="' + codeId + '">' + escapeHtml(code) + '</code></pre><div class="code-actions">' + actionsHtml + '</div></div>');
                        lastIndex = re.lastIndex;
                    }
                    if (lastIndex < text.length) {
                        var plain = text.slice(lastIndex);
                        parts.push('<span class="msg-plain">' + escapeHtml(plain).replace(/\\\\n/g, '<br>') + '</span>');
                    }
                    return parts.length ? parts.join('') : escapeHtml(text).replace(/\\n/g, '<br>');
                }

                function addMessage(text, role, cost = null, inputTokens = null, outputTokens = null, modeMeta = null, imageBase64 = null) {
                    const div = document.createElement('div');
                    div.className = 'msg ' + role;
                    if (imageBase64) {
                        const img = document.createElement('img');
                        img.src = 'data:image/png;base64,' + imageBase64;
                        img.alt = 'Generated image';
                        img.style.maxWidth = '100%';
                        img.style.borderRadius = 'var(--radius-sm)';
                        img.style.display = 'block';
                        div.appendChild(img);
                    }
                    if (text) div.innerHTML += renderMessageContent(text.replace(/\\\\n/g, '\\n'));
                    const metaParts = [];
                    if (inputTokens != null && outputTokens != null && (inputTokens > 0 || outputTokens > 0)) {
                        metaParts.push(formatTokens(inputTokens) + ' in / ' + formatTokens(outputTokens) + ' out');
                    }
                    if (cost != null) metaParts.push('$' + cost.toFixed(5));
                    if (modeMeta) metaParts.push(modeMeta);
                    if (metaParts.length) {
                        const meta = document.createElement('div');
                        meta.className = 'meta';
                        meta.textContent = metaParts.join(' · ');
                        div.appendChild(meta);
                    }
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;
                }

                requestEstimate();

                (function initSupportedModels() {
                    function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
                    var data = window.SUPPORTED_MODELS;
                    if (!data || typeof data !== 'object') return;
                    var premiumTable = document.getElementById('supported-premium-table');
                    var freeTable = document.getElementById('supported-free-table');
                    if (data.premium && Array.isArray(data.premium) && premiumTable) {
                        var premiumTbody = premiumTable.querySelector('tbody');
                        if (premiumTbody) {
                            premiumTbody.innerHTML = data.premium.map(function (r) {
                                return '<tr><td>' + escapeHtml(r.model) + '</td><td>' + escapeHtml(r.browser) + '</td><td>' + escapeHtml(r.api) + '</td><td class="check">✓</td></tr>';
                            }).join('');
                        }
                    }
                    if (data.free && Array.isArray(data.free) && freeTable) {
                        var freeTbody = freeTable.querySelector('tbody');
                        if (freeTbody) {
                            freeTbody.innerHTML = data.free.map(function (r) {
                                return '<tr><td>' + escapeHtml(r.model) + '</td><td>' + escapeHtml(r.provider) + '</td><td class="check">' + escapeHtml(r.freeTier) + '</td></tr>';
                            }).join('');
                        }
                    }
                    var toggle = document.getElementById('supported-models-toggle');
                    var panel = document.getElementById('supported-models-panel');
                    if (toggle && panel) {
                        toggle.addEventListener('click', function () {
                            var on = toggle.classList.toggle('expanded');
                            panel.classList.toggle('visible', on);
                            toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
                            if (typeof updateHeaderDrawerVisibility === 'function') updateHeaderDrawerVisibility();
                        });
                    }
                })();
            </script>
        </body>
        </html>`;
    }
}