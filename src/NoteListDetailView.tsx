interface DetailColumn<T> {
  key: string;
  label: string;
  // Display string for the cell.
  value: (row: T) => string;
  // Sort key when it differs from the display string — a formatted date
  // ("Sep 15, 2026") doesn't sort chronologically as a string the way its
  // underlying timestamp does. Falls back to value(row) when omitted.
  sortValue?: (row: T) => string | number;
}

interface NoteListDetailViewProps<T extends { path: string; title: string; type: string | null }> {
  rows: T[];
  columns: DetailColumn<T>[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  sortKey: string;
  sortDir: "asc" | "desc";
  onSortChange: (key: string) => void;
}

// The List-mode alternative to a tile grid — a compact sortable table,
// shared by History's and All Notes' own List views (different row
// shapes — RecentNote vs NoteListItem — and different columns, but the
// exact same "click a column to sort, click again to flip direction"
// behavior, so one parameterized component instead of two near-duplicate
// files). Same cellValue/toggleSort shape TableView.tsx's own sortable
// columns already use, scoped down to whatever columns the caller passes
// instead of arbitrary frontmatter properties + rollups.
export default function NoteListDetailView<T extends { path: string; title: string; type: string | null }>({
  rows,
  columns,
  onNavigate,
  sortKey,
  sortDir,
  onSortChange,
}: NoteListDetailViewProps<T>) {
  const activeColumn = columns.find((c) => c.key === sortKey) ?? columns[0];
  const sorted = [...rows].sort((a, b) => {
    const av = activeColumn.sortValue ? activeColumn.sortValue(a) : activeColumn.value(a);
    const bv = activeColumn.sortValue ? activeColumn.sortValue(b) : activeColumn.value(b);
    const cmp =
      typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <table className="note-detail-list">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} onClick={() => onSortChange(col.key)}>
              {col.label}
              {sortKey === col.key && <span className="table-sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.path} onClick={() => onNavigate(row.path, row.title, row.type)}>
            {columns.map((col) => (
              <td key={col.key}>{col.value(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
