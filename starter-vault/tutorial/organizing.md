---
title: "Tutorial: Organizing & finding your notes"
tags: [tutorial]
---

The other tutorial pages cover writing and collaborating. This one covers everything the app gives you for *finding your way back* to what you wrote — genuinely useful once a vault grows past a few dozen notes.

## Your identity

Click **▸ You: Anonymous** near the top of the sidebar. This is who collaborators see — your display name and cursor color when co-editing, and who a note's History panel attributes an edit to.

It's stored only in this browser, so a fresh browser or device starts as a new "Anonymous" identity by default — which fragments your own edit history across devices unless you carry it over. **Export identity** copies a small text blob; **Import identity** on another device restores the exact same identity there, so your history stays attributed to one person instead of splintering.

Your theme (Dark/Light/Solarized Dark/Solarized Light) lives in this same panel.

## The command palette

Press **⌘K** (or **Ctrl+K** on Windows/Linux) from anywhere in the app. It's a fuzzy search over two things at once: every note in your vault, and every action the app can do (New Note, Reindex, switch view modes, and — in the native app — Switch Vault). Arrow keys to move, Enter to run, Escape to close.

This is almost always the fastest way to get anywhere — faster than clicking through the sidebar once you know what you're looking for.

## Quick Capture (native app)

Press **⌘⇧N** from *anywhere* — even with Satori in the background, not focused — and a small always-on-top window opens for jotting something down without breaking whatever you were doing. It saves straight into your vault like any other note. Also reachable from the app's Help/File menu if you'd rather not use the hotkey.

## Favorites

Every note row in the sidebar has a ☆ star. Click it to favorite the note — this writes a real `favorite: true` property into that note's own frontmatter (open its **Properties** panel and you'll see it listed there), not a separate hidden list. That matters: favoriting a note is visible to anyone who opens the same vault, and stays consistent whether you're in the native app or a browser.

Favorited notes get their own **Favorites** section near the top of the sidebar for quick access.

## Recent

Just below Favorites, the sidebar tracks the last several notes you opened, most recent first — a quick way back to whatever you were just working on, without hunting through the full list. Each entry shows a small type icon so you can tell a canvas from a flashcard from a plain note at a glance.

## Organized navigation

The sidebar's **All Notes / Journal / Canvas / Graph / Table / Flashcards** row switches what you're browsing:
- **All Notes** — everything (the default)
- **Journal** — just your daily notes, with a one-click "Write today's entry" prompt when today's doesn't exist yet
- **Canvas** — just your Excalidraw canvas notes
- **Graph** — the visual link graph (see [[tutorial/linking|Linking & the graph]])
- **Table** — see below
- **Flashcards** — spaced-repetition review (see below)

If you've added a custom `type` to some notes (beyond `daily`/`canvas`), a **More types…** dropdown appears so you can filter to those too.

## Query blocks: live-filtered lists inside a note

A fenced ` ```query ` block renders as a live, auto-updating list of matching notes, right inside your markdown:

```query
tag: tutorial
```

Try switching this note to **Preview** (top-right) to see the block above render as an actual list of every tutorial page — including this one. The syntax is simple `key: value` lines:

```query
type: daily
```

would list every daily journal entry. Any frontmatter property works as a filter key, not just `type`/`tag` — a query block containing `status: done` would list exactly the notes with that property set. The list updates automatically as you create, favorite, or retag notes — nothing to refresh.

## Templates

Give a note `type: template` in its frontmatter, and it becomes available from **+ Create → New From Template**. Its body can use `{{title}}` and `{{date}}` placeholders, substituted when you create a note from it — handy for anything you write a lot of in the same shape (meeting notes, project briefs, weekly reviews).

The template's own `type: template` is deliberately *not* copied onto the note you create from it — otherwise every note made from a template would itself show up as a template next time.

## Table view

Switch to **Table** in the sidebar nav to see your current set of notes (whatever All Notes/Journal/Canvas/a query already narrowed you to) as rows in a table instead of a list. Columns are automatically drawn from whatever properties your notes actually have — add a `priority` or `status` property to a few notes via their Properties panel, and those columns appear here automatically.

Click a column header to sort by it. Click any cell (except Title/Tags) to edit that property inline — it writes straight back to the note's frontmatter, same as editing it in the Properties panel would. Click a title to open that note in the editor.

A [[tutorial/properties|relation property]] (a `[[wikilink]]`-valued field) renders as a clickable chip instead of plain text. And you can add a **rollup** column — "+ Add rollup" above the table — that shows a count or list of *other* notes that relate back to this one via a chosen property, without that relation ever having to be declared on this note itself. Point several Task notes' `project` field at the same Project note, add a rollup on `project`, and the Project's row shows how many tasks point at it — for free.

This is genuinely useful once you're tracking anything with structure — a reading list with a `status` property, a project's tasks with `priority`, a set of contacts with a `company` field — without needing a separate tool.

## Flashcards

A note with `type: flashcard` becomes a spaced-repetition card. Its body is the front, then a line containing exactly `---`, then the back:

```
What does SM-2 stand for?
---
The SuperMemo 2 spaced-repetition algorithm.
```

Click **Flashcards** in the sidebar to review whatever's due — rate each card Again/Hard/Good/Easy and the next-due date adjusts automatically. Create one from **+ Create → New Flashcard**.

---

Next: [[tutorial/diagrams|Diagrams →]]
