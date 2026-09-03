import { beforeEach, describe, expect, it } from "vitest";

// Same in-memory localStorage stand-in as identity.test.ts — this project's
// vitest config runs in plain Node with no jsdom.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { getOpenTabs, saveOpenTabs, openTab, closeTab, pruneOpenTabs } = await import("./openTabs");

beforeEach(() => {
  localStorage.clear();
});

describe("openTab", () => {
  it("appends a new path at the end", () => {
    expect(openTab(["a.md", "b.md"], "c.md")).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("leaves an already-open tab's position unchanged instead of reordering", () => {
    expect(openTab(["a.md", "b.md", "c.md"], "a.md")).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("evicts from the front once past the cap", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `n${i}.md`);
    const next = openTab(fifteen, "n15.md");
    expect(next.length).toBe(15);
    expect(next[0]).toBe("n1.md");
    expect(next[next.length - 1]).toBe("n15.md");
  });
});

describe("closeTab", () => {
  it("removes a non-active tab and leaves activePath untouched", () => {
    const result = closeTab(["a.md", "b.md", "c.md"], "b.md", "a.md");
    expect(result.tabs).toEqual(["a.md", "c.md"]);
    expect(result.nextActive).toBe("a.md");
  });

  it("falls back to the left neighbor when closing the active tab", () => {
    const result = closeTab(["a.md", "b.md", "c.md"], "b.md", "b.md");
    expect(result.tabs).toEqual(["a.md", "c.md"]);
    expect(result.nextActive).toBe("a.md");
  });

  it("falls back to the right neighbor when closing the first (active) tab", () => {
    const result = closeTab(["a.md", "b.md", "c.md"], "a.md", "a.md");
    expect(result.tabs).toEqual(["b.md", "c.md"]);
    expect(result.nextActive).toBe("b.md");
  });

  it("falls back to null when closing the only open tab", () => {
    const result = closeTab(["a.md"], "a.md", "a.md");
    expect(result.tabs).toEqual([]);
    expect(result.nextActive).toBeNull();
  });

  it("no-ops on a path that isn't open", () => {
    const result = closeTab(["a.md", "b.md"], "z.md", "a.md");
    expect(result.tabs).toEqual(["a.md", "b.md"]);
    expect(result.nextActive).toBe("a.md");
  });
});

describe("pruneOpenTabs", () => {
  it("drops paths no longer in the vault, preserving order of the rest", () => {
    const existing = new Set(["a.md", "c.md"]);
    expect(pruneOpenTabs(["a.md", "b.md", "c.md"], existing)).toEqual(["a.md", "c.md"]);
  });
});

describe("getOpenTabs / saveOpenTabs", () => {
  it("round-trips through localStorage", () => {
    saveOpenTabs(["a.md", "b.md"]);
    expect(getOpenTabs()).toEqual(["a.md", "b.md"]);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(getOpenTabs()).toEqual([]);
  });

  it("returns an empty list for malformed stored JSON", () => {
    localStorage.setItem("pkm-open-tabs", "not json");
    expect(getOpenTabs()).toEqual([]);
  });
});
