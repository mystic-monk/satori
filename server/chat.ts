import { embedQuery } from "./embeddings.js";
import { findSimilarToVector, getIndexedText, type SimilarNote } from "./db.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Never persisted server-side — sent per-request from the client the same
// way cloud sync's relay URL/passphrase are client-owned and only ever
// passed through (SettingsPanel.tsx's "Cloud sync" section is the
// precedent this mirrors). Three shapes, none required, none the sole
// path. Mirrored in src-tauri/src/chat.rs for the native app, which uses
// FTS5 keyword search here where this file uses semantic embeddings —
// same provider shapes either way, different retrieval underneath.
export type ChatProviderConfig =
  | { kind: "ollama"; baseUrl: string; model: string }
  | { kind: "openai"; apiKey: string; baseUrl: string; model: string }
  | { kind: "anthropic"; apiKey: string; baseUrl: string; model: string };

const MAX_CONTEXT_CHARS_PER_NOTE = 1500;

// Answer only from what's actually in the vault, say so when it isn't —
// the one thing that makes this "chat with your notes" instead of a
// generic chatbot that happens to see some text pasted in front of it.
const SYSTEM_PROMPT = `You are answering questions using only the note excerpts provided below. \
Cite which note(s) informed your answer by title. If the excerpts don't contain enough \
information to answer, say so plainly rather than guessing or using outside knowledge.`;

function buildContext(matches: SimilarNote[]): string {
  return matches
    .map((m) => {
      const text = getIndexedText(m.path) ?? "";
      const excerpt = text.length > MAX_CONTEXT_CHARS_PER_NOTE ? text.slice(0, MAX_CONTEXT_CHARS_PER_NOTE) + "…" : text;
      return `### ${m.title}\n${excerpt}`;
    })
    .join("\n\n");
}

// Exported (not just used internally via runProvider below) so each
// provider's request/response shape is independently unit-testable
// against a mocked fetch.
export async function ollamaChat(baseUrl: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama response had no message content");
  return content;
}

// OpenAI-compatible chat-completions shape specifically — covers OpenAI
// itself plus most third-party OpenAI-compatible endpoints (Groq,
// OpenRouter, Together, Mistral, a local llama.cpp server, ...) people
// would plausibly point this at; src/chatConfig.ts's OPENAI_COMPATIBLE_PRESETS
// is just a base-URL quick-pick over this one function, not separate
// integrations.
export async function openaiChat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`Chat provider request failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Chat provider response had no message content");
  return content;
}

// Genuinely different shape from openaiChat above, not a copy: Anthropic's
// Messages API takes the system prompt as a top-level field (not a
// message in the array), wants x-api-key/anthropic-version headers
// instead of a Bearer token, and returns content as an array of blocks
// rather than a single string.
export async function anthropicChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  system: string,
  messages: ChatMessage[]
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: messages.filter((m) => m.role !== "system"),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Anthropic response had no content");
  return content;
}

async function runProvider(provider: ChatProviderConfig, system: string, messages: ChatMessage[]): Promise<string> {
  if (provider.kind === "ollama") return ollamaChat(provider.baseUrl, provider.model, messages);
  if (provider.kind === "openai") return openaiChat(provider.apiKey, provider.baseUrl, provider.model, messages);
  return anthropicChat(provider.apiKey, provider.baseUrl, provider.model, system, messages);
}

export interface ChatAnswer {
  answer: string;
  sources: { path: string; title: string }[];
}

// The actual retrieve-then-generate pipeline: embed the question with
// fastembed's query mode (asymmetric from how notes themselves are
// indexed — see embeddings.ts's embedQuery), find the closest notes,
// ground the model in their content, ask it. No conversation memory
// across turns in this pass — each call is self-contained.
export async function answerFromNotes(message: string, provider: ChatProviderConfig): Promise<ChatAnswer> {
  const vector = await embedQuery(message);
  const matches = findSimilarToVector(vector, 5);
  const context = buildContext(matches);
  const system = `${SYSTEM_PROMPT}\n\n${context}`;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: message },
  ];
  const answer = await runProvider(provider, system, messages);
  return { answer, sources: matches.map((m) => ({ path: m.path, title: m.title })) };
}
