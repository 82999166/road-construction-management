import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

// Bind this exact basename to the reviewed 0097 SQL before release.
export const PERSONNEL_CLASSIFICATION_MIGRATION_FILE = "0097_late_the_fallen.sql";
const LOCK = "yx_personnel_classification_0097";
const TABLES = ["personnel_people", "personnel_salary_history"];
const COLUMNS = [
  { name: "salaryPayerType", length: 24 },
  { name: "salaryPayerName", length: 128 },
];
// Deliberately pure, fixed data: Node must not load TS runtime dependencies.
// Regression tests assert equality with shared/personnel.ts.
export const PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS = Object.freeze([
  { name: "项目经理", category: "management" },
  { name: "行政管理", category: "management" },
  { name: "技术员", category: "technical" },
  { name: "施工员", category: "technical" },
  { name: "安全员", category: "technical" },
  { name: "会计", category: "business" },
  { name: "采购员", category: "business" },
  { name: "材料员", category: "business" },
  { name: "运输司机", category: "driver" },
  { name: "机械操作员", category: "operator" },
  { name: "施工工人", category: "construction" },
  { name: "其他岗位", category: "other" },
  { name: "碴土车驾驶员", category: "driver" },
  { name: "推土机驾驶员", category: "operator" },
  { name: "小车驾驶员", category: "driver" },
  { name: "公司管理员", category: "management" },
  { name: "劳务人员", category: "construction" },
  { name: "临时工", category: "construction" },
  { name: "挖掘机驾驶员", category: "operator" },
  { name: "装载机驾驶员", category: "operator" },
  { name: "压路机驾驶员", category: "operator" },
  { name: "其他机械驾驶员", category: "operator" },
  { name: "车队负责人", category: "management" },
].map(position => Object.freeze(position)));

