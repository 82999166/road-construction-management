import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

// Approval is code-owned: callers cannot authorize another filename/hash/statement.
export const TAKEOFF_DETAILS_MIGRATION = Object.freeze({
  file: "0101_measurement_takeoff_details.sql",
  sha256: "11f630e2290bda2b175f46d08d1b964927c12dd611d48e1a5dc47f2322b4b3c4",
});
export const TAKEOFF_DETAILS_MIGRATIONS = Object.freeze([TAKEOFF_DETAILS_MIGRATION]);
export const TAKEOFF_DETAILS_TABLE = "measurement_takeoff_records";
export const TAKEOFF_DETAILS_COLUMNS = Object.freeze([
  Object.freeze({ name: "workDescription", type: "text" }),
  Object.freeze({ name: "measurementBasis", type: "text" }),
  Object.freeze({ name: "measurementRows", type: "json" }),
]);
const approvedStatements = Object.freeze([
  "ALTER TABLE `measurement_takeoff_records` ADD `workDescription` text;",
  "ALTER TABLE `measurement_takeoff_records` ADD `measurementBasis` text;",
  "ALTER TABLE `measurement_takeoff_records` ADD `measurementRows` json;",
]);
const LOCK = "yx_measurement_takeoff_details_0101";
const TABLE_QUERY = "SELECT * FROM information_schema.tables WHERE table_schema=? AND table_name=?";
// Do not inspect, constrain, read back, backfill or repair historical columns/indexes.
const COLUMN_QUERY = "SELECT * FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name IN (?,?,?) ORDER BY ordinal_position";

export function splitTakeoffDetailsMigrationStatements(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("INVALID_MIGRATION_FILES");
  const statements = bytes.toString("utf8").split("--> statement-breakpoint").map(s => s.trim());
  if (statements.length !== 3 || statements.some((sql, i) => sql !== approvedStatements[i]))
    throw new Error("UNEXPECTED_STATEMENT");
  return statements;
}

export function validateTakeoffDetailsMigration(sources) {
  if (!Array.isArray(sources) || sources.length !== 1 ||
      sources[0]?.file !== TAKEOFF_DETAILS_MIGRATION.file || !Buffer.isBuffer(sources[0]?.bytes))
    throw new Error("INVALID_MIGRATION_FILES");
  const source = sources[0];
  const sha256 = createHash("sha256").update(source.bytes).digest("hex");
  if ((source.expectedSha !== undefined && source.expectedSha !== TAKEOFF_DETAILS_MIGRATION.sha256) ||
      sha256 !== TAKEOFF_DETAILS_MIGRATION.sha256) throw new Error("MIGRATION_SHA_MISMATCH");
  splitTakeoffDetailsMigrationStatements(source.bytes);
  return [{ file: TAKEOFF_DETAILS_MIGRATION.file, sha256 }];
}

