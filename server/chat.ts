import { embedQuery } from "./embeddings.js";
import { findSimilarToVector, getIndexedText, type SimilarNote } from "./db.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Never persisted server-side — sent per-request from the client the same
// way cloud sync's relay URL/passphrase are client-owned and only ever
// passed through (SettingsPanel.tsx's "Cloud sync" section is the
// precedent this mirrors). Two shapes, neither required, neither the
// sole path — see the plan this was built from for why both exist.
export type ChatProviderConfig =
  | { kind: "ollama"; baseUrl: string; model: string }
  | { kind: "cloud"; apiKey: string; baseUrl: string; model: string };

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
// Together, a local llama.cpp server, ...) people would plausibly point
// this at. Anthropic's differently-shaped Messages API is a clean,
// separate addition later behind this same ChatProviderConfig union, not
// built here.
export async function cloudChat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[]): Promise<string> {
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

async function runProvider(provider: ChatProviderConfig, messages: ChatMessage[]): Promise<string> {
  return provider.kind === "ollama"
    ? ollamaChat(provider.baseUrl, provider.model, messages)
    : cloudChat(provider.apiKey, provider.baseUrl, provider.model, messages);
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
  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${context}` },
    { role: "user", content: message },
  ];
  const answer = await runProvider(provider, messages);
  return { answer, sources: matches.map((m) => ({ path: m.path, title: m.title })) };
}
