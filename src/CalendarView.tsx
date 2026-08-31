import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import type { NoteListItem } from "./api";

interface CalendarViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAILY_TITLE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A note lands on the calendar one of two ways: a daily/journal note's
// title already *is* an ISO date (App.tsx's own convention — see
// formatJournalTitle), or any other note carries a `date` property in its
// frontmatter (the same generic properties bag Table view reads, no new
// schema). Both map through the same Properties panel a user already
// knows, so "schedule this" is just "add a date property" — no new UI
// concept to learn beyond what Table view already taught.
function calendarDate(note: NoteListItem): string | null {
  if (note.type === "daily" && DAILY_TITLE_RE.test(note.title)) return note.title;
  const raw = note.properties.date;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIsoDate(parsed);
}

export default function CalendarView({ notes, onNavigate }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const byDate = useMemo(() => {
    const map = new Map<string, NoteListItem[]>();
    for (const note of notes) {
      const date = calendarDate(note);
      if (!date) continue;
      const list = map.get(date);
      if (list) list.push(note);
      else map.set(date, [note]);
    }
    return map;
  }, [notes]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = toIsoDate(new Date());

  // A full 6-row grid (42 cells) so the layout never reflows month to
  // month — a February with 4 weeks and a July with 6 both get the same
  // shape, just with leading/trailing cells from neighboring months.
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startWeekday + 1;
    cells.push({ date: new Date(year, month, dayNum), inMonth: dayNum >= 1 && dayNum <= daysInMonth });
  }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span className="calendar-month-label">
          <CalendarIcon size={14} aria-hidden="true" />
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
        <button className="calendar-today-btn" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="calendar-weekday">
            {label}
          </div>
        ))}
        {cells.map(({ date, inMonth }) => {
          const iso = toIsoDate(date);
          const dayNotes = byDate.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={`calendar-day ${inMonth ? "" : "calendar-day-outside"} ${iso === todayIso ? "calendar-day-today" : ""}`}
            >
              <div className="calendar-day-number">{date.getDate()}</div>
              <div className="calendar-day-notes">
                {dayNotes.slice(0, 4).map((n) => (
                  <button key={n.path} className="calendar-note-chip" onClick={() => onNavigate(n.path)} title={n.title}>
                    {n.title}
                  </button>
                ))}
                {dayNotes.length > 4 && <div className="calendar-note-overflow">+{dayNotes.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
