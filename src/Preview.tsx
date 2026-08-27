import { useEffect, useMemo, useRef, useState } from "react";
import { fetchNote, type NoteListItem } from "./api";
import { extractWikilinkRefs, renderNoteBody, type RenderEnv, type ResolvedNote } from "./markdown";

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
}

export default function Preview({ raw, notes, onNavigate }: PreviewProps) {
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
          const note = await fetchNote(m.path);
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
  }, [embedRefs, resolver, bodies]);

  const html = useMemo(() => {
    const env: RenderEnv = { resolver, bodies, pathStack: new Set() };
    return renderNoteBody(raw, env);
  }, [raw, resolver, bodies]);

  function handleClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-note-path]");
    if (el) onNavigate(el.dataset.notePath!);
  }

  return (
    <div className="preview" ref={containerRef} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
