import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableWidth {
  width: number;
  resizing: boolean;
  onHandleMouseDown: (e: React.MouseEvent) => void;
}

// Backs the drag-to-resize handle on the rail, sidebar, and right panel —
// a plain col-resize drag, not a library, since it's just "track mouse X
// while a flag is set" with no other moving parts. `edge` is which side of
// the viewport the panel is anchored to: the rail/sidebar hang off the
// left (width is the mouse's clientX), the right panel hangs off the
// right (width is the distance from the mouse to the *right* edge of the
// window instead). `offset` (left edge only) is how much of that clientX
// belongs to something already occupying space before this panel's own
// left edge — the sidebar sits to the right of the rail now, not flush
// against the viewport, so its width has to subtract however wide the
// rail currently is, not just read raw clientX the way the rail itself
// (offset 0, genuinely flush left) still does.
export function useResizableWidth(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
  edge: "left" | "right",
  offset = 0
): ResizableWidth {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);
  // Avoids the drag handlers closing over a stale `edge`/`min`/`max`/
  // `offset` from the render that started the drag — `offset` in
  // particular can genuinely change mid-drag if two panels sharing an
  // edge were somehow both resized at once, so this has to stay live
  // rather than being captured once at drag-start.
  const configRef = useRef({ min, max, edge, offset });
  configRef.current = { min, max, edge, offset };

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    function onMouseMove(e: MouseEvent) {
      const { min, max, edge, offset } = configRef.current;
      const raw = edge === "left" ? e.clientX - offset : window.innerWidth - e.clientX;
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
