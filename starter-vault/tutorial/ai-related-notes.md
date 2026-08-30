---
title: "Tutorial: Related Notes & local AI"
tags: [tutorial]
---

← Back to [[tutorial|Tutorial]]

Below **Backlinks** on any note, there's a **Related** panel — notes that are *conceptually* close to the one you're reading, even if nothing ever [[wikilink|linked]] them together. Scroll down on this very page and you'll see other tutorial pages listed there, purely because their content is about similar things.

## How it actually works — and what it isn't

Every note gets converted into a small numeric fingerprint (an *embedding*) by a small on-device model, and the Related panel just finds whichever other notes have the closest fingerprint. That's it:

- **Fully local.** No API key, no account, no network call, nothing to configure. The model (a few dozen megabytes) downloads once, the first time it's needed, and runs entirely on your machine from then on.
- **Not a chatbot.** There's no "ask a question," no writing assistant, no summarization — this one feature, and only this one, is what's built so far. A genuine AI writing assistant is on the roadmap, deliberately designed the same way: opt-in, bring-your-own-key, nothing sent anywhere without you choosing to.
- **Works best on real paragraphs.** A note that's just a title and a bullet or two doesn't give the model much to work with — the panel will look sparse for very short notes. Write a sentence or two of actual content and it gets noticeably better.

## Where it's available

Only in the Node/browser deployment (self-hosted server, same as [[tutorial/team-workspace|Team/Workspace]]) — the native Tauri app doesn't have this panel yet. It needs its own Rust-side path to run the embedding model, which is real, separate work that hasn't happened yet. If you're on the desktop app and don't see a Related panel below Backlinks, that's why, not a bug.

## Nothing to set up

Unlike cloud sync or Team/Workspace, there's no toggle, no settings, no account. Every note gets embedded automatically in the background as you save it — the first time you open a server with existing notes, give it a minute after startup (or hit **Reindex**) for the initial pass to catch up on everything already there.

---

Next: [[tutorial/settings-and-export|Settings & export →]]
