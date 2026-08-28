import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { listNoteFiles, readNoteRaw, parseNote } from "./vault.js";
import { extractWikilinkRefs } from "../shared/wikilinks.js";

const INDEX_DIR = path.resolve(process.cwd(), ".pkm");
const INDEX_PATH = path.join(INDEX_DIR, "index.sqlite");

// Genuine app state — who's been granted access, a log of past saves —
// with no representation in the plaintext markdown, so it can't be
// rebuilt the way notes/notes_fts/links can. Deliberately a separate file
// in a separate, differently-named directory from the .pkm/ cache: the
// whole point is that deleting .pkm/ (which the app itself invites, both
// via the Reindex button and the tutorial note's own "delete it any time"
// text) must never silently discard sharing config or history.
const STATE_DIR = path.resolve(process.cwd(), ".pkm-state");
const STATE_PATH = path.join(STATE_DIR, "state.sqlite");

fs.mkdirSync(INDEX_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

export const db = new Database(INDEX_PATH);
db.pragma("journal_mode = WAL");

export const stateDb = new Database(STATE_PATH);
stateDb.pragma("journal_mode = WAL");

// This index is a rebuildable cache over the markdown files in vault/ —
// the markdown files remain the source of truth. See rebuildIndex().
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT NOT NULL,
    type TEXT,
    properties TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    path UNINDEXED,
    title,
    body,
    tokenize = 'porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS links (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    embed INTEGER NOT NULL,
    UNIQUE(source, target, embed)
  );
  CREATE INDEX IF NOT EXISTS links_source ON links(source);
  CREATE INDEX IF NOT EXISTS links_target ON links(target);
`);

stateDb.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    role TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shares_path ON shares(path);

  CREATE TABLE IF NOT EXISTS history (
    path TEXT NOT NULL,
    at INTEGER NOT NULL,
    authors TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS history_path ON history(path);
`);

function deleteFromIndex(relPath: string) {
  db.prepare("DELETE FROM notes WHERE path = ?").run(relPath);
  db.prepare("DELETE FROM notes_fts WHERE path = ?").run(relPath);
}

function insertIntoIndex(relPath: string) {
  const raw = readNoteRaw(relPath);
  const { meta, body } = parseNote(relPath, raw);
  db.prepare(
    "INSERT INTO notes (path, title, tags, type, properties, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(meta.path, meta.title, JSON.stringify(meta.tags), meta.type, JSON.stringify(meta.properties), meta.updatedAt);
  db.prepare("INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)").run(
    meta.path,
    meta.title,
    body
  );
}

function buildResolutionMaps() {
  const all = listNotesFromIndex();
  return {
    byCleanPath: new Map(all.map((n) => [n.path.replace(/\.md$/, ""), n])),
    byTitle: new Map(all.map((n) => [n.title.toLowerCase(), n])),
  };
}

function resolveRefAgainst(
  ref: string,
  maps: ReturnType<typeof buildResolutionMaps>
): string | null {
  const clean = ref.replace(/\.md$/, "");
  return maps.byCleanPath.get(clean)?.path ?? maps.byTitle.get(ref.toLowerCase())?.path ?? null;
}

// Full rebuild: every note's [[refs]] can resolve by title, so a title
// change anywhere can change how OTHER notes' links resolve — this is the
// only case that genuinely needs the whole vault re-read. O(n) in note
// count and total vault size; only called on note creation or rename, not
// on every save.
function rebuildLinks(): void {
  const maps = buildResolutionMaps();
  const all = listNotesFromIndex();
  const tx = db.transaction(() => {
    db.exec("DELETE FROM links");
    const insert = db.prepare("INSERT OR IGNORE INTO links (source, target, embed) VALUES (?, ?, ?)");
    for (const note of all) {
      let raw: string;
      try {
        raw = readNoteRaw(note.path);
      } catch {
        continue;
      }
      const { body } = parseNote(note.path, raw);
      for (const { ref, embed } of extractWikilinkRefs(body)) {
        const target = resolveRefAgainst(ref, maps);
        if (target && target !== note.path) insert.run(note.path, target, embed ? 1 : 0);
      }
    }
  });
  tx();
}

// Common case: only this note's body changed, title didn't. Only this
// note's own outgoing links can have changed — nothing else in the vault
// depends on this note's body — so this reads exactly one file regardless
// of how large the vault is, instead of rebuildLinks()'s full rescan.
function updateOutgoingLinks(relPath: string): void {
  const maps = buildResolutionMaps();
  let raw: string;
  try {
    raw = readNoteRaw(relPath);
  } catch {
    return;
  }
  const { body } = parseNote(relPath, raw);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM links WHERE source = ?").run(relPath);
    const insert = db.prepare("INSERT OR IGNORE INTO links (source, target, embed) VALUES (?, ?, ?)");
    for (const { ref, embed } of extractWikilinkRefs(body)) {
      const target = resolveRefAgainst(ref, maps);
      if (target && target !== relPath) insert.run(relPath, target, embed ? 1 : 0);
    }
  });
  tx();
}

