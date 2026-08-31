import { useEffect, useState } from "react";
import { createShare, fetchShares, revokeShareApi, type Share, type ShareRole } from "./api";

interface SharePanelProps {
  path: string;
  noteTitle: string;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
}

const ROLE_LABEL: Record<ShareRole, string> = {
  view: "Can view",
  comment: "Can view & comment",
  edit: "Can edit",
};

// A modal (WorkspacePanel/SettingsPanel's pattern), not a toolbar-anchored
// popover — an earlier version tried the popover approach and it was
// genuinely broken (fixed-width box fighting flex-row content it didn't
// have room for, text clipped, no overflow handling). A modal sidesteps
// all of that: no positioning math, no fighting the viewport edge, and
// it's the same pattern already proven to work for two other panels this
// same size.
export default function SharePanel({ path, noteTitle, isOwner, open, onClose }: SharePanelProps) {
  const [shares, setShares] = useState<Share[]>([]);
  const [role, setRole] = useState<ShareRole>("view");
  const [label, setLabel] = useState("");
  const [justCreated, setJustCreated] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) fetchShares(path).then(setShares);
  }, [path, open]);

  if (!isOwner || !open) return null;

  async function onCreate() {
    const share = await createShare(path, role, label);
    setJustCreated(share);
    setLabel("");
    setCopied(false);
    setShares(await fetchShares(path));
  }

  async function onCopy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied or unavailable — the input is still
      // selectable/focusable as a fallback, nothing more to do here.
    }
  }

  async function onRevoke(token: string) {
    await revokeShareApi(token);
    if (justCreated?.token === token) setJustCreated(null);
    setShares(await fetchShares(path));
  }

  function linkFor(share: Share): string {
    const url = new URL(location.href);
    url.searchParams.set("path", path);
    url.searchParams.set("token", share.token);
    return url.toString();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Share "{noteTitle}"{shares.length > 0 ? ` (${shares.length})` : ""}</h3>
        <p className="settings-note">
          Anyone with a link below sees only this one note — nothing else in your vault.
        </p>

        <div className="share-create">
          <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)} aria-label="New share link role">
            <option value="view">Can view</option>
            <option value="comment">Can view &amp; comment</option>
            <option value="edit">Can edit</option>
          </select>
          <input
            placeholder="Label (optional)"
            aria-label="New share link label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="btn-primary" onClick={onCreate}>
            Create link
          </button>
        </div>

        {justCreated && (
          <div className="share-new-link">
            <div>Share link created — copy it now:</div>
            <div className="share-new-link-row">
              <input readOnly value={linkFor(justCreated)} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn-ghost" onClick={() => onCopy(linkFor(justCreated))}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.token}>
              <span className="share-label">{s.label}</span>
              <span className="share-role">{ROLE_LABEL[s.role]}</span>
              <button className="share-revoke" onClick={() => onRevoke(s.token)} aria-label={`Revoke share "${s.label}"`}>
                Revoke
              </button>
            </li>
          ))}
          {shares.length === 0 && <li className="share-empty">No active shares.</li>}
        </ul>

        <p className="share-note">
          Roles are enforced by this app's local server, which is on this machine (or LAN) — not by encryption, so
          this only applies to local/LAN access, not cloud-relay sync. See <code>server/collab.ts</code> and{" "}
          <code>server/relay.ts</code> for why.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
