import type { KeyboardEvent } from "react";

// For `<li onClick>` used as a de facto button (note list, search results,
// backlinks) — <li> isn't natively focusable or keyboard-activatable, so
// role="button" + tabIndex={0} + this handler are needed together to make
// it work like a real button for keyboard/screen-reader users.
export function activateOnEnterOrSpace(e: KeyboardEvent, action: () => void): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}
