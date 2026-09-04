import { beforeEach, describe, expect, it } from "vitest";

// Same in-memory localStorage stand-in as openTabs.test.ts/identity.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { getChatSettings, saveChatSettings, toProviderConfig, isConfigured, OPENAI_COMPATIBLE_PRESETS } = await import(
  "./chatConfig"
);

beforeEach(() => {
  localStorage.clear();
});

describe("getChatSettings", () => {
  it("returns Ollama defaults when nothing is stored", () => {
    const settings = getChatSettings();
    expect(settings.kind).toBe("ollama");
    expect(settings.ollamaBaseUrl).toBe("http://localhost:11434");
  });

  it("migrates a pre-Anthropic 'cloud' kind forward to 'openai', carrying its fields over", () => {
    localStorage.setItem(
      "pkm-chat-settings",
      JSON.stringify({ kind: "cloud", cloudBaseUrl: "https://api.openai.com/v1", cloudApiKey: "sk-old", cloudModel: "gpt-4o" })
    );
    const settings = getChatSettings();
    expect(settings.kind).toBe("openai");
    expect(settings.openaiApiKey).toBe("sk-old");
    expect(settings.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(settings.openaiModel).toBe("gpt-4o");
  });

  it("returns defaults for malformed stored JSON", () => {
    localStorage.setItem("pkm-chat-settings", "not json");
    expect(getChatSettings().kind).toBe("ollama");
  });
});

describe("saveChatSettings / getChatSettings round-trip", () => {
  it("persists a full settings object", () => {
    const settings = getChatSettings();
    saveChatSettings({ ...settings, kind: "anthropic", anthropicApiKey: "sk-ant-1" });
    expect(getChatSettings().anthropicApiKey).toBe("sk-ant-1");
  });
});

describe("toProviderConfig", () => {
  it("maps each kind to its own provider shape", () => {
    const base = getChatSettings();
    expect(toProviderConfig({ ...base, kind: "ollama" })).toEqual({
      kind: "ollama",
      baseUrl: base.ollamaBaseUrl,
      model: base.ollamaModel,
    });
    expect(toProviderConfig({ ...base, kind: "openai", openaiApiKey: "k" })).toEqual({
      kind: "openai",
      apiKey: "k",
      baseUrl: base.openaiBaseUrl,
      model: base.openaiModel,
    });
    expect(toProviderConfig({ ...base, kind: "anthropic", anthropicApiKey: "k2" })).toEqual({
      kind: "anthropic",
      apiKey: "k2",
      baseUrl: base.anthropicBaseUrl,
      model: base.anthropicModel,
    });
  });
});

describe("isConfigured", () => {
  it("Ollama is always considered configured (has a workable default)", () => {
    expect(isConfigured({ ...getChatSettings(), kind: "ollama" })).toBe(true);
  });

  it("OpenAI requires a non-empty key", () => {
    expect(isConfigured({ ...getChatSettings(), kind: "openai", openaiApiKey: "" })).toBe(false);
    expect(isConfigured({ ...getChatSettings(), kind: "openai", openaiApiKey: "  " })).toBe(false);
    expect(isConfigured({ ...getChatSettings(), kind: "openai", openaiApiKey: "sk-1" })).toBe(true);
  });

  it("Anthropic requires a non-empty key", () => {
    expect(isConfigured({ ...getChatSettings(), kind: "anthropic", anthropicApiKey: "" })).toBe(false);
    expect(isConfigured({ ...getChatSettings(), kind: "anthropic", anthropicApiKey: "sk-ant" })).toBe(true);
  });
});

describe("OPENAI_COMPATIBLE_PRESETS", () => {
  it("includes OpenAI, Groq, OpenRouter, Together, and Mistral", () => {
    const labels = OPENAI_COMPATIBLE_PRESETS.map((p) => p.label);
    expect(labels).toEqual(["OpenAI", "Groq", "OpenRouter", "Together AI", "Mistral"]);
  });

  it("every preset base URL is a plausible https endpoint", () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https:\/\//);
    }
  });
});
