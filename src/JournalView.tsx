import { useEffect, useMemo, useState } from "react";
import { fetchNote, type NoteListItem } from "./api";
import { renderNoteBody } from "./markdown";
import { buildResolver } from "./noteResolver";
import { buildCitations } from "./Preview";
import { parseFrontmatter } from "../shared/frontmatter";
import { parseBlockDoc, renderBlockTreeHtml } from "./blockTree";
import { PenLine } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_TITLE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 20;

// Daily-note titles are just the ISO date ("2026-08-30") — accurate but
// flat to read in a list. This heading shows something a person actually
// scans ("Today", "Yesterday", or a weekday) instead, falling back to the
// raw title for anything that isn't a plain YYYY-MM-DD (a renamed entry,
// say) so this only touches the common case.
function formatJournalHeading(title: string): string {
  if (!DAILY_TITLE_RE.test(title)) return title;
  const [y, m, d] = title.split("-").map(Number);
  const entryDate = new Date(y, m - 1, d);
  if (Number.isNaN(entryDate.getTime())) return title;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - entryDate.getTime()) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return entryDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: entryDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

interface JournalViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onWriteToday: () => void;
  shareToken?: string | null;
}

// One continuous scrollable page — bold date heading, that day's content
// rendered below it, most recent first — instead of a filtered note list
// you click into one day at a time. Each day is still its own real note
// file underneath (Satori is a flat markdown editor, not an outliner like
// the app this was modeled on, so there's no cross-day block editing
// here); clicking a heading or "Edit" opens that one note normally for
// the actual writing.
export default function JournalView({ notes, onNavigate, onWriteToday, shareToken }: JournalViewProps) {
  const dailyNotes = useMemo(
    () =>
      notes
        .filter((n) => n.type === "daily" && DAILY_TITLE_RE.test(n.title))
        .sort((a, b) => b.title.localeCompare(a.title)),
    [notes]
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = dailyNotes.slice(0, visibleCount);
  const [bodies, setBodies] = useState<Map<string, string>>(new Map());
  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const citations = useMemo(() => buildCitations(notes), [notes]);

  useEffect(() => {
    const missing = visible.filter((n) => !bodies.has(n.path));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (n) => {
        try {
          const note = await fetchNote(n.path, shareToken);
          return [n.path, note.raw] as const;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shareToken]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const hasToday = dailyNotes.some((n) => n.title === todayIso);

  function handleClick(e: React.MouseEvent, path: string, title: string) {
    // A wikilink inside the day's rendered content takes you to that note
    // instead — only fall through to "open this whole day" when the click
    // landed on the entry itself, not something inside it.
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-note-path]");
    if (link) {
      onNavigate(link.dataset.notePath!, undefined, undefined);
      return;
    }
    onNavigate(path, title, "daily");
  }

  return (
    <div className="journal-view">
      <h1 className="journal-view-title">Journal</h1>
      {!hasToday && (
        <button className="journal-today-cta" onClick={onWriteToday}>
          <PenLine size={15} aria-hidden="true" />
          Write today's entry
        </button>
      )}
      {dailyNotes.length === 0 ? (
        <p className="journal-view-empty">No journal entries yet.</p>
      ) : (
        <>
          {visible.map((n) => {
            const raw = bodies.get(n.path);
            return (
              <article
                key={n.path}
                className={`journal-entry ${n.title === todayIso ? "journal-entry-today" : ""}`}
                onClick={(e) => handleClick(e, n.path, n.title)}
              >
                <header className="journal-entry-header">
                  <h2>{formatJournalHeading(n.title)}</h2>
                  <span className="journal-entry-time">
                    {n.title !== formatJournalHeading(n.title) ? `${n.title} · ` : ""}
                    Last edited {new Date(n.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </header>
                {raw == null ? (
                  <p className="journal-entry-loading">Loading…</p>
                ) : (
                  <div
                    className="preview journal-entry-body"
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        const env = { resolver, bodies: new Map<string, string>(), pathStack: new Set<string>(), citations };
                        // A block-outline entry's body is JSON, not prose —
                        // render it as a nested read-only bullet list
                        // (respecting each block's stored collapsed state)
                        // instead of feeding raw JSON through the markdown
                        // renderer.
                        const outline = parseBlockDoc(parseFrontmatter(raw).body);
                        return outline ? renderBlockTreeHtml(outline, env) : renderNoteBody(raw, env);
                      })(),
                    }}
                  />
                )}
              </article>
            );
          })}
          {visibleCount < dailyNotes.length && (
            <button className="journal-load-more" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
              Load {Math.min(PAGE_SIZE, dailyNotes.length - visibleCount)} more
            </button>
          )}
        </>
      )}
    </div>
  );
}
