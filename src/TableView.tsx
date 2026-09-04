import { useEffect, useMemo, useState } from "react";
import { fetchNote, writeNoteApi, type NoteListItem } from "./api";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { getIdentity } from "./identity";
import { buildResolver } from "./noteResolver";
import { extractRelationRefs } from "./relations";
import { parseFilterText, queryNotes } from "./noteQuery";
import {
  getSavedViews,
  saveSavedViews,
  createView,
  updateView,
  deleteView,
  getActiveViewId,
  saveActiveViewId,
  type Rollup,
  type RollupMode,
  type SortDir,
  type SavedTableView,
} from "./savedTableViews";
import { Table2, Plus, X } from "lucide-react";

interface TableViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title: string) => void;
  onNotesChanged: () => Promise<void>;
  shareToken?: string | null;
  // Called whenever a saved view is selected or created — a view's own
  // filter text (see noteQuery.ts) is meant to be the sole source of
  // scoping while it's active, not silently intersected with whatever the
  // sidebar's global type filter happens to be set to (App.tsx's own
  // displayedNotes already narrowed `notes` before it ever reaches here).
  onClearTypeFilter: () => void;
  // Read-only, just to pre-fill "+ New View"'s filter text with `type: X`
  // when the sidebar happens to be scoped to a type already — capturing
  // "save what I'm currently looking at" cheaply, without carrying
  // forward rollups/sort too.
  typeFilter: string;
}

// Deliberate MVP scope cuts (see the plan this was built from): a single
// table layout only, no kanban/calendar/gallery; no enforced column
// schema/types (every custom-property cell is a plain text field, matching
// how frontmatter itself has no schema); no adding columns from this UI —
// add a property via the Properties panel on any note and it appears here
// automatically, same underlying data (NoteListItem.properties).
const BUILTIN_COLUMNS = ["title", "type", "tags"] as const;

const ROLLUPS_STORAGE_KEY = "pkm-table-rollups";

