import type { NoteListItem } from "./api";
import type { NoteResolver, ResolvedNote } from "./markdown";

// Resolves a wikilink-style ref (a note's path with or without .md, or its
// title, case-insensitive) to the note it names. Originally lived in
// Preview.tsx (for [[wikilinks]]/citations); TableView.tsx needs the exact
// same resolution for relation properties, so this is the one shared
// implementation both use.
export function buildResolver(notes: NoteListItem[]): NoteResolver {
  const byPath = new Map(notes.map((n) => [n.path.replace(/\.md$/, ""), n]));
  const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
  return {
    resolve(ref: string): ResolvedNote | null {
      const clean = ref.trim().replace(/\.md$/, "");
      const byP = byPath.get(clean);
      if (byP) return { path: byP.path, title: byP.title };
      const byT = byTitle.get(clean.toLowerCase());
      if (byT) return { path: byT.path, title: byT.title };
      return null;
    },
  };
}
