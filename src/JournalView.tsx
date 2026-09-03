import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import { fetchNote, type NoteListItem } from "./api";
import { renderNoteBody } from "./markdown";
import { buildResolver } from "./noteResolver";
import { buildCitations } from "./Preview";
import { parseFrontmatter } from "../shared/frontmatter";
import { parseBlockDoc, renderBlockTreeHtml } from "./blockTree";
import BlockOutline from "./BlockOutline";
import { PenLine, Waypoints } from "lucide-react";

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
  // Today's entry (and only today's) renders live and directly editable
  // in place, LogSeq-style, instead of a read-only preview you click
  // through to open elsewhere — App.tsx keeps a single collab session
  // open for whichever note is `activePath`, and points it at today's
  // daily note while this view is showing (see its openJournal/onDailyNote).
  // These three are that same session, passed straight through; null
  // until it's connected, in which case this entry falls back to the
  // same fetched-and-loading treatment every other entry gets.
  editingPath: string | null;
  editingYtext: Y.Text | null;
  editingRaw: string;
  // Today's live entry is the one place in Journal that never routes
  // through the normal per-note toolbar (isListView is false while this
  // whole view is showing) — without this, there'd be no way to see this
  // note's connections in Graph without first navigating away from Journal.
  onViewInGraph: () => void;
}

// One continuous scrollable page — bold date heading, that day's content
// rendered below it, most recent first — instead of a filtered note list
// you click into one day at a time. Every past entry is still its own
// real note file you click through to open normally; today's entry is
// the exception — see editingPath/editingYtext above — it's a live
// LogSeq-style block outliner right on this page, no click-through.
export default function JournalView({
  notes,
  onNavigate,
  onWriteToday,
  shareToken,
  editingPath,
  editingYtext,
  editingRaw,
  onViewInGraph,
}: JournalViewProps) {
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
    // The live entry (see editingPath) gets its content from the collab
    // session, not this fetch — fetching it too would be wasted work and
    // would race the live copy with a separate, non-collaborating read.
    const missing = visible.filter((n) => n.path !== editingPath && !bodies.has(n.path));
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
  }, [visible, shareToken, editingPath]);

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
            // Today's entry, live: the collab session is connected and its
            // content is a real block doc (a brand-new daily note always
            // is — see App.tsx's onDailyNote — an old prose-only one isn't,
            // and falls through to the same read-only treatment as every
            // other entry rather than losing its content to the outliner).
            const isLive =
              n.path === editingPath && editingYtext != null && parseBlockDoc(parseFrontmatter(editingRaw).body) != null;
            return (
              <article
                key={n.path}
                className={`journal-entry ${n.title === todayIso ? "journal-entry-today" : ""} ${isLive ? "journal-entry-live" : ""}`}
                onClick={isLive ? undefined : (e) => handleClick(e, n.path, n.title)}
              >
                <header className="journal-entry-header">
                  <h2>{formatJournalHeading(n.title)}</h2>
                  <span className="journal-entry-time">
                    {n.title !== formatJournalHeading(n.title) ? `${n.title} · ` : ""}
                    Last edited {new Date(n.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                  {isLive && (
                    <button
                      className="journal-entry-graph-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewInGraph();
                      }}
                      title="View this entry's connections in Graph"
                    >
                      <Waypoints size={13} /> Graph
                    </button>
                  )}
                </header>
                {isLive ? (
                  <div className="journal-entry-body">
                    <BlockOutline key={n.path} raw={editingRaw} ytext={editingYtext!} notes={notes} />
                  </div>
                ) : raw == null ? (
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
