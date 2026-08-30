import type { NoteListItem } from "./api";
import { renderNoteBody, type RenderEnv } from "./markdown";
import { renderMermaidBlocks } from "./mermaid-render";
import { renderMathBlocks } from "./math-render";
import { fillQueryBlocks, fillBibliographyBlocks } from "./deferredBlocks";

// MD/HTML/PDF export (App.tsx) needs the *fully* rendered note body, not
// the bare synchronous output of renderNoteBody — mermaid diagrams,
// KaTeX math, ```query blocks, and ```bibliography blocks are all
// filled in as a second pass in Preview.tsx (a live, mounted container
// plus a handful of useEffects), which export has no equivalent of.
// Found this rendering raw, unfilled placeholders into every export
// that had any of the four — this renders into a detached container,
// runs the exact same fill-in passes Preview.tsx does, and hands back
// the final HTML string.
export async function renderNoteBodyForExport(raw: string, env: RenderEnv, notes: NoteListItem[]): Promise<string> {
  const html = renderNoteBody(raw, env);
  const container = document.createElement("div");
  container.innerHTML = html;
  fillQueryBlocks(container, notes);
  fillBibliographyBlocks(container, raw, env.citations ?? new Map());
  await Promise.all([renderMermaidBlocks(container), renderMathBlocks(container)]);
  return container.innerHTML;
}
