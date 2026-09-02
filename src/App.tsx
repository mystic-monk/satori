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
  pickDataDictionaryFile,
  reindex,
  search,
  switchVault,
  writeNoteApi,
  type NoteListItem,
  type SearchResult,
  type ShareRole,
} from "./api";
import { parseBibtex } from "../shared/bibtex";
import { parseDataDictionary } from "../shared/dataDictionary";
import { applyTextDiff, openLocalCollab, openTauriLocalSession, type CollabHandle } from "./collab";
// cloud-collab.ts pulls in crypto.ts -> libsodium-wrappers-sumo (~550KB of
// WASM) — most users never touch cloud sync, so this is a dynamic import
// (see the effect below) rather than a static one, same reasoning as the
// CanvasNote/Excalidraw split above.
import type { CloudStatus, CloudRole, CloudSecret } from "./cloud-collab";
import { IS_TAURI, defaultRelayUrl } from "./platform";
import { fetchAuthStatus, type AuthStatus } from "./workspaceAuth";
import LoginScreen from "./LoginScreen";
import WorkspacePanel from "./WorkspacePanel";
import SettingsPanel from "./SettingsPanel";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activateOnEnterOrSpace } from "./a11y";
import { APP_VERSION } from "./version";
import Editor, { type CommentRange, type EditorHandle } from "./Editor";
import ReminderPopup from "./ReminderPopup";
import Preview, { buildCitations } from "./Preview";
import { buildResolver } from "./noteResolver";
import Backlinks from "./Backlinks";
import RelatedNotes from "./RelatedNotes";
import PropertiesPanel from "./PropertiesPanel";
import GraphView from "./GraphView";
import TableView from "./TableView";
import CalendarView from "./CalendarView";
import FlashcardReview from "./FlashcardReview";
import JournalView from "./JournalView";
// Excalidraw is a large dependency (shapes, its own UI, export logic) that
// most notes never touch — lazy-loaded so it's not part of the bundle
// every user pays for on first load, only the ones who open a canvas note.
const CanvasNote = lazy(() => import("./CanvasNote"));
import BlockOutline from "./BlockOutline";
import SharePanel from "./SharePanel";
import HistoryPanel from "./HistoryPanel";
import CommentsPanel from "./CommentsPanel";
import ConfirmDialog from "./ConfirmDialog";
import PromptDialog from "./PromptDialog";
import CommandPalette, { type Command } from "./CommandPalette";
import UpdateBanner from "./UpdateBanner";
import { checkForUpdate, type Update } from "./updater";
import type { RenderEnv } from "./markdown";
import { renderNoteBodyForExport } from "./renderForExport";
import { exportHtml, exportMarkdown, exportPdf } from "./export";
import { compileBook } from "./compileBook";
import { countWords } from "./wordCount";
import { requestNotificationPermission, fireNotification } from "./reminders";
import { dueReminders } from "./reminderSchedule";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { resolveFragment } from "../shared/blockrefs";
import { parseBlockDoc, flattenAllBlockText, createBlock, serializeBlockDoc } from "./blockTree";
import {
  Bell,
  BookOpen,
  Brain,
  Calendar,
  ChevronRight,
  Download,
  FileText,
  History,
  Menu as MenuIcon,
  MessageSquare,
  Paintbrush,
  RotateCw,
  Settings as SettingsIcon,
  Share2,
  SlidersHorizontal,
  Star,
  Table2,
  Users,
  Vault as VaultIcon,
  Waypoints,
} from "lucide-react";
import { getIdentity, getPersona, PERSONA_SHORTCUTS, type PersonaShortcut } from "./identity";
import IdentityPanel from "./IdentityPanel";
import { getRecent, recordOpened, pruneDeleted, type RecentNote } from "./recentNotes";
import { queryNotes } from "./noteQuery";
import TemplatePickerDialog from "./TemplatePickerDialog";
import { getStoredTheme, applyTheme, isDarkTheme } from "./themes";
import { setMermaidDark } from "./mermaid-render";
import { useResizableWidth } from "./useResizableWidth";

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

// "split" used to show raw source and rendered preview side by side,
// always both live-synced — flagged as confusing (nothing indicated which
// pane was "driving"). Replaced by "live": headings/bold/italic/etc.
// render styled inline in the same single editor pane, raw markup hidden
// except on the cursor's own line (see Editor.tsx's live-preview plugin).
// "source" (exact raw text) and "preview" (full markdown-it render, still
// the only place Mermaid/math/query blocks/etc. actually render) are
// unchanged.
type ViewMode = "source" | "preview" | "live";
// "all"/"canvas" drive the existing typeFilter mechanism under the hood
// (see selectView) — "favorites" is a pure client-side filter over
// whatever's already loaded, since a favorited note can be any type.
// Journal used to be a third typeFilter-driven member here too, but it's
// its own full-width view now (JournalView.tsx, a continuous scrollable
// page of entries rather than a filtered list you click into one at a
// time), so it's handled the same way Graph/Table/etc. are. Tutorials used
// to be a fourth member the same way Favorites is, but it's a collapsible
// inline sidebar section now (like Favorites/For You), not a separate view
// to switch into.
type SidebarView = "all" | "canvas" | "favorites";

// PersonaShortcut.icon is a plain string key (identity.ts stays a plain
// logic module, no React/lucide import) — this is the one place it gets
// mapped to an actual icon component.
const PERSONA_SHORTCUT_ICONS = {
  tutorial: BookOpen,
  journal: Calendar,
  table: Table2,
  canvas: Paintbrush,
  flashcards: Brain,
} as const;

