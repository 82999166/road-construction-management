import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

// These hashes authorize only the independently enumerated statements below.
// Never obtain the approval hash or the SQL allowlist from caller input.
export const BUSINESS_DOCUMENT_NUMBER_MIGRATIONS = Object.freeze([
  Object.freeze({ file: "0099_business_document_number.sql", sha256: "94c6819cf6aaa294280ae1431c2d718f6662659f175a61b3e015162f7ffeb6e9" }),
  Object.freeze({ file: "0100_watery_wong.sql", sha256: "f2ba1ea71a81411272f9f8a0c57305b17256bc172d1ff07adb58149563b4fc22" }),
]);
const LOCK = "yx_business_document_number_0099_0100";
export const DOCUMENT_NUMBER_TABLES = Object.freeze([
  "asset_maintenance_records", "construction_daily_reports",
  "employee_payroll_advances", "machine_cost_records",
  "machine_daily_operations", "machine_monthly_statements", "payroll_statements",
  "settlement_payment_records", "temporary_daily_wage_settlements",
]);
const column = (name, type, nullable = false, defaultKind = "null", onUpdate = false) =>
  ({ name, type, nullable, defaultKind, onUpdate });
const index = (name, columns) => ({ name, columns });
const tables = [
  {
    name: "business_document_number_allocations",
    columns: [column("requestHash", "varchar(64)"), column("moduleCode", "varchar(2)"),
      column("actorKey", "varchar(16)"), column("scopeHash", "varchar(64)"),
      column("number", "varchar(36)", true), column("prefix", "varchar(32)", true),
      column("sequence", "int", true), column("createdAt", "timestamp", false, "timestamp")],
    indexes: [index("PRIMARY", ["requestHash"]), index("business_document_number_unique", ["number"]),
      index("business_document_prefix_sequence_unique", ["prefix", "sequence"])],
    sql: "CREATE TABLE `business_document_number_allocations` (\n\t`requestHash` varchar(64) NOT NULL,\n\t`moduleCode` varchar(2) NOT NULL,\n\t`actorKey` varchar(16) NOT NULL,\n\t`scopeHash` varchar(64) NOT NULL,\n\t`number` varchar(36),\n\t`prefix` varchar(32),\n\t`sequence` int,\n\t`createdAt` timestamp NOT NULL DEFAULT (now()),\n\tCONSTRAINT `business_document_number_allocations_requestHash` PRIMARY KEY(`requestHash`),\n\tCONSTRAINT `business_document_number_unique` UNIQUE(`number`),\n\tCONSTRAINT `business_document_prefix_sequence_unique` UNIQUE(`prefix`,`sequence`)\n) ENGINE=InnoDB;",
  },
  {
    name: "business_document_number_counters",
    columns: [column("prefix", "varchar(32)"), column("lastSequence", "int", false, "zero"),
      column("createdAt", "timestamp", false, "timestamp"), column("updatedAt", "timestamp", false, "timestamp", true)],
    indexes: [index("PRIMARY", ["prefix"])],
    sql: "CREATE TABLE `business_document_number_counters` (\n\t`prefix` varchar(32) NOT NULL,\n\t`lastSequence` int NOT NULL DEFAULT 0,\n\t`createdAt` timestamp NOT NULL DEFAULT (now()),\n\t`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,\n\tCONSTRAINT `business_document_number_counters_prefix` PRIMARY KEY(`prefix`)\n) ENGINE=InnoDB;",
  },
  {
    name: "business_document_creation_receipts",
    columns: [column("requestHash", "varchar(64)"), column("inputHash", "varchar(64)"),
      column("scope", "varchar(128)"), column("actorId", "int"), column("resultJson", "text", true),
      column("createdAt", "timestamp", false, "timestamp")],
    indexes: [index("PRIMARY", ["requestHash"])],
    sql: "CREATE TABLE `business_document_creation_receipts` (\n\t`requestHash` varchar(64) NOT NULL,\n\t`inputHash` varchar(64) NOT NULL,\n\t`scope` varchar(128) NOT NULL,\n\t`actorId` int NOT NULL,\n\t`resultJson` text,\n\t`createdAt` timestamp NOT NULL DEFAULT (now()),\n\tCONSTRAINT `business_document_creation_receipts_requestHash` PRIMARY KEY(`requestHash`)\n) ENGINE=InnoDB;",
  },
];
// SQL order in 0100 is part of the approval, including the separately approved DS source link.
const additions = [
  ...DOCUMENT_NUMBER_TABLES.slice(0, 2).map(name => ({ table: name, column: column("documentNo", "varchar(36)", true) })),
  { table: "diesel_refuel_records", column: column("machineCostSourceId", "bigint", true) },
  ...DOCUMENT_NUMBER_TABLES.slice(2).map(name => ({ table: name, column: column("documentNo", "varchar(36)", true) })),
].map(spec => ({ ...spec, index: index(`${spec.table}_${spec.column.name}_unique`, [spec.column.name]) }));
const operations = [
  ...tables.map(spec => ({ kind: "table", table: spec.name, spec, sql: spec.sql })),
  ...additions.map(spec => ({ kind: "column", table: spec.table, spec,
    sql: `ALTER TABLE \`${spec.table}\` ADD \`${spec.column.name}\` ${spec.column.type};` })),
  ...additions.map(spec => ({ kind: "index", table: spec.table, spec,
    sql: `ALTER TABLE \`${spec.table}\` ADD CONSTRAINT \`${spec.index.name}\` UNIQUE(\`${spec.column.name}\`);` })),
];
const approvedStatements = [operations.slice(0, 2).map(op => op.sql), operations.slice(2).map(op => op.sql)];

