# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- A portable, exportable identity so edit history stays attributed to one person across devices and renames
- Per-note change history

**Native app**
- A Tauri (Rust) native desktop shell — small, fast, no Electron
- A native menu bar (File/Edit/View/Help) with real commands, not the bare OS default
- A first-run vault picker: choose or create your notes folder instead of a hidden app-data location, with the ability to switch vaults later
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
