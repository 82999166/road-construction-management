import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error 生产迁移器是受控的独立MJS CLI。
import {
  applyPlanMigration,
  validatePlanMigration,
  assertPlanColumn,
} from "../scripts/apply-construction-plan-migration.mjs";
const bytes = readFileSync(
  new URL("../drizzle/0095_eager_madrox.sql", import.meta.url)
);
const sha = createHash("sha256").update(bytes).digest("hex");
const shape = { type: "text", nullable: "YES", defaultValue: null };
function db(initial: typeof shape | null = null, lock = 1) {
  let column = initial;
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: lock }]];
      if (sql.includes("information_schema")) return [column ? [column] : []];
      if (sql.startsWith("ALTER")) {
        column = shape;
        return [{}];
      }
      return [[{ released: 1 }]];
    }),
  };
}
describe("施工计划单列安全迁移", () => {
  it("只接受当前已校验的新增可空列SQL，拒绝摘要错误或额外SQL", () => {
    expect(validatePlanMigration(bytes, sha)).toBe(sha);
    expect(() => validatePlanMigration(bytes, "0".repeat(64))).toThrow();
    const extra = Buffer.from(bytes + "DROP TABLE users;");
    expect(() =>
      validatePlanMigration(
        extra,
        createHash("sha256").update(extra).digest("hex")
      )
    ).toThrow("UNEXPECTED_STATEMENT");
  });
  it("首次应用且回读结构正确，重复执行不再ALTER", async () => {
    const connection = db();
    expect(await applyPlanMigration(connection, bytes, sha)).toMatchObject({
      applied: true,
      verified: true,
    });
    expect(await applyPlanMigration(connection, bytes, sha)).toMatchObject({
      applied: false,
      verified: true,
    });
    expect(
      connection.query.mock.calls.filter(([sql]) => sql.startsWith("ALTER"))
    ).toHaveLength(1);
    expect(
      connection.query.mock.calls.filter(([sql]) =>
        sql.includes("RELEASE_LOCK")
      )
    ).toHaveLength(2);
  });
  it.each([
    { ...shape, type: "varchar(20)" },
    { ...shape, nullable: "NO" },
    { ...shape, defaultValue: "旧值" },
  ])("既有结构漂移拒绝，不做数据修改", async column => {
    expect(() => assertPlanColumn(column)).toThrow();
    const connection = db(column);
    await expect(applyPlanMigration(connection, bytes, sha)).rejects.toThrow(
      "EXISTING_SHAPE_MISMATCH"
    );
    expect(
      connection.query.mock.calls.some(([sql]) => sql.startsWith("ALTER"))
    ).toBe(false);
    expect(
      connection.query.mock.calls.some(([sql]) => sql.includes("RELEASE_LOCK"))
    ).toBe(true);
  });
  it("不能取得迁移锁时不执行DDL", async () => {
    const connection = db(null, 0);
    await expect(applyPlanMigration(connection, bytes, sha)).rejects.toThrow(
      "MIGRATION_BUSY"
    );
    expect(
      connection.query.mock.calls.some(([sql]) => sql.startsWith("ALTER"))
    ).toBe(false);
  });
});
