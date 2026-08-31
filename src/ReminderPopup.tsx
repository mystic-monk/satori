import { useState } from "react";

interface ReminderPopupProps {
  value: string | null; // datetime-local string, e.g. "2026-09-01T09:00"
  onSet: (value: string | null) => void;
  onClose: () => void;
}

// Small floating form for the 🔔 toolbar button (App.tsx) — same
// positioning idea as Editor.tsx's slash-menu/comment-trigger popovers,
// just anchored to a toolbar button instead of editor content.
export default function ReminderPopup({ value, onSet, onClose }: ReminderPopupProps) {
  const [draft, setDraft] = useState(value ?? "");

  return (
    <div className="reminder-popup" onClick={(e) => e.stopPropagation()}>
      <input
        type="datetime-local"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Reminder date and time"
      />
      <div className="reminder-popup-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        {value && (
          <button type="button" className="btn-ghost" onClick={() => onSet(null)}>
            Clear
          </button>
        )}
        <button type="button" onClick={() => draft && onSet(draft)} disabled={!draft}>
          Set
        </button>
      </div>
    </div>
  );
}
