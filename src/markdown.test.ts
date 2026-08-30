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

// KaTeX itself isn't loaded/rendered here (see math-render.ts's doc
// comment for why: it's a lazily-loaded dependency, filled in by a
// browser-only async pass Preview.tsx/renderForExport.ts run after this
// synchronous render) — what's actually worth testing at this layer is
// that the placeholder carries the right raw TeX and display-mode flag
// for that later pass to pick up correctly.
describe("math placeholders (KaTeX rendering is deferred, see math-render.ts)", () => {
  it("inline math ($...$) emits a span placeholder with the raw TeX", () => {
    const html = renderNoteBody("Einstein: $E = mc^2$ was the result.", env());
    expect(html).toContain('<span class="math-inline math-pending" data-tex="E = mc^2" data-display="false">');
  });

  it("block math ($$...$$) emits a div placeholder with display mode true", () => {
    const html = renderNoteBody("$$\\int_0^1 x\\,dx$$", env());
    expect(html).toContain('class="math-block math-pending"');
    expect(html).toContain('data-display="true"');
  });

  it("a bare $ (e.g. a currency amount) is not treated as math", () => {
    const html = renderNoteBody("It costs $5 and $10.", env());
    expect(html).not.toContain("math-pending");
  });

  it("escapes HTML-significant characters in the TeX source", () => {
    const html = renderNoteBody("Compare: $a < b$", env());
    expect(html).toContain("data-tex=\"a &lt; b\"");
  });
});
