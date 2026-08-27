export interface NoteListItem {
  path: string;
  title: string;
  tags: string[];
  type: string | null;
  updatedAt: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface BacklinkItem {
  path: string;
  title: string;
  embed: boolean;
}

export interface LinkEdge {
  source: string;
  target: string;
  embed: boolean;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export async function fetchNotes(type?: string): Promise<NoteListItem[]> {
  const res = await fetch(type ? `/api/notes?type=${encodeURIComponent(type)}` : "/api/notes");
  return res.json();
}

export async function fetchTypes(): Promise<{ type: string; count: number }[]> {
  const res = await fetch("/api/types");
  return res.json();
}

export async function fetchBacklinks(p: string): Promise<BacklinkItem[]> {
  const res = await fetch(`/api/backlinks/${encodePath(p)}`);
  return res.json();
}

export async function fetchLinks(): Promise<LinkEdge[]> {
  const res = await fetch("/api/links");
  return res.json();
}

export async function fetchNote(p: string): Promise<{ path: string; raw: string }> {
  const res = await fetch(`/api/notes/${encodePath(p)}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
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
