import { useMemo, useState } from "react";
import { fetchNote, writeNoteApi, type NoteListItem } from "./api";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { getIdentity } from "./identity";
import { buildResolver } from "./noteResolver";
import { extractRelationRefs } from "./relations";

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
type RollupMode = "count" | "list";
interface Rollup {
  property: string;
  mode: RollupMode;
}

// A relation is just a property whose value is [[wikilink]] syntax (see
// relations.ts) — resolved against the vault's own notes, rendered as a
// clickable chip instead of plain text. A rollup column is the reverse
// direction: "which notes have property P pointing at *this* note",
// same relationship a backlink is, just keyed off a named property
// instead of an inline body link. Deliberate MVP scope cuts: rollups are
// session-local UI state (not persisted — reset when Table view remounts)
// and only count/list aggregates, no sum/average over numeric fields yet.
export default function TableView({ notes, onNavigate, onNotesChanged, shareToken }: TableViewProps) {
  const [sortKey, setSortKey] = useState<string>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingCell, setEditingCell] = useState<{ path: string; key: string; wasArray: boolean } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rollups, setRollups] = useState<Rollup[]>([]);
  const [addingRollup, setAddingRollup] = useState(false);

  const resolver = useMemo(() => buildResolver(notes), [notes]);

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

  // Which of those properties actually get used as a relation anywhere in
  // the currently visible notes — that's the pick-list for "add a rollup
  // column", since rolling up a property nobody uses as a relation would
  // always be empty.
  const relationPropertyNames = useMemo(
    () => propertyColumns.filter((col) => notes.some((n) => extractRelationRefs(n.properties[col]) !== null)),
    [propertyColumns, notes]
  );

  // One pass per rollup over the whole note list, not one pass per row —
  // targetPath -> notes whose `property` relates to that path.
  const rollupIndexes = useMemo(() => {
    const indexes = new Map<string, Map<string, NoteListItem[]>>();
    for (const { property } of rollups) {
      if (indexes.has(property)) continue;
      const index = new Map<string, NoteListItem[]>();
      for (const n of notes) {
        const refs = extractRelationRefs(n.properties[property]);
        if (!refs) continue;
        for (const ref of refs) {
          const target = resolver.resolve(ref);
          if (!target) continue;
          const bucket = index.get(target.path);
          if (bucket) bucket.push(n);
          else index.set(target.path, [n]);
        }
      }
      indexes.set(property, index);
    }
    return indexes;
  }, [rollups, notes, resolver]);

  function rollupColumnKey(r: Rollup): string {
    return `rollup:${r.property}:${r.mode}`;
  }

  function rollupValue(note: NoteListItem, r: Rollup): string {
    const related = rollupIndexes.get(r.property)?.get(note.path) ?? [];
    if (r.mode === "count") return String(related.length);
    return related.map((n) => n.title).join(", ");
  }

  const columns = [...BUILTIN_COLUMNS, ...propertyColumns, ...rollups.map(rollupColumnKey)];

  function cellValue(note: NoteListItem, col: string): string {
    if (col === "title") return note.title;
    if (col === "type") return note.type ?? "";
    if (col === "tags") return note.tags.join(", ");
    const rollup = rollups.find((r) => rollupColumnKey(r) === col);
    if (rollup) return rollupValue(note, rollup);
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

  const rollupColumnKeys = useMemo(() => new Set(rollups.map(rollupColumnKey)), [rollups]);

  function startEdit(note: NoteListItem, col: string) {
    if (!canEdit || rollupColumnKeys.has(col)) return; // rollups are computed, not stored — nothing to edit
    const raw = note.properties[col];
    // Preserve the property's array-ness through the round trip — edited
    // as a comma-separated list, saved back as an array, not collapsed
    // into a single joined string (which is what happened before this,
    // for ANY array-valued property, not just relations).
    const wasArray = Array.isArray(raw);
    const initial = wasArray ? (raw as unknown[]).map((v) => String(v)).join(", ") : cellValue(note, col);
    setEditingCell({ path: note.path, key: col, wasArray });
    setEditValue(initial);
  }

  const canEdit = !shareToken;

  async function commitEdit() {
    const cell = editingCell;
    setEditingCell(null);
    if (!cell) return;
    const note = await fetchNote(cell.path, shareToken);
    const parsed = parseFrontmatter(note.raw);
    const nextValue: unknown = cell.wasArray
      ? editValue
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : editValue;
    const nextData = { ...parsed.data, [cell.key]: nextValue };
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

  // Shared rendering for both a forward relation cell (resolved against
  // the ref text stored on this note) and a rollup "list" cell (the
  // related NoteListItems are already resolved, no ref text involved) —
  // same chip, same click-to-navigate, same broken-link styling.
  function relationChips(items: { path: string | null; title: string }[], onChipClick: (path: string) => void) {
    return (
      <span className="table-relation-cell">
        {items.map((item, i) => (
          <span
            key={i}
            className={`table-relation-chip${item.path ? "" : " table-relation-broken"}`}
            onClick={(e) => {
              if (!item.path) return;
              e.stopPropagation();
              onChipClick(item.path);
            }}
            title={item.path ? undefined : `No note found for "${item.title}"`}
          >
            {item.title}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="table-view">
      {relationPropertyNames.length > 0 && (
        <div className="table-rollup-bar">
          {rollups.map((r) => (
            <span key={rollupColumnKey(r)} className="table-rollup-chip">
              ↩ {r.property} ({r.mode})
              <button
                className="table-rollup-remove"
                onClick={() => setRollups((prev) => prev.filter((x) => x !== r))}
                aria-label={`Remove rollup column for ${r.property}`}
              >
                ×
              </button>
            </span>
          ))}
          {addingRollup ? (
            <AddRollupForm
              properties={relationPropertyNames}
              onAdd={(r) => {
                setRollups((prev) => (prev.some((x) => x.property === r.property && x.mode === r.mode) ? prev : [...prev, r]));
                setAddingRollup(false);
              }}
              onCancel={() => setAddingRollup(false)}
            />
          ) : (
            <button className="table-rollup-add" onClick={() => setAddingRollup(true)}>
              + Add rollup
            </button>
          )}
        </div>
      )}
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
                const isRollup = rollupColumnKeys.has(col);
                // title/tags stay read-only here (see the Properties panel for those); rollups are computed, not stored.
                const editableColumn = col !== "title" && col !== "tags" && !isRollup;
                const rollup = rollups.find((r) => rollupColumnKey(r) === col);
                const relationRefs = !isRollup ? extractRelationRefs(note.properties[col]) : null;
                const isRelationCell = Boolean(relationRefs) || rollup?.mode === "list";

                let content: React.ReactNode;
                if (isEditing) {
                  content = (
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
                  );
                } else if (rollup?.mode === "list") {
                  const related = rollupIndexes.get(rollup.property)?.get(note.path) ?? [];
                  content =
                    related.length > 0
                      ? relationChips(
                          related.map((n) => ({ path: n.path, title: n.title })),
                          (path) => onNavigate(path, related.find((n) => n.path === path)?.title ?? path)
                        )
                      : <span className="table-cell-empty">—</span>;
                } else if (relationRefs) {
                  const resolved = relationRefs.map((ref) => {
                    const target = resolver.resolve(ref);
                    return { path: target?.path ?? null, title: target?.title ?? ref };
                  });
                  content = relationChips(resolved, (path) => {
                    const title = resolved.find((r) => r.path === path)?.title ?? path;
                    onNavigate(path, title);
                  });
                } else {
                  content = cellValue(note, col) || <span className="table-cell-empty">—</span>;
                }

                return (
                  <td
                    key={col}
                    className={col === "title" ? "table-cell-title" : isRelationCell ? "table-cell-relation" : ""}
                    onClick={() => {
                      if (col === "title") onNavigate(note.path, note.title);
                      else if (editableColumn) startEdit(note, col);
                    }}
                  >
                    {content}
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

function AddRollupForm({
  properties,
  onAdd,
  onCancel,
}: {
  properties: string[];
  onAdd: (r: Rollup) => void;
  onCancel: () => void;
}) {
  const [property, setProperty] = useState(properties[0]);
  const [mode, setMode] = useState<RollupMode>("count");
  return (
    <span className="table-rollup-form">
      <select value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Rollup property">
        {properties.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select value={mode} onChange={(e) => setMode(e.target.value as RollupMode)} aria-label="Rollup aggregate">
        <option value="count">Count</option>
        <option value="list">List</option>
      </select>
      <button onClick={() => onAdd({ property, mode })}>Add</button>
      <button onClick={onCancel}>Cancel</button>
    </span>
  );
}
