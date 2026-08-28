import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import {
  createNote,
  deleteNoteApi,
  fetchNote,
  fetchNotes,
  fetchRole,
  fetchTypes,
  reindex,
  search,
  type NoteListItem,
  type SearchResult,
  type ShareRole,
} from "./api";
import { openLocalCollab, openTauriLocalSession, type CollabHandle } from "./collab";
// cloud-collab.ts pulls in crypto.ts -> libsodium-wrappers-sumo (~550KB of
// WASM) — most users never touch cloud sync, so this is a dynamic import
// (see the effect below) rather than a static one, same reasoning as the
// CanvasNote/Excalidraw split above.
import type { CloudStatus } from "./cloud-collab";
import { IS_TAURI, defaultRelayUrl } from "./platform";
import { activateOnEnterOrSpace } from "./a11y";
import { APP_VERSION } from "./version";
import Editor from "./Editor";
import Preview, { buildResolver } from "./Preview";
import Backlinks from "./Backlinks";
import PropertiesPanel from "./PropertiesPanel";
import GraphView from "./GraphView";
// Excalidraw is a large dependency (shapes, its own UI, export logic) that
// most notes never touch — lazy-loaded so it's not part of the bundle
// every user pays for on first load, only the ones who open a canvas note.
const CanvasNote = lazy(() => import("./CanvasNote"));
import SharePanel from "./SharePanel";
import HistoryPanel from "./HistoryPanel";
import ConfirmDialog from "./ConfirmDialog";
import { renderNoteBody, type RenderEnv } from "./markdown";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import { parseFrontmatter } from "../shared/frontmatter";
import { getIdentity } from "./identity";
import IdentityPanel from "./IdentityPanel";
import { THEMES, getStoredTheme, applyTheme, isDarkTheme } from "./themes";
import { setMermaidDark } from "./mermaid-render";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeId, setThemeId] = useState(() => getStoredTheme());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [localSession, setLocalSession] = useState<CollabHandle | null>(null);
  const [raw, setRaw] = useState("");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [role, setRole] = useState<ShareRole | "owner" | "denied">("owner");

  const [cloudRoom, setCloudRoom] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | "">("");
  // Not a secret — just an address — so localStorage is fine (unlike the
  // passphrase above, which deliberately stays in-memory only).
  const [relayUrl, setRelayUrl] = useState(() => localStorage.getItem("pkm-relay-url") || defaultRelayUrl());

  const loadNotes = useCallback(async () => {
    setNotes(await fetchNotes(typeFilter || undefined));
  }, [typeFilter]);

  useEffect(() => {
    loadNotes();
    fetchTypes().then(setTypes);
  }, [loadNotes]);

  // A share link looks like ?path=<note>&token=<token> — open straight into
  // that note under that token's role.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const p = params.get("path");
    const token = params.get("token");
    if (p) {
      setShareToken(token);
      setActivePath(p);
    }
  }, []);

  // First-run onboarding: open the Tutorial note automatically once, so a
  // new user doesn't have to already know it's there to find it. Skipped
  // if something else already claimed activePath (e.g. a share link from
  // the effect above), and only fires once per browser (localStorage flag).
  useEffect(() => {
    if (activePath || notes.length === 0) return;
    const key = "pkm-onboarded";
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    const tutorial = notes.find((n) => n.path === "tutorial.md");
    if (tutorial) openNote(tutorial.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, activePath]);

  useEffect(() => {
    applyTheme(themeId);
    setMermaidDark(isDarkTheme(themeId));
  }, [themeId]);

  useEffect(() => {
    // Vault-wide search is an owner-only operation server-side (a share
    // token only grants access to specific notes, not a search index over
    // the whole vault) — skip the call entirely for a guest session rather
    // than let them type into a box that always comes back empty/403.
    if (!query.trim() || shareToken) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      search(query).then(setResults);
    }, 150);
    return () => clearTimeout(t);
  }, [query, shareToken]);

  // Opens the local editing session for the active note: a real-time
  // synced Yjs doc over the local collab server in the browser deployment,
  // or a single local Yjs doc that debounce-persists via Tauri commands in
  // the native deployment (no local collab server ported to Rust yet — see
  // collab.ts's openTauriLocalSession). Mirrors the live text into `raw`
  // state for the preview/properties panel/export to read either way.
  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    let session: CollabHandle | null = null;
    let unbindText: (() => void) | null = null;

    setRole("owner");
    fetchRole(activePath, shareToken).then(setRole);

    const identity = getIdentity();

    async function open(path: string) {
      if (IS_TAURI) {
        setStatus("loading…");
        const note = await fetchNote(path);
        if (cancelled) return;
        session = openTauriLocalSession(path, note.raw, { id: identity.id, name: identity.name });
        setStatus("local");
      } else {
        session = openLocalCollab(path, {
          token: shareToken,
          name: identity.name,
          id: identity.id,
          onDenied: () => {
            if (cancelled) return;
            setRole("denied");
            setStatus("access denied");
          },
        });
        setStatus("connecting…");
      }

      session.awareness.setLocalStateField("user", { name: identity.name, color: identity.color, id: identity.id });
      setLocalSession(session);
      setPeerCount(0);

      const activeSession = session;
      const onTextChange = () => setRaw(activeSession.ytext.toString());
      onTextChange();
      activeSession.ytext.observe(onTextChange);
      unbindText = () => activeSession.ytext.unobserve(onTextChange);

      if (activeSession.provider) {
        let hasSyncedOnce = false;
        activeSession.provider.on("status", ({ status: s }: { status: string }) => {
          if (s === "connected") {
            setStatus("connected");
          } else if (s === "connecting") {
            // y-websocket emits "connecting" for the initial connect too,
            // not just reconnects — only call it "reconnecting" once we
            // know this session was synced before and then lost that.
            setStatus(hasSyncedOnce ? "reconnecting…" : "connecting…");
          } else {
            setStatus(s);
          }
        });
        activeSession.provider.on("sync", (synced: boolean) => {
          if (synced) {
            hasSyncedOnce = true;
            setStatus("synced");
          }
        });
        activeSession.awareness.on("change", () => {
          setPeerCount(Math.max(0, activeSession.awareness.getStates().size - 1));
        });
      }
      activeSession.doc.on("update", () => loadNotes());
    }

    open(activePath);

    return () => {
      cancelled = true;
      unbindText?.();
      session?.destroy();
      setLocalSession(null);
      setRaw("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, shareToken]);

  // Opt-in cloud sync for the currently open note: connects to the E2E
  // relay under a room name (defaults to the note's path) and bridges it
  // into the local doc so edits flow both ways.
  useEffect(() => {
    if (!cloudConnected || !activePath || !localSession) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let unbridge: (() => void) | null = null;

    setCloudStatus("connecting");
    import("./cloud-collab").then(({ openCloudCollab }) =>
      openCloudCollab(cloudRoom.trim() || activePath, cloudPassphrase, relayUrl, setCloudStatus)
    ).then((session) => {
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
    setShareToken(null); // navigating from within the app is always as the owner
    setSidebarOpen(false); // closes the mobile drawer after picking a note
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

  async function onDailyNote() {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const p = `daily/${date}.md`;
    try {
      await fetchNote(p); // already exists — just open it
    } catch {
      const template = `---\ntitle: ${date}\ntype: daily\n---\n\n`;
      await createNote(p, template);
      await loadNotes();
      fetchTypes().then(setTypes);
    }
    openNote(p);
  }

  async function confirmDelete() {
    setDeleteConfirmOpen(false);
    if (!activePath) return;
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
      <button className="hamburger" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle sidebar">
        ☰
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <IdentityPanel />
        <div className="sidebar-header">
          {!shareToken && (
            <input
              className="search-input"
              placeholder="Search notes…"
              aria-label="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
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
          <select className="type-filter" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                Theme: {t.label}
              </option>
            ))}
          </select>
        </div>
        <ul className="note-list">
          {results
            ? results.map((r) => (
                <li
                  key={r.path}
                  className={r.path === activePath ? "active" : ""}
                  onClick={() => openNote(r.path)}
                  onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(r.path))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="note-title">{r.title}</div>
                  <div className="note-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </li>
              ))
            : notes.map((n) => (
                <li
                  key={n.path}
                  className={n.path === activePath ? "active" : ""}
                  onClick={() => openNote(n.path)}
                  onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(n.path))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="note-title">{n.title}</div>
                  {n.tags.length > 0 && <div className="note-tags">{n.tags.join(", ")}</div>}
                </li>
              ))}
          {results && results.length === 0 && <li className="empty-hint">No matches.</li>}
          {!results && notes.length === 0 && <li className="empty-hint">No notes yet.</li>}
        </ul>
        {/* Vault-wide actions — creating notes, reindexing, browsing the
            link graph — are for the owner's own vault, not something a
            share-link recipient should see, so they're hidden in guest
            (shareToken) mode even though the note list above still shows
            (needed for wikilink/transclusion resolution — see the
            requireOwner comment in server/index.ts). */}
        {!shareToken && (
          <div className="sidebar-footer">
            <button onClick={onNewNote}>+ New note</button>
            <button onClick={onNewCanvas}>+ Canvas</button>
            <button onClick={onDailyNote}>Today</button>
            <button
              onClick={() => {
                setShowGraph((g) => !g);
                setSidebarOpen(false);
              }}
            >
              {showGraph ? "Editor" : "Graph"}
            </button>
            <button onClick={onReindex}>Reindex</button>
          </div>
        )}
        <div className="sidebar-version">pkm v{APP_VERSION}{IS_TAURI ? "" : " · web"}</div>
      </aside>
      <main className="editor-pane">
        {showGraph ? (
          <GraphView activePath={activePath} onNavigate={openNote} />
        ) : role === "denied" ? (
          <div className="access-denied">
            This share link is invalid or has been revoked — you don't have access to this note.
          </div>
        ) : activePath && localSession ? (
          <>
            <div className="editor-toolbar">
              <span className="editor-path">{activePath}</span>
              <span className={`editor-status ${status !== "synced" && status !== "connected" ? "editor-status-offline" : ""}`}>
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
              {role !== "owner" && <span className="role-badge">{role}</span>}
              {role === "owner" && <button onClick={() => setDeleteConfirmOpen(true)}>Delete</button>}
            </div>
            {role === "owner" && (
              <div className="cloud-bar-wrap">
                <div className="cloud-bar">
                  <input
                    className="cloud-input"
                    placeholder="Relay server (ws://host:port)"
                    aria-label="Cloud sync relay server address"
                    value={relayUrl}
                    onChange={(e) => {
                      setRelayUrl(e.target.value);
                      localStorage.setItem("pkm-relay-url", e.target.value);
                    }}
                    disabled={cloudConnected}
                  />
                  <input
                    className="cloud-input"
                    placeholder={`Room (default: ${activePath})`}
                    aria-label="Cloud sync room name"
                    value={cloudRoom}
                    onChange={(e) => setCloudRoom(e.target.value)}
                    disabled={cloudConnected}
                  />
                  <input
                    className="cloud-input"
                    type="password"
                    placeholder="Shared passphrase"
                    aria-label="Cloud sync shared passphrase"
                    value={cloudPassphrase}
                    onChange={(e) => setCloudPassphrase(e.target.value)}
                    disabled={cloudConnected}
                  />
                  <button
                    onClick={() => setCloudConnected((c) => !c)}
                    disabled={!cloudConnected && (!cloudPassphrase || !relayUrl.trim())}
                  >
                    {cloudConnected ? "Disconnect cloud sync" : "Connect cloud sync"}
                  </button>
                  {cloudConnected && (
                    <span className={`cloud-status ${cloudStatus === "decrypt-failed" ? "cloud-status-error" : ""}`}>
                      {cloudStatus === "decrypt-failed" ? "wrong passphrase — can't decrypt peer data" : cloudStatus}
                    </span>
                  )}
                </div>
                <p className="cloud-warning">
                  ⚠ Cloud sync has no view/edit separation yet — anyone with this passphrase can read <em>and
                  write</em>, unlike the Share panel's local roles below. Only share it with people you'd trust to
                  edit.
                </p>
              </div>
            )}
            <PropertiesPanel raw={raw} ytext={localSession.ytext} readOnly={role === "view" || role === "comment"} />
            <SharePanel path={activePath} isOwner={role === "owner"} />
            <HistoryPanel path={activePath} shareToken={shareToken} />
            {isCanvas ? (
              <Suspense fallback={<div className="canvas-loading">Loading canvas…</div>}>
                <CanvasNote key={activePath} raw={raw} ytext={localSession.ytext} dark={isDarkTheme(themeId)} />
              </Suspense>
            ) : (
              <>
                <div className={`editor-body view-${viewMode}`}>
                  {viewMode !== "preview" && (
                    <div className="editor-source">
                      <Editor
                        key={activePath}
                        ytext={localSession.ytext}
                        awareness={localSession.awareness}
                        readOnly={role === "view" || role === "comment"}
                        dark={isDarkTheme(themeId)}
                      />
                    </div>
                  )}
                  {viewMode !== "source" && (
                    <div className="editor-preview">
                      <Preview raw={raw} notes={notes} onNavigate={openNote} shareToken={shareToken} />
                    </div>
                  )}
                </div>
                <div className="backlinks-panel">
                  <div className="backlinks-header">Backlinks</div>
                  <Backlinks path={activePath} onNavigate={openNote} shareToken={shareToken} />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="empty-state">Select a note or create a new one.</div>
        )}
      </main>
      {deleteConfirmOpen && activePath && (
        <ConfirmDialog
          title="Delete note?"
          message={`"${activePath}" will be removed from the vault. This can't be undone from here — the file itself is gone, though it may still be recoverable from your own backups or git history if you keep one.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}
