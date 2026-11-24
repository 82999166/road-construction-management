import { drizzle } from "drizzle-orm/mysql2";
import type { BusinessDocumentNumberDatabase } from "./businessDocumentNumber";

/** 只验证真实Drizzle SQL/事务API；全事务串行模拟，不声称代替真实MySQL行锁验收。 */
export function createBusinessDocumentNumberMockDatabase() {
  type Row = Record<string, unknown>;
  const storage = {
    allocations: new Map<string, Row>(),
    counters: new Map<string, Row>(),
  };
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let queue = Promise.resolve();
  function makeDatabase(): BusinessDocumentNumberDatabase {
    let release: (() => void) | undefined;
    let snapshot: typeof storage | undefined;
    const client = {
      async query(query: { sql: string; rowsAsArray?: boolean }, params: unknown[]) {
        const sql = query.sql;
        statements.push({ sql, params: [...params] });
        if (sql === "begin") {
          const previous = queue;
          queue = new Promise<void>(resolve => { release = resolve; });
          await previous;
          snapshot = {
            allocations: new Map(Array.from(storage.allocations, ([key, row]) => [key, { ...row }])),
            counters: new Map(Array.from(storage.counters, ([key, row]) => [key, { ...row }])),
          };
          return [{ affectedRows: 0 }, []];
        }
        if (sql === "commit" || sql === "rollback") {
          if (!snapshot || !release) throw new Error("mock transaction missing");
          if (sql === "rollback") {
            storage.allocations = snapshot.allocations;
            storage.counters = snapshot.counters;
          }
          snapshot = undefined;
          release();
          release = undefined;
          return [{ affectedRows: 0 }, []];
        }
        if (!snapshot) throw new Error("mock refuses non-transactional write/read");
        const table = sql.includes("`business_document_number_allocations`") ? "allocations" :
          sql.includes("`business_document_number_counters`") ? "counters" : null;
        if (!table) throw new Error(`Unexpected SQL in offline numbering test: ${sql}`);
        const rows = storage[table];
        const primaryKey = table === "allocations" ? "requestHash" : "prefix";
        if (sql.startsWith("insert ")) {
          if (!sql.includes("on duplicate key update")) throw new Error("mock requires durable upsert lock");
          const columns = sql.match(/^insert into `[^`]+` \((.*?)\) values/)![1].split(", ").map(c => c.replaceAll("`", ""));
          const slots = sql.match(/ values \((.*?)\) on duplicate/)![1].split(", ");
          let offset = 0;
          const row: Row = Object.fromEntries(columns.map((column, i) => [column, slots[i] === "?" ? params[offset++] : null]));
          row.createdAt = "2026-11-24 17:05:09";
          row.updatedAt = "2026-11-24 17:05:09";
          const key = String(row[primaryKey]);
          if (!rows.has(key)) rows.set(key, row);
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith("select ")) {
          if (!sql.endsWith("for update")) throw new Error("mock requires current locking read");
          const row = rows.get(String(params[0]));
          const columns = sql.match(/^select (.*?) from/)![1].split(", ").map(column => column.match(/`([^`]+)`$/)![1]);
          return [row ? [columns.map(column => row[column])] : [], []];
        }
        if (sql.startsWith("update ")) {
          const setColumns = sql.match(/ set (.*?) where/)![1].split(", ").map(column => column.match(/^`([^`]+)`/)![1]);
          const setSlots = sql.match(/ set (.*?) where/)![1].split(", ");
          let offset = 0;
          const patch = Object.fromEntries(setColumns.map((column, i) => [column, setSlots[i].includes("?") ? params[offset++] : "2026-11-24 17:05:09"]));
          const key = String(params[offset++]);
          const row = rows.get(key);
          if (!row || table === "counters" && row.lastSequence !== params[offset]) return [{ affectedRows: 0 }, []];
          if (table === "allocations") {
            if (Array.from(rows.values()).some(other => other !== row && other.number !== null && other.number === patch.number)) {
              throw new Error("duplicate business_document_number_unique");
            }
          }
          Object.assign(row, patch);
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected SQL in offline numbering test: ${sql}`);
      },
    };
    return drizzle(client as never) as BusinessDocumentNumberDatabase;
  }
  return { storage, statements, makeDatabase };
}
