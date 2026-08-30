---
title: "Tutorial: Linking & the graph"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

## Wikilinks

Type `[[note title]]` to link to another note by title, or `[[path/to/note]]` by path. A link with a custom label looks like `[[tutorial|click here]]` → [[tutorial|click here]].

Links that don't resolve yet still render — as a red "broken" link — so you can write [[a note that doesn't exist yet]] before creating it, Wikipedia-style.

## Backlinks

Scroll down on any note and you'll find a **Backlinks** panel — every note that links here, listed automatically. This note is linked from [[tutorial|Tutorial]]; check its Backlinks panel and you'll find this one listed there.

## Section and block references

A wikilink can point at *part* of a note, not just the whole thing:

- `[[Note#Heading]]` links or embeds one section — from that heading to the next one at the same level.
- `[[Note#^block-id]]` links or embeds one specific line, wherever it is — mark the line with a trailing `^block-id` first.

`![[ref]]` embeds another note's *rendered content* live, inline. This embeds just the "Why `type` is special" section of the properties tutorial, not the whole note — note that the fragment after `#` has to match the heading text exactly, backticks included:

![[tutorial/properties#Why `type` is special]]

Edit that section and this embed reflects the change the next time this note re-renders.

## The graph view

Click **Graph** in the sidebar. Every wikilink you've made becomes an edge between two nodes — hover a note to trace exactly what it connects to, click to open it. The **Full vault / This note** toggle at the top switches between the whole graph and just the currently open note's direct connections, useful once a vault gets big enough that the full graph is more noise than signal.

As your vault grows, the graph is the fastest way to spot orphaned notes (no connections) and hub notes (lots of connections) — try it now, this whole tutorial folder should show up as a small connected cluster.

Next: [[tutorial/properties|Properties & types →]]
