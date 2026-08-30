// Shared between the Node server (server/srs.ts, no actual use today but
// kept for symmetry with the Rust mirror) and the browser/Tauri frontend
// (src/FlashcardReview.tsx, which is where this is actually read — the
// review UI fetches a card's raw content via the normal fetchNote/
// read_note path and splits it client-side) — same reasoning as
// shared/frontmatter.ts and shared/wikilinks.ts: one implementation
// instead of it drifting between deployment targets.
//
// Convention: a flashcard note's body is the front, then a line
// containing exactly "---", then the back.
export function splitFrontBack(body: string): { front: string; back: string | null } {
  const lines = body.split("\n");
  const sepIndex = lines.findIndex((l) => l.trim() === "---");
  if (sepIndex === -1) return { front: body.trim(), back: null };
  return {
    front: lines.slice(0, sepIndex).join("\n").trim(),
    back: lines.slice(sepIndex + 1).join("\n").trim(),
  };
}
