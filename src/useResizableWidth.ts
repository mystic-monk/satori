import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableWidth {
  width: number;
  resizing: boolean;
  onHandleMouseDown: (e: React.MouseEvent) => void;
}

// Backs the drag-to-resize handle on the sidebar and the right panel — a
// plain col-resize drag, not a library, since it's just "track mouse X
// while a flag is set" with no other moving parts. `edge` is which side of
// the viewport the panel is anchored to: the sidebar hangs off the left
// (its width is the mouse's raw clientX), the right panel hangs off the
// right (its width is the distance from the mouse to the *right* edge of
// the window instead).
export function useResizableWidth(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
  edge: "left" | "right"
): ResizableWidth {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);
  // Avoids the drag handlers closing over a stale `edge`/`min`/`max` from
  // the render that started the drag — they're static per-call anyway, but
  // this keeps the effect below from needing them in its dependency array.
  const configRef = useRef({ min, max, edge });
  configRef.current = { min, max, edge };

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    function onMouseMove(e: MouseEvent) {
      const { min, max, edge } = configRef.current;
      const raw = edge === "left" ? e.clientX : window.innerWidth - e.clientX;
      setWidth(Math.min(max, Math.max(min, raw)));
    }
    function onMouseUp() {
      setResizing(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing]);

  // Persisted only once dragging ends, not on every mousemove tick — same
  // "commit on release, not on every intermediate value" reasoning as any
  // other debounced-write pattern in this codebase.
  useEffect(() => {
    if (resizing) return;
    localStorage.setItem(storageKey, String(width));
    // Deliberately omits `width` from a "run once at mount" guard: this is
    // supposed to fire every time resizing transitions true -> false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing]);

  return { width, resizing, onHandleMouseDown };
}
