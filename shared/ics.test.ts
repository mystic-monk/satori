import { describe, it, expect } from "vitest";
import { icsCalendar, reminderVevent, timetableVevent } from "./ics";
import type { TimetableEntry } from "./timetable";

describe("icsCalendar", () => {
  it("wraps VEVENT blocks in a valid VCALENDAR with CRLF line endings", () => {
    const cal = icsCalendar(["BEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT"]);
    expect(cal.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(cal).toContain("VERSION:2.0\r\n");
    expect(cal.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});

describe("reminderVevent", () => {
  it("produces a floating DTSTART with no timezone suffix", () => {
    const vevent = reminderVevent({ path: "note.md", title: "Follow up", remindAt: "2026-09-01T09:30" });
    expect(vevent).toContain("DTSTART:20260901T093000");
    expect(vevent).not.toMatch(/DTSTART:.*Z/);
  });

  it("escapes commas, semicolons, and backslashes in the title", () => {
    const vevent = reminderVevent({ path: "note.md", title: "Call: Q3, budget; review", remindAt: "2026-09-01T09:00" });
    expect(vevent).toContain("SUMMARY:Call: Q3\\, budget\\; review");
  });

  it("gives two reminders on different notes distinct UIDs", () => {
    const a = reminderVevent({ path: "a.md", title: "A", remindAt: "2026-09-01T09:00" });
    const b = reminderVevent({ path: "b.md", title: "B", remindAt: "2026-09-01T09:00" });
    const uidOf = (s: string) => /UID:(.+)/.exec(s)![1];
    expect(uidOf(a)).not.toBe(uidOf(b));
  });

  it("gives the same reminder the same UID across two calls (stable, not random)", () => {
    const a = reminderVevent({ path: "a.md", title: "A", remindAt: "2026-09-01T09:00" });
    const b = reminderVevent({ path: "a.md", title: "A", remindAt: "2026-09-01T09:00" });
    const uidOf = (s: string) => /UID:(.+)/.exec(s)![1];
    expect(uidOf(a)).toBe(uidOf(b));
  });
});

describe("timetableVevent", () => {
  const entry: TimetableEntry = { day: "Wed", start: 9 * 60, end: 10 * 60 + 30, title: "Algebra" };

  it("anchors DTSTART to the next occurrence of that weekday on or after `now`", () => {
    // 2026-08-31 is a Monday; the next Wednesday is 2026-09-02
    const now = new Date(2026, 7, 31, 8, 0);
    const vevent = timetableVevent("book.md", entry, 0, now);
    expect(vevent).toContain("DTSTART:20260902T090000");
    expect(vevent).toContain("DTEND:20260902T103000");
  });

  it("rolls over to next week if `now` is already past today's occurrence", () => {
    // A Wednesday, but after the entry's 09:00 start time
    const now = new Date(2026, 8, 2, 15, 0); // 2026-09-02 is a Wednesday, 15:00
    const vevent = timetableVevent("book.md", entry, 0, now);
    expect(vevent).toContain("DTSTART:20260909T090000");
  });

  it("sets a weekly RRULE on the correct day", () => {
    const vevent = timetableVevent("book.md", entry, 0, new Date(2026, 7, 31));
    expect(vevent).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE");
  });

  it("gives entries at the same day/time on different notes distinct UIDs via the index parameter", () => {
    const now = new Date(2026, 7, 31);
    const a = timetableVevent("book.md", entry, 0, now);
    const b = timetableVevent("book.md", entry, 1, now);
    const uidOf = (s: string) => /UID:(.+)/.exec(s)![1];
    expect(uidOf(a)).not.toBe(uidOf(b));
  });
});
