import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { listNoteFiles, readNoteRaw, parseNote } from "./vault.js";

const INDEX_DIR = path.resolve(process.cwd(), ".pkm");
const INDEX_PATH = path.join(INDEX_DIR, "index.sqlite");

fs.mkdirSync(INDEX_DIR, { recursive: true });

export const db = new Database(INDEX_PATH);
db.pragma("journal_mode = WAL");

// This index is a rebuildable cache over the markdown files in vault/ —
// the markdown files remain the source of truth. See rebuildIndex().
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    path UNINDEXED,
    title,
    body,
    tokenize = 'porter unicode61'
  );
`);

function deleteFromIndex(relPath: string) {
  db.prepare("DELETE FROM notes WHERE path = ?").run(relPath);
  db.prepare("DELETE FROM notes_fts WHERE path = ?").run(relPath);
}

function insertIntoIndex(relPath: string) {
  const raw = readNoteRaw(relPath);
  const { meta, body } = parseNote(relPath, raw);
  db.prepare(
    "INSERT INTO notes (path, title, tags, updated_at) VALUES (?, ?, ?, ?)"
  ).run(meta.path, meta.title, JSON.stringify(meta.tags), meta.updatedAt);
  db.prepare("INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)").run(
    meta.path,
    meta.title,
    body
  );
}

export function upsertNoteIndex(relPath: string): void {
  const tx = db.transaction(() => {
    deleteFromIndex(relPath);
    insertIntoIndex(relPath);
  });
  tx();
}

export function removeNoteIndex(relPath: string): void {
  deleteFromIndex(relPath);
}

export function rebuildIndex(): { count: number } {
  const files = listNoteFiles();
  const tx = db.transaction(() => {
    db.exec("DELETE FROM notes; DELETE FROM notes_fts;");
    for (const f of files) insertIntoIndex(f);
  });
  tx();
  return { count: files.length };
}

export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  updatedAt: number;
}

export function listNotesFromIndex(): NoteListItem[] {
  const rows = db
    .prepare(
      "SELECT path, title, tags, updated_at as updatedAt FROM notes ORDER BY updated_at DESC"
    )
    .all() as { path: string; title: string; tags: string; updatedAt: number }[];
  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
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
