import { useEffect, useState } from "react";
import {
  bootstrapAdmin,
  createInvite,
  listMembers,
  logout,
  removeMember,
  type AuthStatus,
  type WorkspaceUser,
} from "./workspaceAuth";

interface WorkspacePanelProps {
  status: AuthStatus;
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
}

// Reachable from a small, always-visible sidebar entry (App.tsx) rather
// than hidden away — the whole point of accounts being opt-in is that
// nothing about single-owner use changes until someone deliberately
// finds and uses this. Three states depending on `status`: not
// configured yet (bootstrap form), configured and admin (members +
// invite), configured and a plain member (just identity + sign out).
export default function WorkspacePanel({ status, onStatusChange, onClose }: WorkspacePanelProps) {
  if (!status.configured) return <BootstrapForm onStatusChange={onStatusChange} onClose={onClose} />;
  if (status.user?.role === "admin") return <MembersView status={status} onStatusChange={onStatusChange} onClose={onClose} />;
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
}: {
  status: AuthStatus;
  onStatusChange: (status: AuthStatus) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<WorkspaceUser[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then(setMembers)
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
          {members.map((m) => (
            <li key={m.id} className="workspace-member-row">
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
            </li>
          ))}
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
