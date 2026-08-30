// Resolves a wikilink fragment ("Heading" or "^block-id", the part after
// # in [[Note#fragment]]) to a sub-range of a note's body — what makes
// ![[Note#fragment]] embed just that section/block instead of the whole
// note, and what a [[Note#fragment]] *link*'s rendered label is built
// from. Pure text-range logic, no rendering — src/markdown.ts calls this
// from the wikiembed renderer.
//
// Deliberate scope cut: a "block" here is exactly one line, not a
// multi-line paragraph merged by blank-line boundaries the way Obsidian's
// actual block model works. Put ^block-id at the end of the specific
// line you want to reference. Closing that gap later means paragraph-
// boundary detection; this covers the common case (a list item, a short
// paragraph, a single sentence) without it.

export interface ResolvedFragment {
  start: number;
  end: number;
}

function lineStartOffsets(body: string): number[] {
  const offsets = [0];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

// Exact heading-text match (case-insensitive), same as how Obsidian
// resolves [[Note#Heading]] — no fuzzy/slug matching, so renaming a
// heading breaks references to it the same honest way renaming a note
// breaks a [[wikilink]] to it already does.
export function resolveHeadingFragment(body: string, heading: string): ResolvedFragment | null {
  const lines = body.split("\n");
  const offsets = lineStartOffsets(body);
  const target = heading.trim().toLowerCase();

  let startLine = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (m && m[2].trim().toLowerCase() === target) {
      startLine = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= startLevel) {
      endLine = i;
      break;
    }
  }

  return { start: offsets[startLine], end: endLine < lines.length ? offsets[endLine] : body.length };
}

// blockId excludes the leading ^ (callers pass fragment.slice(1)).
export function resolveBlockFragment(body: string, blockId: string): ResolvedFragment | null {
  const lines = body.split("\n");
  const offsets = lineStartOffsets(body);
  for (let i = 0; i < lines.length; i++) {
    const m = /(?:^|\s)\^([\w-]+)\s*$/.exec(lines[i]);
    if (m && m[1] === blockId) {
      return { start: offsets[i], end: i + 1 < lines.length ? offsets[i + 1] : body.length };
    }
  }
  return null;
}

export function resolveFragment(body: string, fragment: string): ResolvedFragment | null {
  const trimmed = fragment.trim();
  return trimmed.startsWith("^") ? resolveBlockFragment(body, trimmed.slice(1)) : resolveHeadingFragment(body, trimmed);
}

// Strips a trailing ^block-id marker so an embedded block doesn't show
// its own plumbing — the marker is metadata, not content.
export function stripBlockMarker(text: string): string {
  return text.replace(/(?:^|\s)\^[\w-]+\s*$/, "").trimEnd();
}

// "Heading" for a heading fragment, or "block" for a ^block-id one — used
// to build a [[Note#fragment]] link's rendered label ("Note › Heading")
// without showing a raw, meaningless ^id to someone reading the link.
export function fragmentLabel(fragment: string): string {
  return fragment.trim().startsWith("^") ? "block" : fragment.trim();
}
