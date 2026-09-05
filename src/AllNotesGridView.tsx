import { Plus } from "lucide-react";
import type { NoteListItem } from "./api";
import NoteTypeIcon from "./NoteTypeIcon";
import NoteListDetailView from "./NoteListDetailView";
import { dateBucket, DATE_BUCKET_ORDER } from "./dateBucket";
import type { AllNotesViewState, SortKey, SortDir, GroupBy, ViewMode } from "./allNotesViewState";

interface AllNotesGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onNewNote: () => void;
  emptyLabel: string;
  view: AllNotesViewState;
  onViewChange: (view: AllNotesViewState) => void;
}

function sortNotes(notes: NoteListItem[], sortKey: SortKey, sortDir: SortDir): NoteListItem[] {
  const copy = [...notes];
  copy.sort((a, b) => {
    let cmp: number;
    if (sortKey === "date") {
      cmp = a.updatedAt - b.updatedAt;
    } else {
      const av = sortKey === "title" ? a.title : (a.type ?? "");
      const bv = sortKey === "title" ? b.title : (b.type ?? "");
      cmp = av.localeCompare(bv, undefined, { numeric: true });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
  return copy;
}

// Strips [[ ]] off a wikilink-valued property for display — "project:
// [[My First Project]]" groups under "My First Project", not the raw
// bracketed string.
function projectLabel(note: NoteListItem): string {
  const raw = note.properties.project;
  if (typeof raw !== "string" || !raw.trim()) return "No project";
  return raw.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
}

interface Group {
  label: string;
  notes: NoteListItem[];
}

// Grouping only applies in Tiles mode — a grouped table (multiple <table>
// sections) is a meaningfully bigger UI than what was actually asked for
// ("group... or sort... or a detail list too" reads as three separate
// options, not a requirement that all three compose). List mode stays a
// single flat sortable table.
function groupNotes(notes: NoteListItem[], groupBy: GroupBy): Group[] {
  if (groupBy === "none") return [{ label: "", notes }];

  const map = new Map<string, NoteListItem[]>();
  const keyFor =
    groupBy === "type"
      ? (n: NoteListItem) => n.type ?? "Untyped"
      : groupBy === "project"
        ? projectLabel
        : (n: NoteListItem) => dateBucket(n.updatedAt);

  for (const n of notes) {
    const key = keyFor(n);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }

  if (groupBy === "date") {
    return DATE_BUCKET_ORDER.filter((label) => map.has(label)).map((label) => ({ label, notes: map.get(label)! }));
  }
  // "No project"/"Untyped" last, everything else alphabetical — a
  // catch-all bucket reads better trailing the real groups than
  // interleaved among them.
  const catchAll = groupBy === "project" ? "No project" : "Untyped";
  return [...map.entries()]
    .sort(([a], [b]) => (a === catchAll ? 1 : b === catchAll ? -1 : a.localeCompare(b)))
    .map(([label, groupedNotes]) => ({ label, notes: groupedNotes }));
}

const DETAIL_COLUMNS = [
  { key: "title", label: "Title", value: (n: NoteListItem) => n.title },
  { key: "type", label: "Type", value: (n: NoteListItem) => n.type ?? "—" },
  { key: "tags", label: "Tags", value: (n: NoteListItem) => n.tags.join(", ") },
  {
    key: "date",
    label: "Updated",
    value: (n: NoteListItem) => new Date(n.updatedAt).toLocaleString(),
    sortValue: (n: NoteListItem) => n.updatedAt,
  },
];

// Same tile-grid shape as Canvas/Projects/Flashcards, for the plain "All
// Notes" list itself — previously the only way to browse it was the left
// sidebar's note list, and the main panel sat on a bare "No note open"
// placeholder until you picked one from there. Notes here are a mixed bag
// of types (unlike Canvas/Flashcards' single-type grids), so each tile
// carries its NoteTypeIcon instead of one fixed icon, plus tags where a
// note has any. `view` is lifted to the caller (App.tsx) rather than
// owned here so it can persist across remounts the same way every other
// view preference in this app does (allNotesViewState.ts).
export default function AllNotesGridView({ notes, onNavigate, onNewNote, emptyLabel, view, onViewChange }: AllNotesGridViewProps) {
  const sorted = sortNotes(notes, view.sortKey, view.sortDir);

  function setSortKey(sortKey: SortKey) {
    onViewChange(view.sortKey === sortKey ? { ...view, sortDir: view.sortDir === "asc" ? "desc" : "asc" } : { ...view, sortKey, sortDir: "asc" });
  }

  function setViewMode(viewMode: ViewMode) {
    onViewChange({ ...view, viewMode });
  }

  if (notes.length === 0) {
    return (
      <div className="tile-grid-view">
        <p className="tile-grid-empty">{emptyLabel}</p>
        <div className="tile-grid">
          <button className="tile tile-new" onClick={onNewNote}>
            <Plus size={28} aria-hidden="true" />
            <span>New Note</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tile-grid-view">
      <div className="tile-grid-toolbar">
        <div className="tile-grid-toolbar-group">
          <label htmlFor="all-notes-sort">Sort</label>
          <select id="all-notes-sort" value={view.sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="date">Date updated</option>
            <option value="title">Title</option>
            <option value="type">Type</option>
          </select>
        </div>
        {view.viewMode === "tiles" && (
          <div className="tile-grid-toolbar-group">
            <label htmlFor="all-notes-group">Group by</label>
            <select
              id="all-notes-group"
              value={view.groupBy}
              onChange={(e) => onViewChange({ ...view, groupBy: e.target.value as GroupBy })}
            >
              <option value="none">None</option>
              <option value="type">Type</option>
              <option value="project">Project</option>
              <option value="date">Date</option>
            </select>
          </div>
        )}
        <div className="tile-grid-view-toggle">
          <button className={view.viewMode === "tiles" ? "active" : ""} onClick={() => setViewMode("tiles")}>
            Tiles
          </button>
          <button className={view.viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>
            List
          </button>
        </div>
      </div>

      {view.viewMode === "list" ? (
        <NoteListDetailView
          rows={sorted}
          columns={DETAIL_COLUMNS}
          onNavigate={onNavigate}
          sortKey={view.sortKey}
          sortDir={view.sortDir}
          onSortChange={(key) => setSortKey(key as SortKey)}
        />
      ) : (
        groupNotes(sorted, view.groupBy).map((group) => (
          <div key={group.label || "all"} className="tile-grid-section">
            {group.label && <div className="tile-grid-section-label">{group.label}</div>}
            <div className="tile-grid">
              {!group.label && (
                <button className="tile tile-new" onClick={onNewNote}>
                  <Plus size={28} aria-hidden="true" />
                  <span>New Note</span>
                </button>
              )}
              {group.notes.map((n) => (
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
        ))
      )}
    </div>
  );
}
