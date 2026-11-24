import { createRequire } from "node:module";
import { getTableColumns, getTableName, is, type SQL } from "drizzle-orm";
import { MySqlDialect, MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const normalize = (value: any): any => value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value ?? null;
const tables: MySqlTable[] = Object.values(schema).filter(table => is(table, MySqlTable));
const fixedTime = new Date("2026-11-24T08:00:00Z");

/** Test-only schema-created SQLite :memory: evaluator. Actual Drizzle WHERE/JOIN predicates run;
 * transactions queue and rollback atomically. FOR UPDATE is recorded, not claimed to be MySQL locks.
 * No DB URL/files/network/notifications are used. All tables are disposable fixture data.
 */
export class ProjectPermissionsMockDb {
  private sqlite = new DatabaseSync(":memory:");
  private dialect = new MySqlDialect();
  private gate = Promise.resolve();
  failInsertTable?: string;
  zeroUpdateTable?: string;
  locks: string[] = [];
  beforeSelect?: (table: string) => void;
  constructor() {
    for (const table of tables) {
      this.sqlite.exec(`CREATE TABLE \`${getTableName(table)}\` (${Object.values(getTableColumns(table)).map((col: any) => `\`${col.name}\` ${col.name === "id" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : col.dataType === "number" || col.dataType === "boolean" ? "INTEGER" : "TEXT"}`).join(",")})`);
    }
    this.sqlite.exec("CREATE UNIQUE INDEX fixture_project_scope ON department_business_scopes(projectId,module); CREATE UNIQUE INDEX fixture_organization_scope ON department_business_scopes(organizationId,module)");
  }
  close() { this.sqlite.close(); }
  seed(table: MySqlTable, rows: any | any[]) { for (const row of Array.isArray(rows) ? rows : [rows]) this.insertRow(table, row); }
  rows(table: MySqlTable): any[] { return this.sqlite.prepare(`SELECT * FROM \`${getTableName(table)}\` ORDER BY rowid`).all().map(row => this.decode(row, getTableColumns(table))); }
  snapshot() { return tables.map(table => [getTableName(table), this.rows(table)]); }
  private decode(row: any, fields: any) { return Object.fromEntries(Object.entries(fields).map(([key, col]: any) => [key, row[key] == null ? null : col.dataType === "date" ? new Date(row[key]) : col.dataType === "boolean" ? Boolean(row[key]) : row[key]])); }
  private insertRow(table: MySqlTable, input: any) {
    const name = getTableName(table);
    if (name === this.failInsertTable) throw new Error(`injected insert failure: ${name}`);
    const defaults = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]: any) => [key, ["createdAt", "updatedAt", "lastSignedIn"].includes(key) ? fixedTime : ["string", "number", "boolean"].includes(typeof col.default) ? col.default : null]));
    const row: any = { ...defaults, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
    if (row.id == null) delete row.id;
    const keys = Object.keys(row);
    return this.sqlite.prepare(`INSERT INTO \`${name}\` (${keys.map(key => `\`${key}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(key => normalize(row[key])));
  }
  insert(table: MySqlTable) { return { values: async (input: any) => { let id = 0; for (const row of Array.isArray(input) ? input : [input]) id ||= Number(this.insertRow(table, row).lastInsertRowid); return [{ insertId: id }]; } }; }
  update(table: MySqlTable) { return { set: (patch: any) => ({ where: async (condition: SQL) => {
    if (this.zeroUpdateTable === getTableName(table)) return [{ affectedRows: 0 }];
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
  async transaction<T>(fn: (tx: ProjectPermissionsMockDb) => Promise<T>) {
    const previous = this.gate; let release!: () => void; this.gate = new Promise<void>(resolve => { release = resolve; }); await previous;
    this.sqlite.exec("BEGIN");
    try { const result = await fn(this); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
    finally { release(); }
  }
}
