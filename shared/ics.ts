import type { TimetableEntry } from "./timetable.js";

// iCalendar (RFC 5545) generation — the universal format every calendar
// app (Apple Calendar, Google Calendar, Outlook/Windows Calendar) already
// understands, so this is the one mechanism that reaches all three
// without registering API credentials with any of them. Two consumers:
// a local one-off export (src/export.ts's exportIcs, via the reminder
// popup and the timetable block's own export button) and the optional
// server's live feed (server/calendar.ts) that a calendar app can
// subscribe to by URL and get auto-updated.
//
// Deliberately pragmatic, not a full RFC 5545 implementation: no line
// folding for lines over 75 octets (titles are typically short — same
// "handles what real input looks like" scope cut as shared/bibtex.ts),
// and times are written as floating/local (no TZID, no trailing Z) since
// remind_at and timetable entries were never collected with a timezone
// in the first place (src/reminderSchedule.ts already treats remind_at
// this way) — most calendar apps interpret a floating DTSTART as the
// viewer's own local time, which is the only reasonable default here.

export interface ReminderEvent {
  path: string;
  title: string;
  remindAt: string; // "YYYY-MM-DDTHH:MM", datetime-local — see reminderSchedule.ts
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatFloatingDateTime(y: number, mo: number, d: number, h: number, mi: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`;
}

function nowUtcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function icsCalendar(veventBlocks: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Satori//Reminders//EN", "CALSCALE:GREGORIAN", ...veventBlocks, "END:VCALENDAR"].join(
    "\r\n"
  ) + "\r\n";
}

export function reminderVevent(r: ReminderEvent): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(r.remindAt);
  const dt = m ? formatFloatingDateTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) : "";
  const uid = `reminder-${encodeURIComponent(r.path)}-${r.remindAt}@satori.local`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowUtcStamp()}`,
    `DTSTART:${dt}`,
    `SUMMARY:${escapeIcsText(r.title)}`,
    `DESCRIPTION:${escapeIcsText(r.path)}`,
    "END:VEVENT",
  ].join("\r\n");
}

const ICS_DAY: Record<string, string> = { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA", Sun: "SU" };
const JS_DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The first upcoming occurrence of `day`/`startMinutes` from `now` — a
// weekly RRULE anchored here repeats correctly forever regardless of
// which date this resolves to, so "the next Monday" is as good an anchor
// as any specific one.
function nextOccurrence(day: string, startMinutes: number, now: Date): Date {
  const targetDow = JS_DAY_INDEX[day];
  const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  let diff = (targetDow - now.getDay() + 7) % 7;
  if (diff === 0 && result.getTime() < now.getTime()) diff = 7;
  result.setDate(result.getDate() + diff);
  return result;
}

export function timetableVevent(notePath: string, entry: TimetableEntry, index: number, now: Date = new Date()): string {
  const start = nextOccurrence(entry.day, entry.start, now);
  const end = new Date(start.getTime() + (entry.end - entry.start) * 60000);
  const uid = `timetable-${encodeURIComponent(notePath)}-${entry.day}-${entry.start}-${index}@satori.local`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowUtcStamp()}`,
    `DTSTART:${formatFloatingDateTime(start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes())}`,
    `DTEND:${formatFloatingDateTime(end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[entry.day]}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
    `DESCRIPTION:${escapeIcsText(notePath)}`,
    "END:VEVENT",
  ].join("\r\n");
}
