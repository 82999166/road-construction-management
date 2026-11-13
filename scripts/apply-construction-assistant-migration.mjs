import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

export const CONSTRUCTION_ASSISTANT_MIGRATION_FILE = "0096_cold_sentinel.sql";
// Pinned to the real, reviewed migration bytes, not a digest supplied by the caller.
export const CONSTRUCTION_ASSISTANT_MIGRATION_SHA256 =
  "99a2ea6a9b77dea193346f25c4eedde57f6fe0ebf4cac0b9e963700d9cd965c3";
const LOCK = "yx_construction_assistant_0096";
const TABLES = [
  "construction_assistant_daily_usage",
  "construction_input_memory",
];
const column = (name, type, defaultValue = null, extraValue = "") => ({
  name,
  type,
  nullable: "NO",
  defaultValue,
  extraValue,
});
const index = (name, fields, unique = true) => ({ name, fields, unique });
const shapes = {
  construction_assistant_daily_usage: {
    columns: [
      column("id", "bigint", null, "auto_increment"),
      column("userId", "int"),
      column("usageDate", "date"),
      column("channel", "enum('ai','voice')"),
      column("attemptCount", "int", "0"),
      column("createdAt", "timestamp", "current_timestamp"),
      column(
        "updatedAt",
        "timestamp",
        "current_timestamp",
        "on update current_timestamp"
      ),
    ],
    indexes: [
      index("PRIMARY", ["id"]),
      index("construction_assistant_usage_user_date_channel_unique", [
        "userId",
        "usageDate",
        "channel",
      ]),
    ],
  },
  construction_input_memory: {
    columns: [
      column("id", "bigint", null, "auto_increment"),
      column("userId", "int"),
      column("projectId", "int"),
      column("field", "varchar(32)"),
      column("content", "text"),
      column("contentHash", "varchar(64)"),
      column("usedAt", "timestamp", "current_timestamp"),
      column("createdAt", "timestamp", "current_timestamp"),
    ],
    indexes: [
      index("PRIMARY", ["id"]),
      index("construction_input_memory_user_project_field_hash_unique", [
        "userId",
        "projectId",
        "field",
        "contentHash",
      ]),
      index(
        "construction_input_memory_recent_index",
        ["userId", "projectId", "field", "usedAt"],
        false
      ),
    ],
  },
};

export function validateConstructionAssistantMigration(bytes, expectedSha) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (
    typeof expectedSha !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedSha) ||
    sha !== expectedSha
  )
    throw new Error("MIGRATION_SHA_MISMATCH");
  // Even a matching externally supplied digest cannot authorize different SQL.
  if (sha !== CONSTRUCTION_ASSISTANT_MIGRATION_SHA256)
    throw new Error("UNEXPECTED_STATEMENT");
  return sha;
}

function createPlan(bytes, expectedSha) {
  validateConstructionAssistantMigration(bytes, expectedSha);
  const statements = bytes
    .toString("utf8")
    .split("--> statement-breakpoint")
    .map(s => s.trim());
  if (statements.length !== 3) throw new Error("UNEXPECTED_STATEMENT");
  for (const [i, table] of TABLES.entries()) {
    if (
      !statements[i].startsWith(`CREATE TABLE \`${table}\` (\n`) ||
      !statements[i].endsWith("\n);")
    )
      throw new Error("UNEXPECTED_STATEMENT");
  }
  const approvedIndex =
    "CREATE INDEX `construction_input_memory_recent_index` ON `construction_input_memory` (`userId`,`projectId`,`field`,`usedAt`);";
  if (statements[2] !== approvedIndex) throw new Error("UNEXPECTED_STATEMENT");
  // The reviewed file has a separate CREATE INDEX. Inline that exact index so
  // each CREATE produces a complete table: no retry ever needs ALTER/DROP or
  // repair of a half-built existing table. Only these two CREATEs are executed.
  return TABLES.map((table, i) => ({
    table,
    sql:
      i === 0
        ? statements[i]
        : statements[i].replace(
            /\n\);$/,
            ",\n\tINDEX `construction_input_memory_recent_index` (`userId`,`projectId`,`field`,`usedAt`)\n);"
          ),
  }));
}

function isCurrentTimestamp(value) {
  if (typeof value !== "string") return false;
  const text = value.toLowerCase().trim();
  // Zero precision only; nonzero precision and arbitrary expressions drift.
  return (
    /^(?:now\((?:0)?\)|current_timestamp(?:\((?:0)?\))?)$/.test(text) ||
    /^\((?:now\((?:0)?\)|current_timestamp(?:\((?:0)?\))?)\)$/.test(text)
  );
}

function sameDefault(actual, expected) {
  if (expected === null) return actual === null;
  if (expected === "current_timestamp") return isCurrentTimestamp(actual);
  // Do not lowercase/strip quotes or otherwise coerce unrelated defaults.
  return actual === expected || (expected === "0" && actual === 0);
}

function sameExtra(actual, expected, timestampDefault) {
  if (typeof actual !== "string") return false;
  let extra = actual.trim().toLowerCase();
  // MySQL 8 annotates expression defaults; this is metadata, not a drift.
  if (timestampDefault && /^default_generated(?: |$)/.test(extra))
    extra = extra.replace(/^default_generated(?: |$)/, "");
  if (expected === "on update current_timestamp") {
    return (
      extra.startsWith("on update ") && isCurrentTimestamp(extra.slice(10))
    );
  }
  return extra === expected;
}

const sameInteger = (actual, expected) =>
  actual === expected || actual === String(expected);

