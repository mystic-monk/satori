import path from "node:path";
import { createRequire } from "node:module";
import type { FlagEmbedding as FlagEmbeddingType } from "fastembed";
import { getIndexedText, upsertEmbedding, listNotesFromIndex } from "./db.js";

const require = createRequire(import.meta.url);

// fastembed defaults to a bare local_cache/ at cwd, which doesn't match
// this app's own dot-prefixed cache-directory convention (.pkm/,
// .pkm-state/) and would otherwise clutter a plain `ls` of the project
// root. Same cwd-relative reasoning as INDEX_DIR/STATE_DIR in db.ts —
// tucked inside .pkm/ since model weights are exactly the kind of
// re-downloadable cache that directory already exists for.
const MODEL_CACHE_DIR = path.resolve(process.cwd(), ".pkm", "models");

// Lazy singleton, two layers deep: the *module* import (fastembed pulls
// in onnxruntime-node's native bindings — measured at ~160ms just to
// import, before any model is even loaded) is deferred exactly like the
// model download/load itself already was, so a server that never has
// Related Notes opened doesn't pay that cost on every boot. Every note
// save just schedules an update through this; nothing here blocks the
// synchronous index-write path in db.ts, which is why
// scheduleEmbeddingUpdate below is fire-and-forget.
let modelPromise: Promise<FlagEmbeddingType> | null = null;
function getModel(): Promise<FlagEmbeddingType> {
  if (!modelPromise) {
    // Not `import("fastembed")`: its ESM build does `import tar from
    // "tar"`, which throws at module-evaluation time under the
    // tar@7.5.22 override in package.json (a real ESM module with no
    // default export — fastembed's own dependency range wants tar@6.x's
    // CJS shape). Every call failed as a result. fastembed's CJS build
    // isn't affected — TypeScript's __importDefault interop wrapper
    // already copes with a default-less required module — so this loads
    // that build directly instead of waiting on fastembed to fix its own
    // ESM entrypoint (or reintroducing the tar CVE the override exists
    // to patch by downgrading it back).
    const { EmbeddingModel, FlagEmbedding } = require("fastembed") as typeof import("fastembed");
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

// The asymmetric case the comment above flags — chat's retrieval step
// embeds a typed question, not a stored note, so it uses fastembed's
// query mode instead of passage mode for a better match against the
// passage-embedded notes already in the index. Unlike passageEmbed,
// queryEmbed takes a single string (not a batch array) and resolves
// directly to a plain number[], not an async generator of batches.
export async function embedQuery(text: string): Promise<Float32Array> {
  const model = await getModel();
  const result = await model.queryEmbed(text);
  return Float32Array.from(result);
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
