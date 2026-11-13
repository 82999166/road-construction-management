import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

export function validatePlanMigration(bytes, expectedSha) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedSha ?? "") || sha !== expectedSha)
    throw new Error("MIGRATION_SHA_MISMATCH");
  if (
    bytes.toString().trim() !==
    "ALTER TABLE `construction_daily_reports` ADD `constructionPlan` text;"
  )
    throw new Error("UNEXPECTED_STATEMENT");
  return sha;
}
export function assertPlanColumn(column) {
  if (
    !column ||
    String(column.type).toLowerCase() !== "text" ||
    column.nullable !== "YES" ||
    column.defaultValue !== null
  )
    throw new Error("EXISTING_SHAPE_MISMATCH");
}
export async function applyPlanMigration(db, bytes, expectedSha) {
  const sha256 = validatePlanMigration(bytes, expectedSha);
  const [locks] = await db.query(
    "SELECT GET_LOCK('yx_construction_plan_0095', 30) AS acquired"
  );
  if (Number(locks[0]?.acquired) !== 1) throw new Error("MIGRATION_BUSY");
  const getColumn = async () => {
    const [rows] = await db.query(
      "SELECT column_type AS type,is_nullable AS nullable,column_default AS defaultValue FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='construction_daily_reports' AND column_name='constructionPlan'"
    );
    return rows[0];
  };
  try {
    let column = await getColumn();
    const existed = Boolean(column);
    if (column) assertPlanColumn(column);
    else await db.query(bytes.toString().trim());
    column = await getColumn();
    assertPlanColumn(column);
    return {
      ok: true,
      migration: "0095",
      sha256,
      applied: !existed,
      verified: true,
      nullable: true,
      historyUnchanged: true,
    };
  } finally {
    await db.query("SELECT RELEASE_LOCK('yx_construction_plan_0095')");
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let db;
  try {
    const [file, expectedSha] = process.argv.slice(2);
    if (
      path.basename(file ?? "") !== "0095_eager_madrox.sql" ||
      !process.env.DATABASE_URL
    )
      throw new Error("INVALID_CONFIGURATION");
    const bytes = await fs.readFile(file);
    validatePlanMigration(bytes, expectedSha);
    db = await mysql.createConnection(process.env.DATABASE_URL);
    console.log(
      JSON.stringify(await applyPlanMigration(db, bytes, expectedSha))
    );
  } catch {
    console.error(
      "施工计划迁移未完成，请检查受控数据库配置或字段结构；未修改历史内容。"
    );
    process.exitCode = 1;
  } finally {
    if (db) await db.end();
  }
}
