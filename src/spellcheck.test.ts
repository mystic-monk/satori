import { describe, it, expect } from "vitest";
import { checkText, suggest } from "./spellcheck";

describe("spellcheck", () => {
  it(
    "flags a misspelled word and reports its offset",
    async () => {
      const results = await checkText("The qwikk brown fox jumps over the lazy dog.");
      expect(results).toHaveLength(1);
      expect(results[0].word).toBe("qwikk");
      expect(results[0].from).toBe(4);
      expect(results[0].to).toBe(9);
    },
    20000
  );

  it("does not flag correctly spelled prose", async () => {
    const results = await checkText("The quick brown fox jumps over the lazy dog.");
    expect(results).toHaveLength(0);
  });

  it("does not flag words containing an internal apostrophe", async () => {
    const results = await checkText("It's a beautiful day and the dog's bone is buried.");
    expect(results.map((r) => r.word)).not.toContain("It's");
    expect(results.map((r) => r.word)).not.toContain("dog's");
  });

  it("suggests corrections for a misspelled word", async () => {
    const suggestions = await suggest("wrold");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).toContain("world");
  });
});
