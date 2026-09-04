import { useState } from "react";
import type { CloudStatus, CloudRole } from "./cloud-collab";
import { THEMES } from "./themes";
import { TriangleAlert } from "lucide-react";
import { IS_TAURI } from "./platform";
import { fetchCalendarFeedToken, regenerateCalendarFeedToken } from "./api";
import { OPENAI_COMPATIBLE_PRESETS, type ChatSettings } from "./chatConfig";

interface SettingsPanelProps {
  onClose: () => void;
  themeId: string;
  onThemeChange: (id: string) => void;
  spellcheckMode: "auto" | "off";
  onSpellcheckModeChange: (mode: "auto" | "off") => void;
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
  chatSettings: ChatSettings;
  onChatSettingsChange: (settings: ChatSettings) => void;
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
  onTakeTour: () => void;
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
  spellcheckMode,
  onSpellcheckModeChange,
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
  chatSettings,
  onChatSettingsChange,
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
  onTakeTour,
}: SettingsPanelProps) {
  const [viewKeyPreview, setViewKeyPreview] = useState<string | null>(null);
  const [viewKeyCopied, setViewKeyCopied] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedUrlCopied, setFeedUrlCopied] = useState(false);

  function feedUrlFor(token: string): string {
    return `${window.location.origin}/api/calendar.ics?token=${token}`;
  }

  async function onShowFeedUrl() {
    setFeedUrl(feedUrlFor(await fetchCalendarFeedToken()));
    setFeedUrlCopied(false);
  }

  async function onRegenerateFeedUrl() {
    setFeedUrl(feedUrlFor(await regenerateCalendarFeedToken()));
    setFeedUrlCopied(false);
  }

  async function onCopyFeedUrl() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedUrlCopied(true);
      setTimeout(() => setFeedUrlCopied(false), 2000);
    } catch {
      // clipboard permission denied or unavailable — the URL is still shown on screen to copy manually
    }
  }

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
          <div className="settings-section-label">Help</div>
          <button onClick={onTakeTour}>Take a tour</button>
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Spell check</div>
          <select
            className="type-filter"
            value={spellcheckMode}
            onChange={(e) => onSpellcheckModeChange(e.target.value as "auto" | "off")}
            aria-label="Spell check mode"
          >
            <option value="off">Off (check on demand)</option>
            <option value="auto">Automatic (as you type)</option>
          </select>
          <p className="settings-note">
            Either way, ⌘K → "Check Spelling: Whole Note" or "…: Selection" runs a check right now — click a
            wavy-underlined word for suggestions.
          </p>
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

        {/* Works in both deployments — native mode retrieves via FTS5
            keyword search (src-tauri/src/chat.rs) instead of the semantic
            embeddings the Node/browser deployment uses, since fastembed
            has no Rust path yet. Different retrieval, same provider
            options either way. */}
        <div className="settings-section">
          <div className="settings-section-label">AI Chat</div>
          <div className="cloud-role-toggle" role="radiogroup" aria-label="Chat provider">
            <button
              className={chatSettings.kind === "ollama" ? "active" : ""}
              onClick={() => onChatSettingsChange({ ...chatSettings, kind: "ollama" })}
              aria-pressed={chatSettings.kind === "ollama"}
            >
              Local (Ollama)
            </button>
            <button
              className={chatSettings.kind === "openai" ? "active" : ""}
              onClick={() => onChatSettingsChange({ ...chatSettings, kind: "openai" })}
              aria-pressed={chatSettings.kind === "openai"}
            >
              OpenAI-compatible
            </button>
            <button
              className={chatSettings.kind === "anthropic" ? "active" : ""}
              onClick={() => onChatSettingsChange({ ...chatSettings, kind: "anthropic" })}
              aria-pressed={chatSettings.kind === "anthropic"}
            >
              Anthropic (Claude)
            </button>
          </div>
          {chatSettings.kind === "ollama" ? (
            <div className="cloud-bar">
              <input
                className="cloud-input"
                placeholder="Ollama server (http://localhost:11434)"
                aria-label="Ollama server address"
                value={chatSettings.ollamaBaseUrl}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, ollamaBaseUrl: e.target.value })}
              />
              <input
                className="cloud-input"
                placeholder="Model (e.g. llama3)"
                aria-label="Ollama model name"
                value={chatSettings.ollamaModel}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, ollamaModel: e.target.value })}
              />
            </div>
          ) : chatSettings.kind === "openai" ? (
            <div className="cloud-bar">
              <select
                className="cloud-input"
                aria-label="OpenAI-compatible service preset"
                value={OPENAI_COMPATIBLE_PRESETS.find((p) => p.baseUrl === chatSettings.openaiBaseUrl)?.baseUrl ?? "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") onChatSettingsChange({ ...chatSettings, openaiBaseUrl: e.target.value });
                }}
              >
                {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                  <option key={p.baseUrl} value={p.baseUrl}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input
                className="cloud-input"
                placeholder="API base URL"
                aria-label="OpenAI-compatible API base URL"
                value={chatSettings.openaiBaseUrl}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, openaiBaseUrl: e.target.value })}
              />
              <input
                className="cloud-input"
                type="password"
                placeholder="API key"
                aria-label="OpenAI-compatible API key"
                value={chatSettings.openaiApiKey}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, openaiApiKey: e.target.value })}
              />
              <input
                className="cloud-input"
                placeholder="Model (e.g. gpt-4o-mini)"
                aria-label="OpenAI-compatible model name"
                value={chatSettings.openaiModel}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, openaiModel: e.target.value })}
              />
            </div>
          ) : (
            <div className="cloud-bar">
              <input
                className="cloud-input"
                placeholder="API base URL (https://api.anthropic.com)"
                aria-label="Anthropic API base URL"
                value={chatSettings.anthropicBaseUrl}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, anthropicBaseUrl: e.target.value })}
              />
              <input
                className="cloud-input"
                type="password"
                placeholder="API key"
                aria-label="Anthropic API key"
                value={chatSettings.anthropicApiKey}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, anthropicApiKey: e.target.value })}
              />
              <input
                className="cloud-input"
                placeholder="Model (e.g. claude-sonnet-5)"
                aria-label="Anthropic model name"
                value={chatSettings.anthropicModel}
                onChange={(e) => onChatSettingsChange({ ...chatSettings, anthropicModel: e.target.value })}
              />
            </div>
          )}
          <p className="settings-note">
            {chatSettings.kind === "ollama"
              ? "Talks to a local Ollama install — nothing leaves your machine. Install Ollama and pull a model separately first."
              : chatSettings.kind === "anthropic"
                ? "A Claude.ai subscription doesn't grant API access — this needs a separate Anthropic API key from console.anthropic.com, billed per use. Sends your question and relevant note excerpts on every message."
                : "Sends your question and relevant note excerpts to this API on every message — not local, opt in deliberately."}
          </p>
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

        {!IS_TAURI && (
          <div className="settings-section">
            <div className="settings-section-label">Calendar feed</div>
            <p className="settings-note">
              Subscribe Apple/Google/Outlook Calendar to this URL to get every reminder and{" "}
              <code>​```timetable</code> entry across the vault, kept in sync automatically — each app re-fetches it
              on its own schedule, no re-import needed. (For a one-off reminder or a single timetable, the .ics
              button next to each is simpler — this is for "always up to date.")
            </p>
            {feedUrl ? (
              <>
                <div className="settings-export-row">
                  <input className="type-filter" readOnly value={feedUrl} onFocus={(e) => e.target.select()} />
                  <button className="btn-ghost" onClick={onCopyFeedUrl}>
                    {feedUrlCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <button className="btn-ghost" onClick={onRegenerateFeedUrl}>
                  Regenerate (invalidates the old URL)
                </button>
              </>
            ) : (
              <button className="btn-ghost" onClick={onShowFeedUrl}>
                Get calendar feed URL
              </button>
            )}
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
