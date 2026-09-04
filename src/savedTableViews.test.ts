import { beforeEach, describe, expect, it } from "vitest";

// Same in-memory localStorage stand-in as identity.test.ts/openTabs.test.ts
// — this project's vitest config runs in plain Node with no jsdom.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  getSavedViews,
  saveSavedViews,
  createView,
  updateView,
  deleteView,
  getActiveViewId,
  saveActiveViewId,
} = await import("./savedTableViews");

beforeEach(() => {
  localStorage.clear();
});

describe("createView", () => {
  it("appends a new view with a generated id, blank rollups, and default sort", () => {
    const views = createView([], "Books to read", "type: book\nstatus: to-read");
    expect(views.length).toBe(1);
    expect(views[0].name).toBe("Books to read");
    expect(views[0].filterText).toBe("type: book\nstatus: to-read");
    expect(views[0].rollups).toEqual([]);
    expect(views[0].sortKey).toBe("title");
    expect(views[0].sortDir).toBe("asc");
    expect(typeof views[0].id).toBe("string");
    expect(views[0].id.length).toBeGreaterThan(0);
  });

  it("generates distinct ids for successive views", () => {
    const first = createView([], "A", "type: a");
    const both = createView(first, "B", "type: b");
    expect(both[0].id).not.toBe(both[1].id);
  });
});

describe("updateView", () => {
  it("patches only the matching id, leaving others untouched", () => {
    let views = createView([], "A", "type: a");
    views = createView(views, "B", "type: b");
    const targetId = views[0].id;
    const next = updateView(views, targetId, { name: "A renamed" });
    expect(next.find((v) => v.id === targetId)?.name).toBe("A renamed");
    expect(next.find((v) => v.id !== targetId)?.name).toBe("B");
  });

  it("no-ops when the id isn't found", () => {
    const views = createView([], "A", "type: a");
    const next = updateView(views, "nonexistent", { name: "X" });
    expect(next).toEqual(views);
  });
});

describe("deleteView", () => {
  it("removes the view with the matching id", () => {
    let views = createView([], "A", "type: a");
    views = createView(views, "B", "type: b");
    const targetId = views[0].id;
    const next = deleteView(views, targetId);
    expect(next.length).toBe(1);
    expect(next[0].name).toBe("B");
  });
});

describe("getSavedViews / saveSavedViews", () => {
  it("round-trips through localStorage", () => {
    const views = createView([], "A", "type: a");
    saveSavedViews(views);
    expect(getSavedViews()).toEqual(views);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(getSavedViews()).toEqual([]);
  });

  it("returns an empty list for malformed stored JSON", () => {
    localStorage.setItem("pkm-table-views", "not json");
    expect(getSavedViews()).toEqual([]);
  });
});

describe("getActiveViewId / saveActiveViewId", () => {
  it("round-trips a set id", () => {
    saveActiveViewId("view-123");
    expect(getActiveViewId()).toBe("view-123");
  });

  it("clears the stored id when saved with null", () => {
    saveActiveViewId("view-123");
    saveActiveViewId(null);
    expect(getActiveViewId()).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(getActiveViewId()).toBeNull();
  });
});
