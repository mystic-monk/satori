import { useEffect, useRef, useState } from "react";
import { createNote } from "./api";
import { stringifyFrontmatter } from "../shared/frontmatter";

// Rendered in a separate, small native window (see open_quick_capture in
// src-tauri/src/lib.rs) opened by a global hotkey or the "Quick Capture…"
// menu item — deliberately not the full App component: the entire point
// is zero friction (no title dialog, no note-type choice, no navigating
// the sidebar), just type and go. Browser mode has no equivalent (no
// global hotkey, no separate native window to open), so this component
// is only ever mounted when IS_TAURI — see main.tsx's ?quickcapture=1
// branch, which only Tauri's window ever gets a URL to.
export default function QuickCapture() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function closeWindow() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) {
      await closeWindow();
      return;
    }
    setSaving(true);
    // First line as the title, same "titled by its own content" idea
    // Apple Notes uses for a quick note — there's no separate title field
    // to fill in here, that's the whole point.
    const firstLine = trimmed.split("\n")[0].slice(0, 60).trim();
    const title = firstLine || `Quick capture ${new Date().toLocaleString()}`;
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const path = `${slug || "quick-capture"}-${Date.now()}.md`;
    const raw = stringifyFrontmatter({ title, type: "quick-capture", tags: [] }, `${trimmed}\n`);
    try {
      await createNote(path, raw);
    } finally {
      await closeWindow();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }

  return (
    <div className="quick-capture">
      <textarea
        ref={textareaRef}
        className="quick-capture-input"
        placeholder="Capture a thought…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
      <div className="quick-capture-footer">
        <span className="quick-capture-hint">⌘/Ctrl+Enter to save · Esc to discard</span>
        <button onClick={save} disabled={saving || !text.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}
