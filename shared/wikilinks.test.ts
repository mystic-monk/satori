import { describe, expect, it } from "vitest";
import { extractWikilinkRefs } from "./wikilinks";

describe("extractWikilinkRefs", () => {
  it("returns nothing for text with no wikilinks", () => {
    expect(extractWikilinkRefs("just plain text")).toEqual([]);
  });

  it("extracts a plain [[ref]] as a non-embed link", () => {
    expect(extractWikilinkRefs("See [[Other Note]] for more.")).toEqual([
      { ref: "Other Note", embed: false },
    ]);
  });

  it("extracts ![[ref]] as an embed", () => {
    expect(extractWikilinkRefs("![[Diagram]]")).toEqual([{ ref: "Diagram", embed: true }]);
  });

  it("strips the |alias part, keeping only the ref", () => {
    expect(extractWikilinkRefs("[[real-path|Displayed Text]]")).toEqual([
      { ref: "real-path", embed: false },
    ]);
  });

  it("trims whitespace around the ref", () => {
    expect(extractWikilinkRefs("[[  spaced ref  ]]")).toEqual([{ ref: "spaced ref", embed: false }]);
  });

  it("finds multiple refs in the same body, embeds and links mixed", () => {
    const body = "Start [[A]] middle ![[B]] end [[C|alias]].";
    expect(extractWikilinkRefs(body)).toEqual([
      { ref: "A", embed: false },
      { ref: "B", embed: true },
      { ref: "C", embed: false },
    ]);
  });
});
