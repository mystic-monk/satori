// Per-browser UI state, same reasoning as recentNotes.ts's own doc comment
// — which notes you happen to have "open" as tabs isn't part of the
// vault's portable content.
const KEY = "pkm-open-tabs";
// Generous but bounded, so heavy wikilink-hopping doesn't grow the strip
// unboundedly — evicts the oldest (front) tab once exceeded, same spirit
// as recentNotes.ts's MAX_ENTRIES cap.
const MAX_TABS = 15;

export function getOpenTabs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveOpenTabs(paths: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(paths));
}

// Unlike recentNotes' recordOpened, an already-open tab keeps its position
// instead of jumping to the front — tab order should only change when a
// tab is explicitly opened or closed, not every time you switch between
// ones already open.
export function openTab(paths: string[], path: string): string[] {
  if (paths.includes(path)) return paths;
  const next = [...paths, path];
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
}

export interface CloseTabResult {
  tabs: string[];
  // Which tab (if any) should become active if the closed one was active —
  // the immediate left neighbor, falling back to the right, then null if
  // it was the only tab open. Caller decides what to do with this (open it,
  // or clear activePath entirely).
  nextActive: string | null;
}

export function closeTab(paths: string[], path: string, activePath: string | null): CloseTabResult {
  const index = paths.indexOf(path);
  if (index === -1) return { tabs: paths, nextActive: activePath };
  const tabs = [...paths.slice(0, index), ...paths.slice(index + 1)];
  if (path !== activePath) return { tabs, nextActive: activePath };
  const nextActive = tabs[index - 1] ?? tabs[index] ?? null;
  return { tabs, nextActive };
}

// Same role as recentNotes.ts's pruneDeleted — called whenever the notes
// list refreshes, so a tab for a since-deleted note doesn't linger and
// 404 if clicked.
export function pruneOpenTabs(paths: string[], existingPaths: Set<string>): string[] {
  return paths.filter((p) => existingPaths.has(p));
}
