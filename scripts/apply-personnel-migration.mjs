import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

// 仅执行经门禁核验的0092人员迁移，不回放历史已手工应用的0000–0091。
// 所有DDL来自Drizzle产物；重试时只跳过已验证存在的表、字段及索引。
const migrationPath = process.argv[2];
const expectedSha = process.argv[3];
let connection;
let locked = false;
try {
  if (
    !migrationPath ||
    !/^0092_[a-z0-9_]+\.sql$/.test(path.basename(migrationPath)) ||
    !/^[a-f0-9]{64}$/.test(expectedSha ?? "")
  )
    throw new Error("INVALID_INPUT");
  const bytes = await fs.readFile(migrationPath);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha)
    throw new Error("MIGRATION_SHA_MISMATCH");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [[lock]] = await connection.query(
    "SELECT GET_LOCK('yx_personnel_migration_0092', 10) AS acquired"
  );
  if (Number(lock.acquired) !== 1) throw new Error("MIGRATION_LOCKED");
  locked = true;
  let applied = 0;
  let skipped = 0;
  const statements = bytes
    .toString("utf8")
    .split("--> statement-breakpoint")
    .map(s => s.replace(/^\s*--[^\n]*$/gm, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    let skip = false;
    const create = statement.match(/^CREATE TABLE `([a-z_]+)`/);
    const alter = statement.match(
      /^ALTER TABLE `([a-z_]+)` ADD `([a-zA-Z]+)` int;/
    );
    const index = statement.match(/^CREATE INDEX `([a-z_]+)` ON `([a-z_]+)`/);
    if (create) {
      if (!create[1].startsWith("personnel_"))
        throw new Error("UNEXPECTED_TABLE");
      const [[row]] = await connection.query(
        "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
        [create[1]]
      );
      skip = Number(row.count) > 0;
      if (skip) {
        const [columns] = await connection.query(
          "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?",
          [create[1]]
        );
        const present = new Set(columns.map(row => row.name));
        const required = Array.from(
          statement.matchAll(/^\s*`([^`]+)`\s+/gm)
        ).map(match => match[1]);
        if (required.some(name => !present.has(name)))
          throw new Error("EXISTING_TABLE_SHAPE_MISMATCH");
      }
    } else if (alter) {
      if (
        !(
          (alter[1] === "machines" && alter[2] === "operatorPersonId") ||
          (alter[1] === "transport_vehicles" && alter[2] === "driverPersonId")
        )
      )
        throw new Error("UNEXPECTED_COLUMN");
      const [rows] = await connection.query(
        "SELECT data_type AS type,is_nullable AS nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
        [alter[1], alter[2]]
      );
      skip = rows.length > 0;
      if (skip && (rows[0].type !== "int" || rows[0].nullable !== "YES"))
        throw new Error("EXISTING_COLUMN_SHAPE_MISMATCH");
    } else if (index) {
      const [rows] = await connection.query(
        "SELECT non_unique AS nonUnique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?",
        [index[2], index[1]]
      );
      skip = rows.length > 0;
      if (skip && rows.some(row => Number(row.nonUnique) !== 1))
        throw new Error("EXISTING_INDEX_SHAPE_MISMATCH");
    } else if (statement.startsWith("INSERT INTO `personnel_positions`")) {
      const seed = statement.replace(/^INSERT INTO/, "INSERT IGNORE INTO");
      await connection.query(seed);
      applied++;
      continue;
    } else throw new Error("UNEXPECTED_STATEMENT");
    if (skip) skipped++;
    else {
      await connection.query(statement);
      applied++;
    }
  }
  const [[tables]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('personnel_assignments','personnel_changes','personnel_documents','personnel_people','personnel_positions','personnel_resource_bindings','personnel_salary_history','personnel_source_links','personnel_teams')"
  );
  const [[columns]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='machines' AND column_name='operatorPersonId') OR (table_name='transport_vehicles' AND column_name='driverPersonId')) AND is_nullable='YES'"
  );
  const [[portrait]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='personnel_documents' AND column_name='documentType' AND column_type LIKE '%portrait%'"
  );
  const [resourceIndex] = await connection.query(
    "SELECT non_unique AS nonUnique,column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='personnel_resource_bindings' AND index_name='personnel_resource_asset_date_index'"
  );
  const [[positions]] = await connection.query(
    "SELECT COUNT(*) AS count FROM personnel_positions"
  );
  if (
    Number(tables.count) !== 9 ||
    Number(columns.count) !== 2 ||
    Number(portrait.count) !== 1 ||
    resourceIndex.length !== 3 ||
    resourceIndex.some(row => Number(row.nonUnique) !== 1) ||
    Number(positions.count) < 12
  )
    throw new Error("MIGRATION_VERIFY_FAILED");
  console.log(
    JSON.stringify({
      ok: true,
      migration: path.basename(migrationPath),
      sha256: expectedSha,
      applied,
      skipped,
      tables: 9,
      nullableAssetFields: 2,
      portraitType: true,
      sameDayBindingIndex: true,
      positionDictionary: true,
    })
  );
} catch (error) {
  const allowed = new Set([
    "INVALID_INPUT",
    "MIGRATION_SHA_MISMATCH",
    "DATABASE_NOT_CONFIGURED",
    "MIGRATION_LOCKED",
    "UNEXPECTED_TABLE",
    "UNEXPECTED_COLUMN",
    "UNEXPECTED_STATEMENT",
    "EXISTING_TABLE_SHAPE_MISMATCH",
    "EXISTING_COLUMN_SHAPE_MISMATCH",
    "EXISTING_INDEX_SHAPE_MISMATCH",
    "MIGRATION_VERIFY_FAILED",
  ]);
  console.error(
    JSON.stringify({
      ok: false,
      code: allowed.has(error.message)
        ? error.message
        : "MIGRATION_EXECUTION_FAILED",
    })
  );
  process.exitCode = 1;
} finally {
  if (connection) {
    if (locked)
      await connection
        .query("SELECT RELEASE_LOCK('yx_personnel_migration_0092')")
        .catch(() => {});
    await connection.end();
  }
}
