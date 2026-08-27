// Same [[ref]] / ![[ref]] extraction regex as src/markdown.ts's
// extractWikilinkRefs. Kept as a separate tiny module (rather than shared
// across the server/client boundary) so the server never pulls in
// browser-oriented rendering deps (katex, highlight.js) just to index links.
export function extractWikilinkRefs(body: string): { ref: string; embed: boolean }[] {
  const re = /(!)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const results: { ref: string; embed: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    results.push({ ref: m[2].trim(), embed: Boolean(m[1]) });
  }
  return results;
}
