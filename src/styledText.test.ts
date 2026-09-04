import { describe, expect, it } from "vitest";
import { parseStyleAttrs, styleAttrsToCss, styleAttrsToSyntax, STYLE_PATTERN } from "./styledText";

describe("parseStyleAttrs", () => {
  it("parses a valid color", () => {
    expect(parseStyleAttrs("color=#ff0000")).toEqual({ color: "#ff0000" });
  });

  it("parses a valid 3-digit hex color", () => {
    expect(parseStyleAttrs("color=#f00")).toEqual({ color: "#f00" });
  });

  it("parses a valid font keyword", () => {
    expect(parseStyleAttrs("font=serif")).toEqual({ font: "serif" });
  });

  it("parses combined color and font, either order", () => {
    expect(parseStyleAttrs("color=#ff0000 font=serif")).toEqual({ color: "#ff0000", font: "serif" });
    expect(parseStyleAttrs("font=mono color=#00ff00")).toEqual({ color: "#00ff00", font: "mono" });
  });

  it("drops an invalid hex value", () => {
    expect(parseStyleAttrs("color=red")).toEqual({});
    expect(parseStyleAttrs("color=#ff00")).toEqual({});
    expect(parseStyleAttrs("color=javascript:alert(1)")).toEqual({});
  });

  it("drops an unknown font keyword", () => {
    expect(parseStyleAttrs("font=ComicSans")).toEqual({});
  });

  it("drops unknown keys and malformed pairs", () => {
    expect(parseStyleAttrs("size=12px")).toEqual({});
    expect(parseStyleAttrs("color")).toEqual({});
    expect(parseStyleAttrs("")).toEqual({});
  });
});

describe("styleAttrsToCss", () => {
  it("builds a CSS declaration string for color only", () => {
    expect(styleAttrsToCss({ color: "#ff0000" })).toBe("color: #ff0000");
  });

  it("builds a CSS declaration string for font only", () => {
    expect(styleAttrsToCss({ font: "mono" })).toContain("font-family:");
  });

  it("combines both when present", () => {
    const css = styleAttrsToCss({ color: "#ff0000", font: "serif" });
    expect(css).toContain("color: #ff0000");
    expect(css).toContain("font-family:");
  });

  it("returns an empty string when nothing is set", () => {
    expect(styleAttrsToCss({})).toBe("");
  });
});

describe("styleAttrsToSyntax", () => {
  it("round-trips through parseStyleAttrs", () => {
    const attrs = { color: "#ff0000", font: "serif" as const };
    const syntax = styleAttrsToSyntax(attrs);
    expect(syntax).toBe("{color=#ff0000 font=serif}");
    expect(parseStyleAttrs(syntax.slice(1, -1))).toEqual(attrs);
  });
});

describe("STYLE_PATTERN", () => {
  it("matches [text]{attrs}", () => {
    const matches = [..."hello [world]{color=#ff0000} there".matchAll(STYLE_PATTERN)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("world");
    expect(matches[0][2]).toBe("color=#ff0000");
  });

  it("does not match a plain markdown link", () => {
    const matches = [..."[text](https://example.com)".matchAll(STYLE_PATTERN)];
    expect(matches).toHaveLength(0);
  });

  it("does not match a wikilink", () => {
    const matches = [..."[[Some Note]]".matchAll(STYLE_PATTERN)];
    expect(matches).toHaveLength(0);
  });

  it("does not match a citation", () => {
    const matches = [..."[@citekey]".matchAll(STYLE_PATTERN)];
    expect(matches).toHaveLength(0);
  });

  it("matches multiple occurrences", () => {
    const matches = [..."[a]{color=#111111} and [b]{font=mono}".matchAll(STYLE_PATTERN)];
    expect(matches).toHaveLength(2);
  });
});
