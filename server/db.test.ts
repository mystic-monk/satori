import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolated-cwd pattern as auth.test.ts/server.test.ts — db.ts
// resolves its SQLite path from process.cwd() at module-load time, so
// switching cwd before the dynamic import gives each test file its own
// on-disk database instead of sharing (or corrupting) the real one.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkm-db-test-"));
const originalCwd = process.cwd();

let db: typeof import("./db.js");
let vault: typeof import("./vault.js");

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpRoot, "vault"), { recursive: true });
  process.chdir(tmpRoot);
  vault = await import("./vault.js");
  db = await import("./db.js");
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// A note's real content doesn't matter for these tests — only that it's
// indexed (for the title JOIN) and has a hand-picked embedding vector
// (so cosine similarity is deterministic, rather than depending on
// fastembed actually running).
function seedNote(relPath: string, title: string, vector: number[]) {
  vault.writeNoteRaw(relPath, `---\ntitle: ${title}\n---\nBody for ${title}.\n`);
  db.upsertNoteIndex(relPath);
  db.upsertEmbedding(relPath, Float32Array.from(vector));
}

describe("findSimilar / findSimilarToVector (shared topKByVector ranking)", () => {
  beforeAll(() => {
    seedNote("a.md", "A", [1, 0, 0]);
    seedNote("b.md", "B", [0.9, 0.1, 0]); // closest to A
    seedNote("c.md", "C", [0, 1, 0]); // orthogonal to A
    seedNote("d.md", "D", [-1, 0, 0]); // opposite of A
  });

  it("findSimilar excludes the target note itself and ranks by cosine similarity", () => {
    const results = db.findSimilar("a.md", 3);
    expect(results.map((r) => r.path)).toEqual(["b.md", "c.md", "d.md"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results.find((r) => r.path === "a.md")).toBeUndefined();
  });

  it("findSimilar returns [] for a note with no stored embedding", () => {
    vault.writeNoteRaw("no-embedding.md", "---\ntitle: None\n---\nNo vector yet.\n");
    db.upsertNoteIndex("no-embedding.md");
    expect(db.findSimilar("no-embedding.md")).toEqual([]);
  });

  it("findSimilarToVector ranks every note (nothing excluded) against an arbitrary query vector", () => {
    const results = db.findSimilarToVector(Float32Array.from([1, 0, 0]), 4);
    expect(results[0].path).toBe("a.md"); // exact match ranks first
    expect(results.map((r) => r.path)).toContain("a.md");
    expect(results.length).toBe(4);
  });

  it("respects the k limit", () => {
    expect(db.findSimilarToVector(Float32Array.from([1, 0, 0]), 2).length).toBe(2);
  });
});
