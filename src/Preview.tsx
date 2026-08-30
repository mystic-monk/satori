import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { fetchNote, type NoteListItem } from "./api";
import { extractWikilinkRefs, renderNoteBody, type CitationInfo, type RenderEnv, type ResolvedNote } from "./markdown";
import { renderMermaidBlocks } from "./mermaid-render";
import { renderMathBlocks } from "./math-render";
import { fillQueryBlocks, fillBibliographyBlocks } from "./deferredBlocks";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { buildResolver } from "./noteResolver";

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

// citekey -> reference note, built from any note with type: reference and
// a citekey property — see CitationInfo's doc comment in markdown.ts.
// Exported: App.tsx's exportEnv() needs the same map for MD/HTML/PDF
// export, which renders independently of this component.
export function buildCitations(notes: NoteListItem[]): Map<string, CitationInfo> {
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

interface PreviewProps {
  raw: string;
  notes: NoteListItem[];
  onNavigate: (path: string, fragment?: string) => void;
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

  useEffect(() => {
    if (containerRef.current) renderMathBlocks(containerRef.current);
  }, [html]);

  // Same reasoning as the mermaid effect above: a query block's results
  // depend on live note data markdown-it's synchronous renderer can't see,
  // so the fence rule (src/markdown.ts) emits a placeholder and this fills
  // it in — reruns whenever `notes` changes, so a query block updates
  // without needing to reopen the note. Results are rendered as the same
  // [data-note-path] anchors wikilinks already use, so the existing
  // handleClick below navigates them with no extra wiring.
  useEffect(() => {
    if (containerRef.current) fillQueryBlocks(containerRef.current, notes);
  }, [html, notes]);

  // Same placeholder-then-fill pattern as query blocks above: a
  // ```bibliography block lists every [@citekey] actually used in this
  // note's own source (not the whole vault), resolved through the same
  // citations map the inline citation renderer used.
  useEffect(() => {
    if (containerRef.current) fillBibliographyBlocks(containerRef.current, raw, citations);
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
    if (el) onNavigate(el.dataset.notePath!, el.dataset.fragment);
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
