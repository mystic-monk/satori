import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty data and the raw body when there's no frontmatter block", () => {
    const result = parseFrontmatter("just a note\nwith no frontmatter");
    expect(result.data).toEqual({});
    expect(result.body).toBe("just a note\nwith no frontmatter");
  });

  it("parses a YAML frontmatter block and strips it from the body", () => {
    const raw = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody text.";
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(result.body).toBe("Body text.");
  });

  it("treats malformed YAML as no properties instead of throwing", () => {
    const raw = "---\ntitle: [unterminated\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({});
    expect(result.body).toBe("Body.");
  });

  it("handles CRLF line endings the same as LF", () => {
    const raw = "---\r\ntitle: Hello\r\n---\r\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: "Hello" });
    expect(result.body).toBe("Body.");
  });
});

describe("stringifyFrontmatter", () => {
  it("returns the body unchanged when there are no properties", () => {
    expect(stringifyFrontmatter({}, "Body.")).toBe("Body.");
  });

  it("emits a --- delimited YAML block ahead of the body", () => {
    const out = stringifyFrontmatter({ title: "Hello", tags: ["a"] }, "Body.");
    expect(out).toBe("---\ntitle: Hello\ntags:\n  - a\n---\nBody.");
  });

  it("round-trips through parse -> stringify -> parse unchanged", () => {
    const original = { title: "Hello", tags: ["a", "b"], count: 3 };
    const stringified = stringifyFrontmatter(original, "Body text.");
    const reparsed = parseFrontmatter(stringified);
    expect(reparsed.data).toEqual(original);
    expect(reparsed.body).toBe("Body text.");
  });
});
