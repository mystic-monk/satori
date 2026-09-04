import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorState, StateField, StateEffect, Compartment, type Range } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { checkText, suggest, addWord, type Misspelling } from "./spellcheck";
import { STYLE_PATTERN, parseStyleAttrs, styleAttrsToCss, styleAttrsToSyntax, type StyleAttrs } from "./styledText";
import TextStylePopover from "./TextStylePopover";

// oneDark covers all dark app themes reasonably well (an approximation for
// solarized-dark, not a pixel-perfect match — full per-theme syntax color
// mapping would need its own HighlightStyle per theme, not done here). For
// light themes there's no bundled light package, so this covers just the
// editor chrome (matching whichever light palette is active) and leaves
// syntax colors to CodeMirror's own defaults, which read fine on white.
//
// References the CSS custom properties directly (var(--bg), not a
// getComputedStyle() snapshot resolved to a literal hex value) — the
// browser keeps these live, so switching between light themes (Light →
// Solarized Light → Catppuccin Latte → ...) repaints correctly with no
// JS involved. A resolved-once snapshot would go stale the moment a
// second light theme existed: the effect that (re)creates this object is
// keyed on the dark/light boundary (the `dark` prop), not on every theme
// change, so a light→light switch was silently keeping the previous
// light theme's colors baked in until this was changed to reference the
// variables live instead.
function lightCmTheme() {
  return EditorView.theme(
    {
      "&": { backgroundColor: "var(--bg)", color: "var(--text)" },
      ".cm-content": { caretColor: "var(--text)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--border)", border: "none" },
      ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)",
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

// Live-preview formatting ("live" view mode — see App.tsx's ViewMode):
// headings/bold/italic/strikethrough/inline-code/blockquotes render
// styled, with raw delimiters hidden, EXCEPT on whichever line the cursor
// currently occupies, where the raw markdown shows normally so editing
// stays exact. This is a ViewPlugin, not a StateField like the two decor-
// ation fields above — those are only ever updated by an external effect
// or by tr.docChanged; this one also needs to react to cursor movement
// (update.selectionSet) with no outside trigger, which is what
// ViewPlugin.update's full ViewUpdate gives access to.
//
// Phase 1 scope only: no wikilink/citation rendering, no fenced-code/
// Mermaid/math/callout rendering — those still only render in Preview
// mode. Source and Preview modes are unaffected either way; this
// extension is only ever installed while the "live" mode is active (see
// the view-creation effect below).
function isCursorOnNodeLines(state: EditorState, from: number, to: number): boolean {
  const sel = state.selection.main;
  const nodeFromLine = state.doc.lineAt(from).number;
  const nodeToLine = state.doc.lineAt(to).number;
  const selFromLine = state.doc.lineAt(sel.from).number;
  const selToLine = state.doc.lineAt(sel.to).number;
  return selToLine >= nodeFromLine && selFromLine <= nodeToLine;
}

// TaskMarker's own range is exactly the 3 characters "[ ]"/"[x]" (see
// @lezer/markdown's TaskParser) — captured in the closure at build time,
// so unlike the misspelling-click handler there's no DOM-click-to-
// document-position reverse lookup needed; the widget already knows
// exactly which range to rewrite.
class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-live-checkbox";
    box.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" } });
    };
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

// [text]{color=#hex font=serif} isn't part of the base Markdown/GFM
// grammar, so there's no Lezer node for it to switch on the way every
// other case below does — a regex scan over each visible range's own
// text instead, guarded against firing inside code (InlineCode/
// FencedCode/IndentedCode), since a match found this way isn't aware of
// the syntax tree on its own the way an `enter` callback already is.
function isInsideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "IndentedCode") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

function buildStyledTextDecorations(view: EditorView): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    const text = state.sliceDoc(from, to);
    for (const match of text.matchAll(STYLE_PATTERN)) {
      const matchStart = from + (match.index ?? 0);
      const innerStart = matchStart + 1; // past "["
      const innerEnd = innerStart + match[1].length;
      const matchEnd = matchStart + match[0].length;
      if (isInsideCode(state, matchStart) || isInsideCode(state, innerEnd)) continue;
      if (isCursorOnNodeLines(state, matchStart, matchEnd)) continue;
      const css = styleAttrsToCss(parseStyleAttrs(match[2]));
      if (!css) continue; // both attrs invalid — leave the brackets as plain text, same as the renderer
      ranges.push(Decoration.mark({ attributes: { style: css } }).range(innerStart, innerEnd));
      ranges.push(Decoration.replace({}).range(matchStart, innerStart)); // "["
      ranges.push(Decoration.replace({}).range(innerEnd, matchEnd)); // "]{attrs}"
    }
  }

  return ranges;
}

function buildLiveDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [...buildStyledTextDecorations(view)];
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = node.name.slice(-1);
            ranges.push(Decoration.mark({ class: `cm-live-h${level}` }).range(node.from, node.to));
            if (!isCursorOnNodeLines(state, node.from, node.to)) {
              const mark = node.node.getChild("HeaderMark");
              if (mark) {
                const spaceAfter = state.sliceDoc(mark.to, mark.to + 1) === " ";
                ranges.push(Decoration.replace({}).range(mark.from, spaceAfter ? mark.to + 1 : mark.to));
              }
            }
            break;
          }
          case "StrongEmphasis":
          case "Emphasis": {
            if (isCursorOnNodeLines(state, node.from, node.to)) break;
            const cls = node.name === "StrongEmphasis" ? "cm-live-bold" : "cm-live-italic";
            ranges.push(Decoration.mark({ class: cls }).range(node.from, node.to));
            for (const mark of node.node.getChildren("EmphasisMark")) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
            break;
          }
          case "Strikethrough": {
            if (isCursorOnNodeLines(state, node.from, node.to)) break;
            ranges.push(Decoration.mark({ class: "cm-live-strike" }).range(node.from, node.to));
            for (const mark of node.node.getChildren("StrikethroughMark")) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
            break;
          }
          case "InlineCode": {
            if (isCursorOnNodeLines(state, node.from, node.to)) break;
            ranges.push(Decoration.mark({ class: "cm-live-code" }).range(node.from, node.to));
            for (const mark of node.node.getChildren("CodeMark")) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
            break;
          }
          case "Blockquote": {
            ranges.push(Decoration.mark({ class: "cm-live-blockquote" }).range(node.from, node.to));
            break;
          }
          case "TaskMarker": {
            const text = state.sliceDoc(node.from, node.to);
            const checked = /\[[xX]\]/.test(text);
            ranges.push(
              Decoration.replace({ widget: new TaskCheckboxWidget(checked, node.from, node.to) }).range(node.from, node.to)
            );
            break;
          }
        }
      },
    });
  }

  return Decoration.set(ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLiveDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLiveDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// Toggled via reconfigure (see the liveFormatting effect below), not by
// remounting the whole EditorView — switching Source <-> Live shouldn't
// cost cursor position/undo history, the same reasoning scrollToOffset's
// separate effect already documents for staying out of the main effect's
// dependency array.
const liveFormattingCompartment = new Compartment();

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
  // "live" mode (App.tsx's ViewMode) — headings/bold/italic/strikethrough/
  // inline-code/blockquotes render styled with raw markup hidden except on
  // the cursor's own line. Off for "source" mode (exact raw text) and
  // irrelevant for "preview" (Editor isn't mounted there at all).
  liveFormatting?: boolean;
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
    liveFormatting = false,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selected, setSelected] = useState(0);
  const [commentTrigger, setCommentTrigger] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [styleTrigger, setStyleTrigger] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  // Set instead when the selection exactly matches an existing
  // [text]{attrs} span — TextStylePopover pre-fills from these and Apply
  // replaces the whole match instead of nesting a second wrap around it.
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
  const [existingStyleMatch, setExistingStyleMatch] = useState<{ from: number; to: number; attrs: StyleAttrs } | null>(
    null
  );
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

    // Same floating-button-on-selection mechanism as the Comment trigger
    // above, for the [text]{color=#hex font=serif} syntax (styledText.ts).
    // Gated on !readOnly directly (not a separate prop the way Comment's
    // onCommentOnSelection is) since applying a style is a plain edit,
    // not a distinct permission.
    const styleSelectionWatcher = EditorView.updateListener.of((update) => {
      if (readOnly || !update.selectionSet) return;
      const { from, to } = update.view.state.selection.main;
      if (from === to) {
        setStyleTrigger(null);
        return;
      }
      const coords = update.view.coordsAtPos(to);
      if (!coords) {
        setStyleTrigger(null);
        return;
      }
      const hostRect = hostRef.current!.getBoundingClientRect();
      // +30 on y: the Comment trigger above anchors at this same
      // coordsAtPos(to) point, so without an offset the two buttons stack
      // exactly on top of each other whenever both are available (only
      // the topmost is ever clickable) — stacking Style's trigger just
      // below Comment's instead of guessing at Comment's own pixel width
      // to offset sideways.
      setStyleTrigger({ from, to, x: coords.left - hostRect.left, y: coords.bottom - hostRect.top + 30 });
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
        // GFM adds Strikethrough/TaskList/Table/Autolink node types to the
        // parse tree — the base markdown() config doesn't include them,
        // and the live-preview plugin below needs Strikethrough/TaskMarker
        // nodes to exist to decorate them at all.
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        dark ? oneDark : lightCmTheme(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        yCollab(ytext, awareness, { undoManager }),
        slashWatcher,
        selectionWatcher,
        styleSelectionWatcher,
        spellcheckWatcher,
        misspellingClickHandler,
        commentRangesField,
        misspellingsField,
        liveFormattingCompartment.of(liveFormatting ? [livePreviewPlugin] : []),
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
    if (view == null) return;
    view.dispatch({ effects: liveFormattingCompartment.reconfigure(liveFormatting ? [livePreviewPlugin] : []) });
  }, [liveFormatting]);

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

  // Scans the line(s) spanning [from, to] for an existing [text]{attrs}
  // match whose inner range exactly equals the current selection — lets
  // the popover pre-fill and Apply *replace* that span instead of
  // wrapping a second one around it. An overlapping-but-not-exact
  // selection (e.g. only part of an existing span, or the span plus
  // surrounding text) is treated as "no existing match" — deliberately:
  // guessing at partial-overlap intent risks mangling text neither this
  // click nor a plain re-selection asked for.
  function findExistingStyleMatch(view: EditorView, from: number, to: number): { from: number; to: number; attrs: StyleAttrs } | null {
    const firstLine = view.state.doc.lineAt(from);
    const lastLine = view.state.doc.lineAt(to);
    const text = view.state.sliceDoc(firstLine.from, lastLine.to);
    for (const match of text.matchAll(STYLE_PATTERN)) {
      const matchStart = firstLine.from + (match.index ?? 0);
      const innerStart = matchStart + 1;
      const innerEnd = innerStart + match[1].length;
      const matchEnd = matchStart + match[0].length;
      if (innerStart === from && innerEnd === to) {
        return { from: matchStart, to: matchEnd, attrs: parseStyleAttrs(match[2]) };
      }
    }
    return null;
  }

  function openStylePopover() {
    const view = viewRef.current;
    if (!view || !styleTrigger) return;
    setExistingStyleMatch(findExistingStyleMatch(view, styleTrigger.from, styleTrigger.to));
    setStylePopoverOpen(true);
  }

  function applyTextStyle(attrs: StyleAttrs) {
    const view = viewRef.current;
    if (!view || !styleTrigger) return;
    const css = styleAttrsToCss(attrs);
    if (existingStyleMatch) {
      // Replace the whole existing [text]{attrs} span — if both attrs
      // were cleared, that means leaving the plain inner text behind
      // with no wrapper at all, not an empty {}.
      const inner = view.state.sliceDoc(styleTrigger.from, styleTrigger.to);
      const insert = css ? `[${inner}]${styleAttrsToSyntax(attrs)}` : inner;
      view.dispatch({ changes: { from: existingStyleMatch.from, to: existingStyleMatch.to, insert } });
    } else if (css) {
      // Two-part insert around the untouched selection (not a replace-
      // and-retype) so the wrapped text itself, cursor position, and
      // undo history all behave normally.
      view.dispatch({
        changes: [
          { from: styleTrigger.from, insert: "[" },
          { from: styleTrigger.to, insert: `]${styleAttrsToSyntax(attrs)}` },
        ],
      });
    }
    setStylePopoverOpen(false);
    setStyleTrigger(null);
    setExistingStyleMatch(null);
    view.focus();
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
      {styleTrigger && !stylePopoverOpen && (
        <button
          className="style-selection-trigger"
          style={{ left: styleTrigger.x, top: styleTrigger.y }}
          onMouseDown={(e) => {
            e.preventDefault(); // keeps the selection from collapsing before the click registers
            // Also stop this same mousedown from reaching document — the
            // popover about to open attaches its own document-level
            // mousedown listener (for click-outside-to-close) essentially
            // immediately, and without this it can catch this originating
            // click and close itself before ever becoming visible.
            e.stopPropagation();
            openStylePopover();
          }}
        >
          🎨 Style
        </button>
      )}
      {styleTrigger && stylePopoverOpen && (
        <TextStylePopover
          x={styleTrigger.x}
          y={styleTrigger.y}
          initial={existingStyleMatch?.attrs ?? {}}
          onApply={applyTextStyle}
          onClose={() => {
            setStylePopoverOpen(false);
            setStyleTrigger(null);
            setExistingStyleMatch(null);
          }}
        />
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
