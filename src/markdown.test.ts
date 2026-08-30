import { describe, expect, it } from "vitest";
import { renderNoteBody, type NoteResolver, type RenderEnv } from "./markdown";

const notes: Record<string, { path: string; title: string; body: string }> = {
  target: {
    path: "target.md",
    title: "Target Note",
    body: ["# First", "First section.", "", "- an item ^item-a", "- another item", "", "# Second", "Second section."].join(
      "\n"
    ),
  },
};

const resolver: NoteResolver = {
  resolve(ref) {
    const note = Object.values(notes).find((n) => n.title === ref || n.path.replace(/\.md$/, "") === ref);
    return note ? { path: note.path, title: note.title } : null;
  },
};

function env(): RenderEnv {
  const bodies = new Map(Object.values(notes).map((n) => [n.path, n.body]));
  return { resolver, bodies, pathStack: new Set() };
}

describe("wikilink/wikiembed fragment rendering (block references)", () => {
  it("a [[Note#Heading]] link carries a Note › Heading label", () => {
    const html = renderNoteBody("See [[Target Note#First]].", env());
    expect(html).toContain('data-note-path="target.md"');
    expect(html).toContain("Target Note › First");
  });

  it("a [[Note#^block-id]] link labels the fragment as 'block'", () => {
    const html = renderNoteBody("See [[Target Note#^item-a]].", env());
    expect(html).toContain("Target Note › block");
  });

  it("an alias overrides the fragment-derived label", () => {
    const html = renderNoteBody("[[Target Note#First|custom]]", env());
    expect(html).toContain(">custom<");
    expect(html).not.toContain("First");
  });

  it("![[Note#Heading]] embeds just that section, not the whole note", () => {
    const html = renderNoteBody("![[Target Note#First]]", env());
    expect(html).toContain("First section.");
    expect(html).not.toContain("Second section.");
  });

  it("![[Note#^block-id]] embeds just that one line, marker stripped", () => {
    const html = renderNoteBody("![[Target Note#^item-a]]", env());
    expect(html).toContain("an item");
    expect(html).not.toContain("^item-a");
    expect(html).not.toContain("another item");
  });

  it("an embed of a fragment that doesn't exist reports it clearly", () => {
    const html = renderNoteBody("![[Target Note#Nope]]", env());
    expect(html).toContain("transclusion-missing");
    expect(html).toContain("Nope");
  });

  it("a trailing ^block-id on its own line renders as a dimmed marker, not raw text", () => {
    const html = renderNoteBody("A line with a marker ^my-id", env());
    expect(html).toContain('<span class="block-id-marker">^my-id</span>');
  });

  it("a ^ that isn't a trailing marker stays literal text", () => {
    const html = renderNoteBody("A caret ^ in the middle of a sentence.", env());
    expect(html).not.toContain("block-id-marker");
  });
});
