import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// chat.ts imports from db.ts/embeddings.ts, both of which resolve a
// SQLite path off process.cwd() at module-load time (same reasoning as
// db.test.ts/auth.test.ts) — isolated here too so importing chat.ts for
// these two pure-HTTP functions doesn't touch the real project's .pkm/.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkm-chat-test-"));
const originalCwd = process.cwd();

let ollamaChat: typeof import("./chat.js").ollamaChat;
let cloudChat: typeof import("./chat.js").cloudChat;

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpRoot, "vault"), { recursive: true });
  process.chdir(tmpRoot);
  ({ ollamaChat, cloudChat } = await import("./chat.js"));
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ollamaChat", () => {
  it("posts to {baseUrl}/api/chat with stream: false and returns message.content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "hello from ollama" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ollamaChat("http://localhost:11434", "llama3", [{ role: "user", content: "hi" }]);

    expect(result).toBe("hello from ollama");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ model: "llama3", messages: [{ role: "user", content: "hi" }], stream: false });
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: "x" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await ollamaChat("http://localhost:11434/", "llama3", []);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
  });

  it("throws with the response body when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    await expect(ollamaChat("http://localhost:11434", "llama3", [])).rejects.toThrow(/500/);
  });

  it("throws when the response has no message content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(ollamaChat("http://localhost:11434", "llama3", [])).rejects.toThrow(/no message content/);
  });
});

describe("cloudChat", () => {
  it("posts to {baseUrl}/chat/completions with a Bearer token and returns choices[0].message.content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "hello from cloud" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await cloudChat("sk-test", "https://api.openai.com/v1", "gpt-4o-mini", [
      { role: "user", content: "hi" },
    ]);

    expect(result).toBe("hello from cloud");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toEqual({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("throws with the response body when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" }));
    await expect(cloudChat("bad", "https://api.openai.com/v1", "gpt-4o-mini", [])).rejects.toThrow(/401/);
  });
});
