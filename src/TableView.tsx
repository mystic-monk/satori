import { useMemo, useState } from "react";
import { fetchNote, writeNoteApi, type NoteListItem } from "./api";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { getIdentity } from "./identity";

interface TableViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title: string) => void;
  onNotesChanged: () => Promise<void>;
  shareToken?: string | null;
}

// Deliberate MVP scope cuts (see the plan this was built from): a single
// table layout only, no kanban/calendar/gallery; no enforced column
// schema/types (every custom-property cell is a plain text field, matching
// how frontmatter itself has no schema); no adding columns from this UI —
// add a property via the Properties panel on any note and it appears here
// automatically, same underlying data (NoteListItem.properties).
const BUILTIN_COLUMNS = ["title", "type", "tags"] as const;

type SortDir = "asc" | "desc";

export default function TableView({ notes, onNavigate, onNotesChanged, shareToken }: TableViewProps) {
  const [sortKey, setSortKey] = useState<string>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingCell, setEditingCell] = useState<{ path: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const propertyColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const n of notes) {
      for (const key of Object.keys(n.properties)) {
        // `properties` is the WHOLE frontmatter block, so title/type/tags
        // appear in it too, not just genuinely-extra fields — each of
        // those already has its own built-in column (BUILTIN_COLUMNS),
        // so including them again here would render duplicate columns.
        if (BUILTIN_COLUMNS.includes(key as (typeof BUILTIN_COLUMNS)[number]) || key === "favorite") continue;
        keys.add(key);
      }
    }
    return Array.from(keys).sort();
  }, [notes]);

  const columns = [...BUILTIN_COLUMNS, ...propertyColumns];

  function cellValue(note: NoteListItem, col: string): string {
    if (col === "title") return note.title;
    if (col === "type") return note.type ?? "";
    if (col === "tags") return note.tags.join(", ");
    return String(note.properties[col] ?? "");
  }

  const sorted = useMemo(() => {
    const copy = [...notes];
    copy.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, sortKey, sortDir]);

  function toggleSort(col: string) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  function startEdit(note: NoteListItem, col: string) {
    if (!canEdit) return;
    setEditingCell({ path: note.path, key: col });
    setEditValue(cellValue(note, col));
  }

  const canEdit = !shareToken;

  async function commitEdit() {
    const cell = editingCell;
    setEditingCell(null);
    if (!cell) return;
    const note = await fetchNote(cell.path, shareToken);
    const parsed = parseFrontmatter(note.raw);
    const nextData = { ...parsed.data, [cell.key]: editValue };
    const nextRaw = stringifyFrontmatter(nextData, parsed.body);
    const identity = getIdentity();
    try {
      await writeNoteApi(cell.path, nextRaw, { id: identity.id, name: identity.name }, shareToken);
    } catch {
      // Silently fall back to the pre-edit value on failure — same
      // "don't pretend it worked" principle as toggleFavorite's error
      // handling in App.tsx, just without a status bar to report to here.
    }
    await onNotesChanged();
  }

  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} onClick={() => toggleSort(col)}>
                {col}
                {sortKey === col && <span className="table-sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((note) => (
            <tr key={note.path}>
              {columns.map((col) => {
                const isEditing = editingCell?.path === note.path && editingCell.key === col;
                const editableColumn = col !== "title" && col !== "tags"; // title/tags stay read-only here — see the Properties panel for those
                return (
                  <td
                    key={col}
                    className={col === "title" ? "table-cell-title" : ""}
                    onClick={() => {
                      if (col === "title") onNavigate(note.path, note.title);
                      else if (editableColumn) startEdit(note, col);
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : (
                      cellValue(note, col) || <span className="table-cell-empty">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length === 0 && <div className="table-empty">No notes in this view.</div>}
    </div>
  );
}
