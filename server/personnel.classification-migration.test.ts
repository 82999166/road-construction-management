import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PERSONNEL_DEFAULT_POSITIONS } from "../shared/personnel";
// @ts-expect-error 独立Node MJS CLI，数据库仅使用本地mock。
import { PERSONNEL_CLASSIFICATION_MIGRATION_FILE, PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS, createPlan, assertPersonnelClassificationColumn, applyPersonnelClassificationMigration, runPersonnelClassificationMigration } from "../scripts/apply-personnel-classification-migration.mjs";

const sql = ["personnel_people", "personnel_salary_history"].flatMap(table => [
  `ALTER TABLE \`${table}\` ADD \`salaryPayerType\` varchar(24);`,
  `ALTER TABLE \`${table}\` ADD \`salaryPayerName\` varchar(128);`,
]).join("\n--> statement-breakpoint\n");
const bytes = Buffer.from(sql);
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const sha = hash(bytes);
type Column = { type: string; dataType: string; length: number | string; nullable: string; defaultValue: unknown; extraValue: string; generationExpression: string | null };
type Position = { id: number; name: string; category: string; status: string; custom?: string };
const shape = (length: number): Column => ({ type: `varchar(${length})`, dataType: "varchar", length, nullable: "YES", defaultValue: null, extraValue: "", generationExpression: "" });
const plans = createPlan(bytes, sha) as { key: string; table: string; name: string; length: number; sql: string }[];

