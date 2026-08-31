import { useState } from "react";
import type { CloudStatus, CloudRole } from "./cloud-collab";
import { THEMES } from "./themes";
import { TriangleAlert } from "lucide-react";

interface SettingsPanelProps {
  onClose: () => void;
  themeId: string;
  onThemeChange: (id: string) => void;
  relayUrl: string;
  onRelayUrlChange: (url: string) => void;
  cloudRoom: string;
  onCloudRoomChange: (room: string) => void;
  cloudPassphrase: string;
  onCloudPassphraseChange: (passphrase: string) => void;
  cloudRole: CloudRole;
  onCloudRoleChange: (role: CloudRole) => void;
  cloudViewKey: string;
  onCloudViewKeyChange: (key: string) => void;
  onGetCloudViewKey: () => Promise<string>;
  cloudConnected: boolean;
  onToggleCloudConnected: () => void;
  cloudStatus: CloudStatus | "";
  activePath: string | null;
  // role === "owner" && a note is actually open — same gating the inline
  // cloud-sync bar used before this moved here (App.tsx).
  canConnectCloud: boolean;
  canExport: boolean;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  // Only true when the open note is type: book — compiling reads every
  // chapter that relates back to it (see src/compileBook.ts), so it
  // doesn't make sense for any other note type.
  canCompile: boolean;
  onCompileMd: () => void;
  onCompileHtml: () => void;
  onCompilePdf: () => void;
  compileStatus: string | null;
}

