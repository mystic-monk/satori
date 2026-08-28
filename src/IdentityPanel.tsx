import { useState } from "react";
import { exportIdentity, getIdentity, importIdentity, setDisplayName, type Identity } from "./identity";
import { THEMES } from "./themes";

interface IdentityPanelProps {
  themeId: string;
  onThemeChange: (id: string) => void;
}

// Vault-wide, not per-note — unlike PropertiesPanel/SharePanel/HistoryPanel
// (which all render inside the activePath block), this is who *you* are
// across every note, so it's rendered once near the top of the sidebar.
// Theme lives here too (App.tsx still owns the actual themeId state, since
// it drives the applyTheme()/isDarkTheme() effect there) — it's a personal
// preference in the same category as display name/color, not something
// that needed its own settings surface.
export default function IdentityPanel({ themeId, onThemeChange }: IdentityPanelProps) {
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity>(() => getIdentity());
  const [nameDraft, setNameDraft] = useState(identity.name);
  const [importDraft, setImportDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="identity-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} You: {identity.name}
      </button>
      {open && (
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
            Stored only in this browser. Renaming keeps your history attributed to you; switching to a new
            device or browser doesn't carry it automatically — export it here and import it there to keep the
            same identity.
          </p>
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
          <select
            className="type-filter"
            value={themeId}
            onChange={(e) => onThemeChange(e.target.value)}
            aria-label="Theme"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                Theme: {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
