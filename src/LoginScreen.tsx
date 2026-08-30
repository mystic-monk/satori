import { useState } from "react";
import { login, signup, type WorkspaceUser } from "./workspaceAuth";

interface LoginScreenProps {
  inviteToken: string | null;
  onSignedIn: (user: WorkspaceUser) => void;
}

// Full top-level takeover, not a modal — this replaces the whole app UI
// (see App.tsx) whenever the server has accounts configured and this
// browser has no valid session yet. Two modes: plain login, or signup if
// the URL carries ?invite=<token> (see App.tsx for where that's parsed).
export default function LoginScreen({ inviteToken, onSignedIn }: LoginScreenProps) {
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
      const result = inviteToken ? await signup(inviteToken, email, name, password) : await login(email, password);
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">{inviteToken ? "Join this workspace" : "Sign in"}</h1>
        <p className="auth-subtitle">
          {inviteToken
            ? "You've been invited to a Satori workspace — set a name and password to join."
            : "This Satori workspace requires an account."}
        </p>
        {inviteToken && (
          <input
            className="modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            required
          />
        )}
        <input
          className="modal-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoFocus={!inviteToken}
          required
        />
        <input
          className="modal-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={inviteToken ? "Choose a password (min 8 characters)" : "Password"}
          required
        />
        {error && <p className="auth-error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : inviteToken ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
