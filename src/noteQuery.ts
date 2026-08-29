import type { NoteListItem } from "./api";

// Deliberately simple equality matching — no AND/OR, no ranges, no sort
// expressions. Covers the large majority of real use (a project
// dashboard, a reading list, a template picker) without building a query
// language. `type`/`tag` are the two built-in shorthands; any other key
// matches against that property's stringified value.
export interface NoteFilter {
  type?: string;
  tag?: string;
  [prop: string]: string | undefined;
}

export function matchesFilter(note: NoteListItem, filter: NoteFilter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (key === "type") {
      if (note.type !== value) return false;
    } else if (key === "tag") {
      if (!note.tags.includes(value)) return false;
    } else {
      if (String(note.properties[key] ?? "") !== value) return false;
    }
  }
  return true;
}

// Parses the simple `key: value` per-line syntax used by ```query blocks
// (src/markdown.ts) — not YAML (no nesting, no types beyond strings), just
// enough structure to write and read by hand in a note.
export function parseFilterText(text: string): NoteFilter {
  const filter: NoteFilter = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) filter[m[1]] = m[2];
  }
  return filter;
}

export function queryNotes(notes: NoteListItem[], filter: NoteFilter): NoteListItem[] {
  return notes.filter((n) => matchesFilter(n, filter));
}
