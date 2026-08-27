const KEY = "pkm-display-name";

// Not an account system — just a per-browser label so collaborators (local
// or cloud) can tell whose cursor is whose, and so change history has a
// name to attach to a save. Persisted in localStorage: private to this
// browser, never sent anywhere but our own local server.
export function getDisplayName(): string {
  let name = localStorage.getItem(KEY);
  if (!name) {
    name = window.prompt("Your display name (shown to collaborators):", "Anonymous")?.trim() || "Anonymous";
    localStorage.setItem(KEY, name);
  }
  return name;
}
