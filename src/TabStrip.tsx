import { X } from "lucide-react";
import type { NoteListItem } from "./api";
import { activateOnEnterOrSpace } from "./a11y";

interface TabStripProps {
  openTabPaths: string[];
  notes: NoteListItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

// Exactly one live collab session exists at a time (whichever note is
// activePath) — a tab click is just openNote() on that path, the same
// thing clicking a note in the sidebar already does. This strip is purely
// a persisted, ordered list of paths you've visited; it doesn't carry its
// own session state. Title/type are resolved live from `notes` rather than
// snapshotted, so a tab doesn't go stale after the note's renamed.
export default function TabStrip({ openTabPaths, notes, activePath, onSelect, onClose }: TabStripProps) {
  if (openTabPaths.length === 0) return null;

  return (
    <div className="tab-strip">
      {openTabPaths.map((path) => {
        const note = notes.find((n) => n.path === path);
        const title = note?.title ?? path;
        return (
          <div
            key={path}
            className={`tab-strip-item ${path === activePath ? "active" : ""}`}
            onClick={() => onSelect(path)}
            onKeyDown={(e) => activateOnEnterOrSpace(e, () => onSelect(path))}
            role="button"
            tabIndex={0}
            title={path}
          >
            <span className="tab-strip-title">{title}</span>
            <button
              className="tab-strip-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              aria-label={`Close ${title}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
