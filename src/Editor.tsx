import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { checkText, suggest, addWord, type Misspelling } from "./spellcheck";

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
  {
    label: "Timetable",
    hint: "```timetable",
    snippet: "```timetable\nMon 09:00-10:30 {{cursor}}\n```",
  },
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

// Same shape/purpose as commentRangesField above, for spellcheck's
// misspelling ranges instead of comment anchors — a wavy underline
// (cm-misspelled, index.css) rather than a highlight.
const setMisspellings = StateEffect.define<Misspelling[]>();
const misspellingsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMisspellings)) {
        const builder = effect.value
          .filter((r) => r.from < r.to && r.to <= tr.state.doc.length)
          .sort((a, b) => a.from - b.from)
          .map((r) => Decoration.mark({ class: "cm-misspelled" }).range(r.from, r.to));
        return Decoration.set(builder);
      }
    }
    // A real edit invalidates spellcheck results (positions shift, and the
    // edited word itself may no longer be what was checked) — clearing
    // instead of tr.changes-mapping avoids stale/misaligned underlines
    // sitting on the wrong text until the next check runs.
    return tr.docChanged ? Decoration.none : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface EditorHandle {
  // scope "selection" checks only the current selection (no-op if empty);
  // "note" checks the whole document. Both replace whatever underlines
  // were already showing.
  checkSpelling: (scope: "selection" | "note") => Promise<void>;
  clearSpelling: () => void;
}

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
  // "auto" re-checks the whole note on a debounce as you type; "off"
  // leaves spellcheck inert until EditorHandle.checkSpelling is called
  // explicitly (the command palette's "Check spelling" actions, App.tsx).
  spellcheckMode?: "auto" | "off";
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    ytext,
    awareness,
    readOnly = false,
    dark = true,
    scrollToOffset,
    commentRanges,
    onCommentOnSelection,
    spellcheckMode = "off",
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selected, setSelected] = useState(0);
  const [commentTrigger, setCommentTrigger] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [misspellingPopup, setMisspellingPopup] = useState<{
    from: number;
    to: number;
    word: string;
    x: number;
    y: number;
    suggestions: string[];
  } | null>(null);
  // Same ref-not-dependency reasoning as onCommentOnSelectionRef below —
  // toggling the Settings spellcheck switch shouldn't remount the whole
  // editor (losing cursor/undo history), so the debounced watcher reads
  // this ref instead of closing over the prop.
  const spellcheckModeRef = useRef(spellcheckMode);
  spellcheckModeRef.current = spellcheckMode;
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

    // Debounced (600ms of no typing) rather than on every keystroke — a
    // Hunspell pass over a whole chapter is cheap but not free, and no one
    // needs underlines to repaint mid-word. "auto" only; "off" leaves
    // existing underlines as-is until dismissed/edited away, matching the
    // update() function's docChanged-clears-decorations behavior above.
    let spellcheckTimer: ReturnType<typeof setTimeout> | undefined;
    const spellcheckWatcher = EditorView.updateListener.of((update) => {
      if (spellcheckModeRef.current !== "auto" || !update.docChanged) return;
      clearTimeout(spellcheckTimer);
      spellcheckTimer = setTimeout(() => {
        const view = update.view;
        checkText(view.state.doc.toString()).then((results) => {
          if (viewRef.current === view) view.dispatch({ effects: setMisspellings.of(results) });
        });
      }, 600);
    });

    // Clicking a wavy-underlined word looks up suggestions and opens the
    // same kind of floating panel as the slash menu/comment trigger above —
    // posAtDOM + the field's own .between() finds which decoration (if any)
    // was actually clicked, since the DOM only tells us a point, not a range.
    const misspellingClickHandler = EditorView.domEventHandlers({
      mousedown(event, view) {
        // event.target is usually the raw Text node inside the mark's
        // <span> (CM6 renders mark decorations as a span wrapping a text
        // node, and a click within that text hits the node, not the span)
        // — .closest only exists on Element, so resolve up to the parent
        // element first or the click would never match.
        const raw = event.target as Node;
        const target = raw.nodeType === Node.TEXT_NODE ? raw.parentElement : (raw as Element);
        if (!target?.closest(".cm-misspelled")) {
          setMisspellingPopup(null);
          return false;
        }
        const pos = view.posAtDOM(target);
        let range: { from: number; to: number } | null = null;
        view.state.field(misspellingsField).between(pos, pos, (from, to) => {
          range = { from, to };
          return false;
        });
        if (!range) return false;
        const { from, to } = range as { from: number; to: number };
        const word = view.state.sliceDoc(from, to);
        const coords = view.coordsAtPos(to);
        if (!coords) return false;
        const hostRect = hostRef.current!.getBoundingClientRect();
        suggest(word).then((suggestions) => {
          setMisspellingPopup({ from, to, word, x: coords.left - hostRect.left, y: coords.bottom - hostRect.top, suggestions });
        });
        return true;
      },
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
        spellcheckWatcher,
        misspellingClickHandler,
        commentRangesField,
        misspellingsField,
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      clearTimeout(spellcheckTimer);
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

  // Flips between the debounced auto-check and nothing — an explicit
  // manual checkSpelling() call (below) still works regardless of this
  // mode, this effect only handles the "auto" toggle's own on/off edges.
  useEffect(() => {
    const view = viewRef.current;
    if (view == null) return;
    if (spellcheckMode === "auto") {
      checkText(view.state.doc.toString()).then((results) => {
        if (viewRef.current === view) view.dispatch({ effects: setMisspellings.of(results) });
      });
    } else {
      view.dispatch({ effects: setMisspellings.of([]) });
      setMisspellingPopup(null);
    }
  }, [spellcheckMode]);

  useImperativeHandle(
    ref,
    () => ({
      async checkSpelling(scope) {
        const view = viewRef.current;
        if (!view) return;
        if (scope === "selection") {
          const { from, to } = view.state.selection.main;
          if (from === to) return;
          const local = await checkText(view.state.sliceDoc(from, to));
          const results = local.map((r) => ({ from: from + r.from, to: from + r.to, word: r.word }));
          if (viewRef.current === view) view.dispatch({ effects: setMisspellings.of(results) });
        } else {
          const results = await checkText(view.state.doc.toString());
          if (viewRef.current === view) view.dispatch({ effects: setMisspellings.of(results) });
        }
      },
      clearSpelling() {
        viewRef.current?.dispatch({ effects: setMisspellings.of([]) });
        setMisspellingPopup(null);
      },
    }),
    []
  );

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

  function applySuggestion(word: string) {
    const view = viewRef.current;
    if (!view || !misspellingPopup) return;
    view.dispatch({ changes: { from: misspellingPopup.from, to: misspellingPopup.to, insert: word } });
    view.focus();
    setMisspellingPopup(null);
  }

  function addToDictionary() {
    if (!misspellingPopup) return;
    const word = misspellingPopup.word;
    addWord(word).then(() => {
      // Re-runs the full-note check so every other occurrence of this word
      // (e.g. a character's name used throughout the chapter) clears too,
      // not just the one that was clicked.
      const view = viewRef.current;
      if (!view) return;
      checkText(view.state.doc.toString()).then((results) => {
        if (viewRef.current === view) view.dispatch({ effects: setMisspellings.of(results) });
      });
    });
    setMisspellingPopup(null);
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
      {misspellingPopup && (
        <div className="spellcheck-popup" style={{ left: misspellingPopup.x, top: misspellingPopup.y }}>
          {misspellingPopup.suggestions.length > 0 ? (
            misspellingPopup.suggestions.slice(0, 5).map((s) => (
              <button key={s} className="spellcheck-suggestion" onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}>
                {s}
              </button>
            ))
          ) : (
            <span className="spellcheck-no-suggestions">No suggestions</span>
          )}
          <button
            className="spellcheck-add-word"
            onMouseDown={(e) => {
              e.preventDefault();
              addToDictionary();
            }}
          >
            Add "{misspellingPopup.word}" to dictionary
          </button>
        </div>
      )}
    </div>
  );
});

export default Editor;
