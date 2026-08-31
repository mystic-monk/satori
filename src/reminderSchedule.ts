import type { NoteListItem } from "./api";

export interface DueReminder {
  path: string;
  title: string;
  remindAt: string;
  key: string; // path + remindAt — re-setting a reminder to a new time gets a fresh key, so it can fire again
}

// A note opts in via a `remind_at` frontmatter property holding a
// datetime-local string ("2026-09-01T09:00") — the same format
// <input type="datetime-local"> produces/consumes, so there's no timezone
// parsing to get wrong between setting it and checking it. Due means
// "now has reached or passed remind_at", not yet in `alreadyFired` this
// session — no lower bound, so a reminder that was due while the app was
// closed still fires once the moment it's next open, rather than being
// silently skipped.
export function dueReminders(notes: NoteListItem[], now: number, alreadyFired: ReadonlySet<string>): DueReminder[] {
  const due: DueReminder[] = [];
  for (const note of notes) {
    const remindAt = note.properties.remind_at;
    if (typeof remindAt !== "string" || !remindAt) continue;
    const at = new Date(remindAt).getTime();
    if (Number.isNaN(at) || at > now) continue;
    const key = `${note.path}:${remindAt}`;
    if (alreadyFired.has(key)) continue;
    due.push({ path: note.path, title: note.title, remindAt, key });
  }
  return due;
}
