import { describe, expect, it } from "vitest";
import { splitFrontBack } from "./flashcards";

describe("splitFrontBack", () => {
  it("splits on a line containing exactly ---", () => {
    const result = splitFrontBack("What is 2+2?\n---\n4");
    expect(result.front).toBe("What is 2+2?");
    expect(result.back).toBe("4");
  });

  it("trims whitespace around each side", () => {
    const result = splitFrontBack("  Front text  \n\n---\n\n  Back text  ");
    expect(result.front).toBe("Front text");
    expect(result.back).toBe("Back text");
  });

  it("treats the whole body as the front with no back if there's no separator", () => {
    const result = splitFrontBack("Just some content, no answer yet.");
    expect(result.front).toBe("Just some content, no answer yet.");
    expect(result.back).toBeNull();
  });

  it("doesn't split on a line that merely contains --- as a substring", () => {
    const result = splitFrontBack("Front ---not a separator---\n---\nBack");
    expect(result.front).toBe("Front ---not a separator---");
    expect(result.back).toBe("Back");
  });
});
