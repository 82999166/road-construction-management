import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { build } from "esbuild";

// Even an accidental default connection in this suite is blocked; no real MySQL/TiDB calls.
const { forbiddenRealConnection } = vi.hoisted(() => ({
  forbiddenRealConnection: vi.fn(async () => { throw new Error("REAL_DATABASE_CONNECTION_FORBIDDEN_IN_OFFLINE_TEST"); }),
}));
vi.mock("mysql2/promise", () => ({ default: { createConnection: forbiddenRealConnection } }));
// @ts-expect-error Standalone controlled MJS runner intentionally has no production TS declaration.
import { TAKEOFF_DETAILS_MIGRATION, TAKEOFF_DETAILS_MIGRATIONS, TAKEOFF_DETAILS_COLUMNS, TAKEOFF_DETAILS_TABLE, splitTakeoffDetailsMigrationStatements, validateTakeoffDetailsMigration, applyTakeoffDetailsMigration, runTakeoffDetailsMigration, parseTakeoffDetailsMigrationArguments } from "../scripts/apply-takeoff-details-migration.mjs";

const approved = {
  file: "0101_measurement_takeoff_details.sql",
  sha256: "11f630e2290bda2b175f46d08d1b964927c12dd611d48e1a5dc47f2322b4b3c4",
};
const table = "measurement_takeoff_records";
const databaseName = "offline_metadata_simulation_only";
const fields = ["workDescription", "measurementBasis", "measurementRows"];
const types = ["text", "text", "json"];
const source = { file: approved.file, expectedSha: approved.sha256,
  bytes: readFileSync(new URL(`../drizzle/${approved.file}`, import.meta.url)) };
const sources = [source];
// Independently enumerated approved SQL: never generate the simulated dialect from runner output.
const statements = [
  "ALTER TABLE `measurement_takeoff_records` ADD `workDescription` text;",
  "ALTER TABLE `measurement_takeoff_records` ADD `measurementBasis` text;",
  "ALTER TABLE `measurement_takeoff_records` ADD `measurementRows` json;",
];
const CONTEXT_SQL = "SELECT DATABASE() AS databaseName, VERSION() AS serverVersion";
const LOCK_SQL = "SELECT GET_LOCK(?, 30) AS acquired";
const RELEASE_SQL = "SELECT RELEASE_LOCK(?) AS released";
const TABLE_SQL = "SELECT * FROM information_schema.tables WHERE table_schema=? AND table_name=?";
const COLUMN_SQL = "SELECT * FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name IN (?,?,?) ORDER BY ordinal_position";
const lockName = "yx_measurement_takeoff_details_0101";
type Row = Record<string, any>;
function scope() { return { TABLE_SCHEMA: databaseName, TABLE_NAME: table }; }
function column(i: number): Row { return { ...scope(), COLUMN_NAME: fields[i], COLUMN_TYPE: types[i],
  DATA_TYPE: types[i], IS_NULLABLE: "YES", COLUMN_DEFAULT: null, EXTRA: "", GENERATION_EXPRESSION: "", ORDINAL_POSITION: 90 + i }; }
