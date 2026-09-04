import { Plus } from "lucide-react";
import type { NoteListItem } from "./api";
import NoteTypeIcon from "./NoteTypeIcon";

interface AllNotesGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onNewNote: () => void;
  emptyLabel: string;
}

// Same tile-grid shape as Canvas/Projects/Flashcards, for the plain "All
// Notes" list itself — previously the only way to browse it was the left
// sidebar's note list, and the main panel sat on a bare "No note open"
// placeholder until you picked one from there. Notes here are a mixed bag
// of types (unlike Canvas/Flashcards' single-type grids), so each tile
// carries its NoteTypeIcon instead of one fixed icon, plus tags where a
// note has any.
export default function AllNotesGridView({ notes, onNavigate, onNewNote, emptyLabel }: AllNotesGridViewProps) {
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="tile-grid-view">
      {sorted.length === 0 ? (
        <p className="tile-grid-empty">{emptyLabel}</p>
      ) : null}
      <div className="tile-grid">
        <button className="tile tile-new" onClick={onNewNote}>
          <Plus size={28} aria-hidden="true" />
          <span>New Note</span>
        </button>
        {sorted.map((n) => (
          <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, n.type)}>
            <NoteTypeIcon type={n.type} size={28} className="tile-icon" />
            <span className="tile-title">{n.title}</span>
            {n.tags.length > 0 ? (
              <span className="tile-date">{n.tags.join(", ")}</span>
            ) : (
              <span className="tile-date">{new Date(n.updatedAt).toLocaleDateString()}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
