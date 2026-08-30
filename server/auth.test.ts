import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolated-cwd pattern as server.test.ts — auth.ts's stateDb import
// comes from db.ts, which resolves its path from process.cwd() at
// module-load time.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkm-auth-test-"));
const originalCwd = process.cwd();

let auth: typeof import("./auth.js");

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpRoot, "vault"), { recursive: true });
  process.chdir(tmpRoot);
  auth = await import("./auth.js");
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// The one real behavior change from adding real accounts — see
// hasOwnerAccess's doc comment. Both halves matter equally: a server
// that never gets accounts configured must keep behaving exactly as it
// always has (this is what makes the feature purely additive), and once
// accounts do exist, "no share token" alone must stop being sufficient.
// Deliberately the *first* describe block in this file — the
// "unconfigured" case below needs to run against a genuinely pristine,
// zero-user database, which only holds true before any other test in
// this file (they all share one db/module instance) creates one.
describe("hasOwnerAccess (security-critical: test before building anything on top)", () => {
  it("a share token present is never owner access, configured or not", () => {
    expect(auth.hasOwnerAccess("some-share-token", null)).toBe(false);
  });

  it("no accounts configured yet: no token = owner access, unchanged from before this feature existed", () => {
    expect(auth.usersConfigured()).toBe(false); // must be pristine — see the describe-block comment above
    expect(auth.hasOwnerAccess(null, null)).toBe(true);
    expect(auth.hasOwnerAccess(null, "any-random-cookie-value")).toBe(true);
  });

  it("once accounts are configured: no token requires a valid member session", async () => {
    const user = await auth.createUser("hank@example.com", "Hank", "hanks-password");
    expect(auth.usersConfigured()).toBe(true); // now true, regardless of prior tests' order

    // Has an account, but isn't a workspace member yet — still no access.
    expect(auth.hasOwnerAccess(null, null)).toBe(false);

    auth.addWorkspaceMember(user.id, "member");
    const session = auth.createSession(user.id);
    expect(auth.hasOwnerAccess(null, session.token)).toBe(true);
    expect(auth.hasOwnerAccess(null, "wrong-token")).toBe(false);

    auth.removeWorkspaceMember(user.id);
    expect(auth.hasOwnerAccess(null, session.token)).toBe(false); // session revoked with membership
  });
});

describe("createUser / verifyLogin", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const user = await auth.createUser("alice@example.com", "Alice", "hunter2-but-better");
    const ok = await auth.verifyLogin("alice@example.com", "hunter2-but-better");
    expect(ok).not.toBeNull();
    expect(ok?.id).toBe(user.id);

    const wrong = await auth.verifyLogin("alice@example.com", "wrong password");
    expect(wrong).toBeNull();
  });

  it("rejects an email with no account at all", async () => {
    const result = await auth.verifyLogin("nobody@example.com", "anything");
    expect(result).toBeNull();
  });

  it("lowercases/trims email so login isn't case-sensitive", async () => {
    await auth.createUser("Bob@Example.com  ".trim(), "Bob", "bobs-password");
    const result = await auth.verifyLogin("  BOB@EXAMPLE.COM", "bobs-password");
    expect(result).not.toBeNull();
  });
});

describe("workspace membership", () => {
  it("add / get role / list / remove, remove also revokes sessions", async () => {
    const user = await auth.createUser("carol@example.com", "Carol", "carols-password");
    expect(auth.getWorkspaceRole(user.id)).toBeNull();

    auth.addWorkspaceMember(user.id, "member");
    expect(auth.getWorkspaceRole(user.id)).toBe("member");
    expect(auth.listWorkspaceMembers().some((m) => m.id === user.id && m.role === "member")).toBe(true);

    const session = auth.createSession(user.id);
    expect(auth.resolveSessionMember(session.token)?.id).toBe(user.id);

    auth.removeWorkspaceMember(user.id);
    expect(auth.getWorkspaceRole(user.id)).toBeNull();
    expect(auth.resolveSessionMember(session.token)).toBeNull(); // session revoked, not just role gone
  });

  it("a session for a user who was never made a member resolves to null", async () => {
    const user = await auth.createUser("dave@example.com", "Dave", "daves-password");
    const session = auth.createSession(user.id);
    expect(auth.resolveSessionMember(session.token)).toBeNull();
  });
});

describe("sessions", () => {
  it("resolves a valid session and rejects a bogus token", async () => {
    const user = await auth.createUser("erin@example.com", "Erin", "erins-password");
    auth.addWorkspaceMember(user.id, "admin");
    const session = auth.createSession(user.id);
    expect(auth.resolveSessionMember(session.token)?.role).toBe("admin");
    expect(auth.resolveSessionMember("not-a-real-token")).toBeNull();
    expect(auth.resolveSessionMember(null)).toBeNull();
  });

  it("an expired session resolves to null and is cleaned up", async () => {
    const user = await auth.createUser("frank@example.com", "Frank", "franks-password");
    auth.addWorkspaceMember(user.id, "member");
    const session = auth.createSession(user.id);
    // Force it into the past directly — no need to wait 30 real days to
    // exercise the expiry path.
    const { stateDb } = await import("./db.js");
    stateDb.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(Date.now() - 1000, session.token);
    expect(auth.resolveSessionMember(session.token)).toBeNull();
    // And it's actually gone, not just treated as expired every time —
    // confirms the opportunistic cleanup really deletes the row.
    const row = stateDb.prepare("SELECT 1 FROM sessions WHERE token = ?").get(session.token);
    expect(row).toBeUndefined();
  });

  it("deleteSession revokes immediately", async () => {
    const user = await auth.createUser("gina@example.com", "Gina", "ginas-password");
    auth.addWorkspaceMember(user.id, "member");
    const session = auth.createSession(user.id);
    expect(auth.resolveSessionMember(session.token)).not.toBeNull();
    auth.deleteSession(session.token);
    expect(auth.resolveSessionMember(session.token)).toBeNull();
  });
});

describe("invites", () => {
  it("resolves a valid invite and rejects an unknown token", async () => {
    const admin = await auth.createUser("admin@example.com", "Admin", "admins-password");
    const invite = auth.createInvite(admin.id);
    expect(auth.resolveInvite(invite.token)?.createdBy).toBe(admin.id);
    expect(auth.resolveInvite("not-a-real-invite")).toBeNull();
  });

  it("an expired invite resolves to null", async () => {
    const admin = await auth.createUser("admin2@example.com", "Admin2", "admins-password-2");
    const invite = auth.createInvite(admin.id);
    const { stateDb } = await import("./db.js");
    stateDb.prepare("UPDATE invites SET expires_at = ? WHERE token = ?").run(Date.now() - 1000, invite.token);
    expect(auth.resolveInvite(invite.token)).toBeNull();
  });

  it("deleteInvite makes it unresolvable — single use", async () => {
    const admin = await auth.createUser("admin3@example.com", "Admin3", "admins-password-3");
    const invite = auth.createInvite(admin.id);
    auth.deleteInvite(invite.token);
    expect(auth.resolveInvite(invite.token)).toBeNull();
  });
});