type SimulationOptions = {
  present?: number[]; lock?: unknown; release?: unknown; lockThrows?: boolean; releaseThrows?: boolean;
  lockRows?: Row[]; releaseRows?: Row[]; contextRows?: Row[];
  database?: unknown; version?: unknown; failAt?: number; duplicateAt?: number; duplicateNoColumn?: boolean;
  duplicateCode?: string; duplicateErrno?: number; noMaterialize?: boolean;
  afterDdl?: (columns: Row[], ddlCount: number) => void;
  onColumnRead?: (columns: Row[], columnReadCount: number) => void;
};
function fakeDb(options: SimulationOptions = {}) {
  const tableRows: Row[] = [{ ...scope(), TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB" }];
  const columns = (options.present ?? []).map(column);
  // Deliberately invalid historical shape must never be queried or validated by this runner.
  const oldColumns = [{ COLUMN_NAME: "legacyUntouched", COLUMN_TYPE: "arbitrary_historical_shape" }];
  let ddlCount = 0;
  let columnReadCount = 0;
  let returnedColumns: Row[] | undefined;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === CONTEXT_SQL) {
      expect(params).toBeUndefined();
      return [structuredClone(options.contextRows ?? [{
        databaseName: Object.hasOwn(options, "database") ? options.database : databaseName,
        serverVersion: Object.hasOwn(options, "version") ? options.version : "8.0.44",
      }])];
    }
    if (sql === LOCK_SQL) {
      expect(params).toEqual([lockName]);
      if (options.lockThrows) throw new Error("SIMULATED_LOCK_DRIVER_FAILURE");
      return [structuredClone(options.lockRows ?? [{ acquired: Object.hasOwn(options, "lock") ? options.lock : 1 }])];
    }
    if (sql === RELEASE_SQL) {
      expect(params).toEqual([lockName]);
      if (options.releaseThrows) throw new Error("SIMULATED_RELEASE_DRIVER_FAILURE");
      return [structuredClone(options.releaseRows ?? [{ released: Object.hasOwn(options, "release") ? options.release : 1 }])];
    }
    if (sql === TABLE_SQL) {
      expect(params).toEqual([databaseName, table]);
      return [structuredClone(tableRows)];
    }
    if (sql === COLUMN_SQL) {
      expect(params).toEqual([databaseName, table, ...fields]);
      options.onColumnRead?.(columns, ++columnReadCount);
      // MySQL column_name comparison is case-insensitive: a case drift must be RETURNED, not hidden.
      const filtered = columns.filter(row => fields.some(name => name.toLowerCase() === String(row.COLUMN_NAME).toLowerCase()))
        .sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION));
      return [structuredClone(returnedColumns ?? filtered)];
    }
    const i = statements.indexOf(sql);
    if (i >= 0) {
      expect(params).toBeUndefined();
      ddlCount++;
      if (ddlCount === options.failAt) throw Object.assign(new Error("SIMULATED_DDL_FAILURE"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      const duplicate = ddlCount === options.duplicateAt;
      if (!options.noMaterialize && (!duplicate || !options.duplicateNoColumn)) columns.push(column(i));
      options.afterDdl?.(columns, ddlCount);
      if (duplicate) throw Object.assign(new Error("SIMULATED_DUPLICATE_COLUMN"), {
        code: options.duplicateCode ?? "ER_DUP_FIELDNAME", errno: options.duplicateErrno,
      });
      return [{ affectedRows: 0 }];
    }
    throw new Error("UNEXPECTED_SIMULATED_SQL:" + sql);
  });
  return { query, columns, oldColumns, tableRows, options,
    setReturnedColumns: (rows: Row[]) => { returnedColumns = rows; },
    end: vi.fn(async () => undefined),
  };
}
type Db = ReturnType<typeof fakeDb>;
const ddlCalls = (db: Db) => db.query.mock.calls.filter(([sql]) => statements.includes(sql));
const releaseCalls = (db: Db) => db.query.mock.calls.filter(([sql]) => sql === RELEASE_SQL);
const apply = (db: Db, options: Record<string, unknown> = {}) => applyTakeoffDetailsMigration(db, sources, options);
async function rejectedZeroDdl(db: Db, message = "EXISTING_SHAPE_MISMATCH") {
  await expect(apply(db)).rejects.toThrow(message);
  expect(ddlCalls(db)).toHaveLength(0);
  expect(releaseCalls(db)).toHaveLength(1);
}

