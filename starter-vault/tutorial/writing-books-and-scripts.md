---
title: "Tutorial: Writing books & scripts"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

Satori has no dedicated "book mode" or "screenplay mode" — and doesn't need one. Everything here is the same handful of features from earlier pages ([[tutorial/properties|Properties & types]], relations, [[tutorial/organizing|Table view and query blocks]], the [[tutorial/linking|Graph]]) combined into a shape that works for long-form fiction and scripts. Four templates ship in **+ Create → New From Template** to get you started: **Book**, **Chapter**, **Character**, **Scene**.

## A book, chapter by chapter

Create a note from the **Book** template — it has a live `​```query` block that lists every chapter pointing back at it. Then create a **Chapter** for each one: give it a `book` property with a wikilink to the book (`book: [[Your Book Title]]`, typed exactly as the book's title) and an `order` number. The book's chapter list updates itself as you add more — nothing to maintain by hand.

Switch to **Table** and filter to `type: chapter` to see every chapter across every book at once, sorted by `order`, with a `status` column (draft / revised / done — whatever values you want) you can edit right in the cell.

> [!tip] No word count yet
> There's no built-in word-count tracking today — `status` is the honest way to track progress for now. If that's something you'd want, it's a natural small addition on top of what's here.

## Characters, without a separate relationship map

Create a note from the **Character** template for each person in your story. The template's own text tells you the trick: link to other characters *in the prose itself* — "raised by [[Marta]]", "owes a debt to [[The Duke]]" — instead of a separate relationship-tracking system. Open **Graph** and every character who's ever mentioned another shows up connected, automatically, the same graph every other note in your vault already builds.

## Scenes and beats

The **Scene** template has `order`, `setting`, and `characters` properties. Give a scene's `characters` property a list of everyone present (`characters: ["[[Character A]]", "[[Character B]]"]` in Source view, or one at a time via the Properties panel). Table view, filtered to `type: scene` and sorted by `order`, is your beat sheet.

To find every scene a given character appears in, use a **rollup column** (covered in [[tutorial/organizing|Organizing & finding your notes]]) on Table view rather than a query block — a query block only matches a property with one exact value, and a scene's `characters` list has several. Rollups are built for exactly this "who points back at me" direction.

## Visual reference

Character notes are plain markdown, but nothing stops you from also making a matching **Canvas** note (see [[tutorial/diagrams|Diagrams]]) for moodboards, character designs, or a scene map — sketched or pasted in — and linking the two together with a regular `[[wikilink]]`.

---

You've reached the end of the tutorial. From here, the fastest way to keep learning is just to use the app — favorite a note, try the graph, invite someone if you're running a server. Back to [[tutorial|Tutorial]].
