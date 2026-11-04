import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
const allowedTables = new Set([
  "vehicle_access_grants",
  "vehicle_assignments",
  "vehicle_changes",
  "vehicle_documents",
  "vehicle_fleet_profiles",
  "vehicle_inspections",
  "vehicle_maintenance_plans",
  "vehicle_special_records",
  "vehicle_work_orders",
]);
const cleanType = value =>
  String(value)
    .toLowerCase()
    .replace(/\b(bigint|int)\(\d+\)/g, "$1")
    .replace(/^boolean$/, "tinyint(1)");
const cleanDefault = value =>
  value == null
    ? null
    : String(value)
        .toLowerCase()
        .replace(/^'|'$/g, "")
        .replace(
          /^\(now\(\)\)$|^current_timestamp(?:\(\))?$/,
          "current_timestamp"
        )
        .replace(/^false$/, "0")
        .replace(/^true$/, "1");
let db,
  locked = false;
async function columns(table) {
  const [rows] = await db.query(
    "SELECT column_name AS name,column_type AS type,is_nullable AS nullable,column_default AS defaultValue,extra FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position",
    [table]
  );
  return rows;
}
async function indices(table) {
  const [rows] = await db.query(
    "SELECT index_name AS name,column_name AS columnName,non_unique AS nonUnique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY index_name,seq_in_index",
    [table]
  );
  return rows;
}
function assertColumns(actual, expected) {
  if (actual.length !== expected.length) throw Error("EXISTING_SHAPE_MISMATCH");
  for (const e of expected) {
    const r = actual.find(a => a.name === e.name);
    if (
      !r ||
      cleanType(r.type) !== cleanType(e.type) ||
      r.nullable !== e.nullable ||
      cleanDefault(r.defaultValue) !== cleanDefault(e.defaultValue) ||
      Boolean(/auto_increment/i.test(r.extra)) !== e.autoIncrement
    )
      throw Error("EXISTING_SHAPE_MISMATCH");
  }
}
function assertIndex(actual, name, fields, unique) {
  const r = actual.filter(a => a.name === name);
  if (
    r.length !== fields.length ||
    r.some(
      (a, i) =>
        a.columnName !== fields[i] || Number(a.nonUnique) !== (unique ? 0 : 1)
    )
  )
    throw Error("EXISTING_SHAPE_MISMATCH");
}
try {
  const [file, sha, mode] = process.argv.slice(2);
  if (
    path.basename(file ?? "") !== "0094_majestic_mastermind.sql" ||
    !/^[a-f0-9]{64}$/.test(sha ?? "") ||
    (mode && mode !== "--verify-only")
  )
    throw Error("INVALID_INPUT");
  const bytes = await fs.readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== sha)
    throw Error("MIGRATION_SHA_MISMATCH");
  const statements = bytes
    .toString()
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(Boolean);
  if (statements.length !== 21) throw Error("UNEXPECTED_STATEMENT");
  const tables = new Map(),
    plans = [];
  for (const sql of statements) {
    const t = sql.match(/^CREATE TABLE `([a-z_]+)` \(([\s\S]+)\);$/);
    if (t) {
      if (!allowedTables.has(t[1]) || tables.has(t[1]))
        throw Error("UNEXPECTED_STATEMENT");
      const cols = [],
        keys = [];
      for (const raw of t[2].split("\n")) {
        const line = raw.trim().replace(/,$/, "");
        if (!line) continue;
        const c = line.match(
          /^`([A-Za-z][A-Za-z0-9]*)` (int|bigint|boolean|json|datetime|date|timestamp|varchar\(\d+\)|decimal\(\d+,\d+\)|enum\('[a-z_]+'(?:,'[a-z_]+')*\))([\s\S]*)$/
        );
        if (c) {
          const d = c[3].match(/ DEFAULT (\(now\(\)\)|'[^']*'|false|true|\d+)/);
          cols.push({
            name: c[1],
            type: c[2],
            nullable: c[3].includes("NOT NULL") ? "NO" : "YES",
            defaultValue: d?.[1] ?? null,
            autoIncrement: c[3].includes("AUTO_INCREMENT"),
          });
          continue;
        }
        const k = line.match(
          /^CONSTRAINT `[A-Za-z_]+` (PRIMARY KEY|UNIQUE)\((`[A-Za-z][A-Za-z0-9]*`(?:,`[A-Za-z][A-Za-z0-9]*`)*)\)$/
        );
        if (!k) throw Error("UNEXPECTED_STATEMENT");
        keys.push({
          name:
            k[1] === "PRIMARY KEY"
              ? "PRIMARY"
              : line.match(/^CONSTRAINT `([A-Za-z_]+)`/)[1],
          fields: Array.from(
            k[2].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g),
            m => m[1]
          ),
        });
      }
      if (!cols.length || !keys.some(k => k.name === "PRIMARY"))
        throw Error("UNEXPECTED_STATEMENT");
      tables.set(t[1], { cols, keys });
      plans.push({ sql, table: t[1] });
      continue;
    }
    const i = sql.match(
      /^CREATE INDEX `([a-z_]+)` ON `([a-z_]+)` \((`[A-Za-z][A-Za-z0-9]*`(?:,`[A-Za-z][A-Za-z0-9]*`)*)\);$/
    );
    if (!i || !allowedTables.has(i[2])) throw Error("UNEXPECTED_STATEMENT");
    plans.push({
      sql,
      table: i[2],
      index: i[1],
      fields: Array.from(i[3].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g), m => m[1]),
    });
  }
  if (tables.size !== 9 || plans.filter(p => p.index).length !== 12)
    throw Error("UNEXPECTED_STATEMENT");
  if (!process.env.DATABASE_URL) throw Error("DATABASE_NOT_CONFIGURED");
  db = await mysql.createConnection(process.env.DATABASE_URL);
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('yx_vehicle_management_0094',10) AS acquired"
  );
  if (Number(lock.acquired) !== 1) throw Error("MIGRATION_LOCKED");
  locked = true;
  let applied = 0,
    skipped = 0;
  for (const plan of plans) {
    const existing = plan.index
      ? (await indices(plan.table)).filter(r => r.name === plan.index)
      : await columns(plan.table);
    if (existing.length) {
      if (plan.index) assertIndex(existing, plan.index, plan.fields, false);
      else {
        const def = tables.get(plan.table);
        assertColumns(existing, def.cols);
        const keys = await indices(plan.table);
        for (const key of def.keys)
          assertIndex(keys, key.name, key.fields, true);
      }
      skipped++;
    } else {
      if (mode === "--verify-only") throw Error("MISSING_MIGRATION_STRUCTURE");
      await db.query(plan.sql);
      applied++;
    }
  }
  let checkedColumns = 0,
    uniqueKeys = 0;
  for (const [table, def] of tables) {
    assertColumns(await columns(table), def.cols);
    checkedColumns += def.cols.length;
    const ix = await indices(table);
    for (const key of def.keys) {
      assertIndex(ix, key.name, key.fields, true);
      uniqueKeys++;
    }
  }
  for (const p of plans.filter(p => p.index))
    assertIndex(await indices(p.table), p.index, p.fields, false);
  console.log(
    JSON.stringify({
      ok: true,
      migration: "0094",
      sha256: sha,
      applied,
      skipped,
      tables: tables.size,
      checkedColumns,
      uniqueKeys,
      nonUniqueIndices: 12,
      verified: true,
      historicalDataRewritten: false,
    })
  );
} catch (e) {
  const allowed = new Set([
    "INVALID_INPUT",
    "MIGRATION_SHA_MISMATCH",
    "UNEXPECTED_STATEMENT",
    "DATABASE_NOT_CONFIGURED",
    "MIGRATION_LOCKED",
    "EXISTING_SHAPE_MISMATCH",
    "MISSING_MIGRATION_STRUCTURE",
  ]);
  console.error(
    JSON.stringify({
      ok: false,
      code: allowed.has(e.message) ? e.message : "MIGRATION_EXECUTION_FAILED",
    })
  );
  process.exitCode = 1;
} finally {
  if (db) {
    if (locked)
      await db
        .query("SELECT RELEASE_LOCK('yx_vehicle_management_0094')")
        .catch(() => {});
    await db.end();
  }
}
