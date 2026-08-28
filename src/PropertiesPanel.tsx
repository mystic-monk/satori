import { useMemo, useState } from "react";
import * as Y from "yjs";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";

const ORIGIN = "properties-panel";

interface PropertiesPanelProps {
  raw: string;
  ytext: Y.Text;
  readOnly?: boolean;
}

export default function PropertiesPanel({ raw, ytext, readOnly = false }: PropertiesPanelProps) {
  const parsed = useMemo(() => parseFrontmatter(raw), [raw]);
  const [open, setOpen] = useState(false);

  function writeBack(nextData: Record<string, unknown>) {
    applyTextDiff(ytext, stringifyFrontmatter(nextData, parsed.body), ORIGIN);
  }

  function updateField(key: string, value: unknown) {
    writeBack({ ...parsed.data, [key]: value });
  }

  function removeField(key: string) {
    const next = { ...parsed.data };
    delete next[key];
    writeBack(next);
  }

  function addField() {
    const key = window.prompt("Property name:")?.trim();
    if (!key || key in parsed.data) return;
    writeBack({ ...parsed.data, [key]: "" });
  }

  const entries = Object.entries(parsed.data);

  return (
    <div className="properties-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Properties{parsed.data.type ? ` · ${parsed.data.type}` : ""}
      </button>
      {open && (
        <div className="properties-body">
          {entries.length === 0 && <div className="properties-empty">No properties yet.</div>}
          {entries.map(([key, value]) => (
            <PropertyRow
              key={key}
              propKey={key}
              value={value}
              readOnly={readOnly}
              onChange={(v) => updateField(key, v)}
              onRemove={() => removeField(key)}
            />
          ))}
          {!readOnly && (
            <button className="properties-add" onClick={addField}>
              + Add property
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  propKey,
  value,
  readOnly,
  onChange,
  onRemove,
}: {
  propKey: string;
  value: unknown;
  readOnly: boolean;
  onChange: (v: unknown) => void;
  onRemove: () => void;
}) {
  let control: React.ReactNode;
  if (Array.isArray(value)) {
    control = (
      <input
        disabled={readOnly}
        value={value.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
      />
    );
  } else if (typeof value === "boolean") {
    control = <input type="checkbox" disabled={readOnly} checked={value} onChange={(e) => onChange(e.target.checked)} />;
  } else {
    control = <input disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="property-row">
      <label className="property-key">{propKey}</label>
      {control}
      {!readOnly && (
        <button className="property-remove" onClick={onRemove} title="Remove property">
          ×
        </button>
      )}
    </div>
  );
}
