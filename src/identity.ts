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
  // Self-declared, optional — one of PERSONAS' ids, or unset. A display
  // label (the topbar switcher, IdentityPanel) that also seeds starter
  // content the first time it's picked — see PERSONA_STARTER_CONTENT.
  persona?: string;
  // Persona ids that have already had their starter content created —
  // distinct from "persona was ever set," so clearing a persona and
  // re-picking it later doesn't silently re-seed a second copy.
  seededPersonas?: string[];
}

export interface Persona {
  id: string;
  label: string;
}

export const PERSONAS: Persona[] = [
  { id: "author", label: "Author / Screenwriter" },
  { id: "researcher", label: "Researcher" },
  { id: "student", label: "Student" },
  { id: "team", label: "Team member" },
  { id: "planner", label: "Planner" },
  { id: "journaler", label: "Journaler" },
  { id: "developer", label: "Developer" },
  { id: "consultant", label: "Consultant" },
  { id: "privacy", label: "Privacy-focused" },
  { id: "visual", label: "Visual thinker" },
];

export function getPersona(id: string | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

// What makes picking a persona more than a label — App.tsx's
// onPersonaChange runs each persona's `notes` through createNoteFromTemplate
// the first time it's chosen (see Identity.seededPersonas above), so there's
// something real to look at immediately instead of an empty vault.
// `templatePath` reuses one of the app's own existing templates (Author/
// Planner map cleanly onto Project/Character — see vault/templates/); the
// rest don't have a matching template, so `tags`/`body` build a plain note
// the same shape createNoteFromTemplate's own no-template branch already
// does. `extraFrontmatter` is for properties a template doesn't declare by
// default (e.g. linking a seeded Character into a seeded Project via
// `project: [[...]]` — that relation is inbound-only, the Project's own
// `​```query` block picks it up from the Character's frontmatter, not the
// other way around). `openView` sends the user straight to the most
// relevant place to see the result, when that's not just "the note itself"
// (Flashcards' queue, Canvas' whiteboard) — App.tsx's onPersonaChange
// interprets it.
export interface StarterNote {
  title: string;
  templatePath?: string;
  tags?: string[];
  body?: string;
  extraFrontmatter?: Record<string, unknown>;
}

export interface PersonaStarterContent {
  notes: StarterNote[];
  openView?: "flashcards" | "canvas";
}

export const PERSONA_STARTER_CONTENT: Record<string, PersonaStarterContent> = {
  author: {
    notes: [
      { title: "My First Project", templatePath: "templates/project.md" },
      {
        title: "My First Character",
        templatePath: "templates/character.md",
        extraFrontmatter: { project: "[[My First Project]]" },
      },
    ],
  },
  researcher: {
    notes: [
      {
        title: "How citations work here",
        tags: ["reference"],
        body: [
          "Citing something in any note is just `[@citekey]` — it renders as `(Author, Year)` and links to a `type: reference` note with a matching `citekey` property.",
          "",
          "For example: [@example2024] — until a reference note with that citekey exists, it shows up as a broken link, which is the honest state to be in rather than a silent failure.",
          "",
          "Add a `​```bibliography` block anywhere to list every citation used in that note. Import an existing `.bib` file (**+ Create → Import .bib References…**) to bulk-create reference notes instead of typing them by hand.",
        ].join("\n"),
      },
    ],
  },
  student: {
    // Body format matches App.tsx's own flashcard convention exactly:
    // front text, then a line containing exactly "---", then back text —
    // that's what FlashcardReview.tsx splits on, not a tag or heading.
    notes: [
      {
        title: "What is spaced repetition?",
        extraFrontmatter: { type: "flashcard" },
        body: "What is spaced repetition?\n---\nA review schedule that spaces out repeat exposure to a fact over increasing intervals, timed just before you'd naturally forget it — this app schedules your reviews with the SM-2 algorithm automatically.",
      },
      {
        title: "How do I make more of these?",
        extraFrontmatter: { type: "flashcard" },
        body: "How do I make more flashcards?\n---\n**+ Create → New Flashcard**, or turn any note into one by adding `type: flashcard` to its frontmatter.",
      },
      {
        title: "When am I quizzed on these?",
        extraFrontmatter: { type: "flashcard" },
        body: "When does a card come up for review?\n---\nOpen **Flashcards** in the sidebar — it shows how many cards are due right now and starts the review queue.",
      },
    ],
    openView: "flashcards",
  },
  team: {
    notes: [
      {
        title: "Team Handbook",
        tags: ["team"],
        body: [
          "A place to keep whatever your team needs to find quickly — decisions, conventions, who owns what.",
          "",
          "## Decisions",
          "",
          "## Conventions",
          "",
          "---",
          "",
          "Real accounts and vault-wide membership (not just this one note) live under **Set up team access** at the bottom of the sidebar — an admin invites people with a link, the same way sharing one note already works, just scoped to the whole vault instead.",
        ].join("\n"),
      },
    ],
  },
  planner: {
    notes: [
      { title: "My First Project", templatePath: "templates/project.md" },
      {
        title: "First task",
        tags: [],
        extraFrontmatter: { project: "[[My First Project]]", status: "to-do", due: "" },
        body: "Switch to **Table view** and add a rollup column to see every task like this one, grouped and totaled automatically as you add more.",
      },
    ],
  },
  journaler: {
    // Handled specially in App.tsx's onPersonaChange — a daily note's
    // body is block-outliner JSON (see BlockOutline.tsx/blockTree.ts), not
    // plain markdown, so it can't go through createNoteFromTemplate the
    // way every other persona's seed notes do. This entry exists so
    // PERSONA_STARTER_CONTENT still names 1 note for the confirmation
    // dialog's count; the actual creation is bespoke.
    notes: [{ title: "Today" }],
  },
  developer: {
    notes: [
      {
        title: "Code blocks & diagrams",
        tags: ["dev"],
        body: [
          "```js",
          "function greet(name) {",
          "  return `Hello, ${name}!`;",
          "}",
          "```",
          "",
          "Hover a code block in Preview for a one-click **Copy** button — the editor itself syntax-highlights as you type, no separate preview step needed.",
          "",
          "```mermaid",
          "graph LR",
          "  A[Idea] --> B[Note]",
          "  B --> C[Linked notes]",
          "  C --> D[Graph view]",
          "```",
        ].join("\n"),
      },
    ],
  },
  consultant: {
    notes: [
      { title: "Client Project", templatePath: "templates/project.md" },
      {
        title: "Kickoff meeting notes",
        tags: ["meeting"],
        extraFrontmatter: { project: "[[Client Project]]" },
        body: "## Attendees\n\n## Notes\n\n## Action items\n\n- [ ] ",
      },
    ],
  },
  privacy: {
    notes: [
      {
        title: "How your data is protected here",
        tags: ["privacy"],
        body: [
          "**Local mode** (this device, or your LAN): notes are plain markdown files you control; the local server can read them in order to serve them to you, same as any editor would.",
          "",
          "**Cloud sync**, if you turn it on: everything is encrypted on your device before it ever leaves — XSalsa20-Poly1305 with an Argon2id-derived key from a passphrase you choose. The relay server that shuttles data between your devices only ever sees ciphertext; it has no way to decrypt it even if it wanted to.",
          "",
          "A passphrase grants edit access; a separate view-only key (derived from it, but not reversible back to it) can be shared instead for read-only access.",
          "",
          "See the README's \"Security & privacy model\" section, or read `server/relay.ts`/`src/crypto.ts` directly — the point of open source is not needing to take a vendor's word for it.",
        ].join("\n"),
      },
    ],
  },
  visual: {
    // Handled specially in App.tsx's onPersonaChange, same reason as
    // journaler above — a canvas note's body is an Excalidraw JSON scene
    // (see CanvasNote.tsx/App.tsx's own onNewCanvas), not markdown, so it
    // can't go through createNoteFromTemplate the way a plain note can.
    notes: [{ title: "My First Canvas" }],
    openView: "canvas",
  },
};

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
      if (isIdentity(parsed)) {
        // Repairs identities saved by a since-fixed version of
        // setIdentityFromEmail that only ever set id/email, never name —
        // anyone who "used email instead of anonymous" before that fix is
        // stuck with this exact shape (a real email, but name still the
        // untouched default) until it's read back through here once. Never
        // touches a name someone actually chose via setDisplayName.
        if (parsed.email && parsed.name === "Anonymous") {
          return save({ ...parsed, name: nameFromEmail(parsed.email) });
        }
        return parsed;
      }
    } catch {
      // fall through to (re)create below
    }
  }
  return save(createIdentity());
}