function getTitle(relPath: string): string | undefined {
  const row = db.prepare("SELECT title FROM notes WHERE path = ?").get(relPath) as
    | { title: string }
    | undefined;
  return row?.title;
}

export function upsertNoteIndex(relPath: string): void {
  const oldTitle = getTitle(relPath);
  const tx = db.transaction(() => {
    deleteFromIndex(relPath);
    insertIntoIndex(relPath);
  });
  tx();
  // A brand-new note (oldTitle undefined) needs the full rebuild too: it
  // may be the resolution target for [[refs]] in notes that already exist
  // and previously pointed at nothing.
  if (oldTitle !== getTitle(relPath)) {
    rebuildLinks();
  } else {
    updateOutgoingLinks(relPath);
  }
}

export function removeNoteIndex(relPath: string): void {
  deleteFromIndex(relPath);
  // This note's own outgoing links disappear with it; any other note's
  // link that targeted it becomes a dangling row pointing at a path no
  // longer in `notes` — harmless for getBacklinks() (joins against
  // notes), but getAllLinks() (the graph) returns raw rows, so clean up
  // both directions explicitly rather than leaving stale edges.
  db.prepare("DELETE FROM links WHERE source = ? OR target = ?").run(relPath, relPath);
}

export function rebuildIndex(): { count: number } {
  const files = listNoteFiles();
  const tx = db.transaction(() => {
    db.exec("DELETE FROM notes; DELETE FROM notes_fts;");
    for (const f of files) insertIntoIndex(f);
  });
  tx();
  rebuildLinks();
  return { count: files.length };
}

export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  type: string | null;
  updatedAt: number;
}

interface NoteRow {
  path: string;
  title: string;
  tags: string;
  type: string | null;
  updatedAt: number;
}

export function listNotesFromIndex(type?: string): NoteListItem[] {
  const rows = (
    type
      ? db
          .prepare(
            "SELECT path, title, tags, type, updated_at as updatedAt FROM notes WHERE type = ? ORDER BY updated_at DESC"
          )
          .all(type)
      : db
          .prepare(
            "SELECT path, title, tags, type, updated_at as updatedAt FROM notes ORDER BY updated_at DESC"
          )
          .all()
  ) as NoteRow[];
  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
}

export function listTypes(): { type: string; count: number }[] {
  return db
    .prepare("SELECT type, COUNT(*) as count FROM notes WHERE type IS NOT NULL GROUP BY type ORDER BY type")
    .all() as { type: string; count: number }[];
}

export function getProperties(relPath: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT properties FROM notes WHERE path = ?").get(relPath) as
    | { properties: string }
    | undefined;
  return row ? JSON.parse(row.properties) : null;
}

export interface BacklinkItem {
  path: string;
  title: string;
  embed: boolean;
}

