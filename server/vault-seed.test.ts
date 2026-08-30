import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// vault.ts computes VAULT_DIR/STARTER_VAULT_DIR from process.cwd() at
// module-load time — same reasoning as server.test.ts's isolated-cwd
// setup, but split into its own file rather than added to that one:
// seeding needs a fresh, dedicated starter-vault/ next to an empty vault/
// *before* the module is first imported, which would conflict with
// server.test.ts's other tests already writing real content into the
// vault/ that file's own chdir+import sets up.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkm-seed-test-"));
const originalCwd = process.cwd();

let vault: typeof import("./vault.js");

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpRoot, "starter-vault", "tutorial"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "starter-vault", "welcome.md"), "---\ntitle: Welcome\n---\nHi.\n");
  fs.writeFileSync(
    path.join(tmpRoot, "starter-vault", "tutorial", "formatting.md"),
    "---\ntitle: Formatting\n---\nBody.\n"
  );
  process.chdir(tmpRoot);
  vault = await import("./vault.js");
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("seedStarterVaultIfEmpty", () => {
  it("copies starter content into a vault that doesn't exist yet", () => {
    expect(fs.existsSync(vault.VAULT_DIR)).toBe(false);
    vault.seedStarterVaultIfEmpty();
    expect(vault.listNoteFiles().sort()).toEqual(["tutorial/formatting.md", "welcome.md"]);
    expect(vault.readNoteRaw("welcome.md")).toContain("Hi.");
  });

  it("never re-seeds or clobbers real content on a later call", () => {
    vault.writeNoteRaw("welcome.md", "---\ntitle: Welcome\n---\nEdited by the user.\n");
    vault.deleteNote("tutorial/formatting.md");
    vault.seedStarterVaultIfEmpty();
    // Neither the edit nor the deletion got overwritten/undone — the
    // vault has *a* note in it (real, user content by this point), which
    // is the only thing the guard actually checks for.
    expect(vault.readNoteRaw("welcome.md")).toContain("Edited by the user.");
    expect(vault.listNoteFiles()).toEqual(["welcome.md"]);
  });
});
