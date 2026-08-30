import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteListItem } from "./api";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  // A real, already-working keyboard shortcut (e.g. the native menu's
  // accelerator) — deliberately separate from `hint` above, which notes
  // use for a file path, a different kind of information styled
  // differently (a kbd-style badge here vs. plain dim text there).
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  notes: NoteListItem[];
  onOpenNote: (path: string, title: string) => void;
  onClose: () => void;
}

// Simple subsequence fuzzy match (VSCode/Sublime-style) rather than a
// dependency — every character of the query has to appear in order in the
// target, not necessarily contiguously, so "nn" matches "New Note". No
// scoring beyond match-length vs. target-length, which is plenty for a
// personal vault's command list + note titles.
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  let qi = 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({ commands, notes, onOpenNote, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredCommands = useMemo(
    () => commands.filter((c) => fuzzyMatch(query, c.label)),
    [commands, query]
  );
  const filteredNotes = useMemo(
    () => (query ? notes.filter((n) => fuzzyMatch(query, n.title)).slice(0, 20) : []),
    [notes, query]
  );

  type Entry = { key: string; label: string; hint?: string; shortcut?: string; run: () => void };
  const entries: Entry[] = [
    ...filteredCommands.map((c) => ({ key: `cmd:${c.id}`, label: c.label, hint: c.hint, shortcut: c.shortcut, run: c.action })),
    ...filteredNotes.map((n) => ({
      key: `note:${n.path}`,
      label: n.title,
      hint: n.path,
      run: () => onOpenNote(n.path, n.title),
    })),
  ];

  useEffect(() => {
    setSelected(0);
  }, [query]);

  function run(entry: Entry | undefined) {
    if (!entry) return;
    entry.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(entries[selected]);
    }
  }

  return (
    <div className="modal-backdrop command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder="Search notes or run a command…"
          aria-label="Command palette"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="command-palette-list">
          {entries.length === 0 && <li className="command-palette-empty">No matches.</li>}
          {entries.map((entry, i) => (
            <li
              key={entry.key}
              className={i === selected ? "active" : ""}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(entry)}
            >
              <span className="command-palette-label">{entry.label}</span>
              {entry.shortcut && <kbd className="command-palette-shortcut">{entry.shortcut}</kbd>}
              {entry.hint && <span className="command-palette-hint">{entry.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
