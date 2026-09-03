import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { ChevronRight } from "lucide-react";
import type { NoteListItem } from "./api";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import { applyTextDiff } from "./collab";
import { buildResolver } from "./noteResolver";
import { buildCitations } from "./Preview";
import { md, type RenderEnv } from "./markdown";
import {
  createBlock,
  flattenVisible,
  indentBlock,
  mergeIntoPrevious,
  outdentBlock,
  parseBlockDoc,
  pasteLines,
  serializeBlockDoc,
  splitBlock,
  splitPastedLines,
  toggleCollapsed,
  type Block,
  type BlockDoc,
  type FlatEntry,
} from "./blockTree";

const ORIGIN = "block-outline";
const SAVE_DEBOUNCE_MS = 500;

interface BlockOutlineProps {
  raw: string;
  ytext: Y.Text;
  notes: NoteListItem[];
}

// A LogSeq-style indentable/collapsible outline for daily notes — see
// blockOutline.ts's doc comment and the plan doc for why this stores its
// tree as JSON inside the same flat ytext CanvasNote.tsx already proved
// out for Excalidraw scenes, rather than a real per-block CRDT structure.
export default function BlockOutline({ raw, ytext, notes }: BlockOutlineProps) {
  const [doc, setDoc] = useState<BlockDoc>(
    () => parseBlockDoc(parseFrontmatter(raw).body) ?? { blocks: [createBlock()] }
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // A monotonic counter, not just {id, offset} — Tab/Shift+Tab move focus
  // to a block whose id doesn't change (only its position in the tree
  // does), so a plain value/id comparison wouldn't re-trigger the restore
  // effect below; bumping `seq` on every explicit moveFocus() call always
  // does.
  const [focusRequest, setFocusRequest] = useState<{ id: string; offset: number; seq: number } | null>(null);
  const seqRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const resolver = useMemo(() => buildResolver(notes), [notes]);
  const citations = useMemo(() => buildCitations(notes), [notes]);
  // No `bodies` (transclusion source map) — a block is a single inline
  // line, never rendered through the block-level ![[embed]] path, so this
  // stays permanently empty the same way JournalView's non-inline render
  // call already leaves it.
  const env: RenderEnv = useMemo(
    () => ({ resolver, bodies: new Map(), pathStack: new Set(), citations }),
    [resolver, citations]
  );

  // Remote/other-device edits land here — reparse and replace local state
  // for any change that wasn't our own debounced save below (tagged with
  // ORIGIN). Mirrors CanvasNote's one-way-out approach but adds the way
  // back in, since (unlike Excalidraw) nothing else owns this component's
  // state independently.
  useEffect(() => {
    function onUpdate(_event: Y.YTextEvent, transaction: Y.Transaction) {
      if (transaction.origin === ORIGIN) return;
      const next = parseBlockDoc(parseFrontmatter(ytext.toString()).body);
      if (next) setDoc(next);
    }
    ytext.observe(onUpdate);
    return () => ytext.unobserve(onUpdate);
  }, [ytext]);

  // Land the cursor somewhere useful on open, same as clicking into a
  // journal entry mid-way through a normal writing session should feel —
  // the last block is either where you left off, or the single empty
  // block a brand-new entry starts with.
  useEffect(() => {
    const flat = flattenVisible(doc.blocks);
    const last = flat[flat.length - 1];
    if (last) moveFocus(last.block.id, last.block.text.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fires ONLY on an explicit moveFocus() call (via the `seq` bump) — never
  // on a plain typing commit, which also changes `doc` but must leave the
  // browser's own caret position alone. Depending on `doc` here instead
  // was the bug: every keystroke re-ran this and forced the caret back to
  // a stale offset, making fast typing insert at the wrong position.
  useEffect(() => {
    if (!focusRequest) return;
    const el = containerRef.current?.querySelector<HTMLTextAreaElement>(`[data-block-id="${focusRequest.id}"] textarea`);
    if (el) {
      el.focus();
      el.setSelectionRange(focusRequest.offset, focusRequest.offset);
    }
  }, [focusRequest]);

  function moveFocus(id: string, offset: number) {
    seqRef.current += 1;
    setFocusRequest({ id, offset, seq: seqRef.current });
    setFocusedId(id);
  }

  function save(nextDoc: BlockDoc) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const { data } = parseFrontmatter(ytext.toString());
      const nextRaw = stringifyFrontmatter(data, serializeBlockDoc(nextDoc));
      applyTextDiff(ytext, nextRaw, ORIGIN);
    }, SAVE_DEBOUNCE_MS);
  }

  function commit(nextBlocks: Block[]) {
    const next = { blocks: nextBlocks };
    setDoc(next);
    save(next);
  }

  // Updates just this one block's text, in place, without touching
  // structure — cheaper and simpler than routing a plain keystroke through
  // the split/merge/indent machinery above.
  function setTextAtPath(list: Block[], path: number[], value: string): Block[] {
    const [head, ...rest] = path;
    return list.map((b, i) => {
      if (i !== head) return b;
      if (rest.length === 0) return { ...b, text: value };
      return { ...b, children: setTextAtPath(b.children, rest, value) };
    });
  }

  function onTextChange(entry: FlatEntry, value: string) {
    commit(setTextAtPath(doc.blocks, entry.path, value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, entry: FlatEntry) {
    const el = e.currentTarget;
    const offset = el.selectionStart;
    const collapsed = offset === el.selectionEnd;
    const atStart = collapsed && offset === 0;
    const atEnd = collapsed && offset === entry.block.text.length;
    const flat = flattenVisible(doc.blocks);
    const idx = flat.findIndex((x) => x.block.id === entry.block.id);

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const result = splitBlock(doc.blocks, entry.path, offset);
      moveFocus(result.focusId, result.caretOffset ?? 0);
      commit(result.blocks);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const result = e.shiftKey ? outdentBlock(doc.blocks, entry.path) : indentBlock(doc.blocks, entry.path);
      if (!result) return;
      moveFocus(result.focusId, offset);
      commit(result.blocks);
      return;
    }
    if (e.key === "Backspace" && atStart) {
      const result = mergeIntoPrevious(doc.blocks, entry.path);
      if (!result) return; // first block, or has children — let default backspace happen
      e.preventDefault();
      moveFocus(result.focusId, result.caretOffset ?? 0);
      commit(result.blocks);
      return;
    }
    if (e.key === "ArrowUp") {
      if (idx <= 0) return;
      e.preventDefault();
      const target = flat[idx - 1];
      moveFocus(target.block.id, Math.min(offset, target.block.text.length));
      return;
    }
    if (e.key === "ArrowDown") {
      if (idx < 0 || idx >= flat.length - 1) return;
      e.preventDefault();
      const target = flat[idx + 1];
      moveFocus(target.block.id, Math.min(offset, target.block.text.length));
      return;
    }
    if (e.key === "ArrowLeft" && atStart && idx > 0) {
      e.preventDefault();
      const target = flat[idx - 1];
      moveFocus(target.block.id, target.block.text.length);
      return;
    }
    if (e.key === "ArrowRight" && atEnd && idx >= 0 && idx < flat.length - 1) {
      e.preventDefault();
      const target = flat[idx + 1];
      moveFocus(target.block.id, 0);
      return;
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>, entry: FlatEntry) {
    const text = e.clipboardData.getData("text/plain");
    const lines = splitPastedLines(text);
    if (!lines) return; // single line — let the browser paste natively
    e.preventDefault();
    const offset = e.currentTarget.selectionStart;
    const result = pasteLines(doc.blocks, entry.path, offset, lines);
    moveFocus(result.focusId, result.caretOffset ?? 0);
    commit(result.blocks);
  }

  function onToggleCollapse(id: string) {
    commit(toggleCollapsed(doc.blocks, id));
  }

  const flat = flattenVisible(doc.blocks);

  return (
    <div className="block-outline" ref={containerRef}>
      {flat.map((entry) => {
        const isFocused = entry.block.id === focusedId;
        // A bullet's job is signaling hierarchy — a top-level line with no
        // children isn't part of one yet, so it reads as a plain line, not
        // a list item. Indenting it under something (Tab) or giving it a
        // child immediately brings the bullet back, since at that point it
        // genuinely is one.
        const isFlatLine = entry.depth === 0 && entry.block.children.length === 0;
        return (
          <div
            key={entry.block.id}
            className="block-row"
            data-block-id={entry.block.id}
            style={{ marginLeft: entry.depth * 22 }}
          >
            {!isFlatLine &&
              (entry.block.children.length > 0 ? (
                <button
                  type="button"
                  className={`block-chevron ${entry.block.collapsed ? "" : "open"}`}
                  onClick={() => onToggleCollapse(entry.block.id)}
                  aria-label={entry.block.collapsed ? "Expand" : "Collapse"}
                >
                  <ChevronRight size={12} />
                </button>
              ) : (
                <span className="block-chevron-spacer" />
              ))}
            {!isFlatLine && (
              <span className={`block-bullet ${entry.block.children.length > 0 ? "block-bullet-parent" : ""}`} />
            )}
            {isFocused ? (
              <BlockTextarea
                entry={entry}
                onChange={(value) => onTextChange(entry, value)}
                onKeyDown={(e) => onKeyDown(e, entry)}
                onPaste={(e) => onPaste(e, entry)}
                onBlur={() => setFocusedId((cur) => (cur === entry.block.id ? null : cur))}
              />
            ) : (
              <div
                className="block-rendered"
                onClick={() => moveFocus(entry.block.id, entry.block.text.length)}
                dangerouslySetInnerHTML={{ __html: entry.block.text ? md.renderInline(entry.block.text, env) : "&nbsp;" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface BlockTextareaProps {
  entry: FlatEntry;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
}

// A plain <textarea>, not contenteditable — every operation above needs
// exact integer caret offsets (split-at-caret, merge-at-offset-0,
// clamp-to-length navigation), which selectionStart/selectionEnd give for
// free; contenteditable would need DOM Range walking for the same numbers,
// for no benefit at this scope. Auto-grows to its content since a block
// can wrap to more than one visual line even though it's one logical line
// for navigation purposes (see blockOutline.ts's flattenVisible doc
// comment).
function BlockTextarea({ entry, onChange, onKeyDown, onPaste, onBlur }: BlockTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (ref.current) resize(ref.current);
  }, []);

  return (
    <textarea
      ref={ref}
      className="block-textarea"
      rows={1}
      value={entry.block.text}
      onChange={(e) => {
        resize(e.currentTarget);
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={onBlur}
    />
  );
}
