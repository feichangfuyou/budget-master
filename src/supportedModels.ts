/**
 * Supported AI models: premium (login/API) and free (no signup).
 * Use this as the single source of truth for model lists.
 */

export interface PremiumModel {
  model: string;
  browser: string;
  api: string;
  loginRequired: true;
}

export interface FreeModel {
  model: string;
  provider: string;
  freeTier: string;
}

/** Premium models (require login / API key) */
export const premiumModels: PremiumModel[] = [
  { model: "ChatGPT", browser: "chat.openai.com", api: "OpenAI API", loginRequired: true },
  { model: "Claude", browser: "claude.ai", api: "Anthropic API", loginRequired: true },
  { model: "Grok", browser: "grok.x.ai", api: "X.AI API", loginRequired: true },
  { model: "Gemini", browser: "gemini.google.com", api: "Google API", loginRequired: true },
  { model: "Perplexity", browser: "—", api: "Perplexity API", loginRequired: true },
  { model: "Fireworks", browser: "—", api: "Fireworks API", loginRequired: true },
  { model: "Mistral AI", browser: "—", api: "Mistral API", loginRequired: true },
  { model: "Meta LLaMA", browser: "—", api: "Meta API", loginRequired: true },
  { model: "Replicate", browser: "—", api: "Replicate API", loginRequired: true },
  { model: "Cerebras", browser: "—", api: "Cerebras API", loginRequired: true },
  { model: "GitHub Models", browser: "—", api: "GitHub API", loginRequired: true },
  { model: "Cloudflare Workers", browser: "—", api: "Cloudflare API", loginRequired: true },
  { model: "Baseten", browser: "—", api: "Baseten API", loginRequired: true },
  { model: "Nebius", browser: "—", api: "Nebius API", loginRequired: true },
];

/** Free models (no signup / API key required) */
export const freeModels: FreeModel[] = [
  { model: "Venice", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "Llama 3.1 8B / 405B", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "Mistral 7B / Large", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "Qwen 2.5 7B / 72B", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "Gemma 2 27B", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "Phi-3 Mini", provider: "OpenRouter", freeTier: "Unlimited" },
  { model: "DeepSeek R1 / Coder", provider: "OpenRouter / DeepSeek", freeTier: "Unlimited" },
  { model: "Hugging Face (Llama, Mistral, Qwen, Code Llama)", provider: "HuggingFace", freeTier: "Unlimited" },
  { model: "Groq (Llama 3.1 8B/70B, Mixtral, Gemma 2 9B)", provider: "Groq", freeTier: "Fast & Free" },
  { model: "Together AI (Llama, Mistral, Qwen, DeepSeek, Code Llama)", provider: "Together AI", freeTier: "Free Tier" },
  { model: "Cohere (Command R+, R, Command)", provider: "Cohere", freeTier: "Free Tier" },
  { model: "NVIDIA NIM (Llama, Mistral, Nemotron)", provider: "NVIDIA", freeTier: "Free Tier" },
];

/** All premium model names */
export const premiumModelNames = premiumModels.map((m) => m.model);

/** All free model names */
export const freeModelNames = freeModels.map((m) => m.model);

/** All supported model names (premium + free) */
export const allSupportedModelNames = [...premiumModelNames, ...freeModelNames];
