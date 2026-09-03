import { useMemo } from "react";
import { Paintbrush, Plus } from "lucide-react";
import type { NoteListItem } from "./api";

interface CanvasGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onNewCanvas: () => void;
}

// A Logseq-style whiteboard grid — every canvas note as a tile you click
// into, plus a "+ New Canvas" tile, instead of the generic note-list you'd
// otherwise get for a filtered type. Title + icon + last-edited date only,
// no live thumbnail of the actual drawing — rendering a real preview per
// tile would mean snapshotting every Excalidraw scene, a meaningfully
// bigger feature than this pass.
export default function CanvasGridView({ notes, onNavigate, onNewCanvas }: CanvasGridViewProps) {
  const canvasNotes = useMemo(
    () => notes.filter((n) => n.type === "canvas").sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  return (
    <div className="tile-grid-view">
      <div className="tile-grid">
        <button className="tile tile-new" onClick={onNewCanvas}>
          <Plus size={28} aria-hidden="true" />
          <span>New Canvas</span>
        </button>
        {canvasNotes.map((n) => (
          <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, "canvas")}>
            <Paintbrush size={28} className="tile-icon" aria-hidden="true" />
            <span className="tile-title">{n.title}</span>
            <span className="tile-date">{new Date(n.updatedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
