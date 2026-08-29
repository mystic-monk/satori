import { useEffect, useMemo, useRef, useState } from "react";
import { fetchNote, type NoteListItem } from "./api";
import { extractWikilinkRefs, renderNoteBody, type RenderEnv, type ResolvedNote } from "./markdown";
import { renderMermaidBlocks } from "./mermaid-render";
import { parseFilterText, queryNotes } from "./noteQuery";

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return s.replace(/[&<>"]/g, (c) => map[c]);
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
}

export default function Preview({ raw, notes, onNavigate, shareToken }: PreviewProps) {
  const [bodies, setBodies] = useState<Map<string, string>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resolver = useMemo(() => buildResolver(notes), [notes]);
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
    const env: RenderEnv = { resolver, bodies, pathStack: new Set() };
    return renderNoteBody(raw, env);
  }, [raw, resolver, bodies]);

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

  function handleClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-note-path]");
    if (el) onNavigate(el.dataset.notePath!);
  }

  return (
    <div className="preview" ref={containerRef} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
