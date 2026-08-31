import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { listNoteFiles, readNoteRaw, parseNote } from "./vault.js";
import { extractWikilinkRefs } from "../shared/wikilinks.js";
import { initialCardState, nextCardState, type CardState, type Rating } from "./srs.js";
import { icsCalendar, reminderVevent, timetableVevent } from "../shared/ics.js";
import { extractTimetableBlocks } from "../shared/timetable.js";

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

  -- A note's semantic embedding — rebuildable from its own content (same
  -- category as notes_fts, not app state), just expensive to recompute
  -- (a model inference call, not a cheap re-tokenize), so it's cached
  -- here rather than derived on every findSimilar() call.
  CREATE TABLE IF NOT EXISTS embeddings (
    path TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
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

  -- Spaced-repetition scheduling state (SM-2 — see srs.ts) for
  -- type:flashcard notes. Genuine app state, not derivable from the vault
  -- itself, so it lives here rather than in the rebuildable index.
  CREATE TABLE IF NOT EXISTS flashcard_reviews (
    path TEXT PRIMARY KEY,
    ease REAL NOT NULL,
    interval_days REAL NOT NULL,
    repetitions INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );

  -- A note's discussion thread — what the "comment" share role actually
  -- grants (previously that role existed in the UI but did nothing; see
  -- SharePanel.tsx). Append-only like history: no edit/delete for a first
  -- pass, same reasoning history already established for that tradeoff.
  -- anchor_start/anchor_end: base64-encoded Y.RelativePosition bytes (see
  -- src/yjsAnchor.ts), not raw character offsets — a plain offset pair
  -- would silently point at the wrong text the moment anyone edits earlier
  -- in the document. A relative position is resolved back into a live,
  -- drift-corrected offset against whatever the document currently looks
  -- like, by whichever client is displaying it — this server never
  -- interprets the bytes itself, same "opaque to us" posture as
  -- server/relay.ts's ciphertext. Both null means an unanchored,
  -- note-level comment — the only kind that existed before this.
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    author_id TEXT,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    anchor_start TEXT,
    anchor_end TEXT
  );
  CREATE INDEX IF NOT EXISTS comments_path ON comments(path);

  -- Team/Workspace v1 — real accounts, for the self-hosted server
  -- deployment only (Tauri's local vault stays single-owner, no
  -- accounts). Coarse, vault-wide roles, layered on top of — not
  -- replacing — the per-note shares table above: a workspace member has
  -- full read/write across the vault by default, same as today's
  -- implicit local "owner"; shares stays the tool for scoping one
  -- person (member or not) to just one note.
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    role TEXT NOT NULL,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  -- Same share-link UX pattern as the shares table above, just for
  -- standing workspace membership instead of one note: an admin
  -- generates one of these, hands it out-of-band, the recipient uses it
  -- once to set a name+password and become a member.
  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- One row, one long-lived secret: gates GET /api/calendar.ics, which a
  -- calendar app hits with a plain unauthenticated GET on its own polling
  -- schedule (it can't do the session-cookie/share-token dance every other
  -- route uses) — same "put a hard-to-guess token in the URL itself"
  -- pattern as per-note share links, just vault-wide instead of per-note.
  -- Regenerating replaces this row, invalidating every previously-copied
  -- feed URL at once, same revocation semantics DELETE /api/share/:token
  -- already has for one note.
  CREATE TABLE IF NOT EXISTS calendar_feed (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// CREATE TABLE IF NOT EXISTS above only defines the shape for a *fresh*
// database — it silently does nothing to a state.sqlite that already has a
// comments table from before anchor_start/anchor_end existed, which would
// otherwise break every comment insert with "no such column" the moment
// this shipped. No prior migration precedent existed in this file to
// follow (every schema change so far has been a whole new table); this is
// deliberately minimal rather than a general migration framework this
// project doesn't need yet.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = stateDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    stateDb.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("comments", "anchor_start", "anchor_start TEXT");
ensureColumn("comments", "anchor_end", "anchor_end TEXT");

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
  db.prepare("DELETE FROM embeddings WHERE path = ?").run(relPath);
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
  favorite: boolean;
  // Full frontmatter, not just the fields broken out above — powers
  // client-side filtering (src/noteQuery.ts: query blocks, table views,
  // template discovery) against arbitrary properties without a new
  // endpoint per feature. Already fetched for `favorite`'s derivation
  // below; exposing the rest costs nothing new.
  properties: Record<string, unknown>;
}

