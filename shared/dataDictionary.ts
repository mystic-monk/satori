// Groups a data-dictionary CSV's column-grain rows (one row per column,
// the natural shape a schema export comes in) into one record per table —
// what gets turned into one note per table on import (see App.tsx's
// processDataDictionaryImport). Same overall shape as shared/bibtex.ts's
// BibEntry: a small set of recognized fields plus an `extra` bag for
// anything else the source file carries, rather than a fixed whitelist.
import { parseCsv } from "./csv";

export interface DbColumn {
  name: string;
  type?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  referencesTable?: string;
  referencesColumn?: string;
  description?: string;
  extra: Record<string, string>;
}

export interface DbTable {
  tableName: string;
  columns: DbColumn[];
}

const KNOWN_KEYS = new Set([
  "table",
  "column",
  "type",
  "nullable",
  "primary_key",
  "references_table",
  "references_column",
  "description",
]);

function toBool(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1" || s === "y") return true;
  if (s === "no" || s === "false" || s === "0" || s === "n") return false;
  return undefined;
}

// Rows missing `table` or `column` are skipped rather than surfaced as a
// malformed table/column — same "be forgiving of a messy real-world
// export" posture as the .bib importer.
export function parseDataDictionary(csvText: string): DbTable[] {
  const rows = parseCsv(csvText);
  const byTable = new Map<string, DbTable>();
  const order: string[] = [];

  for (const row of rows) {
    const tableName = (row.table ?? "").trim();
    const columnName = (row.column ?? "").trim();
    if (!tableName || !columnName) continue;

    if (!byTable.has(tableName)) {
      byTable.set(tableName, { tableName, columns: [] });
      order.push(tableName);
    }

    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!KNOWN_KEYS.has(key)) extra[key] = value;
    }

    byTable.get(tableName)!.columns.push({
      name: columnName,
      type: row.type || undefined,
      nullable: toBool(row.nullable),
      primaryKey: toBool(row.primary_key),
      referencesTable: row.references_table || undefined,
      referencesColumn: row.references_column || undefined,
      description: row.description || undefined,
      extra,
    });
  }

  return order.map((name) => byTable.get(name)!);
}
