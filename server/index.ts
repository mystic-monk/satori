import express from "express";
import { createServer } from "node:http";
import {
  listNoteFiles,
  readNoteRaw,
  writeNoteRaw,
  deleteNote,
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
} from "./db.js";
import { setupCollabServer, closeRoom } from "./collab.js";
import { setupRelayServer } from "./relay.js";

const app = express();
app.use(express.json());

// The SQLite index is a cache. If it's empty but the vault has notes (e.g.
// the .pkm/ cache dir was deleted, or this is a fresh clone), rebuild it.
if (listNotesFromIndex().length === 0 && listNoteFiles().length > 0) {
  rebuildIndex();
}

app.get("/api/notes", (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  res.json(listNotesFromIndex(type));
});

app.get("/api/types", (_req, res) => {
  res.json(listTypes());
});

app.get("/api/links", (_req, res) => {
  res.json(getAllLinks());
});

app.get("/api/backlinks/*", (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  res.json(getBacklinks(relPath));
});

app.get("/api/notes/*", (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  try {
    const raw = readNoteRaw(relPath);
    res.json({ path: relPath, raw });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.put("/api/notes/*", (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  const { raw } = req.body as { raw: string };
  writeNoteRaw(relPath, raw);
  upsertNoteIndex(relPath);
  res.json({ ok: true });
});

app.post("/api/notes", (req, res) => {
  const { path: relPath, raw } = req.body as { path: string; raw: string };
  writeNoteRaw(relPath, raw);
  upsertNoteIndex(relPath);
  res.json({ ok: true, path: relPath });
});

app.delete("/api/notes/*", (req, res) => {
  const relPath = (req.params as Record<string, string>)[0];
  deleteNote(relPath);
  removeNoteIndex(relPath);
  closeRoom(relPath);
  res.json({ ok: true });
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q ?? "");
  res.json(searchNotes(q));
});

app.post("/api/reindex", (_req, res) => {
  res.json(rebuildIndex());
});

const PORT = 3001;
const httpServer = createServer(app);
setupCollabServer(httpServer);
setupRelayServer(httpServer);
httpServer.listen(PORT, () => {
  console.log(`pkm server listening on http://localhost:${PORT}`);
});
