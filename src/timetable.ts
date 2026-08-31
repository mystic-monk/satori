export interface TimetableEntry {
  day: string; // canonical 3-letter key: Mon/Tue/Wed/Thu/Fri/Sat/Sun
  start: number; // minutes from midnight
  end: number; // minutes from midnight
  title: string;
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_ALIASES: Record<string, string> = {
  mon: "Mon",
  monday: "Mon",
  tue: "Tue",
  tues: "Tue",
  tuesday: "Tue",
  wed: "Wed",
  weds: "Wed",
  wednesday: "Wed",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  thursday: "Thu",
  fri: "Fri",
  friday: "Fri",
  sat: "Sat",
  saturday: "Sat",
  sun: "Sun",
  sunday: "Sun",
};

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// One entry per line: `Day HH:MM-HH:MM Title` — e.g. `Mon 09:00-10:30 Algebra`.
// Malformed lines are silently skipped rather than erroring the whole block,
// same "don't let one bad line break everything" approach as
// noteQuery.ts's parseFilterText.
export function parseTimetable(text: string): TimetableEntry[] {
  const entries: TimetableEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^(\S+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.+)$/.exec(trimmed);
    if (!m) continue;
    const day = DAY_ALIASES[m[1].toLowerCase()];
    if (!day) continue;
    const start = parseTime(m[2]);
    const end = parseTime(m[3]);
    if (start == null || end == null || end <= start) continue;
    entries.push({ day, start, end, title: m[4].trim() });
  }
  return entries;
}

function formatTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Shared between renderTimetableHtml (which needs row numbers to place each
// entry) and Preview.tsx's full-screen mode (which needs totalRows to size
// each row to fill the available viewport height instead of the compact
// inline default).
export function timetableGridMetrics(entries: TimetableEntry[]) {
  const minStart = Math.min(...entries.map((e) => e.start));
  const maxEnd = Math.max(...entries.map((e) => e.end));
  const gridStart = Math.floor(minStart / 60) * 60;
  const gridEnd = Math.ceil(maxEnd / 60) * 60;
  const rowFor = (mins: number) => 2 + Math.round((mins - gridStart) / 5);
  return { gridStart, gridEnd, rowFor, totalRows: rowFor(gridEnd) };
}

// A CSS Grid week view (like a calendar app), not a plain HTML table —
// entry height is proportional to duration, computed from minutes-from-
// midnight offsets, at 5-minute resolution rows. Days with zero entries
// are omitted from the columns rather than always showing all 7, so a
// weekday-only class schedule doesn't render two empty Sat/Sun columns.
export function renderTimetableHtml(
  entries: TimetableEntry[],
  escapeHtml: (s: string) => string,
  rowHeightPx = 4
): string {
  if (entries.length === 0) {
    return `<div class="timetable-empty">No entries — one per line: <code>Mon 09:00-10:30 Algebra</code></div>`;
  }

  const days = DAY_ORDER.filter((d) => entries.some((e) => e.day === d));
  const { gridStart, gridEnd, rowFor, totalRows } = timetableGridMetrics(entries);

  const hourLabels: string[] = [];
  for (let t = gridStart; t <= gridEnd; t += 60) {
    hourLabels.push(
      `<div class="timetable-hour-label" style="grid-row: ${rowFor(t)} / ${rowFor(t) + 12}; grid-column: 1;">${formatTime(t)}</div>`
    );
  }

  const dayHeaders = days
    .map((d, i) => `<div class="timetable-day-header" style="grid-column: ${i + 2};">${d}</div>`)
    .join("");

  const items = entries
    .map((e) => {
      const col = days.indexOf(e.day) + 2;
      const rowStart = rowFor(e.start);
      const rowEnd = rowFor(e.end);
      return `<div class="timetable-entry" style="grid-column: ${col}; grid-row: ${rowStart} / ${rowEnd};">
        <div class="timetable-entry-title">${escapeHtml(e.title)}</div>
        <div class="timetable-entry-time">${formatTime(e.start)}–${formatTime(e.end)}</div>
      </div>`;
    })
    .join("");

  return `<div class="timetable-grid" style="grid-template-columns: 56px repeat(${days.length}, 1fr); grid-template-rows: repeat(${totalRows}, ${rowHeightPx}px);">
    <div class="timetable-corner" style="grid-column: 1; grid-row: 1;"></div>
    ${dayHeaders}
    ${hourLabels.join("")}
    ${items}
  </div>`;
}
