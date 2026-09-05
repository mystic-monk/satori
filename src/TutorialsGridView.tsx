import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import type { NoteListItem } from "./api";

interface TutorialsGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
}

// Same tile-grid shape as Canvas/Projects — every tutorial note (tagged
// "tutorial") as a tile you click into. No "+ New" tile and no toolbar,
// unlike Canvas/All Notes: this is curated, fixed content shipped with
// the app, not something created or reordered from here.
export default function TutorialsGridView({ notes, onNavigate }: TutorialsGridViewProps) {
  // Filtered by tag rather than type: every tutorial note already carries
  // tags: [tutorial] (it's what the tutorial's own query-block example
  // demonstrates), including tutorial/properties.md, which is deliberately
  // type: reference to double as the citation-system demo — a type-based
  // filter would have missed it.
  const tutorialNotes = useMemo(
    () => notes.filter((n) => n.tags.includes("tutorial")).sort((a, b) => a.title.localeCompare(b.title)),
    [notes]
  );

  return (
    <div className="tile-grid-view">
      {tutorialNotes.length === 0 && <p className="tile-grid-empty">No tutorial notes found.</p>}
      <div className="tile-grid">
        {tutorialNotes.map((n) => (
          <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, n.type)}>
            <BookOpen size={28} className="tile-icon" aria-hidden="true" />
            <span className="tile-title">{n.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
