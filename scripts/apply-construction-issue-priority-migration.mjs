import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

export const CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE =
  "0098_clumsy_big_bertha.sql";
export const CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_SHA256 =
  "461f61e1d8a35f7d59748aa899cea43437125360c89510d691383e95786772df";
const STATEMENT =
  "ALTER TABLE `construction_daily_reports` ADD `issuePriority` enum('normal','urgent');";
const LOCK = "yx_construction_issue_priority_0098";

export function validateIssuePriorityMigration(bytes, expectedSha) {
  if (!Buffer.isBuffer(bytes)) throw new Error("INVALID_MIGRATION_BYTES");
  const sha = createHash("sha256").update(bytes).digest("hex");
  // A caller-supplied hash cannot authorize other bytes, defaults or UPDATEs.
  if (
    expectedSha !== CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_SHA256 ||
    sha !== expectedSha
  )
    throw new Error("MIGRATION_SHA_MISMATCH");
  if (bytes.toString("utf8").trim() !== STATEMENT)
    throw new Error("UNEXPECTED_STATEMENT");
  return sha;
}
export function assertIssuePriorityColumn(column) {
  if (
    !column ||
    String(column.type).toLowerCase() !== "enum('normal','urgent')" ||
    String(column.dataType).toLowerCase() !== "enum" ||
    column.nullable !== "YES" ||
    column.defaultValue !== null ||
    column.extraValue !== "" ||
    !(
      column.generationExpression === "" || column.generationExpression === null
    )
  )
    throw new Error("EXISTING_SHAPE_MISMATCH");
}
async function readColumn(db) {
  const [rows] = await db.query(
    "SELECT column_type AS type,data_type AS dataType,is_nullable AS nullable,column_default AS defaultValue,extra AS extraValue,generation_expression AS generationExpression FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='construction_daily_reports' AND column_name='issuePriority'"
  );
  if (rows.length > 1) throw new Error("EXISTING_SHAPE_MISMATCH");
  return rows[0] ?? null;
}
export async function applyIssuePriorityMigration(db, bytes, expectedSha) {
  const sha256 = validateIssuePriorityMigration(bytes, expectedSha);
  const [locks] = await db.query(`SELECT GET_LOCK('${LOCK}', 30) AS acquired`);
  if (!(locks[0]?.acquired === 1 || locks[0]?.acquired === "1"))
    throw new Error("MIGRATION_BUSY");
  let failure;
  try {
    const [database] = await db.query("SELECT DATABASE() AS databaseName");
    if (
      typeof database[0]?.databaseName !== "string" ||
      !database[0].databaseName
    )
      throw new Error("DATABASE_NOT_CONFIGURED");
    const [tables] = await db.query(
      "SELECT table_type AS tableType FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='construction_daily_reports'"
    );
    if (tables.length !== 1 || tables[0].tableType !== "BASE TABLE")
      throw new Error("EXISTING_SHAPE_MISMATCH");
    let column = await readColumn(db);
    let applied = false;
    if (column) assertIssuePriorityColumn(column);
    else {
      // MySQL DDL implicitly commits; do not claim transactional rollback or
      // write business records / migration history independently of Drizzle.
      try {
        await db.query(STATEMENT);
        applied = true;
      } catch (error) {
        if (!(error?.errno === 1060 || error?.code === "ER_DUP_FIELDNAME"))
          throw error;
        assertIssuePriorityColumn(await readColumn(db));
      }
    }
    column = await readColumn(db);
    assertIssuePriorityColumn(column);
    return {
      ok: true,
      migration: "0098",
      sha256,
      applied,
      verified: true,
      nullable: true,
      historyUnchanged: true,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      const [released] = await db.query(
        `SELECT RELEASE_LOCK('${LOCK}') AS released`
      );
      if (!(released[0]?.released === 1 || released[0]?.released === "1"))
        throw new Error("MIGRATION_LOCK_RELEASE_FAILED");
    } catch (releaseError) {
      if (failure)
        throw new AggregateError(
          [failure, releaseError],
          "MIGRATION_AND_LOCK_RELEASE_FAILED"
        );
      throw releaseError;
    }
  }
}
export async function runIssuePriorityMigration(
  file,
  expectedSha,
  {
    databaseUrl = process.env.DATABASE_URL,
    readFile = fs.readFile,
    createConnection = mysql.createConnection,
  } = {}
) {
  if (
    typeof file !== "string" ||
    path.basename(file) !== CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE ||
    typeof databaseUrl !== "string" ||
    !databaseUrl
  )
    throw new Error("INVALID_CONFIGURATION");
  const bytes = await readFile(file);
  validateIssuePriorityMigration(bytes, expectedSha); // Always before connection.
  const db = await createConnection(databaseUrl);
  try {
    return await applyIssuePriorityMigration(db, bytes, expectedSha);
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 4) throw new Error("INVALID_CONFIGURATION");
    const [file, expectedSha] = process.argv.slice(2);
    console.log(
      JSON.stringify(await runIssuePriorityMigration(file, expectedSha))
    );
  } catch {
    // Never emit credentials, URLs, raw SQL/driver errors or business text.
    console.error(
      "问题等级迁移未完成；请检查受控配置及可空枚举结构。DDL不能事务回滚，已新增列可验结构后安全重试；历史正文、安全、等级与状态未回写。"
    );
    process.exitCode = 1;
  }
}