// These are finite contract/metadata/SQL simulation tests, NOT MySQL stress or live DDL proof.
describe("0101工程量明细严格受控迁移：离线精确SQL模拟，非真实MySQL压力或迁移证明", () => {
  it("真实固定文件名/SHA与三条独立allowlist一致，SQL省略NULL等价nullable DEFAULT NULL", () => {
    expect(TAKEOFF_DETAILS_MIGRATION).toEqual(approved);
    expect(TAKEOFF_DETAILS_MIGRATIONS).toEqual([approved]);
    expect(TAKEOFF_DETAILS_TABLE).toBe(table);
    expect(TAKEOFF_DETAILS_COLUMNS).toEqual(fields.map((name, i) => ({ name, type: types[i] })));
    expect(validateTakeoffDetailsMigration(sources)).toEqual([approved]);
    expect(createHash("sha256").update(source.bytes).digest("hex")).toBe(approved.sha256);
    expect(splitTakeoffDetailsMigrationStatements(source.bytes)).toEqual(statements);
    expect(Object.isFrozen(TAKEOFF_DETAILS_MIGRATION)).toBe(true);
    expect(Object.isFrozen(TAKEOFF_DETAILS_COLUMNS)).toBe(true);
    expect(TAKEOFF_DETAILS_COLUMNS.every(Object.isFrozen)).toBe(true);
  });
  it.each(["0".repeat(64), "bc1b2d28bebaa661a0f39c385b24a3412c751bc65724069899e9970fc45dcdad", null])("caller错误SHA %j不能授权且零查询", async expectedSha => {
    const db = fakeDb();
    await expect(applyTakeoffDetailsMigration(db, [{ ...source, expectedSha }])).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([
    "UPDATE `measurement_takeoff_records` SET `measurementRows`='[]';", "DROP TABLE `measurement_takeoff_records`;",
    "INSERT INTO `measurement_takeoff_records` VALUES (1);", "DELETE FROM `measurement_takeoff_records`;",
    "ALTER TABLE `measurement_takeoff_records` ADD `notApproved` text;",
  ])("SQL追加%s及自行SHA仍拒绝，零查询", async sql => {
    const bytes = Buffer.from(source.bytes.toString() + sql);
    const db = fakeDb();
    await expect(applyTakeoffDetailsMigration(db, [{ ...source, bytes, expectedSha: createHash("sha256").update(bytes).digest("hex") }])).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([
    [], [source, source], [{ ...source, file: "0099_business_document_number.sql" }],
    [{ ...source, file: "../0101_measurement_takeoff_details.sql" }], [{ ...source, bytes: "not-a-buffer" }],
  ].map(wrong => ({ wrong })))("文件集合/文件名/Buffer错误 $wrong拒绝", ({ wrong }) => {
    expect(() => validateTakeoffDetailsMigration(wrong)).toThrow("INVALID_MIGRATION_FILES");
  });
  it("未传caller摘要不能绕过真实bytes SHA", () => {
    expect(() => validateTakeoffDetailsMigration([{ file: approved.file, bytes: Buffer.from("DROP TABLE users;") }])).toThrow("MIGRATION_SHA_MISMATCH");
  });
  it.each([
    statements.slice(0, 2).join("--> statement-breakpoint"),
    [...statements].reverse().join("--> statement-breakpoint"),
    source.bytes.toString() + "--> statement-breakpoint",
    source.bytes.toString().replace("text;", "text NULL;"),
    source.bytes.toString().replace("json;", "json DEFAULT NULL;"),
    source.bytes.toString().replace("ADD `workDescription`", "ADD COLUMN `workDescription`"),
    source.bytes.toString().replace("`workDescription`", "`workdescription`"),
    source.bytes.toString().replace("`measurement_takeoff_records`", "`other_table`"),
    source.bytes.toString().replace("text;", "text; DROP TABLE users;"),
    statements.join("\n"),
  ])("split自身精确三条数量/顺序/拼写拒绝变形 %#", sql => {
    expect(() => splitTakeoffDetailsMigrationStatements(Buffer.from(sql))).toThrow("UNEXPECTED_STATEMENT");
  });
  it("首轮3DDL、重复0DDL3skip，所有查询白名单，历史字段与migration metadata完全不碰", async () => {
    const db = fakeDb(); const old = structuredClone(db.oldColumns);
    expect(await apply(db)).toMatchObject({ ok: true, appliedStatements: 3, skippedStatements: 0, verified: true,
      newColumnCount: 3, businessDataWritten: false, migrationHistoryWritten: false, ddlImplicitCommit: true });
    expect(await apply(db)).toMatchObject({ appliedStatements: 0, skippedStatements: 3 });
    expect(ddlCalls(db).map(([sql]) => sql)).toEqual(statements);
    expect(db.oldColumns).toEqual(old);
    expect(releaseCalls(db)).toHaveLength(2);
    const calls = db.query.mock.calls.map(([sql]) => sql);
    expect(calls.slice(0, 5)).toEqual([CONTEXT_SQL, LOCK_SQL, TABLE_SQL, COLUMN_SQL, statements[0]]);
    for (const sql of calls) {
      expect([CONTEXT_SQL, LOCK_SQL, RELEASE_SQL, TABLE_SQL, COLUMN_SQL, ...statements]).toContain(sql);
      expect(sql).not.toMatch(/^(INSERT|UPDATE|DELETE|DROP|BEGIN|COMMIT|ROLLBACK)\b/i);
      expect(sql).not.toMatch(/__drizzle_migrations|migration_history|information_schema\.statistics|SELECT \* FROM `measurement_takeoff_records`/);
    }
  });
  it.each([[0], [1], [2], [0, 1], [0, 2], [1, 2]].map(present => ({ present })))("部分正确shape $present可恢复且只补缺列", async ({ present }) => {
    const db = fakeDb({ present });
    expect(await apply(db)).toMatchObject({ appliedStatements: 3 - present.length, skippedStatements: present.length });
    expect(ddlCalls(db).map(([sql]) => sql)).toEqual(statements.filter((_, i) => !present.includes(i)));
  });
  it("首列缺失但末列错误：全preflight先拒绝，绝无首列DDL", async () => {
    const db = fakeDb({ present: [2] }); db.columns[0].COLUMN_TYPE = "longtext";
    await rejectedZeroDdl(db);
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([CONTEXT_SQL, LOCK_SQL, TABLE_SQL, COLUMN_SQL, RELEASE_SQL]);
  });
  const badColumnValues: [string, unknown][] = [
    ["COLUMN_TYPE", "longtext"], ["COLUMN_TYPE", "varchar(255)"], ["DATA_TYPE", "blob"],
    ["IS_NULLABLE", "NO"], ["COLUMN_DEFAULT", "NULL"], ["COLUMN_DEFAULT", ""], ["COLUMN_DEFAULT", 0],
    ["COLUMN_DEFAULT", undefined], ["EXTRA", "DEFAULT_GENERATED"], ["EXTRA", "STORED GENERATED"],
    ["EXTRA", "VIRTUAL GENERATED"], ["EXTRA", "INVISIBLE"], ["EXTRA", " "], ["EXTRA", null],
    ["GENERATION_EXPRESSION", "(1)"], ["GENERATION_EXPRESSION", null], ["GENERATION_EXPRESSION", undefined],
    ["TABLE_SCHEMA", "other_database"], ["TABLE_NAME", "other_table"],
  ];
  it.each(fields.flatMap((name, i) => badColumnValues.map(([key, value]) => ({ name, i, key, value }))))("已有$name $key=$value全预检拒绝零DDL", async ({ i, key, value }) => {
    const db = fakeDb({ present: [i] }); db.columns[0][key] = value;
    await rejectedZeroDdl(db);
  });
  it.each([0, 1, 2])("精确大小写name/type及text/text/json互换不接受，列%d", async i => {
    for (const mutate of [
      (row: Row) => { row.COLUMN_NAME = fields[i].toUpperCase(); },
      (row: Row) => { row.COLUMN_TYPE = types[i].toUpperCase(); },
      (row: Row) => { row.DATA_TYPE = types[i].toUpperCase(); },
      (row: Row) => { row.COLUMN_TYPE = row.DATA_TYPE = i === 2 ? "text" : "json"; },
    ]) { const db = fakeDb({ present: [i] }); mutate(db.columns[0]); await rejectedZeroDdl(db); }
  });
  it.each(["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME", "COLUMN_TYPE", "DATA_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "EXTRA", "GENERATION_EXPRESSION"])("关键列元数据缺%s严格拒绝，不能默认正确", async key => {
    const db = fakeDb({ present: [0] }); delete db.columns[0][key];
    db.setReturnedColumns(db.columns); // Missing COLUMN_NAME must reach validator, not vanish in fake filtering.
    await rejectedZeroDdl(db);
  });
  it("列元数据lowercase keys兼容，但值严格；ordinal_position不约束历史布局", async () => {
    const db = fakeDb({ present: [0, 1, 2] });
    const lower = (row: Row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
    db.tableRows[0] = lower(db.tableRows[0]);
    db.setReturnedColumns(db.columns.map(row => { const lowered = lower(row); delete lowered.ordinal_position; return lowered; }));
    expect(await apply(db)).toMatchObject({ appliedStatements: 0, skippedStatements: 3 });
  });
  it("重复列/范围外返回列不能冒充允许集合", async () => {
    for (const rows of [[column(0), column(0)], [{ ...column(0), COLUMN_NAME: "legacyField" }]]) {
      const db = fakeDb(); db.setReturnedColumns(rows); await rejectedZeroDdl(db);
    }
  });
  it.each([
    ["TABLE_TYPE", "VIEW"], ["ENGINE", "MyISAM"], ["ENGINE", null],
    ["TABLE_SCHEMA", "other_database"], ["TABLE_NAME", "other_table"],
  ])("基表严格%s=%s拒绝零DDL", async (key, value) => {
    const db = fakeDb(); db.tableRows[0][key] = value; await rejectedZeroDdl(db);
  });
  it.each(["TABLE_SCHEMA", "TABLE_NAME", "TABLE_TYPE", "ENGINE"])("表元数据缺%s拒绝零DDL", async key => {
    const db = fakeDb(); delete db.tableRows[0][key]; await rejectedZeroDdl(db);
  });
  it.each(["missing", "duplicate"])("基表%s拒绝，绝不创建/重建业务表", async mode => {
    const db = fakeDb(); if (mode === "missing") db.tableRows.length = 0; else db.tableRows.push({ ...db.tableRows[0] });
    await rejectedZeroDdl(db);
  });
  it("首个DDL后回读漂移拒绝，部分提交不声称回滚", async () => {
    const db = fakeDb({ afterDdl: columns => { columns[0].COLUMN_DEFAULT = "wrong"; } });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(1); expect(db.columns).toHaveLength(1);
    expect(releaseCalls(db)).toHaveLength(1);
  });
  it("后续DDL前再次全预检可发现非合作写入者的shape漂移，不执行第二条", async () => {
    const db = fakeDb({ onColumnRead: (columns, count) => { if (count === 3) columns[0].EXTRA = "INVISIBLE"; } });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(1); expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each([1, 2, 3])("DDL%d失败明确隐式提交：已加列保留，finally释放，重试只补余项", async failAt => {
    const db = fakeDb({ failAt });
    const failure = await apply(db).catch((error: Error) => error);
    expect(failure.message).toBe("MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE");
    expect(failure.cause.message).toBe("SIMULATED_DDL_FAILURE");
    expect(db.columns).toHaveLength(failAt - 1); expect(releaseCalls(db)).toHaveLength(1);
    expect(db.query.mock.calls.some(([sql]) => /^(BEGIN|ROLLBACK|COMMIT)\b/.test(sql))).toBe(false);
    expect(await apply(db)).toMatchObject({ appliedStatements: 4 - failAt, skippedStatements: failAt - 1 });
  });
  it.each([1, 2, 3])("duplicate列%d只有精确回读可接受", async duplicateAt => {
    const db = fakeDb({ duplicateAt });
    expect(await apply(db)).toMatchObject({ appliedStatements: 2, skippedStatements: 1 });
  });
  it("duplicate errno1060等价可接受，但其他errno/code绝不吞掉", async () => {
    expect(await apply(fakeDb({ duplicateAt: 1, duplicateCode: "OTHER", duplicateErrno: 1060 }))).toMatchObject({ appliedStatements: 2, skippedStatements: 1 });
    const db = fakeDb({ duplicateAt: 1, duplicateCode: "ER_TABLE_EXISTS_ERROR", duplicateErrno: 1050 });
    await expect(apply(db)).rejects.toThrow("MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE");
    expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each(["missing", "wrong"])("duplicate后%s shape必须失败", async mode => {
    const db = fakeDb({ duplicateAt: 1, duplicateNoColumn: mode === "missing",
      afterDdl: columns => { if (mode === "wrong") columns[0].COLUMN_TYPE = "blob"; } });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(1); expect(releaseCalls(db)).toHaveLength(1);
  });
  it("DDL返回成功但实际列缺失也必须回读失败", async () => {
    const db = fakeDb({ noMaterialize: true });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(1); expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each([0, "0", null, undefined, 2, true])("GET_LOCK拒绝%j：无DDL无释放别人锁", async lock => {
    const db = fakeDb({ lock });
    await expect(apply(db)).rejects.toThrow("MIGRATION_BUSY");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([CONTEXT_SQL, LOCK_SQL]);
  });
  it.each([[], [{ acquired: 1 }, { acquired: 1 }], [{}]].map(lockRows => ({ lockRows })))("GET_LOCK行数/元数据异常$lockRows拒绝", async ({ lockRows }) => {
    const db = fakeDb({ lockRows }); await expect(apply(db)).rejects.toThrow("MIGRATION_BUSY");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it("GET_LOCK抛错无无锁apply后备", async () => {
    const db = fakeDb({ lockThrows: true });
    const error = await apply(db).catch((failure: Error) => failure);
    expect(error.message).toBe("MIGRATION_LOCK_UNSUPPORTED"); expect(error.cause.message).toBe("SIMULATED_LOCK_DRIVER_FAILURE");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it("锁与释放返回string1可接受", async () => {
    expect(await apply(fakeDb({ present: [0, 1, 2], lock: "1", release: "1" }))).toMatchObject({ lockUsed: true, appliedStatements: 0, skippedStatements: 3 });
  });
  it.each([0, "0", null, undefined, true])("RELEASE_LOCK失败%j不得声称成功，已提交DDL不回滚", async release => {
    const db = fakeDb({ release });
    await expect(apply(db)).rejects.toThrow("MIGRATION_LOCK_RELEASE_FAILED");
    expect(db.columns).toHaveLength(3); expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each([[], [{ released: 1 }, { released: 1 }], [{}]].map(releaseRows => ({ releaseRows })))("RELEASE_LOCK行数异常$releaseRows失败", async ({ releaseRows }) => {
    await expect(apply(fakeDb({ present: [0, 1, 2], releaseRows }))).rejects.toThrow("MIGRATION_LOCK_RELEASE_FAILED");
  });
  it("RELEASE_LOCK驱动抛错与原DDL错误分别保留，不掩盖DDL隐式提交", async () => {
    const standalone = await apply(fakeDb({ present: [0, 1, 2], releaseThrows: true })).catch((error: Error) => error);
    expect(standalone.message).toBe("MIGRATION_LOCK_RELEASE_FAILED"); expect(standalone.cause.message).toBe("SIMULATED_RELEASE_DRIVER_FAILURE");
    const db = fakeDb({ failAt: 2, release: 0 });
    const error = await apply(db).catch((failure: AggregateError) => failure);
    expect(error).toBeInstanceOf(AggregateError); expect(error.message).toBe("MIGRATION_AND_LOCK_RELEASE_FAILED");
    expect(error.errors.map((failure: Error) => failure.message)).toEqual([
      "MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE", "MIGRATION_LOCK_RELEASE_FAILED",
    ]);
    expect(db.columns).toHaveLength(1); expect(releaseCalls(db)).toHaveLength(1);
  });
  it("MySQL verify-only完整结构0DDL3skip且锁释放", async () => {
    const db = fakeDb({ present: [0, 1, 2] });
    expect(await apply(db, { verifyOnly: true })).toMatchObject({ ok: true, verifyOnly: true, appliedStatements: 0, skippedStatements: 3, lockUsed: true });
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(1);
  });
  it.each([[], [0], [1, 2]].map(present => ({ present })))("MySQL verify-only缺列$present也拒绝，不补DDL", async ({ present }) => {
    const db = fakeDb({ present }); await expect(apply(db, { verifyOnly: true })).rejects.toThrow("VERIFY_ONLY_MISSING_OBJECT");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(1);
  });
  it("TiDB显式verify-only完整结构重复0DDL3skip，不取命名锁", async () => {
    const db = fakeDb({ present: [0, 1, 2], version: "8.0.11-TiDB-v8.5.0" });
    for (let i = 0; i < 2; i++) expect(await apply(db, { dialect: "tidb", verifyOnly: true })).toMatchObject({
      verified: true, dialect: "tidb", lockUsed: false, appliedStatements: 0, skippedStatements: 3,
    });
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
    expect(db.query.mock.calls.some(([sql]) => sql === LOCK_SQL)).toBe(false);
  });
  it.each([[], [0], [0, 1]].map(present => ({ present })))("TiDB verify-only缺列$present明确失败而非无锁补DDL", async ({ present }) => {
    const db = fakeDb({ present, version: "8.0.11-TiDB-v8.5.0" });
    await expect(apply(db, { dialect: "tidb", verifyOnly: true })).rejects.toThrow("VERIFY_ONLY_MISSING_OBJECT");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it("TiDB既有错误shape拒绝；apply选项在任何query之前禁止", async () => {
    const db = fakeDb({ present: [2], version: "8.0.11-TiDB-v8.5.0" }); db.columns[0].DATA_TYPE = "longtext";
    await expect(apply(db, { dialect: "tidb" })).rejects.toThrow("INVALID_CONFIGURATION"); expect(db.query).not.toHaveBeenCalled();
    await expect(apply(db, { dialect: "tidb", verifyOnly: true })).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it.each(["5.7.44", "10.11.1-MariaDB", "8.0.44-MariaDB", "8.0.11-TiDB-v8.5.0", "9.0.1", ""])("默认MySQL8拒绝方言%s，不取锁不DDL", async version => {
    const db = fakeDb({ version }); await expect(apply(db)).rejects.toThrow("UNSUPPORTED_DATABASE_DIALECT");
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([CONTEXT_SQL]);
  });
  it("TiDB声明与真实MySQL版本不符拒绝", async () => {
    const db = fakeDb(); await expect(apply(db, { dialect: "tidb", verifyOnly: true })).rejects.toThrow("UNSUPPORTED_DATABASE_DIALECT");
    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual([CONTEXT_SQL]);
  });
  it.each([null, "", undefined, 1])("非空数据库名严格拒绝%j", async database => {
    const db = fakeDb({ database }); await expect(apply(db)).rejects.toThrow("DATABASE_NOT_CONFIGURED");
    expect(ddlCalls(db)).toHaveLength(0); expect(releaseCalls(db)).toHaveLength(0);
  });
  it.each([[], [{ databaseName, serverVersion: "8.0.44" }, { databaseName, serverVersion: "8.0.44" }], [{}]].map(contextRows => ({ contextRows })))("连接上下文异常行$contextRows拒绝", async ({ contextRows }) => {
    await expect(apply(fakeDb({ contextRows }))).rejects.toThrow("DATABASE_NOT_CONFIGURED");
  });
  it.each([{ verifyOnly: "true" }, { dialect: "postgres" }, { dialect: "tidb", verifyOnly: false }])("无效选项%j零查询", async options => {
    const db = fakeDb(); await expect(apply(db, options)).rejects.toThrow("INVALID_CONFIGURATION"); expect(db.query).not.toHaveBeenCalled();
  });
  it("run兼容两个验证脚本契约，固定路径先读校验再注入连接，成功与repeat与verify均end", async () => {
    const db = fakeDb(); const readFile = vi.fn(async () => source.bytes); const createConnection = vi.fn(async () => db);
    const options = { databaseUrl: "mysql://synthetic-offline-only", readFile, createConnection };
    expect(await runTakeoffDetailsMigration("offline-drizzle", options)).toMatchObject({ ok: true, appliedStatements: 3 });
    expect(await runTakeoffDetailsMigration("offline-drizzle", options)).toMatchObject({ appliedStatements: 0, skippedStatements: 3 });
    expect(await runTakeoffDetailsMigration("offline-drizzle", { ...options, verifyOnly: true })).toMatchObject({ verifyOnly: true, appliedStatements: 0 });
    expect(readFile).toHaveBeenCalledWith("offline-drizzle/" + approved.file);
    expect(createConnection).toHaveBeenCalledWith(options.databaseUrl); expect(db.end).toHaveBeenCalledTimes(3);
    expect(readFile.mock.invocationCallOrder[0]).toBeLessThan(createConnection.mock.invocationCallOrder[0]);
    const tidb = fakeDb({ present: [0, 1, 2], version: "8.0.11-TiDB-v8.5.0" });
    expect(await runTakeoffDetailsMigration("offline-drizzle", { ...options, createConnection: async () => tidb, verifyOnly: true, dialect: "tidb" })).toMatchObject({ ok: true, lockUsed: false });
    expect(tidb.end).toHaveBeenCalledTimes(1);
  });
  it("run的caller错误SHA、篡改bytes、读取失败均在连接前停止", async () => {
    const createConnection = vi.fn(); const readFile = vi.fn(async () => source.bytes);
    const options = { databaseUrl: "mysql://synthetic-offline-only", readFile, createConnection };
    await expect(runTakeoffDetailsMigration("offline-drizzle", { ...options, expectedShas: ["0".repeat(64)] })).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    await expect(runTakeoffDetailsMigration("offline-drizzle", { ...options, readFile: async () => Buffer.from("DROP TABLE users;") })).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    await expect(runTakeoffDetailsMigration("offline-drizzle", { ...options, readFile: async () => { throw new Error("SIMULATED_FILE_MISSING"); } })).rejects.toThrow("SIMULATED_FILE_MISSING");
    expect(createConnection).not.toHaveBeenCalled();
  });
  it.each([
    { expectedShas: [] }, { expectedShas: [approved.sha256, approved.sha256] }, { databaseUrl: "" },
    { dialect: "tidb" }, { readFile: null }, { createConnection: null },
  ])("run无效配置%j连接前拒绝", async bad => {
    const createConnection = vi.fn();
    await expect(runTakeoffDetailsMigration("offline-drizzle", { databaseUrl: "mysql://offline-only", readFile: async () => source.bytes, createConnection, ...bad })).rejects.toThrow("INVALID_CONFIGURATION");
    expect(createConnection).not.toHaveBeenCalled();
  });
  it("run失败也关闭连接，关闭失败保留原迁移错误", async () => {
    const options = { databaseUrl: "mysql://synthetic-offline-only", readFile: async () => source.bytes };
    const db = fakeDb({ failAt: 1 });
    await expect(runTakeoffDetailsMigration("offline", { ...options, createConnection: async () => db })).rejects.toThrow("MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE");
    expect(db.end).toHaveBeenCalledTimes(1);
    const bad = fakeDb({ failAt: 1 }); bad.end.mockRejectedValueOnce(new Error("SIMULATED_CLOSE_FAILURE"));
    const error = await runTakeoffDetailsMigration("offline", { ...options, createConnection: async () => bad }).catch((failure: AggregateError) => failure);
    expect(error).toBeInstanceOf(AggregateError); expect(error.message).toBe("MIGRATION_AND_CONNECTION_CLOSE_FAILED");
    expect(error.errors.map((failure: Error) => failure.message)).toEqual(["MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE", "SIMULATED_CLOSE_FAILURE"]);
    const closeOnly = fakeDb({ present: [0, 1, 2] }); closeOnly.end.mockRejectedValueOnce(new Error("SIMULATED_CLOSE_FAILURE"));
    await expect(runTakeoffDetailsMigration("offline", { ...options, createConnection: async () => closeOnly })).rejects.toThrow("MIGRATION_CONNECTION_CLOSE_FAILED");
  });
  it("CLI只允许目录与verify/dialect，禁callerSHA、重复选项、无锁TiDB apply", () => {
    expect(parseTakeoffDetailsMigrationArguments(["drizzle"])).toEqual({ directory: "drizzle", verifyOnly: false, dialect: "mysql8" });
    expect(parseTakeoffDetailsMigrationArguments(["--verify-only", "--dialect=tidb", "drizzle"])).toEqual({ directory: "drizzle", verifyOnly: true, dialect: "tidb" });
    for (const args of [[], ["drizzle", "--dialect=tidb"], ["drizzle", "--expected-sha=anything"],
      ["drizzle", "--no-lock"], ["drizzle", "--verify-only", "--verify-only"], ["drizzle", "--dialect=postgres"],
      ["a", "b"], ["drizzle", "--dialect=mysql8", "--dialect=mysql8"], ["drizzle", "--force"]])
      expect(() => parseTakeoffDetailsMigrationArguments(args)).toThrow("INVALID_CONFIGURATION");
  });
  it("CLI无效参数早于.env/连接，错误输出不含URL/驱动详情并明确隐式提交", () => {
    const runner = new URL("../scripts/apply-takeoff-details-migration.mjs", import.meta.url);
    // Invalid arguments ensure early rejection BEFORE dotenv load, hash I/O or a real connection.
    const result = spawnSync(process.execPath, [runner.pathname, "--no-lock"], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "mysql://SECRET_MUST_NOT_APPEAR@invalid/offline" }, timeout: 10000,
    });
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DDL隐式提交"); expect(result.stderr).toContain("不能事务回滚");
    expect(result.stderr).not.toMatch(/SECRET_MUST_NOT_APPEAR|mysql:\/\/|ER_|stack|at file:/);
  });
  it("真实esbuild ESM bundle导入只暴露API，不误触runner CLI或数据库连接", async () => {
    const runner = new URL("../scripts/apply-takeoff-details-migration.mjs", import.meta.url).pathname;
    const bundle = await build({
      stdin: { contents: 'import { runTakeoffDetailsMigration } from ' + JSON.stringify(runner) + '; console.log("OFFLINE_BUNDLE_API:" + typeof runTakeoffDetailsMigration);',
        resolveDir: process.cwd(), sourcefile: "controlled-migration-runner.bundle.mjs" },
      write: false, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    });
    // Simulate bundle entry URL === argv[1]. A URL-only guard would run CLI and fail.
    // Invalid --no-lock is a second fail-closed guard BEFORE any possible DB connection.
    const prefix = 'import { fileURLToPath as entryPath } from "node:url"; process.argv = [process.execPath, entryPath(import.meta.url), "--no-lock"];\n';
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", prefix + bundle.outputFiles![0].text], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "" }, timeout: 10000,
    });
    expect(result.status).toBe(0); expect(result.stdout.trim()).toBe("OFFLINE_BUNDLE_API:function");
    expect(result.stderr).toBe("");
  });
  it("导出run API及打包wrapper文件名CLI护栏稳定；dotenv只在CLI加载且不覆盖外部环境", () => {
    const runner = readFileSync(new URL("../scripts/apply-takeoff-details-migration.mjs", import.meta.url), "utf8");
    expect(runner).toContain('path.basename(process.argv[1]) === "apply-takeoff-details-migration.mjs"');
    expect(runner).toContain('config({ quiet: true, override: false })');
    expect(typeof runTakeoffDetailsMigration).toBe("function");
    expect(runner.indexOf('const { config } = await import("dotenv")')).toBeGreaterThan(runner.indexOf('path.basename(process.argv[1])'));
    expect(forbiddenRealConnection).not.toHaveBeenCalled();
  });
});