export default function App() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [types, setTypes] = useState<{ type: string; count: number }[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [sidebarView, setSidebarView] = useState<SidebarView>("all");
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecent());
  const [vaultName, setVaultName] = useState<string | null>(null);
  // null = still loading (only ever matters on the server/browser
  // deployment — Tauri's local vault never has accounts, see IS_TAURI
  // guards below). Loading state matters here specifically to avoid a
  // flash of the normal app UI before we know whether a login gate is
  // actually needed.
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [identityPanelOpen, setIdentityPanelOpen] = useState(false);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  // Set right before opening Settings' export section, not persisted —
  // just "what did compiling just produce", reset per open note the same
  // way pendingCommentAnchor/commentRanges are (see the note-switch effect).
  const [compileStatus, setCompileStatus] = useState<string | null>(null);
  const [reminderPopupOpen, setReminderPopupOpen] = useState(false);
  // Keyed by "path:remind_at" (reminderSchedule.ts) so editing a reminder
  // to a new time can fire again — reset per app load, not persisted,
  // same "session-local" scope as everything else in this feature (see
  // src/reminders.ts's doc comment on why this can't be a true background
  // notification).
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState("");
  const [peerCount, setPeerCount] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Single source of truth for "which of the full-width special panels (if
  // any) is showing" — replaces four separate setShowX(false) calls
  // repeated at every switch point, which is exactly the shape of bug that
  // once left the Calendar view stuck on-screen after navigating away from
  // it (a forgotten reset at just one of those call sites).
  type SpecialPanel = "graph" | "table" | "calendar" | "flashcards" | "journal" | null;
  // Mirrors the booleans above so the Tauri menu listener below (a `[]`-dep
  // effect, so its closures never see a fresh `showGraph`) can still read
  // the live value instead of whatever it was at mount — same problem
  // Editor.tsx's onCommentOnSelectionRef solves the same way.
  const specialPanelRef = useRef<SpecialPanel>(null);
  function showSpecialPanel(panel: SpecialPanel) {
    specialPanelRef.current = panel;
    setShowGraph(panel === "graph");
    setShowTable(panel === "table");
    setShowCalendar(panel === "calendar");
    setShowFlashcards(panel === "flashcards");
    setShowJournal(panel === "journal");
    setSidebarOpen(false);
  }
  // Properties/Comments/History used to sit stacked above the editor,
  // eating vertical space before you'd even started writing; moved to
  // their own collapsible rail on the right so that space goes back to
  // the note by default.
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    () => localStorage.getItem("pkm-right-panel-collapsed") !== "0"
  );
  function toggleRightPanelCollapsed() {
    setRightPanelCollapsed((collapsed) => {
      localStorage.setItem("pkm-right-panel-collapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }
  // Defaults to expanded (unlike the right panel above) — the whole point
  // of this section is to be seen at least once; collapsing it is
  // something the user opts into, not the default state.
  const [foryouCollapsed, setForyouCollapsed] = useState(() => localStorage.getItem("pkm-foryou-collapsed") === "1");
  function toggleForyouCollapsed() {
    setForyouCollapsed((collapsed) => {
      localStorage.setItem("pkm-foryou-collapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }
  // History/Tutorials used to be full-panel rail destinations; now they're
  // collapsible inline sections like Favorites, but — unlike "For you"
  // above — default to COLLAPSED: secondary/glanceable content, not
  // something that needs to announce itself the first time a persona is
  // set.
  const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem("pkm-history-collapsed") !== "0");
  function toggleHistoryCollapsed() {
    setHistoryCollapsed((collapsed) => {
      localStorage.setItem("pkm-history-collapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }
  const [tutorialsCollapsed, setTutorialsCollapsed] = useState(
    () => localStorage.getItem("pkm-tutorials-collapsed") !== "0"
  );
  function toggleTutorialsCollapsed() {
    setTutorialsCollapsed((collapsed) => {
      localStorage.setItem("pkm-tutorials-collapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }
  // 64px floor is deliberately an "icon-only" width, not just a small
  // number — dragging the sidebar narrow enough drops nav labels (see
  // sidebarIconOnly below), so the collapse gesture is the drag itself,
  // not a separate button toggling a boolean.
  const sidebarResize = useResizableWidth("pkm-sidebar-width", 240, 64, 480, "left");
  // Below this, a label would either get clipped or crowd the icon —
  // hide it instead and let the icon (plus its title tooltip) carry the
  // meaning, the same tradeoff a deliberately-narrowed VSCode sidebar
  // makes, except here it's a direct consequence of a drag the user just
  // did, not a fixed always-icon-only mode imposed on them.
  const sidebarIconOnly = sidebarResize.width < 130;
  const rightPanelResize = useResizableWidth("pkm-right-panel-width", 300, 220, 480, "right");
  const [themeId, setThemeId] = useState(() => getStoredTheme());
  const [spellcheckMode, setSpellcheckMode] = useState<"auto" | "off">(
    () => (localStorage.getItem("pkm-spellcheck-mode") === "auto" ? "auto" : "off")
  );
  const editorRef = useRef<EditorHandle>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [createMenuOpenState, setCreateMenuOpenState] = useState(false);
  const bibFileInputRef = useRef<HTMLInputElement | null>(null);
  const dataDictionaryFileInputRef = useRef<HTMLInputElement | null>(null);
  const [createPromptMode, setCreatePromptMode] = useState<"note" | "canvas" | "flashcard" | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const [localSession, setLocalSession] = useState<CollabHandle | null>(null);
  const [raw, setRaw] = useState("");
  // Which note `raw` actually belongs to — needed because `raw` going
  // non-empty and `activePath` becoming the new note happen in the *same*
  // render (both set synchronously in openNote below), but the actual new
  // content only arrives later, asynchronously, once the collab session
  // for that note finishes opening. Without this, the fragment-resolution
  // effect further down would see a non-empty `raw` immediately and try to
  // resolve against the *previous* note's still-stale content.
  const [rawPath, setRawPath] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [role, setRole] = useState<ShareRole | "owner" | "denied">("owner");
  // A [[Note#fragment]] *link* click (as opposed to an embed, which
  // already resolves fragments to render just that excerpt) sets this;
  // resolved into an actual editor scroll position once the target note's
  // content is available — see the effect near the editor render below.
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [scrollToOffset, setScrollToOffset] = useState<number | null>(null);
  // Set when the "💬 Comment" button in the editor (Editor.tsx, appears on
  // selecting text) is clicked; consumed by CommentsPanel.tsx once the
  // comment is actually posted (or dismissed). commentRanges is the
  // reverse direction — CommentsPanel reports back which existing
  // comments' anchors resolved successfully, so Editor.tsx can highlight
  // them; recomputed there whenever that note's comments change.
  const [pendingCommentAnchor, setPendingCommentAnchor] = useState<{ from: number; to: number } | null>(null);
  const [commentRanges, setCommentRanges] = useState<CommentRange[]>([]);

  const [cloudRoom, setCloudRoom] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  // Which role to connect *as* — edit derives both contentKey and editToken
  // from the passphrase (full access, same as cloud sync always granted);
  // view uses a standalone content key someone with edit access shared,
  // which can decrypt but was never able to derive editToken. See
  // deriveRoomSecrets' doc comment in crypto.ts for why that separation
  // actually holds up cryptographically, not just in the UI.
  const [cloudRole, setCloudRole] = useState<CloudRole>("edit");
  const [cloudViewKey, setCloudViewKey] = useState("");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | "">("");
  // The connected session's *actual* role (as opposed to cloudRole above,
  // which is just what was requested) — null until a session actually
  // opens. Feeds the editor's readOnly prop below so a view-only cloud
  // connection can't type into the note even if someone edited this
  // component to skip past the relay's own signature check; defense in
  // depth, the relay enforcement is what actually matters.
  const [cloudSessionRole, setCloudSessionRole] = useState<CloudRole | null>(null);
  // Not a secret — just an address — so localStorage is fine (unlike the
  // passphrase above, which deliberately stays in-memory only).
  const [relayUrl, setRelayUrl] = useState(() => localStorage.getItem("pkm-relay-url") || defaultRelayUrl());

  // Always the full vault, never server-side filtered by typeFilter — this
  // feeds far more than the sidebar list (the wikilink/citation resolver,
  // relation resolution, favorites, template detection all read from
  // `notes` too), and every one of those needs to resolve against the
  // whole vault regardless of what the sidebar happens to be scoped to.
  // Was previously fetched pre-filtered by typeFilter, which meant
  // switching to Journal/Canvas/a custom type silently broke every
  // wikilink/citation to a note of a different type — they'd render as
  // "broken" purely because the sidebar filter, not the note's own
  // wikilinks, changed. typeFilter is applied client-side instead, in
  // displayedNotes below.
  const loadNotes = useCallback(async () => {
    setNotes(await fetchNotes());
  }, []);

  useEffect(() => {
    loadNotes();
    fetchTypes().then(setTypes);
  }, [loadNotes]);

  // Self-heals a stale History/Recent entry left behind by a deleted note
  // (recentNotes.ts's own localStorage cache has no link back to the
  // vault, so deleting a note doesn't touch it) — guarded on notes.length
  // so this can't wipe the list out on the very first render, before the
  // initial fetch above has actually landed.
  useEffect(() => {
    if (notes.length === 0) return;
    setRecentNotes(pruneDeleted(new Set(notes.map((n) => n.path))));
  }, [notes]);

  // Team/Workspace v1 is a server/browser-only concept — Tauri's local
  // vault has no accounts at all, so this never even makes the request
  // there (authStatus just stays null forever, and every check below
  // that gates on it treats IS_TAURI as "not configured" implicitly by
  // never showing the login gate or the sidebar trigger).
  useEffect(() => {
    if (IS_TAURI) return;
    fetchAuthStatus().then(setAuthStatus);
  }, []);

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

  // Checked every 20s against whatever `notes` currently holds — cheap (a
  // plain array scan, no fetch of its own) since `notes` is already kept
  // fresh by every other note-list-affecting action in this file. Only
  // fires while Satori itself is open; see reminders.ts's doc comment for
  // why this isn't a true background notification.
  useEffect(() => {
    const interval = setInterval(() => {
      const due = dueReminders(notes, Date.now(), firedRemindersRef.current);
      for (const reminder of due) {
        firedRemindersRef.current.add(reminder.key);
        fireNotification(reminder.title, "Reminder");
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [notes]);

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
      listen("menu:toggle-graph", () => showSpecialPanel(specialPanelRef.current === "graph" ? null : "graph")),
      listen("menu:view-source", () => setViewMode("source")),
      listen("menu:view-live", () => setViewMode("live")),
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
      const onTextChange = () => {
        setRaw(activeSession.ytext.toString());
        setRawPath(path);
      };
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
        if (origin === "favorite-toggle" || origin === "reminder-set") return;
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
      setRawPath(null);
      // Both note-specific: without this, a comment range highlighted in
      // the note you're leaving would keep showing (wrong) in whichever
      // note you open next, until/unless its own Comments panel happens to
      // be open and refetches. A pending "commenting on this selection"
      // from the note you're leaving is meaningless anywhere else too.
      setCommentRanges([]);
      setPendingCommentAnchor(null);
      setCompileStatus(null);
      setReminderPopupOpen(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, shareToken]);

  // Resolves a pending [[Note#fragment]] link click into an actual editor
  // scroll position, once the target note's content is actually loaded —
  // fires on `raw` changing (not `activePath`) so this also works for a
  // fragment link to the note you're *already* on, which never touches
  // activePath at all (see openNote above). Embeds already inline just the
  // matching excerpt via this exact same resolveFragment function
  // (src/markdown.ts's wikiembed renderer) — this is the link-navigation
  // equivalent, applied to the live document instead of rendered HTML.
  //
  // Gated on rawPath === activePath, not just `raw` being non-empty:
  // openNote sets pendingFragment and activePath in the same synchronous
  // update, but `raw` briefly still holds the *previous* note's content
  // (the new note's text only arrives later, once its collab session
  // finishes opening) — without this check, this would race and try to
  // resolve the fragment against the wrong note's body.
  useEffect(() => {
    if (!pendingFragment || !raw || rawPath !== activePath) return;
    const { body } = parseFrontmatter(raw);
    const bodyOffset = raw.length - body.length;
    const range = resolveFragment(body, pendingFragment);
    setPendingFragment(null);
    if (!range) return; // fragment doesn't exist in this note — link is just stale, nothing to scroll to
    setScrollToOffset(bodyOffset + range.start);
    setViewMode((m) => (m === "preview" ? "live" : m)); // the target has to actually be visible to scroll to it
  }, [raw, rawPath, activePath, pendingFragment]);

  // Opt-in cloud sync for the currently open note: connects to the E2E
  // relay under a room name (defaults to the note's path) and bridges it
  // into the local doc so edits flow both ways.
  useEffect(() => {
    if (!cloudConnected || !activePath || !localSession) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let unbridge: (() => void) | null = null;

    setCloudStatus("connecting");
    const room = cloudRoom.trim() || activePath;
    const secret: CloudSecret =
      cloudRole === "view" ? { kind: "contentKey", value: cloudViewKey.trim() } : { kind: "passphrase", value: cloudPassphrase };
    import("./cloud-collab").then(({ openCloudCollab }) =>
      openCloudCollab(room, secret, relayUrl, setCloudStatus)
    ).then((session) => {
      if (cancelled) {
        session.destroy();
        return;
      }
      destroy = session.destroy;
      setCloudSessionRole(session.role);
      unbridge = bridgeDocs(localSession.doc, session.doc);
    });

    return () => {
      cancelled = true;
      unbridge?.();
      destroy?.();
      setCloudSessionRole(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudConnected, activePath, localSession]);

  // `knownTitle` lets callers that just created a note (onNewNote etc.)
  // pass the title directly — right after loadNotes(), the `notes` state
  // update hasn't landed yet in this render's closure, so looking it up
  // from `notes`/`results` here would silently fall back to the raw file
  // path for a note opened immediately after creation.
  function openNote(p: string, knownTitle?: string, knownType?: string | null, fragment?: string) {
    showSpecialPanel(null);
    // Deliberately NOT clearing shareToken here (an earlier version did,
    // on the assumption navigating within the app is always as the
    // owner) — a guest reading their one shared note can click a
    // wikilink inside it (Preview wires onNavigate to this regardless of
    // guest/owner status), and that click must keep trying the SAME
    // token against the new path, not silently drop it and attempt the
    // fetch as if they were the owner. fetchRole/fetchNote already
    // re-resolve per the (activePath, shareToken) pair below — a target
    // note the token doesn't cover (e.g. outside a shared project's
    // scope) correctly falls through to the existing role==="denied" UI.
    setSidebarOpen(false); // closes the mobile drawer after picking a note
    const title = knownTitle ?? notes.find((n) => n.path === p)?.title ?? results?.find((r) => r.path === p)?.title ?? p;
    // Same "state update hasn't landed in this closure yet" issue as
    // title above — callers that just created a note pass the type they
    // know directly rather than relying on a `notes` lookup that would
    // still be a render behind right after creation.
    const type = knownType !== undefined ? knownType : notes.find((n) => n.path === p)?.type ?? null;
    setRecentNotes(recordOpened(p, title, type));
    // Set before the same-note early return below — a [[Note#Heading]]
    // link to the note you're already on should still scroll, even though
    // it's not a real navigation. The effect that resolves this into an
    // actual scroll position (further down) fires off raw/pendingFragment
    // changing, not off activePath, so it works either way.
    if (fragment) setPendingFragment(fragment);
    if (p === activePath) return;
    setActivePath(p);
  }

  function selectView(view: SidebarView) {
    setSidebarView(view);
    showSpecialPanel(null);
    setTypeFilter(view === "canvas" ? "canvas" : ""); // "all" and "favorites" both draw from the full set
  }

  // A "For you" shortcut is either a tutorial page (opens at the top, no
  // fragment — see identity.ts's PersonaShortcut doc comment) or a nav
  // view, dispatched through the exact same calls the real sidebar-nav
  // buttons make so it behaves identically to clicking that nav item.
  function onPersonaShortcutClick(shortcut: PersonaShortcut) {
    if (shortcut.tutorialPath) {
      openNote(shortcut.tutorialPath);
      return;
    }
    if (shortcut.navView === "canvas") {
      selectView("canvas");
    } else if (shortcut.navView) {
      showSpecialPanel(shortcut.navView);
    }
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
        // The template's own `type` is always "template" (that's the whole
        // convention — see TemplatePickerDialog.tsx) and is never carried
        // over as-is, or a note created from one would itself show up as a
        // template next time. What the CREATED note's real type should be
        // is a separate declaration, `note_type` (e.g. book.md carries
        // `note_type: book`) — without it a created note used to end up
        // permanently untyped, silently breaking anything that keys off
        // that type afterwards (Book's "Compile chapters" export, its own
        // `type: chapter` query block, Project's share-scoping, ...).
        const { type: _templateType, note_type, ...rest } = parsed.data;
        template = stringifyFrontmatter({ ...rest, ...(note_type ? { type: note_type } : {}), title }, body);
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
      // New daily notes get the block outliner; only new ones — a
      // pre-existing daily note whose body isn't valid block-JSON (prose
      // written before this feature existed) keeps opening as a normal
      // note, see isOutline above.
      const seed = serializeBlockDoc({ blocks: [createBlock()] });
      const template = `---\ntitle: ${date}\ntype: daily\n---\n${seed}`;
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
    // Destroyed directly (not just via setActivePath(null) below, which
    // only *schedules* the same teardown through the session-opening
    // effect's cleanup) so this happens deterministically before the
    // delete request — in Tauri mode, that cleanup normally flushes a
    // pending debounced autosave by writing the note back to disk, which
    // raced deleteNoteApi below and could resurrect a just-deleted note.
    // skipFlush=true here means "this note is going away, don't write it."
    localSession?.destroy(true);
    setActivePath(null);
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

  // A markdown table cell can't contain a literal unescaped `|` — a
  // description with one would otherwise silently break the row's column
  // count when rendered.
  function escapeTableCell(s: string): string {
    return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  }

  // One note per table (`type: db_table`), columns rendered as a markdown
  // table in the body — a foreign-key column's `references_table` becomes
  // a real [[wikilink]] there rather than only living in frontmatter,
  // which is what makes it show up in Graph view/Backlinks for free
  // through the same body-wikilink indexing every other note already
  // uses, with no server/db.ts changes. Otherwise mirrors
  // processBibImport above: one record -> one note, skip (don't
  // overwrite) a table that's already been imported.
  async function processDataDictionaryImport(text: string) {
    setStatus("importing data dictionary…");
    const tables = parseDataDictionary(text);
    const existingPaths = new Set(notes.map((n) => n.path));
    let imported = 0;
    let skipped = 0;
    for (const table of tables) {
      const safeName = table.tableName.replace(/[^a-zA-Z0-9_-]+/g, "-");
      const path = `data-dictionary/${safeName || "untitled"}.md`;
      if (existingPaths.has(path)) {
        skipped++;
        continue;
      }
      const data = { type: "db_table", title: table.tableName, tags: ["data-dictionary"], column_count: table.columns.length };
      const rows = table.columns
        .map((c) => {
          // No #fragment on the link — the target table note has no
          // heading/^block-id matching a column name, so a fragment here
          // would just never resolve to anything; the referenced column
          // name is shown as plain text alongside instead.
          const references = c.referencesTable
            ? `[[${c.referencesTable}]]${c.referencesColumn ? ` (${c.referencesColumn})` : ""}`
            : "";
          const nullable = c.nullable === undefined ? "" : c.nullable ? "Yes" : "No";
          const pk = c.primaryKey ? "✓" : "";
          return `| ${escapeTableCell(c.name)} | ${escapeTableCell(c.type ?? "")} | ${nullable} | ${pk} | ${references} | ${escapeTableCell(c.description ?? "")} |`;
        })
        .join("\n");
      const body = `## Columns\n\n| Column | Type | Nullable | PK | References | Description |\n|---|---|---|---|---|---|\n${rows}\n`;
      await createNote(path, stringifyFrontmatter(data, body));
      existingPaths.add(path);
      imported++;
    }
    setStatus(`imported ${imported} table${imported === 1 ? "" : "s"}, skipped ${skipped}`);
    await loadNotes();
    fetchTypes().then(setTypes);
  }

  async function onImportDataDictionary() {
    if (IS_TAURI) {
      const text = await pickDataDictionaryFile();
      if (text) await processDataDictionaryImport(text);
      return;
    }
    dataDictionaryFileInputRef.current?.click();
  }

  async function onDataDictionaryFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processDataDictionaryImport(await file.text());
  }

  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const activeNote = notes.find((n) => n.path === activePath);
  const isCanvas = raw ? parseFrontmatter(raw).data.type === "canvas" : false;
  // A daily note whose body is valid block-JSON — falls back to the normal
  // Editor/Preview path for any daily note whose body ISN'T (existing
  // prose journal entries, or a not-yet-written empty one), so nothing
  // already in the vault is force-migrated; only new entries (see
  // onDailyNote below) get the outliner.
  const isOutline = raw ? parseFrontmatter(raw).data.type === "daily" && parseBlockDoc(parseFrontmatter(raw).body) !== null : false;
  const outlineDoc = useMemo(() => (isOutline && raw ? parseBlockDoc(parseFrontmatter(raw).body) : null), [isOutline, raw]);
  // True for the four "list-based" sidebar views (All Notes/Journal/
  // Canvas/Tutorials), false for the five full-width special panels
  // (Graph/Table/Calendar/Flashcards/History) — used throughout the rail
  // and the wide panel below to avoid repeating all five negations at
  // every active-state check.
  const isListView = !showGraph && !showTable && !showCalendar && !showFlashcards && !showJournal;
  // Frontmatter stripped before counting — otherwise a note's own YAML
  // properties would inflate the count of what's actually being written.
  // For an outline note, body text is spread across many small block
  // strings rather than one buffer — flattenAllBlockText joins them first.
  const bodyWordCount = useMemo(() => {
    if (outlineDoc) return countWords(flattenAllBlockText(outlineDoc));
    return raw ? countWords(parseFrontmatter(raw).body) : 0;
  }, [raw, outlineDoc]);
  const currentRemindAt = useMemo(() => {
    if (!raw) return null;
    const v = parseFrontmatter(raw).data.remind_at;
    return typeof v === "string" ? v : null;
  }, [raw]);
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
  // App re-renders on every keystroke (raw is set from ytext.observe while
  // editing) — these three used to be plain filters recomputed on every one
  // of those renders even though `notes` itself only changes on load/save.
  // Memoized so an editing session over a large vault doesn't rescan the
  // full notes array per keystroke for a value that hasn't changed.
  const favoriteNotes = useMemo(() => notes.filter((n) => n.favorite), [notes]);
  // Computed once (not inline in JSX) so the sidebar's "For you" section
  // doesn't need repeated getIdentity() calls or non-null assertions to
  // convince TypeScript the persona is still set a few lines later.
  const personaShortcuts = PERSONA_SHORTCUTS[getIdentity().persona ?? ""];
  // typeFilter narrows what the sidebar list (and Table view, which reads
  // this same value) shows — applied here, client-side, rather than by
  // fetching a pre-filtered `notes` from the server (see loadNotes above).
  // Filtered by tag rather than type: every tutorial note already carries
  // tags: [tutorial] (it's what the tutorial's own query-block example
  // demonstrates), including tutorial/properties.md, which is deliberately
  // type: reference to double as the citation-system demo — a type-based
  // filter would have missed it.
  const tutorialNotes = useMemo(() => notes.filter((n) => n.tags.includes("tutorial")), [notes]);
  const displayedNotes = useMemo(
    () =>
      sidebarView === "favorites"
        ? favoriteNotes
        : typeFilter
          ? notes.filter((n) => n.type === typeFilter)
          : notes,
    [sidebarView, favoriteNotes, typeFilter, notes]
  );
  const templateNotes = useMemo(() => queryNotes(notes, { type: "template" }), [notes]);

  function exportEnv(): RenderEnv {
    // citations included — previously missing here, which meant every
    // [@citekey] rendered as broken in an export even when it resolved
    // fine in the live Preview (which computes this same map itself).
    return { resolver, bodies: new Map(), pathStack: new Set(), citations: buildCitations(notes) };
  }

  // Named (rather than inline in each button's onClick) so the same three
  // actions can be wired up from both the note toolbar's quick-export
  // buttons and SettingsPanel's export section without duplicating the
  // renderNoteBodyForExport(...) call in three places.
  function onExportMd() {
    if (!activePath) return;
    exportMarkdown(activePath, raw);
  }
  async function onExportHtml() {
    if (!activePath) return;
    exportHtml(activeNote?.title ?? activePath, await renderNoteBodyForExport(raw, exportEnv(), notes));
  }
  async function onExportPdf() {
    if (!activePath) return;
    exportPdf(activeNote?.title ?? activePath, await renderNoteBodyForExport(raw, exportEnv(), notes));
  }

  // Same three-format shape as the export handlers above, just compiling
  // every related chapter into one document first (src/compileBook.ts)
  // instead of exporting the currently-open note's own content.
  async function runCompile(): Promise<{ raw: string; chapterCount: number; wordCount: number } | null> {
    if (!activeNote || activeNote.type !== "book") return null;
    const result = await compileBook(activeNote, notes, async (p) => (await fetchNote(p, shareToken)).raw);
    setCompileStatus(
      `Compiled ${result.chapterCount} chapter${result.chapterCount === 1 ? "" : "s"}, ${result.wordCount.toLocaleString()} words.`
    );
    return result;
  }
  async function onCompileMd() {
    const compiled = await runCompile();
    if (!compiled || !activeNote) return;
    exportMarkdown(`${activeNote.title}.md`, compiled.raw);
  }
  async function onCompileHtml() {
    const compiled = await runCompile();
    if (!compiled || !activeNote) return;
    exportHtml(activeNote.title, await renderNoteBodyForExport(compiled.raw, exportEnv(), notes));
  }
  async function onCompilePdf() {
    const compiled = await runCompile();
    if (!compiled || !activeNote) return;
    exportPdf(activeNote.title, await renderNoteBodyForExport(compiled.raw, exportEnv(), notes));
  }

  // Only ever called against the currently-open note's own live session —
  // same Y.Doc-write requirement toggleFavorite's activePath branch
  // documents (a direct REST/IPC write here would race the collab room's
  // own debounced persist and risk being silently overwritten).
  async function setReminder(remindAt: string | null) {
    if (!activePath || !localSession) return;
    if (remindAt) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setStatus("notifications are blocked — allow them to use reminders");
        return;
      }
    }
    const parsed = parseFrontmatter(localSession.ytext.toString());
    const nextData = { ...parsed.data };
    if (remindAt) nextData.remind_at = remindAt;
    else delete nextData.remind_at;
    applyTextDiff(localSession.ytext, stringifyFrontmatter(nextData, parsed.body), "reminder-set");
    // Same optimistic-update-plus-skip-the-reload reasoning as
    // toggleFavorite's activePath branch: an async loadNotes() triggered
    // by this same doc update can resolve with the collab room's
    // not-yet-persisted (stale) data and silently drop remind_at again —
    // the doc.on("update") listener above already skips reminder-set for
    // exactly this reason.
    setNotes((prev) =>
      prev.map((n) => {
        if (n.path !== activePath) return n;
        const nextProps = { ...n.properties };
        if (remindAt) nextProps.remind_at = remindAt;
        else delete nextProps.remind_at;
        return { ...n, properties: nextProps };
      })
    );
    setReminderPopupOpen(false);
  }

  // Computed on demand, not stored in state — the whole point is that only
  // someone who already has the passphrase (i.e. edit access) can produce
  // this, and it's cheap enough (one Argon2id + one KDF call) to just
  // recompute whenever the "get a view-only link" button is pressed rather
  // than caching a value that'd go stale the moment the room or passphrase
  // fields change.
  async function getCloudViewKey(): Promise<string> {
    const room = cloudRoom.trim() || activePath || "";
    const { deriveRoomSecrets, encodeContentKey } = await import("./crypto");
    const { contentKey } = await deriveRoomSecrets(cloudPassphrase, room);
    return encodeContentKey(contentKey);
  }

  // Same owner-only scoping as everything else vault-wide (search/nav/
  // create/reindex) — a guest viewing one shared note shouldn't get a
  // command list either, and most of these actions would 403 anyway.
  const paletteCommands: Command[] = shareToken
    ? []
    : [
        { id: "new-note", label: "New Note", shortcut: IS_TAURI ? "⌘N" : undefined, action: onNewNote },
        { id: "new-canvas", label: "New Canvas", action: onNewCanvas },
        { id: "today", label: "Today's Journal Entry", action: onDailyNote },
        { id: "toggle-graph", label: showGraph ? "Show Editor" : "Show Graph", action: () => showSpecialPanel(showGraph ? null : "graph") },
        { id: "toggle-table", label: showTable ? "Show Editor" : "Show Table", action: () => showSpecialPanel(showTable ? null : "table") },
        {
          id: "toggle-calendar",
          label: showCalendar ? "Show Editor" : "Show Calendar",
          action: () => showSpecialPanel(showCalendar ? null : "calendar"),
        },
        {
          id: "toggle-flashcards",
          label: showFlashcards ? "Show Editor" : "Review Flashcards",
          action: () => showSpecialPanel(showFlashcards ? null : "flashcards"),
        },
        { id: "view-source", label: "View: Source", action: () => setViewMode("source") },
        { id: "view-live", label: "View: Live", action: () => setViewMode("live") },
        { id: "view-preview", label: "View: Preview", action: () => setViewMode("preview") },
        { id: "reindex", label: "Reindex Vault", action: onReindex },
        { id: "import-bib", label: "Import .bib References…", action: onImportBib },
        { id: "import-data-dictionary", label: "Import Data Dictionary…", action: onImportDataDictionary },
        {
          id: "spellcheck-note",
          label: "Check Spelling: Whole Note",
          action: () => editorRef.current?.checkSpelling("note"),
        },
        {
          id: "spellcheck-selection",
          label: "Check Spelling: Selection",
          action: () => editorRef.current?.checkSpelling("selection"),
        },
        { id: "spellcheck-clear", label: "Clear Spelling Underlines", action: () => editorRef.current?.clearSpelling() },
        ...(IS_TAURI
          ? [
              { id: "switch-vault", label: "Switch Vault…", action: () => switchVault() },
              { id: "import-folder", label: "Import Folder…", action: onImportFolder },
            ]
          : []),
      ];

  // The one place accounts actually change behavior for someone without
  // a valid session: once the server has ≥1 account, every browser needs
  // to sign in — replacing the whole app UI, not just gating a panel.
  // Unreachable in Tauri (authStatus never gets fetched there) and
  // unreachable on a server with zero accounts configured (authStatus.
  // configured stays false, matching hasOwnerAccess's server-side logic
  // exactly — see server/auth.ts's doc comment on that function).
  if (!IS_TAURI && authStatus?.configured && !authStatus.user) {
    const inviteToken = new URLSearchParams(location.search).get("invite");
    return <LoginScreen inviteToken={inviteToken} onSignedIn={(user) => setAuthStatus({ configured: true, user })} />;
  }

  return (
    <div className="app">
      {pendingUpdate && <UpdateBanner update={pendingUpdate} onDismiss={() => setPendingUpdate(null)} />}
      {workspacePanelOpen && authStatus && (
        <WorkspacePanel
          status={authStatus}
          onStatusChange={setAuthStatus}
          onClose={() => setWorkspacePanelOpen(false)}
          notes={notes}
        />
      )}
      {identityPanelOpen && <IdentityPanel open={identityPanelOpen} onClose={() => setIdentityPanelOpen(false)} />}
      {settingsPanelOpen && (
        <SettingsPanel
          onClose={() => setSettingsPanelOpen(false)}
          themeId={themeId}
          onThemeChange={setThemeId}
          spellcheckMode={spellcheckMode}
          onSpellcheckModeChange={(mode) => {
            setSpellcheckMode(mode);
            localStorage.setItem("pkm-spellcheck-mode", mode);
          }}
          relayUrl={relayUrl}
          onRelayUrlChange={(url) => {
            setRelayUrl(url);
            localStorage.setItem("pkm-relay-url", url);
          }}
          cloudRoom={cloudRoom}
          onCloudRoomChange={setCloudRoom}
          cloudPassphrase={cloudPassphrase}
          onCloudPassphraseChange={setCloudPassphrase}
          cloudRole={cloudRole}
          onCloudRoleChange={setCloudRole}
          cloudViewKey={cloudViewKey}
          onCloudViewKeyChange={setCloudViewKey}
          onGetCloudViewKey={getCloudViewKey}
          cloudConnected={cloudConnected}
          onToggleCloudConnected={() => setCloudConnected((c) => !c)}
          cloudStatus={cloudStatus}
          activePath={activePath}
          canConnectCloud={role === "owner" && !!activePath && !!localSession}
          canExport={!!activePath && !isCanvas && !isOutline}
          onExportMd={onExportMd}
          onExportHtml={onExportHtml}
          onExportPdf={onExportPdf}
          canCompile={activeNote?.type === "book"}
          onCompileMd={onCompileMd}
          onCompileHtml={onCompileHtml}
          onCompilePdf={onCompilePdf}
          compileStatus={compileStatus}
        />
      )}
      {activePath && (
        <SharePanel
          path={activePath}
          noteTitle={activeNote?.title ?? activePath}
          isProject={activeNote?.type === "project"}
          isOwner={role === "owner"}
          open={sharePanelOpen}
          onClose={() => setSharePanelOpen(false)}
        />
      )}
      {/* A real top bar, not scrolled-away-with-the-content — vault and
          identity used to live buried at the bottom of the sidebar (or,
          before that, as two rows above the note list); both are "who/
          where" context that's meaningful in every view, not just while
          browsing notes, so they live here now, always in the same place.
          The per-note toolbar (path/status/word count/view mode/reminder/
          share/delete) also moved here from inside <main> — same reasoning,
          it's about the open note specifically, and only rendered when a
          list-view note is genuinely open (isListView; Graph/Table/etc.
          have nothing here to show). */}
      <header className="app-topbar">
        <div className="app-topbar-left">
          {IS_TAURI && (
            <>
              <button className="app-topbar-vault" onClick={() => switchVault()} title="Switch to a different vault">
                <VaultIcon size={15} />
                <span>{vaultName ?? "Vault"}</span>
              </button>
              {!shareToken && (
                <>
                  <button
                    className="app-topbar-icon-btn"
                    onClick={onImportFolder}
                    title="Import a folder (.md/.txt/.json)"
                    aria-label="Import a folder"
                  >
                    <Download size={14} />
                  </button>
                  <button className="app-topbar-icon-btn" onClick={onReindex} title="Reindex vault" aria-label="Reindex vault">
                    <RotateCw size={14} />
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {!shareToken && (
          <input
            className="app-topbar-search"
            placeholder="Search notes…"
            aria-label="Search notes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Search results render in the sidebar's note-list section,
              // which only shows in a list view (Graph/Table/etc. have
              // their own full-width content there instead) — typing a
              // query while looking at one of those switches back so the
              // results are actually visible, instead of typing into a
              // box with no visible effect.
              if (e.target.value && !isListView) showSpecialPanel(null);
            }}
          />
        )}
        <div className="app-topbar-note">
          {isListView && activePath && localSession && role !== "denied" && (
            <>
              <span className="editor-path">{activePath}</span>
              <span className={`editor-status ${status !== "synced" && status !== "connected" ? "editor-status-offline" : ""}`}>
                {status}
                {peerCount > 0 ? ` · ${peerCount} other editor${peerCount > 1 ? "s" : ""} online` : ""}
              </span>
              {!isCanvas && <span className="editor-word-count">{bodyWordCount.toLocaleString()} words</span>}
              {!isCanvas && !isOutline && (
                <div className="view-mode-toggle">
                  {(["source", "live", "preview"] as ViewMode[]).map((m) => (
                    <button key={m} className={viewMode === m ? "active" : ""} onClick={() => setViewMode(m)}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {role !== "view" && role !== "comment" && !isCanvas && (
                <div className="reminder-trigger-wrap">
                  <button
                    className={currentRemindAt ? "active" : ""}
                    onClick={() => setReminderPopupOpen((o) => !o)}
                    title={currentRemindAt ? `Reminder set for ${new Date(currentRemindAt).toLocaleString()}` : "Set a reminder"}
                  >
                    <Bell size={13} />
                    {currentRemindAt ? ` ${new Date(currentRemindAt).toLocaleDateString()}` : ""}
                  </button>
                  {reminderPopupOpen && (
                    <ReminderPopup
                      value={currentRemindAt}
                      onSet={(v) => setReminder(v)}
                      onClose={() => setReminderPopupOpen(false)}
                      notePath={activePath}
                      noteTitle={activeNote?.title ?? activePath}
                    />
                  )}
                </div>
              )}
              {role === "owner" && (
                <button onClick={() => setSharePanelOpen(true)} title="Share this note — generates a link scoped to just this note">
                  <Share2 size={13} /> Share
                </button>
              )}
              {role !== "owner" && <span className="role-badge">{role}</span>}
              {role === "owner" && (
                <button className="btn-danger" onClick={() => setDeleteConfirmOpen(true)}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
        <div className="app-topbar-right">
          <button className="app-topbar-identity" onClick={() => setIdentityPanelOpen(true)}>
            <span className="identity-color-dot" style={{ background: getIdentity().color }} aria-hidden="true" />
            You: {getIdentity().name}
          </button>
          {getPersona(getIdentity().persona) && (
            <button
              className="app-topbar-persona"
              title={`${getPersona(getIdentity().persona)!.label} — open the matching part of the tutorial`}
              onClick={() => openNote("tutorial/who-its-for.md", undefined, undefined, getPersona(getIdentity().persona)!.heading)}
            >
              {getPersona(getIdentity().persona)!.label}
            </button>
          )}
        </div>
      </header>
      <div className="app-body">
      <button className="hamburger" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle sidebar">
        <MenuIcon size={18} />
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarResize.resizing ? "resizing" : ""} ${sidebarIconOnly ? "icon-only" : ""}`}
        style={{ width: sidebarResize.width }}
      >
        <div
          className={`resize-handle resize-handle-left ${sidebarResize.resizing ? "resizing" : ""}`}
          onMouseDown={sidebarResize.onHandleMouseDown}
        />
        {/* Scrolling lives on this inner wrapper, not .sidebar itself — that
            element needs overflow: visible so the resize handle above
            (position: absolute, right: -3px, deliberately straddling the
            sidebar's own right edge) stays hit-testable; overflow: auto/
            hidden clips a positioned descendant's hit-testable area to the
            padding box, silently eating the handle's outer half (the exact
            bug the rail's own handle and "More" menu both had before this
            same fix). */}
        <div className="sidebar-scroll">
          {/* All nine views, always listed — no separate rail, no overflow
              "More" menu hiding most of them behind an extra click. Narrow
              the sidebar (drag the handle above) past ~130px and labels
              drop, icon-only, same idea as VSCode's activity bar but as a
              direct consequence of a resize the user did themselves, not a
              fixed mode imposed on them from the start. */}
          {!results && !shareToken && (
            <nav className="sidebar-nav">
              <button
                className={sidebarView === "all" && isListView ? "active" : ""}
                onClick={() => selectView("all")}
                title="All Notes"
              >
                <FileText size={17} />
                <span>All Notes</span>
              </button>
              <button
                className={showJournal ? "active" : ""}
                onClick={() => showSpecialPanel(showJournal ? null : "journal")}
                title="Journal"
              >
                <Calendar size={17} className="type-color-daily" />
                <span>Journal</span>
              </button>
              <button
                className={sidebarView === "canvas" && isListView ? "active" : ""}
                onClick={() => selectView("canvas")}
                title="Canvas"
              >
                <Paintbrush size={17} className="type-color-canvas" />
                <span>Canvas</span>
              </button>
              <button
                className={showGraph ? "active" : ""}
                onClick={() => showSpecialPanel(showGraph ? null : "graph")}
                title="Graph"
              >
                <Waypoints size={17} />
                <span>Graph</span>
              </button>
              <button
                className={showTable ? "active" : ""}
                onClick={() => showSpecialPanel(showTable ? null : "table")}
                title="Table"
              >
                <Table2 size={17} />
                <span>Table</span>
              </button>
              <button
                className={showCalendar ? "active" : ""}
                onClick={() => showSpecialPanel(showCalendar ? null : "calendar")}
                title="Calendar"
              >
                <Calendar size={17} className="type-color-daily" />
                <span>Calendar</span>
              </button>
              <button
                className={showFlashcards ? "active" : ""}
                onClick={() => showSpecialPanel(showFlashcards ? null : "flashcards")}
                title="Flashcards"
              >
                <Brain size={17} className="type-color-flashcard" />
                <span>Flashcards</span>
              </button>
            </nav>
          )}
          {isListView && (
            <div className="sidebar-header">
              {/* Journal/Canvas already have their own nav buttons — this is
                  for everything else: reference, template, project, or any
                  custom `type:` you've given your own notes. Filters the
                  list below to just that type; empty (just "reference," say)
                  until you actually have notes using other types — it's not
                  broken, there's just nothing else to filter by yet. */}
              {!results && !shareToken && types.filter((t) => t.type !== "daily" && t.type !== "canvas").length > 0 && (
                <select
                  className="type-filter nav-more-types"
                  value={["", "daily", "canvas"].includes(typeFilter) ? "" : typeFilter}
                  onChange={(e) => {
                    setSidebarView("all");
                    setTypeFilter(e.target.value);
                  }}
                  title="Filter the note list by type (anything other than Journal/Canvas, which have their own buttons above)"
                >
                  <option value="">Filter by type…</option>
                  {types
                    .filter((t) => t.type !== "daily" && t.type !== "canvas")
                    .map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.type} ({t.count})
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}
        {isListView && (
          <>
            {!results && sidebarView === "all" && !typeFilter && !shareToken && personaShortcuts?.length && (
              <div className="sidebar-section">
                <button className="sidebar-section-label sidebar-section-toggle" onClick={toggleForyouCollapsed}>
                  <ChevronRight size={12} className={`sidebar-section-chevron ${foryouCollapsed ? "" : "open"}`} />
                  For you
                </button>
                {!foryouCollapsed && (
                  <ul className="persona-shortcut-list">
                    {personaShortcuts.map((shortcut) => {
                      const Icon = PERSONA_SHORTCUT_ICONS[shortcut.icon];
                      return (
                        <li key={shortcut.label}>
                          <button className="persona-shortcut-item" onClick={() => onPersonaShortcutClick(shortcut)}>
                            <Icon size={14} />
                            {shortcut.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {!results && sidebarView === "all" && !typeFilter && favoriteNotes.length > 0 && (
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
            {!results && sidebarView === "all" && !typeFilter && recentNotes.length > 0 && (
              <div className="sidebar-section">
                <button className="sidebar-section-label sidebar-section-toggle" onClick={toggleHistoryCollapsed}>
                  <ChevronRight size={12} className={`sidebar-section-chevron ${historyCollapsed ? "" : "open"}`} />
                  History
                </button>
                {!historyCollapsed && (
                  <ul className="note-list-compact">
                    {recentNotes.map((n) => (
                      <li
                        key={n.path}
                        className={n.path === activePath ? "active" : ""}
                        onClick={() => openNote(n.path, n.title, n.type)}
                        onKeyDown={(e) => activateOnEnterOrSpace(e, () => openNote(n.path, n.title, n.type))}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="note-title">{n.title}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!results && sidebarView === "all" && !typeFilter && tutorialNotes.length > 0 && (
              <div className="sidebar-section">
                <button className="sidebar-section-label sidebar-section-toggle" onClick={toggleTutorialsCollapsed}>
                  <ChevronRight size={12} className={`sidebar-section-chevron ${tutorialsCollapsed ? "" : "open"}`} />
                  Tutorials
                </button>
                {!tutorialsCollapsed && (
                  <ul className="note-list-compact">
                    {tutorialNotes.map((n) => (
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
                )}
              </div>
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
                      <div className="note-title">{n.title}</div>
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
                          <Star size={14} fill={n.favorite ? "currentColor" : "none"} />
                        </button>
                      )}
                    </li>
                  ))}
              {results && results.length === 0 && <li className="empty-hint">No matches.</li>}
              {!results && displayedNotes.length === 0 && (
                <li className="empty-hint">{sidebarView === "favorites" ? "No favorites yet." : "No notes yet."}</li>
              )}
            </ul>
          </>
        )}
        </div>
        {/* Vault-wide actions — creating notes — are for the owner's own
            vault, not something a share-link recipient should see, so
            they're hidden in guest (shareToken) mode even though the note
            list above still shows (needed for wikilink/transclusion
            resolution — see the requireOwner comment in
            server/index.ts). */}
        {!shareToken && (
          <div className="sidebar-create">
            <button className="create-button btn-primary" onClick={() => setCreateMenuOpenState((o) => !o)}>
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
                <button
                  onClick={() => {
                    setCreateMenuOpenState(false);
                    onImportDataDictionary();
                  }}
                >
                  Import Data Dictionary…
                </button>
              </div>
            )}
            {!IS_TAURI && (
              <>
                <input
                  ref={bibFileInputRef}
                  type="file"
                  accept=".bib"
                  className="visually-hidden"
                  onChange={onBibFileSelected}
                />
                <input
                  ref={dataDictionaryFileInputRef}
                  type="file"
                  accept=".csv"
                  className="visually-hidden"
                  onChange={onDataDictionaryFileSelected}
                />
              </>
            )}
          </div>
        )}
        {/* Settings/Workspace — Vault/Identity moved to the top bar
            (App.tsx's app-topbar), but these two stay here: neither is
            "always visible, every view" chrome the way vault/identity are,
            they're closer in kind to the nav items just above them. */}
        <div className="sidebar-bottom">
          <button onClick={() => setSettingsPanelOpen(true)} title="Settings">
            <SettingsIcon size={17} />
            <span>Settings</span>
          </button>
          {!IS_TAURI && !shareToken && authStatus && (
            <button
              className={authStatus.user ? "active" : ""}
              onClick={() => setWorkspacePanelOpen(true)}
              title={
                authStatus.configured
                  ? authStatus.user?.role === "admin"
                    ? "Manage workspace members"
                    : "Workspace"
                  : "Set up team access"
              }
            >
              <Users size={17} />
              <span>
                {authStatus.configured
                  ? authStatus.user
                    ? `${authStatus.user.name} (${authStatus.user.role})`
                    : "Workspace"
                  : "Set up team access"}
              </span>
            </button>
          )}
        </div>
        <div className="sidebar-version">Satori v{APP_VERSION}{IS_TAURI ? "" : " · web"}</div>
      </aside>
      <main className={`editor-pane ${rightPanelCollapsed ? "right-panel-collapsed" : ""}`}>
        {showGraph ? (
          <GraphView activePath={activePath} onNavigate={openNote} />
        ) : showTable ? (
          <TableView notes={displayedNotes} onNavigate={openNote} onNotesChanged={loadNotes} shareToken={shareToken} />
        ) : showCalendar ? (
          // Deliberately the full vault, not displayedNotes — a calendar's
          // whole point is aggregating across whatever's dated regardless
          // of the sidebar's current type filter, unlike Table view which
          // is meant to reflect "whatever you've already narrowed to".
          <CalendarView notes={notes} onNavigate={openNote} />
        ) : showFlashcards ? (
          <FlashcardReview shareToken={shareToken} onCreateNew={onNewFlashcard} />
        ) : showJournal ? (
          <JournalView
            notes={notes}
            onNavigate={(path, title, type) => openNote(path, title, type)}
            onWriteToday={onDailyNote}
            shareToken={shareToken}
          />
        ) : role === "denied" ? (
          <div className="access-denied">
            This share link is invalid or has been revoked — you don't have access to this note.
          </div>
        ) : activePath && localSession ? (
          <>
            {isCanvas ? (
              <Suspense fallback={<div className="canvas-loading">Loading canvas…</div>}>
                <CanvasNote key={activePath} raw={raw} ytext={localSession.ytext} dark={isDarkTheme(themeId)} />
              </Suspense>
            ) : isOutline ? (
              <>
                <BlockOutline key={activePath} raw={raw} ytext={localSession.ytext} notes={notes} />
                <div className="backlinks-panel">
                  <div className="backlinks-header">Backlinks</div>
                  <Backlinks path={activePath} onNavigate={openNote} shareToken={shareToken} />
                </div>
                {!IS_TAURI && (
                  <div className="backlinks-panel">
                    <div className="backlinks-header">Related</div>
                    <RelatedNotes path={activePath} onNavigate={openNote} shareToken={shareToken} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={`editor-body view-${viewMode}`}>
                  {viewMode !== "preview" && (
                    <div className="editor-source">
                      <Editor
                        key={activePath}
                        ref={editorRef}
                        ytext={localSession.ytext}
                        awareness={localSession.awareness}
                        readOnly={role === "view" || role === "comment" || cloudSessionRole === "view"}
                        dark={isDarkTheme(themeId)}
                        scrollToOffset={scrollToOffset}
                        commentRanges={commentRanges}
                        spellcheckMode={spellcheckMode}
                        liveFormatting={viewMode === "live"}
                        onCommentOnSelection={
                          role !== "view"
                            ? (from, to) => {
                                setPendingCommentAnchor({ from, to });
                                // The Comments accordion auto-opens itself
                                // (CommentsPanel.tsx), but that's invisible
                                // if the right panel it lives in is still
                                // collapsed (the default) — has to actually
                                // be on screen for "click Comment, type,
                                // Post" to work as one continuous action.
                                setRightPanelCollapsed(false);
                              }
                            : undefined
                        }
                      />
                    </div>
                  )}
                  {viewMode === "preview" && (
                    <div className="editor-preview">
                      <Preview
                        raw={raw}
                        notes={notes}
                        // Not just onNavigate={openNote} — Preview's
                        // onNavigate is (path, fragment?), but openNote's
                        // 2nd positional param is knownTitle, not fragment.
                        // Passing openNote directly would silently land a
                        // clicked link's fragment in the wrong parameter.
                        onNavigate={(path, fragment) => openNote(path, undefined, undefined, fragment)}
                        shareToken={shareToken}
                        ytext={localSession.ytext}
                        readOnly={role === "view" || role === "comment" || cloudSessionRole === "view"}
                        notePath={activePath}
                        noteTitle={activeNote?.title ?? activePath}
                      />
                    </div>
                  )}
                </div>
                <div className="backlinks-panel">
                  <div className="backlinks-header">Backlinks</div>
                  <Backlinks path={activePath} onNavigate={openNote} shareToken={shareToken} />
                </div>
                {/* Local-embeddings-based, Node/browser only for now — see
                    fetchRelated's doc comment in api.ts. Hidden entirely
                    in the native app rather than showing a panel that can
                    structurally never have anything in it. */}
                {!IS_TAURI && (
                  <div className="backlinks-panel">
                    <div className="backlinks-header">Related</div>
                    <RelatedNotes path={activePath} onNavigate={openNote} shareToken={shareToken} />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            <FileText size={36} className="empty-state-icon" aria-hidden="true" />
            <p className="empty-state-title">No note open</p>
            <p className="empty-state-hint">Pick one from the sidebar, or start a new one.</p>
            {!shareToken && (
              <button className="btn-primary" onClick={onNewNote}>
                + New Note
              </button>
            )}
          </div>
        )}
      </main>
      {isListView && role !== "denied" && activePath && localSession && (
        <>
          {/* Mirrors the left sidebar-rail's visual language — a real
              flex child, always visible, rather than a floating overlay
              button. Properties/Comments/History still all show together
              when open (an accordion, not separate views the way the
              left rail's icons are), so there's no per-icon active state
              to track here; every icon just opens the panel if it's
              collapsed, or collapses it if it's already open — the same
              "one gesture, in the same reachable place either way"
              simplicity the left rail's click-to-toggle has. */}
          <nav className="right-panel-rail">
            <button onClick={toggleRightPanelCollapsed} title={rightPanelCollapsed ? "Show properties" : "Hide properties"}>
              <SlidersHorizontal size={18} />
            </button>
            <button onClick={toggleRightPanelCollapsed} title={rightPanelCollapsed ? "Show comments" : "Hide comments"}>
              <MessageSquare size={18} />
            </button>
            <button onClick={toggleRightPanelCollapsed} title={rightPanelCollapsed ? "Show history" : "Hide history"}>
              <History size={18} />
            </button>
          </nav>
          <aside
            className={`right-panel ${rightPanelCollapsed ? "collapsed" : ""} ${rightPanelResize.resizing ? "resizing" : ""}`}
            style={rightPanelCollapsed ? undefined : { width: rightPanelResize.width }}
          >
            {!rightPanelCollapsed && (
              <div
                className={`resize-handle resize-handle-right ${rightPanelResize.resizing ? "resizing" : ""}`}
                onMouseDown={rightPanelResize.onHandleMouseDown}
              />
            )}
            <PropertiesPanel raw={raw} ytext={localSession.ytext} readOnly={role === "view" || role === "comment"} />
            <CommentsPanel
              path={activePath}
              canComment={role !== "view"}
              shareToken={shareToken}
              ytext={localSession.ytext}
              pendingAnchor={pendingCommentAnchor}
              onPendingAnchorConsumed={() => setPendingCommentAnchor(null)}
              onRangesResolved={setCommentRanges}
              onExcerptClick={setScrollToOffset}
            />
            <HistoryPanel path={activePath} shareToken={shareToken} />
          </aside>
        </>
      )}
      </div>
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
