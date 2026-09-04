use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::{search_for_chat, ChatMatch};

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// Mirrors src/chatConfig.ts's ChatProviderConfig exactly — three kinds,
// none required, none forced. Never persisted here; the frontend sends
// this fresh on every request, same "client owns credentials" posture
// server/chat.ts already established for the Node/browser deployment.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatProviderConfig {
    Ollama {
        base_url: String,
        model: String,
    },
    Openai {
        api_key: String,
        base_url: String,
        model: String,
    },
    Anthropic {
        api_key: String,
        base_url: String,
        model: String,
    },
}

#[derive(Serialize)]
pub struct ChatSource {
    pub path: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct ChatAnswer {
    pub answer: String,
    pub sources: Vec<ChatSource>,
}

const MAX_CONTEXT_CHARS_PER_NOTE: usize = 1500;

const SYSTEM_PROMPT: &str = "You are answering questions using only the note excerpts provided below. \
Cite which note(s) informed your answer by title. If the excerpts don't contain enough \
information to answer, say so plainly rather than guessing or using outside knowledge.";

fn build_context(matches: &[ChatMatch]) -> String {
    matches
        .iter()
        .map(|m| {
            let excerpt = if m.body.chars().count() > MAX_CONTEXT_CHARS_PER_NOTE {
                let truncated: String = m.body.chars().take(MAX_CONTEXT_CHARS_PER_NOTE).collect();
                format!("{}…", truncated)
            } else {
                m.body.clone()
            };
            format!("### {}\n{}", m.title, excerpt)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn ollama_chat(base_url: &str, model: &str, messages: &[ChatMessage]) -> Result<String, String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "messages": messages, "stream": false });
    let resp = ureq::post(&url)
        .send_json(body)
        .map_err(|e| format!("Ollama request failed: {e}"))?;
    let data: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    data["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Ollama response had no message content".to_string())
}

// OpenAI-compatible chat-completions shape — also what Groq/OpenRouter/
// Together/Mistral/etc. speak, so this one function covers all of them;
// which service it's actually talking to is just whichever base_url the
// frontend's preset picker (or a custom URL) sent.
fn openai_chat(api_key: &str, base_url: &str, model: &str, messages: &[ChatMessage]) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "messages": messages });
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {api_key}"))
        .send_json(body)
        .map_err(|e| format!("Chat provider request failed: {e}"))?;
    let data: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    data["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Chat provider response had no message content".to_string())
}

// Genuinely different shape from openai_chat above, not a copy: the
// system prompt is a top-level field, not a message in the array, and
// the response's content is an array of blocks rather than a single
// string — see the plan this was built from for why this couldn't just
// reuse the OpenAI-compatible path.
fn anthropic_chat(api_key: &str, base_url: &str, model: &str, system: &str, messages: &[ChatMessage]) -> Result<String, String> {
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let user_messages: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": user_messages,
    });
    let resp = ureq::post(&url)
        .set("x-api-key", api_key)
        .set("anthropic-version", "2023-06-01")
        .send_json(body)
        .map_err(|e| format!("Anthropic request failed: {e}"))?;
    let data: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    data["content"][0]["text"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Anthropic response had no content".to_string())
}

