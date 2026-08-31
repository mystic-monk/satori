import { describe, it, expect } from "vitest";
import { parseTimetable, renderTimetableHtml } from "./timetable";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

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
    const entries = parseTimetable("Mon 09:00-11:00 Long\nTue 09:00-09:30 Short");
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
