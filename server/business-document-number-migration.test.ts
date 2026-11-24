import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error 独立受控MJS迁移CLI不引入生产TS运行时。
import {
  BUSINESS_DOCUMENT_NUMBER_MIGRATIONS,
  DOCUMENT_NUMBER_TABLES,
  validateBusinessDocumentNumberMigrations,
  applyBusinessDocumentNumberMigrations,
  runBusinessDocumentNumberMigrations,
  parseBusinessDocumentNumberMigrationArguments,
} from "../scripts/apply-business-document-number-migrations.mjs";

const approved = [
  { file: "0099_business_document_number.sql", sha256: "94c6819cf6aaa294280ae1431c2d718f6662659f175a61b3e015162f7ffeb6e9" },
  { file: "0100_watery_wong.sql", sha256: "f2ba1ea71a81411272f9f8a0c57305b17256bc172d1ff07adb58149563b4fc22" },
];
const sources = approved.map(spec => ({ file: spec.file, expectedSha: spec.sha256,
  bytes: readFileSync(new URL(`../drizzle/${spec.file}`, import.meta.url)) }));
const allStatements = sources.flatMap(source => source.bytes.toString().split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean));
const documentTables = ["asset_maintenance_records", "construction_daily_reports", "employee_payroll_advances",
  "machine_cost_records", "machine_daily_operations", "machine_monthly_statements", "payroll_statements",
  "settlement_payment_records", "temporary_daily_wage_settlements"];
