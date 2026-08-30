import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { encodeAnchor, decodeAnchor, resolveAnchorRange } from "./yjsAnchor";

function docWith(text: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  ytext.insert(0, text);
  return { doc, ytext };
}

describe("encodeAnchor / decodeAnchor", () => {
  it("round-trips a position with no edits in between", () => {
    const { doc, ytext } = docWith("Hello world");
    const encoded = encodeAnchor(ytext, 6);
    expect(decodeAnchor(encoded, doc)).toBe(6);
  });

  // The entire point of anchoring via a relative position instead of a raw
  // offset: it has to track the *same text* even after something earlier
  // in the document changes, not just work when nothing else moves.
  it("shifts correctly when text is inserted before the anchor", () => {
    const { doc, ytext } = docWith("Hello world");
    const encoded = encodeAnchor(ytext, 6); // points at "world"
    ytext.insert(0, "XXXXX"); // 5 chars inserted before it
    expect(decodeAnchor(encoded, doc)).toBe(11);
  });

  it("does not shift when text is inserted after the anchor", () => {
    const { doc, ytext } = docWith("Hello world");
    const encoded = encodeAnchor(ytext, 0);
    ytext.insert(ytext.length, " and more text");
    expect(decodeAnchor(encoded, doc)).toBe(0);
  });

  it("returns null for malformed/garbage input instead of throwing", () => {
    const { doc } = docWith("Hello world");
    expect(decodeAnchor("not-valid-base64-yjs-bytes!!!", doc)).toBeNull();
  });
});

describe("resolveAnchorRange", () => {
  it("resolves a valid start/end pair", () => {
    const { doc, ytext } = docWith("Hello world, this is a test.");
    const start = encodeAnchor(ytext, 6);
    const end = encodeAnchor(ytext, 11);
    expect(resolveAnchorRange(start, end, doc)).toEqual({ start: 6, end: 11 });
  });

  it("both ends shift together after an earlier edit", () => {
    const { doc, ytext } = docWith("Hello world, this is a test.");
    const start = encodeAnchor(ytext, 6);
    const end = encodeAnchor(ytext, 11);
    ytext.insert(0, "prefix-");
    expect(resolveAnchorRange(start, end, doc)).toEqual({ start: 13, end: 18 });
  });

  it("returns null when either anchor is missing (unanchored comment)", () => {
    const { doc, ytext } = docWith("Hello world");
    const start = encodeAnchor(ytext, 0);
    expect(resolveAnchorRange(null, null, doc)).toBeNull();
    expect(resolveAnchorRange(start, null, doc)).toBeNull();
    expect(resolveAnchorRange(null, start, doc)).toBeNull();
  });

  it("returns null if the anchored text was deleted entirely", () => {
    const { doc, ytext } = docWith("Hello world, this is a test.");
    const start = encodeAnchor(ytext, 6);
    const end = encodeAnchor(ytext, 11);
    ytext.delete(0, ytext.length); // wipe everything
    expect(resolveAnchorRange(start, end, doc)).toBeNull();
  });
});
