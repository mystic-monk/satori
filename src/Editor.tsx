import { useEffect, useRef, useState } from "react";
import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

// oneDark covers all dark app themes reasonably well (an approximation for
// solarized-dark, not a pixel-perfect match — full per-theme syntax color
// mapping would need its own HighlightStyle per theme, not done here). For
// light themes there's no bundled light package, so this covers just the
// editor chrome (matching whichever light palette is active) and leaves
// syntax colors to CodeMirror's own defaults, which read fine on white.
function lightCmTheme() {
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue("--bg").trim() || "#ffffff";
  const text = style.getPropertyValue("--text").trim() || "#1a1a1a";
  const border = style.getPropertyValue("--border").trim() || "#e2e2e5";
  const hover = style.getPropertyValue("--bg-hover").trim() || "#f0f0f0";
  const accent = style.getPropertyValue("--accent").trim() || "#2563eb";
  return EditorView.theme(
    {
      "&": { backgroundColor: bg, color: text },
      ".cm-content": { caretColor: text },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: text },
      ".cm-gutters": { backgroundColor: bg, color: border, border: "none" },
      ".cm-activeLine": { backgroundColor: hover },
      ".cm-activeLineGutter": { backgroundColor: hover },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: `${accent}33`,
      },
    },
    { dark: false }
  );
}

interface SlashItem {
  label: string;
  hint: string;
  snippet: string; // {{cursor}} marks where the cursor should land after insert
}

const SLASH_ITEMS: SlashItem[] = [
  { label: "Heading 1", hint: "# ", snippet: "# {{cursor}}" },
  { label: "Heading 2", hint: "## ", snippet: "## {{cursor}}" },
  { label: "Heading 3", hint: "### ", snippet: "### {{cursor}}" },
  { label: "Bullet list", hint: "- ", snippet: "- {{cursor}}" },
  { label: "Numbered list", hint: "1. ", snippet: "1. {{cursor}}" },
  { label: "Table", hint: "| a | b |", snippet: "| a | b |\n| --- | --- |\n| {{cursor}} |  |" },
  { label: "Code block", hint: "```", snippet: "```\n{{cursor}}\n```" },
  {
    label: "Mermaid diagram",
    hint: "```mermaid",
    snippet: "```mermaid\nflowchart TD\n  A --> B{{cursor}}\n```",
  },
  { label: "Canvas embed", hint: "canvas note", snippet: "See the linked canvas note: [[{{cursor}}]]" },
  { label: "Callout", hint: "> [!note]", snippet: "> [!note] {{cursor}}\n> " },
  { label: "Math block", hint: "$$ … $$", snippet: "$$\n{{cursor}}\n$$" },
  { label: "Note link", hint: "[[...]]", snippet: "[[{{cursor}}]]" },
  { label: "Note embed", hint: "![[...]]", snippet: "![[{{cursor}}]]" },
  { label: "Divider", hint: "---", snippet: "---\n{{cursor}}" },
  { label: "Highlight", hint: "==...==", snippet: "=={{cursor}}==" },
  { label: "Inline comment", hint: "%%...%%", snippet: "%%{{cursor}}%%" },
];

interface SlashState {
  from: number; // position of the '/'
  x: number;
  y: number;
  query: string;
}

export interface CommentRange {
  from: number;
  to: number;
}

// A StateField (not a plain prop-driven render) because CodeMirror owns
// its own document/positions — commentRanges comes from outside as plain
// numbers (already resolved via yjsAnchor.ts against the *current* doc, so
// they're accurate at the moment they're set), and this just needs to
// paint them. Updated by dispatching setCommentRanges from the effect
// below whenever the prop changes; the field itself never recomputes
// anything, it only maps effects to a fresh decoration set.
const setCommentRanges = StateEffect.define<CommentRange[]>();
const commentRangesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentRanges)) {
        const builder = effect.value
          .filter((r) => r.from < r.to && r.to <= tr.state.doc.length)
          .sort((a, b) => a.from - b.from)
          .map((r) => Decoration.mark({ class: "cm-comment-range" }).range(r.from, r.to));
        return Decoration.set(builder);
      }
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface EditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  readOnly?: boolean;
  dark?: boolean;
  // A character offset to scroll into view once, e.g. from resolving a
  // [[Note#fragment]] link click (App.tsx). Deliberately a separate effect
  // below rather than folded into the view-creation effect: this needs to
  // fire again on an *already-mounted* editor too (a fragment link to the
  // note you're already viewing doesn't remount this component at all).
  scrollToOffset?: number | null;
  // Already-resolved (yjsAnchor.ts, against the live doc) ranges to
  // highlight — anchored comments' targets, so a commented span is visibly
  // apparent while editing, not just discoverable from the Comments panel.
  commentRanges?: CommentRange[];
  // Called with the current selection when someone clicks the floating
  // "Comment" button — App.tsx/CommentsPanel.tsx turn that into an anchor
  // via yjsAnchor.ts's encodeAnchor. Omitted entirely (no button ever
  // shows) when the caller has no way to act on it, e.g. read-only.
  onCommentOnSelection?: (from: number, to: number) => void;
}