function validOptions({ verifyOnly = false, dialect = "mysql8" } = {}) {
  if (typeof verifyOnly !== "boolean" || !["mysql8", "tidb"].includes(dialect) ||
      (dialect === "tidb" && !verifyOnly)) throw new Error("INVALID_CONFIGURATION");
  return { verifyOnly, dialect };
}
function mismatch() { throw new Error("EXISTING_SHAPE_MISMATCH"); }
function hasMetadata(row, key) {
  return row !== null && typeof row === "object" &&
    (Object.hasOwn(row, key) || Object.hasOwn(row, key.toLowerCase()));
}
function metadata(row, key) { return Object.hasOwn(row, key) ? row[key] : row[key.toLowerCase()]; }
function assertScope(row, databaseName) {
  if (!hasMetadata(row, "TABLE_SCHEMA") || !hasMetadata(row, "TABLE_NAME") ||
      metadata(row, "TABLE_SCHEMA") !== databaseName || metadata(row, "TABLE_NAME") !== TAKEOFF_DETAILS_TABLE) mismatch();
}
function assertColumn(row, spec, databaseName) {
  assertScope(row, databaseName);
  if (["COLUMN_NAME", "COLUMN_TYPE", "DATA_TYPE", "IS_NULLABLE", "COLUMN_DEFAULT", "EXTRA", "GENERATION_EXPRESSION"]
      .some(key => !hasMetadata(row, key))) mismatch();
  // MySQL 8/TiDB metadata must attest the exact ordinary, nullable text/text/json shape.
  // Missing/undefined defaults and generation metadata are not equivalent to SQL NULL/empty.
  if (metadata(row, "COLUMN_NAME") !== spec.name || metadata(row, "COLUMN_TYPE") !== spec.type ||
      metadata(row, "DATA_TYPE") !== spec.type || metadata(row, "IS_NULLABLE") !== "YES" ||
      metadata(row, "COLUMN_DEFAULT") !== null || metadata(row, "EXTRA") !== "" ||
      metadata(row, "GENERATION_EXPRESSION") !== "") mismatch();
}
async function preflight(db, databaseName, complete = false) {
  const [tableRows] = await db.query(TABLE_QUERY, [databaseName, TAKEOFF_DETAILS_TABLE]);
  if (!Array.isArray(tableRows) || tableRows.length !== 1) mismatch();
  const table = tableRows[0];
  assertScope(table, databaseName);
  if (!hasMetadata(table, "TABLE_TYPE") || !hasMetadata(table, "ENGINE") ||
      metadata(table, "TABLE_TYPE") !== "BASE TABLE" || metadata(table, "ENGINE") !== "InnoDB") mismatch();
  const [columns] = await db.query(COLUMN_QUERY,
    [databaseName, TAKEOFF_DETAILS_TABLE, ...TAKEOFF_DETAILS_COLUMNS.map(spec => spec.name)]);
  if (!Array.isArray(columns)) mismatch();
  const present = new Set();
  // Validate ALL returned allowed-column metadata before deciding which additions are missing.
  for (const row of columns) {
    if (!hasMetadata(row, "COLUMN_NAME")) mismatch();
    const name = metadata(row, "COLUMN_NAME");
    const spec = TAKEOFF_DETAILS_COLUMNS.find(column => column.name === name);
    if (!spec || present.has(name)) mismatch();
    assertColumn(row, spec, databaseName);
    present.add(name);
  }
  if (complete && present.size !== 3) throw new Error("VERIFY_ONLY_MISSING_OBJECT");
  return present;
}
function lockSuccess(rows, key) {
  return Array.isArray(rows) && rows.length === 1 && [1, "1"].includes(rows[0]?.[key]);
}

export async function applyTakeoffDetailsMigration(db, sources, options = {}) {
  const migrations = validateTakeoffDetailsMigration(sources);
  const { verifyOnly, dialect } = validOptions(options);
  const [context] = await db.query("SELECT DATABASE() AS databaseName, VERSION() AS serverVersion");
  const databaseName = context?.[0]?.databaseName;
  const version = context?.[0]?.serverVersion;
  if (!Array.isArray(context) || context.length !== 1 || typeof databaseName !== "string" || !databaseName ||
      typeof version !== "string") throw new Error("DATABASE_NOT_CONFIGURED");
  if (dialect === "mysql8" ? (!/^8\./.test(version) || /tidb|mariadb/i.test(version)) : !/tidb/i.test(version))
    throw new Error("UNSUPPORTED_DATABASE_DIALECT");
  let locked = false;
  if (dialect === "mysql8") {
    let rows;
    try { [rows] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK]); }
    catch (cause) { throw new Error("MIGRATION_LOCK_UNSUPPORTED", { cause }); }
    if (!lockSuccess(rows, "acquired")) throw new Error("MIGRATION_BUSY");
    locked = true;
  }
  let failure;
  try {
    let present = await preflight(db, databaseName, verifyOnly);
    let appliedStatements = 0;
    let skippedStatements = 0;
    if (verifyOnly) skippedStatements = 3;
    else {
      for (const [i, spec] of TAKEOFF_DETAILS_COLUMNS.entries()) {
        // A fresh full-column preflight also rejects concurrent noncooperating shape drift.
        if (i > 0) present = await preflight(db, databaseName);
        if (present.has(spec.name)) { skippedStatements++; continue; }
        // Independent DDL implicitly commits. No transaction/rollback, journal or business writes.
        try { await db.query(approvedStatements[i]); appliedStatements++; }
        catch (cause) {
          if (cause?.errno !== 1060 && cause?.code !== "ER_DUP_FIELDNAME")
            throw new Error("MIGRATION_DDL_FAILED_IMPLICIT_COMMIT_PARTIAL_COMPLETION_POSSIBLE", { cause });
          // A concurrent exact addition may be recovered, but never swallow a wrong/missing shape.
          skippedStatements++;
        }
        present = await preflight(db, databaseName);
        if (!present.has(spec.name)) mismatch();
      }
      await preflight(db, databaseName, true);
    }
    return { ok: true, migrations, verified: true, verifyOnly, dialect, lockUsed: locked,
      appliedStatements, skippedStatements, newColumnCount: 3, table: TAKEOFF_DETAILS_TABLE,
      historyUnchanged: true, businessDataWritten: false, migrationHistoryWritten: false, ddlImplicitCommit: true };
  } catch (error) { failure = error; throw error; }
  finally {
    if (locked) {
      try {
        const [rows] = await db.query("SELECT RELEASE_LOCK(?) AS released", [LOCK]);
        if (!lockSuccess(rows, "released")) throw new Error("MIGRATION_LOCK_RELEASE_FAILED");
      } catch (cause) {
        const releaseError = cause?.message === "MIGRATION_LOCK_RELEASE_FAILED" ? cause :
          new Error("MIGRATION_LOCK_RELEASE_FAILED", { cause });
        if (failure) throw new AggregateError([failure, releaseError], "MIGRATION_AND_LOCK_RELEASE_FAILED");
        throw releaseError;
      }
    }
  }
}

