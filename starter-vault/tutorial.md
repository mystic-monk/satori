---
title: Tutorial
tags: [tutorial]
---

Welcome! This is a living tutorial written *in* the app, using the app's own features — every link, callout, and diagram below is real, not a screenshot.

Every page here carries `tags: [tutorial]`, which is what powers the sidebar's **Tutorials** nav entry — click it any time to see this whole list in one place without needing to find your way back to this page first.

## Where to start

- [[tutorial/formatting|Formatting]] — bold, italic, highlights, callouts, math, code, task lists
- [[tutorial/linking|Linking & the graph]] — wikilinks, section/block references, transclusion, backlinks
- [[tutorial/properties|Properties & types]] — structured frontmatter you can query, filter, and relate notes by
- [[tutorial/organizing|Organizing & finding your notes]] — favorites, recent, the command palette, query blocks, templates, table views, quick capture, collapsing the sidebar
- [[tutorial/diagrams|Diagrams]] — Mermaid flowcharts and the Excalidraw canvas
- [[tutorial/citations|Citations & references]] — cite sources with `[@key]`, import a `.bib` file
- [[tutorial/collaboration|Collaboration & sharing]] — local sync, encrypted cloud sync, comments, and access control
- [[tutorial/team-workspace|Team, Workspace & self-hosting]] — standing accounts for a shared server, and reaching one from outside your network
- [[tutorial/ai-related-notes|Related Notes & local AI]] — fully local semantic search, no account or API key
- [[tutorial/settings-and-export|Settings & export]] — theme, cloud sync controls, and getting a note out as Markdown/HTML/PDF
- [[tutorial/writing-books-and-scripts|Writing books & scripts]] — Book/Chapter/Character/Scene templates for long-form fiction and screenwriting

> [!tip] Fastest way to learn
> Open each linked note, then look at its **Source** view (top-right toggle) to see the raw markdown that produced what you're reading.

> [!tip] Press ⌘K right now
> The command palette (⌘K, or Ctrl+K) is the fastest way to get anywhere in the app — search notes or run any action from one box. Try it before reading further.

## The three things worth knowing before anything else

1. **Your notes are just files.** Everything lives in `vault/` as plain `.md` files with YAML frontmatter. Open them in any text editor, put them in git, sync them however you like — this app is a nice way to *edit* them, not a lock-in format.
2. **Editing is live.** Two browser tabs open on the same note stay in sync in real time, no save button. Try it: open this note in two tabs side by side and type in one.
3. **The search cache is disposable.** `.pkm/index.sqlite` can be deleted any time — hit **Reindex** in the sidebar and it rebuilds from the files in `vault/`.

Next: [[tutorial/formatting|Formatting →]]