export function assertConstructionAssistantShape(table, actual) {
  const expected = shapes[table];
  const mismatch = () => {
    throw new Error("EXISTING_SHAPE_MISMATCH");
  };
  if (
    !expected ||
    !actual ||
    actual.tableType !== "BASE TABLE" ||
    actual.columns.length !== expected.columns.length
  )
    mismatch();
  for (const [i, e] of expected.columns.entries()) {
    const a = actual.columns[i];
    // enum labels are case-sensitive; do not normalize them or integer widths.
    if (
      !a ||
      a.name !== e.name ||
      a.type !== e.type ||
      !sameInteger(a.position, i + 1) ||
      a.nullable !== e.nullable ||
      !sameDefault(a.defaultValue, e.defaultValue) ||
      !sameExtra(
        a.extraValue,
        e.extraValue,
        e.defaultValue === "current_timestamp"
      ) ||
      a.generationExpression !== ""
    )
      mismatch();
  }
  const expectedRows = expected.indexes.reduce(
    (n, e) => n + e.fields.length,
    0
  );
  if (actual.indexes.length !== expectedRows) mismatch();
  for (const e of expected.indexes) {
    const rows = actual.indexes.filter(a => a.name === e.name);
    if (rows.length !== e.fields.length) mismatch();
    for (const [i, a] of rows.entries()) {
      if (
        a.columnName !== e.fields[i] ||
        !sameInteger(a.sequence, i + 1) ||
        !sameInteger(a.nonUnique, e.unique ? 0 : 1) ||
        a.subPart !== null ||
        a.collation !== "A" ||
        a.indexType !== "BTREE"
      )
        mismatch();
    }
  }
}

async function readShape(db, table) {
  const [tables] = await db.query(
    "SELECT table_type AS tableType FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
    [table]
  );
  const [columns] = await db.query(
    "SELECT column_name AS name,column_type AS type,is_nullable AS nullable,column_default AS defaultValue,extra AS extraValue,ordinal_position AS position,generation_expression AS generationExpression FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position",
    [table]
  );
  const [indexes] = await db.query(
    "SELECT index_name AS name,column_name AS columnName,non_unique AS nonUnique,seq_in_index AS sequence,sub_part AS subPart,collation AS collation,index_type AS indexType FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY index_name,seq_in_index",
    [table]
  );
  if (tables.length === 0 && columns.length === 0 && indexes.length === 0)
    return null;
  if (tables.length !== 1) throw new Error("EXISTING_SHAPE_MISMATCH");
  return { tableType: tables[0].tableType, columns, indexes };
}

export async function applyConstructionAssistantMigration(
  db,
  bytes,
  expectedSha
) {
  // All file/SQL checks run before even acquiring a database lock.
  const plans = createPlan(bytes, expectedSha);
  const [locks] = await db.query(`SELECT GET_LOCK('${LOCK}', 30) AS acquired`);
  if (locks[0]?.acquired !== 1 && locks[0]?.acquired !== "1")
    throw new Error("MIGRATION_BUSY");
  try {
    const [database] = await db.query("SELECT DATABASE() AS databaseName");
    if (
      typeof database[0]?.databaseName !== "string" ||
      !database[0].databaseName
    )
      throw new Error("DATABASE_NOT_CONFIGURED");
    const states = new Map();
    // Preflight BOTH tables before ANY DDL. Existing drift must never result in
    // creating the other table first, nor in automatic repair of existing data.
    for (const plan of plans) {
      const shape = await readShape(db, plan.table);
      if (shape) assertConstructionAssistantShape(plan.table, shape);
      states.set(plan.table, {
        applied: false,
        verified: false,
        exists: Boolean(shape),
      });
    }
    // MySQL DDL implicitly commits and cannot be transaction-rolled back.
    // A successful CREATE is retained if a later CREATE fails. Its full shape
    // is verified on retry, then only remaining absent tables are created.
    for (const plan of plans) {
      const state = states.get(plan.table);
      if (!state.exists) {
        // Guard against a non-cooperating creator after the preflight. Never
        // use IF NOT EXISTS, which could silently hide incompatible structure.
        const current = await readShape(db, plan.table);
        if (current) assertConstructionAssistantShape(plan.table, current);
        else {
          await db.execute(plan.sql);
          state.applied = true;
        }
      }
      assertConstructionAssistantShape(
        plan.table,
        await readShape(db, plan.table)
      );
      state.verified = true;
    }
    return {
      tables: Object.fromEntries(
        TABLES.map(table => {
          const { applied, verified } = states.get(table);
          return [table, { applied, verified }];
        })
      ),
    };
  } finally {
    await db.query(`SELECT RELEASE_LOCK('${LOCK}') AS released`);
  }
}

export async function runConstructionAssistantMigration(
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
    path.basename(file) !== CONSTRUCTION_ASSISTANT_MIGRATION_FILE ||
    typeof databaseUrl !== "string" ||
    !databaseUrl
  )
    throw new Error("INVALID_CONFIGURATION");
  const bytes = await readFile(file);
  createPlan(bytes, expectedSha);
  const db = await createConnection(databaseUrl);
  try {
    return await applyConstructionAssistantMigration(db, bytes, expectedSha);
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
      JSON.stringify(await runConstructionAssistantMigration(file, expectedSha))
    );
  } catch {
    // Never print DATABASE_URL, raw driver errors, SQL, or connection details.
    console.error(
      "施工助手迁移未完成；请检查受控配置和两表结构。MySQL DDL不能事务回滚，已创建的完整表会保留，可安全重试；不会修改旧表历史数据。"
    );
    process.exitCode = 1;
  }
}
