import type { CloudStatus } from "./cloud-collab";
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
  cloudConnected,
  onToggleCloudConnected,
  cloudStatus,
  activePath,
  canConnectCloud,
  canExport,
  onExportMd,
  onExportHtml,
  onExportPdf,
}: SettingsPanelProps) {
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
                <input
                  className="cloud-input"
                  type="password"
                  placeholder="Shared passphrase"
                  aria-label="Cloud sync shared passphrase"
                  value={cloudPassphrase}
                  onChange={(e) => onCloudPassphraseChange(e.target.value)}
                  disabled={cloudConnected}
                />
                <button
                  className="btn-primary"
                  onClick={onToggleCloudConnected}
                  disabled={!cloudConnected && (!cloudPassphrase || !relayUrl.trim())}
                >
                  {cloudConnected ? "Disconnect cloud sync" : "Connect cloud sync"}
                </button>
                {cloudConnected && (
                  <span className={`cloud-status ${cloudStatus === "decrypt-failed" ? "cloud-status-error" : ""}`}>
                    {cloudStatus === "decrypt-failed" ? "wrong passphrase — can't decrypt peer data" : cloudStatus}
                  </span>
                )}
              </div>
              <p className="cloud-warning">
                <TriangleAlert size={13} className="cloud-warning-icon" aria-hidden="true" /> Cloud sync has no
                view/edit separation yet — anyone with this passphrase can read <em>and write</em>, unlike the
                Share panel's local roles. Only share it with people you'd trust to edit.
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

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
