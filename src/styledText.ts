// Shared parsing/validation/CSS-building for the `[text]{color=#hex
// font=serif}` inline syntax — single source of truth for both extension
// points that need to understand it: markdown.ts's Preview/export
// renderer and Editor.tsx's Live-mode decorator. Modeled on Pandoc's
// bracketed-span convention (`[text]{.class key=val}`), not invented from
// nothing.
//
// Color is a strictly-validated hex value, not passed through unchecked —
// it ends up interpolated into a `style="..."` attribute, a real CSS-
// injection surface for an arbitrary string. Font is a small curated
// keyword list rather than a free-text font-family string, for the same
// injection reason plus a practical one: an arbitrary font name silently
// falls back to nothing on a collaborator's device that doesn't have it
// installed, undermining "this note looks the same for everyone" the way
// an arbitrary color doesn't.

export type FontKeyword = "serif" | "sans" | "mono" | "rounded";

export const FONT_STACKS: Record<FontKeyword, string> = {
  serif: "Georgia, Cambria, \"Times New Roman\", Times, serif",
  sans: "Helvetica, Arial, sans-serif",
  mono: "ui-monospace, \"SF Mono\", Menlo, monospace",
  rounded: "ui-rounded, \"SF Pro Rounded\", Verdana, sans-serif",
};

export const FONT_KEYWORDS = Object.keys(FONT_STACKS) as FontKeyword[];

// Fixed hex values, not theme-variable-backed — deliberately, since a
// user-chosen color is meant to look the same regardless of who's
// reading it or which theme they're on. Chosen at a mid-tone/moderate
// saturation so each stays legible on both a light and a dark
// background; genuinely arbitrary choice (the color input below) is the
// author's own responsibility from there, the same tradeoff any rich-
// text tool's custom-color option accepts.
export const COLOR_PRESETS = [
  "#e05252", // red
  "#e0913f", // orange
  "#c9a227", // yellow
  "#4caf6d", // green
  "#4a90d9", // blue
  "#9463c9", // purple
  "#d9639a", // pink
  "#8a8f98", // gray
];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface StyleAttrs {
  color?: string;
  font?: FontKeyword;
}

// Matches [inner]{attrs} — used identically by markdown.ts's inline rule
// (scanning the raw markdown source) and Editor.tsx's Live-mode decorator
// (scanning visible editor text), so both agree on exactly what counts as
// this syntax. Not anchored/global here; callers exec per-match.
export const STYLE_PATTERN = /\[([^\]\n]+)\]\{([^}\n]*)\}/g;

// raw is the text between { and } — e.g. "color=#ff0000 font=serif".
// Unknown keys, malformed pairs, and invalid values are silently
// dropped rather than throwing: a rejected value should fall back to
// plain text, not break rendering.
export function parseStyleAttrs(raw: string): StyleAttrs {
  const attrs: StyleAttrs = {};
  for (const pair of raw.trim().split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key === "color" && HEX_COLOR_RE.test(value)) {
      attrs.color = value;
    } else if (key === "font" && (FONT_KEYWORDS as string[]).includes(value)) {
      attrs.font = value as FontKeyword;
    }
  }
  return attrs;
}

// Empty attrs (both invalid/absent) yields "" — callers should treat that
// as "don't apply a style attribute at all" rather than emitting style="".
export function styleAttrsToCss(attrs: StyleAttrs): string {
  const parts: string[] = [];
  if (attrs.color) parts.push(`color: ${attrs.color}`);
  if (attrs.font) parts.push(`font-family: ${FONT_STACKS[attrs.font]}`);
  return parts.join("; ");
}

// Re-serializes attrs back into the `{color=#hex font=serif}` form —
// used when applying an edit to an already-styled span, so Apply can
// rebuild the delimiter text from the popover's current picks.
export function styleAttrsToSyntax(attrs: StyleAttrs): string {
  const parts: string[] = [];
  if (attrs.color) parts.push(`color=${attrs.color}`);
  if (attrs.font) parts.push(`font=${attrs.font}`);
  return `{${parts.join(" ")}}`;
}
