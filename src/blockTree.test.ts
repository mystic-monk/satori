import { describe, it, expect } from "vitest";
import {
  createBlock,
  serializeBlockDoc,
  parseBlockDoc,
  flattenVisible,
  indentBlock,
  outdentBlock,
  splitBlock,
  mergeIntoPrevious,
  pasteLines,
  splitPastedLines,
  renderBlockTreeHtml,
  type Block,
  type BlockDoc,
} from "./blockTree";
import { buildResolver } from "./noteResolver";
import type { NoteListItem } from "./api";

function b(text: string, children: Block[] = [], collapsed?: boolean): Block {
  return { id: crypto.randomUUID(), text, children, ...(collapsed ? { collapsed: true } : {}) };
}

describe("serializeBlockDoc / parseBlockDoc", () => {
  it("round-trips a nested tree with mixed collapsed flags", () => {
    const doc: BlockDoc = {
      blocks: [b("top", [b("child", [b("grandchild")], true)]), b("second top")],
    };
    const parsed = parseBlockDoc(serializeBlockDoc(doc));
    expect(parsed).toEqual(doc);
  });

  it("rejects empty string, unrelated JSON, malformed JSON, and non-array blocks", () => {
    expect(parseBlockDoc("")).toBeNull();
    expect(parseBlockDoc("   ")).toBeNull();
    expect(parseBlockDoc('{"foo":1}')).toBeNull();
    expect(parseBlockDoc("{not valid json")).toBeNull();
    expect(parseBlockDoc('{"blocks":"nope"}')).toBeNull();
  });

  it("never throws on garbage input", () => {
    expect(() => parseBlockDoc("null")).not.toThrow();
    expect(() => parseBlockDoc("[]")).not.toThrow();
    expect(() => parseBlockDoc("42")).not.toThrow();
  });
});

describe("flattenVisible", () => {
  it("hides a collapsed block's children and reveals them once uncollapsed", () => {
    const child = b("child");
    const parent = b("parent", [child], true);
    const flatCollapsed = flattenVisible([parent]);
    expect(flatCollapsed.map((e) => e.block.text)).toEqual(["parent"]);

    parent.collapsed = false;
    const flatOpen = flattenVisible([parent]);
    expect(flatOpen.map((e) => e.block.text)).toEqual(["parent", "child"]);
    expect(flatOpen[1].depth).toBe(1);
  });
});

describe("indentBlock", () => {
  it("no-ops on a first child (nothing to become a child of)", () => {
    const a = b("a");
    const blocks = [a];
    expect(indentBlock(blocks, [0])).toBeNull();
  });

  it("moves a block to be the last child of its preceding sibling", () => {
    const a = b("a");
    const c = b("c");
    const blocks = [a, c];
    const result = indentBlock(blocks, [1]);
    expect(result).not.toBeNull();
    expect(result!.blocks).toEqual([{ ...a, children: [c] }]);
    expect(result!.focusId).toBe(c.id);
  });
});

describe("outdentBlock", () => {
  it("no-ops on a top-level block", () => {
    const blocks = [b("a")];
    expect(outdentBlock(blocks, [0])).toBeNull();
  });

  it("splices a nested block into the grandparent's array right after its former parent", () => {
    const child = b("child");
    const parent = b("parent", [child]);
    const blocks = [parent, b("sibling")];
    const result = outdentBlock(blocks, [0, 0]);
    expect(result).not.toBeNull();
    expect(result!.blocks.map((x) => x.text)).toEqual(["parent", "child", "sibling"]);
    expect(result!.blocks[0].children).toEqual([]);
    expect(result!.focusId).toBe(child.id);
  });

  it("doesn't throw when outdenting twice in a row (second call correctly no-ops)", () => {
    const child = b("child");
    const parent = b("parent", [child]);
    const first = outdentBlock([parent], [0, 0])!;
    const path = [1]; // "child" is now top-level, at index 1
    expect(outdentBlock(first.blocks, path)).toBeNull();
  });
});

