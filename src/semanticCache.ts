/**
 * Semantic Cache — "Deja Vu" Protocol.
 * Lightweight intent + context snapshot cache so repeated questions
 * (e.g. "Explain this file" vs "How does this file work?") return instantly at $0 cost.
 * In-memory map backed by a JSON file so the cache survives restarts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CacheEntry {
    promptHash: string;
    contextHash: string;
    response: string;
    timestamp: number;
}

const CACHE_FILE = 'semantic-cache.json';
let memoryCache: Map<string, CacheEntry> = new Map();
let storageDir: string | null = null;

/**
 * Set the directory for persisting the cache (e.g. extension globalStorageUri).
 * Call loadFromDisk() after this to restore state.
 */
export function setCacheStoragePath(dir: string): void {
    storageDir = dir;
}

/**
 * Load cache from disk. Call once at activation if storage path is set.
 */
export function loadFromDisk(): void {
    if (!storageDir) return;
    const filePath = path.join(storageDir, CACHE_FILE);
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const arr = JSON.parse(raw) as [string, CacheEntry][];
            memoryCache = new Map(arr);
        }
    } catch {
        memoryCache = new Map();
    }
}

function persistToDisk(): void {
    if (!storageDir) return;
    try {
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        const filePath = path.join(storageDir, CACHE_FILE);
        const arr = Array.from(memoryCache.entries());
        fs.writeFileSync(filePath, JSON.stringify(arr), 'utf-8');
    } catch {
        // ignore write errors
    }
}

/**
 * THE FINGERPRINT
 * Creates a unique hash for the current context (e.g. file content).
 * If the user changes one character, the hash changes (invalidating old answers).
 */
export function getContextHash(contextString: string): string {
    return crypto.createHash('md5').update(contextString).digest('hex');
}

/**
 * THE NORMALIZER
 * Canonicalizes the prompt so "Please explain the code" and "What does the code do?" map to the same key.
 */
export function normalizePrompt(prompt: string): string {
    return prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(please|can|you|tell|me|what|is|the|does|how)\b/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .trim() || '_';
}

/**
 * Check if we have a cached response for this prompt + context.
 * Returns the cached response or null.
 */
export function checkCache(prompt: string, context: string): string | null {
    const pHash = normalizePrompt(prompt);
    const cHash = getContextHash(context);
    const key = `${pHash}::${cHash}`;
    const entry = memoryCache.get(key);
    if (entry) {
        return entry.response;
    }
    return null;
}

/**
 * Store a response for this prompt + context so future equivalent questions can hit the cache.
 */
export function saveToCache(prompt: string, context: string, response: string): void {
    const pHash = normalizePrompt(prompt);
    const cHash = getContextHash(context);
    const key = `${pHash}::${cHash}`;
    memoryCache.set(key, {
        promptHash: pHash,
        contextHash: cHash,
        response,
        timestamp: Date.now(),
    });
    persistToDisk();
}