export default function Editor({
  ytext,
  awareness,
  readOnly = false,
  dark = true,
  scrollToOffset,
  commentRanges,
  onCommentOnSelection,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selected, setSelected] = useState(0);
  const [commentTrigger, setCommentTrigger] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  // Read via .current inside selectionWatcher instead of closing over the
  // prop directly — onCommentOnSelection isn't in the main effect's dep
  // array below (deliberately: adding it would remount the whole
  // EditorView, losing cursor position/undo history, every time App.tsx
  // re-renders with a fresh inline function), so this is how it still
  // always calls the *current* callback rather than whichever one existed
  // when the editor was first created for this ytext.
  const onCommentOnSelectionRef = useRef(onCommentOnSelection);
  onCommentOnSelectionRef.current = onCommentOnSelection;

  useEffect(() => {
    if (!hostRef.current) return;

    const undoManager = new Y.UndoManager(ytext);

    const slashWatcher = EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;
      const view = update.view;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      const textBeforeCursor = line.text.slice(0, pos - line.from);
      const match = /(^|\s)\/(\w*)$/.exec(textBeforeCursor);
      if (!match) {
        setSlash(null);
        return;
      }
      const slashPos = pos - match[2].length - 1;
      const coords = view.coordsAtPos(slashPos);
      if (!coords) {
        setSlash(null);
        return;
      }
      const hostRect = hostRef.current!.getBoundingClientRect();
      setSlash({
        from: slashPos,
        x: coords.left - hostRect.left,
        y: coords.bottom - hostRect.top,
        query: match[2].toLowerCase(),
      });
      setSelected(0);
    });

    // A small "Comment" button that appears near a non-empty selection —
    // same floating-near-cursor positioning approach as the slash menu
    // above, triggered by selection instead of typed text. Only wired up
    // at all when the caller actually handles onCommentOnSelection (a
    // read-only session, e.g. someone with just view/comment share access
    // reading someone else's note, has nothing meaningful to select-and-
    // anchor against their own edits).
    const selectionWatcher = EditorView.updateListener.of((update) => {
      if (!onCommentOnSelectionRef.current || !update.selectionSet) return;
      const { from, to } = update.view.state.selection.main;
      if (from === to) {
        setCommentTrigger(null);
        return;
      }
      const coords = update.view.coordsAtPos(to);
      if (!coords) {
        setCommentTrigger(null);
        return;
      }
      const hostRect = hostRef.current!.getBoundingClientRect();
      setCommentTrigger({ from, to, x: coords.left - hostRect.left, y: coords.bottom - hostRect.top });
    });

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        dark ? oneDark : lightCmTheme(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        yCollab(ytext, awareness, { undoManager }),
        slashWatcher,
        selectionWatcher,
        commentRangesField,
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, awareness, readOnly, dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (view == null || scrollToOffset == null) return;
    const pos = Math.min(Math.max(scrollToOffset, 0), view.state.doc.length);
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }, [scrollToOffset]);

  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;
    view.dispatch({ effects: setCommentRanges.of(commentRanges ?? []) });
    // commentRanges is a fresh array reference on every App.tsx render
    // (built from resolveAnchorRange calls) — comparing its *contents* here
    // would need a deep-equal check for no real benefit, since dispatching
    // with an unchanged set of ranges is cheap (CodeMirror just rebuilds
    // the same decoration set).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentRanges]);

  const filtered = slash
    ? SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(slash.query))
    : [];

  function applySlashItem(item: SlashItem) {
    const view = viewRef.current;
    if (!view || !slash) return;
    const cursorMarker = "{{cursor}}";
    const markerIdx = item.snippet.indexOf(cursorMarker);
    const text = item.snippet.replace(cursorMarker, "");
    const to = view.state.selection.main.head;
    view.dispatch({
      changes: { from: slash.from, to, insert: text },
      selection: { anchor: slash.from + (markerIdx === -1 ? text.length : markerIdx) },
    });
    view.focus();
    setSlash(null);
  }

  function onSlashKeyDown(e: React.KeyboardEvent) {
    if (!slash) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && filtered[selected]) {
      e.preventDefault();
      applySlashItem(filtered[selected]);
    } else if (e.key === "Escape") {
      setSlash(null);
    }
  }

  return (
    <div className="cm-host" ref={hostRef} onKeyDownCapture={onSlashKeyDown}>
      {slash && filtered.length > 0 && (
        <div className="slash-menu" style={{ left: slash.x, top: slash.y }}>
          {filtered.map((item, i) => (
            <div
              key={item.label}
              className={`slash-item ${i === selected ? "slash-item-selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySlashItem(item);
              }}
            >
              <span className="slash-item-label">{item.label}</span>
              <span className="slash-item-hint">{item.hint}</span>
            </div>
          ))}
        </div>
      )}
      {commentTrigger && (
        <button
          className="comment-selection-trigger"
          style={{ left: commentTrigger.x, top: commentTrigger.y }}
          onMouseDown={(e) => {
            e.preventDefault(); // keeps the selection from collapsing before the click registers
            onCommentOnSelectionRef.current?.(commentTrigger.from, commentTrigger.to);
            setCommentTrigger(null);
          }}
        >
          💬 Comment
        </button>
      )}
    </div>
  );
}
