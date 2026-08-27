import { useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import "@excalidraw/excalidraw/index.css";

const ORIGIN = "canvas-editor";

interface CanvasNoteProps {
  raw: string;
  ytext: Y.Text;
}

function parseScene(body: string): { elements: readonly ExcalidrawElement[]; appState: Partial<AppState> } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const scene = JSON.parse(trimmed);
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: scene.appState ?? {},
    };
  } catch {
    return null;
  }
}

// The canvas scene (Excalidraw elements + view state) is persisted as JSON
// in the note's body, through the same Yjs text this note would otherwise
// hold markdown in — so it rides the existing local/cloud sync, materialize-
// to-file, and rebuildable-SQLite-cache machinery for free. Concurrent
// pixel-level co-drawing isn't as fine-grained as Excalidraw's own
// multiplayer story would give you (a whole-scene diff-replace on every
// change, not per-element ops), but two peers editing the same canvas note
// still converge correctly.
export default function CanvasNote({ raw, ytext }: CanvasNoteProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialScene] = useState(() => parseScene(parseFrontmatter(raw).body));

  function onChange(elements: readonly ExcalidrawElement[], appState: AppState, _files: BinaryFiles) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { data } = parseFrontmatter(ytext.toString());
      const scene = {
        type: "excalidraw",
        version: 2,
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
      };
      const nextRaw = stringifyFrontmatter(data, JSON.stringify(scene, null, 2) + "\n");
      applyTextDiff(ytext, nextRaw, ORIGIN);
    }, 500);
  }

  return (
    <div className="canvas-host">
      <Excalidraw
        initialData={{
          elements: initialScene?.elements ?? [],
          appState: { ...initialScene?.appState, theme: "dark" },
        }}
        onChange={onChange}
        theme="dark"
      />
    </div>
  );
}
