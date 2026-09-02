import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple comma-separated rows into records keyed by header", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("returns an empty array for empty input or header-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b,c")).toEqual([]);
    expect(parseCsv("a,b,c\n")).toEqual([]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsv('name,note\nAda,"hello, world"')).toEqual([{ name: "Ada", note: "hello, world" }]);
  });

  it("handles escaped double quotes inside a quoted field", () => {
    expect(parseCsv('name,quote\nAda,"she said ""hi"""')).toEqual([{ name: "Ada", quote: 'she said "hi"' }]);
  });

  it("handles an embedded newline inside a quoted field", () => {
    expect(parseCsv('name,note\nAda,"line one\nline two"')).toEqual([{ name: "Ada", note: "line one\nline two" }]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("fills missing trailing fields with empty string and drops extras beyond the header", () => {
    expect(parseCsv("a,b,c\n1")).toEqual([{ a: "1", b: "", c: "" }]);
    expect(parseCsv("a,b\n1,2,3,4")).toEqual([{ a: "1", b: "2" }]);
  });

  it("drops a spurious trailing blank line without producing an empty record", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