export function setDisplayName(name: string): Identity {
  return save({ ...getIdentity(), name });
}

// Pass undefined to clear back to "not set" — a real, distinct choice from
// any persona, not just the initial default.
export function setPersona(persona: string | undefined): Identity {
  return save({ ...getIdentity(), persona });
}

// Records that a persona's starter content has been created, so
// App.tsx's onPersonaChange knows not to offer to seed it again.
export function markPersonaSeeded(persona: string): Identity {
  const current = getIdentity();
  const seededPersonas = current.seededPersonas?.includes(persona)
    ? current.seededPersonas
    : [...(current.seededPersonas ?? []), persona];
  return save({ ...current, seededPersonas });
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

function nameFromEmail(email: string): string {
  return email.split("@")[0];
}

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
  const current = getIdentity();
  // IdentityPanel.tsx's header always shows "You: {name}" — without this, a
  // still-default "Anonymous" identity would take this "instead of
  // anonymous" action and keep showing "You: Anonymous" everywhere but the
  // expanded panel's own status line, directly contradicting what the user
  // just did. Only overrides the untouched default, never a name someone
  // deliberately chose via setDisplayName.
  const name = current.name === "Anonymous" ? nameFromEmail(trimmed) : current.name;
  return save({ ...current, id, name, email: trimmed.toLowerCase() });
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