export function validateBusinessDocumentNumberMigrations(sources) {
  if (!Array.isArray(sources) || sources.length !== 2) throw new Error("INVALID_MIGRATION_FILES");
  return BUSINESS_DOCUMENT_NUMBER_MIGRATIONS.map((approved, i) => {
    const source = sources[i];
    if (source?.file !== approved.file || !Buffer.isBuffer(source.bytes)) throw new Error("INVALID_MIGRATION_FILES");
    const sha256 = createHash("sha256").update(source.bytes).digest("hex");
    if ((source.expectedSha !== undefined && source.expectedSha !== approved.sha256) || sha256 !== approved.sha256)
      throw new Error("MIGRATION_SHA_MISMATCH");
    const statements = source.bytes.toString("utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    if (statements.length !== approvedStatements[i].length || statements.some((s, j) => s !== approvedStatements[i][j]))
      throw new Error("UNEXPECTED_STATEMENT");
    return { file: approved.file, sha256 };
  });
}
function mismatch() { throw new Error("EXISTING_SHAPE_MISMATCH"); }
function hasMetadata(row, key) {
  return Object.hasOwn(row, key) || Object.hasOwn(row, key.toLowerCase());
}
function metadata(row, key) { return Object.hasOwn(row, key) ? row[key] : row[key.toLowerCase()]; }
function assertScope(row, databaseName, tableName) {
  if (metadata(row, "TABLE_SCHEMA") !== databaseName || metadata(row, "TABLE_NAME") !== tableName) mismatch();
}
function assertColumn(row, spec, position) {
  if (!row || ["COLUMN_NAME", "COLUMN_TYPE", "DATA_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "EXTRA", "GENERATION_EXPRESSION"]
      .some(key => !hasMetadata(row, key))) mismatch();
  // MySQL 8.0's older integer display widths are equivalent, but unsigned/zerofill are not.
  const type = String(metadata(row, "COLUMN_TYPE")).toLowerCase().replace(/^int\(11\)$/, "int").replace(/^bigint\(20\)$/, "bigint");
  const dataType = spec.type.replace(/\(.*/, "");
  const def = metadata(row, "COLUMN_DEFAULT");
  if (typeof metadata(row, "EXTRA") !== "string") mismatch();
  const extra = metadata(row, "EXTRA").toLowerCase().replace(/current_timestamp\(\)/g, "current_timestamp").trim();
  const timestampDefault = /^(?:current_timestamp(?:\(\))?|\(?now\(\)\)?)$/i.test(String(def));
  const defaultOk = spec.defaultKind === "timestamp" ? timestampDefault : spec.defaultKind === "zero" ? (def === "0" || def === 0) : def === null;
  const allowedExtra = spec.defaultKind === "timestamp"
    ? spec.onUpdate ? ["default_generated on update current_timestamp", "on update current_timestamp"] : ["", "default_generated"]
    : [""];
  if (metadata(row, "COLUMN_NAME") !== spec.name || type !== spec.type ||
      String(metadata(row, "DATA_TYPE")).toLowerCase() !== dataType ||
      metadata(row, "IS_NULLABLE") !== (spec.nullable ? "YES" : "NO") || !defaultOk ||
      !allowedExtra.includes(extra) || (metadata(row, "GENERATION_EXPRESSION") ?? "") !== "" ||
      (position !== undefined && Number(metadata(row, "ORDINAL_POSITION")) !== position)) mismatch();
}
function assertIndex(rows, spec) {
  const members = rows.filter(row => metadata(row, "INDEX_NAME") === spec.name).sort((a, b) => Number(metadata(a, "SEQ_IN_INDEX")) - Number(metadata(b, "SEQ_IN_INDEX")));
  if (members.length !== spec.columns.length) mismatch();
  members.forEach((row, i) => {
    if (["INDEX_NAME", "NON_UNIQUE", "SEQ_IN_INDEX", "COLUMN_NAME", "SUB_PART", "INDEX_TYPE"]
          .some(key => !hasMetadata(row, key)) ||
        ![0, "0"].includes(metadata(row, "NON_UNIQUE")) || Number(metadata(row, "SEQ_IN_INDEX")) !== i + 1 ||
        metadata(row, "COLUMN_NAME") !== spec.columns[i] || metadata(row, "SUB_PART") !== null ||
        metadata(row, "INDEX_TYPE") !== "BTREE" || (metadata(row, "EXPRESSION") ?? null) !== null ||
        ![undefined, "YES"].includes(metadata(row, "IS_VISIBLE")) ||
        ![undefined, "A"].includes(metadata(row, "COLLATION"))) mismatch();
  });
}
async function readShape(db, databaseName, name) {
  const [tableRows] = await db.query("SELECT * FROM information_schema.tables WHERE table_schema=? AND table_name=?", [databaseName, name]);
  if (tableRows.length > 1) mismatch();
  if (!tableRows.length) return null;
  const table = tableRows[0];
  assertScope(table, databaseName, name);
  if (metadata(table, "TABLE_TYPE") !== "BASE TABLE" || metadata(table, "ENGINE") !== "InnoDB") mismatch();
  const [columns] = await db.query("SELECT * FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position", [databaseName, name]);
  const [indexes] = await db.query("SELECT * FROM information_schema.statistics WHERE table_schema=? AND table_name=? ORDER BY index_name,seq_in_index", [databaseName, name]);
  columns.forEach(row => assertScope(row, databaseName, name));
  indexes.forEach(row => assertScope(row, databaseName, name));
  if (new Set(columns.map(row => metadata(row, "COLUMN_NAME"))).size !== columns.length) mismatch();
  return { columns, indexes };
}
function assertNewTable(shape, spec) {
  if (!shape || shape.columns.length !== spec.columns.length) mismatch();
  spec.columns.forEach((col, i) => assertColumn(shape.columns.find(row => metadata(row, "COLUMN_NAME") === col.name), col, i + 1));
  if (new Set(shape.indexes.map(row => metadata(row, "INDEX_NAME"))).size !== spec.indexes.length) mismatch();
  spec.indexes.forEach(idx => assertIndex(shape.indexes, idx));
}
function assertAddition(shape, spec, requireColumn = false, requireIndex = false) {
  if (!shape) mismatch(); // The tool never creates or recreates business tables.
  const col = shape.columns.find(row => metadata(row, "COLUMN_NAME") === spec.column.name);
  const idx = shape.indexes.some(row => metadata(row, "INDEX_NAME") === spec.index.name);
  if (col) assertColumn(col, spec.column);
  else if (requireColumn || idx) mismatch();
  if (idx) assertIndex(shape.indexes, spec.index);
  else if (requireIndex) mismatch();
  // A differently named or composite index is not a substitute for the approved unique index.
  if (shape.indexes.some(row => metadata(row, "COLUMN_NAME") === spec.column.name && metadata(row, "INDEX_NAME") !== spec.index.name)) mismatch();
  return { column: Boolean(col), index: idx };
}
async function preflight(db, databaseName, complete) {
  for (const spec of tables) {
    const shape = await readShape(db, databaseName, spec.name);
    if (shape) assertNewTable(shape, spec);
    else if (complete) throw new Error("VERIFY_ONLY_MISSING_OBJECT");
  }
  for (const spec of additions) {
    const status = assertAddition(await readShape(db, databaseName, spec.table), spec);
    if (complete && (!status.column || !status.index)) throw new Error("VERIFY_ONLY_MISSING_OBJECT");
  }
}
function validOptions({ verifyOnly = false, dialect = "mysql8" } = {}) {
  if (typeof verifyOnly !== "boolean" || !["mysql8", "tidb"].includes(dialect) || (dialect === "tidb" && !verifyOnly))
    throw new Error("INVALID_CONFIGURATION");
  return { verifyOnly, dialect };
}
function duplicateFor(error, kind) {
  const allowed = { table: [1050, "ER_TABLE_EXISTS_ERROR"], column: [1060, "ER_DUP_FIELDNAME"], index: [1061, "ER_DUP_KEYNAME"] }[kind];
  return error?.errno === allowed[0] || error?.code === allowed[1];
}

export async function applyBusinessDocumentNumberMigrations(db, sources, options = {}) {
  const migrations = validateBusinessDocumentNumberMigrations(sources);
  const { verifyOnly, dialect } = validOptions(options);
  const [context] = await db.query("SELECT DATABASE() AS databaseName, VERSION() AS serverVersion");
  const databaseName = context[0]?.databaseName;
  const version = context[0]?.serverVersion;
  if (context.length !== 1 || typeof databaseName !== "string" || !databaseName || typeof version !== "string")
    throw new Error("DATABASE_NOT_CONFIGURED");
  if (dialect === "mysql8" ? (!/^8\./.test(version) || /tidb|mariadb/i.test(version)) : !/tidb/i.test(version))
    throw new Error("UNSUPPORTED_DATABASE_DIALECT");
  let locked = false;
  if (dialect === "mysql8") {
    let locks;
    try { [locks] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK]); }
    catch (cause) { throw new Error("MIGRATION_LOCK_UNSUPPORTED", { cause }); }
    if (locks.length !== 1 || ![1, "1"].includes(locks[0]?.acquired)) throw new Error("MIGRATION_BUSY");
    locked = true;
  }
  let failure;
  try {
    // Inspect the entire existing footprint before issuing any DDL.
    await preflight(db, databaseName, verifyOnly);
    let appliedStatements = 0;
    let skippedStatements = 0;
    if (!verifyOnly) {
      for (const op of operations) {
        let shape = await readShape(db, databaseName, op.table);
        let exists;
        if (op.kind === "table") {
          exists = Boolean(shape);
          if (exists) assertNewTable(shape, op.spec);
        } else {
          const status = assertAddition(shape, op.spec, op.kind === "index");
          exists = status[op.kind];
        }
        if (exists) { skippedStatements++; continue; }
        // MySQL DDL implicitly commits. No BEGIN/ROLLBACK, no migration journal,
        // no business record reads/writes/backfill, and no destructive repair.
        try { await db.query(op.sql); appliedStatements++; }
        catch (error) {
          if (!duplicateFor(error, op.kind)) throw error;
          // Never swallow a duplicate until the exact expected metadata is read back.
          skippedStatements++;
        }
        shape = await readShape(db, databaseName, op.table);
        if (op.kind === "table") assertNewTable(shape, op.spec);
        else assertAddition(shape, op.spec, true, op.kind === "index");
      }
      await preflight(db, databaseName, true);
    }
    return { ok: true, migrations, verified: true, verifyOnly, dialect,
      lockUsed: locked, appliedStatements, skippedStatements,
      newTableCount: 3, documentNoColumnCount: 9, sourceLinkColumnCount: 1,
      historyUnchanged: true, ddlImplicitCommit: true };
  } catch (error) { failure = error; throw error; }
  finally {
    if (locked) {
      try {
        const [released] = await db.query("SELECT RELEASE_LOCK(?) AS released", [LOCK]);
        if (released.length !== 1 || ![1, "1"].includes(released[0]?.released)) throw new Error("MIGRATION_LOCK_RELEASE_FAILED");
      } catch (releaseError) {
        if (failure) throw new AggregateError([failure, releaseError], "MIGRATION_AND_LOCK_RELEASE_FAILED");
        throw releaseError;
      }
    }
  }
}

export async function runBusinessDocumentNumberMigrations(directory, {
  databaseUrl = process.env.DATABASE_URL,
  readFile = fs.readFile,
  createConnection = mysql.createConnection,
  expectedShas = BUSINESS_DOCUMENT_NUMBER_MIGRATIONS.map(m => m.sha256),
  verifyOnly = false,
  dialect = "mysql8",
} = {}) {
  validOptions({ verifyOnly, dialect });
  if (typeof directory !== "string" || !directory || typeof databaseUrl !== "string" || !databaseUrl ||
      !Array.isArray(expectedShas) || expectedShas.length !== 2) throw new Error("INVALID_CONFIGURATION");
  const sources = await Promise.all(BUSINESS_DOCUMENT_NUMBER_MIGRATIONS.map(async (spec, i) => ({
    file: spec.file, bytes: await readFile(path.join(directory, spec.file)), expectedSha: expectedShas[i],
  })));
  validateBusinessDocumentNumberMigrations(sources); // Always before connection.
  const db = await createConnection(databaseUrl);
  let failure;
  try { return await applyBusinessDocumentNumberMigrations(db, sources, { verifyOnly, dialect }); }
  catch (error) { failure = error; throw error; }
  finally {
    try { await db.end(); }
    catch (closeError) {
      if (failure) throw new AggregateError([failure, closeError], "MIGRATION_AND_CONNECTION_CLOSE_FAILED");
      throw closeError;
    }
  }
}

export function parseBusinessDocumentNumberMigrationArguments(args) {
  let verifyOnly = false;
  let dialect = "mysql8";
  let directory;
  let dialectSet = false;
  for (const arg of args) {
    if (arg === "--verify-only" && !verifyOnly) verifyOnly = true;
    else if (arg.startsWith("--dialect=") && !dialectSet) { dialect = arg.slice(10); dialectSet = true; }
    else if (!arg.startsWith("-") && directory === undefined) directory = arg;
    else throw new Error("INVALID_CONFIGURATION");
  }
  if (!directory) throw new Error("INVALID_CONFIGURATION");
  validOptions({ verifyOnly, dialect });
  return { directory, verifyOnly, dialect };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { directory, ...options } = parseBusinessDocumentNumberMigrationArguments(process.argv.slice(2));
    console.log(JSON.stringify(await runBusinessDocumentNumberMigrations(directory, options)));
  } catch {
    // No credentials, URLs, SQL, business data or raw driver errors in CLI output.
    console.error("业务号迁移/核验未完成：请核对固定文件摘要、MySQL 8 锁及表/列/唯一索引结构。DDL隐式提交不能回滚；部分完成须严格核验后重试。TiDB仅可显式 --verify-only --dialect=tidb 元数据核验，禁止无锁DDL。历史NULL及旧号不回填。");
    process.exitCode = 1;
  }
}
