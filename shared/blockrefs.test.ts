import { describe, expect, it } from "vitest";
import { fragmentLabel, resolveBlockFragment, resolveFragment, resolveHeadingFragment, stripBlockMarker } from "./blockrefs";

const DOC = [
  "Intro paragraph.",
  "",
  "# First",
  "First section text.",
  "- a task ^task-a",
  "- another task",
  "",
  "## Nested",
  "Nested content.",
  "",
  "# Second",
  "Second section text.",
].join("\n");

describe("resolveHeadingFragment", () => {
  it("resolves a top-level heading up to the next same-level heading", () => {
    const r = resolveHeadingFragment(DOC, "First");
    expect(r).not.toBeNull();
    const text = DOC.slice(r!.start, r!.end);
    expect(text.startsWith("# First")).toBe(true);
    expect(text).toContain("Nested content.");
    expect(text).not.toContain("Second section text.");
  });

  it("resolves the last heading through end of body", () => {
    const r = resolveHeadingFragment(DOC, "Second");
    const text = DOC.slice(r!.start, r!.end);
    expect(text.trim().endsWith("Second section text.")).toBe(true);
  });

  it("a nested (deeper) heading only spans until the next heading of any level", () => {
    const r = resolveHeadingFragment(DOC, "Nested");
    const text = DOC.slice(r!.start, r!.end);
    expect(text).toContain("Nested content.");
    expect(text).not.toContain("Second section text.");
  });

  it("matches case-insensitively and trims", () => {
    expect(resolveHeadingFragment(DOC, "  first  ")).toEqual(resolveHeadingFragment(DOC, "First"));
  });

  it("returns null for a heading that doesn't exist", () => {
    expect(resolveHeadingFragment(DOC, "Nope")).toBeNull();
  });
});

describe("resolveBlockFragment", () => {
  it("resolves to just the one line carrying the marker", () => {
    const r = resolveBlockFragment(DOC, "task-a");
    expect(r).not.toBeNull();
    const text = DOC.slice(r!.start, r!.end);
    expect(text.trim()).toBe("- a task ^task-a");
  });

  it("returns null for an id that doesn't exist", () => {
    expect(resolveBlockFragment(DOC, "nope")).toBeNull();
  });

  it("doesn't match a caret that isn't a trailing marker", () => {
    expect(resolveBlockFragment("this has a ^ in the middle of text", "in")).toBeNull();
  });
});

describe("resolveFragment", () => {
  it("dispatches to block resolution for a ^-prefixed fragment", () => {
    expect(resolveFragment(DOC, "^task-a")).toEqual(resolveBlockFragment(DOC, "task-a"));
  });

  it("dispatches to heading resolution otherwise", () => {
    expect(resolveFragment(DOC, "First")).toEqual(resolveHeadingFragment(DOC, "First"));
  });
});

describe("stripBlockMarker", () => {
  it("removes a trailing ^id marker", () => {
    expect(stripBlockMarker("- a task ^task-a")).toBe("- a task");
  });

  it("leaves text with no marker unchanged", () => {
    expect(stripBlockMarker("just text")).toBe("just text");
  });
});

describe("fragmentLabel", () => {
  it("returns 'block' for a ^block-id fragment", () => {
    expect(fragmentLabel("^task-a")).toBe("block");
  });

  it("returns the heading text itself for a heading fragment", () => {
    expect(fragmentLabel("First")).toBe("First");
  });
});
