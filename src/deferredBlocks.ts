import type { NoteListItem } from "./api";
import { extractCitationKeys, type CitationInfo } from "./markdown";
import { parseFilterText, queryNotes } from "./noteQuery";

// Shared between Preview.tsx (live, re-run on data change via a
// useEffect) and renderForExport.ts (run once against a detached
// container before an MD/HTML/PDF export) — both need query blocks and
// bibliography blocks filled in the same way, since it's the exact same
// "placeholder emitted by markdown.ts's synchronous renderer, filled in
// once the live note/citation data is available" pattern in both places.

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return s.replace(/[&<>"]/g, (c) => map[c]);
}

// "Author (Year). Title." for the ```bibliography block's reference
// list — a plain, single citation-style format rather than trying to
// support APA/MLA/Chicago switching, which is real scope beyond what a
// first pass needs.
export function formatReferenceEntry(info: CitationInfo): string {
  const parts: string[] = [];
  if (info.author) parts.push(info.author);
  if (info.year) parts.push(`(${info.year})`);
  parts.push(info.title.endsWith(".") ? info.title : `${info.title}.`);
  return parts.join(" ");
}

// Results are rendered as the same [data-note-path] anchors wikilinks
// already use, so Preview.tsx's existing click handler navigates them
// with no extra wiring — irrelevant for the export path, which has no
// click handling at all, but harmless there either way.
export function fillQueryBlocks(container: HTMLElement, notes: NoteListItem[]): void {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(".query-block"))) {
    const filterText = el.dataset.queryFilter ?? "";
    const filter = parseFilterText(filterText);
    const results = queryNotes(notes, filter);
    el.innerHTML =
      results.length === 0
        ? `<div class="query-block-empty">No matching notes.</div>`
        : `<ul class="query-block-results">${results
            .map(
              (n) =>
                `<li><a class="wikilink" data-note-path="${escapeHtml(n.path)}" href="javascript:void(0)">${escapeHtml(n.title)}</a></li>`
            )
            .join("")}</ul>`;
  }
}

export function fillBibliographyBlocks(container: HTMLElement, raw: string, citations: Map<string, CitationInfo>): void {
  const bibBlocks = container.querySelectorAll<HTMLElement>(".bibliography-block");
  if (bibBlocks.length === 0) return;
  const entries = extractCitationKeys(raw)
    .map((key) => citations.get(key))
    .filter((info): info is CitationInfo => info !== undefined);
  const listHtml =
    entries.length === 0
      ? `<div class="bibliography-empty">No citations in this note yet — cite one with [@citekey].</div>`
      : `<ul class="bibliography-list">${entries
          .map(
            (e) =>
              `<li><a class="wikilink" data-note-path="${escapeHtml(e.path)}" href="javascript:void(0)">${escapeHtml(
                formatReferenceEntry(e)
              )}</a></li>`
          )
          .join("")}</ul>`;
  for (const el of Array.from(bibBlocks)) el.innerHTML = listHtml;
}
