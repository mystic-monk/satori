import { useEffect, useRef, useState } from "react";
import { COLOR_PRESETS, FONT_KEYWORDS, FONT_STACKS, type FontKeyword, type StyleAttrs } from "./styledText";

interface TextStylePopoverProps {
  x: number;
  y: number;
  initial: StyleAttrs;
  onApply: (attrs: StyleAttrs) => void;
  onClose: () => void;
}

const FONT_LABELS: Record<FontKeyword, string> = {
  serif: "Serif",
  sans: "Sans",
  mono: "Mono",
  rounded: "Rounded",
};

// Same interaction shape as ReminderPopup.tsx (pick options, explicit
// Apply to commit, Cancel/outside-click to dismiss) rather than an
// instant-apply-per-click swatch grid — lets color and font be picked
// together and committed as one edit instead of needing two separate
// selections (which would otherwise double-wrap the text on the second
// pass; see Editor.tsx's findExistingStyleMatch for the other half of
// that — re-opening on an already-styled span replaces it instead).
export default function TextStylePopover({ x, y, initial, onApply, onClose }: TextStylePopoverProps) {
  const [color, setColor] = useState<string | undefined>(initial.color);
  const [font, setFont] = useState<FontKeyword | undefined>(initial.font);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  return (
    <div ref={rootRef} className="text-style-popover" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div className="text-style-section-label">Color</div>
      <div className="text-style-swatches">
        <button
          type="button"
          className={`text-style-swatch text-style-swatch-none ${!color ? "active" : ""}`}
          title="No color"
          aria-label="No color"
          onClick={() => setColor(undefined)}
        >
          ✕
        </button>
        {COLOR_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`text-style-swatch ${color === hex ? "active" : ""}`}
            style={{ background: hex }}
            title={hex}
            aria-label={`Color ${hex}`}
            onClick={() => setColor(hex)}
          />
        ))}
        <input
          type="color"
          className="text-style-swatch-custom"
          value={color ?? "#000000"}
          onChange={(e) => setColor(e.target.value)}
          title="Custom color"
          aria-label="Custom color"
        />
      </div>
      <div className="text-style-section-label">Font</div>
      <div className="text-style-fonts">
        <button
          type="button"
          className={!font ? "active" : ""}
          onClick={() => setFont(undefined)}
        >
          Default
        </button>
        {FONT_KEYWORDS.map((kw) => (
          <button
            key={kw}
            type="button"
            className={font === kw ? "active" : ""}
            style={{ fontFamily: FONT_STACKS[kw] }}
            onClick={() => setFont(kw)}
          >
            {FONT_LABELS[kw]}
          </button>
        ))}
      </div>
      <div className="text-style-popover-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={() => onApply({ color, font })}>
          Apply
        </button>
      </div>
    </div>
  );
}
