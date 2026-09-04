// Per-browser UI state, same reasoning as recentNotes.ts/openTabs.ts — a
// saved view's shape isn't part of the vault's portable content.
export type RollupMode = "count" | "list" | "sum" | "average";
export interface Rollup {
  property: string;
  mode: RollupMode;
  // Which numeric property on the *related* notes to aggregate — only
  // meaningful (and required) for sum/average; unused for count/list.
  field?: string;
}
export type SortDir = "asc" | "desc";

export interface SavedTableView {
  id: string;
  name: string;
  // noteQuery.ts's own `key: value` per-line syntax (the same one
  // ```query blocks use) — deliberately not a new filter language, see
  // noteQuery.ts's own doc comment for why that stays simple on purpose.
  filterText: string;
  rollups: Rollup[];
  sortKey: string;
  sortDir: SortDir;
}

const VIEWS_KEY = "pkm-table-views";
const ACTIVE_VIEW_KEY = "pkm-table-active-view";

export function getSavedViews(): SavedTableView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedViews(views: SavedTableView[]): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

function makeId(): string {
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createView(views: SavedTableView[], name: string, filterText: string): SavedTableView[] {
  const view: SavedTableView = {
    id: makeId(),
    name,
    filterText,
    rollups: [],
    sortKey: "title",
    sortDir: "asc",
  };
  return [...views, view];
}

export function updateView(
  views: SavedTableView[],
  id: string,
  patch: Partial<Omit<SavedTableView, "id">>
): SavedTableView[] {
  return views.map((v) => (v.id === id ? { ...v, ...patch } : v));
}

export function deleteView(views: SavedTableView[], id: string): SavedTableView[] {
  return views.filter((v) => v.id !== id);
}

export function getActiveViewId(): string | null {
  return localStorage.getItem(ACTIVE_VIEW_KEY);
}

export function saveActiveViewId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_VIEW_KEY, id);
  else localStorage.removeItem(ACTIVE_VIEW_KEY);
}
