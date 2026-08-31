---
title: "Tutorial: Who's this for?"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

Everything in this tutorial is one small set of general-purpose features — wikilinks, properties, `​```query` blocks, templates, sharing — that combine differently depending on what you're actually doing. This page is a shortcut: find yourself below, see which combination applies to you, and skip straight to the relevant pages instead of reading the whole tutorial in order.

## Script & screenwriters, novelists

Book/Chapter/Character/Scene templates (**+ Create → New From Template**) give you a chapter list that updates itself, a beat sheet in Table view, and character relationships that build a graph automatically just from writing "raised by [[Marta]]" in prose. Word count and a "compile all chapters into one document" export cover the rest.

> [!tip] Don't fight the graph
> Resist the urge to build a separate relationship-tracking note for your characters — link to each other in the prose itself. The Graph view becomes your relationship map for free, and it's always current.

→ [[tutorial/writing-books-and-scripts|Writing books & scripts]]

## Researchers & academics

`[@citekey]` citations resolve against `type: reference` notes, a `​```bibliography` block lists everything actually cited, and importing a `.bib` file bulk-creates reference notes from an existing Zotero/EndNote library in one pass. Related Notes (local semantic search) surfaces papers conceptually close to whatever you're reading, even before you've explicitly linked them.

→ [[tutorial/citations|Citations & references]], [[tutorial/ai-related-notes|Related Notes & local AI]]

## Students

Flashcards (SM-2 spaced repetition) turn any note into a review deck. A daily journal note is one keystroke away for lecture notes or a reading log. A `​```timetable` block is a class schedule you can glance at full-screen or export to your phone's calendar so you actually get notified before class — see below.

→ [[tutorial/organizing|Organizing & finding your notes]] (flashcards, daily notes)

## Teams & small orgs

Team/Workspace turns a self-hosted server into a real shared vault — standing accounts, not just one-off share links, with an admin who invites people. Per-note sharing still exists underneath for scoping a guest (client, contractor) to exactly one note. Comments anchor to a specific sentence, not just a flat per-note thread, so feedback is unambiguous. Real-time multi-cursor editing means two people in the same note see each other type.

> [!tip] Two systems, two jobs
> Workspace membership is "you're on the team, full access." A per-note share link is "this one person gets exactly this one note." Use both — they don't conflict.

→ [[tutorial/team-workspace|Team, Workspace & self-hosting]], [[tutorial/collaboration|Collaboration & sharing]]

## Project managers & planners

Table view turns any set of notes into a sortable, inline-editable tracker — status, owner, due date, whatever properties you give them — with rollup columns for "which tasks point back at this project." Calendar view aggregates anything with a `date` property into a month grid. Reminders plus the calendar-feed export (Settings → Calendar feed, or a one-off `.ics`) put deadlines on the same calendar app everyone already checks.

→ [[tutorial/organizing|Organizing & finding your notes]] (tables, query blocks)

## Journalers & personal note-takers

A daily note is one click away, with a prompt when today's is missing. Favorites and Recent keep the notes you actually touch within reach without hunting through folders. Months or years later, the Graph view shows patterns — recurring people, places, themes — that were invisible day to day.

→ [[tutorial/organizing|Organizing & finding your notes]]

## Developers & technical writers

Syntax highlighting across ~180 languages, a one-click copy button on every code block, Mermaid diagrams for architecture/flow, KaTeX for math. Everything's plain markdown in a folder you control — put it in the same git repo as the code it documents if that's useful.

→ [[tutorial/formatting|Formatting]], [[tutorial/diagrams|Diagrams]]

## Consultants & freelancers

A per-note share link scopes one client to exactly one note (view, comment, or edit) — they never see the rest of your vault, including your other clients. Nothing to provision per client, no separate tool per engagement.

→ [[tutorial/collaboration|Collaboration & sharing]]

## Privacy-conscious professionals

Lawyers, therapists, journalists, anyone whose notes are actually sensitive: cloud sync is end-to-end encrypted before it ever leaves your device — the relay server that shuttles it between your devices only ever sees ciphertext, architecturally, not by policy. Self-host the whole thing and nothing touches a third party at all.

→ [[tutorial/collaboration|Collaboration & sharing]]

## Visual thinkers

Canvas notes (Excalidraw, embedded natively) for moodboards, sketches, or a diagram that doesn't fit Mermaid's flowchart syntax — linked to and from regular notes with an ordinary `[[wikilink]]`, so a visual note is a first-class part of the same graph as everything else.

→ [[tutorial/diagrams|Diagrams]]

## Who else?

If you don't see yourself above, the underlying pattern is usually: pick a `type:` for your notes, give them properties worth filtering by, and let Table/Calendar/query blocks do the organizing. A few more that fit this shape without a dedicated section: recruiters (candidate notes with `stage`/`role` properties in a Table pipeline), event planners (a `​```timetable` per day of a multi-day event), genealogists (`[[wikilink]]`s between family members feeding the Graph view), and anyone maintaining a personal wiki of *anything* — recipes, home maintenance, gear reviews — where a handful of typed, linked notes beats a pile of disconnected documents.

---

You've reached the end of the tutorial. From here, the fastest way to keep learning is just to use the app — favorite a note, try the graph, invite someone if you're running a server. Back to [[tutorial|Tutorial]].
