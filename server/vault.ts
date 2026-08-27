import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const VAULT_DIR = path.resolve(process.cwd(), "vault");

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  type: string | null;
  properties: Record<string, unknown>;
  updatedAt: number;
}

function toRelPath(absPath: string): string {
  return path.relative(VAULT_DIR, absPath).split(path.sep).join("/");
}

function toAbsPath(relPath: string): string {
  const abs = path.resolve(VAULT_DIR, relPath);
  if (abs !== VAULT_DIR && !abs.startsWith(VAULT_DIR + path.sep)) {
    throw new Error("path escapes vault");
  }
  return abs;
}

export function listNoteFiles(): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(toRelPath(full));
      }
    }
  }
  if (fs.existsSync(VAULT_DIR)) walk(VAULT_DIR);
  return results;
}

export function readNoteRaw(relPath: string): string {
  return fs.readFileSync(toAbsPath(relPath), "utf8");
}

export function writeNoteRaw(relPath: string, raw: string): void {
  const abs = toAbsPath(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, raw, "utf8");
}

export function deleteNote(relPath: string): void {
  fs.rmSync(toAbsPath(relPath));
}

export function parseNote(relPath: string, raw: string): { meta: NoteMeta; body: string } {
  const parsed = matter(raw);
  const stat = fs.statSync(toAbsPath(relPath));
  const fmTitle = typeof parsed.data.title === "string" ? parsed.data.title : undefined;
  const fallbackTitle = path.basename(relPath, ".md");
  const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
  const type = typeof parsed.data.type === "string" ? parsed.data.type : null;
  return {
    meta: {
      path: relPath,
      title: fmTitle || fallbackTitle,
      tags,
      type,
      properties: parsed.data,
      updatedAt: stat.mtimeMs,
    },
    body: parsed.content,
  };
}
