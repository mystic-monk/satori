import { useMemo, useState } from "react";
import * as Y from "yjs";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";

const ORIGIN = "properties-panel";

interface PropertiesPanelProps {
  raw: string;
  ytext: Y.Text;
}

export default function PropertiesPanel({ raw, ytext }: PropertiesPanelProps) {
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
              onChange={(v) => updateField(key, v)}
              onRemove={() => removeField(key)}
            />
          ))}
          <button className="properties-add" onClick={addField}>
            + Add property
          </button>
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  propKey,
  value,
  onChange,
  onRemove,
}: {
  propKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onRemove: () => void;
}) {
  let control: React.ReactNode;
  if (Array.isArray(value)) {
    control = (
      <input
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
    control = <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  } else {
    control = <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="property-row">
      <label className="property-key">{propKey}</label>
      {control}
      <button className="property-remove" onClick={onRemove} title="Remove property">
        ×
      </button>
    </div>
  );
}
