import { useState } from "react";
import NoteTypeIcon from "./NoteTypeIcon";
import NoteListDetailView from "./NoteListDetailView";
import type { RecentNote } from "./recentNotes";

interface HistoryGridViewProps {
  recentNotes: RecentNote[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
}

type SortKey = "title" | "type" | "opened";
type SortDir = "asc" | "desc";

const DETAIL_COLUMNS = [
  { key: "title", label: "Title", value: (n: RecentNote) => n.title },
  { key: "type", label: "Type", value: (n: RecentNote) => n.type ?? "—" },
  {
    key: "opened",
    label: "Opened",
    value: (n: RecentNote) => (n.openedAt ? new Date(n.openedAt).toLocaleString() : "—"),
    sortValue: (n: RecentNote) => n.openedAt,
  },
];

// Same tile-grid shape as Canvas/Projects, backed by recentNotes.ts
// instead of a `notes` filter — no "+ New" tile, history isn't something
// you create. Not persisted (unlike All Notes' view state): this is a
// much smaller, more session-local browsing choice, and the natural
// default (most-recently-opened first) is already what most-recent-8
// used to show inline in the sidebar, so it stays the same on every
// visit rather than needing to remember a preference.
export default function HistoryGridView({ recentNotes, onNavigate }: HistoryGridViewProps) {
  const [viewMode, setViewMode] = useState<"tiles" | "list">("tiles");
  const [sortKey, setSortKey] = useState<SortKey>("opened");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key as SortKey);
      setSortDir("asc");
    }
  }

  const tiles = [...recentNotes].sort((a, b) => b.openedAt - a.openedAt);

  return (
    <div className="tile-grid-view">
      <div className="tile-grid-toolbar">
        <div className="tile-grid-view-toggle">
          <button className={viewMode === "tiles" ? "active" : ""} onClick={() => setViewMode("tiles")}>
            Tiles
          </button>
          <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>
            List
          </button>
        </div>
      </div>
      {recentNotes.length === 0 ? (
        <p className="tile-grid-empty">Notes you open will show up here.</p>
      ) : viewMode === "list" ? (
        <NoteListDetailView
          rows={recentNotes}
          columns={DETAIL_COLUMNS}
          onNavigate={onNavigate}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
        />
      ) : (
        <div className="tile-grid">
          {tiles.map((n) => (
            <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, n.type)}>
              <NoteTypeIcon type={n.type} size={28} className="tile-icon" />
              <span className="tile-title">{n.title}</span>
              <span className="tile-date">{n.openedAt ? new Date(n.openedAt).toLocaleDateString() : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
