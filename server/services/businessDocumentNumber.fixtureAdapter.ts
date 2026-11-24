import { getTableName } from "drizzle-orm";
import { BusinessDocumentCreationMockDb } from "./businessDocumentCreation.mockDb";
/** Test-only bridge for legacy business fixtures which do not know newly added metadata tables.
 * The real production allocator executes its upserts/current reads/CAS against the strict
 * schema-created SQLite metadata fixture. Business fixture and metadata share rollback boundaries;
 * no numbered service or constraint is mocked/skipped. */
const adapted = new WeakMap<object, any>();
export function withNumberingFixture<T extends object>(database: T): T {
  const cached = adapted.get(database);
  if (cached) return cached;
  const metadata = new BusinessDocumentCreationMockDb();
  const isMetadata = (table: any) => getTableName(table).startsWith("business_document_");
  let proxy: any;
  proxy = new Proxy(database as any, { get(target, key) {
    if (key === "rollback") return () => { throw new Error("fixture rollback"); };
    if (key === "transaction") return async (fn: any) => {
      const transact = target.transaction ? (callback: any) => target.transaction(callback) : async (callback: any) => callback(target);
      return metadata.transaction(async () => transact(async () => fn(proxy)));
    };
    if (["insert", "update", "delete"].includes(String(key))) return (table: any) => isMetadata(table) ? (metadata as any)[key](table) : target[key](table);
    if (key === "select") return (...args: any[]) => ({ from: (table: any) => isMetadata(table) ? metadata.select(...args).from(table) : target.select(...args).from(table) });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  adapted.set(database, proxy);
  return proxy;
}
