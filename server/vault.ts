import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../shared/frontmatter.js";

export const VAULT_DIR = path.resolve(process.cwd(), "vault");
const STARTER_VAULT_DIR = path.resolve(process.cwd(), "starter-vault");

// A brand-new vault/ (first run, or a fresh clone/self-host with no vault/
// committed — it's gitignored on purpose, see .gitignore) opens completely
// empty otherwise: no notes, no guidance, nothing to click. Seeds the
// bundled starter/tutorial content in exactly once — only when the vault
// has zero real note files (a stray .DS_Store or empty subfolder shouldn't
// count as "already has content" and block seeding) — never on top of
// real content, so this can't clobber anything once you've actually
// started using the app.
export function seedStarterVaultIfEmpty(): void {
  if (!fs.existsSync(STARTER_VAULT_DIR)) return; // e.g. a dev checkout that removed it
  if (listNoteFiles().length > 0) return;
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  // dereference: true — if STARTER_VAULT_DIR (or anything inside it) were
  // ever a symlink, copy what it points to rather than replicating the
  // symlink itself, which cpSync's default (false) would try to recreate
  // at the destination and fail on since VAULT_DIR already exists as a
  // real directory from the line above.
  fs.cpSync(STARTER_VAULT_DIR, VAULT_DIR, { recursive: true, dereference: true });
}

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

export function getNoteMtime(relPath: string): number | null {
  try {
    return fs.statSync(toAbsPath(relPath)).mtimeMs;
  } catch {
    return null;
  }
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
  const parsed = parseFrontmatter(raw);
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
    body: parsed.body,
  };
}
