// Per-browser, like identity.ts's display name — not part of the vault's
// portable content (unlike Favorites, which is a frontmatter property):
// which notes you personally opened recently isn't something that needs
// to travel with the note or be visible to collaborators.
export interface RecentNote {
  path: string;
  title: string;
  type: string | null;
  // Added alongside History becoming a real, sortable tile-grid view
  // (HistoryGridView.tsx) rather than a glanceable sidebar preview —
  // entries recorded before this existed don't have it, defaulted below
  // rather than dropped so old history isn't lost, just unable to be
  // placed precisely by a List-mode sort (they sort as if opened at
  // epoch 0, i.e. last).
  openedAt: number;
}

const KEY = "pkm-recent-notes";
// Raised from 8 now that History is a real browsable destination, not a
// handful-of-shortcuts sidebar preview — 8 was sized for "fits in a
// dropdown without scrolling," a concern that no longer applies now that
// the preview itself is gone.
const MAX_ENTRIES = 50;

export function getRecent(): RecentNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Entries recorded before `type`/`openedAt` existed on this shape
    // don't have them — default rather than drop them, so old
    // recent-note history isn't lost.
    return parsed.map((n) => ({ type: null, openedAt: 0, ...n }));
  } catch {
    return [];
  }
}

// Moves an already-present entry to the front instead of duplicating it,
// so reopening a note doesn't leave stale copies of itself in the list.
// openedAt is computed here, not passed in, so both call sites (App.tsx)
// stay unchanged.
export function recordOpened(path: string, title: string, type: string | null): RecentNote[] {
  const next = [{ path, title, type, openedAt: Date.now() }, ...getRecent().filter((n) => n.path !== path)].slice(
    0,
    MAX_ENTRIES
  );
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

// Deleting a note doesn't touch this list at all — it's a separate,
// per-browser cache with no link back to the vault. Left unpruned, a
// deleted note's entry lingers in History/Recent indefinitely and 404s
// if clicked. Called whenever the notes list refreshes (App.tsx), so a
// stale entry disappears the next time it would have gone stale.
export function pruneDeleted(existingPaths: Set<string>): RecentNote[] {
  const pruned = getRecent().filter((n) => existingPaths.has(n.path));
  localStorage.setItem(KEY, JSON.stringify(pruned));
  return pruned;
}
