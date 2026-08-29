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
  // Present only when identity was set up via email (setIdentityFromEmail)
  // rather than the anonymous default. Stored locally so the panel can
  // show "signed in as ___" and so switching back to anonymous is a
  // deliberate action — never sent to a collaborator or a server; only
  // its SHA-256 hash (the `id` field) is ever broadcast. Typing the same
  // email on a different device deterministically reproduces the same
  // `id`, which is the actual point: portability without an export file.
  email?: string;
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

// No window.prompt() here — it doesn't work at all in the native app (see
// PromptDialog.tsx). Defaults straight to "Anonymous"; IdentityPanel.tsx
// already has a normal, working text input for changing it whenever the
// user wants, so there's no need for a blocking first-run dialog here.
function createIdentity(): Identity {
  const legacyName = localStorage.getItem(LEGACY_NAME_KEY);
  const legacyColor = localStorage.getItem(LEGACY_COLOR_KEY);
  return { id: crypto.randomUUID(), name: legacyName || "Anonymous", color: legacyColor ?? randomColor() };
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

// SHA-256 via the Web Crypto API (built into every browser/Node runtime,
// no dependency) rather than libsodium's Argon2id — this doesn't need to
// be slow-and-memory-hard the way a *secret* passphrase derivation does
// (src/crypto.ts's deriveKey): an email isn't a secret being protected
// against brute-force, it's a portable label being turned into a stable
// opaque id. Pulling in libsodium here would also undo the earlier fix
// that made it a lazy, cloud-sync-only import (~550KB of WASM every user
// would otherwise pay for on load).
async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Opt-in only — anonymous (the createIdentity() default) stays the
// zero-friction path. Typing the same email again later, on this device
// or a different one, reproduces the exact same `id`, so history stays
// attributed to one person without needing to export/import a blob.
// Not verified identity: nothing confirms the caller actually owns this
// email (no confirmation link is sent) — it's a portability improvement,
// not an authentication mechanism. See the identity-scoping plan's Phase
// B for what actual verification (signed contributions, an unspoofable
// key) would take.
export async function setIdentityFromEmail(email: string): Promise<Identity> {
  const trimmed = email.trim();
  if (!EMAIL_RE.test(trimmed)) throw new Error("not a valid email address");
  const id = await hashEmail(trimmed);
  return save({ ...getIdentity(), id, email: trimmed.toLowerCase() });
}

// Switching back to anonymous is a deliberate, separate action, not just
// clearing the email field — it needs a fresh random id (the email-derived
// id must not linger once its owner has opted out of using it), which
// means this intentionally does NOT carry over history continuity, same
// "can't fix the past" tradeoff as any other identity-basis change.
export function clearEmailIdentity(): Identity {
  const current = getIdentity();
  return save({ id: crypto.randomUUID(), name: current.name, color: current.color });
}
