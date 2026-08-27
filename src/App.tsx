import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  createNote,
  deleteNoteApi,
  fetchNotes,
  reindex,
  search,
  type NoteListItem,
  type SearchResult,
} from "./api";
import { bindTextareaToYText, openLocalCollab } from "./collab";
import { openCloudCollab, type CloudStatus } from "./cloud-collab";

const EDIT_ORIGIN = "local-editor";
const BRIDGE_ORIGIN = "bridge";

// Local mode (server/collab.ts) and cloud mode (server/relay.ts) are two
// independent Yjs docs with independent transports. Bridging them means an
// edit made through either channel reaches the other, so "the note" is one
// logical document regardless of which path a given peer is synced through.
// Origin-tagging the bridged writes stops the obvious infinite ping-pong.
function bridgeDocs(a: Y.Doc, b: Y.Doc): () => void {
  const onA = (update: Uint8Array, origin: unknown) => {
    if (origin === BRIDGE_ORIGIN) return;
    Y.applyUpdate(b, update, BRIDGE_ORIGIN);
  };
  const onB = (update: Uint8Array, origin: unknown) => {
    if (origin === BRIDGE_ORIGIN) return;
    Y.applyUpdate(a, update, BRIDGE_ORIGIN);
  };
  a.on("update", onA);
  b.on("update", onB);
  return () => {
    a.off("update", onA);
    b.off("update", onB);
  };
}

export default function App() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState("");
  const [peerCount, setPeerCount] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const localDocRef = useRef<Y.Doc | null>(null);

  const [cloudRoom, setCloudRoom] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | "">("");

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

  // Runs whenever a note is opened *and* the editor <textarea> is mounted —
  // both are needed before the Yjs <-> DOM binding can be created.
  useEffect(() => {
    if (!activePath || !editorRef.current) return;

    const session = openLocalCollab(activePath);
    localDocRef.current = session.doc;
    setStatus("connecting…");
    setPeerCount(0);

    const unbind = bindTextareaToYText(editorRef.current, session.ytext, EDIT_ORIGIN);

    session.provider.on("status", ({ status: s }: { status: string }) => {
      setStatus(s === "connected" ? "connected" : s);
    });
    session.provider.on("sync", (synced: boolean) => {
      if (synced) setStatus("synced");
    });
    session.provider.awareness.on("change", () => {
      setPeerCount(Math.max(0, session.provider.awareness.getStates().size - 1));
    });
    session.doc.on("update", (_u: Uint8Array, origin: unknown) => {
      if (origin === EDIT_ORIGIN) loadNotes();
    });

    return () => {
      unbind();
      session.destroy();
      localDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Opt-in cloud sync for the currently open note: connects to the E2E
  // relay under a room name (defaults to the note's path) and bridges it
  // into the local doc so edits flow both ways.
  useEffect(() => {
    if (!cloudConnected || !activePath) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let unbridge: (() => void) | null = null;

    setCloudStatus("connecting");
    openCloudCollab(cloudRoom.trim() || activePath, cloudPassphrase, setCloudStatus).then((session) => {
      if (cancelled) {
        session.destroy();
        return;
      }
      destroy = session.destroy;
      if (localDocRef.current) unbridge = bridgeDocs(localDocRef.current, session.doc);
    });

    return () => {
      cancelled = true;
      unbridge?.();
      destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudConnected, activePath]);

  async function openNote(p: string) {
    if (p === activePath) return;
    setActivePath(p);
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
    const path = activePath;
    setActivePath(null); // tears down the collab session before the file goes away
    await deleteNoteApi(path);
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
              <span className="editor-status">
                {status}
                {peerCount > 0 ? ` · ${peerCount} other editor${peerCount > 1 ? "s" : ""} online` : ""}
              </span>
              <button onClick={onDelete}>Delete</button>
            </div>
            <div className="cloud-bar">
              <input
                className="cloud-input"
                placeholder={`Room (default: ${activePath})`}
                value={cloudRoom}
                onChange={(e) => setCloudRoom(e.target.value)}
                disabled={cloudConnected}
              />
              <input
                className="cloud-input"
                type="password"
                placeholder="Shared passphrase"
                value={cloudPassphrase}
                onChange={(e) => setCloudPassphrase(e.target.value)}
                disabled={cloudConnected}
              />
              <button
                onClick={() => setCloudConnected((c) => !c)}
                disabled={!cloudConnected && !cloudPassphrase}
              >
                {cloudConnected ? "Disconnect cloud sync" : "Connect cloud sync"}
              </button>
              {cloudConnected && (
                <span className={`cloud-status ${cloudStatus === "decrypt-failed" ? "cloud-status-error" : ""}`}>
                  {cloudStatus === "decrypt-failed" ? "wrong passphrase — can't decrypt peer data" : cloudStatus}
                </span>
              )}
            </div>
            <textarea
              key={activePath}
              ref={editorRef}
              className="editor"
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
