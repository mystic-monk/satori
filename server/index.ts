import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
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
  findSimilar,
  getOrCreateFeedToken,
  regenerateFeedToken,
  isValidFeedToken,
  buildCalendarFeedIcs,
  type ShareRole,
} from "./db.js";
import type { Rating } from "./srs.js";
import { setupCollabServer, closeRoom } from "./collab.js";
import { setupRelayServer } from "./relay.js";
import { scheduleEmbeddingUpdate, scheduleEmbeddingUpdateAll } from "./embeddings.js";
import { hasOwnerAccess } from "./auth.js";
import { registerAuthRoutes, SESSION_COOKIE } from "./auth-routes.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
registerAuthRoutes(app);

// A genuinely empty vault/ (first run, fresh clone) gets seeded with the
// bundled tutorial before anything else — see seedStarterVaultIfEmpty's
// doc comment for why this is safe to always call unconditionally.
seedStarterVaultIfEmpty();

// The SQLite index is a cache. If it's empty but the vault has notes (e.g.
// the .pkm/ cache dir was deleted, or this is a fresh clone), rebuild it.
if (listNotesFromIndex().length === 0 && listNoteFiles().length > 0) {
  rebuildIndex();
  // Fire-and-forget — the server starts serving immediately; the Related
  // panel is just empty for each note until its embedding lands.
  scheduleEmbeddingUpdateAll();
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

function sessionTokenFrom(req: Request): string | null {
  return (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
}

// Wraps resolveShareRole so its own no-token→"owner" default is never
// reached once accounts exist — that fallback predates real accounts and
// would silently undo auth.ts's hasOwnerAccess tightening if a caller
// went around this.
function effectiveRole(req: Request, relPath: string): ShareRole | "owner" | "denied" {
  const token = tokenFrom(req);
  if (token) return resolveShareRole(relPath, token);
  return hasOwnerAccess(token, sessionTokenFrom(req)) ? "owner" : "denied";
}

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!hasOwnerAccess(tokenFrom(req), sessionTokenFrom(req))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireNoteRead(req: Request, res: Response, next: NextFunction) {
  const relPath = (req.params as Record<string, string>)[0];
  if (effectiveRole(req, relPath) === "denied") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireNoteWrite(req: Request, res: Response, next: NextFunction) {
  const relPath = (req.params as Record<string, string>)[0];
  const role = effectiveRole(req, relPath);
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
  const role = effectiveRole(req, relPath);
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

// Same read gating as backlinks — semantic neighbors are exactly as
// revealing as an explicit link would be, share-role-wise.
app.get("/api/related/*", requireNoteRead, (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(findSimilar(relPath, 5));
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
  scheduleEmbeddingUpdate(relPath);
  res.json({ ok: true });
});

app.post("/api/notes", requireOwner, (req, res) => {
  const { path: relPath, raw } = req.body as { path: string; raw: string };
  writeNoteRaw(relPath, raw);
  upsertNoteIndex(relPath);
  scheduleEmbeddingUpdate(relPath);
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
  res.json({ role: effectiveRole(req, relPath) });
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
  const { body, authorId, authorName, anchorStart, anchorEnd } = req.body as {
    body: string;
    authorId: string | null;
    authorName: string;
    anchorStart?: string | null;
    anchorEnd?: string | null;
  };
  const trimmed = body?.trim();
  if (!trimmed) {
    res.status(400).json({ error: "empty comment" });
    return;
  }
  res.json(
    addComment(relPath, authorId ?? null, authorName?.trim() || "Anonymous", trimmed, anchorStart ?? null, anchorEnd ?? null)
  );
});

app.get("/api/search", requireOwner, (req, res) => {
  const q = String(req.query.q ?? "");
  res.json(searchNotes(q));
});

app.post("/api/reindex", requireOwner, (_req, res) => {
  const result = rebuildIndex();
  scheduleEmbeddingUpdateAll();
  res.json(result);
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

// Owner-only, same as everything else vault-wide — this is what Settings
// reads to build/display the feed URL, not the feed itself (see
// GET /api/calendar.ics below, which is deliberately NOT behind
// requireOwner: a calendar app polling the URL has no session/cookie to
// present, only the token embedded in the URL itself).
app.get("/api/calendar-feed-token", requireOwner, (_req, res) => {
  res.json({ token: getOrCreateFeedToken() });
});

app.post("/api/calendar-feed-token/regenerate", requireOwner, (_req, res) => {
  res.json({ token: regenerateFeedToken() });
});

app.get("/api/calendar.ics", (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token || !isValidFeedToken(token)) {
    res.status(403).send("invalid or missing token");
    return;
  }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(buildCalendarFeedIcs());
});

// Render (and most PaaS hosts) assign the port at runtime via $PORT and
// require the app to bind to exactly that — hardcoding 3001 would make the
// service unreachable there while working fine locally, which is why this
// stayed hidden until an actual deploy was attempted. Falls back to 3001
// for local dev, where nothing sets PORT.
const PORT = Number(process.env.PORT) || 3001;
const httpServer = createServer(app);
setupCollabServer(httpServer);
setupRelayServer(httpServer);
httpServer.listen(PORT, () => {
  console.log(`pkm server listening on http://localhost:${PORT}`);
});
