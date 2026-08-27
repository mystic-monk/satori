import * as yaml from "js-yaml";

// gray-matter (used server-side) pulls in Node's Buffer global under the
// hood, which doesn't exist in the browser — so the client parses/writes
// frontmatter itself, directly with js-yaml, against the same `---` block
// convention.

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
    // rather than crashing the editor.
  }
  return { data, body: raw.slice(match[0].length) };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yamlText = yaml.dump(data).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}
