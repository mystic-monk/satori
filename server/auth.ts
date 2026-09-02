import { randomBytes, randomUUID } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import { stateDb, noteBelongsToProject, resolveShareRole, type ShareRole } from "./db.js";

// Same "sumo" build src/crypto.ts already uses (crypto_pwhash/Argon2id
// isn't in the default libsodium-wrappers build) — one dependency, two
// different uses of the same primitive: that file derives a fixed-purpose
// symmetric key from a shared passphrase, this hashes individual account
// passwords for storage via crypto_pwhash_str, libsodium's purpose-built
// password-hashing API (self-describing output: algorithm, params, salt,
// and hash all encoded into one string — no separate salt column needed).
let readyPromise: Promise<typeof sodium> | null = null;
function getSodium(): Promise<typeof sodium> {
  if (!readyPromise) readyPromise = sodium.ready.then(() => sodium);
  return readyPromise;
}

export async function hashPassword(password: string): Promise<string> {
  const s = await getSodium();
  return s.crypto_pwhash_str(
    password,
    s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    s.crypto_pwhash_MEMLIMIT_INTERACTIVE
  );
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const s = await getSodium();
  try {
    return s.crypto_pwhash_str_verify(hash, password);
  } catch {
    return false;
  }
}

export type WorkspaceRole = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceMember extends User {
  role: WorkspaceRole;
  addedAt: number;
}

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The one thing that decides whether the "no share token = owner" fallback
// (resolveShareRole in this file, and the REST middleware in index.ts)
// keeps its original meaning — see hasOwnerAccess in index.ts. A server
// with zero accounts ever created behaves exactly as it always has.
export function usersConfigured(): boolean {
  const row = stateDb.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
  return row.n > 0;
}

export async function createUser(email: string, name: string, password: string): Promise<User> {
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  stateDb
    .prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, email.toLowerCase().trim(), passwordHash, name, Date.now());
  return { id, email: email.toLowerCase().trim(), name };
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const row = stateDb
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase().trim()) as { id: string; email: string; name: string; password_hash: string } | undefined;
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? { id: row.id, email: row.email, name: row.name } : null;
}

export function addWorkspaceMember(userId: string, role: WorkspaceRole): void {
  stateDb
    .prepare(
      `INSERT INTO workspace_members (user_id, role, added_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET role = excluded.role`
    )
    .run(userId, role, Date.now());
}

export function getWorkspaceRole(userId: string): WorkspaceRole | null {
  const row = stateDb.prepare("SELECT role FROM workspace_members WHERE user_id = ?").get(userId) as
    | { role: WorkspaceRole }
    | undefined;
  return row?.role ?? null;
}

export function listWorkspaceMembers(): WorkspaceMember[] {
  const rows = stateDb
    .prepare(
      `SELECT u.id as id, u.email as email, u.name as name, m.role as role, m.added_at as addedAt
       FROM workspace_members m JOIN users u ON u.id = m.user_id
       ORDER BY m.added_at ASC`
    )
    .all() as WorkspaceMember[];
  return rows;
}

// Removing membership also immediately revokes every active session for
// that user — the whole point of a real membership system over "everyone
// with the passphrase has access forever": one action fully cuts someone
// off, rather than having to hunt down every share link they might hold.
export function removeWorkspaceMember(userId: string): void {
  const tx = stateDb.transaction(() => {
    stateDb.prepare("DELETE FROM workspace_members WHERE user_id = ?").run(userId);
    stateDb.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  });
  tx();
}

export interface ProjectScope {
  projectPath: string;
  role: ShareRole;
}

// Optional per-member restriction — see the doc comment on
// workspace_member_projects in db.ts. Only ever meaningful for "member";
// an admin is always vault-wide, which is why this takes the caller's
// already-known role rather than looking it up itself (avoids a second
// query, and makes "admins are never scoped" impossible to get backwards
// at a call site — the null-for-admin branch is right here, not left to
// every caller to remember).
export function getMemberProjectScope(userId: string, role: WorkspaceRole): ProjectScope[] | null {
  if (role === "admin") return null;
  const rows = stateDb
    .prepare("SELECT project_path as projectPath, role FROM workspace_member_projects WHERE user_id = ?")
    .all(userId) as ProjectScope[];
  return rows.length > 0 ? rows : null;
}

export function listMemberProjectScopes(userId: string): ProjectScope[] {
  return stateDb
    .prepare("SELECT project_path as projectPath, role FROM workspace_member_projects WHERE user_id = ?")
    .all(userId) as ProjectScope[];
}

export function addMemberProjectScope(userId: string, projectPath: string, role: ShareRole): void {
  stateDb
    .prepare(
      `INSERT INTO workspace_member_projects (user_id, project_path, role, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, project_path) DO UPDATE SET role = excluded.role`
    )
    .run(userId, projectPath, role, Date.now());
}

