import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error 独立受控MJS迁移CLI不引入生产TS运行时。
import {
  CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE,
  CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_SHA256,
  validateIssuePriorityMigration,
  assertIssuePriorityColumn,
  applyIssuePriorityMigration,
  runIssuePriorityMigration,
} from "../scripts/apply-construction-issue-priority-migration.mjs";
const bytes = readFileSync(
  new URL("../drizzle/0098_clumsy_big_bertha.sql", import.meta.url)
);
const sha = createHash("sha256").update(bytes).digest("hex");
const shape = {
  type: "enum('normal','urgent')",
  dataType: "enum",
  nullable: "YES",
  defaultValue: null,
  extraValue: "",
  generationExpression: "",
};
function fakeDb(
  initial: typeof shape | null = null,
  options: {
    lock?: unknown;
    release?: unknown;
    failDdl?: boolean;
    duplicate?: boolean;
    duplicateShape?: typeof shape;
    invalidTable?: boolean;
    noDatabase?: boolean;
  } = {}
) {
  let column = initial;
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("GET_LOCK"))
      return [[{ acquired: options.lock === undefined ? 1 : options.lock }]];
    if (statement.includes("RELEASE_LOCK"))
      return [
        [{ released: options.release === undefined ? 1 : options.release }],
      ];
    if (statement === "SELECT DATABASE() AS databaseName")
      return [
        [{ databaseName: options.noDatabase ? null : "controlled_test" }],
      ];
    if (statement.includes("information_schema.tables"))
      return [[{ tableType: options.invalidTable ? "VIEW" : "BASE TABLE" }]];
    if (statement.includes("information_schema.columns"))
      return [column ? [column] : []];
    if (statement.startsWith("ALTER")) {
      if (options.failDdl) throw new Error("RAW_SECRET_CONNECTION_ERROR");
      column = options.duplicateShape ?? shape;
      if (options.duplicate)
        throw Object.assign(new Error("duplicate"), {
          code: "ER_DUP_FIELDNAME",
        });
      return [{}];
    }
    throw new Error("UNEXPECTED_QUERY");
  });
  return { query, end: vi.fn(async () => undefined) };
}
const ddlCalls = (db: ReturnType<typeof fakeDb>) =>
  db.query.mock.calls.filter(([query]) => query.startsWith("ALTER"));
