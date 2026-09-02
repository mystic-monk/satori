import { useEffect, useState } from "react";
import {
  bootstrapAdmin,
  createInvite,
  listMembers,
  logout,
  removeMember,
  listMemberProjects,
  addMemberProject,
  removeMemberProject,
  type AuthStatus,
  type WorkspaceUser,
  type ProjectScope,
} from "./workspaceAuth";
import type { NoteListItem } from "./api";

interface WorkspacePanelProps {
  status: AuthStatus;
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
  // Only used to build the "scope to project" picker (type: project
  // notes) — MemberView/BootstrapForm never touch it.
  notes: NoteListItem[];
}

// Reachable from a small, always-visible sidebar entry (App.tsx) rather
// than hidden away — the whole point of accounts being opt-in is that
// nothing about single-owner use changes until someone deliberately
// finds and uses this. Three states depending on `status`: not
// configured yet (bootstrap form), configured and admin (members +
// invite), configured and a plain member (just identity + sign out).
export default function WorkspacePanel({ status, onStatusChange, onClose, notes }: WorkspacePanelProps) {
  if (!status.configured) return <BootstrapForm onStatusChange={onStatusChange} onClose={onClose} />;
  if (status.user?.role === "admin")
    return <MembersView status={status} onStatusChange={onStatusChange} onClose={onClose} notes={notes} />;
  return <MemberView status={status} onStatusChange={onStatusChange} onClose={onClose} />;
}

