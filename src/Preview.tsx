import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { fetchNote, type NoteListItem } from "./api";
import {
  extractCitationKeys,
  extractWikilinkRefs,
  renderNoteBody,
  type CitationInfo,
  type RenderEnv,
  type ResolvedNote,
} from "./markdown";
import { renderMermaidBlocks } from "./mermaid-render";
import { parseFilterText, queryNotes } from "./noteQuery";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";

// The inverse of markdown.ts's taskListsPlugin: `line` is the checkbox's
// list-item start line within the frontmatter-stripped body (same
// numbering markdown-it used to produce it), so toggling has to strip
// frontmatter the same way before indexing into lines, then re-attach it.
function toggleTaskLine(raw: string, line: number): string {
  const { data, body } = parseFrontmatter(raw);
  const lines = body.split("\n");
  if (line < 0 || line >= lines.length) return raw;
  const current = lines[line];
  lines[line] = current.includes("[ ]") ? current.replace("[ ]", "[x]") : current.replace(/\[[xX]\]/, "[ ]");
  return stringifyFrontmatter(data, lines.join("\n"));
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return s.replace(/[&<>"]/g, (c) => map[c]);
}

// citekey -> reference note, built from any note with type: reference and
// a citekey property — see CitationInfo's doc comment in markdown.ts.
function buildCitations(notes: NoteListItem[]): Map<string, CitationInfo> {
  const map = new Map<string, CitationInfo>();
  for (const n of notes) {
    if (n.type !== "reference") continue;
    const key = n.properties.citekey;
    if (typeof key !== "string" || !key) continue;
    const author = n.properties.author;
    const year = n.properties.year;
    map.set(key, {
      path: n.path,
      title: n.title,
      author: typeof author === "string" ? author : undefined,
      year: typeof year === "string" || typeof year === "number" ? String(year) : undefined,
    });
  }
  return map;
}

// "Author (Year). Title." for the ```bibliography block's reference
// list — a plain, single citation-style format rather than trying to
// support APA/MLA/Chicago switching, which is real scope beyond what a
// first pass needs.
function formatReferenceEntry(info: CitationInfo): string {
  const parts: string[] = [];
  if (info.author) parts.push(info.author);
  if (info.year) parts.push(`(${info.year})`);
  parts.push(info.title.endsWith(".") ? info.title : `${info.title}.`);
  return parts.join(" ");
}

export function buildResolver(notes: NoteListItem[]) {
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

interface PreviewProps {
  raw: string;
  notes: NoteListItem[];
  onNavigate: (path: string) => void;
  shareToken?: string | null;
  ytext?: Y.Text;
  readOnly?: boolean;
}

export default function Preview({ raw, notes, onNavigate, shareToken, ytext, readOnly }: PreviewProps) {
  const [bodies, setBodies] = useState<Map<string, string>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const citations = useMemo(() => buildCitations(notes), [notes]);
  const embedRefs = useMemo(() => extractWikilinkRefs(raw).filter((r) => r.embed), [raw]);

  useEffect(() => {
    const missing = embedRefs
      .map((r) => resolver.resolve(r.ref))
      .filter((r): r is ResolvedNote => r !== null && !bodies.has(r.path));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (m) => {
        try {
          const note = await fetchNote(m.path, shareToken);
          return [m.path, note.raw] as const;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setBodies((prev) => {
        const next = new Map(prev);
        for (const r of results) if (r) next.set(r[0], r[1]);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [embedRefs, resolver, bodies, shareToken]);

  const html = useMemo(() => {
    const env: RenderEnv = { resolver, bodies, pathStack: new Set(), citations };
    return renderNoteBody(raw, env);
  }, [raw, resolver, bodies, citations]);

  useEffect(() => {
    if (containerRef.current) renderMermaidBlocks(containerRef.current);
  }, [html]);

  // Same reasoning as the mermaid effect above: a query block's results
  // depend on live note data markdown-it's synchronous renderer can't see,
  // so the fence rule (src/markdown.ts) emits a placeholder and this fills
  // it in — reruns whenever `notes` changes, so a query block updates
  // without needing to reopen the note. Results are rendered as the same
  // [data-note-path] anchors wikilinks already use, so the existing
  // handleClick below navigates them with no extra wiring.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
  }, [html, notes]);

  // Same placeholder-then-fill pattern as query blocks above: a
  // ```bibliography block lists every [@citekey] actually used in this
  // note's own source (not the whole vault), resolved through the same
  // citations map the inline citation renderer used.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
  }, [html, raw, citations]);

  function handleClick(e: React.MouseEvent) {
    const checkbox = (e.target as HTMLElement).closest<HTMLInputElement>(".task-checkbox");
    if (checkbox) {
      if (readOnly || !ytext) {
        e.preventDefault();
        return;
      }
      const line = Number(checkbox.dataset.line);
      applyTextDiff(ytext, toggleTaskLine(ytext.toString(), line), "task-toggle");
      return;
    }
    const copyBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".code-copy-btn");
    if (copyBtn) {
      const code = copyBtn.dataset.code ?? "";
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-note-path]");
    if (el) onNavigate(el.dataset.notePath!);
  }

  return (
    <div
      className={`preview${readOnly ? " preview-readonly" : ""}`}
      ref={containerRef}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
