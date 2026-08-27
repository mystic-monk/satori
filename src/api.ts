export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  updatedAt: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export async function fetchNotes(): Promise<NoteListItem[]> {
  const res = await fetch("/api/notes");
  return res.json();
}

export async function fetchNote(p: string): Promise<{ path: string; raw: string }> {
  const res = await fetch(`/api/notes/${encodePath(p)}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
}

export async function saveNote(p: string, raw: string): Promise<void> {
  await fetch(`/api/notes/${encodePath(p)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

export async function createNote(p: string, raw: string): Promise<void> {
  await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: p, raw }),
  });
}

export async function deleteNoteApi(p: string): Promise<void> {
  await fetch(`/api/notes/${encodePath(p)}`, { method: "DELETE" });
}

export async function search(q: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function reindex(): Promise<{ count: number }> {
  const res = await fetch("/api/reindex", { method: "POST" });
  return res.json();
}
