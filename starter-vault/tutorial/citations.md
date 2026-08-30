---
title: "Tutorial: Citations & references"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

## A reference is just a note

Give a note `type: reference` plus a `citekey` property (and optionally `author`, `year`, `title`) and it's citable from anywhere in your vault — no separate bibliography database, same "everything is a note" principle as templates and flashcards.

[[tutorial/properties|This tutorial's own Properties page]] happens to be `type: reference` already, with citekey `tutorial-properties` — enough to demonstrate the syntax below for real.

## Citing one

Type `[@citekey]` and it resolves to a clickable citation styled `(Author, Year)`: [@tutorial-properties]. An unresolvable key still renders — as a broken citation, same honesty as a broken `[[wikilink]]` — so you can cite something before its reference note exists.

## A bibliography for this note

A fenced ` ```bibliography ` block lists every `[@citekey]` actually cited in *this* note, in the order they first appear:

```bibliography
```

## Importing from a `.bib` file

Already have a BibTeX file from Zotero, Mendeley, or wherever? Run **Import .bib References…** from the command palette (⌘K) and pick the file — each entry becomes its own `type: reference` note, ready to cite with `[@key]` right away.

Deliberate scope cut: no locator suffix (`[@key, p. 12]`) or multi-citation grouping (`[@key1; @key2]`) yet — one citation at a time covers the common case for a first pass.

Next: [[tutorial/collaboration|Collaboration & sharing →]]
