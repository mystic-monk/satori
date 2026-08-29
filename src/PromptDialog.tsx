import { useEffect, useState } from "react";

interface PromptDialogProps {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

// A real in-app modal, not window.prompt() — wry's WKWebView backend on
// macOS doesn't implement the WKUIDelegate methods needed for
// window.prompt()/confirm()/alert() to do anything at all, so every call
// site using them silently no-ops in the native app (this is what
// ConfirmDialog.tsx already fixed for the delete flow; this is the same
// fix for anything that needs a text value, not just a yes/no).
export default function PromptDialog({
  title,
  message,
  placeholder,
  defaultValue = "",
  confirmLabel = "OK",
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
      >
        <h3 className="modal-title" id="prompt-dialog-title">
          {title}
        </h3>
        {message && <p className="modal-message">{message}</p>}
        <input
          className="modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          autoFocus
        />
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
