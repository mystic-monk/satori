import type { Express, NextFunction, Request, Response } from "express";
import {
  usersConfigured,
  createUser,
  verifyLogin,
  addWorkspaceMember,
  getWorkspaceRole,
  listWorkspaceMembers,
  removeWorkspaceMember,
  createSession,
  deleteSession,
  resolveSessionMember,
  createInvite,
  resolveInvite,
  deleteInvite,
  listMemberProjectScopes,
  addMemberProjectScope,
  removeMemberProjectScope,
} from "./auth.js";
import type { ShareRole } from "./db.js";

function isShareRole(v: unknown): v is ShareRole {
  return v === "view" || v === "comment" || v === "edit";
}

export const SESSION_COOKIE = "satori_session";

function sessionTokenFrom(req: Request): string | null {
  return (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
}

function setSessionCookie(res: Response, token: string, expiresAt: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(expiresAt),
    // Not forced true unconditionally — a self-hosted deployment behind
    // plain HTTP on a trusted LAN (the same trust model the rest of this
    // app's "local mode" already assumes) would otherwise never be able
    // to log in at all. Set SATORI_COOKIE_SECURE=1 for anything reachable
    // over the open internet.
    secure: process.env.SATORI_COOKIE_SECURE === "1",
  });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const member = resolveSessionMember(sessionTokenFrom(req));
  if (!member || member.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function registerAuthRoutes(app: Express): void {
  // Always reachable, unguarded — this is how the frontend decides
  // whether to show a login/signup screen at all, and who (if anyone) is
  // currently signed in. Reveals no secrets: just booleans and the
  // caller's own identity, if any.
  app.get("/api/auth/status", (req, res) => {
    const member = usersConfigured() ? resolveSessionMember(sessionTokenFrom(req)) : null;
    res.json({ configured: usersConfigured(), user: member });
  });

  // Creates the very first account, as admin, automatically — the
  // self-hosted-app convention (no env vars/CLI flags to set up
  // beforehand). Only reachable at all while usersConfigured() is still
  // false; once it's true this always 403s, so there's no way to sneak
  // in a second "bootstrap" admin through this route later.
  app.post("/api/auth/bootstrap", async (req, res) => {
    if (usersConfigured()) {
      res.status(403).json({ error: "already configured" });
      return;
    }
    const { email, name, password } = req.body as { email?: string; name?: string; password?: string };
    if (!isValidEmail(email) || !name?.trim() || !password || password.length < 8) {
      res.status(400).json({ error: "invalid email, name, or password (min 8 characters)" });
      return;
    }
    const user = await createUser(email, name.trim(), password);
    addWorkspaceMember(user.id, "admin");
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ ok: true, user: { ...user, role: "admin" } });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: "invalid email or password" });
      return;
    }
    const user = await verifyLogin(email, password);
    const role = user ? getWorkspaceRole(user.id) : null;
    if (!user || !role) {
      // Same message either way — confirming "that email exists but the
      // password is wrong" vs. "no such account" is a real (if minor)
      // information leak for a login endpoint.
      res.status(401).json({ error: "invalid email or password" });
      return;
    }
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ ok: true, user: { ...user, role } });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = sessionTokenFrom(req);
    if (token) deleteSession(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.post("/api/auth/invite", requireAdmin, (req, res) => {
    const member = resolveSessionMember(sessionTokenFrom(req))!; // requireAdmin already confirmed this
    const invite = createInvite(member.id);
    res.json(invite);
  });

  // Not admin-gated on purpose — this is what an invite recipient (who
  // has no account, and so no session, yet) calls to actually redeem the
  // link and become a member. The invite token itself is the credential.
  app.post("/api/auth/signup", async (req, res) => {
    const { inviteToken, email, name, password } = req.body as {
      inviteToken?: string;
      email?: string;
      name?: string;
      password?: string;
    };
    if (typeof inviteToken !== "string" || !resolveInvite(inviteToken)) {
      res.status(403).json({ error: "invalid or expired invite" });
      return;
    }
    if (!isValidEmail(email) || !name?.trim() || !password || password.length < 8) {
      res.status(400).json({ error: "invalid email, name, or password (min 8 characters)" });
      return;
    }
    let user;
    try {
      user = await createUser(email, name.trim(), password);
    } catch {
      res.status(409).json({ error: "an account with that email already exists" });
      return;
    }
    addWorkspaceMember(user.id, "member");
    deleteInvite(inviteToken); // single-use, only burned on a successful signup
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ ok: true, user: { ...user, role: "member" } });
  });

  app.get("/api/auth/members", requireAdmin, (_req, res) => {
    res.json(listWorkspaceMembers());
  });

  app.delete("/api/auth/members/:userId", requireAdmin, (req, res) => {
    const member = resolveSessionMember(sessionTokenFrom(req))!;
    if (req.params.userId === member.id) {
      res.status(400).json({ error: "can't remove yourself" });
      return;
    }
    removeWorkspaceMember(req.params.userId);
    res.json({ ok: true });
  });

  // Optional per-member restriction — see workspace_member_projects' doc
  // comment in db.ts. Admin-only, same as every other member-management
  // route above; a member's own scope is visible to them for free via
  // GET /api/auth/status (resolveSessionMember doesn't include it
  // directly, but the note list they can actually reach already reflects
  // it — no separate "my scope" endpoint needed).
  app.get("/api/auth/members/:userId/projects", requireAdmin, (req, res) => {
    res.json(listMemberProjectScopes(req.params.userId));
  });

  app.post("/api/auth/members/:userId/projects", requireAdmin, (req, res) => {
    const { projectPath, role } = req.body as { projectPath?: string; role?: string };
    if (typeof projectPath !== "string" || !projectPath.trim() || !isShareRole(role)) {
      res.status(400).json({ error: "invalid projectPath or role" });
      return;
    }
    addMemberProjectScope(req.params.userId, projectPath, role);
    res.json({ ok: true });
  });

  app.delete("/api/auth/members/:userId/projects/*", requireAdmin, (req, res) => {
    const projectPath = (req.params as Record<string, string>)[0];
    removeMemberProjectScope(req.params.userId, projectPath);
    res.json({ ok: true });
  });
}