describe("0098可空问题等级受控迁移（无真实数据库）", () => {
  it("生成SQL仅ADD可空枚举；固定摘要与journal/snapshot一致", () => {
    expect(CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE).toBe(
      "0098_clumsy_big_bertha.sql"
    );
    expect(sha).toBe(
      "461f61e1d8a35f7d59748aa899cea43437125360c89510d691383e95786772df"
    );
    expect(CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_SHA256).toBe(sha);
    expect(bytes.toString().trim()).toBe(
      "ALTER TABLE `construction_daily_reports` ADD `issuePriority` enum('normal','urgent');"
    );
    expect(validateIssuePriorityMigration(bytes, sha)).toBe(sha);
    const journal = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8"
      )
    );
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 98)).toMatchObject({
      idx: 98,
      tag: "0098_clumsy_big_bertha",
    });
    expect(journal.entries.map((entry: { idx: number }) => entry.idx)).toEqual(
      Array.from({ length: journal.entries.length }, (_, idx) => idx)
    );
    for (const entry of journal.entries) {
      expect(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8").trim()).not.toBe("");
    }
    const previous = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/0097_snapshot.json", import.meta.url),
        "utf8"
      )
    );
    const current = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/0098_snapshot.json", import.meta.url),
        "utf8"
      )
    );
    expect(current.prevId).toBe(previous.id);
    expect(
      current.tables.construction_daily_reports.columns.issuePriority
    ).toMatchObject({ type: "enum('normal','urgent')", notNull: false });
    delete current.tables.construction_daily_reports.columns.issuePriority;
    expect(current.tables).toEqual(previous.tables);
  });
  it.each([
    "UPDATE construction_daily_reports SET issuePriority='normal';",
    "DROP TABLE users;",
    "ALTER TABLE construction_daily_reports DROP safetyNotes;",
  ])("即使自算摘要也拒绝额外语句%s", extra => {
    const modified = Buffer.from(bytes.toString() + extra);
    const computed = createHash("sha256").update(modified).digest("hex");
    expect(() => validateIssuePriorityMigration(modified, computed)).toThrow(
      "MIGRATION_SHA_MISMATCH"
    );
  });
  it("首次ADD及回读，重试只验结构，不写正文/安全/状态/事务或Drizzle日志", async () => {
    const db = fakeDb();
    expect(await applyIssuePriorityMigration(db, bytes, sha)).toEqual({
      ok: true,
      migration: "0098",
      sha256: sha,
      applied: true,
      verified: true,
      nullable: true,
      historyUnchanged: true,
    });
    expect(await applyIssuePriorityMigration(db, bytes, sha)).toMatchObject({
      applied: false,
      verified: true,
    });
    expect(ddlCalls(db)).toHaveLength(1);
    expect(
      db.query.mock.calls.filter(([query]) => query.includes("RELEASE_LOCK"))
    ).toHaveLength(2);
    for (const [query] of db.query.mock.calls)
      expect(query).not.toMatch(
        /UPDATE |INSERT |DELETE |__drizzle_migrations|BEGIN|COMMIT|ROLLBACK/i
      );
  });
  it.each([
    { ...shape, type: "enum('urgent','normal')" },
    { ...shape, type: "varchar(10)" },
    { ...shape, dataType: "varchar" },
    { ...shape, nullable: "NO" },
    { ...shape, defaultValue: "normal" },
    { ...shape, extraValue: "STORED GENERATED" },
    { ...shape, generationExpression: "issueNotes" },
  ])("既有列漂移拒绝且解锁，不做修复%j", async column => {
    expect(() => assertIssuePriorityColumn(column)).toThrow(
      "EXISTING_SHAPE_MISMATCH"
    );
    const db = fakeDb(column);
    await expect(applyIssuePriorityMigration(db, bytes, sha)).rejects.toThrow(
      "EXISTING_SHAPE_MISMATCH"
    );
    expect(ddlCalls(db)).toHaveLength(0);
    expect(
      db.query.mock.calls.some(([query]) => query.includes("RELEASE_LOCK"))
    ).toBe(true);
  });
  it.each([0, null, "0"])(
    "拿不到锁%j不查结构、不DDL、不释放他人锁",
    async lock => {
      const db = fakeDb(null, { lock });
      await expect(applyIssuePriorityMigration(db, bytes, sha)).rejects.toThrow(
        "MIGRATION_BUSY"
      );
      expect(db.query).toHaveBeenCalledTimes(1);
    }
  );
  it("兼容mysql2锁结果字符串1", async () => {
    const db = fakeDb(null, { lock: "1", release: "1" });
    expect(await applyIssuePriorityMigration(db, bytes, sha)).toMatchObject({
      applied: true,
    });
  });
  it.each([{ invalidTable: true }, { noDatabase: true }])(
    "缺少当前数据库/基表预检拒绝%j",
    async options => {
      const db = fakeDb(null, options);
      await expect(
        applyIssuePriorityMigration(db, bytes, sha)
      ).rejects.toThrow();
      expect(ddlCalls(db)).toHaveLength(0);
    }
  );
  it("同列并发ADD只接收正确形状，不擅改并发列", async () => {
    const db = fakeDb(null, { duplicate: true });
    expect(await applyIssuePriorityMigration(db, bytes, sha)).toMatchObject({
      applied: false,
      verified: true,
    });
    const drift = fakeDb(null, {
      duplicate: true,
      duplicateShape: { ...shape, defaultValue: "normal" },
    });
    await expect(
      applyIssuePriorityMigration(drift, bytes, sha)
    ).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
  });
  it("DDL失败仍释放锁；释放失败与原错误均不会吞掉", async () => {
    const db = fakeDb(null, { failDdl: true });
    await expect(applyIssuePriorityMigration(db, bytes, sha)).rejects.toThrow(
      "RAW_SECRET_CONNECTION_ERROR"
    );
    expect(
      db.query.mock.calls.some(([query]) => query.includes("RELEASE_LOCK"))
    ).toBe(true);
    await expect(
      applyIssuePriorityMigration(fakeDb(shape, { release: 0 }), bytes, sha)
    ).rejects.toThrow("MIGRATION_LOCK_RELEASE_FAILED");
    await expect(
      applyIssuePriorityMigration(
        fakeDb(null, { failDdl: true, release: 0 }),
        bytes,
        sha
      )
    ).rejects.toThrow("MIGRATION_AND_LOCK_RELEASE_FAILED");
  });
  it("CLI包装在连接前拒绝错误文件/摘要，成功及失败均结束连接", async () => {
    const createConnection = vi.fn();
    const options = {
      databaseUrl: "mysql://SECRET",
      readFile: vi.fn(async () => bytes),
      createConnection,
    };
    await expect(
      runIssuePriorityMigration("0098_wrong.sql", sha, options)
    ).rejects.toThrow("INVALID_CONFIGURATION");
    await expect(
      runIssuePriorityMigration(
        CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE,
        "0".repeat(64),
        options
      )
    ).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(createConnection).not.toHaveBeenCalled();
    const good = fakeDb(shape);
    createConnection.mockResolvedValueOnce(good);
    await runIssuePriorityMigration(
      CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE,
      sha,
      options
    );
    expect(good.end).toHaveBeenCalledTimes(1);
    const failed = fakeDb(null, { failDdl: true });
    createConnection.mockResolvedValueOnce(failed);
    await expect(
      runIssuePriorityMigration(
        CONSTRUCTION_ISSUE_PRIORITY_MIGRATION_FILE,
        sha,
        options
      )
    ).rejects.toThrow();
    expect(failed.end).toHaveBeenCalledTimes(1);
  });
  it("真实CLI错误不暴露URL/驱动/SQL；只用错误摘要在连接前失败", () => {
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/apply-construction-issue-priority-migration.mjs",
          "drizzle/0098_clumsy_big_bertha.sql",
          "0".repeat(64),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: "mysql://secret-user:secret-password@secret-host/db",
          },
          stdio: "pipe",
        }
      );
      throw new Error("CLI_SHOULD_FAIL");
    } catch (error: any) {
      expect(error.status).toBe(1);
      const output = String(error.stdout) + String(error.stderr);
      expect(output).toContain("问题等级迁移未完成");
      expect(output).not.toMatch(
        /secret-user|secret-password|secret-host|ALTER TABLE|MIGRATION_SHA_MISMATCH/
      );
    }
  });
});