function BootstrapForm({
  onStatusChange,
  onClose,
}: {
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await bootstrapAdmin(email, name, password);
      onStatusChange({ configured: true, user });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Set up team access</h3>
        <p className="modal-message">
          Turns this vault into a shared workspace — you become the admin, then invite others. Nothing about how
          this vault works today changes unless you do this.
        </p>
        <form onSubmit={submit}>
          <input
            className="modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            required
          />
          <input
            className="modal-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
          />
          <input
            className="modal-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            required
          />
          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "…" : "Create admin account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MembersView({
  status,
  onStatusChange,
  onClose,
  notes,
}: {
  status: AuthStatus;
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
  notes: NoteListItem[];
}) {
  const [members, setMembers] = useState<WorkspaceUser[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which member row (if any) has its "scope to project" form open —
  // only one at a time, same reasoning Table view's rollup-add form uses.
  const [scopingMemberId, setScopingMemberId] = useState<string | null>(null);
  const [scopes, setScopes] = useState<Record<string, ProjectScope[]>>({});

  const projectNotes = notes.filter((n) => n.type === "project");

  useEffect(() => {
    listMembers()
      .then(async (list) => {
        setMembers(list);
        // Scoping only ever applies to plain members — no point fetching
        // (or rendering) scope rows for an admin, who's always vault-wide.
        const plainMembers = list.filter((m) => m.role === "member");
        const pairs = await Promise.all(plainMembers.map((m) => listMemberProjects(m.id).then((s) => [m.id, s] as const)));
        setScopes(Object.fromEntries(pairs));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load members"));
  }, []);

  async function onCreateInvite() {
    setError(null);
    try {
      const { token } = await createInvite();
      setInvite(`${window.location.origin}${window.location.pathname}?invite=${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create invite");
    }
  }

  async function onRemove(userId: string) {
    setError(null);
    try {
      await removeMember(userId);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to remove member");
    }
  }

  async function onAddScope(userId: string, projectPath: string, role: ProjectScope["role"]) {
    setError(null);
    try {
      await addMemberProject(userId, projectPath, role);
      setScopes((prev) => ({
        ...prev,
        [userId]: [...(prev[userId] ?? []).filter((s) => s.projectPath !== projectPath), { projectPath, role }],
      }));
      setScopingMemberId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add project scope");
    }
  }

  async function onRemoveScope(userId: string, projectPath: string) {
    setError(null);
    try {
      await removeMemberProject(userId, projectPath);
      setScopes((prev) => ({ ...prev, [userId]: (prev[userId] ?? []).filter((s) => s.projectPath !== projectPath) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to remove project scope");
    }
  }

  async function onSignOut() {
    await logout();
    onStatusChange({ configured: true, user: null });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Workspace members</h3>
        <ul className="workspace-members-list">
          {members.map((m) => {
            const memberScopes = scopes[m.id] ?? [];
            return (
              <li key={m.id} className="workspace-member-row-wrap">
                <div className="workspace-member-row">
                  <div className="workspace-member-info">
                    <span className="workspace-member-name">{m.name}</span>
                    <span className="workspace-member-email">{m.email}</span>
                  </div>
                  <span className="workspace-member-role">{m.role}</span>
                  {m.id !== status.user?.id && (
                    <button className="btn-ghost" onClick={() => onRemove(m.id)}>
                      Remove
                    </button>
                  )}
                </div>
                {m.role === "member" && (
                  <div className="workspace-member-scopes">
                    {memberScopes.map((s) => {
                      const note = notes.find((n) => n.path === s.projectPath);
                      return (
                        <span key={s.projectPath} className="workspace-scope-chip">
                          {note?.title ?? s.projectPath} ({s.role})
                          <button
                            className="workspace-scope-remove"
                            onClick={() => onRemoveScope(m.id, s.projectPath)}
                            aria-label={`Remove scope for ${note?.title ?? s.projectPath}`}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {scopingMemberId === m.id ? (
                      <AddScopeForm
                        projectNotes={projectNotes.filter((n) => !memberScopes.some((s) => s.projectPath === n.path))}
                        onAdd={(projectPath, role) => onAddScope(m.id, projectPath, role)}
                        onCancel={() => setScopingMemberId(null)}
                      />
                    ) : (
                      projectNotes.length > 0 && (
                        <button className="workspace-scope-add" onClick={() => setScopingMemberId(m.id)}>
                          + Scope to project…
                        </button>
                      )
                    )}
                    {memberScopes.length === 0 && scopingMemberId !== m.id && (
                      <span className="workspace-scope-hint">Full vault access (not scoped to any project)</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {invite ? (
          <div className="workspace-invite-row">
            <span className="workspace-invite-link">{invite}</span>
            <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(invite)}>
              Copy
            </button>
          </div>
        ) : (
          <button className="btn-primary" onClick={onCreateInvite}>
            + Invite someone
          </button>
        )}
        {error && <p className="auth-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Same shape as TableView.tsx's AddRollupForm — a compact inline form of
// two selects + Add/Cancel, the established pattern for "pick from a
// short list, then confirm" elsewhere in this app.
function AddScopeForm({
  projectNotes,
  onAdd,
  onCancel,
}: {
  projectNotes: NoteListItem[];
  onAdd: (projectPath: string, role: ProjectScope["role"]) => void;
  onCancel: () => void;
}) {
  const [projectPath, setProjectPath] = useState(projectNotes[0]?.path ?? "");
  const [role, setRole] = useState<ProjectScope["role"]>("view");
  return (
    <span className="workspace-scope-form">
      <select value={projectPath} onChange={(e) => setProjectPath(e.target.value)} aria-label="Project">
        {projectNotes.map((n) => (
          <option key={n.path} value={n.path}>
            {n.title}
          </option>
        ))}
      </select>
      <select value={role} onChange={(e) => setRole(e.target.value as ProjectScope["role"])} aria-label="Role">
        <option value="view">Can view</option>
        <option value="comment">Can comment</option>
        <option value="edit">Can edit</option>
      </select>
      <button disabled={!projectPath} onClick={() => onAdd(projectPath, role)}>
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </span>
  );
}

function MemberView({
  status,
  onStatusChange,
  onClose,
}: {
  status: AuthStatus;
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
}) {
  async function onSignOut() {
    await logout();
    onStatusChange({ configured: true, user: null });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Workspace</h3>
        <p className="modal-message">
          Signed in as <strong>{status.user?.name}</strong> ({status.user?.email}) — member.
        </p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
