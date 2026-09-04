import type { ChatProviderConfig } from "./api";

// Per-browser, same reasoning as everywhere else client-owned config
// lives in this app (recall cloud sync's relay URL/passphrase,
// SettingsPanel.tsx's "Cloud sync" section) — none of these are vault
// content, and the API keys in particular should never ride along with
// anything synced.
export interface ChatSettings {
  kind: "ollama" | "openai" | "anthropic";
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  anthropicBaseUrl: string;
  anthropicApiKey: string;
  anthropicModel: string;
}

// Groq/OpenRouter/Together/Mistral aren't separate provider kinds — they
// all speak the same OpenAI-compatible chat-completions shape "openai"
// already implements, so picking one just fills in a known base URL.
// OpenRouter in particular is worth having here: one key there reaches
// most other vendors' models (including Claude, Llama, Gemini) through
// this same shape, without a dedicated integration per vendor.
export const OPENAI_COMPATIBLE_PRESETS: { label: string; baseUrl: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
];

const KEY = "pkm-chat-settings";

const DEFAULTS: ChatSettings = {
  kind: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicBaseUrl: "https://api.anthropic.com",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
};

export function getChatSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // "cloud" was this setting's only non-Ollama kind before Anthropic
    // support existed — migrated forward as "openai" (what it always
    // meant) rather than silently reverting anyone's saved config back
    // to the Ollama default.
    if (parsed.kind === "cloud") {
      parsed.kind = "openai";
      parsed.openaiBaseUrl ??= parsed.cloudBaseUrl;
      parsed.openaiApiKey ??= parsed.cloudApiKey;
      parsed.openaiModel ??= parsed.cloudModel;
    }
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function saveChatSettings(settings: ChatSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function toProviderConfig(settings: ChatSettings): ChatProviderConfig {
  if (settings.kind === "ollama") return { kind: "ollama", baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel };
  if (settings.kind === "openai")
    return { kind: "openai", apiKey: settings.openaiApiKey, baseUrl: settings.openaiBaseUrl, model: settings.openaiModel };
  return { kind: "anthropic", apiKey: settings.anthropicApiKey, baseUrl: settings.anthropicBaseUrl, model: settings.anthropicModel };
}

// Ollama has a workable default (a local URL, nothing to type) — asking
// "is it actually running" isn't something worth gating on up front, a
// failed request already says that clearly. A cloud key with nothing
// typed in, though, can't possibly succeed — that's the one case worth a
// pre-flight "set this up first" instead of a doomed request.
export function isConfigured(settings: ChatSettings): boolean {
  if (settings.kind === "ollama") return true;
  if (settings.kind === "openai") return settings.openaiApiKey.trim().length > 0;
  return settings.anthropicApiKey.trim().length > 0;
}
