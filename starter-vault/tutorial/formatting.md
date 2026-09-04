---
title: "Tutorial: Formatting"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

## Inline formatting

| You type | You get |
| --- | --- |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `` `inline code` `` | `inline code` |
| `==highlight==` | ==highlight== |
| `%%inline comment%%` | %%inline comment%% |
| `[colored text]{color=#e05252}` | [colored text]{color=#e05252} |
| `[a different font]{font=serif}` | [a different font]{font=serif} |

The inline comment renders with a 💬 marker — meant for annotating without touching the "real" text underneath it.

Select any text and a **🎨 Style** button appears above it — pick a color and/or a font (serif, sans, mono, or rounded) and Apply. Selecting already-styled text and clicking it again lets you change or clear what's there instead of stacking a new style on top.

## Headings, lists, tables

# Heading 1
## Heading 2
### Heading 3

- Bulleted
- Lists
  - nest with indentation

1. Numbered
2. Lists

| Left | Right |
| --- | --- |
| a | 1 |
| b | 2 |

## Task lists

`- [ ]` and `- [x]` render as real, clickable checkboxes in Preview — click one and it writes the check straight back to this note's markdown:

- [ ] An open task — click it
- [x] A done one

## Code blocks

```js
function greet(name) {
  return `Hello, ${name}!`;
}
```

Hover a rendered code block in Preview and a **Copy** button appears in the corner — no select-and-copy needed.

## Callouts

> [!note] Just a note
> Plain informational callout.

> [!tip] Pro tip
> Callouts support **any inline formatting** inside them, including [[tutorial|links]].

> [!warning] Heads up
> Use `[!warning]`, `[!tip]`, `[!note]`, `[!danger]` — the type controls the accent color.

## Math

Inline: $E = mc^2$

Block:

$$
\int_0^\infty e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
$$

Next: [[tutorial/linking|Linking & the graph →]]
