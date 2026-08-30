import { describe, expect, it } from "vitest";
import { extractWikilinkRefs } from "./wikilinks";

describe("extractWikilinkRefs", () => {
  it("returns nothing for text with no wikilinks", () => {
    expect(extractWikilinkRefs("just plain text")).toEqual([]);
  });

  it("extracts a plain [[ref]] as a non-embed link", () => {
    expect(extractWikilinkRefs("See [[Other Note]] for more.")).toEqual([
      { ref: "Other Note", fragment: null, embed: false },
    ]);
  });

  it("extracts ![[ref]] as an embed", () => {
    expect(extractWikilinkRefs("![[Diagram]]")).toEqual([{ ref: "Diagram", fragment: null, embed: true }]);
  });

  it("strips the |alias part, keeping only the ref", () => {
    expect(extractWikilinkRefs("[[real-path|Displayed Text]]")).toEqual([
      { ref: "real-path", fragment: null, embed: false },
    ]);
  });

  it("trims whitespace around the ref", () => {
    expect(extractWikilinkRefs("[[  spaced ref  ]]")).toEqual([{ ref: "spaced ref", fragment: null, embed: false }]);
  });

  it("finds multiple refs in the same body, embeds and links mixed", () => {
    const body = "Start [[A]] middle ![[B]] end [[C|alias]].";
    expect(extractWikilinkRefs(body)).toEqual([
      { ref: "A", fragment: null, embed: false },
      { ref: "B", fragment: null, embed: true },
      { ref: "C", fragment: null, embed: false },
    ]);
  });

  it("splits a #Heading fragment from the note ref", () => {
    expect(extractWikilinkRefs("[[Note#Heading]]")).toEqual([{ ref: "Note", fragment: "Heading", embed: false }]);
  });

  it("splits a #^block-id fragment from the note ref", () => {
    expect(extractWikilinkRefs("![[Note#^abc123]]")).toEqual([{ ref: "Note", fragment: "^abc123", embed: true }]);
  });

  it("a fragment survives alongside an alias", () => {
    expect(extractWikilinkRefs("[[Note#Heading|Custom Label]]")).toEqual([
      { ref: "Note", fragment: "Heading", embed: false },
    ]);
  });

  it("trims whitespace around the fragment", () => {
    expect(extractWikilinkRefs("[[Note#  Heading  ]]")).toEqual([{ ref: "Note", fragment: "Heading", embed: false }]);
  });
});