const databaseName = "controlled_mock_only";
type Row = Record<string, any>;
type Shape = { table: Row; columns: Row[]; indexes: Row[] };
function scope(table: string) { return { TABLE_SCHEMA: databaseName, TABLE_NAME: table }; }
function col(table: string, name: string, type: string, position: number, nullable = false, def: any = null, extra = ""): Row {
  return { ...scope(table), COLUMN_NAME: name, COLUMN_TYPE: type, DATA_TYPE: type.replace(/\(.*/, ""),
    IS_NULLABLE: nullable ? "YES" : "NO", COLUMN_DEFAULT: def, EXTRA: extra,
    GENERATION_EXPRESSION: "", ORDINAL_POSITION: position };
}
function idx(table: string, name: string, columns: string[]): Row[] {
  return columns.map((columnName, i) => ({ ...scope(table), INDEX_NAME: name, NON_UNIQUE: 0,
    SEQ_IN_INDEX: i + 1, COLUMN_NAME: columnName, SUB_PART: null, INDEX_TYPE: "BTREE",
    EXPRESSION: null, IS_VISIBLE: "YES", COLLATION: "A" }));
}
function emptyTable(table: string): Shape { return {
  table: { ...scope(table), TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB" }, columns: [], indexes: [],
}; }
function newTable(table: string): Shape {
  const shape = emptyTable(table);
  const timestamp = (name: string, position: number, updated = false) => col(table, name, "timestamp", position, false,
    "CURRENT_TIMESTAMP", updated ? "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" : "DEFAULT_GENERATED");
  if (table === "business_document_number_allocations") {
    shape.columns = [col(table, "requestHash", "varchar(64)", 1), col(table, "moduleCode", "varchar(2)", 2),
      col(table, "actorKey", "varchar(16)", 3), col(table, "scopeHash", "varchar(64)", 4),
      col(table, "number", "varchar(36)", 5, true), col(table, "prefix", "varchar(32)", 6, true),
      col(table, "sequence", "int", 7, true), timestamp("createdAt", 8)];
    shape.indexes = [...idx(table, "PRIMARY", ["requestHash"]), ...idx(table, "business_document_number_unique", ["number"]),
      ...idx(table, "business_document_prefix_sequence_unique", ["prefix", "sequence"])];
  } else if (table === "business_document_number_counters") {
    shape.columns = [col(table, "prefix", "varchar(32)", 1), col(table, "lastSequence", "int", 2, false, "0"),
      timestamp("createdAt", 3), timestamp("updatedAt", 4, true)];
    shape.indexes = idx(table, "PRIMARY", ["prefix"]);
  } else if (table === "business_document_creation_receipts") {
    shape.columns = [col(table, "requestHash", "varchar(64)", 1), col(table, "inputHash", "varchar(64)", 2),
      col(table, "scope", "varchar(128)", 3), col(table, "actorId", "int", 4),
      col(table, "resultJson", "text", 5, true), timestamp("createdAt", 6)];
    shape.indexes = idx(table, "PRIMARY", ["requestHash"]);
  } else throw new Error("UNKNOWN_MOCK_TABLE");
  return shape;
}
function fakeDb(options: {
  complete?: boolean; lock?: unknown; release?: unknown; releaseThrows?: boolean; unsupportedLock?: boolean;
  version?: string; database?: unknown; failAt?: number; duplicateAt?: number; duplicateNoObject?: boolean;
  corruptAfterDdl?: (shape: Shape) => void;
} = {}) {
  const shapes = new Map<string, Shape>();
  for (const table of [...documentTables, "diesel_refuel_records"]) {
    const shape = emptyTable(table);
    shape.columns = [col(table, "id", "int", 1), col(table, "legacyNo", "varchar(40)", 2, true)];
    shape.indexes = idx(table, "PRIMARY", ["id"]);
    shapes.set(table, shape);
  }
  function materialize(sql: string) {
    const table = sql.match(/(?:CREATE|ALTER) TABLE `([^`]+)`/)![1];
    if (sql.startsWith("CREATE")) { shapes.set(table, newTable(table)); return shapes.get(table)!; }
    const shape = shapes.get(table)!;
    const column = sql.match(/ ADD `([^`]+)` (varchar\(36\)|bigint);$/);
    if (column) shape.columns.push(col(table, column[1], column[2], shape.columns.length + 1, true));
    else {
      const index = sql.match(/ADD CONSTRAINT `([^`]+)` UNIQUE\(`([^`]+)`\);$/)!;
      shape.indexes.push(...idx(table, index[1], [index[2]]));
    }
    return shape;
  }
  if (options.complete) allStatements.forEach(materialize);
  let ddlCount = 0;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === "SELECT DATABASE() AS databaseName, VERSION() AS serverVersion")
      return [[{ databaseName: options.database === undefined ? databaseName : options.database, serverVersion: options.version ?? "8.0.44" }]];
    if (sql.includes("GET_LOCK")) {
      if (options.unsupportedLock) throw new Error("FUNCTION_UNSUPPORTED");
      return [[{ acquired: options.lock === undefined ? 1 : options.lock }]];
    }
    if (sql.includes("RELEASE_LOCK")) {
      if (options.releaseThrows) throw new Error("MOCK_RELEASE_DRIVER_ERROR");
      return [[{ released: options.release === undefined ? 1 : options.release }]];
    }
    if (sql.includes("information_schema.")) {
      expect(params?.[0]).toBe(databaseName);
      const shape = shapes.get(String(params?.[1]));
      if (sql.includes("information_schema.tables")) return [shape ? [structuredClone(shape.table)] : []];
      if (sql.includes("information_schema.columns")) return [structuredClone(shape?.columns ?? [])];
      if (sql.includes("information_schema.statistics")) return [structuredClone(shape?.indexes ?? [])];
    }
    if (sql.startsWith("CREATE") || sql.startsWith("ALTER")) {
      ddlCount++;
      expect(allStatements).toContain(sql);
      if (ddlCount === options.failAt) throw new Error("MOCK_DDL_FAILURE");
      const duplicate = ddlCount === options.duplicateAt;
      if (!duplicate || !options.duplicateNoObject) {
        const shape = materialize(sql);
        options.corruptAfterDdl?.(shape);
      }
      if (duplicate) throw Object.assign(new Error("MOCK_DUPLICATE"), {
        code: sql.startsWith("CREATE") ? "ER_TABLE_EXISTS_ERROR" : sql.includes("ADD CONSTRAINT") ? "ER_DUP_KEYNAME" : "ER_DUP_FIELDNAME",
      });
      return [{}];
    }
    throw new Error("UNEXPECTED_QUERY");
  });
  return { query, shapes, end: vi.fn(async () => undefined) };
}
const ddlCalls = (db: ReturnType<typeof fakeDb>) => db.query.mock.calls.filter(([sql]) => /^(CREATE|ALTER) /.test(sql));
const releaseCalls = (db: ReturnType<typeof fakeDb>) => db.query.mock.calls.filter(([sql]) => sql.includes("RELEASE_LOCK"));
const apply = (db: ReturnType<typeof fakeDb>, options = {}) => applyBusinessDocumentNumberMigrations(db, sources, options);

