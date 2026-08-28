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
