import { describe, it, expect } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("collapses runs of whitespace and newlines between words", () => {
    expect(countWords("one\n\n  two   three\n")).toBe(3);
  });

  it("counts markdown syntax as part of the word, not stripped", () => {
    expect(countWords("**bold** and [[a link]] here")).toBe(5);
  });
});
