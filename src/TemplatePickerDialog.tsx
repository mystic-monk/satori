import { useEffect } from "react";
import type { NoteListItem } from "./api";

interface TemplatePickerDialogProps {
  templates: NoteListItem[];
  onSelect: (path: string) => void;
  onCancel: () => void;
}

// A note with `type: template` is a template — that's the whole
// convention (see submitCreatePrompt in App.tsx for the {{date}}/{{title}}
// substitution that happens after picking one here).
export default function TemplatePickerDialog({ templates, onSelect, onCancel }: TemplatePickerDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
      >
        <h3 className="modal-title" id="template-picker-title">
          Choose a template
        </h3>
        <ul className="command-palette-list template-picker-list">
          {templates.map((t) => (
            <li key={t.path} onClick={() => onSelect(t.path)}>
              <span className="command-palette-label">{t.title}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
