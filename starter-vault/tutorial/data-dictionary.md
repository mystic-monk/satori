---
title: "Tutorial: Data dictionary import"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

If you maintain (or just received) a data dictionary — a catalog of database tables and columns, the kind of artifact a data analyst or data engineer builds from a schema export — Satori can turn it into linked, browsable notes: one note per table, its columns rendered as a table in the body, foreign keys as real links you can follow or see in the graph. There's no special "data dictionary view" here — it's the same Table view, Graph view, and query blocks every other typed note already gets.

## The CSV format

One row per **column** — the shape a schema export naturally comes in. Two headers are required, the rest are optional:

| Header | Required? | Meaning |
|---|---|---|
| `table` | Yes | Table name |
| `column` | Yes | Column name |
| `type` | No | Data type (`INT`, `VARCHAR(255)`, whatever your source uses) |
| `nullable` | No | `yes`/`no`/`true`/`false` |
| `primary_key` | No | `yes`/`no`/`true`/`false` |
| `references_table` | No | The table this column is a foreign key into |
| `references_column` | No | The column on that table it references |
| `description` | No | Free text |

Any other column in your CSV is kept too — it just doesn't get its own dedicated column in the rendered table, the way an unrecognized frontmatter property always shows up fine in Table view without needing to be "known" in advance.

A minimal example:

```
table,column,type,primary_key,references_table,references_column,description
customers,id,INT,yes,,,Primary identifier
customers,email,VARCHAR(255),,,,
orders,id,INT,yes,,,
orders,customer_id,INT,,customers,id,Which customer placed this order
```

## Importing

**+ Create → Import Data Dictionary…** (also in the command palette, ⌘K) — pick the CSV and each table becomes a note at `data-dictionary/<table-name>.md`, `type: db_table`, with its columns rendered as a markdown table in the body:

```
| Column      | Type | Nullable | PK | References        | Description                      |
|-------------|------|----------|----|--------------------|-----------------------------------|
| id          | INT  | No       | ✓  |                    | Primary identifier                |
| customer_id | INT  | No       |    | [[customers]] (id) | Which customer placed this order |
```

That `[[customers]]` is a real wikilink in your own imported notes, not just a text label — a column with `references_table` set gets an actual link to the target table's note.

Importing the same file again skips any table that already has a note — safe to re-run without losing edits you've made to a table note since the last import, though it also means a genuinely updated schema won't overwrite the old columns automatically; delete the note first if you want a clean re-import for one table.

## What you get for free

- **Table view**, filtered to `type: db_table` (a `​```query` block with `type: db_table` works too) — every table as a row, sortable by `column_count` or anything else on it, exactly like any other typed note. Add your own frontmatter property (`owner`, `domain`, `source_system`) to any table note by hand and it becomes a Table-view column automatically.
- **Graph view** — a foreign key shows up as a real edge between the two table notes, because the reference is a genuine `[[wikilink]]` in the body, not just a frontmatter value. See [[tutorial/linking|Linking & the graph]].
- **Backlinks** on a table note lists every other table that references it — useful for "what would break if I changed this table" at a glance.
- **Search** finds a table by name or by anything in its column descriptions, same full-text search as everything else in your vault.

---

Next: [[tutorial/collaboration|Collaboration & sharing →]]
