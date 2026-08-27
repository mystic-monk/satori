import { useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import {
  createNote,
  deleteNoteApi,
  fetchNotes,
  fetchTypes,
  reindex,
  search,
  type NoteListItem,
  type SearchResult,
} from "./api";
import { openLocalCollab, type CollabSession } from "./collab";
import { openCloudCollab, type CloudStatus } from "./cloud-collab";
import Editor from "./Editor";
import Preview, { buildResolver } from "./Preview";
import Backlinks from "./Backlinks";
import PropertiesPanel from "./PropertiesPanel";
import GraphView from "./GraphView";
import CanvasNote from "./CanvasNote";
import { renderNoteBody, type RenderEnv } from "./markdown";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import { parseFrontmatter } from "./frontmatter";

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

type ViewMode = "source" | "preview" | "split";

export default function App() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [types, setTypes] = useState<{ type: string; count: number }[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState("");
  const [peerCount, setPeerCount] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  const [localSession, setLocalSession] = useState<CollabSession | null>(null);
  const [raw, setRaw] = useState("");

  const [cloudRoom, setCloudRoom] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | "">("");

  const loadNotes = useCallback(async () => {
    setNotes(await fetchNotes(typeFilter || undefined));
  }, [typeFilter]);

  useEffect(() => {
    loadNotes();
    fetchTypes().then(setTypes);
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

  // Opens the local Yjs session for the active note and mirrors its live
  // text into `raw` state for the preview/properties panel/export to read.
  useEffect(() => {
    if (!activePath) return;

    const session = openLocalCollab(activePath);
    setLocalSession(session);
    setStatus("connecting…");
    setPeerCount(0);

    const onTextChange = () => setRaw(session.ytext.toString());
    onTextChange();
    session.ytext.observe(onTextChange);

    session.provider.on("status", ({ status: s }: { status: string }) => {
      setStatus(s === "connected" ? "connected" : s);
    });
    session.provider.on("sync", (synced: boolean) => {
      if (synced) setStatus("synced");
    });
    session.provider.awareness.on("change", () => {
      setPeerCount(Math.max(0, session.provider.awareness.getStates().size - 1));
    });
    session.doc.on("update", () => loadNotes());

    return () => {
      session.ytext.unobserve(onTextChange);
      session.destroy();
      setLocalSession(null);
      setRaw("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Opt-in cloud sync for the currently open note: connects to the E2E
  // relay under a room name (defaults to the note's path) and bridges it
  // into the local doc so edits flow both ways.
  useEffect(() => {
    if (!cloudConnected || !activePath || !localSession) return;
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
      unbridge = bridgeDocs(localSession.doc, session.doc);
    });

    return () => {
      cancelled = true;
      unbridge?.();
      destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudConnected, activePath, localSession]);

  function openNote(p: string) {
    setShowGraph(false);
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
    const template = `---\ntitle: ${title}\ntags: []\n---\n\n`;
    await createNote(p, template);
    await loadNotes();
    openNote(p);
  }

  async function onNewCanvas() {
    const title = window.prompt("New canvas title:");
    if (!title) return;
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const p = `${slug || "untitled"}-canvas-${Date.now()}.md`;
    const scene = { type: "excalidraw", version: 2, elements: [], appState: {} };
    const template = `---\ntitle: ${title}\ntype: canvas\n---\n${JSON.stringify(scene, null, 2)}\n`;
    await createNote(p, template);
    await loadNotes();
    fetchTypes().then(setTypes);
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
    fetchTypes().then(setTypes);
  }

  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const activeNote = notes.find((n) => n.path === activePath);
  const isCanvas = raw ? parseFrontmatter(raw).data.type === "canvas" : false;

  function exportEnv(): RenderEnv {
    return { resolver, bodies: new Map(), pathStack: new Set() };
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
          {types.length > 0 && (
            <select className="type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.type} ({t.count})
                </option>
              ))}
            </select>
          )}
        </div>
        <ul className="note-list">
          {results
            ? results.map((r) => (
                <li key={r.path} className={r.path === activePath ? "active" : ""} onClick={() => openNote(r.path)}>
                  <div className="note-title">{r.title}</div>
                  <div className="note-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </li>
              ))
            : notes.map((n) => (
                <li key={n.path} className={n.path === activePath ? "active" : ""} onClick={() => openNote(n.path)}>
                  <div className="note-title">{n.title}</div>
                  {n.tags.length > 0 && <div className="note-tags">{n.tags.join(", ")}</div>}
                </li>
              ))}
          {results && results.length === 0 && <li className="empty-hint">No matches.</li>}
          {!results && notes.length === 0 && <li className="empty-hint">No notes yet.</li>}
        </ul>
        <div className="sidebar-footer">
          <button onClick={onNewNote}>+ New note</button>
          <button onClick={onNewCanvas}>+ Canvas</button>
          <button onClick={() => setShowGraph((g) => !g)}>{showGraph ? "Editor" : "Graph"}</button>
          <button onClick={onReindex}>Reindex</button>
        </div>
      </aside>
      <main className="editor-pane">
        {showGraph ? (
          <GraphView activePath={activePath} onNavigate={openNote} />
        ) : activePath && localSession ? (
          <>
            <div className="editor-toolbar">
              <span className="editor-path">{activePath}</span>
              <span className="editor-status">
                {status}
                {peerCount > 0 ? ` · ${peerCount} other editor${peerCount > 1 ? "s" : ""} online` : ""}
              </span>
              {!isCanvas && (
                <div className="view-mode-toggle">
                  {(["source", "split", "preview"] as ViewMode[]).map((m) => (
                    <button key={m} className={viewMode === m ? "active" : ""} onClick={() => setViewMode(m)}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {!isCanvas && (
                <>
                  <button onClick={() => exportMarkdown(activePath, raw)}>MD</button>
                  <button
                    onClick={() => exportHtml(activeNote?.title ?? activePath, renderNoteBody(raw, exportEnv()))}
                  >
                    HTML
                  </button>
                  <button onClick={() => exportPdf(activeNote?.title ?? activePath, renderNoteBody(raw, exportEnv()))}>
                    PDF
                  </button>
                </>
              )}
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
              <button onClick={() => setCloudConnected((c) => !c)} disabled={!cloudConnected && !cloudPassphrase}>
                {cloudConnected ? "Disconnect cloud sync" : "Connect cloud sync"}
              </button>
              {cloudConnected && (
                <span className={`cloud-status ${cloudStatus === "decrypt-failed" ? "cloud-status-error" : ""}`}>
                  {cloudStatus === "decrypt-failed" ? "wrong passphrase — can't decrypt peer data" : cloudStatus}
                </span>
              )}
            </div>
            <PropertiesPanel raw={raw} ytext={localSession.ytext} />
            {isCanvas ? (
              <CanvasNote key={activePath} raw={raw} ytext={localSession.ytext} />
            ) : (
              <>
                <div className={`editor-body view-${viewMode}`}>
                  {viewMode !== "preview" && (
                    <div className="editor-source">
                      <Editor key={activePath} ytext={localSession.ytext} awareness={localSession.provider.awareness} />
                    </div>
                  )}
                  {viewMode !== "source" && (
                    <div className="editor-preview">
                      <Preview raw={raw} notes={notes} onNavigate={openNote} />
                    </div>
                  )}
                </div>
                <div className="backlinks-panel">
                  <div className="backlinks-header">Backlinks</div>
                  <Backlinks path={activePath} onNavigate={openNote} />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="empty-state">Select a note or create a new one.</div>
        )}
      </main>
    </div>
  );
}
