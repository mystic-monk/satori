// A LogSeq-style block outline, stored as JSON in a note's body — same
// trick CanvasNote.tsx already uses for Excalidraw scenes: no new Yjs
// document shape, no Rust/indexing changes. The tree is just text as far
// as sync/search/links are concerned (see the plan doc for why). Every
// mutation here is pure (blocks in, new blocks out) so BlockOutline.tsx's
// event handlers and this module's tests can share the exact same logic.
import { md, type RenderEnv } from "./markdown";

export interface Block {
  id: string;
  text: string; // one logical line of markdown-inline source, no embedded \n
  children: Block[];
  collapsed?: boolean; // omitted/false = expanded
}

export interface BlockDoc {
  blocks: Block[];
}

// focusId/caretOffset are only present when an operation moves focus to a
// different block or changes what's at the caret in a data-dependent way
// (split's new sibling starts at 0, merge lands at the old previous
// block's length) — indent/outdent/toggle leave the focused block and its
// text untouched, so the caller just keeps whatever caret position it
// already had.
export interface OpResult {
  blocks: Block[];
  focusId: string;
  caretOffset?: number;
}

export function createBlock(text = ""): Block {
  return { id: crypto.randomUUID(), text, children: [] };
}

function normalizeBlock(b: Block): Block {
  return {
    id: b.id,
    text: b.text,
    children: b.children.map(normalizeBlock),
    ...(b.collapsed ? { collapsed: true as const } : {}),
  };
}

// Fixed key order (id, text, children, collapsed) so applyTextDiff's
// prefix/suffix diff stays stable across edits to unrelated blocks —
// default JSON.stringify key order follows insertion order of whichever
// code last touched an object, which would otherwise shuffle unrelated
// output and defeat the diff.
export function serializeBlockDoc(doc: BlockDoc): string {
  return JSON.stringify({ blocks: doc.blocks.map(normalizeBlock) }, null, 2) + "\n";
}

function isValidBlock(v: unknown): v is Block {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.text === "string" &&
    Array.isArray(b.children) &&
    b.children.every(isValidBlock) &&
    (b.collapsed === undefined || typeof b.collapsed === "boolean")
  );
}

// Validates shape, not just "JSON.parse succeeds" — an unrelated JSON blob
// living in a note body (or a stray `{}`) must never be misread as an
// outline. Returns null (not a throw) for anything that isn't one, so
// callers can use it directly as a type-narrowing gate.
export function parseBlockDoc(body: string): BlockDoc | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const blocks = (parsed as Record<string, unknown> | null)?.blocks;
  if (!Array.isArray(blocks) || !blocks.every(isValidBlock)) return null;
  return { blocks: blocks as Block[] };
}

export function findPath(blocks: Block[], id: string): number[] | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return [i];
    const sub = findPath(blocks[i].children, id);
    if (sub) return [i, ...sub];
  }
  return null;
}

export function getAtPath(blocks: Block[], path: number[]): Block | null {
  let node: Block | null = null;
  let cur = blocks;
  for (const i of path) {
    node = cur[i] ?? null;
    if (!node) return null;
    cur = node.children;
  }
  return node;
}

export interface FlatEntry {
  block: Block;
  path: number[];
  depth: number;
}

