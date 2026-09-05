// Persisted All Notes view preference — a single localStorage slot, the
// same minimal-module shape savedTableViews.ts's own get/save helpers
// use, not that file's full multiple-named-saved-views machinery (there's
// no ask here for several presets, just remembering the one choice).

export type SortKey = "title" | "type" | "date";
export type SortDir = "asc" | "desc";
export type GroupBy = "none" | "type" | "project" | "date";
export type ViewMode = "tiles" | "list";

export interface AllNotesViewState {
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
  groupBy: GroupBy;
}

const KEY = "pkm-all-notes-view";

const DEFAULT_STATE: AllNotesViewState = { viewMode: "tiles", sortKey: "date", sortDir: "desc", groupBy: "none" };

function isValid(v: unknown): v is AllNotesViewState {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    (o.viewMode === "tiles" || o.viewMode === "list") &&
    (o.sortKey === "title" || o.sortKey === "type" || o.sortKey === "date") &&
    (o.sortDir === "asc" || o.sortDir === "desc") &&
    (o.groupBy === "none" || o.groupBy === "type" || o.groupBy === "project" || o.groupBy === "date")
  );
}

export function getAllNotesViewState(): AllNotesViewState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveAllNotesViewState(state: AllNotesViewState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}
