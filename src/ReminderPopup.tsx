import { useState } from "react";
import { icsCalendar, reminderVevent } from "../shared/ics";
import { exportIcs } from "./export";

interface ReminderPopupProps {
  value: string | null; // datetime-local string, e.g. "2026-09-01T09:00"
  onSet: (value: string | null) => void;
  onClose: () => void;
  notePath: string;
  noteTitle: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toParts(d: Date): [string, string] {
  return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`];
}

type QuickPick = "1h" | "tomorrow9" | "nextMonday9";

function quickPickDate(kind: QuickPick, now: Date): Date {
  if (kind === "1h") return new Date(now.getTime() + 60 * 60 * 1000);
  const target = new Date(now);
  if (kind === "tomorrow9") {
    target.setDate(target.getDate() + 1);
  } else {
    // ISO weekday 1=Mon..7=Sun; JS getDay() is 0=Sun..6=Sat.
    const daysUntilMonday = ((1 - target.getDay() + 7) % 7) || 7;
    target.setDate(target.getDate() + daysUntilMonday);
  }
  target.setHours(9, 0, 0, 0);
  return target;
}

// Small floating form for the 🔔 toolbar button (App.tsx) — same
// positioning idea as Editor.tsx's slash-menu/comment-trigger popovers,
// just anchored to a toolbar button instead of editor content. Separate
// date/time native inputs, not a single type="datetime-local" — that
// combined widget renders as a cramped, fiddly segmented editor on this
// platform (no visible calendar, tiny numeric steppers); a plain date
// input gives a real calendar picker and a plain time input a normal
// clock/spinner, both larger and more standard. Quick-pick buttons cover
// the common cases without touching either field at all.
export default function ReminderPopup({ value, onSet, onClose, notePath, noteTitle }: ReminderPopupProps) {
  const [datePart, setDatePart] = useState(() => value?.split("T")[0] ?? "");
  const [timePart, setTimePart] = useState(() => value?.split("T")[1] ?? "09:00");
  const draftValue = datePart ? `${datePart}T${timePart || "09:00"}` : null;

  function applyQuickPick(kind: QuickPick) {
    const [d, t] = toParts(quickPickDate(kind, new Date()));
    setDatePart(d);
    setTimePart(t);
  }

  return (
    <div className="reminder-popup" onClick={(e) => e.stopPropagation()}>
      <div className="reminder-quick-picks">
        <button type="button" onClick={() => applyQuickPick("1h")}>
          In 1 hour
        </button>
        <button type="button" onClick={() => applyQuickPick("tomorrow9")}>
          Tomorrow, 9am
        </button>
        <button type="button" onClick={() => applyQuickPick("nextMonday9")}>
          Next Monday, 9am
        </button>
      </div>
      <div className="reminder-datetime-row">
        <input type="date" value={datePart} onChange={(e) => setDatePart(e.target.value)} aria-label="Reminder date" />
        <input type="time" value={timePart} onChange={(e) => setTimePart(e.target.value)} aria-label="Reminder time" />
      </div>
      <div className="reminder-popup-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        {value && (
          <>
            <button type="button" className="btn-ghost" onClick={() => onSet(null)}>
              Clear
            </button>
            <button
              type="button"
              className="btn-ghost"
              title="Download as .ics — import into Apple/Google/Outlook Calendar"
              onClick={() => exportIcs(noteTitle, icsCalendar([reminderVevent({ path: notePath, title: noteTitle, remindAt: value })]))}
            >
              .ics
            </button>
          </>
        )}
        <button type="button" onClick={() => draftValue && onSet(draftValue)} disabled={!draftValue}>
          Set
        </button>
      </div>
    </div>
  );
}
