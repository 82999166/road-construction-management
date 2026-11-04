import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  auditLogs,
  departmentBusinessScopes,
  organizations,
  projects,
  rolePermissions,
  systemPermissions,
  systemRoles,
  userPermissions,
  userProfiles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const tables = [
  users,
  userProfiles,
  systemRoles,
  systemPermissions,
  organizations,
  projects,
  userRoleAssignments,
  userPermissions,
  rolePermissions,
  departmentBusinessScopes,
  auditLogs,
];
const fixedTime = new Date("2026-11-04T12:00:00Z");
const normalize = (value: any): any =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "boolean"
      ? Number(value)
      : (value ?? null);

/** Test-only in-memory SQL store. Executes real AND/OR/date/join/scope predicates;
 * records FOR UPDATE, serializes transactions like the target-row mutex, and rolls back writes.
 * It never opens DATABASE_URL and is not a substitute for a real MySQL engine lock test. */
export class AdministratorMockDb {
  private sqlite = new DatabaseSync(":memory:");
  private dialect = new MySqlDialect();
  private gate = Promise.resolve();
  failInsertTable?: string;
  forceDuplicateUser = false;
  locks: string[] = [];
  constructor() {
    for (const table of tables) {
      const columns = Object.values(getTableColumns(table));
      this.sqlite.exec(
        `CREATE TABLE \`${getTableName(table)}\` (${columns.map((col: any) => `\`${col.name}\` ${col.name === "id" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : col.dataType === "number" || col.dataType === "boolean" ? "INTEGER" : "TEXT"}`).join(", ")})`
      );
    }
    this.sqlite.exec(
      "CREATE UNIQUE INDEX mock_user_phone ON users(localUsername); CREATE UNIQUE INDEX mock_user_openid ON users(openId); CREATE UNIQUE INDEX mock_profile_user ON user_profiles(userId); CREATE UNIQUE INDEX mock_permission ON user_permissions(userId,permissionId)"
    );
  }
  close() {
    this.sqlite.close();
  }
  seed(table: any, values: any | any[]) {
    for (const row of Array.isArray(values) ? values : [values])
      this.insertRow(table, row);
  }
  rows(table: any): any[] {
    return this.sqlite
      .prepare(`SELECT * FROM \`${getTableName(table)}\` ORDER BY id`)
      .all()
      .map((row: any) => this.decode(row, getTableColumns(table)));
  }
  snapshot() {
    return tables.map(table => [getTableName(table), this.rows(table)]);
  }
  private decode(row: any, fields: any) {
    return Object.fromEntries(
      Object.entries(fields).map(([key, col]: any) => [
        key,
        row[key] == null
          ? null
          : col.dataType === "date"
            ? new Date(row[key])
            : col.dataType === "boolean"
              ? Boolean(row[key])
              : row[key],
      ])
    );
  }
  private insertRow(table: any, input: any) {
    const name = getTableName(table);
    if (name === this.failInsertTable)
      throw new Error(`injected insert failure: ${name}`);
    if (name === "users" && this.forceDuplicateUser)
      throw { code: "ER_DUP_ENTRY", errno: 1062 };
    const defaults = Object.fromEntries(
      Object.entries(getTableColumns(table)).map(([key, col]: any) => [
        key,
        ["createdAt", "updatedAt", "lastSignedIn"].includes(key)
          ? fixedTime
          : ["string", "number", "boolean"].includes(typeof col.default)
            ? col.default
            : null,
      ])
    );
    const row = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined)
      ),
    };
    if (row.id == null) delete row.id;
    const keys = Object.keys(row);
    try {
      return this.sqlite
        .prepare(
          `INSERT INTO \`${name}\` (${keys.map(key => `\`${key}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`
        )
        .run(...keys.map(key => normalize(row[key])));
    } catch (error: any) {
      if (String(error.message).includes("UNIQUE constraint failed"))
        throw { code: "ER_DUP_ENTRY", errno: 1062 };
      throw error;
    }
  }
  insert(table: any) {
    return {
      values: async (input: any) => {
        let first = 0;
        for (const row of Array.isArray(input) ? input : [input])
          first ||= Number(this.insertRow(table, row).lastInsertRowid);
        return [{ insertId: first }];
      },
    };
  }
  update(table: any) {
    return {
      set: (patch: any) => ({
        where: async (condition: SQL) => {
          const entries = Object.entries(patch).filter(
            ([, value]) => value !== undefined
          );
          const query = this.dialect.sqlToQuery(condition);
          const result = this.sqlite
            .prepare(
              `UPDATE \`${getTableName(table)}\` SET ${entries.map(([key]) => `\`${key}\`=?`).join(",")} WHERE ${query.sql}`
            )
            .run(
              ...entries.map(([, value]) => normalize(value)),
              ...query.params.map(normalize)
            );
          return [{ affectedRows: result.changes }];
        },
      }),
    };
  }
  delete(table: any) {
    return {
      where: async (condition: SQL) => {
        const query = this.dialect.sqlToQuery(condition);
        return [
          {
            affectedRows: this.sqlite
              .prepare(
                `DELETE FROM \`${getTableName(table)}\` WHERE ${query.sql}`
              )
              .run(...query.params.map(normalize)).changes,
          },
        ];
      },
    };
  }
  select(projection?: any) {
    return {
      from: (table: any) => {
        let condition: SQL | undefined, limit: number | undefined;
        const joins: Array<{ table: any; condition: SQL; type: string }> = [];
        let ordering: any[] = [];
        const builder: any = {
          where: (sql: SQL) => {
            condition = sql;
            return builder;
          },
          innerJoin: (joined: any, on: SQL) => {
            joins.push({ table: joined, condition: on, type: "INNER" });
            return builder;
          },
          leftJoin: (joined: any, on: SQL) => {
            joins.push({ table: joined, condition: on, type: "LEFT" });
            return builder;
          },
          orderBy: (...columns: any[]) => {
            ordering = columns;
            return builder;
          },
          limit: (n: number) => {
            limit = n;
            return builder;
          },
          for: (mode: string) => {
            this.locks.push(`${getTableName(table)}:${mode}`);
            return builder;
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve()
              .then(() => {
                const fields = projection ?? getTableColumns(table);
                const params: any[] = [];
                const sqlPart = (part: any) => {
                  const compiled = this.dialect.sqlToQuery(
                    part.getSQL ? part.getSQL() : part
                  );
                  params.push(...compiled.params.map(normalize));
                  return compiled.sql;
                };
                const selected = Object.entries(fields)
                  .map(([key, col]: any) => `${sqlPart(col)} AS \`${key}\``)
                  .join(",");
                let sql = `SELECT ${selected} FROM \`${getTableName(table)}\``;
                for (const join of joins)
                  sql += ` ${join.type} JOIN \`${getTableName(join.table)}\` ON ${sqlPart(join.condition)}`;
                if (condition) sql += ` WHERE ${sqlPart(condition)}`;
                if (ordering.length)
                  sql += ` ORDER BY ${ordering.map(sqlPart).join(",")}`;
                if (limit !== undefined) sql += ` LIMIT ${limit}`;
                return this.sqlite
                  .prepare(sql)
                  .all(...params)
                  .map((row: any) => this.decode(row, fields));
              })
              .then(resolve, reject),
        };
        return builder;
      },
    };
  }
  async transaction<T>(fn: (tx: AdministratorMockDb) => Promise<T>) {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    this.sqlite.exec("BEGIN");
    try {
      const result = await fn(this);
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}