export function getBacklinks(relPath: string): BacklinkItem[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT n.path as path, n.title as title, l.embed as embed
       FROM links l JOIN notes n ON n.path = l.source
       WHERE l.target = ?`
    )
    .all(relPath) as { path: string; title: string; embed: number }[];
  return rows.map((r) => ({ path: r.path, title: r.title, embed: Boolean(r.embed) }));
}

export interface LinkEdge {
  source: string;
  target: string;
  embed: boolean;
}

export function getAllLinks(): LinkEdge[] {
  const rows = db.prepare("SELECT source, target, embed FROM links").all() as {
    source: string;
    target: string;
    embed: number;
  }[];
  return rows.map((r) => ({ source: r.source, target: r.target, embed: Boolean(r.embed) }));
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string; // HTML, safe to render (escaped except for <mark> highlights)
}

// FTS5 MATCH syntax treats *, ", :, ( ) as special. Strip them and turn each
// remaining token into a prefix match so partial words work as-you-type.
function sanitizeFtsQuery(q: string): string {
  const cleaned = q.replace(/["*:()]/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .map((t) => `${t}*`)
    .join(" ");
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return s.replace(/[&<>"]/g, (c) => map[c]);
}

// snippet() wraps matches in plain-text sentinels (rather than real tags) so
// the whole snippet can be HTML-escaped first — note bodies are untrusted
// user text — before the sentinels are swapped for a real <mark> element.
const MARK_START = "PKMARK-START";
const MARK_END = "PKMARK-END";

function markify(snippet: string): string {
  return escapeHtml(snippet)
    .replaceAll(escapeHtml(MARK_START), "<mark>")
    .replaceAll(escapeHtml(MARK_END), "</mark>");
}

export function searchNotes(query: string): SearchResult[] {
  const fts = sanitizeFtsQuery(query);
  if (!fts) return [];
  const rows = db
    .prepare(
      `SELECT path, title, snippet(notes_fts, 2, ?, ?, '…', 12) as snippet
       FROM notes_fts WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT 50`
    )
    .all(MARK_START, MARK_END, fts) as { path: string; title: string; snippet: string }[];
  return rows.map((r) => ({ path: r.path, title: r.title, snippet: markify(r.snippet) }));
}

// ---- Access control ----
//
// Roles are enforced by the local collab server (server/collab.ts) dropping
// mutating Yjs messages from "view"/"comment" connections — real
// enforcement, not a UI-only restriction, because the local server already
// sees this note's plaintext (same trust boundary as the REST API). This is
// deliberately scoped to local/LAN sharing only: the cloud relay
// (server/relay.ts) can't enforce roles without decoding messages, which
// would break the "relay only ever sees ciphertext" privacy guarantee — see
// the note in relay.ts.

export type ShareRole = "view" | "comment" | "edit";

export interface Share {
  token: string;
  path: string;
  role: ShareRole;
  label: string;
  createdAt: number;
}

function randomToken(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

export function createShare(notePath: string, role: ShareRole, label: string): Share {
  const share: Share = { token: randomToken(), path: notePath, role, label, createdAt: Date.now() };
  stateDb.prepare("INSERT INTO shares (token, path, role, label, created_at) VALUES (?, ?, ?, ?, ?)").run(
    share.token,
    share.path,
    share.role,
    share.label,
    share.createdAt
  );
  return share;
}

export function listShares(notePath: string): Share[] {
  const rows = stateDb
    .prepare("SELECT token, path, role, label, created_at as createdAt FROM shares WHERE path = ? ORDER BY created_at DESC")
    .all(notePath) as Share[];
  return rows;
}

export function revokeShare(token: string): void {
  stateDb.prepare("DELETE FROM shares WHERE token = ?").run(token);
}

// No token at all means the request is the local app itself (the owner
// browsing their own vault) — that's the only case that defaults to
// "owner". A token that's present but doesn't resolve (wrong path,
// mistyped, revoked) must fail closed to "denied", never fall back to
// "owner" — the previous `row?.role ?? "owner"` fallback treated any
// unresolvable token as full owner access, silently defeating the entire
// share-role system for anyone who guessed or mistyped a token.
export function resolveShareRole(notePath: string, token: string | null): ShareRole | "owner" | "denied" {
  if (!token) return "owner";
  const row = stateDb.prepare("SELECT role FROM shares WHERE token = ? AND path = ?").get(token, notePath) as
    | { role: ShareRole }
    | undefined;
  return row?.role ?? "denied";
}

// ---- Change history ----
//
// Approximates "who changed what, when": logged whenever a note's CRDT
// state is persisted (server/collab.ts Room.persist()), recording which
// display names were connected — and therefore could have contributed —
// since the last save. Not per-keystroke attribution (that would need a
// CRDT-level authorship map), but enough to answer "who's been touching
// this note."

export interface AuthorRef {
  id: string | null; // stable identity id (src/identity.ts) — null for pre-Phase-A rows, or a
  // connection that somehow had no id at all
  name: string;
}

export function logHistory(notePath: string, authors: AuthorRef[]): void {
  if (authors.length === 0) return;
  stateDb.prepare("INSERT INTO history (path, at, authors) VALUES (?, ?, ?)").run(
    notePath,
    Date.now(),
    JSON.stringify(authors)
  );
}

export interface HistoryEntry {
  at: number;
  authors: AuthorRef[];
}

// `authors` rows written before the identity-id change are a bare
// string[] (display names only) — parsed defensively here rather than
// migrated, since there's no way to retroactively attach a stable id to a
// save that already happened. New rows are AuthorRef[].
export function getHistory(notePath: string): HistoryEntry[] {
  const rows = stateDb
    .prepare("SELECT at, authors FROM history WHERE path = ? ORDER BY at DESC LIMIT 50")
    .all(notePath) as { at: number; authors: string }[];
  return rows.map((r) => ({
    at: r.at,
    authors: (JSON.parse(r.authors) as (string | AuthorRef)[]).map((a) =>
      typeof a === "string" ? { id: null, name: a } : a
    ),
  }));
}
