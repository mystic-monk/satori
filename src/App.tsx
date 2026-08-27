import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNoteApi,
  fetchNote,
  fetchNotes,
  reindex,
  saveNote,
  search,
  type NoteListItem,
  type SearchResult,
} from "./api";

export default function App() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotes = useCallback(async () => {
    setNotes(await fetchNotes());
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      search(query).then(setResults);
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  async function openNote(p: string) {
    const note = await fetchNote(p);
    setActivePath(note.path);
    setRaw(note.raw);
    setStatus("");
  }

  function onEdit(value: string) {
    setRaw(value);
    setStatus("saving…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!activePath) return;
      await saveNote(activePath, value);
      setStatus("saved");
      loadNotes();
    }, 400);
  }

  async function onNewNote() {
    const title = window.prompt("New note title:");
    if (!title) return;
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const p = `${slug || "untitled"}-${Date.now()}.md`;
    const template = `---\ntitle: ${title}\ntags: []\ncreated: ${new Date().toISOString()}\n---\n\n`;
    await createNote(p, template);
    await loadNotes();
    openNote(p);
  }

  async function onDelete() {
    if (!activePath) return;
    if (!window.confirm(`Delete ${activePath}?`)) return;
    await deleteNoteApi(activePath);
    setActivePath(null);
    setRaw("");
    await loadNotes();
  }

  async function onReindex() {
    setStatus("reindexing…");
    const r = await reindex();
    setStatus(`reindexed ${r.count} notes`);
    await loadNotes();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <input
            className="search-input"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="note-list">
          {results
            ? results.map((r) => (
                <li
                  key={r.path}
                  className={r.path === activePath ? "active" : ""}
                  onClick={() => openNote(r.path)}
                >
                  <div className="note-title">{r.title}</div>
                  <div
                    className="note-snippet"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                </li>
              ))
            : notes.map((n) => (
                <li
                  key={n.path}
                  className={n.path === activePath ? "active" : ""}
                  onClick={() => openNote(n.path)}
                >
                  <div className="note-title">{n.title}</div>
                  {n.tags.length > 0 && (
                    <div className="note-tags">{n.tags.join(", ")}</div>
                  )}
                </li>
              ))}
          {results && results.length === 0 && (
            <li className="empty-hint">No matches.</li>
          )}
          {!results && notes.length === 0 && (
            <li className="empty-hint">No notes yet.</li>
          )}
        </ul>
        <div className="sidebar-footer">
          <button onClick={onNewNote}>+ New note</button>
          <button onClick={onReindex}>Reindex</button>
        </div>
      </aside>
      <main className="editor-pane">
        {activePath ? (
          <>
            <div className="editor-toolbar">
              <span className="editor-path">{activePath}</span>
              <span className="editor-status">{status}</span>
              <button onClick={onDelete}>Delete</button>
            </div>
            <textarea
              className="editor"
              value={raw}
              onChange={(e) => onEdit(e.target.value)}
              spellCheck={false}
            />
          </>
        ) : (
          <div className="empty-state">Select a note or create a new one.</div>
        )}
      </main>
    </div>
  );
}
