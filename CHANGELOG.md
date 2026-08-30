# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Section and block references: `[[Note#Heading]]` and `[[Note#^block-id]]` link or embed (`![[...]]`) just that section or single line, not the whole note — an Obsidian-style plain-text convention (not Roam/Logseq's outliner block model, which Satori's flat markdown editor doesn't have)
- Relational properties in Table view: a `[[wikilink]]`-valued property renders as a clickable link instead of plain text, and rollup columns show a count/list of notes that relate back to a given note via a chosen property
- Citations: `[@citekey]` inline references, `​```bibliography` blocks, and `.bib` file import (`type: reference` notes)
- Real inline comments — the "comment" share role now actually grants comment-posting rights, instead of doing nothing
- Interactive task/checkbox lists in preview
- A one-click copy button on rendered code blocks
- Local graph view — scope the graph to just the active note's direct connections instead of the whole vault
- Quick Capture: a global hotkey (⌘⇧N) opens a small always-on-top window for zero-friction note capture

### Changed

- Visual polish pass: sidebar/toolbar icons are now a consistent SVG set (lucide-react) instead of raw emoji; buttons have real primary/ghost/danger variants instead of one generic gray style everywhere (Delete finally looks different from Source/Preview); empty states (no note open, empty graph, empty table) got an icon, a heading, and — where relevant — a call-to-action button instead of a bare sentence; a spacing/type scale and consistent hover transitions are now design tokens (`--space-*`, `--text-*`, `--transition-*`) rather than ad hoc per-component values

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
