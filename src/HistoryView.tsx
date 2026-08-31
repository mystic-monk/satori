import type { RecentNote } from "./recentNotes";
import { History } from "lucide-react";
import NoteTypeIcon from "./NoteTypeIcon";

interface HistoryViewProps {
  recentNotes: RecentNote[];
  onNavigate: (path: string, title: string, type: string | null) => void;
}

// Its own full-width view (rail icon, same as Graph/Table/Calendar) rather
// than a section stacked in the sidebar's note list — the sidebar list
// used to always show up to 8 recent notes above whatever you'd actually
// navigated to, eating space every single time regardless of whether you
// wanted it right then. Reuses the same localStorage-backed list
// (recentNotes.ts) the old inline section did; nothing about what's
// tracked changed, just where you go to see it.
export default function HistoryView({ recentNotes, onNavigate }: HistoryViewProps) {
  return (
    <div className="history-view">
      <h2 className="history-view-title">
        <History size={18} aria-hidden="true" /> History
      </h2>
      {recentNotes.length === 0 ? (
        <p className="history-view-empty">Notes you open will show up here.</p>
      ) : (
        <ul className="history-view-list">
          {recentNotes.map((n) => (
            <li key={n.path} onClick={() => onNavigate(n.path, n.title, n.type)}>
              <span className="note-type-icon" aria-hidden="true">
                <NoteTypeIcon type={n.type} />
              </span>
              <div className="history-view-item-text">
                <div className="note-title">{n.title}</div>
                <div className="history-view-path">{n.path}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
