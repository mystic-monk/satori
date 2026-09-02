import { describe, it, expect } from "vitest";
import { parseDataDictionary } from "./dataDictionary";

describe("parseDataDictionary", () => {
  it("groups column rows into one record per table, in first-appearance order", () => {
    const csv = `table,column\ncustomers,id\ncustomers,email\norders,id`;
    const tables = parseDataDictionary(csv);
    expect(tables.map((t) => t.tableName)).toEqual(["customers", "orders"]);
    expect(tables[0].columns.map((c) => c.name)).toEqual(["id", "email"]);
    expect(tables[1].columns.map((c) => c.name)).toEqual(["id"]);
  });

  it("parses type/description straight through", () => {
    const csv = `table,column,type,description\ncustomers,id,INT,Primary identifier`;
    const [table] = parseDataDictionary(csv);
    expect(table.columns[0]).toMatchObject({ name: "id", type: "INT", description: "Primary identifier" });
  });

  it("coerces nullable/primary_key from yes/no-style strings to booleans", () => {
    const csv = `table,column,nullable,primary_key\ncustomers,id,no,yes\ncustomers,email,true,0`;
    const [table] = parseDataDictionary(csv);
    expect(table.columns[0]).toMatchObject({ nullable: false, primaryKey: true });
    expect(table.columns[1]).toMatchObject({ nullable: true, primaryKey: false });
  });

  it("leaves nullable/primary_key undefined for blank or unrecognized values", () => {
    const csv = `table,column,nullable\ncustomers,id,\ncustomers,email,maybe`;
    const [table] = parseDataDictionary(csv);
    expect(table.columns[0].nullable).toBeUndefined();
    expect(table.columns[1].nullable).toBeUndefined();
  });

  it("captures a foreign-key column's references_table/references_column", () => {
    const csv = `table,column,references_table,references_column\norders,customer_id,customers,id`;
    const [table] = parseDataDictionary(csv);
    expect(table.columns[0]).toMatchObject({ referencesTable: "customers", referencesColumn: "id" });
  });

  it("passes unrecognized CSV headers through into extra", () => {
    const csv = `table,column,owner,pii\ncustomers,email,analytics-team,true`;
    const [table] = parseDataDictionary(csv);
    expect(table.columns[0].extra).toEqual({ owner: "analytics-team", pii: "true" });
  });

  it("skips rows missing table or column rather than throwing", () => {
    const csv = `table,column\ncustomers,id\n,email\norders,`;
    const tables = parseDataDictionary(csv);
    expect(tables).toHaveLength(1);
    expect(tables[0].columns).toHaveLength(1);
  });

  it("returns an empty array for empty input", () => {
    expect(parseDataDictionary("")).toEqual([]);
  });
});
