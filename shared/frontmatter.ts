import * as yaml from "js-yaml";

// Shared between the Node server and the browser client — the one thing
// gray-matter (the original server-side choice) can't be, since it pulls
// in Node's Buffer global under the hood and crashed the moment
// PropertiesPanel tried to use it client-side. js-yaml has no such
// dependency, so this single implementation replaces both. (Not shared
// with the Rust/Tauri side — src-tauri/src/frontmatter.rs is a separate
// implementation by necessity of the language boundary; three
// implementations becomes two.)

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { data: {}, body: raw };
  let data: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(match[1]);
    if (loaded && typeof loaded === "object") data = loaded as Record<string, unknown>;
  } catch {
    // Malformed YAML in the frontmatter block — treat as no properties
    // rather than crashing.
  }
  return { data, body: raw.slice(match[0].length) };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yamlText = yaml.dump(data).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}