// The retrieve-then-generate pipeline — same shape as server/chat.ts's
// answerFromNotes, but retrieval is FTS5 keyword search (search_for_chat,
// db.rs) instead of semantic embeddings, since fastembed has no native
// path yet. A deliberate per-platform difference, not a downgrade nobody
// decided on: Node/browser keeps the better (meaning-based) retrieval,
// native ships with what already works there today.
pub fn answer_from_notes(conn: &Connection, message: &str, provider: &ChatProviderConfig) -> Result<ChatAnswer, String> {
    let matches = search_for_chat(conn, message, 5)?;
    let context = build_context(&matches);
    let system = format!("{SYSTEM_PROMPT}\n\n{context}");
    let messages = vec![
        ChatMessage { role: "system".into(), content: system.clone() },
        ChatMessage { role: "user".into(), content: message.to_string() },
    ];

    let answer = match provider {
        ChatProviderConfig::Ollama { base_url, model } => ollama_chat(base_url, model, &messages)?,
        ChatProviderConfig::Openai { api_key, base_url, model } => openai_chat(api_key, base_url, model, &messages)?,
        ChatProviderConfig::Anthropic { api_key, base_url, model } => {
            anthropic_chat(api_key, base_url, model, &system, &messages)?
        }
    };

    let sources = matches.into_iter().map(|m| ChatSource { path: m.path, title: m.title }).collect();
    Ok(ChatAnswer { answer, sources })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // No mock-HTTP crate in this workspace yet — a one-shot raw TCP
    // listener is enough to hand back a canned response and capture what
    // was actually sent, without adding a dependency just for this.
    // Returns the port and a handle to join the server thread.
    fn serve_once(response_body: &'static str) -> (u16, std::sync::mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap();
            tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (port, rx, handle)
    }

    #[test]
    fn ollama_chat_posts_to_api_chat_and_parses_message_content() {
        let (port, rx, handle) = serve_once(r#"{"message":{"role":"assistant","content":"hello from ollama"}}"#);
        let messages = vec![ChatMessage { role: "user".into(), content: "hi".into() }];
        let result = ollama_chat(&format!("http://127.0.0.1:{port}"), "llama3", &messages).unwrap();
        assert_eq!(result, "hello from ollama");
        let raw = rx.recv().unwrap();
        assert!(raw.starts_with("POST /api/chat"));
        assert!(raw.contains("\"stream\":false"));
        handle.join().unwrap();
    }

    #[test]
    fn openai_chat_sends_bearer_auth_and_parses_choices() {
        let (port, rx, handle) = serve_once(r#"{"choices":[{"message":{"role":"assistant","content":"hello from cloud"}}]}"#);
        let messages = vec![ChatMessage { role: "user".into(), content: "hi".into() }];
        let result = openai_chat("sk-test", &format!("http://127.0.0.1:{port}"), "gpt-4o-mini", &messages).unwrap();
        assert_eq!(result, "hello from cloud");
        let raw = rx.recv().unwrap();
        assert!(raw.starts_with("POST /chat/completions"));
        assert!(raw.contains("Authorization: Bearer sk-test"));
        handle.join().unwrap();
    }

    #[test]
    fn anthropic_chat_sends_x_api_key_and_puts_system_at_top_level() {
        let (port, rx, handle) = serve_once(r#"{"content":[{"type":"text","text":"hello from claude"}]}"#);
        let messages = vec![
            ChatMessage { role: "system".into(), content: "grounding context".into() },
            ChatMessage { role: "user".into(), content: "hi".into() },
        ];
        let result = anthropic_chat("sk-ant-test", &format!("http://127.0.0.1:{port}"), "claude-sonnet-5", "grounding context", &messages).unwrap();
        assert_eq!(result, "hello from claude");
        let raw = rx.recv().unwrap();
        assert!(raw.starts_with("POST /v1/messages"));
        assert!(raw.contains("x-api-key: sk-ant-test"));
        assert!(raw.contains("anthropic-version: 2023-06-01"));
        assert!(raw.contains("\"system\":\"grounding context\""));
        // The system message must not also appear inside the messages array.
        assert!(!raw.contains("\"role\":\"system\""));
        handle.join().unwrap();
    }

    #[test]
    fn build_context_truncates_long_bodies_and_labels_each_note_by_title() {
        let matches = vec![
            ChatMatch { path: "a.md".into(), title: "Short".into(), body: "brief".into() },
            ChatMatch { path: "b.md".into(), title: "Long".into(), body: "x".repeat(2000) },
        ];
        let context = build_context(&matches);
        assert!(context.contains("### Short\nbrief"));
        assert!(context.contains("### Long\n"));
        assert!(context.contains('…'));
        assert!(context.len() < 2100); // truncated, not the full 2000+ chars
    }
}
