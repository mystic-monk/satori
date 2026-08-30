import { describe, expect, it } from "vitest";
import { parseBibtex } from "./bibtex";

describe("parseBibtex", () => {
  it("parses a single article entry with braced values", () => {
    const entries = parseBibtex(`
      @article{smith2020,
        title = {A Great Paper},
        author = {Smith, John and Doe, Jane},
        year = {2020},
        journal = {Journal of Things}
      }
    `);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      citekey: "smith2020",
      entryType: "article",
      fields: {
        title: "A Great Paper",
        author: "Smith, John and Doe, Jane",
        year: "2020",
        journal: "Journal of Things",
      },
    });
  });

  it("parses quoted values and a bare numeric year", () => {
    const entries = parseBibtex(`@book{doe2019, title = "A Book", year = 2019}`);
    expect(entries[0].fields.title).toBe("A Book");
    expect(entries[0].fields.year).toBe("2019");
  });

  it("handles nested braces inside a value", () => {
    const entries = parseBibtex(`@misc{x, title = {The {Great} Paper}}`);
    expect(entries[0].fields.title).toBe("The {Great} Paper");
  });

  it("parses multiple entries in one file", () => {
    const entries = parseBibtex(`
      @article{one, title = {First}}
      @article{two, title = {Second}}
    `);
    expect(entries.map((e) => e.citekey)).toEqual(["one", "two"]);
  });

  it("skips @comment and @string entries", () => {
    const entries = parseBibtex(`
      @comment{ignore this whole thing}
      @string{someMacro = "value"}
      @article{real, title = {Real Entry}}
    `);
    expect(entries).toHaveLength(1);
    expect(entries[0].citekey).toBe("real");
  });

  it("returns an empty array for text with no entries", () => {
    expect(parseBibtex("just some prose, no @ here")).toEqual([]);
  });

  it("lowercases the entry type and field names", () => {
    const entries = parseBibtex(`@Article{key, Title = {T}, AUTHOR = {A}}`);
    expect(entries[0].entryType).toBe("article");
    expect(entries[0].fields).toEqual({ title: "T", author: "A" });
  });
});
