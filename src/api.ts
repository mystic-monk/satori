import { IS_TAURI, invoke } from "./platform";

export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  type: string | null;
  updatedAt: number;
  favorite: boolean;
  properties: Record<string, unknown>;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface BacklinkItem {
  path: string;
  title: string;
  embed: boolean;
}

export interface LinkEdge {
  source: string;
  target: string;
  embed: boolean;
}

export type ShareRole = "view" | "comment" | "edit";

export type ShareScope = "note" | "project";

export interface Share {
  token: string;
  path: string;
  role: ShareRole;
  label: string;
  createdAt: number;
  scope: ShareScope;
}

export interface AuthorRef {
  id: string | null;
  name: string;
}

export interface HistoryEntry {
  at: number;
  authors: AuthorRef[];
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function withToken(url: string, token: string | null | undefined): string {
  return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
}

export async function fetchNotes(type?: string): Promise<NoteListItem[]> {
  if (IS_TAURI) return invoke("list_notes", { typeFilter: type ?? null });
  const res = await fetch(type ? `/api/notes?type=${encodeURIComponent(type)}` : "/api/notes");
  return res.json();
}

export async function fetchTypes(): Promise<{ type: string; count: number }[]> {
  if (IS_TAURI) return invoke("list_types");
  const res = await fetch("/api/types");
  return res.json();
}

export async function fetchBacklinks(p: string, token?: string | null): Promise<BacklinkItem[]> {
  if (IS_TAURI) return invoke("get_backlinks", { path: p });
  const res = await fetch(withToken(`/api/backlinks/${encodePath(p)}`, token));
  return res.json();
}

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
}

// Deliberate v1 scope cut: local embeddings (fastembed, ONNX-via-WASM)
// only exist on the Node/browser side so far — the Tauri equivalent
// needs a Rust ML inference crate (candle) and a bundled model, real
// scope on its own, not yet built. Returns [] rather than a Tauri
// invoke() call that doesn't exist; the Related panel just renders
// nothing extra in the native app for now instead of erroring.
export async function fetchRelated(p: string, token?: string | null): Promise<SimilarNote[]> {
  if (IS_TAURI) return [];
  const res = await fetch(withToken(`/api/related/${encodePath(p)}`, token));
  return res.json();
}

export async function fetchLinks(): Promise<LinkEdge[]> {
  if (IS_TAURI) return invoke("get_links");
  const res = await fetch("/api/links");
  return res.json();
}

export async function fetchNote(p: string, token?: string | null): Promise<{ path: string; raw: string }> {
  if (IS_TAURI) return invoke("read_note", { path: p });
  const res = await fetch(withToken(`/api/notes/${encodePath(p)}`, token));
  if (!res.ok) throw new Error("not found");
  return res.json();
}

// Was originally only used by the Tauri-mode local editing session
// (src/collab.ts) — the browser deployment normally persists edits
// through the CRDT collab server instead of PUT-ing raw content directly.
// Now also used by App.tsx's toggleFavorite() for a frontmatter-only edit
// on a note that isn't necessarily the currently-open one, in either
// deployment — so `token` has to be forwarded on the browser path (fixed
// here) rather than always omitted: without it, requireNoteWrite
// (server/index.ts) sees no token and resolves the request as owner
// regardless of who's actually calling, exactly the "no token = owner"
// gap documented in server/db.ts's resolveShareRole — a "view"-only guest
// couldn't reach this code path today (the UI already hides write actions
// from them), but the underlying call must still carry a real token so a
// role check downstream has something to check against. `author` is only
// meaningful on the Tauri path, where write_note also logs it to History.
export async function writeNoteApi(
  p: string,
  raw: string,
  author: { id: string; name: string },
  token?: string | null
): Promise<void> {
  if (IS_TAURI) {
    await invoke("write_note", { path: p, raw, authorId: author.id, authorName: author.name });
    return;
  }
  const res = await fetch(withToken(`/api/notes/${encodePath(p)}`, token), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  // fetch() only rejects on a network failure, never on a 4xx/5xx status —
  // without this check, a 403 from requireNoteWrite (server/index.ts)
  // would resolve as if the write succeeded, silently discarding the edit.
  if (!res.ok) throw new Error(`failed to save note: ${res.status}`);
}

export async function createNote(p: string, raw: string): Promise<void> {
  if (IS_TAURI) {
    await invoke("create_note", { path: p, raw });
    return;
  }
  await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: p, raw }),
  });
}

export async function deleteNoteApi(p: string): Promise<void> {
  if (IS_TAURI) {
    await invoke("delete_note", { path: p });
    return;
  }
  await fetch(`/api/notes/${encodePath(p)}`, { method: "DELETE" });
}