interface NoteRow {
  path: string;
  title: string;
  tags: string;
  type: string | null;
  updatedAt: number;
  properties: string;
}

function parseProperties(propertiesJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(propertiesJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function listNotesFromIndex(type?: string): NoteListItem[] {
  const rows = (
    type
      ? db
          .prepare(
            "SELECT path, title, tags, type, updated_at as updatedAt, properties FROM notes WHERE type = ? ORDER BY updated_at DESC"
          )
          .all(type)
      : db
          .prepare(
            "SELECT path, title, tags, type, updated_at as updatedAt, properties FROM notes ORDER BY updated_at DESC"
          )
          .all()
  ) as NoteRow[];
  return rows.map((r) => {
    const properties = parseProperties(r.properties);
    return {
      path: r.path,
      title: r.title,
      tags: JSON.parse(r.tags),
      type: r.type,
      updatedAt: r.updatedAt,
      // `favorite` isn't its own column — it's an ordinary frontmatter
      // property (see PropertiesPanel.tsx) — derived here rather than
      // requiring anything else to stay in sync with it.
      favorite: properties.favorite === true,
      properties,
    };
  });
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

// Title + body straight out of notes_fts (a plain SELECT works fine on an
// FTS5 table outside of MATCH) rather than re-reading the file — by the
// time this is called, upsertNoteIndex has already run for this save, so
// the index already has exactly the text worth embedding.
export function getIndexedText(relPath: string): string | null {
  const row = db.prepare("SELECT title, body FROM notes_fts WHERE path = ?").get(relPath) as
    | { title: string; body: string }
    | undefined;
  return row ? `${row.title}\n\n${row.body}` : null;
}

export function upsertEmbedding(relPath: string, vector: Float32Array): void {
  const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db.prepare(
    `INSERT INTO embeddings (path, vector, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`
  ).run(relPath, buf, Date.now());
}

function toFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
}

// Brute-force cosine similarity over every stored embedding — no ANN
// index needed at personal-vault scale (a few thousand notes is well
// within "fine to scan in memory", same reasoning already applied to
// Table view/query blocks elsewhere in this codebase). Returns [] for a
// note with no embedding yet (async generation hasn't caught up, or the
// note is brand new) rather than erroring — the caller just shows an
// empty Related panel until it's ready.
export function findSimilar(relPath: string, k = 5): SimilarNote[] {
  const target = db.prepare("SELECT vector FROM embeddings WHERE path = ?").get(relPath) as
    | { vector: Buffer }
    | undefined;
  if (!target) return [];
  const targetVec = toFloat32Array(target.vector);
  const rows = db
    .prepare(
      `SELECT e.path as path, n.title as title, e.vector as vector
       FROM embeddings e JOIN notes n ON n.path = e.path
       WHERE e.path != ?`
    )
    .all(relPath) as { path: string; title: string; vector: Buffer }[];
  return rows
    .map((r) => ({ path: r.path, title: r.title, score: cosineSimilarity(targetVec, toFloat32Array(r.vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
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

// ---- Comments ----

export interface Comment {
  id: string;
  path: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: number;
  // Opaque base64-encoded Y.RelativePosition bytes — see the comments
  // table's own doc comment above. Both present or both null; there's no
  // valid state with only one anchor end set.
  anchorStart: string | null;
  anchorEnd: string | null;
}

export function addComment(
  notePath: string,
  authorId: string | null,
  authorName: string,
  body: string,
  anchorStart: string | null = null,
  anchorEnd: string | null = null
): Comment {
  const comment: Comment = {
    id: randomUUID(),
    path: notePath,
    authorId,
    authorName,
    body,
    createdAt: Date.now(),
    anchorStart,
    anchorEnd,
  };
  stateDb
    .prepare(
      "INSERT INTO comments (id, path, author_id, author_name, body, created_at, anchor_start, anchor_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      comment.id,
      comment.path,
      comment.authorId,
      comment.authorName,
      comment.body,
      comment.createdAt,
      comment.anchorStart,
      comment.anchorEnd
    );
  return comment;
}

export function getComments(notePath: string): Comment[] {
  const rows = stateDb
    .prepare(
      "SELECT id, path, author_id as authorId, author_name as authorName, body, created_at as createdAt, anchor_start as anchorStart, anchor_end as anchorEnd FROM comments WHERE path = ? ORDER BY created_at ASC"
    )
    .all(notePath) as Comment[];
  return rows;
}

// ---- Flashcards / spaced repetition ----
//
// A note is a flashcard purely by convention: `type: flashcard`. Its
// content (front/back split) is read by the client (see
// shared/wikilinks.js's sibling pattern — actually src/FlashcardReview.tsx
// on the frontend, using the same splitFrontBack as srs.ts); this module
// only tracks *when* each card is next due.

export interface DueCard {
  path: string;
  title: string;
}

export function getDueCards(): DueCard[] {
  const now = Date.now();
  const flashcardNotes = db
    .prepare("SELECT path, title FROM notes WHERE type = 'flashcard'")
    .all() as DueCard[];
  const dueRows = stateDb.prepare("SELECT path, due_at as dueAt FROM flashcard_reviews").all() as {
    path: string;
    dueAt: number;
  }[];
  const dueMap = new Map(dueRows.map((r) => [r.path, r.dueAt]));
  // A card never reviewed has no row at all — due immediately, same as a
  // card whose due_at has already passed.
  return flashcardNotes.filter((n) => (dueMap.get(n.path) ?? 0) <= now);
}

export function recordCardReview(notePath: string, rating: Rating): void {
  const row = stateDb
    .prepare("SELECT ease, interval_days as intervalDays, repetitions FROM flashcard_reviews WHERE path = ?")
    .get(notePath) as CardState | undefined;
  const next = nextCardState(row ?? initialCardState(), rating);
  const now = Date.now();
  const dueAt = now + next.intervalDays * 24 * 60 * 60 * 1000;
  stateDb
    .prepare(
      `INSERT INTO flashcard_reviews (path, ease, interval_days, repetitions, due_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         ease = excluded.ease,
         interval_days = excluded.interval_days,
         repetitions = excluded.repetitions,
         due_at = excluded.due_at,
         reviewed_at = excluded.reviewed_at`
    )
    .run(notePath, next.ease, next.intervalDays, next.repetitions, dueAt, now);
}

// See calendar_feed's own doc comment above (near its CREATE TABLE) for
// why this is a single-row secret rather than per-note/per-user: a
// calendar app subscribing to this URL polls it directly, with no
// interactive login step to attach a session or share token to.
export function getOrCreateFeedToken(): string {
  const row = stateDb.prepare("SELECT token FROM calendar_feed WHERE id = 1").get() as { token: string } | undefined;
  if (row) return row.token;
  const token = randomToken();
  stateDb.prepare("INSERT INTO calendar_feed (id, token, created_at) VALUES (1, ?, ?)").run(token, Date.now());
  return token;
}

export function regenerateFeedToken(): string {
  const token = randomToken();
  stateDb
    .prepare(
      `INSERT INTO calendar_feed (id, token, created_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at`
    )
    .run(token, Date.now());
  return token;
}

export function isValidFeedToken(token: string): boolean {
  const row = stateDb.prepare("SELECT token FROM calendar_feed WHERE id = 1").get() as { token: string } | undefined;
  return !!row && row.token === token;
}

// Every remind_at across the vault, plus every ```timetable entry found by
// re-scanning each note's indexed body (the index only stores properties,
// not a structured view of body content — see shared/timetable.ts's
// extractTimetableBlocks doc comment). Rebuilt fresh on every request
// rather than cached: personal-vault scale, same "a plain scan is fine
// here" precedent as query blocks/rollups/related-notes.
export function buildCalendarFeedIcs(): string {
  const veventBlocks: string[] = [];

  const noteRows = db.prepare("SELECT path, title, properties FROM notes").all() as {
    path: string;
    title: string;
    properties: string;
  }[];
  for (const row of noteRows) {
    const remindAt = parseProperties(row.properties).remind_at;
    if (typeof remindAt === "string" && remindAt) {
      veventBlocks.push(reminderVevent({ path: row.path, title: row.title, remindAt }));
    }
  }

  const bodyRows = db.prepare("SELECT path, body FROM notes_fts").all() as { path: string; body: string }[];
  for (const row of bodyRows) {
    extractTimetableBlocks(row.body).forEach((entry, i) => veventBlocks.push(timetableVevent(row.path, entry, i)));
  }

  return icsCalendar(veventBlocks);
}