// DFS pre-order, skipping the children of any collapsed block — this is
// the addressing scheme every keyboard navigation (Up/Down/Left/Right) and
// merge-into-previous uses for "what's the visually adjacent block."
export function flattenVisible(blocks: Block[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  function walk(list: Block[], path: number[], depth: number) {
    list.forEach((b, i) => {
      const p = [...path, i];
      out.push({ block: b, path: p, depth });
      if (!b.collapsed) walk(b.children, p, depth + 1);
    });
  }
  walk(blocks, [], 0);
  return out;
}

function parentPathOf(path: number[]): number[] {
  return path.slice(0, -1);
}

// The array that directly contains the block at `path` — i.e. its
// siblings. Every op below rebuilds the tree by copying this array,
// splicing it, and writing the copy back with withSiblingsAt.
function siblingsAtPath(blocks: Block[], path: number[]): Block[] {
  let cur = blocks;
  for (let d = 0; d < path.length - 1; d++) cur = cur[path[d]].children;
  return cur;
}

// Immutably replaces the children array that lives at `parentPath` (the
// path to the block that OWNS the array being replaced — [] means "the
// root array itself") with `nextSiblings`.
function withSiblingsAt(blocks: Block[], parentPath: number[], nextSiblings: Block[]): Block[] {
  if (parentPath.length === 0) return nextSiblings;
  const [head, ...rest] = parentPath;
  return blocks.map((b, i) => (i === head ? { ...b, children: withSiblingsAt(b.children, rest, nextSiblings) } : b));
}

function updateTextAtPath(blocks: Block[], path: number[], newText: string): Block[] {
  const [head, ...rest] = path;
  return blocks.map((b, i) => {
    if (i !== head) return b;
    if (rest.length === 0) return { ...b, text: newText };
    return { ...b, children: updateTextAtPath(b.children, rest, newText) };
  });
}

// Enter — cuts text at the caret; the new block is always a same-depth
// sibling inserted right after current in the *parent's* array, so it
// lands after current's whole expanded subtree rather than between
// current and its own children (which live in a separate array).
export function splitBlock(blocks: Block[], path: number[], caretOffset: number): OpResult {
  const target = getAtPath(blocks, path)!;
  const before = target.text.slice(0, caretOffset);
  const after = target.text.slice(caretOffset);
  const sibling = createBlock(after);
  const parentPath = parentPathOf(path);
  const siblings = siblingsAtPath(blocks, path);
  const index = path[path.length - 1];
  const nextSiblings = [...siblings.slice(0, index), { ...siblings[index], text: before }, sibling, ...siblings.slice(index + 1)];
  return { blocks: withSiblingsAt(blocks, parentPath, nextSiblings), focusId: sibling.id, caretOffset: 0 };
}

// Backspace at caret offset 0 — joins current's text onto the previous
// visible block and removes current. No-op if there's no previous block
// (current is the very first block in the doc) or if current has children
// (tree-surgery for "where do the children go" is left unsupported in v1,
// not silently wrong).
export function mergeIntoPrevious(blocks: Block[], path: number[]): OpResult | null {
  const target = getAtPath(blocks, path);
  if (!target || target.children.length > 0) return null;
  const flat = flattenVisible(blocks);
  const idx = flat.findIndex((e) => e.block.id === target.id);
  if (idx <= 0) return null;
  const prevEntry = flat[idx - 1];
  const mergedText = prevEntry.block.text + target.text;
  const caretOffset = prevEntry.block.text.length;

  const parentPath = parentPathOf(path);
  const siblings = siblingsAtPath(blocks, path);
  const index = path[path.length - 1];
  const withoutTarget = [...siblings.slice(0, index), ...siblings.slice(index + 1)];
  const removed = withSiblingsAt(blocks, parentPath, withoutTarget);
  // prevEntry.path is still valid against `removed`: it was computed by
  // DFS pre-order relative to target, so at the depth of target's own
  // parent array it's either an ancestor of target (path doesn't reach
  // that array at all) or a preceding sibling/descendant thereof (whose
  // index in that array is strictly less than target's, so removing
  // target doesn't shift it).
  const next = updateTextAtPath(removed, prevEntry.path, mergedText);
  return { blocks: next, focusId: prevEntry.block.id, caretOffset };
}

// Tab — no-op if there's no preceding sibling to become a child of;
// otherwise becomes that sibling's last child.
export function indentBlock(blocks: Block[], path: number[]): { blocks: Block[]; focusId: string } | null {
  const index = path[path.length - 1];
  if (index === 0) return null;
  const target = getAtPath(blocks, path);
  if (!target) return null;
  const parentPath = parentPathOf(path);
  const siblings = siblingsAtPath(blocks, path);
  const precedingSibling = siblings[index - 1];
  const withoutTarget = [...siblings.slice(0, index), ...siblings.slice(index + 1)];
  const nextPrecedingSibling = { ...precedingSibling, children: [...precedingSibling.children, target] };
  const nextSiblings = withoutTarget.map((b) => (b.id === precedingSibling.id ? nextPrecedingSibling : b));
  return { blocks: withSiblingsAt(blocks, parentPath, nextSiblings), focusId: target.id };
}

// Shift+Tab — no-op if already top-level; otherwise spliced into the
// grandparent's array right after its former parent.
export function outdentBlock(blocks: Block[], path: number[]): { blocks: Block[]; focusId: string } | null {
  if (path.length < 2) return null;
  const target = getAtPath(blocks, path);
  if (!target) return null;
  const parentPath = parentPathOf(path);
  const grandParentPath = parentPathOf(parentPath);
  const parentSiblings = siblingsAtPath(blocks, path);
  const index = path[path.length - 1];
  const withoutTarget = [...parentSiblings.slice(0, index), ...parentSiblings.slice(index + 1)];
  const removed = withSiblingsAt(blocks, parentPath, withoutTarget);

  const parentIndex = parentPath[parentPath.length - 1];
  const grandSiblings = siblingsAtPath(removed, parentPath);
  const nextGrandSiblings = [...grandSiblings.slice(0, parentIndex + 1), target, ...grandSiblings.slice(parentIndex + 1)];
  return { blocks: withSiblingsAt(removed, grandParentPath, nextGrandSiblings), focusId: target.id };
}

export function toggleCollapsed(blocks: Block[], id: string): Block[] {
  function walk(list: Block[]): Block[] {
    return list.map((b) => {
      if (b.id === id) return { ...b, collapsed: !b.collapsed };
      if (b.children.length === 0) return b;
      return { ...b, children: walk(b.children) };
    });
  }
  return walk(blocks);
}

// Multi-line paste — current block's text becomes `before + lines[0]`;
// each remaining line becomes a new same-depth sibling after current, with
// `after` (whatever was past the caret in current's original text)
// appended to the LAST new sibling, so pasting mid-block doesn't drop the
// text that was after the cursor. Caller only invokes this once
// splitPastedLines has confirmed `lines.length > 1`.
export function pasteLines(blocks: Block[], path: number[], caretOffset: number, lines: string[]): OpResult {
  const target = getAtPath(blocks, path)!;
  const before = target.text.slice(0, caretOffset);
  const after = target.text.slice(caretOffset);
  const rest = lines.slice(1);
  const newSiblings = rest.map((line, i) => createBlock(i === rest.length - 1 ? line + after : line));
  const parentPath = parentPathOf(path);
  const siblings = siblingsAtPath(blocks, path);
  const index = path[path.length - 1];
  const nextSiblings = [
    ...siblings.slice(0, index),
    { ...siblings[index], text: before + lines[0] },
    ...newSiblings,
    ...siblings.slice(index + 1),
  ];
  const lastNew = newSiblings[newSiblings.length - 1];
  return {
    blocks: withSiblingsAt(blocks, parentPath, nextSiblings),
    focusId: lastNew.id,
    caretOffset: rest[rest.length - 1].length,
  };
}

// Single-line paste returns null so the caller lets the browser handle it
// natively inside the textarea. Multi-line paste: caller merges the first
// line into the current block at the caret and turns the rest into new
// sibling blocks after it, in order. A lone trailing newline (the common
// "copied a whole line" clipboard artifact) is dropped first so it doesn't
// produce a spurious empty trailing block.
export function splitPastedLines(text: string): string[] | null {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lines = normalized.split("\n");
  return lines.length > 1 ? lines : null;
}

// Read-only nested <ul>/<li> rendering — used by BlockOutline.tsx's
// non-focused rows and by JournalView.tsx's aggregate-feed preview. Only
// inline markdown (bold/italic/code/wikilinks/citations) applies, via
// md.renderInline — block-level constructs (headings, fences, callouts)
// aren't meaningful inside a single block line and aren't attempted.
export function renderBlockTreeHtml(doc: BlockDoc, env: RenderEnv): string {
  function renderList(blocks: Block[]): string {
    if (blocks.length === 0) return "";
    const items = blocks
      .map((b) => {
        const inline = md.renderInline(b.text, env);
        const nested = !b.collapsed && b.children.length > 0 ? renderList(b.children) : "";
        return `<li data-block-id="${md.utils.escapeHtml(b.id)}">${inline}${nested}</li>`;
      })
      .join("");
    return `<ul class="block-tree-list">${items}</ul>`;
  }
  return renderList(doc.blocks);
}

// Total word count across every block's text — used for the outline's
// word-count display in App.tsx (source/split/preview text does exist,
// just spread across many small strings instead of one).
export function flattenAllBlockText(doc: BlockDoc): string {
  const parts: string[] = [];
  function walk(list: Block[]) {
    for (const b of list) {
      parts.push(b.text);
      walk(b.children);
    }
  }
  walk(doc.blocks);
  return parts.join(" ");
}
