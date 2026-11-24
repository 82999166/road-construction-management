import { createRequire } from "node:module";
import { getTableColumns, getTableName, is, type SQL } from "drizzle-orm";
import { MySqlDialect, MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const normalize = (value: any): any => value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value !== null && typeof value === "object" ? JSON.stringify(value) : value ?? null;
const tables: MySqlTable[] = Object.values(schema).filter(table => is(table, MySqlTable));
/** Test-only SQLite schema evaluator. Executes real Drizzle conditions and schema unique indexes;
 * no business DB, network, files or notifications. Queue/FOR UPDATE are fixture-only, not MySQL lock proof. */
export class BusinessDocumentCreationMockDb {
  private sqlite = new DatabaseSync(":memory:");
  private dialect = new MySqlDialect();
  private gate = Promise.resolve();
  failInsertTable?: string;
  failCommit = false;
  committed = false;
  locks: string[] = [];
  beforeSelect?: (table: string) => void;
  constructor() {
    for (const table of tables) {
      const name = getTableName(table);
      this.sqlite.exec(`CREATE TABLE \`${name}\` (${Object.values(getTableColumns(table)).map((col: any) => `\`${col.name}\` ${col.name === "id" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : col.dataType === "number" || col.dataType === "boolean" ? "INTEGER" : "TEXT"}${col.primary && col.name !== "id" ? " PRIMARY KEY" : ""}${col.notNull && col.name !== "id" ? " NOT NULL" : ""}`).join(",")})`);
      const cfg = getTableConfig(table);
      const keys: Array<{ name: string; columns: any[] }> = [];
      for (const col of cfg.columns) if (col.isUnique) keys.push({ name: col.uniqueName!, columns: [col] });
      for (const index of cfg.indexes) if (index.config.unique) keys.push({ name: index.config.name, columns: index.config.columns });
      for (const key of cfg.uniqueConstraints) keys.push({ name: key.getName()!, columns: key.columns });
      for (const key of keys) this.sqlite.exec(`CREATE UNIQUE INDEX \`${name}_${key.name}\` ON \`${name}\` (${key.columns.map(col => `\`${col.name}\``).join(",")})`);
    }
  }
  close() { this.sqlite.close(); }
  rollback(): never { throw new Error("fixture rollback"); }
  seed(table: MySqlTable, rows: any | any[]) { for (const row of Array.isArray(rows) ? rows : [rows]) this.insertRow(table, row); }
  rows(table: MySqlTable): any[] { return this.sqlite.prepare(`SELECT * FROM \`${getTableName(table)}\` ORDER BY rowid`).all().map(row => this.decode(row, getTableColumns(table))); }
  snapshot() { return tables.map(table => [getTableName(table), this.rows(table)]); }
  private decode(row: any, fields: any) { return Object.fromEntries(Object.entries(fields).map(([key, col]: any) => [key, row[key] == null ? null : col.dataType === "date" ? new Date(row[key]) : col.dataType === "boolean" ? Boolean(row[key]) : col.dataType === "json" ? JSON.parse(row[key]) : row[key]])); }
  private insertRow(table: MySqlTable, input: any, ignore = false) {
    const name = getTableName(table);
    if (name === this.failInsertTable) throw new Error(`injected insert failure: ${name}`);
    const defaults = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]: any) => [key, ["createdAt", "updatedAt", "lastSignedIn", "receivedAt"].includes(key) ? new Date("2026-11-24T08:00:00Z") : ["string", "number", "boolean"].includes(typeof col.default) ? col.default : col.defaultFn ? col.defaultFn() : null]));
    const row: any = { ...defaults, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
    if (row.id == null) delete row.id;
    const keys = Object.keys(row);
    return this.sqlite.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO \`${name}\` (${keys.map(key => `\`${key}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(key => normalize(row[key])));
  }
  insert(table: MySqlTable) { return { values: (input: any) => {
    const execute = (ignore: boolean) => { let id = 0, count = 0; for (const row of Array.isArray(input) ? input : [input]) { const r = this.insertRow(table, row, ignore); id ||= Number(r.lastInsertRowid); count += Number(r.changes); } return [{ insertId: id, affectedRows: count }]; };
    return { $returningId: async () => [{ id: execute(false)[0].insertId }], onDuplicateKeyUpdate: async (_patch: any) => execute(true), then: (ok: any, fail: any) => Promise.resolve().then(() => execute(false)).then(ok, fail) };
  } }; }
  update(table: MySqlTable) { return { set: (patch: any) => ({ where: async (condition: SQL) => {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined), query = this.dialect.sqlToQuery(condition);
    const result = this.sqlite.prepare(`UPDATE \`${getTableName(table)}\` SET ${entries.map(([key]) => `\`${key}\`=?`).join(",")} WHERE ${query.sql}`).run(...entries.map(([, value]) => normalize(value)), ...query.params.map(normalize));
    return [{ affectedRows: Number(result.changes) }];
  } }) }; }
  delete(table: MySqlTable) { return { where: async (condition: SQL) => { const query = this.dialect.sqlToQuery(condition); return [{ affectedRows: Number(this.sqlite.prepare(`DELETE FROM \`${getTableName(table)}\` WHERE ${query.sql}`).run(...query.params.map(normalize)).changes) }]; } }; }
  select(projection?: any) { return { from: (table: MySqlTable) => {
    let condition: SQL | undefined, limit: number | undefined;
    const joins: Array<{ table: MySqlTable; condition: SQL; type: string }> = [];
    let ordering: any[] = [];
    const builder: any = {
      where: (sql: SQL) => { condition = sql; return builder; },
      innerJoin: (joined: MySqlTable, on: SQL) => { joins.push({ table: joined, condition: on, type: "INNER" }); return builder; },
      leftJoin: (joined: MySqlTable, on: SQL) => { joins.push({ table: joined, condition: on, type: "LEFT" }); return builder; },
      orderBy: (...columns: any[]) => { ordering = columns; return builder; },
      limit: (n: number) => { limit = n; return builder; },
      for: (mode: string) => { this.locks.push(`${getTableName(table)}:${mode}`); return builder; },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        this.beforeSelect?.(getTableName(table));
        const fields = projection ?? getTableColumns(table), params: any[] = [];
        const part = (value: any) => { const q = this.dialect.sqlToQuery(value.getSQL ? value.getSQL() : value); params.push(...q.params.map(normalize)); return q.sql; };
        let query = `SELECT ${Object.entries(fields).map(([key, col]) => `${part(col)} AS \`${key}\``).join(",")} FROM \`${getTableName(table)}\``;
        for (const join of joins) query += ` ${join.type} JOIN \`${getTableName(join.table)}\` ON ${part(join.condition)}`;
        if (condition) query += ` WHERE ${part(condition)}`;
        if (ordering.length) query += ` ORDER BY ${ordering.map(part).join(",")}`;
        if (limit !== undefined) query += ` LIMIT ${limit}`;
        return this.sqlite.prepare(query).all(...params).map(row => this.decode(row, fields));
      }).then(resolve, reject),
    };
    return builder;
  } }; }
  async transaction<T>(fn: (tx: BusinessDocumentCreationMockDb) => Promise<T>) {
    const previous = this.gate; let release!: () => void; this.gate = new Promise<void>(resolve => { release = resolve; }); await previous;
    this.sqlite.exec("BEGIN"); this.committed = false;
    try { const result = await fn(this); if (this.failCommit) throw new Error("fixture commit failure"); this.sqlite.exec("COMMIT"); this.committed = true; return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
    finally { release(); }
  }
}
