import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
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

interface EditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  readOnly?: boolean;
  dark?: boolean;
}

export default function Editor({ ytext, awareness, readOnly = false, dark = true }: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selected, setSelected] = useState(0);

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
    </div>
  );
}
