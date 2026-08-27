const NAME_KEY = "pkm-display-name";
const COLOR_KEY = "pkm-cursor-color";

// Not an account system — just a per-browser label so collaborators (local
// or cloud) can tell whose cursor is whose, and so change history has a
// name to attach to a save. Persisted in localStorage: private to this
// browser, never sent anywhere but our own local server.
export function getDisplayName(): string {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = window.prompt("Your display name (shown to collaborators):", "Anonymous")?.trim() || "Anonymous";
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

// y-codemirror.next reads awareness state.user.{name,color,colorLight} to
// render remote cursors/selections — see y-remote-selections.js. Picked
// once per browser and kept stable across reloads/notes so the same person
// always shows up as the same color, same principle as the display name.
const CURSOR_COLORS = [
  "#30bced",
  "#6eeb83",
  "#ffbc42",
  "#ecd444",
  "#ee6352",
  "#9ac2c9",
  "#8acb88",
  "#1be7ff",
];

export function getCursorColor(): string {
  let color = localStorage.getItem(COLOR_KEY);
  if (!color) {
    color = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
    localStorage.setItem(COLOR_KEY, color);
  }
  return color;
}
