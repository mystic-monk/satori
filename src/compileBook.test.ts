import { describe, it, expect } from "vitest";
import { compileBook } from "./compileBook";
import type { NoteListItem } from "./api";

function note(overrides: Partial<NoteListItem>): NoteListItem {
  return {
    path: "x.md",
    title: "X",
    tags: [],
    type: null,
    updatedAt: 0,
    favorite: false,
    properties: {},
    ...overrides,
  };
}

describe("compileBook", () => {
  const book = note({ path: "book.md", title: "My Book", type: "book" });

  it("orders chapters by their order property and concatenates bodies", async () => {
    const notes = [
      book,
      note({ path: "ch2.md", title: "Chapter Two", type: "chapter", properties: { book: "[[My Book]]", order: 2 } }),
      note({ path: "ch1.md", title: "Chapter One", type: "chapter", properties: { book: "[[My Book]]", order: 1 } }),
    ];
    const bodies: Record<string, string> = {
      "ch1.md": "---\ntitle: Chapter One\n---\nFirst chapter body.",
      "ch2.md": "---\ntitle: Chapter Two\n---\nSecond chapter body.",
    };
    const result = await compileBook(book, notes, async (p) => bodies[p]);
    const ch1Index = result.raw.indexOf("First chapter body");
    const ch2Index = result.raw.indexOf("Second chapter body");
    expect(ch1Index).toBeGreaterThan(-1);
    expect(ch2Index).toBeGreaterThan(ch1Index);
    expect(result.raw).toContain("# My Book");
    expect(result.raw).toContain("## Chapter One");
    expect(result.chapterCount).toBe(2);
  });

  it("excludes chapters belonging to a different book", async () => {
    const notes = [
      book,
      note({ path: "ch1.md", title: "Chapter One", type: "chapter", properties: { book: "[[My Book]]", order: 1 } }),
      note({ path: "other.md", title: "Other Chapter", type: "chapter", properties: { book: "[[Another Book]]", order: 1 } }),
    ];
    const result = await compileBook(book, notes, async () => "---\ntitle: x\n---\nbody");
    expect(result.chapterCount).toBe(1);
    expect(result.raw).not.toContain("Other Chapter");
  });

  it("sums word counts across all chapter bodies", async () => {
    const notes = [
      book,
      note({ path: "ch1.md", title: "Chapter One", type: "chapter", properties: { book: "[[My Book]]", order: 1 } }),
      note({ path: "ch2.md", title: "Chapter Two", type: "chapter", properties: { book: "[[My Book]]", order: 2 } }),
    ];
    const bodies: Record<string, string> = {
      "ch1.md": "---\ntitle: x\n---\none two three",
      "ch2.md": "---\ntitle: x\n---\nfour five",
    };
    const result = await compileBook(book, notes, async (p) => bodies[p]);
    expect(result.wordCount).toBe(5);
  });

  it("falls back to order 0 for a chapter with no order property", async () => {
    const notes = [
      book,
      note({ path: "ch1.md", title: "No Order", type: "chapter", properties: { book: "[[My Book]]" } }),
    ];
    const result = await compileBook(book, notes, async () => "---\ntitle: x\n---\nbody text");
    expect(result.chapterCount).toBe(1);
  });
});
