# Satori

**A privacy-first, local-first notes app with real end-to-end encrypted collaboration — your notes stay on your disk as plain markdown, and no server ever sees them unencrypted.**

[![Release](https://github.com/mystic-monk/satori/actions/workflows/release.yml/badge.svg)](https://github.com/mystic-monk/satori/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why Satori

Most notes apps make you choose: keep your notes local and private (Obsidian, Logseq), or get real-time collaboration and sync (Notion). Satori doesn't ask you to choose.

- **Your notes are yours.** Every note is a plain `.md` file with YAML frontmatter, sitting in a folder you control. No proprietary format, no lock-in — open any note in a plain text editor, put the folder in git, back it up however you like.
- **Real-time collaboration, genuinely private.** When you share a note, edits sync live between everyone editing it — but if you use cloud sync, your device encrypts everything *before* it leaves, and the relay server that shuttles it between devices only ever sees ciphertext. Not "we promise not to look" — architecturally can't.
- **Fine-grained sharing.** Give someone view, comment, or edit access to a single note — enforced on the server, not just hidden in the UI. They see exactly that note, nothing else in your vault.
- **A real native app**, not a web page in a wrapper — built on Tauri (Rust), so it's small and fast, with a full native menu bar and its own file-picker-driven vault setup.

## Features

**Writing & organizing**
- Markdown editing with live preview (CodeMirror 6), formatting shortcuts, Mermaid diagrams, KaTeX math, callouts, highlights
- Syntax-highlighted code blocks with a one-click copy button; the editor itself syntax-highlights ~180 languages as you type
- Interactive task/checkbox lists (`- [ ]`) — click to toggle, right in preview
- Excalidraw canvas notes, embedded natively
- Wikilinks (`[[note]]`), transclusion (`![[note]]`), backlinks, and a visual link graph — full-vault or scoped to just one note's connections
- Section and block references: `[[Note#Heading]]` links/embeds just that section, `[[Note#^block-id]]` links/embeds one specific line — not just whole-note transclusion
- Citations: `[@citekey]` links to a `type: reference` note and renders as "(Author, Year)"; a `​```bibliography` block lists everything cited in that note; import an existing `.bib` file to bulk-create reference notes
- Full-text search (SQLite FTS5)
- **Related Notes**: a fully local semantic-similarity panel (small on-device embedding model, no network calls, on by default) surfaces notes that are conceptually close even without an explicit `[[link]]` between them — Node/browser deployment only for now, see Roadmap
- Favorites, Recent notes (with a type indicator), and organized sidebar navigation (All Notes / Journal / Canvas / Table)
- A command palette (⌘K) for jumping to any note or action instantly
- Quick Capture: a global hotkey (⌘⇧N) opens a small always-on-top window for jotting a thought with zero friction, even when Satori isn't focused
- `​```query` blocks — live, filterable lists of notes embedded directly in your markdown
- Templates with `{{date}}`/`{{title}}` placeholder substitution
- Table/database views over your notes' properties, with inline editing — including relation properties (`[[wikilink]]`-valued fields render as clickable links) and rollup columns (count/list of notes that relate back to this one via a chosen property)
- Spaced-repetition flashcards (SM-2 scheduling)
- Daily journal notes, one keystroke away, with a "write today's entry" prompt when it's missing

**Collaboration & sharing**
- Real-time multi-cursor editing (CRDT-based, via Yjs) on your local network
- Optional end-to-end encrypted cloud sync for collaborating over the internet
- Per-note share links with view / comment / edit roles, enforced server-side — a "comment" link lets someone leave feedback on a note without being able to edit it
- A persistent (portable, exportable) identity so your edit history stays attributed to you across devices — not just a random per-browser label
- Per-note change history
- **Team/Workspace** (self-hosted server deployment): real accounts and standing, vault-wide membership on top of the per-note sharing above — opt-in and purely additive, a solo self-hosted vault behaves exactly as it always has until someone deliberately sets this up from the sidebar's "Set up team access" entry. An admin invites people with a link (same UX as note sharing); once anyone signs up, that server requires signing in from then on. See Roadmap for what this deliberately doesn't cover yet

**The app itself**
- Native desktop app (macOS, with Windows/Linux via the same Tauri build) — small, fast, no Electron
- Auto-updates: checks for new releases and installs them in place
- A real native menu bar and a proper vault picker (choose or create your notes folder on first launch)
- A new, empty vault is seeded with a real built-in tutorial — written and kept up to date using the app's own features (wikilinks, embeds, callouts, citations, task lists), not a static walkthrough
- Four built-in themes (Dark, Light, Solarized Dark, Solarized Light)
- Also runs as a browser-based web app if you'd rather self-host it that way

## Installation

**Download a build** from the [Releases page](https://github.com/mystic-monk/satori/releases) — pick the installer for your platform.

**Or build from source:**

```bash
git clone https://github.com/mystic-monk/satori.git
cd satori
npm install
npm run tauri build   # produces a native .app/.dmg (or .exe/.msi, .AppImage/.deb) in src-tauri/target/release/bundle/
```

The first time you launch the app, it'll ask you to choose (or create) a folder for your vault — your notes live there as plain markdown files, not hidden in some app-support directory you can't find.

## Development

```bash
npm install
npm run dev            # runs the web dev server (Vite) + local API server together
npm run tauri build    # full native app build
npm test                # frontend/shared unit tests (Vitest)
npm run typecheck       # TypeScript
cargo check --manifest-path src-tauri/Cargo.toml   # Rust
```

Satori runs in two deployment modes from the same codebase:
- **Native app** (Tauri/Rust) — the primary target. `src-tauri/` is the Rust backend; the frontend talks to it over Tauri's IPC.
- **Browser/self-hosted** — `server/` is a small Node/Express server (SQLite for the search index, a WebSocket relay for real-time sync) that the same React frontend can talk to over HTTP/WebSocket instead. Useful if you'd rather run Satori on your own server and access it from a browser.

### Deploying the server (for cloud sync or Team/Workspace)

The native app's local collaboration only reaches other devices on the same network. To collaborate with someone over the internet — either via cloud sync's passphrase-based relay, or via a self-hosted Team/Workspace — `server/` needs to run somewhere reachable, not just on your own machine.

**Render** (or any Node host) works well for this — a [`render.yaml`](render.yaml) blueprint is included:
```bash
npm start   # tsx server/index.ts — binds to $PORT if set, else 3001
```
Push the repo to Render as a Blueprint and it builds/runs this automatically. The relay itself is stateless (no database, nothing to persist) — the free plan is enough if you only want cloud sync. If you also want Team/Workspace accounts to survive a redeploy, you'll need a persistent disk for `.pkm-state/` (see the commented-out `disk:` block in `render.yaml`) — a paid plan.

Once deployed, point the app's "Connect cloud sync" field (same UI in Tauri or browser) at `wss://<your-service>.onrender.com`, agree on a room name and passphrase with whoever you're collaborating with, and you're connected — no accounts needed. This deployment path serves the API/WebSocket backend only, not the built frontend (there's no static-file serving wired in yet) — for browser/Team-Workspace access, run `npm run dev` yourself, or host the built frontend separately and point it at this server.

Both modes share the same markdown/frontmatter parsing (`shared/`) and the same React UI (`src/`) — only the storage/IPC layer underneath differs.

## Security & privacy model

- **Local mode** (same machine or LAN): the local server can read your notes' plaintext — it has to, to serve them to your own browser — and enforces view/comment/edit roles on real-time editing sessions. It's meant for your own machine or a trusted home/office network, not the open internet.
- **Cloud mode**: everything is encrypted client-side (XSalsa20-Poly1305 via libsodium, with an Argon2id-derived key from a passphrase you choose) before it ever reaches the relay server. The relay only forwards opaque ciphertext between peers — it has no way to decrypt your notes even if it wanted to. The tradeoff: cloud mode doesn't yet have per-role permissions the way local sharing does — anyone with the passphrase can read *and* write.
- Share links are scoped per-note and fail closed: an invalid, expired, or mismatched token is rejected outright, never silently treated as full access.

Read `server/relay.ts` and `src/crypto.ts` if you want to verify these claims yourself — that's the point of not trusting a vendor's word for it.

## Roadmap / known limitations

Satori is early and honest about what it isn't yet:
- No plugin ecosystem (Obsidian/Logseq have large ones)
- No native mobile apps yet (responsive web layout only)
- Not a Logseq/Roam-style outliner — no drag-to-reorder or collapsible nested blocks, and a "block" is a single line (a multi-line paragraph isn't merged into one addressable block yet)
- Navigating to a `[[Note#Heading]]` or `[[Note#^block-id]]` *link* opens the note but doesn't yet scroll to or highlight that specific spot — embeds (`![[...]]`) already inline just that section/block correctly
- Cloud-mode sharing has no role separation yet (see above)
- Table views are a single layout — no kanban/calendar/gallery views yet; rollup columns are count/list only (no sum/average over numeric fields) and don't persist across reopening Table view yet
- Comments are a flat per-note thread, not anchored to a specific line or text range
- Citations support a single `[@citekey]` per reference — no locators (`p. 12`) or multi-citation grouping yet
- The `.bib` importer is a pragmatic parser (handles what a real Zotero/BibTeX export looks like), not a full BibTeX-spec implementation
- Related Notes (local semantic embeddings) only runs in the Node/browser deployment — the Tauri native app needs its own Rust-side ML inference path (candle), not yet built, so the panel doesn't appear there yet. Works best on notes with real paragraph content; very short one-liners give the embedding model less to work with
- Team/Workspace v1 is server/browser-only, same as Related Notes above — Tauri's local vault stays single-owner
- Workspace roles are coarse (admin / member, both full vault read-write) — no per-note permission tiers for members the way per-note share links have; a member gets the same access an owner always had
- Workspace accounts don't extend to cloud-mode sync — that still uses one shared passphrase for everyone, unchanged. Real per-role access there needs a genuinely different cryptographic scheme (per-user keypairs + a wrapped content key + signature-based write authorization instead of one symmetric secret everyone shares), not something layered on top of the current one
- No SSO, no email verification, no self-serve password reset for workspace accounts (a self-hosted admin can intervene directly in `.pkm-state/state.sqlite` if truly needed)

See [CHANGELOG.md](CHANGELOG.md) for what's shipped so far.

## Contributing

Issues and pull requests are welcome. This is a young project — if you're planning something larger than a small fix, opening an issue first to discuss the approach will save everyone time.

## License

MIT — see [LICENSE](LICENSE).
