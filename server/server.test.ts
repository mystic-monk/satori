import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// vault.ts and db.ts both compute their working paths from process.cwd()
// at module-load time (VAULT_DIR, .pkm/, .pkm-state/) — there's no
// injectable override, so these tests chdir into an isolated temp
// directory *before* importing either module, then dynamically import.
// Both modules are exercised from this one file (not split across
// server/vault.test.ts + server/db.test.ts) specifically to avoid any
// risk of two test files racing a process-wide chdir() against each
// other under vitest's parallel workers.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkm-server-test-"));
const originalCwd = process.cwd();

let vault: typeof import("./vault.js");
let db: typeof import("./db.js");
let collab: typeof import("./collab.js");

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpRoot, "vault"), { recursive: true });
  process.chdir(tmpRoot);
  vault = await import("./vault.js");
  db = await import("./db.js");
  collab = await import("./collab.js");
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("vault path-escape guard", () => {
  it("writes and reads a note back unchanged", () => {
    vault.writeNoteRaw("note.md", "hello world");
    expect(vault.readNoteRaw("note.md")).toBe("hello world");
  });

  it("writes and reads a note in a subdirectory", () => {
    vault.writeNoteRaw("sub/dir/note.md", "nested");
    expect(vault.readNoteRaw("sub/dir/note.md")).toBe("nested");
  });

  it("rejects a path that escapes the vault via ..", () => {
    expect(() => vault.readNoteRaw("../../../etc/passwd")).toThrow("path escapes vault");
    expect(() => vault.writeNoteRaw("../outside.md", "x")).toThrow("path escapes vault");
  });

  it("rejects an escape attempt buried inside a longer relative path", () => {
    expect(() => vault.readNoteRaw("sub/../../escape.md")).toThrow("path escapes vault");
  });
});

// Regression test for the P0 fix in this session: resolveShareRole() used
// to fall back to "owner" for ANY token that didn't resolve to a real
// share row — meaning a wrong, mistyped, or revoked token got full owner
// access, identical to a real owner. It must fail closed to "denied"
// instead; only a genuinely absent token (the local app's own session)
// should ever resolve to "owner".
describe("resolveShareRole (P0 regression: must fail closed, not open)", () => {
  it("resolves a real token to its granted role, for its granted path only", () => {
    const share = db.createShare("secret.md", "view", "test");
    expect(db.resolveShareRole("secret.md", share.token)).toBe("view");
  });

  it("denies a real token used against a DIFFERENT note path", () => {
    const share = db.createShare("secret.md", "view", "test");
    expect(db.resolveShareRole("other-note.md", share.token)).toBe("denied");
  });

  it("denies a token that doesn't match any share at all", () => {
    expect(db.resolveShareRole("secret.md", "totally-made-up-token")).toBe("denied");
  });

  it("denies a token after it's been revoked", () => {
    const share = db.createShare("secret.md", "edit", "test");
    expect(db.resolveShareRole("secret.md", share.token)).toBe("edit");
    db.revokeShare(share.token);
    expect(db.resolveShareRole("secret.md", share.token)).toBe("denied");
  });

  it("only a genuinely absent token resolves to owner", () => {
    expect(db.resolveShareRole("secret.md", null)).toBe("owner");
  });
});

// Regression test for the persistent-identity change: history rows written
// before it are a bare string[] of display names; rows written after it are
// {id, name}[]. getHistory() must read both without crashing, since there's
// no way to retroactively attach an id to a save that already happened.
describe("getHistory (identity migration: must read both old and new row shapes)", () => {
  it("parses new-shape rows with a stable id", () => {
    db.logHistory("mixed.md", [{ id: "user-abc", name: "Ada" }]);
    const [entry] = db.getHistory("mixed.md");
    expect(entry.authors).toEqual([{ id: "user-abc", name: "Ada" }]);
  });

  it("parses old-shape rows (bare string[]) as id: null", () => {
    db.stateDb
      .prepare("INSERT INTO history (path, at, authors) VALUES (?, ?, ?)")
      .run("legacy.md", Date.now(), JSON.stringify(["Grace", "Alan"]));
    const [entry] = db.getHistory("legacy.md");
    expect(entry.authors).toEqual([
      { id: null, name: "Grace" },
      { id: null, name: "Alan" },
    ]);
  });

  it("a rename keeps the same id across two saves", () => {
    db.logHistory("renamed.md", [{ id: "user-xyz", name: "Bob" }]);
    db.logHistory("renamed.md", [{ id: "user-xyz", name: "Robert" }]);
    const entries = db.getHistory("renamed.md");
    // Both saves share one identity id (the point of this test — a rename
    // doesn't fragment history into two people) — not asserting row order,
    // since both calls can land in the same millisecond and SQLite doesn't
    // guarantee a tie-break order on `at DESC` alone.
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.authors[0].id === "user-xyz")).toBe(true);
    expect(new Set(entries.map((e) => e.authors[0].name))).toEqual(new Set(["Bob", "Robert"]));
  });
});

