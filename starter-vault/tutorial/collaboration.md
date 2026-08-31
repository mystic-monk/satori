---
title: "Tutorial: Collaboration & sharing"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

## Local, real-time, no save button

Open any note in two browser tabs and start typing in one — the other updates live. That's a CRDT (Yjs) syncing over a WebSocket to a small server on your own machine; conflict-free by construction, even if you edit the same sentence from both tabs at once.

## Cloud sync, end-to-end encrypted

Open **Settings** in the sidebar (below your identity) with a note open — its **Cloud sync** section has a relay address, a room name (defaults to the note's path), an **Edit / View only** toggle, and a passphrase field. Whoever connects with the same passphrase, anywhere, can co-edit — but the relay server in between never sees anything but ciphertext. Wrong passphrase in, and you simply can't decrypt what comes back.

The relay itself has to run somewhere reachable over the internet — your own machine only works for someone on the same network. See [[tutorial/team-workspace|Team, Workspace & self-hosting]] for what it takes to actually stand one up.

**Real view/edit separation, cryptographically enforced.** Once you're connected as an editor, a **"Get a view-only key to share"** button appears — click it and you get a separate string, derived from your passphrase but not reversible back to it. Give that to someone instead of the passphrase, and they can connect as **View only**: they can read everything, but if their client ever tried to send an edit anyway, the relay itself rejects it — it verifies a signature against a list of who's actually proven edit access, without ever decrypting a single note to check. This isn't a UI restriction someone could work around with browser dev tools; the editor is also just read-only for them, but the *real* enforcement happens on the relay before their write would ever reach you.

## Sharing with roles

Open the **Share** panel and create a link with a role:

- **Can view** — read-only, enforced by the server, not just a hidden button
- **Can comment** — can add comments (see below) but not edit the note itself
- **Can edit** — full write access

Copy the generated link to hand to someone else on your network. Revoke it any time from the same panel.

### Sharing a whole project at once

A share link normally covers just the one note it was created from. Create a note from the **Project** template (**+ Create → New From Template**) instead, and its Share button behaves differently: the link covers every note tagged `project: [[Your Project Title]]`, not just the project note itself — a live `​```query` block on the project note is what lists them, same mechanism as the Book template's chapter list. Add or remove a note from the project any time by editing its `project` property; the share link doesn't need to be recreated, and someone already using it picks up the change on their next visit. Revoking the link removes access to every note in the project at once, the same as revoking a single-note share does for just that one note.

## Comments

Open the **Comments** panel (in the right-hand panel — the icon next to the note title toggles it) on any note to leave a threaded comment without touching the note's actual content — separate from the `%%inline comment%%` syntax in [[tutorial/formatting|Formatting]], which edits the text itself. Someone with the **Can comment** share role can post here even though they can't edit the note.

**Anchor a comment to a specific bit of text**: select some text first — a small **💬 Comment** button appears right there. Click it and your comment gets tied to that exact span, shown as a highlighted excerpt above what you type. The anchor survives edits made anywhere else in the note (insert a paragraph above it, and it still points at the same words) — it's tracked by the same CRDT mechanism real-time sync itself uses, not a fragile line number. Click the excerpt on any anchored comment later to jump straight back to that spot.

## Change history

The **History** panel logs who's been touching a note and when — not a full diff/undo log, but enough to answer "who's been in here."

Next: [[tutorial/team-workspace|Team, Workspace & self-hosting →]]
