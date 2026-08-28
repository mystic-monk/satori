import { IS_TAURI, invoke } from "./platform";

export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  type: string | null;
  updatedAt: number;
  favorite: boolean;
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

export interface Share {
  token: string;
  path: string;
  role: ShareRole;
  label: string;
  createdAt: number;
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
  await fetch(withToken(`/api/notes/${encodePath(p)}`, token), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
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

export async function createShare(p: string, role: ShareRole, label: string): Promise<Share> {
  if (IS_TAURI) return invoke("create_share", { path: p, role, label });
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: p, role, label }),
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

// Tauri only — browser mode has no multi-vault concept, the vault is fixed
// to wherever the dev/prod server process runs.
export async function fetchVaultInfo(): Promise<{ name: string }> {
  return invoke("get_vault_info");
}

export async function switchVault(): Promise<void> {
  await invoke("switch_vault");
}
