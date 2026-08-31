// Shared between the browser client (rendering ```timetable blocks,
// src/timetable.ts) and the Node server (scanning every note's raw body
// for timetable entries to build the calendar feed, server/calendar.ts) —
// same category as frontmatter.ts/wikilinks.ts, pure parsing with no
// DOM/Node-specific dependency either side can't use.
export interface TimetableEntry {
  day: string; // canonical 3-letter key: Mon/Tue/Wed/Thu/Fri/Sat/Sun
  start: number; // minutes from midnight
  end: number; // minutes from midnight
  title: string;
}

export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

// Finds every ```timetable fenced block in a note's raw (frontmatter-
// stripped) body and parses each — server/calendar.ts's only entry point
// into a note's content, since the index only stores properties, not a
// structured view of body content.
export function extractTimetableBlocks(body: string): TimetableEntry[] {
  const entries: TimetableEntry[] = [];
  const re = /```timetable\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    entries.push(...parseTimetable(m[1]));
  }
  return entries;
}
