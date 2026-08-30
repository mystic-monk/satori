---
title: "Tutorial: Collaboration & sharing"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

## Local, real-time, no save button

Open any note in two browser tabs and start typing in one — the other updates live. That's a CRDT (Yjs) syncing over a WebSocket to a small server on your own machine; conflict-free by construction, even if you edit the same sentence from both tabs at once.

## Cloud sync, end-to-end encrypted

Under a note's toolbar there's a **Connect cloud sync** row: a room name (defaults to the note's path) and a shared passphrase. Anyone with the same passphrase, anywhere, can co-edit — but the relay server in between never sees anything but ciphertext. Wrong passphrase in, and you simply can't decrypt what comes back.

There's no view/edit separation here yet, though — unlike the local Share panel below, anyone with the cloud passphrase can write, not just read. The app warns about this right above the cloud-sync controls; only share that passphrase with people you'd trust to edit.

## Sharing with roles

Open the **Share** panel and create a link with a role:

- **Can view** — read-only, enforced by the server, not just a hidden button
- **Can comment** — can add comments (see below) but not edit the note itself
- **Can edit** — full write access

Copy the generated link to hand to someone else on your network. Revoke it any time from the same panel.

## Comments

Open the **Comments** panel on any note to leave a threaded comment without touching the note's actual content — separate from the `%%inline comment%%` syntax in [[tutorial/formatting|Formatting]], which edits the text itself. Someone with the **Can comment** share role can post here even though they can't edit the note.

## Change history

The **History** panel logs who's been touching a note and when — not a full diff/undo log, but enough to answer "who's been in here."

You've reached the end of the tutorial — back to [[tutorial|Tutorial]].
