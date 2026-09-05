import { beforeEach, describe, expect, it } from "vitest";

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

const { getRecent, recordOpened, pruneDeleted } = await import("./recentNotes");

beforeEach(() => {
  localStorage.clear();
});

describe("recordOpened", () => {
  it("stamps a new entry with the current time", () => {
    const before = Date.now();
    const [entry] = recordOpened("a.md", "A", null);
    expect(entry.openedAt).toBeGreaterThanOrEqual(before);
    expect(entry.openedAt).toBeLessThanOrEqual(Date.now());
  });

  it("moves an already-present entry to the front with a fresh timestamp instead of duplicating it", () => {
    recordOpened("a.md", "A", null);
    recordOpened("b.md", "B", null);
    const afterFirstTwo = getRecent();
    expect(afterFirstTwo.map((n) => n.path)).toEqual(["b.md", "a.md"]);

    const reopened = recordOpened("a.md", "A", null);
    expect(reopened.map((n) => n.path)).toEqual(["a.md", "b.md"]);
    expect(reopened).toHaveLength(2);
  });

  it("caps the list at 50 entries", () => {
    for (let i = 0; i < 55; i++) recordOpened(`note-${i}.md`, `Note ${i}`, null);
    expect(getRecent()).toHaveLength(50);
    // Most recently opened stays at the front, oldest are dropped.
    expect(getRecent()[0].path).toBe("note-54.md");
  });
});

describe("getRecent backward compatibility", () => {
  it("defaults openedAt to 0 for entries recorded before this field existed", () => {
    localStorage.setItem("pkm-recent-notes", JSON.stringify([{ path: "old.md", title: "Old" }]));
    expect(getRecent()).toEqual([{ path: "old.md", title: "Old", type: null, openedAt: 0 }]);
  });
});

describe("pruneDeleted", () => {
  it("drops entries whose path no longer exists", () => {
    recordOpened("keep.md", "Keep", null);
    recordOpened("gone.md", "Gone", null);
    const pruned = pruneDeleted(new Set(["keep.md"]));
    expect(pruned.map((n) => n.path)).toEqual(["keep.md"]);
  });
});
