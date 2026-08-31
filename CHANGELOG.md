# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `​```timetable` blocks — a weekly grid (one entry per line: `Day HH:MM-HH:MM Title`), rendered as a CSS Grid week view with entry height proportional to duration. A "Full screen" button opens it sized to the viewport, requests the Fullscreen API, and best-effort holds a screen wake lock (`src/timetable.ts`). Matching styles were added to `export.ts`'s `EXPORT_CSS` so MD/HTML/PDF export renders the grid too
- Reminders: a 🔔 toolbar button sets a `remind_at` date/time on the open note; a native notification (Tauri, via `tauri-plugin-notification`) or browser notification fires when it's due, checked every 20s against the notes list (`src/reminders.ts`, `src/reminderSchedule.ts`). Only fires while Satori is open — not a background/push notification, see README's Roadmap
- Sidebar: Recent/Favorites now only show in the default "All Notes" view — switching to Tutorials/Journal/Canvas/a type filter previously left them sitting above the filtered list, taking up space and making the filter look like it hadn't done anything
- Calendar sync (`.ics`, universal — no OAuth or API keys with any vendor): a `.ics` button on the reminder popup and on every `​```timetable` block downloads a standard iCalendar file Apple/Google/Outlook Calendar all import (`shared/ics.ts`). If you're running the optional server, Settings → Calendar feed also exposes a live, token-gated `GET /api/calendar.ics` URL — subscribe once in any calendar app and it re-fetches on its own schedule, picking up new/changed reminders and timetable entries automatically
- Graph view is interactive now: drag a node to nudge the force layout (neighbors react rather than the one node just relocating), double-click to pin a node in place, scroll to zoom toward the cursor, drag the background to pan, and a "Reset view" button clears pins and returns to the auto-fit framing
- Left sidebar navigation moved into an always-visible rail (icon + label) — Settings and Workspace moved off the note list into the rail's bottom, and Recent moved into its own History view (rail icon) instead of always sitting above the note list
- Project-level sharing: a note made from the new **Project** template (`type: project`, a live `​```query` block listing every note tagged `project: [[Project Title]]`) shares its whole membership under one link instead of one note at a time. New `scope` column on `shares` (`'note'`, the only kind before this, or `'project'`) in both server/db.ts and src-tauri/src/db.rs, kept in lockstep. Fixed a real gap this surfaced: `openNote` used to unconditionally clear the share token on any in-app navigation, on the assumption it always meant the owner — a guest clicking a wikilink inside their one shared note hit this same path and silently lost their session; navigation now only re-resolves role for the new path under the same token instead of discarding it

### Changed

