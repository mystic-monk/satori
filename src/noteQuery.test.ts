import { describe, expect, it } from "vitest";
import { matchesFilter, parseFilterText, queryNotes } from "./noteQuery";
import type { NoteListItem } from "./api";

function note(overrides: Partial<NoteListItem>): NoteListItem {
  return {
    path: "test.md",
    title: "Test",
    tags: [],
    type: null,
    updatedAt: 0,
    favorite: false,
    properties: {},
    ...overrides,
  };
}

describe("matchesFilter", () => {
  it("matches on type", () => {
    expect(matchesFilter(note({ type: "daily" }), { type: "daily" })).toBe(true);
    expect(matchesFilter(note({ type: "canvas" }), { type: "daily" })).toBe(false);
  });

  it("matches on tag membership", () => {
    expect(matchesFilter(note({ tags: ["a", "b"] }), { tag: "a" })).toBe(true);
    expect(matchesFilter(note({ tags: ["a", "b"] }), { tag: "c" })).toBe(false);
  });

  it("matches arbitrary properties by stringified value", () => {
    expect(matchesFilter(note({ properties: { priority: "high" } }), { priority: "high" })).toBe(true);
    expect(matchesFilter(note({ properties: { priority: "low" } }), { priority: "high" })).toBe(false);
  });

  it("requires every filter key to match (implicit AND)", () => {
    const n = note({ type: "daily", tags: ["project-x"] });
    expect(matchesFilter(n, { type: "daily", tag: "project-x" })).toBe(true);
    expect(matchesFilter(n, { type: "daily", tag: "project-y" })).toBe(false);
  });

  it("an empty filter matches everything", () => {
    expect(matchesFilter(note({}), {})).toBe(true);
  });
});

describe("parseFilterText", () => {
  it("parses key: value lines into a filter object", () => {
    expect(parseFilterText("type: daily\ntag: project-x")).toEqual({ type: "daily", tag: "project-x" });
  });

  it("ignores blank lines and lines without a colon", () => {
    expect(parseFilterText("type: daily\n\nnot a filter line")).toEqual({ type: "daily" });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseFilterText("  type :  daily  ")).toEqual({ type: "daily" });
  });
});

describe("queryNotes", () => {
  it("returns only notes matching every filter criterion", () => {
    const notes = [
      note({ path: "a.md", type: "daily" }),
      note({ path: "b.md", type: "canvas" }),
      note({ path: "c.md", type: "daily" }),
    ];
    expect(queryNotes(notes, { type: "daily" }).map((n) => n.path)).toEqual(["a.md", "c.md"]);
  });
});
