// Per-browser, like identity.ts's display name — not part of the vault's
// portable content (unlike Favorites, which is a frontmatter property):
// which notes you personally opened recently isn't something that needs
// to travel with the note or be visible to collaborators.
export interface RecentNote {
  path: string;
  title: string;
}

const KEY = "pkm-recent-notes";
const MAX_ENTRIES = 8;

export function getRecent(): RecentNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Moves an already-present entry to the front instead of duplicating it,
// so reopening a note doesn't leave stale copies of itself in the list.
export function recordOpened(path: string, title: string): RecentNote[] {
  const next = [{ path, title }, ...getRecent().filter((n) => n.path !== path)].slice(0, MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
