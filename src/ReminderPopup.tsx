import { useEffect, useRef, useState } from "react";
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

type QuickPick = "30m" | "1h" | "tonight8" | "tomorrow9" | "nextMonday9";

function quickPickDate(kind: QuickPick, now: Date): Date {
  if (kind === "30m") return new Date(now.getTime() + 30 * 60 * 1000);
  if (kind === "1h") return new Date(now.getTime() + 60 * 60 * 1000);
  const target = new Date(now);
  if (kind === "tonight8") {
    target.setHours(20, 0, 0, 0);
    return target;
  }
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

// Whole-value steps per wheel notch: Math.sign(deltaY), not the raw delta —
// a trackpad can report a wide range of magnitudes for what's physically
// one scroll gesture, so scaling by the raw value would make the exact
// same gesture change the date/time by a wildly different amount machine
// to machine. One day per notch on the date field, 15 minutes on the time
// field (matches the granularity every quick-pick above already uses).
function addDays(dateStr: string, delta: number): string {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addMinutes(timeStr: string, delta: number): string {
  const [h, m] = (timeStr || "09:00").split(":").map(Number);
  let total = (h * 60 + m + delta) % 1440;
  if (total < 0) total += 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
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
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const timeInputRef = useRef<HTMLInputElement | null>(null);

  function applyQuickPick(kind: QuickPick) {
    const [d, t] = toParts(quickPickDate(kind, new Date()));
    setDatePart(d);
    setTimePart(t);
  }

  // Native listeners, not React's onWheel — React attaches wheel handlers
  // as passive by default, which silently no-ops preventDefault, so the
  // page would scroll out from under the popup instead of the field's own
  // value changing (same reasoning GraphView.tsx's wheel-zoom uses).
  useEffect(() => {
    const dateEl = dateInputRef.current;
    const timeEl = timeInputRef.current;
    function onDateWheel(e: WheelEvent) {
      e.preventDefault();
      setDatePart((d) => addDays(d || toParts(new Date())[0], e.deltaY > 0 ? -1 : 1));
    }
    function onTimeWheel(e: WheelEvent) {
      e.preventDefault();
      setTimePart((t) => addMinutes(t, e.deltaY > 0 ? -15 : 15));
    }
    dateEl?.addEventListener("wheel", onDateWheel, { passive: false });
    timeEl?.addEventListener("wheel", onTimeWheel, { passive: false });
    return () => {
      dateEl?.removeEventListener("wheel", onDateWheel);
      timeEl?.removeEventListener("wheel", onTimeWheel);
    };
  }, []);

  return (
    <div className="reminder-popup" onClick={(e) => e.stopPropagation()}>
      <div className="reminder-quick-picks">
        <button type="button" onClick={() => applyQuickPick("30m")}>
          In 30 min
        </button>
        <button type="button" onClick={() => applyQuickPick("1h")}>
          In 1 hour
        </button>
        <button type="button" onClick={() => applyQuickPick("tonight8")}>
          Tonight, 8pm
        </button>
        <button type="button" onClick={() => applyQuickPick("tomorrow9")}>
          Tomorrow, 9am
        </button>
        <button type="button" onClick={() => applyQuickPick("nextMonday9")}>
          Next Monday, 9am
        </button>
      </div>
      <div className="reminder-datetime-row">
        <input
          ref={dateInputRef}
          type="date"
          value={datePart}
          onChange={(e) => setDatePart(e.target.value)}
          aria-label="Reminder date"
          title="Scroll to change by a day"
        />
        <input
          ref={timeInputRef}
          type="time"
          value={timePart}
          onChange={(e) => setTimePart(e.target.value)}
          aria-label="Reminder time"
          title="Scroll to change by 15 minutes"
        />
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
