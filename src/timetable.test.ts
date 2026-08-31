import { describe, it, expect } from "vitest";
import { parseTimetable, renderTimetableHtml } from "./timetable";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

describe("parseTimetable", () => {
  it("parses a well-formed entry", () => {
    const entries = parseTimetable("Mon 09:00-10:30 Algebra");
    expect(entries).toEqual([{ day: "Mon", start: 540, end: 630, title: "Algebra" }]);
  });

  it("accepts full day names case-insensitively", () => {
    const entries = parseTimetable("monday 09:00-10:00 Standup\nWEDNESDAY 14:00-15:00 Sync");
    expect(entries.map((e) => e.day)).toEqual(["Mon", "Wed"]);
  });

  it("skips malformed lines instead of throwing", () => {
    const entries = parseTimetable("not a valid line\nMon 09:00-10:00 Algebra\nFoo 09:00-10:00 Bar");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Algebra");
  });

  it("skips an entry whose end is not after its start", () => {
    const entries = parseTimetable("Mon 10:00-09:00 Backwards\nMon 10:00-10:00 Zero");
    expect(entries).toHaveLength(0);
  });

  it("ignores blank lines", () => {
    const entries = parseTimetable("\nMon 09:00-10:00 Algebra\n\n");
    expect(entries).toHaveLength(1);
  });

  it("keeps a title containing extra spaces or punctuation intact", () => {
    const entries = parseTimetable("Fri 16:00-17:00 Review: Q3 planning");
    expect(entries[0].title).toBe("Review: Q3 planning");
  });
});

describe("renderTimetableHtml", () => {
  it("renders a placeholder message for an empty timetable", () => {
    const html = renderTimetableHtml([], escapeHtml);
    expect(html).toContain("No entries");
  });

  it("only includes day columns that have at least one entry", () => {
    const entries = parseTimetable("Mon 09:00-10:00 Algebra\nWed 09:00-10:00 Biology");
    const html = renderTimetableHtml(entries, escapeHtml);
    expect(html).toContain("Mon");
    expect(html).toContain("Wed");
    expect(html).not.toContain(">Tue<");
    expect(html).not.toContain(">Sun<");
  });

  it("escapes entry titles", () => {
    const entries = parseTimetable('Mon 09:00-10:00 <script>alert(1)</script>');
    const html = renderTimetableHtml(entries, escapeHtml);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("gives a longer entry a larger row span than a shorter one", () => {
    const entries = parseTimetable("Mon 09:00-11:00 Long\nMon 09:00-09:30 Short".replace("Mon 09:00-09:30 Short", "Tue 09:00-09:30 Short"));
    const html = renderTimetableHtml(entries, escapeHtml);
    const longMatch = /grid-row: (\d+) \/ (\d+);"[^>]*>\s*<div class="timetable-entry-title">Long/.exec(html);
    const shortMatch = /grid-row: (\d+) \/ (\d+);"[^>]*>\s*<div class="timetable-entry-title">Short/.exec(html);
    expect(longMatch).not.toBeNull();
    expect(shortMatch).not.toBeNull();
    const longSpan = Number(longMatch![2]) - Number(longMatch![1]);
    const shortSpan = Number(shortMatch![2]) - Number(shortMatch![1]);
    expect(longSpan).toBeGreaterThan(shortSpan);
  });
});
