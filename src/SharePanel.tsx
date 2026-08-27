import { useEffect, useState } from "react";
import { createShare, fetchShares, revokeShareApi, type Share, type ShareRole } from "./api";

interface SharePanelProps {
  path: string;
  isOwner: boolean;
}

const ROLE_LABEL: Record<ShareRole, string> = {
  view: "Can view",
  comment: "Can view (comment role — currently enforced same as view; see note in code)",
  edit: "Can edit",
};

export default function SharePanel({ path, isOwner }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [role, setRole] = useState<ShareRole>("view");
  const [label, setLabel] = useState("");
  const [justCreated, setJustCreated] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) fetchShares(path).then(setShares);
  }, [path, open]);

  if (!isOwner) return null;

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
    <div className="share-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Share{shares.length > 0 ? ` (${shares.length})` : ""}
      </button>
      {open && (
        <div className="share-body">
          <div className="share-create">
            <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
              <option value="view">Can view</option>
              <option value="comment">Can comment</option>
              <option value="edit">Can edit</option>
            </select>
            <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button onClick={onCreate}>Create link</button>
          </div>
          {justCreated && (
            <div className="share-new-link">
              <div>Share link created — copy it now:</div>
              <div className="share-new-link-row">
                <input readOnly value={linkFor(justCreated)} onFocus={(e) => e.currentTarget.select()} />
                <button onClick={() => onCopy(linkFor(justCreated))}>{copied ? "Copied!" : "Copy"}</button>
              </div>
            </div>
          )}
          <ul className="share-list">
            {shares.map((s) => (
              <li key={s.token}>
                <span className="share-label">{s.label}</span>
                <span className="share-role">{ROLE_LABEL[s.role]}</span>
                <button className="share-revoke" onClick={() => onRevoke(s.token)}>
                  Revoke
                </button>
              </li>
            ))}
            {shares.length === 0 && <li className="share-empty">No active shares.</li>}
          </ul>
          <p className="share-note">
            Roles are enforced by this app's local server, which is on this machine (or LAN) — not by encryption, so
            this only applies to local/LAN access, not cloud-relay sync. See server/collab.ts and server/relay.ts for
            why.
          </p>
        </div>
      )}
    </div>
  );
}
