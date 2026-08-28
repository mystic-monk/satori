import { useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";
import { applyTextDiff } from "./collab";
import { parseFrontmatter, stringifyFrontmatter } from "../shared/frontmatter";
import "@excalidraw/excalidraw/index.css";

const ORIGIN = "canvas-editor";

interface CanvasNoteProps {
  raw: string;
  ytext: Y.Text;
  dark?: boolean;
}

interface ParsedScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

function parseScene(body: string): ParsedScene | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const scene = JSON.parse(trimmed);
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: scene.appState ?? {},
      // Same shape Excalidraw's own .excalidraw file format uses: files
      // keyed by fileId, each carrying its data as a base64 dataURL — so
      // images ride along in the same JSON blob as everything else,
      // through the same Yjs text/local+cloud sync/materialize-to-file
      // path the rest of the note already uses.
      files: scene.files && typeof scene.files === "object" ? scene.files : {},
    };
  } catch {
    return null;
  }
}

// See the note above parseScene for why images are persisted here at all —
// the earlier version of this file only kept elements + appState, so a
// dropped-in image would render for the current session and then silently
// vanish on the next reload since its bytes were never saved anywhere.
export default function CanvasNote({ raw, ytext, dark = true }: CanvasNoteProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialScene] = useState(() => parseScene(parseFrontmatter(raw).body));

  function onChange(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { data } = parseFrontmatter(ytext.toString());
      const scene = {
        type: "excalidraw",
        version: 2,
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
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
          appState: { ...initialScene?.appState, theme: dark ? "dark" : "light" },
          files: initialScene?.files ?? {},
        }}
        onChange={onChange}
        theme={dark ? "dark" : "light"}
      />
    </div>
  );
}
