import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { sendChatMessage } from "./api";
import { getChatSettings, toProviderConfig, isConfigured } from "./chatConfig";
import { activateOnEnterOrSpace } from "./a11y";

interface ChatMessageItem {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; title: string }[];
}

interface ChatPanelProps {
  onNavigate: (path: string, title?: string) => void;
  onOpenSettings: () => void;
}

// No conversation memory across turns — each question is answered fresh
// off its own retrieval (server/chat.ts's answerFromNotes). The message
// list below is purely for the person reading it back, not something the
// model itself sees; a real multi-turn version is a deliberate follow-up,
// not this pass (needs its own prompt-size bound once history counts too).
export default function ChatPanel({ onNavigate, onOpenSettings }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = getChatSettings();
  const configured = isConfigured(settings);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setSending(true);
    try {
      const result = await sendChatMessage(message, toProviderConfig(getChatSettings()));
      setMessages((prev) => [...prev, { role: "assistant", content: result.answer, sources: result.sources }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <Sparkles size={15} aria-hidden="true" />
        <span>Chat with your notes</span>
      </div>
      {!configured ? (
        <div className="chat-empty-state">
          <Sparkles size={28} aria-hidden="true" />
          <p>Set up a local Ollama server or a cloud API key to start chatting with your vault.</p>
          <button className="btn-primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      ) : (
        <>
          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="chat-empty-hint">Ask a question — answers are grounded in your notes, with sources cited below.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-message chat-message-${m.role}`}>
                <div className="chat-message-content">{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="chat-message-sources">
                    {m.sources.map((s) => (
                      <span
                        key={s.path}
                        className="chat-source-chip"
                        onClick={() => onNavigate(s.path, s.title)}
                        onKeyDown={(e) => activateOnEnterOrSpace(e, () => onNavigate(s.path, s.title))}
                        role="button"
                        tabIndex={0}
                      >
                        {s.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <div className="chat-message chat-message-assistant chat-message-pending">Thinking…</div>}
            {error && <div className="chat-error">{error}</div>}
          </div>
          <div className="chat-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask a question about your notes…"
              aria-label="Chat message"
              disabled={sending}
            />
            <button onClick={send} disabled={sending || !input.trim()} aria-label="Send">
              <Send size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
