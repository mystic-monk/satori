import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "node:http";
import {
  listNoteFiles,
  readNoteRaw,
  writeNoteRaw,
  deleteNote,
  seedStarterVaultIfEmpty,
} from "./vault.js";
import {
  rebuildIndex,
  upsertNoteIndex,
  removeNoteIndex,
  listNotesFromIndex,
  searchNotes,
  listTypes,
  getBacklinks,
  getAllLinks,
  createShare,
  listShares,
  revokeShare,
  getHistory,
  resolveShareRole,
  getDueCards,
  recordCardReview,
  addComment,
  getComments,
  type ShareRole,
} from "./db.js";
import type { Rating } from "./srs.js";
import { setupCollabServer, closeRoom } from "./collab.js";
import { setupRelayServer } from "./relay.js";

const app = express();
app.use(express.json());

// A genuinely empty vault/ (first run, fresh clone) gets seeded with the
// bundled tutorial before anything else — see seedStarterVaultIfEmpty's
// doc comment for why this is safe to always call unconditionally.
seedStarterVaultIfEmpty();

// The SQLite index is a cache. If it's empty but the vault has notes (e.g.
// the .pkm/ cache dir was deleted, or this is a fresh clone), rebuild it.
if (listNotesFromIndex().length === 0 && listNoteFiles().length > 0) {
  rebuildIndex();
}

// The REST API mirrors server/collab.ts's role enforcement, which only
// ever guarded the WebSocket path — these HTTP routes had no auth at all,
// so a "view"-only share token (or none) could PUT/DELETE any note via
// curl. Every route below is now guarded to match its actual sensitivity:
// vault-wide operations (list/search/reindex/share management) require no
// token at all — i.e. only the local app itself, never a share
// recipient — and per-note reads/writes resolve the token's role for
// that specific path via db.ts's resolveShareRole (fail-closed since the
// P0 fix there: an unresolvable token is "denied", never "owner").
function tokenFrom(req: Request): string | null {
  return typeof req.query.token === "string" ? req.query.token : null;
}

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (tokenFrom(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireNoteRead(req: Request, res: Response, next: NextFunction) {
  const relPath = (req.params as Record<string, string>)[0];
  if (resolveShareRole(relPath, tokenFrom(req)) === "denied") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireNoteWrite(req: Request, res: Response, next: NextFunction) {
  const relPath = (req.params as Record<string, string>)[0];
  const role = resolveShareRole(relPath, tokenFrom(req));
  if (role !== "owner" && role !== "edit") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// "comment" grants the ability to post a comment (not edit note content),
// so this is deliberately its own gate rather than reusing
// requireNoteWrite — the one role that role actually exists for.
function requireNoteComment(req: Request, res: Response, next: NextFunction) {
  const relPath = (req.params as Record<string, string>)[0];
  const role = resolveShareRole(relPath, tokenFrom(req));
  if (role !== "owner" && role !== "edit" && role !== "comment") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// Deliberately NOT requireOwner: the client's wikilink/transclusion
// resolver (Preview.tsx's buildResolver) needs the {path, title} list to
// resolve [[refs]] even for a guest viewing a shared note — this only
// leaks note existence/title/type, not body content. Actual content stays
// gated per-path by requireNoteRead below.
app.get("/api/notes", (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  res.json(listNotesFromIndex(type));
});

app.get("/api/types", (_req, res) => {
  res.json(listTypes());
});

app.get("/api/links", requireOwner, (_req, res) => {
  res.json(getAllLinks());
});

app.get("/api/backlinks/*", requireNoteRead, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(getBacklinks(relPath));
});

app.get("/api/notes/*", requireNoteRead, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  try {
    const raw = readNoteRaw(relPath);
    res.json({ path: relPath, raw });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.put("/api/notes/*", requireNoteWrite, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  const { raw } = req.body as { raw: string };
  writeNoteRaw(relPath, raw);
  upsertNoteIndex(relPath);
  res.json({ ok: true });
});

app.post("/api/notes", requireOwner, (req, res) => {
  const { path: relPath, raw } = req.body as { path: string; raw: string };
  writeNoteRaw(relPath, raw);
  upsertNoteIndex(relPath);
  res.json({ ok: true, path: relPath });
});

app.delete("/api/notes/*", requireNoteWrite, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  deleteNote(relPath);
  removeNoteIndex(relPath);
  closeRoom(relPath);
  res.json({ ok: true });
});

// Not guarded: this is the mechanism a share recipient uses to find out
// what role their token grants in the first place — it must be callable
// with a token that turns out to be invalid (the response IS "denied").
app.get("/api/role/*", (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json({ role: resolveShareRole(relPath, tokenFrom(req)) });
});

const SHARE_ROLES: ShareRole[] = ["view", "comment", "edit"];

app.post("/api/share", requireOwner, (req, res) => {
  const { path: relPath, role, label } = req.body as { path: string; role: ShareRole; label?: string };
  if (!SHARE_ROLES.includes(role)) {
    res.status(400).json({ error: "invalid role" });
    return;
  }
  res.json(createShare(relPath, role, label?.trim() || role));
});

app.get("/api/shares/*", requireOwner, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(listShares(relPath));
});

app.delete("/api/share/:token", requireOwner, (req, res) => {
  revokeShare(req.params.token);
  res.json({ ok: true });
});

app.get("/api/history/*", requireNoteRead, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(getHistory(relPath));
});

// Anyone who can read the note can read its discussion (matches history's
// gating); posting needs at least the "comment" role — see
// requireNoteComment above for why that's not requireNoteWrite.
app.get("/api/comments/*", requireNoteRead, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(getComments(relPath));
});

app.post("/api/comments/*", requireNoteComment, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  const { body, authorId, authorName } = req.body as { body: string; authorId: string | null; authorName: string };
  const trimmed = body?.trim();
  if (!trimmed) {
    res.status(400).json({ error: "empty comment" });
    return;
  }
  res.json(addComment(relPath, authorId ?? null, authorName?.trim() || "Anonymous", trimmed));
});

app.get("/api/search", requireOwner, (req, res) => {
  const q = String(req.query.q ?? "");
  res.json(searchNotes(q));
});

app.post("/api/reindex", requireOwner, (_req, res) => {
  res.json(rebuildIndex());
});

// Flashcard review — owner-only like every other vault-wide surface
// (reviewing/scheduling cards across the whole vault isn't something a
// share-link guest scoped to one note should touch).
app.get("/api/flashcards/due", requireOwner, (_req, res) => {
  res.json(getDueCards());
});

app.post("/api/flashcards/review", requireOwner, (req, res) => {
  const { path: relPath, rating } = req.body as { path: string; rating: Rating };
  if (!["again", "hard", "good", "easy"].includes(rating)) {
    res.status(400).json({ error: "invalid rating" });
    return;
  }
  recordCardReview(relPath, rating);
  res.json({ ok: true });
});

const PORT = 3001;
const httpServer = createServer(app);
setupCollabServer(httpServer);
setupRelayServer(httpServer);
httpServer.listen(PORT, () => {
  console.log(`pkm server listening on http://localhost:${PORT}`);
});
