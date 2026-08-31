import { describe, it, expect } from "vitest";
import { parseTimetable, extractTimetableBlocks } from "./timetable";

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

describe("extractTimetableBlocks", () => {
  it("finds entries inside a ```timetable fence within a larger note body", () => {
    const body = [
      "# My Schedule",
      "",
      "Some intro text.",
      "",
      "```timetable",
      "Mon 09:00-10:00 Algebra",
      "Wed 14:00-15:00 Biology",
      "```",
      "",
      "More text after.",
    ].join("\n");
    const entries = extractTimetableBlocks(body);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.title)).toEqual(["Algebra", "Biology"]);
  });

  it("returns an empty array for a body with no timetable block", () => {
    expect(extractTimetableBlocks("Just some regular note text.")).toEqual([]);
  });

  it("collects entries across multiple timetable blocks in the same note", () => {
    const body = "```timetable\nMon 09:00-10:00 A\n```\n\ntext\n\n```timetable\nTue 09:00-10:00 B\n```";
    const entries = extractTimetableBlocks(body);
    expect(entries.map((e) => e.title)).toEqual(["A", "B"]);
  });
});
