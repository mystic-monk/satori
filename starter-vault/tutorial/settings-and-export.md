---
title: "Tutorial: Settings & export"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

**Settings**, right below your identity in the sidebar, is one place for the things that used to be scattered around the app: appearance, cloud sync connection, and exporting the note you have open.

## Appearance

One dropdown: **Dark**, **Light**, **Solarized Dark**, **Solarized Light**. Takes effect immediately, remembered next time you open the app.

## Cloud sync

Covered in full on [[tutorial/collaboration|Collaboration & sharing]] — this is just where the controls actually live: relay address, room, passphrase, connect/disconnect, all in Settings rather than hunting for them on the note toolbar.

## Exporting a note

Two ways to get the same result:

1. **From the note itself** — MD / HTML / PDF buttons in the top-right corner of any open note.
2. **From Settings** — same three formats, under "Export current note," if you'd rather reach it from one consistent place instead of hunting across different notes' toolbars.

A few things worth knowing about what actually gets exported:

- **HTML and PDF are fully rendered** — Mermaid diagrams become real images, math renders through KaTeX, `​```query` blocks export their *current* live results (not the raw block syntax), and a `​```bibliography` block lists everything actually cited. What you see in Preview is what you get in the export.
- **Markdown export is the raw source** — your actual `.md` file content, frontmatter included, exactly as it's stored on disk. No rendering happens; it's meant for taking the file elsewhere, not for reading.
- Canvas notes can't export to any of the three — there's no "flatten a whiteboard to markdown" story yet, so the export buttons don't appear on a canvas note at all.

---

Next: [[tutorial/writing-books-and-scripts|Writing books & scripts →]]