- The rail's icon-only first pass (still icon + no label) was hard to read without hovering and read as too close a copy of VSCode's activity bar — icon + text label now, and switching to a full-panel view (Graph/Table/Calendar/Flashcards/History) auto-collapses the note-list panel instead of leaving two unrelated lists on screen at once
- Vault name/switcher and identity ("You: name") moved out of two full rows at the top of the note-list panel and into the rail's bottom, next to Settings/Workspace — the same kind of occasional, not-per-note action already living there, freeing the space above the search box for the note list itself. Identity is a modal now (SettingsPanel's pattern) instead of an inline accordion
- Reminder popup: `type="datetime-local"` replaced with separate `type="date"`/`type="time"` inputs (the combined widget rendered as a cramped, fiddly segmented editor with no visible calendar) plus quick-pick buttons ("In 1 hour", "Tomorrow, 9am", "Next Monday, 9am"). The 🔔 toolbar button is a real icon (lucide's Bell) now, not an emoji glyph sitting out of step with the rest of the toolbar's icon set

- The rail is drag-to-resize now (140–320px), same handle-and-persistence pattern the note-list and right panels already had (`useResizableWidth`'s `offset` parameter)

### Fixed

- CI's `npm audit --omit=dev` was failing on `fastembed`'s own direct `tar@^6.2.0` pin (several majors behind the `tar@7.5.22` already resolved elsewhere in the tree via `onnxruntime-node`) — overridden past it rather than downgrading fastembed
- The note-list panel's own resize handle computed its width from the mouse's raw screen position, which was only correct back when it sat flush against the window's left edge — once the rail became a permanent fixture to its left, every drag was off by however wide the rail happened to be. `useResizableWidth` now accepts an `offset` for exactly this ("how much space something before me already occupies")
- The rail's new resize handle was invisible to clicks in its outer half — deliberately straddles the rail's edge (`right: -3px`) the same way the note-list panel's own handle does, but the rail also had `overflow-y: auto` for its nav list, which clips a positioned descendant's hit-testable area to the padding box. Moved scrolling to an inner wrapper so the outer element (holding the handle) stays overflow: visible

## [0.1.4] — 2026-08-31

### Added

- Cloud sync now has real, cryptographically enforced view/edit role separation — a passphrase still grants edit access, but a separate view-only content key (derived from the passphrase, not reversible back to it) can be shared instead, and the relay verifies a signature on every write against that room's registered editors before forwarding it, without ever decrypting content to do so. Settings' Cloud sync section gained an Edit/View-only toggle and a "Get a view-only key to share" action; the editor also goes read-only for a view-only session as a UI-level backstop on top of the relay's actual enforcement
- Extensive new tutorial coverage (Team/Workspace, Related Notes/local AI, Settings & export) plus a dedicated **Tutorials** sidebar entry that lists every tutorial page in one place, filtered by tag rather than type
- `server/` can now be deployed to Render (or similar) with one push — a `render.yaml` blueprint, a real `PORT`-aware production start script, and a README section on pointing cloud sync at a deployed relay
- Comments can now be anchored to a specific text range instead of only being a flat per-note thread — select text, click the "💬 Comment" button that appears, and the comment ties to that exact span (a live-highlighted excerpt, clickable to jump back to it). Anchored via a Yjs relative position (`src/yjsAnchor.ts`), not a raw character offset, so it correctly tracks the same text through edits made anywhere else in the document instead of silently drifting onto the wrong words
- `[[Note#Heading]]`/`[[Note#^block-id]]` *links* now scroll to that spot once the note opens, matching what embeds (`![[...]]`) already did — previously the link resolved and navigated correctly but landed at the top of the note
- A new **Calendar** view — a month grid of every note with a date, sourced from the same properties bag Table view reads (daily/journal notes automatically via their ISO-date title, any other note via a `date` property)
- Book/Chapter/Character/Scene templates for long-form fiction and screenwriting (**+ Create → New From Template**) — no new engine, just existing features arranged for the job: a live `​```query` block lists each book's chapters, Table view sorts/filters chapters and scenes, and character relationships are just wikilinks in prose that show up on the Graph automatically. A new tutorial page (`tutorial/writing-books-and-scripts`) walks through it
- A live word count in the editor toolbar for the open note (`src/wordCount.ts`), and a **Compile chapters** action in Settings for any `type: book` note — gathers every chapter that relates back to it, in `order`, into one document and exports it as Markdown/HTML/PDF, reporting the compiled chapter and word count (`src/compileBook.ts`)
- Spell check (`src/spellcheck.ts`, an en_US Hunspell dictionary loaded lazily and entirely client-side via `nspell` — no text is ever sent anywhere) — a Settings toggle for automatic as-you-type checking, plus "Check Spelling: Whole Note"/"…: Selection" command-palette actions that work regardless of the toggle. Misspelled words get a wavy underline; clicking one shows suggestions or lets you add it to the dictionary for the rest of the session

### Fixed

- MD/HTML/PDF export never rendered mermaid diagrams, KaTeX math, `​```query` blocks, or `​```bibliography` blocks — it embedded the raw, unfilled placeholder/fallback markup Preview.tsx's live async passes normally fill in, which export has no equivalent of until now (`renderForExport.ts`, `deferredBlocks.ts`)
- `[@citekey]` citations always rendered as unresolved in every export, even when correct in the live Preview, because `exportEnv()` never built the citations map `Preview.tsx` computes for itself
- PDF export in the native app leaked its own styles onto the entire running UI — a `<style>` tag's rules apply document-wide regardless of its container's visibility, and the export container is left in the DOM permanently. Every export-specific CSS rule is now scoped under `.export-doc`
- A note deleted in the native app while a debounced autosave was still pending could get silently resurrected moments later, since teardown's flush-on-close would write it straight back to disk after deletion — `confirmDelete()` now tears the collab session down deterministically, without flushing, before issuing the delete
- The identity header could get permanently stuck showing "Anonymous" after using email to identify, because the fix only covered new email submissions, not identities already saved in that shape — `getIdentity()` now repairs this on read
- Cloud sync getting stuck on "error" after one failed connection attempt (e.g. a free-tier relay host waking from an idle spin-down) with no way to recover except manually reconnecting — it now retries with capped exponential backoff

### Changed

- KaTeX (261KB) is now lazily loaded the same way Mermaid already was, instead of a static top-level import — a note with no math no longer pays for the library at all (`math-render.ts`)
- `server/embeddings.ts` no longer eagerly imports `fastembed` (which pulls in `onnxruntime-node`'s native bindings, ~160ms) at module load — deferred to first actual embedding use, same lazy-singleton pattern the model init itself already used
- Sidebar note-list derivations (`favoriteNotes`, `displayedNotes`, `templateNotes` in App.tsx) are now memoized instead of recomputed on every render, including every editor keystroke
- The left sidebar is now collapsible on desktop, remembered across sessions — previously the only way to hide it was the mobile off-canvas drawer
- Theme, cloud sync connection, and export are now consolidated into a single Settings panel, reachable from the sidebar, instead of being scattered (theme in the identity panel, cloud sync inline above the editor, export as toolbar-only buttons)

## [0.1.3] — 2026-08-30

### Added

- Section and block references: `[[Note#Heading]]` and `[[Note#^block-id]]` link or embed (`![[...]]`) just that section or single line, not the whole note — an Obsidian-style plain-text convention (not Roam/Logseq's outliner block model, which Satori's flat markdown editor doesn't have)
- Relational properties in Table view: a `[[wikilink]]`-valued property renders as a clickable link instead of plain text, and rollup columns show a count/list of notes that relate back to a given note via a chosen property
- Citations: `[@citekey]` inline references, `​```bibliography` blocks, and `.bib` file import (`type: reference` notes)
- Real inline comments — the "comment" share role now actually grants comment-posting rights, instead of doing nothing
- Interactive task/checkbox lists in preview
- A one-click copy button on rendered code blocks
- Local graph view — scope the graph to just the active note's direct connections instead of the whole vault
- Quick Capture: a global hotkey (⌘⇧N) opens a small always-on-top window for zero-friction note capture
- A genuinely new (empty) vault is now seeded with a built-in tutorial covering the whole feature set, instead of opening completely blank — found while scoping "onboarding polish" that this had never actually been wired up: the well-written tutorial content from earlier development only ever lived in a personal, gitignored vault, never shipped with the app. `starter-vault/` (new, tracked in git) is copied in exactly once, only when the vault has zero real note files, in both the Tauri app (bundled via `tauri.conf.json`'s `bundle.resources`) and the Node/browser deployment
- Related Notes: a fully local semantic-similarity panel below Backlinks, using a small on-device sentence-embedding model (`fastembed`, ~25MB quantized weights, downloaded once on first use) — no network calls, no configuration, on by default. Node/browser deployment only for now; the Tauri native app needs its own Rust-side inference path, not yet built (flagged in the Roadmap)
- Team/Workspace v1: real accounts and standing, vault-wide membership for the self-hosted server/browser deployment (Tauri's local vault is unaffected — single-owner, no accounts, as always). Opt-in and purely additive: a solo vault behaves identically until someone deliberately clicks "Set up team access" in the sidebar. Coarse admin/member roles layered on top of — not replacing — the existing per-note share-link system; admins invite people with a link, same UX pattern as note sharing, and removing a member immediately revokes all their sessions rather than leaving standing access to hunt down. The one real security-relevant change: once a server has ≥1 account, a request with no share token no longer gets treated as "the owner" by default the way it always has for a purely local/personal server — it now needs a valid session too. A server that never gets an account configured keeps behaving exactly as before. Argon2id password hashing reuses the same libsodium primitive `src/crypto.ts` already used for cloud-sync passphrases, no new crypto dependency

### Changed

- Visual polish pass (Tier 1): sidebar/toolbar icons are now a consistent SVG set (lucide-react) instead of raw emoji; buttons have real primary/ghost/danger variants instead of one generic gray style everywhere (Delete finally looks different from Source/Preview); empty states (no note open, empty graph, empty table) got an icon, a heading, and — where relevant — a call-to-action button instead of a bare sentence; a spacing/type scale and consistent hover transitions are now design tokens (`--space-*`, `--text-*`, `--transition-*`) rather than ad hoc per-component values
- Visual polish pass (Tier 2/3): graph nodes are colored by note type (matching the sidebar's per-type icon colors) instead of one blue for everything; the graph view now auto-fits its viewBox to wherever nodes actually settle instead of a fixed-size canvas that left sparse/isolated notes sitting off-center or clipped outside it; node labels get a background halo so they stay legible where they cross link lines or overlap a neighbor; the command palette shows a keyboard-shortcut badge for commands that have a real one (New Note's ⌘N, Tauri only); table rows and command palette items now have a hover state with a transition instead of no feedback or an instant snap

### Fixed

- A real content-loss bug: a stale `.ybin` CRDT snapshot could silently overwrite a `.md` file that had been edited outside the collab system (a direct edit, a git checkout, a sync from another device) the next time that note was opened
- Switching the sidebar to Journal/Canvas/a custom type filter silently broke wikilinks, citations, and relation properties pointing at notes of a different type in the currently open note (they'd render as "broken" purely because of the sidebar filter) — favorited notes of other types also vanished from Favorites, and "New From Template" could disappear from the create menu, for the same underlying reason

## [0.1.2] — 2026-08-30

### Fixed

- Release builds are now actually signed for the auto-updater — 0.1.1 had the signing key wired into CI but was still missing `createUpdaterArtifacts` in the bundle config, so the build silently skipped producing a signature and `latest.json`

## [0.1.1] — 2026-08-30

### Fixed

- Wired the updater signing key into CI (turned out incomplete — see 0.1.2)

## [0.1.0] — 2026-08-29

Initial release.

### Added

**Editing & organization**
- Markdown editing (CodeMirror 6) with live preview, formatting shortcuts, Mermaid diagrams, KaTeX math, callouts, and inline highlights
- Excalidraw canvas notes, embedded natively, with persistent image storage
- Wikilinks (`[[note]]`), transclusion (`![[note]]`), backlinks, and a visual link graph
- Full-text search over notes (SQLite FTS5)
- YAML frontmatter properties, editable from a dedicated panel
- Daily journal notes
- Four built-in themes (Dark, Light, Solarized Dark, Solarized Light)
- Favorites (a real frontmatter property, not a local-only list) and a Recent-notes sidebar section
- A reorganized sidebar: a vault header, All Notes / Journal / Canvas / Graph / Table navigation, replacing a flat note list
- A command palette (⌘/Ctrl+K) for jumping to any note or action
- `​```query` blocks — live, filterable note lists embedded directly in markdown
- Templates, with `{{date}}`/`{{title}}` placeholder substitution
- Table/database views over notes' properties, with inline cell editing and column sorting

**Collaboration & sharing**
- Real-time multi-cursor collaborative editing (Yjs CRDT) over the local network
- End-to-end encrypted cloud sync (XSalsa20-Poly1305, Argon2id key derivation) through a relay server that only ever handles ciphertext
- Per-note sharing with view / comment / edit roles, enforced server-side on both the REST API and the real-time sync protocol
- A portable, exportable identity so edit history stays attributed to one person across devices and renames — optionally backed by an email address (hashed, never sent anywhere) instead of an export/import file, with anonymous still the default
- Per-note change history

**Native app**
- A Tauri (Rust) native desktop shell — small, fast, no Electron
- A native menu bar (File/Edit/View/Help) with real commands, not the bare OS default
- A first-run vault picker: choose or create your notes folder instead of a hidden app-data location, with the ability to switch vaults later
- Folder import: bring in `.md`/`.txt`/`.json` (Excalidraw scenes) files from anywhere on disk, copied into the vault without touching the originals
- Native crash/setup-error dialogs instead of silent failures

**Deployment**
- Runs as either the native app or a self-hostable browser/Node web app from the same codebase
- A GitHub Actions release workflow building installers for macOS, Windows, and Linux from a version tag

### Security

- Share tokens fail closed: an unresolvable, mismatched, or revoked token is rejected outright rather than silently falling back to full owner access
- Per-note write access (REST and real-time) is checked against the resolving role for that specific note, not just whichever note is currently open
- A native-app content security policy restricting script/style/connection sources to what the app actually needs

### Fixed

- A CRDT state/cache separation bug that could duplicate a note's content if the search-index cache was deleted while a stale client session reconnected
- `window.prompt()`/`window.confirm()` don't work at all in the native app's WebKit runtime — every use was replaced with real in-app dialogs
- A responsive breakpoint meant for narrow/mobile browsers was incorrectly active in the native app's default window size, breaking the sidebar layout
