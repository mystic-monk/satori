import { beforeEach, describe, expect, it } from "vitest";

// identity.ts is a browser module (localStorage-backed); this project's
// vitest config runs in plain Node with no jsdom, so the handful of calls
// it makes (getItem/setItem) get a minimal in-memory stand-in rather than
// pulling in a whole DOM-testing dependency for one file.
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

const { clearEmailIdentity, getIdentity, setDisplayName, setIdentityFromEmail, setPersona, markPersonaSeeded } =
  await import("./identity");

beforeEach(() => {
  localStorage.clear();
});

// Regression coverage for the bug where "use email instead of anonymous"
// left the always-visible "You: {name}" header still reading "Anonymous"
// because setIdentityFromEmail only ever touched id/email, never name.
describe("setIdentityFromEmail", () => {
  it("derives a display name from the email when still on the default Anonymous name", async () => {
    expect(getIdentity().name).toBe("Anonymous");
    const identity = await setIdentityFromEmail("ada@example.com");
    expect(identity.name).toBe("ada");
    expect(identity.email).toBe("ada@example.com");
  });

  it("does not override a display name the user already chose", async () => {
    setDisplayName("Ada");
    const identity = await setIdentityFromEmail("ada@example.com");
    expect(identity.name).toBe("Ada");
  });

  it("typing the same email again reproduces the same id", async () => {
    const first = await setIdentityFromEmail("ada@example.com");
    localStorage.clear();
    const second = await setIdentityFromEmail("ada@example.com");
    expect(second.id).toBe(first.id);
  });

  it("rejects an invalid email without changing the stored identity", async () => {
    await expect(setIdentityFromEmail("not-an-email")).rejects.toThrow();
    expect(getIdentity().name).toBe("Anonymous");
    expect(getIdentity().email).toBeUndefined();
  });
});

describe("getIdentity self-heal", () => {
  it("repairs a stored identity stuck with email set but name still Anonymous", () => {
    localStorage.setItem(
      "pkm-identity",
      JSON.stringify({ id: "old-hash-id", name: "Anonymous", color: "#30bced", email: "arya.ankush@gmail.com" })
    );
    const repaired = getIdentity();
    expect(repaired.name).toBe("arya.ankush");
    // id/color/email untouched — only the stuck name field is repaired
    expect(repaired.id).toBe("old-hash-id");
    expect(repaired.email).toBe("arya.ankush@gmail.com");

    // Repair is persisted, not just returned in-memory
    expect(getIdentity().name).toBe("arya.ankush");
  });

  it("never touches a name the user actually chose alongside an email", () => {
    localStorage.setItem(
      "pkm-identity",
      JSON.stringify({ id: "id", name: "Ada Lovelace", color: "#30bced", email: "ada@example.com" })
    );
    expect(getIdentity().name).toBe("Ada Lovelace");
  });
});

describe("markPersonaSeeded", () => {
  it("records a persona as seeded", () => {
    setPersona("author");
    expect(getIdentity().seededPersonas).toBeUndefined();
    markPersonaSeeded("author");
    expect(getIdentity().seededPersonas).toEqual(["author"]);
  });

  it("accumulates across different personas", () => {
    markPersonaSeeded("author");
    markPersonaSeeded("student");
    expect(getIdentity().seededPersonas).toEqual(["author", "student"]);
  });

  it("does not duplicate an already-seeded persona", () => {
    markPersonaSeeded("author");
    markPersonaSeeded("author");
    expect(getIdentity().seededPersonas).toEqual(["author"]);
  });

  it("survives clearing and re-picking the same persona (the whole point of tracking it separately from persona itself)", () => {
    setPersona("author");
    markPersonaSeeded("author");
    setPersona(undefined);
    setPersona("author");
    expect(getIdentity().seededPersonas).toEqual(["author"]);
  });
});

describe("clearEmailIdentity", () => {
  it("drops the email and id but keeps the display name and color", async () => {
    const withEmail = await setIdentityFromEmail("ada@example.com");
    const cleared = clearEmailIdentity();
    expect(cleared.email).toBeUndefined();
    expect(cleared.id).not.toBe(withEmail.id);
    expect(cleared.name).toBe(withEmail.name);
    expect(cleared.color).toBe(withEmail.color);
  });
});