export async function search(q: string): Promise<SearchResult[]> {
  if (IS_TAURI) return invoke("search_notes", { query: q });
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function reindex(): Promise<{ count: number }> {
  if (IS_TAURI) return invoke("reindex");
  const res = await fetch("/api/reindex", { method: "POST" });
  return res.json();
}

export async function fetchRole(p: string, token: string | null): Promise<ShareRole | "owner" | "denied"> {
  if (IS_TAURI) return invoke("resolve_role", { path: p, token });
  const res = await fetch(`/api/role/${encodePath(p)}${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  const data = await res.json();
  return data.role;
}

export async function createShare(p: string, role: ShareRole, label: string, scope: ShareScope = "note"): Promise<Share> {
  if (IS_TAURI) return invoke("create_share", { path: p, role, label, scope });
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: p, role, label, scope }),
  });
  return res.json();
}

export async function fetchShares(p: string): Promise<Share[]> {
  if (IS_TAURI) return invoke("list_shares", { path: p });
  const res = await fetch(`/api/shares/${encodePath(p)}`);
  return res.json();
}

export async function revokeShareApi(token: string): Promise<void> {
  if (IS_TAURI) {
    await invoke("revoke_share", { token });
    return;
  }
  await fetch(`/api/share/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export async function fetchHistory(p: string, token?: string | null): Promise<HistoryEntry[]> {
  if (IS_TAURI) return invoke("get_history", { path: p });
  const res = await fetch(withToken(`/api/history/${encodePath(p)}`, token));
  return res.json();
}

export interface Comment {
  id: string;
  path: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: number;
  // Opaque base64-encoded Y.RelativePosition bytes (src/yjsAnchor.ts) —
  // both present or both null. Neither the server nor the Tauri backend
  // interpret these; only decoded client-side, against whichever Y.Doc is
  // currently open for this note.
  anchorStart: string | null;
  anchorEnd: string | null;
}

// What the "comment" share role actually grants — see SharePanel.tsx and
// the requireNoteComment gate in server/index.ts.
export async function fetchComments(p: string, token?: string | null): Promise<Comment[]> {
  if (IS_TAURI) return invoke("get_comments", { path: p });
  const res = await fetch(withToken(`/api/comments/${encodePath(p)}`, token));
  return res.json();
}

export async function postComment(
  p: string,
  body: string,
  authorId: string | null,
  authorName: string,
  token?: string | null,
  anchorStart?: string | null,
  anchorEnd?: string | null
): Promise<Comment> {
  if (IS_TAURI) {
    return invoke("add_comment", { path: p, authorId, authorName, body, anchorStart: anchorStart ?? null, anchorEnd: anchorEnd ?? null });
  }
  const res = await fetch(withToken(`/api/comments/${encodePath(p)}`, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, authorId, authorName, anchorStart: anchorStart ?? null, anchorEnd: anchorEnd ?? null }),
  });
  if (!res.ok) throw new Error(`failed to post comment: ${res.status}`);
  return res.json();
}

// Tauri only — browser mode has no multi-vault concept, the vault is fixed
// to wherever the dev/prod server process runs.
export async function fetchVaultInfo(): Promise<{ name: string }> {
  return invoke("get_vault_info");
}

export async function switchVault(): Promise<void> {
  await invoke("switch_vault");
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

// Tauri only, same reason as fetchVaultInfo/switchVault — native folder
// picking has no browser equivalent here. Copies recognized files
// (.md/.txt/.json — see src-tauri/src/import.rs) from a picked folder
// into this vault's imported/ subfolder; never touches the source.
export async function importFolder(): Promise<ImportSummary> {
  return invoke("import_folder");
}

// Tauri-only native equivalents for src/export.ts — see
// src-tauri/src/commands.rs's save_export_file/print_current_window for
// why the browser-only <a download> / window.open()+print() tricks don't
// work in the native app's WebKit runtime. Returns false if the user
// cancels the save dialog (not an error).
export async function saveExportFile(
  defaultName: string,
  content: string,
  filterName: string,
  filterExt: string
): Promise<boolean> {
  return invoke("save_export_file", { defaultName, content, filterName, filterExt });
}

export async function printCurrentWindow(): Promise<void> {
  await invoke("print_current_window");
}

// Tauri-only, same convention as saveExportFile above — the caller
// (App.tsx's onImportBib) checks IS_TAURI and uses a plain <input
// type="file"> for the browser deployment instead, since there's no
// native picker to invoke there.
export async function pickBibFile(): Promise<string | null> {
  return invoke("pick_bib_file");
}

export type Rating = "again" | "hard" | "good" | "easy";

export interface DueCard {
  path: string;
  title: string;
}

// Owner-only, same as reindex/search — see the requireOwner guard on
// these routes in server/index.ts.
export async function fetchDueCards(): Promise<DueCard[]> {
  if (IS_TAURI) return invoke("get_due_cards");
  const res = await fetch("/api/flashcards/due");
  return res.json();
}

export async function reviewCard(path: string, rating: Rating): Promise<void> {
  if (IS_TAURI) {
    await invoke("record_card_review", { path, rating });
    return;
  }
  await fetch("/api/flashcards/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, rating }),
  });
}

// Server/browser deployment only — Tauri doesn't run server/ at all, so
// there's nothing reachable to subscribe a calendar app to (see
// SettingsPanel.tsx, which hides this section entirely in Tauri rather
// than calling these and getting a confusing failure).
export async function fetchCalendarFeedToken(): Promise<string> {
  const res = await fetch("/api/calendar-feed-token");
  return (await res.json()).token;
}

export async function regenerateCalendarFeedToken(): Promise<string> {
  const res = await fetch("/api/calendar-feed-token/regenerate", { method: "POST" });
  return (await res.json()).token;
}
