import { describe, expect, it } from "vitest";
import { extractRelationRefs } from "./relations";

describe("extractRelationRefs", () => {
  it("recognizes a single [[wikilink]] string as a one-ref relation", () => {
    expect(extractRelationRefs("[[Project Alpha]]")).toEqual(["Project Alpha"]);
  });

  it("recognizes an array of [[wikilink]] strings as a multi-ref relation", () => {
    expect(extractRelationRefs(["[[Task 1]]", "[[Task 2]]"])).toEqual(["Task 1", "Task 2"]);
  });

  it("supports the alias syntax, using the ref not the alias", () => {
    expect(extractRelationRefs("[[project-alpha|Project Alpha]]")).toEqual(["project-alpha"]);
  });

  it("trims surrounding whitespace", () => {
    expect(extractRelationRefs("  [[Project Alpha]]  ")).toEqual(["Project Alpha"]);
  });

  it("returns null for plain text", () => {
    expect(extractRelationRefs("Jane Doe")).toBeNull();
  });

  it("returns null for prose that merely contains a wikilink", () => {
    expect(extractRelationRefs("See [[Project Alpha]] for details")).toBeNull();
  });

  it("returns null for a number, boolean, or empty array", () => {
    expect(extractRelationRefs(42)).toBeNull();
    expect(extractRelationRefs(true)).toBeNull();
    expect(extractRelationRefs([])).toBeNull();
  });

  it("returns null for a mixed array (not every element is a wikilink)", () => {
    expect(extractRelationRefs(["[[Task 1]]", "just text"])).toBeNull();
  });

  it("returns null for an array containing a non-string element", () => {
    expect(extractRelationRefs(["[[Task 1]]", 42])).toBeNull();
  });
});