export function createPlan(bytes, expectedSha) {
  if (!Buffer.isBuffer(bytes)) throw new Error("INVALID_MIGRATION_BYTES");
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (typeof expectedSha !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha) || sha !== expectedSha)
    throw new Error("MIGRATION_SHA_MISMATCH");
  // A matching caller-supplied hash NEVER authorizes arbitrary SQL. Parse only
  // this tiny grammar, require all four additions exactly once, then execute
  // generated fixed statements rather than any untrusted source text.
  const text = bytes.toString("utf8").replaceAll("--> statement-breakpoint", " ").trim();
  if (!text.endsWith(";")) throw new Error("UNEXPECTED_STATEMENT");
  const statements = text.slice(0, -1).split(";");
  const seen = new Set();
  for (const statement of statements) {
    const match = /^\s*ALTER\s+TABLE\s+(`?)(personnel_people|personnel_salary_history)\1\s+([\s\S]+?)\s*$/i.exec(statement);
    if (!match || !TABLES.includes(match[2])) throw new Error("UNEXPECTED_STATEMENT");
    for (const addition of match[3].split(",")) {
      const field = /^\s*ADD\s+(?:COLUMN\s+)?(`?)(salaryPayerType|salaryPayerName)\1\s+varchar\s*\(\s*(24|128)\s*\)(?:\s+NULL)?(?:\s+DEFAULT\s+NULL)?\s*$/i.exec(addition);
      const expected = field && COLUMNS.find(column => column.name === field[2]);
      const key = `${match[2]}.${field?.[2]}`;
      if (!expected || Number(field[3]) !== expected.length || seen.has(key))
        throw new Error("UNEXPECTED_STATEMENT");
      seen.add(key);
    }
  }
  if (seen.size !== 4) throw new Error("UNEXPECTED_STATEMENT");
  return TABLES.flatMap(table => COLUMNS.map(column => ({
    table,
    ...column,
    key: `${table}.${column.name}`,
    sql: `ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` varchar(${column.length}) NULL DEFAULT NULL;`,
  })));
}

export function assertPersonnelClassificationColumn(column, expected) {
  if (!column || !expected ||
      String(column.type).toLowerCase() !== `varchar(${expected.length})` ||
      String(column.dataType).toLowerCase() !== "varchar" ||
      !(column.length === expected.length || column.length === String(expected.length)) ||
      column.nullable !== "YES" || column.defaultValue !== null ||
      column.extraValue !== "" ||
      !(column.generationExpression === "" || column.generationExpression === null))
    throw new Error("EXISTING_SHAPE_MISMATCH");
}

async function readColumn(db, plan) {
  const [rows] = await db.query(
    "SELECT column_type AS type,data_type AS dataType,character_maximum_length AS length,is_nullable AS nullable,column_default AS defaultValue,extra AS extraValue,generation_expression AS generationExpression FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
    [plan.table, plan.name]
  );
  if (rows.length > 1) throw new Error("EXISTING_SHAPE_MISMATCH");
  return rows[0] ?? null;
}

async function preflightTables(db) {
  const [database] = await db.query("SELECT DATABASE() AS databaseName");
  if (typeof database[0]?.databaseName !== "string" || !database[0].databaseName)
    throw new Error("DATABASE_NOT_CONFIGURED");
  for (const table of [...TABLES, "personnel_positions"]) {
    const [rows] = await db.query(
      "SELECT table_type AS tableType,engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
      [table]
    );
    if (rows.length !== 1 || rows[0].tableType !== "BASE TABLE" ||
        (table === "personnel_positions" && String(rows[0].engine).toLowerCase() !== "innodb"))
      throw new Error("EXISTING_SHAPE_MISMATCH");
  }
  const [indexes] = await db.query(
    "SELECT index_name AS name,column_name AS columnName,non_unique AS nonUnique,seq_in_index AS sequence,sub_part AS subPart FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='personnel_positions' ORDER BY index_name,seq_in_index"
  );
  const groups = new Map();
  for (const row of indexes) {
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push(row);
  }
  const fullNameUnique = [...groups.values()].some(rows => rows.length === 1 &&
    rows[0].columnName === "name" && (rows[0].nonUnique === 0 || rows[0].nonUnique === "0") &&
    (rows[0].sequence === 1 || rows[0].sequence === "1") && rows[0].subPart === null);
  if (!fullNameUnique) throw new Error("POSITION_NAME_UNIQUE_REQUIRED");
}

async function readPosition(db, name) {
  // Locking reads are current reads under MySQL REPEATABLE READ: a precise
  // re-read after ER_DUP_ENTRY must not use an earlier consistent snapshot.
  const [rows] = await db.execute(
    "SELECT id,name,category,status FROM `personnel_positions` WHERE `name`=? FOR UPDATE", [name]
  );
  if (rows.length > 1 || (rows[0] && rows[0].name !== name))
    throw new Error("POSITION_NAME_MISMATCH");
  return rows[0] ?? null;
}

async function seedPositions(db) {
  await db.beginTransaction();
  try {
    let inserted = 0;
    let preserved = 0;
    for (const position of PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS) {
      if (await readPosition(db, position.name)) {
        preserved++;
        continue;
      }
      try {
        const [result] = await db.execute(
          "INSERT INTO `personnel_positions` (`name`,`category`,`status`) VALUES (?,?,'active')",
          [position.name, position.category]
        );
        if (result.affectedRows !== 1) throw new Error("POSITION_INSERT_FAILED");
        inserted++;
      } catch (error) {
        // Neither INSERT IGNORE nor ON DUPLICATE KEY UPDATE nor REPLACE. A
        // duplicate on an unrelated unique constraint is NOT a preserved name.
        if (!(error?.errno === 1062 || error?.code === "ER_DUP_ENTRY")) throw error;
        if (!(await readPosition(db, position.name))) throw error;
        preserved++;
      }
    }
    let totalDefaultsVerified = 0;
    for (const { name } of PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS) {
      if (!(await readPosition(db, name))) throw new Error("POSITION_DEFAULTS_MISSING");
      totalDefaultsVerified++;
    }
    await db.commit();
    return { inserted, preserved, totalDefaultsVerified };
  } catch (error) {
    try { await db.rollback(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "POSITION_ROLLBACK_FAILED");
    }
    throw error;
  }
}

export async function applyPersonnelClassificationMigration(db, bytes, expectedSha) {
  const plans = createPlan(bytes, expectedSha);
  const [locks] = await db.query(`SELECT GET_LOCK('${LOCK}', 30) AS acquired`);
  if (!(locks[0]?.acquired === 1 || locks[0]?.acquired === "1"))
    throw new Error("MIGRATION_BUSY");
  let failure;
  try {
    await preflightTables(db);
    const states = new Map();
    // Preflight ALL existing columns before ANY DDL; never repair drift.
    for (const plan of plans) {
      const column = await readColumn(db, plan);
      if (column) assertPersonnelClassificationColumn(column, plan);
      states.set(plan.key, { applied: false, verified: false, exists: Boolean(column) });
    }
    // DDL implicitly commits: prior successful ADDs survive later failures.
    // Retries verify these exact shapes and only add remaining absent columns.
    for (const plan of plans) {
      const state = states.get(plan.key);
      if (!state.exists) {
        const current = await readColumn(db, plan);
        if (current) assertPersonnelClassificationColumn(current, plan);
        else {
          try {
            await db.execute(plan.sql);
            state.applied = true;
          } catch (error) {
            if (!(error?.errno === 1060 || error?.code === "ER_DUP_FIELDNAME")) throw error;
            assertPersonnelClassificationColumn(await readColumn(db, plan), plan);
          }
        }
      }
      assertPersonnelClassificationColumn(await readColumn(db, plan), plan);
      state.verified = true;
    }
    const positions = await seedPositions(db);
    return {
      columns: Object.fromEntries(plans.map(({ key }) => {
        const { applied, verified } = states.get(key);
        return [key, { applied, verified }];
      })),
      positions,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      const [released] = await db.query(`SELECT RELEASE_LOCK('${LOCK}') AS released`);
      if (!(released[0]?.released === 1 || released[0]?.released === "1"))
        throw new Error("MIGRATION_LOCK_RELEASE_FAILED");
    } catch (releaseError) {
      if (failure) throw new AggregateError([failure, releaseError], "MIGRATION_AND_LOCK_RELEASE_FAILED");
      throw releaseError;
    }
  }
}

export async function runPersonnelClassificationMigration(file, expectedSha, {
  databaseUrl = process.env.DATABASE_URL,
  readFile = fs.readFile,
  createConnection = mysql.createConnection,
} = {}) {
  if (typeof file !== "string" || path.basename(file) !== PERSONNEL_CLASSIFICATION_MIGRATION_FILE ||
      typeof databaseUrl !== "string" || !databaseUrl)
    throw new Error("INVALID_CONFIGURATION");
  const bytes = await readFile(file);
  createPlan(bytes, expectedSha); // Validate before opening any connection.
  const db = await createConnection(databaseUrl);
  try {
    return await applyPersonnelClassificationMigration(db, bytes, expectedSha);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("INVALID_CONFIGURATION");
    const [file, expectedSha] = process.argv.slice(2);
    console.log(JSON.stringify(await runPersonnelClassificationMigration(file, expectedSha)));
  } catch {
    // Do not expose DATABASE_URL, raw driver errors, SQL, or connection details.
    console.error("人员分类迁移未完成；请检查受控配置、四列结构及岗位字典。DDL不能事务回滚，已新增列可验结构后安全重试；既有人员和薪资历史未回写，既有岗位配置不覆盖。");
    process.exitCode = 1;
  }
}
