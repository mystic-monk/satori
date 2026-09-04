import type { ChatProviderConfig } from "./api";

// Per-browser, same reasoning as everywhere else client-owned config
// lives in this app (recall cloud sync's relay URL/passphrase,
// SettingsPanel.tsx's "Cloud sync" section) — neither the Ollama URL nor
// a cloud API key are vault content, and the cloud key in particular
// should never ride along with anything synced.
export interface ChatSettings {
  kind: "ollama" | "cloud";
  ollamaBaseUrl: string;
  ollamaModel: string;
  cloudBaseUrl: string;
  cloudApiKey: string;
  cloudModel: string;
}

const KEY = "pkm-chat-settings";

const DEFAULTS: ChatSettings = {
  kind: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  cloudBaseUrl: "https://api.openai.com/v1",
  cloudApiKey: "",
  cloudModel: "gpt-4o-mini",
};

export function getChatSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveChatSettings(settings: ChatSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function toProviderConfig(settings: ChatSettings): ChatProviderConfig {
  return settings.kind === "ollama"
    ? { kind: "ollama", baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel }
    : { kind: "cloud", apiKey: settings.cloudApiKey, baseUrl: settings.cloudBaseUrl, model: settings.cloudModel };
}

// Ollama has a workable default (a local URL, nothing to type) — asking
// "is it actually running" isn't something worth gating on up front, a
// failed request already says that clearly. A cloud key with nothing
// typed in, though, can't possibly succeed — that's the one case worth a
// pre-flight "set this up first" instead of a doomed request.
export function isConfigured(settings: ChatSettings): boolean {
  return settings.kind === "ollama" || settings.cloudApiKey.trim().length > 0;
}
