import { useState } from "react";
import {
  clearEmailIdentity,
  exportIdentity,
  getIdentity,
  importIdentity,
  setDisplayName,
  setIdentityFromEmail,
  type Identity,
} from "./identity";
import PromptDialog from "./PromptDialog";

interface IdentityPanelProps {
  open: boolean;
  onClose: () => void;
}

// A modal now (SettingsPanel/WorkspacePanel's pattern), not the inline
// accordion this used to be at the top of the note-list panel — that
// accordion plus the vault switcher above it ate two rows of vertical
// space before the search box even started, which is exactly the
// clutter this was moved to fix. Reached from the rail's bottom "You:
// name" button (App.tsx), same place Settings/Workspace already live.
export default function IdentityPanel({ open, onClose }: IdentityPanelProps) {
  const [identity, setIdentity] = useState<Identity>(() => getIdentity());
  const [nameDraft, setNameDraft] = useState(identity.name);
  const [importDraft, setImportDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  if (!open) return null;

  function commitName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === identity.name) {
      setNameDraft(identity.name);
      return;
    }
    setIdentity(setDisplayName(trimmed));
  }

  async function onExport() {
    try {
      await navigator.clipboard.writeText(exportIdentity());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied or unavailable — nothing more to do here
    }
  }

  function onImport() {
    try {
      const next = importIdentity(importDraft.trim());
      setIdentity(next);
      setNameDraft(next.name);
      setImportDraft("");
      setImportError(null);
    } catch {
      setImportError("That doesn't look like a valid identity export.");
    }
  }

  async function onSubmitEmail(email: string) {
    try {
      const next = await setIdentityFromEmail(email);
      setIdentity(next);
      setNameDraft(next.name);
      setEmailPromptOpen(false);
      setEmailError(null);
    } catch {
      setEmailError("That doesn't look like a valid email address.");
    }
  }

  function onUseAnonymous() {
    setIdentity(clearEmailIdentity());
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal identity-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Your identity</h3>
        <div className="identity-body">
        <div className="identity-row">
          <span className="identity-color-dot" style={{ background: identity.color }} aria-hidden="true" />
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Your display name"
          />
        </div>
        <p className="identity-note">
          Stored only in this browser. Renaming keeps your history attributed to you; switching to a new device or
          browser doesn't carry it automatically unless you use email or export/import below.
        </p>
        <div className="identity-email">
          {identity.email ? (
            <>
              <span className="identity-email-status">Identified as {identity.email}</span>
              <button onClick={onUseAnonymous}>Use anonymous instead</button>
            </>
          ) : (
            <button onClick={() => setEmailPromptOpen(true)}>Use email instead of anonymous</button>
          )}
        </div>
        <p className="identity-note">
          Typing the same email again on any device gives you back this exact identity — no export file needed. Your
          email itself is never sent to collaborators or a server, only stored on this device; what others see is
          the same opaque id anonymous identities already use. This isn't verified — nothing confirms you actually
          own the address, it's just a more convenient way to stay portable.
        </p>
        {emailError && <p className="identity-error">{emailError}</p>}
        <div className="identity-portability">
          <button onClick={onExport}>{copied ? "Copied!" : "Export identity"}</button>
        </div>
        <div className="identity-portability">
          <input
            placeholder="Paste an exported identity here"
            aria-label="Import identity"
            value={importDraft}
            onChange={(e) => {
              setImportDraft(e.target.value);
              setImportError(null);
            }}
          />
          <button onClick={onImport} disabled={!importDraft.trim()}>
            Import
          </button>
        </div>
        {importError && <p className="identity-error">{importError}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {emailPromptOpen && (
        <PromptDialog
          title="Use email instead of anonymous"
          message="Typing the same email again on any device restores this identity. It's never sent anywhere — only stored on this browser."
          placeholder="you@example.com"
          confirmLabel="Use this email"
          onSubmit={onSubmitEmail}
          onCancel={() => {
            setEmailPromptOpen(false);
            setEmailError(null);
          }}
        />
      )}
    </div>
  );
}
