// Client wrapper for the Team/Workspace v1 REST API (server/auth-routes.ts).
// Server/browser deployment only — Tauri's local vault stays single-owner,
// no accounts, so nothing here is ever called when IS_TAURI. All requests
// rely on the httpOnly session cookie set by the server; there's nothing
// to pass explicitly beyond credentials: "include" is Express's default
// same-origin cookie behavior, no extra config needed since this app is
// always same-origin with its own API.

export type WorkspaceRole = "admin" | "member";

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  addedAt: number;
}

export interface AuthStatus {
  configured: boolean;
  user: WorkspaceUser | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "request failed");
  return data;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status");
  return res.json();
}

export async function bootstrapAdmin(email: string, name: string, password: string) {
  return postJson<{ ok: true; user: WorkspaceUser }>("/api/auth/bootstrap", { email, name, password });
}

export async function login(email: string, password: string) {
  return postJson<{ ok: true; user: WorkspaceUser }>("/api/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function signup(inviteToken: string, email: string, name: string, password: string) {
  return postJson<{ ok: true; user: WorkspaceUser }>("/api/auth/signup", { inviteToken, email, name, password });
}

export async function createInvite(): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch("/api/auth/invite", { method: "POST" });
  if (!res.ok) throw new Error("failed to create invite");
  return res.json();
}

export async function listMembers(): Promise<WorkspaceUser[]> {
  const res = await fetch("/api/auth/members");
  if (!res.ok) throw new Error("failed to list members");
  return res.json();
}

export async function removeMember(userId: string): Promise<void> {
  const res = await fetch(`/api/auth/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "failed to remove member");
  }
}
