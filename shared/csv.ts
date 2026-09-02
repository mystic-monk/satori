// A pragmatic RFC4180-ish CSV parser, hand-rolled — same house style as
// shared/bibtex.ts's scanner (pure function, no dependency) rather than
// pulling in a parsing library for a well-known, boundable format. Handles
// quoted fields (embedded commas/newlines), escaped `""` quotes, and
// CRLF/LF line endings. Does not handle bare unescaped quotes mid-field
// (not valid CSV to begin with) or delimiters other than comma.

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++; // normalized away; a bare \r inside a quoted field is handled above, not here
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  // A trailing blank line (the common "file ends with a newline" artifact)
  // parses as one row containing a single empty field — drop any such
  // trailing rows rather than surfacing them as spurious empty records.
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

// First row is the header. A data row with fewer fields than the header
// gets "" for the missing ones; extra fields beyond the header's length
// are silently dropped — never throws on a ragged file.
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = row[i] ?? "";
    });
    return record;
  });
}
