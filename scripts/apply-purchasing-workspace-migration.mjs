import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

const definitions = new Map([
  [
    "inventory_transactions.originalOutboundId",
    { type: "bigint", nullable: "YES" },
  ],
  [
    "inventory_transactions.costRuleVersion",
    { type: "varchar(32)", nullable: "NO", default: "legacy_v1" },
  ],
  [
    "inventory_transactions.costingUnitCost",
    { type: "decimal(24,8)", nullable: "YES" },
  ],
  [
    "inventory_transactions.exceptionReason",
    { type: "varchar(500)", nullable: "YES" },
  ],
  [
    "purchase_orders.inventoryItemName",
    { type: "varchar(200)", nullable: "YES" },
  ],
  ["purchase_orders.inventoryUnit", { type: "varchar(32)", nullable: "YES" }],
  [
    "purchase_orders.receiptExpectedQuantity",
    { type: "decimal(14,3)", nullable: "YES" },
  ],
  [
    "purchase_orders.receiptBasisReason",
    { type: "varchar(500)", nullable: "YES" },
  ],
]);
const indices = new Map([
  ["inventory_transactions_original_outbound_index", "originalOutboundId"],
  ["inventory_transactions_purchase_order_index", "purchaseOrderId"],
]);
let db,
  locked = false;
const cleanType = value =>
  String(value)
    .toLowerCase()
    .replace(/bigint\(\d+\)/, "bigint");
async function column(table, name) {
  const [rows] = await db.query(
    "SELECT column_type AS type,is_nullable AS nullable,column_default AS defaultValue FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
    [table, name]
  );
  return rows[0];
}
function assertColumn(row, expected) {
  if (
    !row ||
    cleanType(row.type) !== expected.type ||
    row.nullable !== expected.nullable ||
    (expected.default !== undefined &&
      String(row.defaultValue) !== expected.default)
  )
    throw new Error("EXISTING_SHAPE_MISMATCH");
}
async function index(name) {
  const [rows] = await db.query(
    "SELECT column_name AS name,non_unique AS nonUnique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='inventory_transactions' AND index_name=? ORDER BY seq_in_index",
    [name]
  );
  return rows;
}
function assertIndex(rows, expected) {
  if (
    rows.length !== 1 ||
    rows[0].name !== expected ||
    Number(rows[0].nonUnique) !== 1
  )
    throw new Error("EXISTING_SHAPE_MISMATCH");
}
try {
  const [file, expectedSha] = process.argv.slice(2);
  if (
    path.basename(file ?? "") !== "0093_modern_thunderbolt.sql" ||
    !/^[a-f0-9]{64}$/.test(expectedSha ?? "")
  )
    throw new Error("INVALID_INPUT");
  const bytes = await fs.readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha)
    throw new Error("MIGRATION_SHA_MISMATCH");
  const statements = bytes
    .toString()
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(Boolean);
  if (statements.length !== 10) throw new Error("UNEXPECTED_STATEMENT");
  const plans = statements.map(sql => {
    const add = sql.match(
      /^ALTER TABLE `(inventory_transactions|purchase_orders)` ADD `([A-Za-z]+)` (bigint|varchar\(\d+\)|decimal\(\d+,\d+\))( DEFAULT 'legacy_v1' NOT NULL)?;$/
    );
    if (add) {
      const key = `${add[1]}.${add[2]}`,
        expected = definitions.get(key);
      if (
        !expected ||
        expected.type !== add[3] ||
        Boolean(add[4]) !== (expected.default !== undefined)
      )
        throw new Error("UNEXPECTED_STATEMENT");
      return { sql, table: add[1], name: add[2], expected };
    }
    const idx = sql.match(
      /^CREATE INDEX `([a-z_]+)` ON `inventory_transactions` \(`([A-Za-z]+)`\);$/
    );
    if (!idx || indices.get(idx[1]) !== idx[2])
      throw new Error("UNEXPECTED_STATEMENT");
    return { sql, index: idx[1], name: idx[2] };
  });
  if (new Set(plans.map(p => p.index ?? `${p.table}.${p.name}`)).size !== 10)
    throw new Error("UNEXPECTED_STATEMENT");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  db = await mysql.createConnection(process.env.DATABASE_URL);
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('yx_purchasing_workspace_0093', 10) AS acquired"
  );
  if (Number(lock.acquired) !== 1) throw new Error("MIGRATION_LOCKED");
  locked = true;
  let applied = 0,
    skipped = 0;
  for (const plan of plans) {
    const existing = plan.index
      ? await index(plan.index)
      : await column(plan.table, plan.name);
    if (plan.index ? existing.length : existing) {
      plan.index
        ? assertIndex(existing, plan.name)
        : assertColumn(existing, plan.expected);
      skipped++;
    } else {
      await db.query(plan.sql);
      applied++;
    }
  }
  for (const [key, expected] of definitions) {
    const [table, name] = key.split(".");
    assertColumn(await column(table, name), expected);
  }
  for (const [name, field] of indices) assertIndex(await index(name), field);
  console.log(
    JSON.stringify({
      ok: true,
      migration: "0093",
      sha256: expectedSha,
      applied,
      skipped,
      compatibleColumns: 8,
      nonUniqueIndices: 2,
      historicalDataRewritten: false,
    })
  );
} catch (error) {
  const allowed = new Set([
    "INVALID_INPUT",
    "MIGRATION_SHA_MISMATCH",
    "UNEXPECTED_STATEMENT",
    "DATABASE_NOT_CONFIGURED",
    "MIGRATION_LOCKED",
    "EXISTING_SHAPE_MISMATCH",
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
  if (db) {
    if (locked)
      await db
        .query("SELECT RELEASE_LOCK('yx_purchasing_workspace_0093')")
        .catch(() => {});
    await db.end();
  }
}
