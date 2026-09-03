import { useEffect, useMemo, useState } from "react";
import { Brain, Plus } from "lucide-react";
import { fetchDueCards } from "./api";
import type { NoteListItem } from "./api";

interface FlashcardGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onNewFlashcard: () => void;
  onReview: () => void;
}

// Same tile-grid shape as Canvas/Projects — every type: flashcard note as a
// card, plus a "+ New Flashcard" tile. Flashcards previously had no way to
// just browse what you'd made — clicking the rail nav item went straight
// into FlashcardReview's study queue, with nothing to look at once nothing
// was due. The due-count pill up top hands off to that same review flow;
// this view is purely for seeing/opening what exists.
export default function FlashcardGridView({ notes, onNavigate, onNewFlashcard, onReview }: FlashcardGridViewProps) {
  const [dueCount, setDueCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDueCards().then((cards) => {
      if (!cancelled) setDueCount(cards.length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashcardNotes = useMemo(
    () => notes.filter((n) => n.type === "flashcard").sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  return (
    <div className="tile-grid-view">
      {dueCount !== null && dueCount > 0 && (
        <div className="tile-grid-header">
          <span>
            {dueCount} card{dueCount === 1 ? "" : "s"} due for review
          </span>
          <button className="tile-grid-header-btn" onClick={onReview}>
            Review now
          </button>
        </div>
      )}
      <div className="tile-grid">
        <button className="tile tile-new" onClick={onNewFlashcard}>
          <Plus size={28} aria-hidden="true" />
          <span>New Flashcard</span>
        </button>
        {flashcardNotes.map((n) => (
          <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, n.type)}>
            <Brain size={28} className="tile-icon type-color-flashcard" aria-hidden="true" />
            <span className="tile-title">{n.title}</span>
            <span className="tile-date">{new Date(n.updatedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
