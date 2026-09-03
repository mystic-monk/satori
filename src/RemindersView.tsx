import { useMemo } from "react";
import { Bell } from "lucide-react";
import type { NoteListItem } from "./api";
import { allReminders } from "./reminderSchedule";

interface RemindersViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
}

// A vault-wide browse of every note with a remind_at set — reminderSchedule's
// dueReminders only ever answers "what needs to fire right now" (the
// notification-check loop), there was nowhere to see the full list,
// past or future, until this. Sorted soonest-first; a past-due
// reminder (already fired, or the app was closed when it was due)
// stays visible rather than disappearing, so it doubles as a light
// history of what's already happened.
export default function RemindersView({ notes, onNavigate }: RemindersViewProps) {
  const reminders = useMemo(() => allReminders(notes), [notes]);
  const now = Date.now();

  return (
    <div className="reminders-view">
      <h1 className="reminders-view-title">
        <Bell size={18} aria-hidden="true" />
        Reminders
      </h1>
      {reminders.length === 0 ? (
        <p className="reminders-empty">
          No reminders set yet — open a note and use the 🔔 button in its toolbar to set one.
        </p>
      ) : (
        <ul className="reminders-list">
          {reminders.map((r) => {
            const isPast = new Date(r.remindAt).getTime() < now;
            return (
              <li key={r.path}>
                <button
                  className={`reminders-item ${isPast ? "reminders-item-past" : ""}`}
                  onClick={() => onNavigate(r.path, r.title, r.type)}
                >
                  <span className="reminders-item-time">
                    {new Date(r.remindAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="reminders-item-title">{r.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
