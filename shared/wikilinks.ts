// Shared between the Node server (server/db.ts, for the link graph) and the
// browser client (src/markdown.ts, for both link-graph refs and rendering
// transclusion) — the extraction regex was previously duplicated verbatim
// in both places. Takes the note body with frontmatter already stripped;
// callers that have raw (frontmatter-included) text strip it first.
export function extractWikilinkRefs(body: string): { ref: string; embed: boolean }[] {
  const re = /(!)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const results: { ref: string; embed: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    results.push({ ref: m[2].trim(), embed: Boolean(m[1]) });
  }
  return results;
}
