import { extractWikilinkRefs } from "../shared/wikilinks";

// A property value counts as a relation when it's nothing but a single
// [[wikilink]] — or, for a list value, every element is one — same
// referencing syntax the rest of the app already uses in note bodies, so
// a relation property reads naturally even opened in a plain text editor.
// A string that merely *contains* a wikilink among other prose doesn't
// count as a relation — that's a sentence, not a reference field.
function soleWikilinkRef(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^!?\[\[[^[\]]+\]\]$/.test(trimmed)) return null;
  const matches = extractWikilinkRefs(trimmed);
  return matches.length === 1 ? matches[0].ref : null;
}

// null means "not a relation" (plain text, number, boolean, mixed array,
// empty) — callers fall back to rendering the value as plain text.
export function extractRelationRefs(value: unknown): string[] | null {
  if (typeof value === "string") {
    const ref = soleWikilinkRef(value);
    return ref ? [ref] : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const refs: string[] = [];
    for (const v of value) {
      if (typeof v !== "string") return null;
      const ref = soleWikilinkRef(v);
      if (!ref) return null;
      refs.push(ref);
    }
    return refs;
  }
  return null;
}
