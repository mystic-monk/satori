import path from "node:path";
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import { getIndexedText, upsertEmbedding, listNotesFromIndex } from "./db.js";

// fastembed defaults to a bare local_cache/ at cwd, which doesn't match
// this app's own dot-prefixed cache-directory convention (.pkm/,
// .pkm-state/) and would otherwise clutter a plain `ls` of the project
// root. Same cwd-relative reasoning as INDEX_DIR/STATE_DIR in db.ts —
// tucked inside .pkm/ since model weights are exactly the kind of
// re-downloadable cache that directory already exists for.
const MODEL_CACHE_DIR = path.resolve(process.cwd(), ".pkm", "models");

// Lazy singleton — first use downloads and loads the model (~90MB of
// ONNX weights, cached on disk after the first run), which isn't worth
// paying for at server startup if the Related Notes feature is never
// actually opened. Every note save just schedules an update through
// this; nothing here blocks the synchronous index-write path in db.ts,
// which is why scheduleEmbeddingUpdate below is fire-and-forget.
let modelPromise: ReturnType<typeof FlagEmbedding.init> | null = null;
function getModel() {
  if (!modelPromise) {
    modelPromise = FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2, cacheDir: MODEL_CACHE_DIR });
  }
  return modelPromise;
}

// Notes are always embedded as "passages" (fastembed's terminology) —
// even "what's related to this note" is a passage-to-passage comparison,
// not the asymmetric query-embedding case fastembed also supports (that
// would matter for a future "search by meaning, not keywords" feature
// embedding a typed query differently from a stored note).
export async function embedText(text: string): Promise<Float32Array> {
  const model = await getModel();
  const results: number[][] = [];
  for await (const batch of model.passageEmbed([text], 1)) results.push(...batch);
  return Float32Array.from(results[0]);
}

// Fire-and-forget: called right after upsertNoteIndex(relPath) in
// server/index.ts's route handlers, once the index (and so notes_fts)
// already reflects this save. A failure here (model not ready yet, a
// transient error) just means the Related panel stays stale for this
// note until the next save — not worth failing the actual note-save
// request over.
export function scheduleEmbeddingUpdate(relPath: string): void {
  const text = getIndexedText(relPath);
  if (!text) return;
  embedText(text)
    .then((vector) => upsertEmbedding(relPath, vector))
    .catch((err) => {
      console.error(`embedding update failed for ${relPath}:`, err);
    });
}

// Called after a full rebuildIndex() (startup bootstrap, or the Reindex
// button) — notes/notes_fts get rebuilt synchronously, but embeddings
// don't come along for free the way they do on an individual save (there
// scheduleEmbeddingUpdate is already wired in right after
// upsertNoteIndex). Sequential, not Promise.all — the model instance is
// a single shared singleton; running everything concurrently wouldn't
// actually parallelize inference, just queue it up with extra overhead.
export async function scheduleEmbeddingUpdateAll(): Promise<void> {
  for (const note of listNotesFromIndex()) {
    const text = getIndexedText(note.path);
    if (!text) continue;
    try {
      upsertEmbedding(note.path, await embedText(text));
    } catch (err) {
      console.error(`embedding update failed for ${note.path}:`, err);
    }
  }
}