function loadStoredRollups(): Rollup[] {
  try {
    const raw = localStorage.getItem(ROLLUPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A relation is just a property whose value is [[wikilink]] syntax (see
// relations.ts) — resolved against the vault's own notes, rendered as a
// clickable chip instead of plain text. A rollup column is the reverse
// direction: "which notes have property P pointing at *this* note",
// same relationship a backlink is, just keyed off a named property
// instead of an inline body link. Rollups persist across reopening Table
// view (localStorage, same per-browser-not-per-vault scope as every other
// UI preference here — theme, sidebar width) and support sum/average over
// a chosen numeric property on the related notes, not just count/list.
export default function TableView({
  notes,
  onNavigate,
  onNotesChanged,
  shareToken,
  onClearTypeFilter,
  typeFilter,
}: TableViewProps) {
  // "All Notes" (no saved view selected) keeps the exact single-slot
  // behavior this file always had — legacyRollups/legacySortKey/
  // legacySortDir persist to the same ROLLUPS_STORAGE_KEY as before.
  // Selecting a saved view switches `rollups`/`sortKey`/`sortDir` below to
  // read from (and write into) that view's own record instead — plain
  // derived values, not separate state, so there's no sync-loop between
  // "load from the active view" and "persist changes back to it".
  const [legacyRollups, setLegacyRollups] = useState<Rollup[]>(loadStoredRollups);
  const [legacySortKey, setLegacySortKey] = useState<string>("title");
  const [legacySortDir, setLegacySortDir] = useState<SortDir>("asc");
  const [views, setViews] = useState<SavedTableView[]>(getSavedViews);
  const [activeViewId, setActiveViewId] = useState<string | null>(getActiveViewId);
  const [addingView, setAddingView] = useState(false);
  const [editingCell, setEditingCell] = useState<{ path: string; key: string; wasArray: boolean } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addingRollup, setAddingRollup] = useState(false);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const rollups = activeView ? activeView.rollups : legacyRollups;
  const sortKey = activeView ? activeView.sortKey : legacySortKey;
  const sortDir = activeView ? activeView.sortDir : legacySortDir;

  useEffect(() => {
    localStorage.setItem(ROLLUPS_STORAGE_KEY, JSON.stringify(legacyRollups));
  }, [legacyRollups]);

  useEffect(() => {
    saveSavedViews(views);
  }, [views]);

  useEffect(() => {
    saveActiveViewId(activeViewId);
  }, [activeViewId]);

  function setRollups(next: Rollup[] | ((prev: Rollup[]) => Rollup[])) {
    const resolved = typeof next === "function" ? next(rollups) : next;
    if (activeView) setViews((prev) => updateView(prev, activeView.id, { rollups: resolved }));
    else setLegacyRollups(resolved);
  }

  function setSortKey(key: string) {
    if (activeView) setViews((prev) => updateView(prev, activeView.id, { sortKey: key }));
    else setLegacySortKey(key);
  }

  function setSortDir(dir: SortDir) {
    if (activeView) setViews((prev) => updateView(prev, activeView.id, { sortDir: dir }));
    else setLegacySortDir(dir);
  }

  function selectView(id: string | null) {
    setActiveViewId(id);
    onClearTypeFilter();
  }

  const resolver = useMemo(() => buildResolver(notes), [notes]);

  // The view's own filter (noteQuery.ts's simple key: value syntax) is the
  // sole source of scoping while a view is active — selectView() above
  // already clears App's global type filter so the two never compound
  // into a confusing double-filtered/empty result.
  const scopedNotes = useMemo(
    () => (activeView ? queryNotes(notes, parseFilterText(activeView.filterText)) : notes),
    [notes, activeView]
  );

  // Derived from scopedNotes, not the raw notes prop — a properly scoped
  // view (e.g. "type: book") naturally shows only that type's columns
  // instead of the full vault's property union.
  const propertyColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const n of scopedNotes) {
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
  }, [scopedNotes]);

  // Which of those properties actually get used as a relation anywhere in
  // the currently visible notes — that's the pick-list for "add a rollup
  // column", since rolling up a property nobody uses as a relation would
  // always be empty.
  const relationPropertyNames = useMemo(
    () => propertyColumns.filter((col) => scopedNotes.some((n) => extractRelationRefs(n.properties[col]) !== null)),
    [propertyColumns, scopedNotes]
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
    // `field` included — two rollups on the same relation property but
    // different aggregated fields (sum of `price` vs sum of `quantity`)
    // are different columns, not the same one overwriting itself.
    return `rollup:${r.property}:${r.mode}${r.field ? `:${r.field}` : ""}`;
  }

  function rollupValue(note: NoteListItem, r: Rollup): string {
    const related = rollupIndexes.get(r.property)?.get(note.path) ?? [];
    if (r.mode === "count") return String(related.length);
    if (r.mode === "list") return related.map((n) => n.title).join(", ");
    // sum/average: parse each related note's `field` property as a
    // number, skipping anything that isn't one (no enforced column
    // schema here, same as everywhere else — a non-numeric or missing
    // value just doesn't contribute rather than erroring or counting as
    // zero, which would otherwise skew an average toward zero for notes
    // that simply haven't set that property yet).
    const numbers = related.map((n) => Number(n.properties[r.field ?? ""])).filter((n) => !Number.isNaN(n));
    if (numbers.length === 0) return r.mode === "sum" ? "0" : "—";
    const sum = numbers.reduce((a, b) => a + b, 0);
    const value = r.mode === "sum" ? sum : sum / numbers.length;
    // Round to at most 2 decimals without forcing trailing zeros (12 stays
    // "12", 12.5 stays "12.5", 12.333... becomes "12.33").
    return String(Math.round(value * 100) / 100);
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
    const copy = [...scopedNotes];
    copy.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedNotes, sortKey, sortDir]);

  function toggleSort(col: string) {
    if (sortKey === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
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
      <div className="table-view-tabs">
        <button className={`table-view-tab ${activeView ? "" : "active"}`} onClick={() => selectView(null)}>
          All Notes
        </button>
        {views.map((v) => (
          <button
            key={v.id}
            className={`table-view-tab ${activeView?.id === v.id ? "active" : ""}`}
            onClick={() => selectView(v.id)}
          >
            <span className="table-view-tab-name">{v.name}</span>
            <span
              className="table-view-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                setViews((prev) => deleteView(prev, v.id));
                if (activeViewId === v.id) selectView(null);
              }}
              role="button"
              aria-label={`Delete view ${v.name}`}
            >
              <X size={12} />
            </span>
          </button>
        ))}
        {addingView ? (
          <NewViewForm
            initialFilterText={typeFilter ? `type: ${typeFilter}` : ""}
            onAdd={(name, filterText) => {
              setViews((prev) => {
                const next = createView(prev, name, filterText);
                selectView(next[next.length - 1].id);
                return next;
              });
              setAddingView(false);
            }}
            onCancel={() => setAddingView(false)}
          />
        ) : (
          <button className="table-view-tab-add" onClick={() => setAddingView(true)}>
            <Plus size={13} aria-hidden="true" /> New View
          </button>
        )}
      </div>
      {relationPropertyNames.length > 0 && (
        <div className="table-rollup-bar">
          {rollups.map((r) => (
            <span key={rollupColumnKey(r)} className="table-rollup-chip">
              ↩ {r.property} ({r.mode}
              {r.field ? ` of ${r.field}` : ""})
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
              fieldOptions={propertyColumns}
              onAdd={(r) => {
                setRollups((prev) => (prev.some((x) => rollupColumnKey(x) === rollupColumnKey(r)) ? prev : [...prev, r]));
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
      {scopedNotes.length === 0 && (
        <div className="table-empty">
          <Table2 size={32} aria-hidden="true" />
          No notes in this view.
        </div>
      )}
    </div>
  );
}

function AddRollupForm({
  properties,
  fieldOptions,
  onAdd,
  onCancel,
}: {
  properties: string[];
  // Candidate properties to sum/average over the related notes — every
  // property in play, not just relation ones; no enforced schema means
  // there's no reliable way to know in advance which ones are numeric on
  // any given note, so this isn't filtered down further (same "don't
  // pretend to validate a schema-free field" posture as the rest of this
  // file).
  fieldOptions: string[];
  onAdd: (r: Rollup) => void;
  onCancel: () => void;
}) {
  const [property, setProperty] = useState(properties[0]);
  const [mode, setMode] = useState<RollupMode>("count");
  const [field, setField] = useState(fieldOptions[0] ?? "");
  const needsField = mode === "sum" || mode === "average";
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
        <option value="sum">Sum</option>
        <option value="average">Average</option>
      </select>
      {needsField && (
        <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Rollup field to aggregate">
          {fieldOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      <button disabled={needsField && !field} onClick={() => onAdd({ property, mode, field: needsField ? field : undefined })}>
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </span>
  );
}

// Reveal-a-small-form-inline, same pattern AddRollupForm above already
// uses rather than a modal. The filter textarea uses noteQuery.ts's own
// `key: value` per-line syntax — the same one ```query blocks already
// use — so there's no new syntax to teach here.
function NewViewForm({
  initialFilterText,
  onAdd,
  onCancel,
}: {
  initialFilterText: string;
  onAdd: (name: string, filterText: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [filterText, setFilterText] = useState(initialFilterText);
  return (
    <span className="table-new-view-form">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="View name…"
        aria-label="View name"
      />
      <textarea
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        placeholder={"type: book\nstatus: to-read"}
        rows={2}
        aria-label="View filter"
      />
      <button disabled={!name.trim()} onClick={() => onAdd(name.trim(), filterText)}>
        Create
      </button>
      <button onClick={onCancel}>Cancel</button>
    </span>
  );
}
