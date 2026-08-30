export interface WikilinkRef {
  ref: string; // the note part only — "Note", never "Note#Heading"
  fragment: string | null; // heading text, or "^block-id" (caret included), from Note#fragment
  embed: boolean;
}

// Shared between the Node server (server/db.ts, for the link graph) and the
// browser client (src/markdown.ts, for both link-graph refs and rendering
// transclusion) — the extraction regex was previously duplicated verbatim
// in both places. Takes the note body with frontmatter already stripped;
// callers that have raw (frontmatter-included) text strip it first.
//
// `ref` is deliberately just the note part: a link-graph consumer
// (server/db.ts, src-tauri/src/links.rs) resolves `ref` to a note the same
// way it always has, unaffected by a `#Heading`/`#^block-id` suffix —
// heading/block resolution is a rendering-time concern (src/markdown.ts +
// shared/blockrefs.ts), not something the link graph itself needs to
// understand. A note either links to another note or it doesn't; *which
// part* of it is referenced doesn't change that edge.
export function extractWikilinkRefs(body: string): WikilinkRef[] {
  const re = /(!)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const results: WikilinkRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const raw = m[2].trim();
    const hashIdx = raw.indexOf("#");
    const ref = (hashIdx === -1 ? raw : raw.slice(0, hashIdx)).trim();
    const fragment = hashIdx === -1 ? null : raw.slice(hashIdx + 1).trim() || null;
    results.push({ ref, fragment, embed: Boolean(m[1]) });
  }
  return results;
}