export function removeMemberProjectScope(userId: string, projectPath: string): void {
  stateDb.prepare("DELETE FROM workspace_member_projects WHERE user_id = ? AND project_path = ?").run(userId, projectPath);
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_LIFETIME_MS;
  stateDb
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  stateDb.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Resolves a session cookie all the way to a workspace member — a valid,
// unexpired session for a user who isn't (or is no longer) a workspace
// member doesn't count as owner-equivalent access. Expired sessions are
// opportunistically cleaned up here rather than needing a separate sweep
// job; failing to reach that line just leaves one harmless expired row.
export function resolveSessionMember(token: string | null): WorkspaceMember | null {
  if (!token) return null;
  const row = stateDb
    .prepare(
      `SELECT u.id as id, u.email as email, u.name as name, m.role as role, m.added_at as addedAt, s.expires_at as expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN workspace_members m ON m.user_id = u.id
       WHERE s.token = ?`
    )
    .get(token) as (WorkspaceMember & { expiresAt: number }) | undefined;
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    stateDb.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  if (!row.role) return null; // has an account, but isn't (or isn't yet) a member
  return { id: row.id, email: row.email, name: row.name, role: row.role, addedAt: row.addedAt };
}

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createInvite(createdBy: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + INVITE_LIFETIME_MS;
  stateDb
    .prepare("INSERT INTO invites (token, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, createdBy, now, expiresAt);
  return { token, expiresAt };
}

// Doesn't consume the invite — signup does that (deleteInvite), once it
// actually succeeds. A resolve-only check here means a failed signup
// attempt (e.g. email already taken) doesn't burn a still-valid invite.
export function resolveInvite(token: string): { createdBy: string } | null {
  const row = stateDb.prepare("SELECT created_by as createdBy, expires_at as expiresAt FROM invites WHERE token = ?").get(
    token
  ) as { createdBy: string; expiresAt: number } | undefined;
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    stateDb.prepare("DELETE FROM invites WHERE token = ?").run(token);
    return null;
  }
  return { createdBy: row.createdBy };
}

export function deleteInvite(token: string): void {
  stateDb.prepare("DELETE FROM invites WHERE token = ?").run(token);
}

// The three shapes a resolved session can take: no valid session at all;
// a full vault-wide member (admin, or a plain member with zero scoping
// rows — today's only behavior, preserved exactly); or a member
// restricted to specific projects. The one place session-to-access
// resolution happens — hasOwnerAccess and resolveEffectiveRole below both
// build on this rather than each re-deriving it.
export type SessionAccess = { kind: "none" } | { kind: "owner" } | { kind: "scoped"; projects: ProjectScope[] };

export function resolveSessionAccess(sessionToken: string | null): SessionAccess {
  const member = resolveSessionMember(sessionToken);
  if (!member) return { kind: "none" };
  const scope = getMemberProjectScope(member.id, member.role);
  return scope ? { kind: "scoped", projects: scope } : { kind: "owner" };
}

// The one real behavior change from adding real accounts (Team/Workspace
// v1): a request with no share token used to be trusted as "the owner"
// unconditionally — correct when only the vault's actual owner could
// ever reach their own server directly. Once real accounts exist, that
// stops being true (the whole point of a workspace is other people
// reaching this same server), so once at least one account has been
// created, "no share token" alone no longer counts as owner access — it
// also needs a valid session for a real, *unscoped* workspace member (a
// project-scoped member is deliberately not "owner" here — vault-wide
// operations like reindex/search/vault-wide share management stay closed
// to them; their own note-level access is resolveEffectiveRole's job,
// below). A server with zero accounts ever created (today's default,
// completely unaffected by this feature until someone opts in by
// creating the first one) keeps behaving exactly as it always has.
// Deliberately Express-independent (plain string|null in, not a
// Request) — the whole point of pulling this out of index.ts is testing
// it without needing to spin up an HTTP server or bring in a
// testing-only dependency just for that.
export function hasOwnerAccess(shareToken: string | null, sessionToken: string | null): boolean {
  if (shareToken) return false; // a share token present is the guest path, not owner
  if (!usersConfigured()) return true;
  return resolveSessionAccess(sessionToken).kind === "owner";
}

// The single place "does this request get to touch this note, and how"
// is decided — server/index.ts's effectiveRole and server/collab.ts's WS
// connection handler both call this instead of each re-implementing the
// token-vs-session branching (which is exactly how they drifted apart
// before: collab.ts calling resolveShareRole directly, bypassing session/
// scoping entirely, is the bug this consolidation closes). Precedence:
// a share token (the anonymous guest path) is checked first and, if
// present, is authoritative on its own — a request either presents a
// token or a session, never resolved as both at once, same as today.
export function resolveEffectiveRole(
  notePath: string,
  shareToken: string | null,
  sessionToken: string | null
): ShareRole | "owner" | "denied" {
  if (shareToken) return resolveShareRole(notePath, shareToken);
  if (!usersConfigured()) return "owner";
  const access = resolveSessionAccess(sessionToken);
  if (access.kind === "owner") return "owner";
  if (access.kind === "scoped") {
    for (const { projectPath, role } of access.projects) {
      if (noteBelongsToProject(notePath, projectPath)) return role;
    }
  }
  return "denied";
}
