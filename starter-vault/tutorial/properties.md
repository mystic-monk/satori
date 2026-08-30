---
title: "Tutorial: Properties & types"
type: reference
citekey: tutorial-properties
status: draft
tags: [tutorial, properties]
---

← Back to [[tutorial|Tutorial]]

Every note's YAML frontmatter (the `---`-fenced block at the top of the file) becomes structured, queryable **properties** — not just freeform text.

Open the **Properties** panel above this note's editor to see this note's frontmatter as an editable form: `type`, `status`, and `tags` are all here as fields you can edit without touching raw YAML.

## Why `type` is special

Give a note `type: person`, `type: project`, `type: book` — whatever taxonomy fits your vault — and:

- the sidebar's **type filter** dropdown lets you browse notes by type
- this note's `type: reference` is what makes it show up under "reference" in that dropdown

Canvas notes (see [[tutorial/diagrams|Diagrams]]) use exactly this mechanism: `type: canvas` is what tells the app to open the Excalidraw editor instead of the markdown editor.

## Adding your own properties

Click **+ Add property** in the Properties panel and give it a name — array values (comma-separated), booleans (checkbox), and plain text are all supported.

## Relation properties

A property whose value is a `[[wikilink]]` is a **relation**, not plain text — it renders as a clickable link to that note wherever it shows up, including in Table view (see [[tutorial/organizing|Organizing & finding your notes]]). Add `project: [[some project note]]` to a note's frontmatter and you've linked two notes through a named field, not just a body-text wikilink.

Next: [[tutorial/organizing|Organizing & finding your notes →]]