describe("0099/0100统一业务号严格受控迁移（离线mock，无业务insert）", () => {
  it("实际文件固定SHA与批准集合：3CREATE、9documentNo、1bigint来源列、10unique", () => {
    expect(BUSINESS_DOCUMENT_NUMBER_MIGRATIONS).toEqual(approved);
    expect(DOCUMENT_NUMBER_TABLES).toEqual(documentTables);
    expect(validateBusinessDocumentNumberMigrations(sources)).toEqual(approved);
    sources.forEach((source, i) => expect(createHash("sha256").update(source.bytes).digest("hex")).toBe(approved[i].sha256));
    expect(allStatements).toHaveLength(23);
    expect(allStatements.filter(s => s.startsWith("CREATE"))).toHaveLength(3);
    expect(allStatements.filter(s => s.includes(" ADD `documentNo`"))).toHaveLength(9);
    expect(allStatements.filter(s => s.includes(" ADD `machineCostSourceId` bigint"))).toHaveLength(1);
    expect(allStatements.filter(s => s.includes("ADD CONSTRAINT"))).toHaveLength(10);
    expect(allStatements.every(s => /^(CREATE TABLE|ALTER TABLE .* ADD )/.test(s))).toBe(true);
  });
  it.each([0, 1])("错误caller SHA不能授权文件%d", async i => {
    const modified = sources.map((source, j) => j === i ? { ...source, expectedSha: "0".repeat(64) } : source);
    const db = fakeDb();
    await expect(applyBusinessDocumentNumberMigrations(db, modified)).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each(["UPDATE `users` SET id=1;", "DROP TABLE `users`;", "INSERT INTO `users` VALUES (1);",
    "ALTER TABLE `diesel_refuel_records` ADD `notApproved` int;"])("修改SQL即使自行SHA也不能授权%s", async extra => {
    const bytes = Buffer.from(sources[1].bytes.toString() + extra);
    const modified = [sources[0], { ...sources[1], bytes, expectedSha: createHash("sha256").update(bytes).digest("hex") }];
    const db = fakeDb();
    await expect(applyBusinessDocumentNumberMigrations(db, modified)).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
  });
  it("固定SHA不接受篡改bytes；错文件顺序、非Buffer和缺文件失败", () => {
    expect(() => validateBusinessDocumentNumberMigrations([sources[0], { ...sources[1], bytes: Buffer.from("DROP TABLE users;") }])).toThrow("MIGRATION_SHA_MISMATCH");
    for (const wrong of [[], [sources[1], sources[0]], [sources[0], { ...sources[1], bytes: "text" }]])
      expect(() => validateBusinessDocumentNumberMigrations(wrong)).toThrow("INVALID_MIGRATION_FILES");
  });
  it("首轮只执行批准23条DDL；再次执行精确核验并跳过全部；不读业务行不写journal", async () => {
    const db = fakeDb();
    expect(await apply(db)).toMatchObject({ appliedStatements: 23, skippedStatements: 0, verified: true,
      newTableCount: 3, documentNoColumnCount: 9, sourceLinkColumnCount: 1, historyUnchanged: true, ddlImplicitCommit: true });
    expect(await apply(db)).toMatchObject({ appliedStatements: 0, skippedStatements: 23 });
    expect(ddlCalls(db).map(([sql]) => sql)).toEqual(allStatements);
    expect(releaseCalls(db)).toHaveLength(2);
    for (const [sql] of db.query.mock.calls) {
      expect(sql).not.toMatch(/^(INSERT|UPDATE|DELETE|DROP|BEGIN|COMMIT|ROLLBACK)\b/i);
      expect(sql).not.toContain("__drizzle_migrations");
      if (sql.startsWith("SELECT") && !sql.includes("GET_LOCK") && !sql.includes("RELEASE_LOCK") && !sql.includes("DATABASE()"))
        expect(sql).toContain("information_schema.");
    }
  });
  it("部分完成10条后失败隐式提交不回滚；后续严格核验并继续余下13条", async () => {
    const db = fakeDb({ failAt: 11 });
    await expect(apply(db)).rejects.toThrow("MOCK_DDL_FAILURE");
    expect(releaseCalls(db)).toHaveLength(1);
    expect(db.shapes.has("business_document_creation_receipts")).toBe(true);
    expect(await apply(db)).toMatchObject({ appliedStatements: 13, skippedStatements: 10 });
    expect(releaseCalls(db)).toHaveLength(2);
  });
  it.each([1, 4, 14])("重复table/column/index DDL%d只在精确回读后接受", async duplicateAt => {
    const db = fakeDb({ duplicateAt });
    expect(await apply(db)).toMatchObject({ appliedStatements: 22, skippedStatements: 1 });
  });
  it.each([1, 4, 14])("重复错误但对象实际缺失%d不能吞掉", async duplicateAt => {
    const db = fakeDb({ duplicateAt, duplicateNoObject: true });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(releaseCalls(db)).toHaveLength(1);
  });
  it("重复后对象漂移或DDL成功后未精确回读失败", async () => {
    for (const duplicateAt of [undefined, 1]) {
      const db = fakeDb({ duplicateAt, corruptAfterDdl: shape => { shape.columns[0].COLUMN_DEFAULT = "wrong"; } });
      await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      expect(releaseCalls(db)).toHaveLength(1);
    }
  });
  it.each([
    ["COLUMN_TYPE", "varchar(35)"], ["DATA_TYPE", "text"], ["IS_NULLABLE", "NO"],
    ["COLUMN_DEFAULT", "old-no"], ["EXTRA", "STORED GENERATED"], ["GENERATION_EXPRESSION", "legacyNo"],
    ["TABLE_SCHEMA", "other_database"], ["TABLE_NAME", "other_table"],
  ])("既有documentNo元数据漂移%s=%s整批预检拒绝零DDL", async (key, value) => {
    const db = fakeDb({ complete: true });
    db.shapes.get(documentTables[0])!.columns.at(-1)![key] = value;
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
    expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each(["COLUMN_DEFAULT", "EXTRA", "GENERATION_EXPRESSION"])("列元数据缺%s不能默认为正确形状", async key => {
    const db = fakeDb({ complete: true });
    delete db.shapes.get(documentTables[0])!.columns.at(-1)![key];
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
  });
  it("unique缺关键元数据、重复成员、错误同列索引均严格失败", async () => {
    const mutations = [
      (shape: Shape) => { delete shape.indexes.at(-1)!.SUB_PART; },
      (shape: Shape) => { shape.indexes.at(-1)!.NON_UNIQUE = null; },
      (shape: Shape) => { shape.indexes.push({ ...shape.indexes.at(-1)! }); },
      (shape: Shape) => { shape.indexes.push(...idx(shape.table.TABLE_NAME, "unapproved_same_column", ["documentNo"])); },
    ];
    for (const mutate of mutations) {
      const db = fakeDb({ complete: true }); mutate(db.shapes.get(documentTables[0])!);
      await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      expect(ddlCalls(db)).toHaveLength(0);
    }
  });
  it.each(["int", "bigint unsigned", "bigint(19)"])("来源machineCostSourceId严格bigint不能变为%s", async type => {
    const db = fakeDb({ complete: true });
    db.shapes.get("diesel_refuel_records")!.columns.at(-1)!.COLUMN_TYPE = type;
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
  });
  it.each([
    ["NON_UNIQUE", 1], ["SUB_PART", 10], ["SEQ_IN_INDEX", 2], ["COLUMN_NAME", "legacyNo"],
    ["INDEX_TYPE", "HASH"], ["EXPRESSION", "lower(documentNo)"], ["IS_VISIBLE", "NO"],
  ])("unique索引严格元数据漂移%s失败", async (key, value) => {
    const db = fakeDb({ complete: true });
    db.shapes.get(documentTables[0])!.indexes.at(-1)![key] = value;
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
  });
  it("unique缺失verify-only失败不修复；apply严格核验已有列后只补唯一索引", async () => {
    const db = fakeDb({ complete: true });
    db.shapes.get(documentTables[0])!.indexes.pop();
    await expect(apply(db, { verifyOnly: true })).rejects.toThrow("VERIFY_ONLY_MISSING_OBJECT");
    expect(ddlCalls(db)).toHaveLength(0);
    expect(await apply(db)).toMatchObject({ appliedStatements: 1, skippedStatements: 22 });
    expect(ddlCalls(db)[0][0]).toContain("ADD CONSTRAINT `asset_maintenance_records_documentNo_unique`");
  });
  it("新增表少列/多列/错顺序/多索引/主键或复合unique缺失不能视为已完成", async () => {
    const mutations = [
      (s: Shape) => { s.columns.pop(); },
      (s: Shape) => { s.columns.push(col(s.table.TABLE_NAME, "unapproved", "int", 9)); },
      (s: Shape) => { s.columns[0].ORDINAL_POSITION = 2; },
      (s: Shape) => { s.indexes.push(...idx(s.table.TABLE_NAME, "unapproved", ["requestHash"])); },
      (s: Shape) => { s.indexes.shift(); },
      (s: Shape) => { s.indexes.at(-1)!.COLUMN_NAME = "number"; },
    ];
    for (const mutate of mutations) {
      const db = fakeDb({ complete: true });
      mutate(db.shapes.get("business_document_number_allocations")!);
      await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      expect(ddlCalls(db)).toHaveLength(0);
    }
  });
  it("计数器default/on-update漂移、来源非可空漂移及receipt缺主键均失败", async () => {
    const scenarios: [string, (shape: Shape) => void][] = [
      ["business_document_number_counters", shape => { shape.columns[1].COLUMN_DEFAULT = 1; }],
      ["business_document_number_counters", shape => { shape.columns[3].EXTRA = "DEFAULT_GENERATED"; }],
      ["diesel_refuel_records", shape => { shape.columns.at(-1)!.IS_NULLABLE = "NO"; }],
      ["business_document_creation_receipts", shape => { shape.indexes = []; }],
    ];
    for (const [table, mutate] of scenarios) {
      const db = fakeDb({ complete: true }); mutate(db.shapes.get(table)!);
      await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      expect(ddlCalls(db)).toHaveLength(0);
    }
  });
  it("MySQL8 timestamp默认表达式及int显示宽度仅接受等价元数据", async () => {
    const db = fakeDb({ complete: true });
    for (const shape of db.shapes.values()) for (const column of shape.columns) {
      if (column.COLUMN_TYPE === "int") column.COLUMN_TYPE = "int(11)";
      if (column.COLUMN_TYPE === "bigint") column.COLUMN_TYPE = "bigint(20)";
      if (column.DATA_TYPE === "timestamp") {
        column.COLUMN_DEFAULT = "current_timestamp()";
        column.EXTRA = column.EXTRA.toLowerCase().replace("current_timestamp", "current_timestamp()");
      }
    }
    expect(await apply(db)).toMatchObject({ appliedStatements: 0 });
  });
  it.each(["VIEW", "MyISAM", "wrong-schema", "missing-base"])("基表/schema/engine错误%s拒绝零DDL", async wrong => {
    const db = fakeDb(); const shape = db.shapes.get(documentTables.at(-1)!)!;
    if (wrong === "VIEW") shape.table.TABLE_TYPE = "VIEW";
    if (wrong === "MyISAM") shape.table.ENGINE = "MyISAM";
    if (wrong === "wrong-schema") shape.table.TABLE_SCHEMA = "other";
    if (wrong === "missing-base") db.shapes.delete(documentTables.at(-1)!);
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
    expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each([0, null, "0"])("GET_LOCK失败%j无DDL不释放别人锁", async lock => {
    const db = fakeDb({ lock });
    await expect(apply(db)).rejects.toThrow("MIGRATION_BUSY");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it("GET_LOCK不支持明确失败，无无锁apply后备", async () => {
    const db = fakeDb({ unsupportedLock: true });
    await expect(apply(db)).rejects.toThrow("MIGRATION_LOCK_UNSUPPORTED");
    expect(ddlCalls(db)).toHaveLength(0);
  });
  it("锁string1可接受；释放0/抛错均失败；原错误及释放错误同时保留", async () => {
    expect(await apply(fakeDb({ complete: true, lock: "1", release: "1" }))).toMatchObject({ lockUsed: true });
    await expect(apply(fakeDb({ complete: true, release: 0 }))).rejects.toThrow("MIGRATION_LOCK_RELEASE_FAILED");
    await expect(apply(fakeDb({ complete: true, releaseThrows: true }))).rejects.toThrow("MOCK_RELEASE_DRIVER_ERROR");
    const failure = await apply(fakeDb({ failAt: 1, release: 0 })).catch((error: AggregateError) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe("MIGRATION_AND_LOCK_RELEASE_FAILED");
    expect(failure.errors.map((e: Error) => e.message)).toEqual(["MOCK_DDL_FAILURE", "MIGRATION_LOCK_RELEASE_FAILED"]);
  });
  it("verify-only完整结构零DDL但MySQL仍GET_LOCK+release", async () => {
    const db = fakeDb({ complete: true });
    expect(await apply(db, { verifyOnly: true })).toMatchObject({ verified: true, verifyOnly: true, appliedStatements: 0, lockUsed: true });
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each(["table", "column", "index"])("verify-only缺%s失败不能声称成功不自动DDL", async missing => {
    const db = fakeDb({ complete: true });
    if (missing === "table") db.shapes.delete("business_document_creation_receipts");
    if (missing === "column") { db.shapes.get(documentTables[0])!.columns.pop(); db.shapes.get(documentTables[0])!.indexes.pop(); }
    if (missing === "index") db.shapes.get("diesel_refuel_records")!.indexes.pop();
    await expect(apply(db, { verifyOnly: true })).rejects.toThrow("VERIFY_ONLY_MISSING_OBJECT");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(1);
  });
  it("TiDB仅显式verify-only可不锁，不能用作生产DDL绕锁路径", async () => {
    const db = fakeDb({ complete: true, version: "8.0.11-TiDB-v8.5.0" });
    expect(await apply(db, { dialect: "tidb", verifyOnly: true })).toMatchObject({ lockUsed: false, appliedStatements: 0 });
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
    await expect(apply(db, { dialect: "tidb" })).rejects.toThrow("INVALID_CONFIGURATION");
    await expect(apply(db)).rejects.toThrow("UNSUPPORTED_DATABASE_DIALECT");
  });
  it.each(["5.7.44", "10.11.1-MariaDB", "8.0.11-TiDB-v8.5.0"])("默认拒绝非正式MySQL8方言%s", async version => {
    const db = fakeDb({ version }); await expect(apply(db)).rejects.toThrow("UNSUPPORTED_DATABASE_DIALECT");
    expect(ddlCalls(db)).toHaveLength(0);
  });
  it("当前db必须真实非空上下文，无数据库配置拒绝", async () => {
    await expect(apply(fakeDb({ database: null }))).rejects.toThrow("DATABASE_NOT_CONFIGURED");
    await expect(apply(fakeDb({ database: "" }))).rejects.toThrow("DATABASE_NOT_CONFIGURED");
  });
  it("run可注入读取/连接，连接前拒绝unexpectedsha与篡改SQL，成功失败均end", async () => {
    const createConnection = vi.fn();
    const readFile = vi.fn(async (file: string) => sources.find(source => file.endsWith(source.file))!.bytes);
    const options = { databaseUrl: "mysql://synthetic-mock-only", readFile, createConnection };
    await expect(runBusinessDocumentNumberMigrations("offline-drizzle", { ...options, expectedShas: ["0".repeat(64), approved[1].sha256] })).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    await expect(runBusinessDocumentNumberMigrations("offline-drizzle", { ...options, readFile: vi.fn(async () => Buffer.from("UPDATE users SET id=1;")) })).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(createConnection).not.toHaveBeenCalled();
    const good = fakeDb({ complete: true }); createConnection.mockResolvedValueOnce(good);
    expect(await runBusinessDocumentNumberMigrations("offline-drizzle", { ...options, verifyOnly: true })).toMatchObject({ verified: true });
    expect(good.end).toHaveBeenCalledTimes(1);
    const bad = fakeDb({ failAt: 1 }); createConnection.mockResolvedValueOnce(bad);
    await expect(runBusinessDocumentNumberMigrations("offline-drizzle", options)).rejects.toThrow("MOCK_DDL_FAILURE");
    expect(bad.end).toHaveBeenCalledTimes(1);
    const closeFail = fakeDb({ failAt: 1 }); closeFail.end.mockRejectedValueOnce(new Error("MOCK_CLOSE_FAILURE")); createConnection.mockResolvedValueOnce(closeFail);
    await expect(runBusinessDocumentNumberMigrations("offline-drizzle", options)).rejects.toThrow("MIGRATION_AND_CONNECTION_CLOSE_FAILED");
  });
  it("CLI解析只允许固定目录和verify/dialect，不允许自准SHA或无锁TiDB apply", () => {
    expect(parseBusinessDocumentNumberMigrationArguments(["drizzle"])).toEqual({ directory: "drizzle", verifyOnly: false, dialect: "mysql8" });
    expect(parseBusinessDocumentNumberMigrationArguments(["drizzle", "--verify-only", "--dialect=tidb"])).toEqual({ directory: "drizzle", verifyOnly: true, dialect: "tidb" });
    for (const args of [[], ["drizzle", "--dialect=tidb"], ["drizzle", "--expected-sha=anything"],
      ["drizzle", "--no-lock"], ["drizzle", "--verify-only", "--verify-only"], ["drizzle", "--dialect=postgres"], ["a", "b"]])
      expect(() => parseBusinessDocumentNumberMigrationArguments(args)).toThrow("INVALID_CONFIGURATION");
  });
});