// Regression coverage for the sidebar-redesign work: `favorite` isn't its
// own column, it's derived from the `properties` JSON column at query
// time (see deriveFavorite in db.ts) — a note with no `favorite` property
// at all (the common case) must resolve to false, not throw or come back
// undefined.
describe("listNotesFromIndex favorite derivation", () => {
  it("a note with no favorite property resolves to false", () => {
    vault.writeNoteRaw("plain.md", "---\ntitle: Plain\n---\nBody.");
    db.upsertNoteIndex("plain.md");
    const note = db.listNotesFromIndex().find((n) => n.path === "plain.md");
    expect(note?.favorite).toBe(false);
  });

  it("a note with favorite: true resolves to true", () => {
    vault.writeNoteRaw("starred.md", "---\ntitle: Starred\nfavorite: true\n---\nBody.");
    db.upsertNoteIndex("starred.md");
    const note = db.listNotesFromIndex().find((n) => n.path === "starred.md");
    expect(note?.favorite).toBe(true);
  });
});

// Regression coverage for a real content-loss bug found during this
// session: Room's constructor used to trust a .ybin CRDT snapshot
// unconditionally whenever one existed, with no regard for whether the
// .md file had been modified since — so any out-of-band edit to the file
// (a direct write, a git checkout, a sync from another device) got
// silently reverted the moment anyone next opened that note through the
// collab system. Caught this reverting real content in vault/tutorial.md
// during manual testing.
describe("collab Room CRDT/file staleness", () => {
  it("reseeds from the .md file when it was modified after the .ybin snapshot", () => {
    vault.writeNoteRaw("stale-test.md", "original content");
    const room1 = new collab.Room("stale-test.md");
    room1.persist(); // writes stale-test.md.ybin holding "original content"

    const ybinPath = path.join(tmpRoot, ".pkm-state", "crdt", "stale-test.md.ybin");
    const ybinMtime = fs.statSync(ybinPath).mtimeMs;
    // Simulate an out-of-band edit happening after the collab session
    // ended, landing with a mtime strictly after the .ybin's.
    vault.writeNoteRaw("stale-test.md", "edited outside the collab system");
    const newer = new Date(ybinMtime + 1000);
    fs.utimesSync(path.join(tmpRoot, "vault", "stale-test.md"), newer, newer);

    const room2 = new collab.Room("stale-test.md");
    expect(room2.doc.getText("content").toString()).toBe("edited outside the collab system");
  });

  it("still trusts the .ybin snapshot when it is at least as new as the .md file", () => {
    vault.writeNoteRaw("fresh-test.md", "from collab session");
    const room1 = new collab.Room("fresh-test.md");
    room1.persist(); // ybin + md both now hold "from collab session"

    // A direct write to the .md file that doesn't advance its mtime past
    // the .ybin's — the snapshot should still win.
    const ybinPath = path.join(tmpRoot, ".pkm-state", "crdt", "fresh-test.md.ybin");
    const ybinMtime = fs.statSync(ybinPath).mtimeMs;
    const mdPath = path.join(tmpRoot, "vault", "fresh-test.md");
    fs.writeFileSync(mdPath, "corrupted directly on disk");
    const tied = new Date(ybinMtime);
    fs.utimesSync(mdPath, tied, tied);

    const room2 = new collab.Room("fresh-test.md");
    expect(room2.doc.getText("content").toString()).toBe("from collab session");
  });
});
