---
title: "Tutorial: Team, Workspace & self-hosting"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

Everything up to here works with zero setup — no accounts, nothing to configure. This page is about the two things that only apply once you (or someone) is running Satori's server yourself, reachable by more than just you.

> [!tip] Skip this page if
> You're using the native desktop app and only ever open your own vault. Nothing here changes anything about that — read on only once you actually want other people involved.

## Team/Workspace: standing accounts for a shared server

If you're self-hosting Satori's server (rather than using the native app), a small **Set up team access** entry sits near the bottom of the sidebar, right below Settings. Click it and you become the first **admin** — an email and password, nothing else needed.

Two roles, deliberately simple:
- **admin** — full read/write, plus can invite and remove members
- **member** — full read/write, same practical access an owner always had

This sits *on top of* the per-note Share panel from [[tutorial/collaboration|Collaboration & sharing]], not instead of it — the two coexist. Workspace membership is "you're on the team, permanently." A share link is "this one person gets access to this one note, revocable any time." Use whichever actually matches what you mean.

**Inviting someone**: from the Members panel (admin only), generate an invite link and send it however you'd send anyone a link — Slack, email, whatever. They open it, pick a name and password, and they're a member.

**Removing someone**: also from the Members panel. This immediately revokes every session they had open — not a "they'll be logged out eventually" thing.

> [!tip] Nothing changes until you opt in
> A solo, self-hosted server with zero accounts configured behaves exactly like it always has — no login screen, no friction. The moment someone clicks "Set up team access," *that* server starts requiring sign-in from then on. Every other server you run stays untouched.

## What Workspace roles *don't* do

Worth knowing plainly rather than discovering by surprise:

- Both roles get the same vault-wide access — there's no per-note permission tier for members the way share links have for guests. A member sees and can edit everything, same as you.
- Workspace accounts are separate from cloud sync's passphrase. Connecting to cloud sync (previous page) still uses one shared passphrase for everyone in that room, regardless of who's a workspace member — real per-role access there needs a different cryptographic approach than what exists today.
- No SSO, no email verification, no self-serve "forgot password." If someone's genuinely locked out, whoever administers the server can intervene directly.

## Actually reaching a server from outside your network

None of the above matters unless a server is reachable somewhere other people can get to — your own machine only works for someone on the same network. [Render](https://render.com) (or any similar host) works well for this, and is exactly what [[tutorial/collaboration|the previous page]]'s relay-hosting note was pointing at: deploy `server/` there, and both cloud sync *and* Team/Workspace become usable by anyone with the URL, not just people in the same room as your laptop.

---

Next: [[tutorial/ai-related-notes|Related Notes & local AI →]]