function mockDb(options: { existing?: boolean; positions?: Position[]; lock?: unknown; released?: unknown; unique?: boolean; engine?: string } = {}) {
  const columns = new Map<string, Column>();
  if (options.existing) plans.forEach(p => columns.set(p.key, shape(p.length)));
  const positions = new Map<string, Position>((options.positions ?? []).map(p => [p.name, { ...p }]));
  let snapshot: Map<string, Position> | null = null;
  const db = {
    columns, positions,
    query: vi.fn(async (query: string, values?: unknown[]) => {
      if (query.includes("GET_LOCK")) return [[{ acquired: options.lock === undefined ? 1 : options.lock }]];
      if (query.includes("RELEASE_LOCK")) return [[{ released: options.released === undefined ? 1 : options.released }]];
      if (query.includes("SELECT DATABASE")) return [[{ databaseName: "local_mock_only" }]];
      if (query.includes("information_schema.tables")) return [[{ tableType: "BASE TABLE", engine: options.engine ?? "InnoDB" }]];
      if (query.includes("information_schema.statistics")) return [options.unique === false ? [] : [{ name: "personnel_positions_name_unique", columnName: "name", nonUnique: 0, sequence: 1, subPart: null }]];
      if (query.includes("information_schema.columns")) {
        const column = columns.get(`${values?.[0]}.${values?.[1]}`);
        return [column ? [{ ...column }] : []];
      }
      throw new Error(`Unexpected mock query: ${query}`);
    }),
    execute: vi.fn(async (query: string, values?: unknown[]): Promise<any[]> => {
      if (query.startsWith("ALTER")) {
        const plan = plans.find(p => p.sql === query);
        if (!plan) throw new Error("DDL_NOT_ALLOWLISTED");
        columns.set(plan.key, shape(plan.length));
        return [{ affectedRows: 0 }];
      }
      if (query.startsWith("SELECT id,name")) {
        expect(query).toContain("WHERE `name`=? FOR UPDATE");
        const position = positions.get(String(values?.[0]));
        return [position ? [{ ...position }] : []];
      }
      if (query.startsWith("INSERT INTO")) {
        expect(query).toBe("INSERT INTO `personnel_positions` (`name`,`category`,`status`) VALUES (?,?,'active')");
        const name = String(values?.[0]);
        expect(PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS.some((p: Position) => p.name === name && p.category === values?.[1])).toBe(true);
        if (positions.has(name)) throw Object.assign(new Error("duplicate"), { errno: 1062, code: "ER_DUP_ENTRY" });
        positions.set(name, { id: positions.size + 100, name, category: String(values?.[1]), status: "active" });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected mock execute: ${query}`);
    }),
    beginTransaction: vi.fn(async () => { snapshot = new Map([...positions].map(([k, v]) => [k, { ...v }])); }),
    commit: vi.fn(async () => { snapshot = null; }),
    rollback: vi.fn(async () => { positions.clear(); for (const [k, v] of snapshot ?? []) positions.set(k, v); snapshot = null; }),
    end: vi.fn(async () => {}),
  };
  return db;
}
const ddlCalls = (db: ReturnType<typeof mockDb>) => db.execute.mock.calls.filter(([q]) => q.startsWith("ALTER"));
const insertCalls = (db: ReturnType<typeof mockDb>) => db.execute.mock.calls.filter(([q]) => q.startsWith("INSERT"));
const releasedCalls = (db: ReturnType<typeof mockDb>) => db.query.mock.calls.filter(([q]) => q.includes("RELEASE_LOCK"));

// No test loads DATABASE_URL, real mysql connections, or production data.
describe("人员分类四列安全迁移与固定岗位补齐", () => {
  it("纯Node固定岗位白名单与共享23个真实默认岗位完全对齐", () => {
    expect(PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS).toEqual(PERSONNEL_DEFAULT_POSITIONS);
    expect(PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS).toHaveLength(23);
    expect(new Set(PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS.map((p: Position) => p.name)).size).toBe(23);
    expect(Object.isFrozen(PERSONNEL_CLASSIFICATION_DEFAULT_POSITIONS)).toBe(true);
  });
  it("支持四条单列DDL或两条同表多列DDL，输出只执行固定SQL", () => {
    expect(plans).toHaveLength(4);
    const grouped = Buffer.from(["personnel_people", "personnel_salary_history"].map(t => `ALTER TABLE \`${t}\` ADD COLUMN \`salaryPayerType\` varchar(24) NULL DEFAULT NULL, ADD COLUMN \`salaryPayerName\` varchar(128) DEFAULT NULL;`).join("\n"));
    expect(createPlan(grouped, hash(grouped))).toEqual(plans);
  });
  it("字节摘要不符（包括换行改变）在任何数据库操作前拒绝", async () => {
    const db = mockDb();
    await expect(applyPersonnelClassificationMigration(db, bytes, "0".repeat(64))).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(() => createPlan(Buffer.from(sql + "\n"), sha)).toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it.each([
    sql + "\nDROP TABLE users;",
    sql + "\nINSERT INTO `personnel_positions` (`name`) VALUES ('恶意');",
    sql + "\nUPDATE personnel_people SET salaryPayerType='company';",
    sql + "\nDELETE FROM personnel_salary_history;",
    sql + "\nALTER TABLE users ADD bad int;",
    sql.replace("varchar(24)", "varchar(25)"),
    sql.replace("varchar(24)", "varchar(24) NOT NULL"),
    sql.replace("varchar(24)", "varchar(24) DEFAULT 'company'"),
    sql.replace("salaryPayerType", "unknownColumn"),
    sql.replace("ADD", "MODIFY"),
    sql.replace("ADD", "ADD IF NOT EXISTS"),
    sql.replace("varchar(24)", "varchar(24) AFTER id"),
    sql.replace("varchar(24)", "varchar(24) UNIQUE"),
    sql.replace("varchar(24)", "varchar(24) /* malicious */"),
    sql.replace("`personnel_people`", "`personnel_people"),
    sql.replace("`salaryPayerType`", "salaryPayerType`"),
    sql + "\n/*!50000 DROP TABLE users */;",
    sql + "\n-- DROP TABLE users\n",
    sql + "\nSELECT SLEEP(5);",
    sql + "\n" + sql.split("\n")[0],
    sql.split("\n--> statement-breakpoint\n").slice(0, 3).join("\n"),
  ])("即使摘要正确也拒绝额外DDL/任意DML/恶意或漂移SQL", async text => {
    const db = mockDb();
    const bad = Buffer.from(text);
    expect(() => createPlan(bad, hash(bad))).toThrow("UNEXPECTED_STATEMENT");
    await expect(applyPersonnelClassificationMigration(db, bad, hash(bad))).rejects.toThrow("UNEXPECTED_STATEMENT");
    expect(db.query).not.toHaveBeenCalled();
  });
  it("首次空岗位补齐23条、四列增加且完全验证，再次执行全部幂等", async () => {
    const db = mockDb();
    const first = await applyPersonnelClassificationMigration(db, bytes, sha);
    expect(first.positions).toEqual({ inserted: 23, preserved: 0, totalDefaultsVerified: 23 });
    expect(Object.values(first.columns)).toEqual(plans.map(() => ({ applied: true, verified: true })));
    const second = await applyPersonnelClassificationMigration(db, bytes, sha);
    expect(second.positions).toEqual({ inserted: 0, preserved: 23, totalDefaultsVerified: 23 });
    expect(Object.values(second.columns)).toEqual(plans.map(() => ({ applied: false, verified: true })));
    expect(ddlCalls(db)).toHaveLength(4);
    expect(insertCalls(db)).toHaveLength(23);
    expect(db.commit).toHaveBeenCalledTimes(2);
    expect(releasedCalls(db)).toHaveLength(2);
    expect([...db.query.mock.calls, ...db.execute.mock.calls].some(([q]) => /\b(?:UPDATE|DELETE|DROP|REPLACE)\b/i.test(q.replace("FOR UPDATE", "")))).toBe(false);
  });
  it("开发旧12条只补11条，disabled及自定义分类和额外岗位全部保留原值", async () => {
    const old: Position[] = PERSONNEL_DEFAULT_POSITIONS.slice(0, 12).map((p, i) => ({ id: i + 1, name: p.name, category: "other", status: "disabled", custom: "不覆盖" }));
    old.push({ id: 99, name: "用户自定义岗位", category: "business", status: "disabled" });
    const db = mockDb({ existing: true, positions: old });
    expect((await applyPersonnelClassificationMigration(db, bytes, sha)).positions).toEqual({ inserted: 11, preserved: 12, totalDefaultsVerified: 23 });
    old.forEach(p => expect(db.positions.get(p.name)).toEqual(p));
    expect(ddlCalls(db)).toHaveLength(0);
    expect(db.positions.size).toBe(24);
  });
  it.each([
    { type: "varchar(25)" }, { length: 25 }, { nullable: "NO" },
    { defaultValue: "NULL" }, { defaultValue: "company" }, { extraValue: "VIRTUAL GENERATED" },
    { generationExpression: "'company'" }, { dataType: "char" },
  ])("发现最后一列结构漂移也不执行任何前面缺失列DDL或seed", async drift => {
    const db = mockDb();
    const last = plans[3];
    db.columns.set(last.key, { ...shape(last.length), ...drift });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(ddlCalls(db)).toHaveLength(0);
    expect(insertCalls(db)).toHaveLength(0);
    expect(db.beginTransaction).not.toHaveBeenCalled();
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("兼容MySQL/TiDB varchar大小写、长度字符串与空generation metadata", () => {
    expect(() => assertPersonnelClassificationColumn({ ...shape(24), type: "VARCHAR(24)", dataType: "VARCHAR", length: "24", generationExpression: null }, plans[0])).not.toThrow();
  });
  it("已有部分列时仅增加缺失列", async () => {
    const db = mockDb();
    db.columns.set(plans[0].key, shape(24));
    const result = await applyPersonnelClassificationMigration(db, bytes, sha);
    expect(result.columns[plans[0].key]).toEqual({ applied: false, verified: true });
    expect(ddlCalls(db)).toHaveLength(3);
  });
  it.each([0, null, "0"])("锁失败完全无DDL/DML且不释放未获得的锁", async lock => {
    const db = mockDb({ lock });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("MIGRATION_BUSY");
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.beginTransaction).not.toHaveBeenCalled();
    expect(releasedCalls(db)).toHaveLength(0);
  });
  it("支持驱动返回字符串锁结果，释放失败不报告成功", async () => {
    const db = mockDb({ lock: "1", released: "1", existing: true });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).resolves.toHaveProperty("positions.totalDefaultsVerified", 23);
    const failed = mockDb({ released: 0, existing: true });
    await expect(applyPersonnelClassificationMigration(failed, bytes, sha)).rejects.toThrow("MIGRATION_LOCK_RELEASE_FAILED");
  });
  it.each([{ unique: false }, { engine: "MyISAM" }])("岗位缺唯一name索引或非事务引擎时在DDL前拒绝", async options => {
    const db = mockDb(options);
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow();
    expect(db.execute).not.toHaveBeenCalled();
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("插入1062冲突只精确重读同名并保留其disabled原值", async () => {
    const db = mockDb({ existing: true });
    const original = db.execute.getMockImplementation()!;
    let raced = false;
    const preserved = { id: 900, name: "项目经理", category: "other", status: "disabled" };
    db.execute.mockImplementation(async (q, args) => {
      if (q.startsWith("INSERT") && !raced) {
        raced = true;
        db.positions.set(preserved.name, preserved);
        throw Object.assign(new Error("duplicate"), { errno: 1062 });
      }
      return original(q, args);
    });
    expect((await applyPersonnelClassificationMigration(db, bytes, sha)).positions).toEqual({ inserted: 22, preserved: 1, totalDefaultsVerified: 23 });
    expect(db.positions.get(preserved.name)).toEqual(preserved);
  });
  it("1062冲突精确重读无同名时拒绝并回滚，不静默吞错", async () => {
    const db = mockDb({ existing: true });
    const original = db.execute.getMockImplementation()!;
    db.execute.mockImplementation(async (q, args) => {
      if (q.startsWith("INSERT") && args?.[0] === "技术员") throw Object.assign(new Error("unrelated unique duplicate"), { code: "ER_DUP_ENTRY" });
      return original(q, args);
    });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("unrelated unique duplicate");
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.positions.size).toBe(0);
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("seed末尾验证缺失默认name拒绝并回滚", async () => {
    const db = mockDb({ existing: true });
    const original = db.execute.getMockImplementation()!;
    db.execute.mockImplementation(async (q, args) => {
      if (q.startsWith("SELECT id,name") && insertCalls(db).length === 23 && args?.[0] === "项目经理") return [[]];
      return original(q, args);
    });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("POSITION_DEFAULTS_MISSING");
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.positions.size).toBe(0);
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("DDL中途失败释放锁；已有成功ADD保留，安全重试只补剩余列", async () => {
    const db = mockDb();
    const original = db.execute.getMockImplementation()!;
    let fail = true;
    db.execute.mockImplementation(async (q, args) => {
      if (q === plans[1].sql && fail) { fail = false; throw new Error("mock DDL failure"); }
      return original(q, args);
    });
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("mock DDL failure");
    expect(db.columns.size).toBe(1);
    expect(db.beginTransaction).not.toHaveBeenCalled();
    expect(releasedCalls(db)).toHaveLength(1);
    const retried = await applyPersonnelClassificationMigration(db, bytes, sha);
    expect(retried.columns[plans[0].key]).toEqual({ applied: false, verified: true });
    expect(db.columns.size).toBe(4);
    expect(db.execute.mock.calls.filter(([q]) => q === plans[0].sql)).toHaveLength(1);
  });
  it("并发ADD重复列仅回读完全等价才通过，漂移拒绝", async () => {
    for (const drift of [false, true]) {
      const db = mockDb();
      const original = db.execute.getMockImplementation()!;
      db.execute.mockImplementation(async (q, args) => {
        if (q === plans[0].sql) {
          db.columns.set(plans[0].key, shape(drift ? 25 : 24));
          throw Object.assign(new Error("duplicate column"), { errno: 1060 });
        }
        return original(q, args);
      });
      if (drift) await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      else expect((await applyPersonnelClassificationMigration(db, bytes, sha)).columns[plans[0].key]).toEqual({ applied: false, verified: true });
      expect(releasedCalls(db)).toHaveLength(1);
    }
  });
  it("主要迁移失败且锁释放失败时同时保留两种错误", async () => {
    const db = mockDb({ released: null });
    db.columns.set(plans[3].key, shape(25));
    try {
      await applyPersonnelClassificationMigration(db, bytes, sha);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(["EXISTING_SHAPE_MISMATCH", "MIGRATION_LOCK_RELEASE_FAILED"]);
    }
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("提交失败回滚岗位且释放锁，已增加四列仍保留", async () => {
    const db = mockDb();
    db.commit.mockRejectedValueOnce(new Error("commit failed"));
    await expect(applyPersonnelClassificationMigration(db, bytes, sha)).rejects.toThrow("commit failed");
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.positions.size).toBe(0);
    expect(db.columns.size).toBe(4);
    expect(releasedCalls(db)).toHaveLength(1);
  });
  it("run接口验证文件名及摘要在连接之前执行且成功/失败均关闭连接", async () => {
    const db = mockDb();
    const readFile = vi.fn(async () => bytes);
    const createConnection = vi.fn(async () => db);
    const options = { databaseUrl: "mysql://local-mock-never-connected/test", readFile, createConnection };
    await expect(runPersonnelClassificationMigration("0097_wrong.sql", sha, options)).rejects.toThrow("INVALID_CONFIGURATION");
    await expect(runPersonnelClassificationMigration(PERSONNEL_CLASSIFICATION_MIGRATION_FILE, "0".repeat(64), options)).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(createConnection).not.toHaveBeenCalled();
    await expect(runPersonnelClassificationMigration(PERSONNEL_CLASSIFICATION_MIGRATION_FILE, sha, options)).resolves.toHaveProperty("positions.inserted", 23);
    expect(db.end).toHaveBeenCalledOnce();
    const failed = mockDb({ lock: 0 });
    createConnection.mockResolvedValueOnce(failed);
    await expect(runPersonnelClassificationMigration(PERSONNEL_CLASSIFICATION_MIGRATION_FILE, sha, options)).rejects.toThrow("MIGRATION_BUSY");
    expect(failed.end).toHaveBeenCalledOnce();
  });
});
