import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  createNote,
  deleteNoteApi,
  fetchNote,
  fetchNotes,
  fetchRole,
  fetchTypes,
  fetchVaultInfo,
  importFolder,
  pickBibFile,
  reindex,
  search,
  switchVault,
  writeNoteApi,
  type NoteListItem,
  type SearchResult,
  type ShareRole,
} from "./api";
import { parseBibtex } from "../shared/bibtex";
import { applyTextDiff, openLocalCollab, openTauriLocalSession, type CollabHandle } from "./collab";
// cloud-collab.ts pulls in crypto.ts -> libsodium-wrappers-sumo (~550KB of
// WASM) — most users never touch cloud sync, so this is a dynamic import
// (see the effect below) rather than a static one, same reasoning as the
// CanvasNote/Excalidraw split above.
import type { CloudStatus } from "./cloud-collab";
import { IS_TAURI, defaultRelayUrl } from "./platform";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activateOnEnterOrSpace } from "./a11y";
import { APP_VERSION } from "./version";
import Editor from "./Editor";
import Preview from "./Preview";
import { buildResolver } from "./noteResolver";
import Backlinks from "./Backlinks";
import PropertiesPanel from "./PropertiesPanel";
import GraphView from "./GraphView";
import TableView from "./TableView";
import FlashcardReview from "./FlashcardReview";
// Excalidraw is a large dependency (shapes, its own UI, export logic) that
// most notes never touch — lazy-loaded so it's not part of the bundle
// every user pays for on first load, only the ones who open a canvas note.
const CanvasNote = lazy(() => import("./CanvasNote"));
import SharePanel from "./SharePanel";
import HistoryPanel from "./HistoryPanel";
import CommentsPanel from "./CommentsPanel";
import ConfirmDialog from "./ConfirmDialog";
import PromptDialog from "./PromptDialog";
import CommandPalette, { type Command } from "./CommandPalette";
import UpdateBanner from "./UpdateBanner";
import { checkForUpdate, type Update } from "./updater";
import { renderNoteBody, type RenderEnv } from "./markdown";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { getIdentity } from "./identity";
import IdentityPanel from "./IdentityPanel";
import { getRecent, recordOpened, type RecentNote } from "./recentNotes";
import { queryNotes } from "./noteQuery";
import TemplatePickerDialog from "./TemplatePickerDialog";
import { getStoredTheme, applyTheme, isDarkTheme } from "./themes";
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
// "all"/"journal"/"canvas" drive the existing typeFilter mechanism under
// the hood (see selectView) — "favorites" is a pure client-side filter
// over whatever's already loaded, since a favorited note can be any type.
type SidebarView = "all" | "journal" | "canvas" | "favorites";