// One consolidated home for settings that used to be scattered: theme
// lived in IdentityPanel, cloud-sync connection lived inline above every
// open note (so it vanished for canvas notes/no note open), export was
// only reachable as three small buttons in the editor toolbar. Vault-wide,
// not per-note, so it's a modal (WorkspacePanel's pattern) reachable from
// the sidebar rather than tucked into the editor itself.
export default function SettingsPanel({
  onClose,
  themeId,
  onThemeChange,
  relayUrl,
  onRelayUrlChange,
  cloudRoom,
  onCloudRoomChange,
  cloudPassphrase,
  onCloudPassphraseChange,
  cloudRole,
  onCloudRoleChange,
  cloudViewKey,
  onCloudViewKeyChange,
  onGetCloudViewKey,
  cloudConnected,
  onToggleCloudConnected,
  cloudStatus,
  activePath,
  canConnectCloud,
  canExport,
  onExportMd,
  onExportHtml,
  onExportPdf,
  canCompile,
  onCompileMd,
  onCompileHtml,
  onCompilePdf,
  compileStatus,
}: SettingsPanelProps) {
  const [viewKeyPreview, setViewKeyPreview] = useState<string | null>(null);
  const [viewKeyCopied, setViewKeyCopied] = useState(false);

  async function onShowViewKey() {
    const key = await onGetCloudViewKey();
    setViewKeyPreview(key);
    setViewKeyCopied(false);
  }

  async function onCopyViewKey() {
    if (!viewKeyPreview) return;
    try {
      await navigator.clipboard.writeText(viewKeyPreview);
      setViewKeyCopied(true);
      setTimeout(() => setViewKeyCopied(false), 2000);
    } catch {
      // clipboard permission denied or unavailable — the key is still shown on screen to copy manually
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Settings</h3>

        <div className="settings-section">
          <div className="settings-section-label">Appearance</div>
          <select
            className="type-filter"
            value={themeId}
            onChange={(e) => onThemeChange(e.target.value)}
            aria-label="Theme"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Cloud sync</div>
          {canConnectCloud ? (
            <>
              <div className="cloud-role-toggle" role="radiogroup" aria-label="Connect as">
                <button
                  className={cloudRole === "edit" ? "active" : ""}
                  onClick={() => onCloudRoleChange("edit")}
                  disabled={cloudConnected}
                  aria-pressed={cloudRole === "edit"}
                >
                  Edit
                </button>
                <button
                  className={cloudRole === "view" ? "active" : ""}
                  onClick={() => onCloudRoleChange("view")}
                  disabled={cloudConnected}
                  aria-pressed={cloudRole === "view"}
                >
                  View only
                </button>
              </div>
              <div className="cloud-bar">
                <input
                  className="cloud-input"
                  placeholder="Relay server (ws://host:port)"
                  aria-label="Cloud sync relay server address"
                  value={relayUrl}
                  onChange={(e) => onRelayUrlChange(e.target.value)}
                  disabled={cloudConnected}
                />
                <input
                  className="cloud-input"
                  placeholder={`Room (default: ${activePath})`}
                  aria-label="Cloud sync room name"
                  value={cloudRoom}
                  onChange={(e) => onCloudRoomChange(e.target.value)}
                  disabled={cloudConnected}
                />
                {cloudRole === "edit" ? (
                  <input
                    className="cloud-input"
                    type="password"
                    placeholder="Shared passphrase"
                    aria-label="Cloud sync shared passphrase"
                    value={cloudPassphrase}
                    onChange={(e) => onCloudPassphraseChange(e.target.value)}
                    disabled={cloudConnected}
                  />
                ) : (
                  <input
                    className="cloud-input"
                    placeholder="Content key (from someone with edit access)"
                    aria-label="Cloud sync view-only content key"
                    value={cloudViewKey}
                    onChange={(e) => onCloudViewKeyChange(e.target.value)}
                    disabled={cloudConnected}
                  />
                )}
                <button
                  className="btn-primary"
                  onClick={onToggleCloudConnected}
                  disabled={
                    !cloudConnected &&
                    (!relayUrl.trim() || (cloudRole === "edit" ? !cloudPassphrase : !cloudViewKey.trim()))
                  }
                >
                  {cloudConnected ? "Disconnect cloud sync" : "Connect cloud sync"}
                </button>
                {cloudConnected && (
                  <span className={`cloud-status ${cloudStatus === "decrypt-failed" ? "cloud-status-error" : ""}`}>
                    {cloudStatus === "decrypt-failed" ? "wrong passphrase — can't decrypt peer data" : cloudStatus}
                  </span>
                )}
              </div>
              {cloudRole === "edit" && (
                <div className="cloud-view-key-share">
                  {viewKeyPreview ? (
                    <div className="cloud-view-key-row">
                      <code className="cloud-view-key-value">{viewKeyPreview}</code>
                      <button className="btn-ghost" onClick={onCopyViewKey}>
                        {viewKeyCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <button className="btn-ghost" onClick={onShowViewKey} disabled={!cloudPassphrase}>
                      Get a view-only key to share
                    </button>
                  )}
                </div>
              )}
              <p className="cloud-warning">
                <TriangleAlert size={13} className="cloud-warning-icon" aria-hidden="true" /> Anyone with the
                passphrase gets edit access — anyone with just a view-only content key can read but their edits are
                rejected by the relay, even if their client tried to send them.
              </p>
            </>
          ) : (
            <p className="settings-note">Open a note you own to connect cloud sync for it.</p>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Export current note</div>
          {canExport ? (
            <div className="settings-export-row">
              <button className="btn-ghost" onClick={onExportMd}>
                Markdown (.md)
              </button>
              <button className="btn-ghost" onClick={onExportHtml}>
                HTML (.html)
              </button>
              <button className="btn-ghost" onClick={onExportPdf}>
                PDF
              </button>
            </div>
          ) : (
            <p className="settings-note">Open a note (not a canvas) to export it.</p>
          )}
        </div>

        {canCompile && (
          <div className="settings-section">
            <div className="settings-section-label">Compile chapters</div>
            <p className="settings-note">
              Gathers every chapter whose <code>book</code> property points back at this note, in <code>order</code>,
              into one document.
            </p>
            <div className="settings-export-row">
              <button className="btn-ghost" onClick={onCompileMd}>
                Markdown (.md)
              </button>
              <button className="btn-ghost" onClick={onCompileHtml}>
                HTML (.html)
              </button>
              <button className="btn-ghost" onClick={onCompilePdf}>
                PDF
              </button>
            </div>
            {compileStatus && <p className="settings-note">{compileStatus}</p>}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
