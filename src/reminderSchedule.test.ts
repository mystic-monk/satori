import { describe, it, expect } from "vitest";
import { dueReminders } from "./reminderSchedule";
import type { NoteListItem } from "./api";

function note(path: string, remindAt: string | undefined): NoteListItem {
  return {
    path,
    title: path,
    tags: [],
    type: null,
    updatedAt: 0,
    favorite: false,
    properties: remindAt === undefined ? {} : { remind_at: remindAt },
  };
}

describe("dueReminders", () => {
  const now = new Date("2026-09-01T09:00:00").getTime();

  it("includes a note whose remind_at has passed", () => {
    const result = dueReminders([note("a.md", "2026-09-01T08:00")], now, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("a.md");
  });

  it("includes a note whose remind_at is exactly now", () => {
    const result = dueReminders([note("a.md", "2026-09-01T09:00")], now, new Set());
    expect(result).toHaveLength(1);
  });

  it("excludes a note whose remind_at is in the future", () => {
    const result = dueReminders([note("a.md", "2026-09-01T10:00")], now, new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes a note with no remind_at property", () => {
    const result = dueReminders([note("a.md", undefined)], now, new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes a reminder already fired this session, keyed by path+remindAt", () => {
    const already = new Set(["a.md:2026-09-01T08:00"]);
    const result = dueReminders([note("a.md", "2026-09-01T08:00")], now, already);
    expect(result).toHaveLength(0);
  });

  it("fires again if remind_at changes to a new time, even for the same note", () => {
    const already = new Set(["a.md:2026-09-01T08:00"]);
    const result = dueReminders([note("a.md", "2026-09-01T08:30")], now, already);
    expect(result).toHaveLength(1);
  });

  it("ignores a malformed remind_at value instead of throwing", () => {
    const result = dueReminders([note("a.md", "not a date")], now, new Set());
    expect(result).toHaveLength(0);
  });
});
