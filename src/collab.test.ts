import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeNoteApi = vi.fn().mockResolvedValue(undefined);
vi.mock("./api", () => ({ writeNoteApi: (...args: unknown[]) => writeNoteApi(...args) }));

const { openTauriLocalSession } = await import("./collab");

const author = { id: "a1", name: "Ada" };

beforeEach(() => {
  vi.useFakeTimers();
  writeNoteApi.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// Regression coverage for a real race: confirmDelete() (App.tsx) used to
// tear this session down only via setActivePath(null), which just
// *schedules* React's effect cleanup — not guaranteed to run before the
// delete request that follows it. If a debounced autosave was still
// pending at that moment, destroy()'s normal flush-on-close behavior
// would write the note straight back to disk moments after the delete
// call removed it, resurrecting it. destroy(true) is how the delete path
// now opts out of that flush.
describe("openTauriLocalSession destroy", () => {
  it("flushes a pending debounced save on a normal destroy()", () => {
    const session = openTauriLocalSession("note.md", "hello", author);
    session.ytext.insert(5, " world");
    session.destroy();
    expect(writeNoteApi).toHaveBeenCalledWith("note.md", "hello world", author);
  });

  it("does NOT flush when destroy(true) is used (about-to-be-deleted note)", () => {
    const session = openTauriLocalSession("note.md", "hello", author);
    session.ytext.insert(5, " world");
    session.destroy(true);
    expect(writeNoteApi).not.toHaveBeenCalled();
  });

  it("is a safe no-op the second time it's called", () => {
    const session = openTauriLocalSession("note.md", "hello", author);
    session.ytext.insert(5, " world");
    session.destroy(true);
    session.destroy(); // e.g. the effect cleanup running afterward, unaware this already happened
    expect(writeNoteApi).not.toHaveBeenCalled();
  });

  it("with no edits at all, destroy() never calls writeNoteApi", () => {
    const session = openTauriLocalSession("note.md", "hello", author);
    session.destroy();
    expect(writeNoteApi).not.toHaveBeenCalled();
  });
});