// Same icon set as the sidebar nav rows, so a type reads the same way
// wherever it shows up (nav row, Recent list, etc).
function noteTypeIcon(type: string | null): string {
  switch (type) {
    case "daily":
      return "📅";
    case "canvas":
      return "🖌";
    case "flashcard":
      return "🧠";
    case "template":
      return "📐";
    case null:
      return "📄";
    default:
      return "🗂";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Daily-note titles are just the ISO date ("2026-08-30") — accurate but
// flat to read in a list. Journal view shows something a person actually
// scans ("Today", "Yesterday", or a weekday) instead, falling back to the
// raw title for anything that isn't a plain YYYY-MM-DD (a renamed entry,
// say) so this only touches the common case.
function formatJournalTitle(title: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(title)) return title;
  const [y, m, d] = title.split("-").map(Number);
  const entryDate = new Date(y, m - 1, d);
  if (Number.isNaN(entryDate.getTime())) return title;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - entryDate.getTime()) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return entryDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: entryDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

export default function App() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [types, setTypes] = useState<{ type: string; count: number }[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [sidebarView, setSidebarView] = useState<SidebarView>("all");
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecent());
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState("");
  const [peerCount, setPeerCount] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeId, setThemeId] = useState(() => getStoredTheme());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [createMenuOpenState, setCreateMenuOpenState] = useState(false);
  const bibFileInputRef = useRef<HTMLInputElement | null>(null);
  const [createPromptMode, setCreatePromptMode] = useState<"note" | "canvas" | "flashcard" | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  // Native menu bar (src-tauri/src/lib.rs) dispatches these events for the
  // items it can't handle entirely on the Rust side (vault switching and
  // About are handled there directly, no round-trip needed). Browser mode
  // has no native menu at all, so this is a no-op there.
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlistenPromises = [
      listen("menu:new-note", () => onNewNote()),
      listen("menu:new-canvas", () => onNewCanvas()),
      listen("menu:today", () => onDailyNote()),
      listen("menu:reindex", () => onReindex()),
      listen("menu:toggle-sidebar", () => setSidebarOpen((o) => !o)),
      listen("menu:toggle-graph", () => setShowGraph((g) => !g)),
      listen("menu:view-source", () => setViewMode("source")),
      listen("menu:view-split", () => setViewMode("split")),
      listen("menu:view-preview", () => setViewMode("preview")),
      listen("menu:check-for-updates", () => onCheckForUpdates()),
    ];
    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    fetchVaultInfo().then((info) => setVaultName(info.name));
  }, []);

  // A note created from the separate Quick Capture window (or any other
  // out-of-band change — another instance, a direct file edit) has no way
  // to tell this window's React state about it, since they're separate
  // renderer processes with no shared state. Refetching on focus is a
  // cheap, general way to pick that up without a more elaborate cross-
  // window messaging setup.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) loadNotes();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A few seconds after launch, not immediately — no need to compete with
  // startup for network/CPU, and it means a silent failure (offline, no
  // network yet) doesn't show up as a startup hiccup. Silently swallows
  // errors: a failed background check shouldn't interrupt anyone, unlike
  // the same failure from the deliberate "Check for Updates…" menu action
  // below, which does report it.
  useEffect(() => {
    if (!IS_TAURI) return;
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((update) => update && setPendingUpdate(update))
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  async function onCheckForUpdates() {
    setStatus("checking for updates…");
    try {
      const update = await checkForUpdate();
      if (update) {
        setPendingUpdate(update);
        setStatus("");
      } else {
        setStatus("you're up to date");
      }
    } catch {
      setStatus("couldn't check for updates");
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      activeSession.doc.on("update", (_update: Uint8Array, origin: unknown) => {
        // toggleFavorite already does its own synchronous optimistic
        // setNotes() for this exact edit — an async loadNotes() triggered
        // by the same update can resolve afterward with the collab room's
        // not-yet-persisted (stale) data and silently clobber it. Every
        // other kind of edit still refreshes normally.
        if (origin === "favorite-toggle") return;
        loadNotes();
      });
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

  // `knownTitle` lets callers that just created a note (onNewNote etc.)
  // pass the title directly — right after loadNotes(), the `notes` state
  // update hasn't landed yet in this render's closure, so looking it up
  // from `notes`/`results` here would silently fall back to the raw file
  // path for a note opened immediately after creation.
  function openNote(p: string, knownTitle?: string, knownType?: string | null) {
    setShowGraph(false);
    setShowTable(false);
    setShowFlashcards(false);
    setShareToken(null); // navigating from within the app is always as the owner
    setSidebarOpen(false); // closes the mobile drawer after picking a note
    const title = knownTitle ?? notes.find((n) => n.path === p)?.title ?? results?.find((r) => r.path === p)?.title ?? p;
    // Same "state update hasn't landed in this closure yet" issue as
    // title above — callers that just created a note pass the type they
    // know directly rather than relying on a `notes` lookup that would
    // still be a render behind right after creation.
    const type = knownType !== undefined ? knownType : notes.find((n) => n.path === p)?.type ?? null;
    setRecentNotes(recordOpened(p, title, type));
    if (p === activePath) return;
    setActivePath(p);
  }

  function selectView(view: SidebarView) {
    setSidebarView(view);
    setShowGraph(false);
    setShowTable(false);
    setShowFlashcards(false);
    if (view === "journal") setTypeFilter("daily");
    else if (view === "canvas") setTypeFilter("canvas");
    else setTypeFilter(""); // "all" and "favorites" both draw from the full set
  }

  // Toggles the `favorite` frontmatter property directly — not a separate
  // local-only list — so it's consistent across devices/collaborators on
  // the same vault, same principle as `type`/`tags`.
  //
  // If the target note is the one currently open, this MUST go through
  // the live Y.Doc (same applyTextDiff pattern PropertiesPanel.tsx uses),
  // not a direct REST/IPC write: a direct file write races the collab
  // room's own ~500ms debounced persist (server/collab.ts), which holds
  // the note's content in memory independently of disk and will silently
  // overwrite a concurrent external write on its next save — confirmed by
  // a live browser test where a star toggled this way reverted itself
  // within a second. Only a note that ISN'T currently open (no live
  // session fighting over it) is safe to write directly.
  async function toggleFavorite(path: string) {
    if (path === activePath && localSession) {
      const parsed = parseFrontmatter(localSession.ytext.toString());
      const nextData = { ...parsed.data };
      const nextFavorite = nextData.favorite !== true;
      if (nextFavorite) nextData.favorite = true;
      else delete nextData.favorite;
      applyTextDiff(localSession.ytext, stringifyFrontmatter(nextData, parsed.body), "favorite-toggle");
      // Optimistic local update: the doc.on("update") listener already
      // calls loadNotes() on any local edit, but that refetch can race
      // ahead of the collab room's own ~500ms debounced persist
      // (server/collab.ts), which is what actually writes the new
      // frontmatter into the SQLite index this list reads from — without
      // this, the star doesn't visibly move to the Favorites section for
      // up to half a second even though the edit itself already landed.
      setNotes((prev) => prev.map((n) => (n.path === path ? { ...n, favorite: nextFavorite } : n)));
      return;
    }
    const note = await fetchNote(path, shareToken);
    const parsed = parseFrontmatter(note.raw);
    const nextData = { ...parsed.data };
    if (nextData.favorite === true) delete nextData.favorite;
    else nextData.favorite = true;
    const nextRaw = stringifyFrontmatter(nextData, parsed.body);
    const identity = getIdentity();
    try {
      await writeNoteApi(path, nextRaw, { id: identity.id, name: identity.name }, shareToken);
    } catch {
      setStatus("couldn't update favorite — try again");
      return;
    }
    await loadNotes();
  }

  // window.prompt() doesn't work in the native app at all — see
  // PromptDialog.tsx's header comment — so these just open a real modal
  // instead of blocking synchronously; submitCreatePrompt does the actual
  // creation once the title comes back from it.
  function onNewNote() {
    setTemplatePath(null);
    setCreatePromptMode("note");
  }

  function onNewCanvas() {
    setCreatePromptMode("canvas");
  }

  function onNewFlashcard() {
    setCreatePromptMode("flashcard");
  }

  function onNewFromTemplate() {
    setTemplatePickerOpen(true);
  }

  function pickTemplate(path: string) {
    setTemplatePickerOpen(false);
    setTemplatePath(path);
    setCreatePromptMode("note");
  }

  async function submitCreatePrompt(title: string) {
    const mode = createPromptMode;
    const chosenTemplatePath = templatePath;
    setCreatePromptMode(null);
    setTemplatePath(null);
    if (!mode) return;
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (mode === "note") {
      const p = `${slug || "untitled"}-${Date.now()}.md`;
      let template: string;
      if (chosenTemplatePath) {
        const templateNote = await fetchNote(chosenTemplatePath, shareToken);
        const parsed = parseFrontmatter(templateNote.raw);
        const date = new Date().toISOString().slice(0, 10);
        const body = parsed.body.replaceAll("{{date}}", date).replaceAll("{{title}}", title);
        // `type` isn't carried over — otherwise a note created from a
        // template would itself show up as a template next time (since
        // "is this a template" is just `type === "template"`).
        const { type: _templateType, ...rest } = parsed.data;
        template = stringifyFrontmatter({ ...rest, title }, body);
      } else {
        template = `---\ntitle: ${title}\ntags: []\n---\n\n`;
      }
      await createNote(p, template);
      await loadNotes();
      openNote(p, title, null);
    } else if (mode === "canvas") {
      const p = `${slug || "untitled"}-canvas-${Date.now()}.md`;
      // Left unset, an empty scene inherits the app's dark theme as its
      // canvas background too — a brand new canvas then reads as a plain
      // black void with nothing to signal "this is a sketch surface."
      // A sketch is drawn on paper, not on the app chrome, so it gets its
      // own light background regardless of which app theme is active.
      const scene = { type: "excalidraw", version: 2, elements: [], appState: { viewBackgroundColor: "#ffffff" } };
      const template = `---\ntitle: ${title}\ntype: canvas\n---\n${JSON.stringify(scene, null, 2)}\n`;
      await createNote(p, template);
      await loadNotes();
      fetchTypes().then(setTypes);
      openNote(p, title, "canvas");
    } else {
      // Starter content spells out the front/back convention directly in
      // the note, since there's nowhere else a first-time user would
      // learn it — the "---" line is real, not a placeholder to delete.
      const p = `${slug || "untitled"}-flashcard-${Date.now()}.md`;
      const template = `---\ntitle: ${title}\ntype: flashcard\n---\n${title}\n---\nType the answer here, after a line containing exactly "---".\n`;
      await createNote(p, template);
      await loadNotes();
      fetchTypes().then(setTypes);
      openNote(p, title, "flashcard");
    }
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
    openNote(p, date, "daily");
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

  async function onImportFolder() {
    setStatus("importing…");
    const result = await importFolder();
    const parts = [`imported ${result.imported}`, `skipped ${result.skipped}`];
    if (result.errors.length > 0) parts.push(`${result.errors.length} error${result.errors.length > 1 ? "s" : ""}`);
    setStatus(parts.join(", "));
    await loadNotes();
    fetchTypes().then(setTypes);
  }

  // One note per BibTeX entry, `type: reference` with the entry's fields
  // spread directly into frontmatter (title/author/year/journal/etc,
  // whatever the .bib file actually has) rather than a fixed whitelist —
  // frontmatter is already schema-less everywhere else in the app (Table
  // view, Properties panel), so a reference note follows the same rule.
  // Body is left empty; the point is the citable metadata, not prose.
  async function processBibImport(text: string) {
    setStatus("importing references…");
    const entries = parseBibtex(text);
    const existingPaths = new Set(notes.map((n) => n.path));
    let imported = 0;
    let skipped = 0;
    for (const entry of entries) {
      const safeKey = entry.citekey.replace(/[^a-zA-Z0-9_-]+/g, "-");
      const path = `references/${safeKey || "untitled"}.md`;
      if (existingPaths.has(path)) {
        skipped++;
        continue;
      }
      const data: Record<string, unknown> = { type: "reference", citekey: entry.citekey, ...entry.fields };
      if (!data.title) data.title = entry.citekey;
      await createNote(path, stringifyFrontmatter(data, ""));
      existingPaths.add(path);
      imported++;
    }
    setStatus(`imported ${imported} reference${imported === 1 ? "" : "s"}, skipped ${skipped}`);
    await loadNotes();
    fetchTypes().then(setTypes);
  }

  async function onImportBib() {
    if (IS_TAURI) {
      const text = await pickBibFile();
      if (text) await processBibImport(text);
      return;
    }
    bibFileInputRef.current?.click();
  }

  async function onBibFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again still fires a change event
    if (!file) return;
    await processBibImport(await file.text());
  }

  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const activeNote = notes.find((n) => n.path === activePath);
  const isCanvas = raw ? parseFrontmatter(raw).data.type === "canvas" : false;
  // Not gated on the active note's edit/owner role (that reflects only
  // the currently-open note): the star renders on every row in the list,
  // so a guest with edit access to their one shared note would otherwise
  // see a clickable star on every OTHER note in the vault too (the server
  // correctly 403s that write via requireNoteWrite, but the UI would
  // silently look broken rather than not offering the affordance at
  // all). Favoriting is a vault-wide personal-organization feature, same
  // category as New note/Reindex/Graph/search — all already gated on
  // !shareToken.
  const canFavorite = !shareToken;
  const favoriteNotes = notes.filter((n) => n.favorite);
  const displayedNotes = sidebarView === "favorites" ? favoriteNotes : notes;
  const templateNotes = queryNotes(notes, { type: "template" });
  const todayIso = new Date().toISOString().slice(0, 10);

  function exportEnv(): RenderEnv {
    return { resolver, bodies: new Map(), pathStack: new Set() };
  }

  // Same owner-only scoping as everything else vault-wide (search/nav/
  // create/reindex) — a guest viewing one shared note shouldn't get a
  // command list either, and most of these actions would 403 anyway.
  const paletteCommands: Command[] = shareToken
    ? []
    : [
        { id: "new-note", label: "New Note", action: onNewNote },
        { id: "new-canvas", label: "New Canvas", action: onNewCanvas },
        { id: "today", label: "Today's Journal Entry", action: onDailyNote },
        { id: "toggle-graph", label: showGraph ? "Show Editor" : "Show Graph", action: () => setShowGraph((g) => !g) },
        { id: "toggle-table", label: showTable ? "Show Editor" : "Show Table", action: () => setShowTable((t) => !t) },
        {
          id: "toggle-flashcards",
          label: showFlashcards ? "Show Editor" : "Review Flashcards",
          action: () => setShowFlashcards((f) => !f),
        },
        { id: "view-source", label: "View: Source", action: () => setViewMode("source") },
        { id: "view-split", label: "View: Split", action: () => setViewMode("split") },
        { id: "view-preview", label: "View: Preview", action: () => setViewMode("preview") },
        { id: "reindex", label: "Reindex Vault", action: onReindex },
        { id: "import-bib", label: "Import .bib References…", action: onImportBib },
        ...(IS_TAURI
          ? [
              { id: "switch-vault", label: "Switch Vault…", action: () => switchVault() },
              { id: "import-folder", label: "Import Folder…", action: onImportFolder },
            ]
          : []),
      ];

  return (
    <div className="app">
      {pendingUpdate && <UpdateBanner update={pendingUpdate} onDismiss={() => setPendingUpdate(null)} />}
      <button className="hamburger" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle sidebar">
        ☰
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        {IS_TAURI && (
          <div className="vault-header">
            <button
              className="vault-header-name"
              onClick={() => switchVault()}
              title="Switch to a different vault"
            >
              <span className="vault-icon" aria-hidden="true">
                🗄
              </span>
              {vaultName ?? "Vault"}
              <span className="vault-switch-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {!shareToken && (
              <>
                <button
                  className="vault-reindex"
                  onClick={onImportFolder}
                  title="Import a folder (.md/.txt/.json)"
                  aria-label="Import a folder"
                >
                  ⇩
                </button>
                <button className="vault-reindex" onClick={onReindex} title="Reindex vault" aria-label="Reindex vault">
                  ↻
                </button>
              </>
            )}
          </div>
        )}
        <IdentityPanel themeId={themeId} onThemeChange={setThemeId} />
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
        </div>
        {/* Vault-wide browsing/organization — same category as New note/
            Reindex/search, all already owner-only — not just Graph (which
            was the only row gated before this fix): a guest viewing one
            shared note shouldn't be presented with a full vault-browsing
            nav, even though the underlying note list they'd filter is
            already visible to them for wikilink-resolution reasons (see
            the requireOwner comment in server/index.ts) — showing the
            affordance anyway is inconsistent with how every other
            vault-wide action is already hidden from guests. */}
        {!results && !shareToken && (
          <nav className="sidebar-nav">
            <button
              className={sidebarView === "all" && !showGraph && !showTable && !showFlashcards ? "active" : ""}
              onClick={() => selectView("all")}
            >
              <span className="nav-icon" aria-hidden="true">
                📄
              </span>
              All Notes
            </button>
            <button
              className={sidebarView === "journal" && !showGraph && !showTable && !showFlashcards ? "active" : ""}
              onClick={() => selectView("journal")}
            >
              <span className="nav-icon" aria-hidden="true">
                📅
              </span>
              Journal
            </button>
            <button
              className={sidebarView === "canvas" && !showGraph && !showTable && !showFlashcards ? "active" : ""}
              onClick={() => selectView("canvas")}
            >
              <span className="nav-icon" aria-hidden="true">
                🖌
              </span>
              Canvas
            </button>
            <button
              className={showGraph ? "active" : ""}
              onClick={() => {
                setShowGraph((g) => !g);
                setShowTable(false);
                setShowFlashcards(false);
                setSidebarOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                🕸
              </span>
              Graph
            </button>
            <button
              className={showTable ? "active" : ""}
              onClick={() => {
                setShowTable((t) => !t);
                setShowGraph(false);
                setShowFlashcards(false);
                setSidebarOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                🗂
              </span>
              Table
            </button>
            <button
              className={showFlashcards ? "active" : ""}
              onClick={() => {
                setShowFlashcards((f) => !f);
                setShowGraph(false);
                setShowTable(false);
                setSidebarOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                🧠
              </span>
              Flashcards
            </button>
            {types.filter((t) => t.type !== "daily" && t.type !== "canvas").length > 0 && (
              <select
                className="type-filter nav-more-types"
                value={["", "daily", "canvas"].includes(typeFilter) ? "" : typeFilter}
                onChange={(e) => {
                  setSidebarView("all");
                  setTypeFilter(e.target.value);
                }}
              >
                <option value="">More types…</option>
                {types
                  .filter((t) => t.type !== "daily" && t.type !== "canvas")
                  .map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.type} ({t.count})
                    </option>
                  ))}
              </select>
            )}
          </nav>
        )}
        {!results && favoriteNotes.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">Favorites</div>
            <ul className="note-list-compact">
              {favoriteNotes.map((n) => (
                <li
                  key={n.path}
                  className={n.path === activePath ? "active" : ""}
                  onClick={() => openNote(n.path)}
                  onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(n.path))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="note-title">{n.title}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!results && recentNotes.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">Recent</div>
            <ul className="note-list-compact">
              {recentNotes.map((n) => (
                <li
                  key={n.path}
                  className={n.path === activePath ? "active" : ""}
                  onClick={() => openNote(n.path, undefined, n.type)}
                  onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(n.path, undefined, n.type))}
                  role="button"
                  tabIndex={0}
                >
                  <span className="note-type-icon" aria-hidden="true">
                    {noteTypeIcon(n.type)}
                  </span>
                  <div className="note-title">{n.title}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!results && sidebarView === "journal" && !displayedNotes.some((n) => n.title === todayIso) && (
          <button className="journal-today-cta" onClick={onDailyNote}>
            <span className="nav-icon" aria-hidden="true">
              ✏️
            </span>
            Write today's entry
          </button>
        )}
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
            : displayedNotes.map((n) => (
                <li
                  key={n.path}
                  className={n.path === activePath ? "active" : ""}
                  onClick={() => openNote(n.path)}
                  onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(n.path))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="note-title">
                    {sidebarView === "journal" ? formatJournalTitle(n.title) : n.title}
                  </div>
                  {sidebarView === "journal" && n.title !== formatJournalTitle(n.title) && (
                    <div className="note-tags">{n.title}</div>
                  )}
                  {n.tags.length > 0 && <div className="note-tags">{n.tags.join(", ")}</div>}
                  {canFavorite && (
                    <button
                      className={`favorite-toggle ${n.favorite ? "is-favorite" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(n.path);
                      }}
                      aria-label={n.favorite ? `Remove ${n.title} from favorites` : `Add ${n.title} to favorites`}
                      title={n.favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      {n.favorite ? "★" : "☆"}
                    </button>
                  )}
                </li>
              ))}
          {results && results.length === 0 && <li className="empty-hint">No matches.</li>}
          {!results && displayedNotes.length === 0 && (
            <li className="empty-hint">{sidebarView === "favorites" ? "No favorites yet." : "No notes yet."}</li>
          )}
        </ul>
        {/* Vault-wide actions — creating notes — are for the owner's own
            vault, not something a share-link recipient should see, so
            they're hidden in guest (shareToken) mode even though the note
            list above still shows (needed for wikilink/transclusion
            resolution — see the requireOwner comment in
            server/index.ts). */}
        {!shareToken && (
          <div className="sidebar-create">
            <button className="create-button" onClick={() => setCreateMenuOpenState((o) => !o)}>
              + Create
            </button>
            {createMenuOpenState && (
              <div className="create-menu">
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onNewNote();
                  }}
                >
                  New Note
                </button>
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onNewCanvas();
                  }}
                >
                  New Canvas
                </button>
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onDailyNote();
                  }}
                >
                  Today's Journal Entry
                </button>
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onNewFlashcard();
                  }}
                >
                  New Flashcard
                </button>
                {templateNotes.length > 0 && (
                  <button
                    onClick={() => {
                      setCreateMenuOpenState(false);
                      onNewFromTemplate();
                    }}
                  >
                    New From Template
                  </button>
                )}
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onImportBib();
                  }}
                >
                  Import .bib References…
                </button>
              </div>
            )}
            {!IS_TAURI && (
              <input
                ref={bibFileInputRef}
                type="file"
                accept=".bib"
                className="visually-hidden"
                onChange={onBibFileSelected}
              />
            )}
          </div>
        )}
        <div className="sidebar-version">Satori v{APP_VERSION}{IS_TAURI ? "" : " · web"}</div>
      </aside>
      <main className="editor-pane">
        {showGraph ? (
          <GraphView activePath={activePath} onNavigate={openNote} />
        ) : showTable ? (
          <TableView notes={displayedNotes} onNavigate={openNote} onNotesChanged={loadNotes} shareToken={shareToken} />
        ) : showFlashcards ? (
          <FlashcardReview shareToken={shareToken} />
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
            <CommentsPanel path={activePath} canComment={role !== "view"} shareToken={shareToken} />
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
                      <Preview
                        raw={raw}
                        notes={notes}
                        onNavigate={openNote}
                        shareToken={shareToken}
                        ytext={localSession.ytext}
                        readOnly={role === "view" || role === "comment"}
                      />
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
      {createPromptMode && (
        <PromptDialog
          title={
            createPromptMode === "note" ? "New note" : createPromptMode === "canvas" ? "New canvas" : "New flashcard"
          }
          placeholder={
            createPromptMode === "note"
              ? "Note title"
              : createPromptMode === "canvas"
                ? "Canvas title"
                : "What's the question?"
          }
          confirmLabel="Create"
          onSubmit={submitCreatePrompt}
          onCancel={() => setCreatePromptMode(null)}
        />
      )}
      {commandPaletteOpen && !shareToken && (
        <CommandPalette
          commands={paletteCommands}
          notes={notes}
          onOpenNote={(path, title) => openNote(path, title)}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {templatePickerOpen && (
        <TemplatePickerDialog
          templates={templateNotes}
          onSelect={pickTemplate}
          onCancel={() => setTemplatePickerOpen(false)}
        />
      )}
    </div>
  );
}
