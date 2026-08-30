// A pragmatic BibTeX parser, not a full-spec one — deliberate scope cuts:
// no @string macro resolution, no crossref resolution (kept as a plain
// field, not followed), and quoted values don't support backslash-escaped
// quotes. Covers what an actual Zotero/BibTeX export looks like in
// practice, which is what this exists to import.

export interface BibEntry {
  citekey: string;
  entryType: string;
  fields: Record<string, string>;
}

export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let i = 0;
  const n = text.length;

  function skipWhitespace() {
    while (i < n && /\s/.test(text[i])) i++;
  }

  function readBraced(): string {
    let depth = 0;
    const start = i;
    do {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    } while (i < n && depth > 0);
    return text.slice(start + 1, Math.max(start + 1, i - 1));
  }

  function readQuoted(): string {
    i++; // opening quote
    const start = i;
    while (i < n && text[i] !== '"') i++;
    const value = text.slice(start, i);
    i++; // closing quote
    return value;
  }

  function readBare(): string {
    const start = i;
    while (i < n && !/[,}\s]/.test(text[i])) i++;
    return text.slice(start, i);
  }

  function readValue(): string {
    skipWhitespace();
    if (text[i] === "{") return readBraced().trim();
    if (text[i] === '"') return readQuoted().trim();
    return readBare().trim();
  }

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    i = at + 1;
    const typeStart = i;
    while (i < n && /[a-zA-Z]/.test(text[i])) i++;
    const entryType = text.slice(typeStart, i).toLowerCase();
    skipWhitespace();
    if (text[i] !== "{" && text[i] !== "(") continue; // not a real entry opener — keep scanning past it
    const closer = text[i] === "{" ? "}" : ")";
    i++; // consume opener

    if (entryType === "string" || entryType === "comment" || entryType === "preamble" || !entryType) {
      let depth = 1;
      while (i < n && depth > 0) {
        if (text[i] === "{" || text[i] === "(") depth++;
        else if (text[i] === "}" || text[i] === ")") depth--;
        i++;
      }
      continue;
    }

    skipWhitespace();
    const keyStart = i;
    while (i < n && text[i] !== "," && text[i] !== closer && !/\s/.test(text[i])) i++;
    const citekey = text.slice(keyStart, i);
    skipWhitespace();

    const fields: Record<string, string> = {};
    while (i < n) {
      skipWhitespace();
      if (text[i] === closer) {
        i++;
        break;
      }
      if (text[i] === ",") {
        i++;
        continue;
      }
      const fieldNameStart = i;
      while (i < n && text[i] !== "=" && !/\s/.test(text[i])) i++;
      const fieldName = text.slice(fieldNameStart, i).toLowerCase();
      skipWhitespace();
      if (text[i] !== "=") break; // malformed field — bail on the rest of this entry rather than looping forever
      i++; // consume '='
      const value = readValue();
      if (fieldName) fields[fieldName] = value;
      skipWhitespace();
    }

    if (citekey) entries.push({ citekey, entryType, fields });
  }

  return entries;
}