describe("splitBlock", () => {
  it("splits at the start, end, and middle of the text", () => {
    const target = b("hello world");
    const atStart = splitBlock([target], [0], 0);
    expect(atStart.blocks[0].text).toBe("");
    expect(atStart.blocks[1].text).toBe("hello world");

    const atEnd = splitBlock([target], [0], target.text.length);
    expect(atEnd.blocks[0].text).toBe("hello world");
    expect(atEnd.blocks[1].text).toBe("");

    const atMiddle = splitBlock([target], [0], 5);
    expect(atMiddle.blocks[0].text).toBe("hello");
    expect(atMiddle.blocks[1].text).toBe(" world");
    expect(atMiddle.focusId).toBe(atMiddle.blocks[1].id);
    expect(atMiddle.caretOffset).toBe(0);
  });

  it("puts the new sibling after the whole subtree, not between current and its children", () => {
    const child = b("child");
    const parent = b("parent text", [child]);
    const result = splitBlock([parent], [0], 6);
    expect(result.blocks[0].text).toBe("parent");
    expect(result.blocks[0].children.map((c) => c.text)).toEqual(["child"]);
    expect(result.blocks[1].text).toBe(" text");
    expect(result.blocks[1].children).toEqual([]);
  });
});

describe("mergeIntoPrevious", () => {
  it("deletes an empty leaf and moves focus to the previous block", () => {
    const prev = b("previous");
    const empty = b("");
    const result = mergeIntoPrevious([prev, empty], [1]);
    expect(result).not.toBeNull();
    expect(result!.blocks).toHaveLength(1);
    expect(result!.blocks[0].text).toBe("previous");
    expect(result!.focusId).toBe(prev.id);
    expect(result!.caretOffset).toBe("previous".length);
  });

  it("joins non-empty text onto the previous block", () => {
    const prev = b("foo");
    const current = b("bar");
    const result = mergeIntoPrevious([prev, current], [1]);
    expect(result!.blocks[0].text).toBe("foobar");
  });

  it("no-ops on the very first block in the document", () => {
    const first = b("only");
    expect(mergeIntoPrevious([first], [0])).toBeNull();
  });

  it("no-ops when the current block has children (unsupported in v1)", () => {
    const child = b("child");
    const withChild = b("has a child", [child]);
    const blocks = [b("prev"), withChild];
    expect(mergeIntoPrevious(blocks, [1])).toBeNull();
  });
});

describe("splitPastedLines", () => {
  it("returns null for single-line input (let the browser handle it)", () => {
    expect(splitPastedLines("just one line")).toBeNull();
  });

  it("splits multi-line input into an ordered array", () => {
    expect(splitPastedLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("drops a single trailing newline without producing a spurious empty block", () => {
    expect(splitPastedLines("a\nb\n")).toEqual(["a", "b"]);
  });
});

describe("pasteLines", () => {
  it("splits pasted lines into new sibling blocks, preserving text after the caret on the last one", () => {
    const target = b("XX world"); // caret lands right after "XX"
    const result = pasteLines([target], [0], 2, ["one", "two", "three"]);
    expect(result.blocks.map((x) => x.text)).toEqual(["XXone", "two", "three world"]);
    expect(result.focusId).toBe(result.blocks[2].id);
    expect(result.caretOffset).toBe("three".length);
  });

  it("inserts new siblings at the same depth, after current in the parent array", () => {
    const other = b("other top-level");
    const target = b("abc");
    const result = pasteLines([target, other], [0], 3, ["abc", "def"]);
    expect(result.blocks.map((x) => x.text)).toEqual(["abcabc", "def", "other top-level"]);
  });
});

describe("renderBlockTreeHtml", () => {
  it("resolves a [[wikilink]] inside a block's text the same way renderNoteBody does", () => {
    const notes: NoteListItem[] = [
      { path: "some-note.md", title: "Some Note", tags: [], type: null, updatedAt: 0, favorite: false, properties: {} },
    ];
    const env = { resolver: buildResolver(notes), bodies: new Map(), pathStack: new Set<string>() };
    const doc: BlockDoc = { blocks: [b("see [[Some Note]] for context")] };
    const html = renderBlockTreeHtml(doc, env);
    expect(html).toContain('data-note-path="some-note.md"');
  });
});

describe("createBlock", () => {
  it("creates a block with a fresh id and no children", () => {
    const block = createBlock("hi");
    expect(block.text).toBe("hi");
    expect(block.children).toEqual([]);
    expect(typeof block.id).toBe("string");
    expect(block.id.length).toBeGreaterThan(0);
  });
});