// Contract used by development-migration-proof.mjs and controlled-migration-runner.mjs.
export async function runTakeoffDetailsMigration(directory, {
  databaseUrl = process.env.DATABASE_URL,
  readFile = fs.readFile,
  createConnection = mysql.createConnection,
  expectedShas = TAKEOFF_DETAILS_MIGRATIONS.map(spec => spec.sha256),
  verifyOnly = false,
  dialect = "mysql8",
} = {}) {
  validOptions({ verifyOnly, dialect });
  if (typeof directory !== "string" || !directory || typeof databaseUrl !== "string" || !databaseUrl ||
      typeof readFile !== "function" || typeof createConnection !== "function" ||
      !Array.isArray(expectedShas) || expectedShas.length !== 1) throw new Error("INVALID_CONFIGURATION");
  const sources = [{ file: TAKEOFF_DETAILS_MIGRATION.file,
    bytes: await readFile(path.join(directory, TAKEOFF_DETAILS_MIGRATION.file)), expectedSha: expectedShas[0] }];
  validateTakeoffDetailsMigration(sources); // No connection until filename/hash/SQL are all approved.
  const db = await createConnection(databaseUrl);
  let failure;
  try { return await applyTakeoffDetailsMigration(db, sources, { verifyOnly, dialect }); }
  catch (error) { failure = error; throw error; }
  finally {
    try { await db.end(); }
    catch (closeError) {
      if (failure) throw new AggregateError([failure, closeError], "MIGRATION_AND_CONNECTION_CLOSE_FAILED");
      throw new Error("MIGRATION_CONNECTION_CLOSE_FAILED", { cause: closeError });
    }
  }
}

export function parseTakeoffDetailsMigrationArguments(args) {
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
// A filename guard is essential: import.meta.url becomes the wrapper URL in an ESM bundle.
// Merely comparing import.meta.url with argv[1] would accidentally run CLI inside that wrapper.
if (process.argv[1] && path.basename(process.argv[1]) === "apply-takeoff-details-migration.mjs" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { directory, ...options } = parseTakeoffDetailsMigrationArguments(process.argv.slice(2));
    const { config } = await import("dotenv");
    config({ quiet: true, override: false }); // CLI only; existing process DATABASE_URL wins.
    console.log(JSON.stringify(await runTakeoffDetailsMigration(directory, options)));
  } catch {
    // Never expose credentials, URLs, SQL, business data or raw driver errors in CLI output.
    console.error("工程量明细迁移/核验未完成：请核对0101固定摘要、MySQL8锁及基表/三列精确元数据。DDL隐式提交，不能事务回滚；部分完成须严格核验后重试。TiDB仅可显式 --verify-only --dialect=tidb 核验，缺列也失败，禁止DDL。历史字段、数据和迁移记录不写入不回填。");
    process.exitCode = 1;
  }
}
