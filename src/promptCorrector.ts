/**
 * Prompt correction: spelling, tech terms, and grammar (local + optional LanguageTool).
 * Makes prompts clearer and cheaper for models. Default is local-only; opt-in for cloud grammar.
 */

import { applyLocalGrammarRules, fetchLanguageToolSuggestions } from './grammarChecker';

export interface CorrectionChange {
    from: string;
    to: string;
    category?: 'spell' | 'tech' | 'grammar';
}

export interface CorrectPromptResult {
    corrected: string;
    changes: CorrectionChange[];
}

export interface CorrectPromptOptions {
    /** Use LanguageTool API for deep grammar check (rate-limited, opt-in). */
    useLanguageTool?: boolean;
}

/** Common misspellings → correct spelling (lowercase for case-insensitive match). */
const SPELL_FIX: Record<string, string> = {
    teh: 'the',
    recieve: 'receive',
    recieved: 'received',
    acheive: 'achieve',
    acheived: 'achieved',
    seperate: 'separate',
    definately: 'definitely',
    occured: 'occurred',
    occurance: 'occurrence',
    enviroment: 'environment',
    dependancy: 'dependency',
    dependancies: 'dependencies',
    refernce: 'reference',
    refrence: 'reference',
    paramater: 'parameter',
    paramaters: 'parameters',
    arguement: 'argument',
    arguements: 'arguments',
    funtion: 'function',
    funtions: 'functions',
    retrun: 'return',
    retruns: 'returns',
    asynchrous: 'asynchronous',
    asyncronous: 'asynchronous',
    asynchronus: 'asynchronous',
    promice: 'promise',
    promices: 'promises',
    callbak: 'callback',
    callbacks: 'callbacks',
    initilize: 'initialize',
    initilized: 'initialized',
    intialize: 'initialize',
    intialized: 'initialized',
    varaible: 'variable',
    varaibles: 'variables',
    seperator: 'separator',
    seperators: 'separators',
    concatinate: 'concatenate',
    concatination: 'concatenation',
    iterater: 'iterator',
    iteraters: 'iterators',
    iterrate: 'iterate',
    iterration: 'iteration',
    impliment: 'implement',
    implimentation: 'implementation',
    compatability: 'compatibility',
    compatable: 'compatible',
    sucess: 'success',
    sucessful: 'successful',
    unsucessful: 'unsuccessful',
    exeption: 'exception',
    exeptions: 'exceptions',
    handeler: 'handler',
    handelers: 'handlers',
    listern: 'listener',
    listerns: 'listeners',
    requirment: 'requirement',
    requirments: 'requirements',
    doccument: 'document',
    doccumentation: 'documentation',
    avialable: 'available',
    avialability: 'availability',
    performace: 'performance',
    optimze: 'optimize',
    optimzation: 'optimization',
    configuation: 'configuration',
    configuations: 'configurations',
    authenication: 'authentication',
    authorisation: 'authorization',
    validaton: 'validation',
    validations: 'validations',
    reponse: 'response',
    reponses: 'responses',
    requrest: 'request',
    requrests: 'requests',
    endpooint: 'endpoint',
    endpooints: 'endpoints',
    databse: 'database',
    databses: 'databases',
    querry: 'query',
    querries: 'queries',
    migraiton: 'migration',
    migraitons: 'migrations',
    scheema: 'schema',
    scheemas: 'schemas',
    algorthim: 'algorithm',
    algorthims: 'algorithms',
};

/** Tech terminology: wrong or informal → preferred (for model clarity and token efficiency). */
const TECH_TERMS: Record<string, string> = {
    tocken: 'token',
    tockens: 'tokens',
    tokin: 'token',
    tokken: 'token',
    tokenn: 'token',
    apis: 'APIs',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    url: 'URL',
    urls: 'URLs',
    http: 'HTTP',
    https: 'HTTPS',
    rest: 'REST',
    crud: 'CRUD',
    sql: 'SQL',
    nosql: 'NoSQL',
    regex: 'regex',
    regexp: 'regex',
    uuid: 'UUID',
    id: 'ID',
    ids: 'IDs',
    guid: 'GUID',
    jwt: 'JWT',
    oauth: 'OAuth',
    oauth2: 'OAuth 2',
    sdk: 'SDK',
    sdks: 'SDKs',
    rpc: 'RPC',
    grpc: 'gRPC',
    cli: 'CLI',
    gui: 'GUI',
    ui: 'UI',
    ux: 'UX',
    dom: 'DOM',
    ajax: 'AJAX',
    cors: 'CORS',
    csrf: 'CSRF',
    xss: 'XSS',
    orm: 'ORM',
};

/**
 * Correct prompt text: spelling, tech terms, grammar (local + optional LanguageTool).
 * Returns corrected string and list of changes. Use options.useLanguageTool for deep grammar (async).
 */
export async function correctPrompt(
    text: string,
    options: CorrectPromptOptions = {}
): Promise<CorrectPromptResult> {
    const changes: CorrectionChange[] = [];
    if (!text || !text.trim()) return { corrected: text, changes };

    // 1) Spelling + tech terms (word-level)
    const words = text.split(/(\s+)/);
    const afterSpellTech = words.map((word) => {
        const trimmed = word.trim();
        if (!trimmed) return word;

        const lower = trimmed.toLowerCase();
        let replacement: string | undefined;
        if (TECH_TERMS[lower]) replacement = TECH_TERMS[lower];
        if (!replacement && SPELL_FIX[lower]) replacement = SPELL_FIX[lower];

        if (replacement && replacement !== trimmed) {
            changes.push({ from: trimmed, to: replacement, category: TECH_TERMS[lower] ? 'tech' : 'spell' });
            return word.replace(trimmed, replacement);
        }
        return word;
    }).join('');

    // 2) Local grammar rules (no network)
    const grammarResult = applyLocalGrammarRules(afterSpellTech);
    for (const c of grammarResult.changes) {
        changes.push({ from: c.from, to: c.to, category: 'grammar' });
    }
    let corrected = grammarResult.corrected;

    // 3) Optional: LanguageTool API for highly intelligent grammar
    if (options.useLanguageTool && corrected.trim().length > 0 && corrected.length <= 20000) {
        const lt = await fetchLanguageToolSuggestions(corrected, 'en-US');
        if (lt.changes.length > 0) {
            corrected = lt.corrected;
            for (const c of lt.changes) {
                changes.push({ from: c.from, to: c.to, category: 'grammar' });
            }
        }
    }

    return { corrected, changes };
}
