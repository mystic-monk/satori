// Not an account system — just a per-person label collaborators (local or
// cloud) can tell apart, and that change history can attach a save to.
// Stored in localStorage: private to this browser, never sent anywhere but
// our own local server. `id` is the part that makes this *portable*: a
// stable UUID generated once, carried across renames (setDisplayName keeps
// it) and across devices via exportIdentity/importIdentity — the name and
// color alone used to be the only signal, which meant a rename or a new
// browser/device silently became a different person as far as History was
// concerned. It's still just a self-declared label, not verified identity —
// see the identity-scoping plan for what a cryptographically verified
// version (signed contributions, an unspoofable id) would look like.
export interface Identity {
  id: string;
  name: string;
  color: string;
}

const IDENTITY_KEY = "pkm-identity";
// Pre-Phase-A keys, read once to carry an existing user's established
// name/color into their new identity object rather than resetting them.
const LEGACY_NAME_KEY = "pkm-display-name";
const LEGACY_COLOR_KEY = "pkm-cursor-color";

// y-codemirror.next reads awareness state.user.{name,color,colorLight} to
// render remote cursors/selections — see y-remote-selections.js.
const CURSOR_COLORS = [
  "#30bced",
  "#6eeb83",
  "#ffbc42",
  "#ecd444",
  "#ee6352",
  "#9ac2c9",
  "#8acb88",
  "#1be7ff",
];

function randomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

function isIdentity(v: unknown): v is Identity {
  const o = v as Record<string, unknown>;
  return !!o && typeof o.id === "string" && typeof o.name === "string" && typeof o.color === "string";
}

function createIdentity(): Identity {
  const legacyName = localStorage.getItem(LEGACY_NAME_KEY);
  const legacyColor = localStorage.getItem(LEGACY_COLOR_KEY);
  const name = legacyName ?? window.prompt("Your display name (shown to collaborators):", "Anonymous")?.trim() ?? "Anonymous";
  return { id: crypto.randomUUID(), name: name || "Anonymous", color: legacyColor ?? randomColor() };
}

function save(identity: Identity): Identity {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

export function getIdentity(): Identity {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isIdentity(parsed)) return parsed;
    } catch {
      // fall through to (re)create below
    }
  }
  return save(createIdentity());
}

export function setDisplayName(name: string): Identity {
  return save({ ...getIdentity(), name });
}

// Public info only (id/name/color) — safe to paste anywhere, unlike a
// future verified-identity private key export, which would need
// passphrase encryption (see the identity-scoping plan's Phase B).
export function exportIdentity(): string {
  return JSON.stringify(getIdentity());
}

export function importIdentity(blob: string): Identity {
  const parsed = JSON.parse(blob);
  if (!isIdentity(parsed)) throw new Error("invalid identity blob");
  return save(parsed);
}
