import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as s from "../../drizzle/schema";
import { adoptLegacy, assertCompensationChannel, assertLegacyCoreEditSafe, ensureLegacyPayrollSubjects, getLegacyCompensation, getPersonnelPayrollProfilesForPeriod, listLegacyCandidates, omitUnchangedLegacyFields, resolveLegacyIdentityGraph, resolveResourceLoginBinding, resolveResourcePerson, saveResourceBinding, syncLegacyMirrors } from "./personnelLegacyBridge";
import { buildPayrollAccrualPreview, calculateEffectiveSalaryAccrual, generatePayrollDraftForEmployeeProfile } from "./payrollGeneration";
import { getDb } from "../db";
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./secretVault", () => ({ decryptSecret: (x: string) => x.replace(/^cipher:/, ""), encryptSecret: (x: string) => `cipher:${x}`, fingerprintSecret: (x: string) => `hash:${x}`, maskSecret: (x: string) => `****${x.slice(-4)}` }));

type MockData = Map<unknown, Record<string, any>[]>;
/** 测试仅支持本helper所用的SQL谓词，精确过滤ID/来源/项目，避免忽略where而误证行为。 */
function predicate(condition: any): (row: any) => boolean {
  if (!condition) return () => true;
  const { sql, params } = new MySqlDialect().sqlToQuery(condition);
  let index = 0;
  let expression = sql.replace(/\?/g, () => JSON.stringify(params[index++]));
  expression = expression.replace(/`[^`]+`\.`([^`]+)`/g, (_, field) => `row[${JSON.stringify(field)}]`)
    .replace(/(row\["[^"]+"\]) is null/gi, "$1 == null")
    .replace(/(row\["[^"]+"\]) in \(([^)]+)\)/gi, "[$2].includes($1)")
    .replace(/ <> | != /g, " !== ").replace(/ = /g, " === ").replace(/ and /gi, " && ").replace(/ or /gi, " || ");
  return new Function("row", `return Boolean(${expression})`) as (row: any) => boolean;
}
/** Stateful table-aware mock with row locks and atomic transaction rollback; no real database. */
function mockDb(data: MockData = new Map()) {
  if (!data.has(s.personnelPeople)) data.set(s.personnelPeople, [person()]);
  let nextId = 100;
  const writes: { table: unknown; operation: string; values: any; ids?: number[] }[] = [];
  const locks: unknown[] = [];
  const select = vi.fn(() => ({ from(table: unknown) {
    let filter = () => true, limit = Infinity;
    const q: any = { where: vi.fn(condition => { filter = predicate(condition); return q; }), limit: vi.fn(n => { limit = n; return q; }), orderBy: vi.fn(() => q), for: vi.fn(() => { locks.push(table); return q; }), then(resolve: (x: any) => any, reject: (x: any) => any) { return Promise.resolve((data.get(table) ?? []).filter(filter).slice(0, limit).map(r => ({ ...r }))).then(resolve, reject); } };
    return q;
  } }));
  const db: any = {
    select,
    insert: vi.fn((table: unknown) => ({ values: vi.fn(async (values: any) => { writes.push({ table, operation: "insert", values }); const id = ++nextId; data.set(table, [...data.get(table) ?? [], { createdAt: new Date(), exitDate: null, leftAt: null, ...values, id }]); return [{ insertId: id, affectedRows: 1 }]; }) })),
    update: vi.fn((table: unknown) => ({ set: vi.fn((values: any) => ({ where: vi.fn(async condition => { const rows = (data.get(table) ?? []).filter(predicate(condition)); writes.push({ table, operation: "update", values, ids: rows.map(r => r.id) }); rows.forEach(r => Object.assign(r, values)); return [{ affectedRows: rows.length }]; }) })) })),
    transaction: vi.fn(async (callback: (tx: any) => any) => {
      const before = new Map([...data].map(([table, rows]) => [table, rows.map(r => ({ ...r }))])); const count = writes.length;
      try { return await callback(db); } catch (error) { data.clear(); before.forEach((rows, table) => data.set(table, rows)); writes.splice(count); throw error; }
    }),
  };
  return { db, writes, locks, data };
}
function person(overrides: Record<string, any> = {}) { return { id: 1, personNo: "P-1", name: "真实人员", affiliation: "company", employmentStatus: "active", projectId: 10, teamId: null, userId: null, legacyProfileId: null, legacyWorkerId: null, entryDate: "2026-01-01", exitDate: null, payrollEnabled: true, phoneEncrypted: null, phoneFingerprint: null, phoneMasked: null, identityNoEncrypted: null, bankAccountEncrypted: null, bankName: null, primaryPositionId: 3, secondaryPositionIds: [], version: 1, createdBy: 8, updatedBy: 8, ...overrides } as typeof s.personnelPeople.$inferSelect; }
function profile(overrides: Record<string, any> = {}) { return { id: 4, userId: 7, laborWorkerId: 12, projectId: 10, employeeType: "management", employmentStatus: "active", joinedAt: new Date("2026-01-01Z"), leftAt: null, salaryBasis: "monthly", baseSalary: "9000", createdAt: new Date("2026-02-01Z"), updatedAt: new Date("2026-08-01Z"), ...overrides }; }
const today = "2026-11-03";
beforeEach(() => { vi.useRealTimers(); vi.mocked(getDb).mockReset(); });

describe("真实ID身份引入", () => {
  it("重复旧profile同真实user/worker拓展一个身份，不按名字或电话归并", () => {
    const nodes = resolveLegacyIdentityGraph({ sourceType: "profile", sourceId: 4, profiles: [profile(), profile({ id: 5 }), profile({ id: 6, userId: 9, laborWorkerId: 13 })], userIds: [7, 9], workerIds: [12, 13] });
    expect(nodes.map(n => `${n.sourceType}:${n.sourceId}`).sort()).toEqual(["profile:4", "profile:5", "user:7", "worker:12"]);
  });
  it("连通两个真实账号拒绝猜测合并，孤立无效user外键不扩展", () => {
    expect(() => resolveLegacyIdentityGraph({ sourceType: "worker", sourceId: 12, profiles: [profile(), profile({ id: 5, userId: 9 })], userIds: [7, 9], workerIds: [12] })).toThrow("多个不同账号");
    expect(resolveLegacyIdentityGraph({ sourceType: "profile", sourceId: 4, profiles: [profile({ userId: 99 })], userIds: [], workerIds: [12] })).toEqual([{ sourceType: "profile", sourceId: 4 }, { sourceType: "worker", sourceId: 12 }]);
  });
  it("候选按项目范围筛选且返回最小安全投影", async () => {
    const { db } = mockDb(new Map([[s.employeeProfiles, [profile()]], [s.laborWorkers, [{ id: 12, projectId: 10, realName: "同名", phoneEncrypted: "cipher:13800138000" }, { id: 13, projectId: 20, realName: "同名" }]], [s.users, [{ id: 7, name: "账号姓名", openId: "credential" }]]]));
    const rows = await listLegacyCandidates(db, { projectIds: [10] });
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.projectId === 10)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/13800138000|cipher|credential/);
  });
  it("采用重复profile保留全部来源，不写旧表/工资/账号权限；身份证唯一指纹来自真实密文", async () => {
    const { db, writes } = mockDb(new Map([[s.employeeProfiles, [profile(), profile({ id: 5 })]], [s.laborWorkers, [{ id: 12, projectId: 10, realName: "真实人员", workerCategory: "company_admin", identityNoEncrypted: "cipher:110101199001011234", phoneEncrypted: "cipher:13800138000", phoneFingerprint: "hash:13800138000", createdAt: new Date("2026-01-01Z") }]], [s.users, [{ id: 7, name: "真实账号" }]]]));
    const result = await adoptLegacy(db, { sourceType: "profile", sourceId: 4, actorUserId: 8 });
    expect(result.id).toBeGreaterThan(0);
    const main = writes.find(w => w.table === s.personnelPeople)!.values;
    expect(main.identityNoFingerprint).toBe("hash:110101199001011234");
    expect(writes.filter(w => w.table === s.personnelSourceLinks).map(w => `${w.values.sourceType}:${w.values.sourceId}`).sort()).toEqual(["profile:4", "profile:5", "user:7", "worker:12"]);
    expect(writes.filter(w => [s.employeeProfiles, s.laborWorkers, s.users, s.payrollStatements].includes(w.table as any))).toEqual([]);
    expect(writes.find(w => w.table === s.personnelSalaryHistory)!.values).toMatchObject({ effectiveFrom: "2026-01-01", affiliation: "company", baseSalary: "9000" });
  });
  it("来源已指向不同person原子阻断且不执行写入", async () => {
    const { db, writes } = mockDb(new Map([[s.employeeProfiles, [profile()]], [s.laborWorkers, [{ id: 12, projectId: 10 }]], [s.users, [{ id: 7 }]], [s.personnelSourceLinks, [{ personId: 1, sourceType: "profile", sourceId: 4 }, { personId: 2, sourceType: "worker", sourceId: 12 }]]]));
    await expect(adoptLegacy(db, { sourceType: "profile", sourceId: 4, actorUserId: 8 })).rejects.toThrow("不同统一人员");
    expect(writes).toEqual([]);
  });
});

describe("合法工资主体与mirror", () => {
  it("无账号公司人员可创建真实worker/profile并绑定来源，不写用户及角色权限", async () => {
    const { db, writes } = mockDb();
    const result = await ensureLegacyPayrollSubjects(db, person(), 8);
    expect(result.legacyProfileId).toBeGreaterThan(0); expect(result.legacyWorkerId).toBeGreaterThan(0);
    expect(writes.find(w => w.table === s.laborWorkers)!.values).toMatchObject({ projectId: 10, workerCategory: "company_admin", realName: "真实人员" });
    expect(writes.find(w => w.table === s.employeeProfiles)!.values).toMatchObject({ userId: null, laborWorkerId: result.legacyWorkerId });
    expect(writes.some(w => w.table === s.users || w.table === s.userRoleAssignments)).toBe(false);
  });
  it("外部人员、缺项目或已丢失历史主体拒绝准备工资", async () => {
    const { db, writes, data } = mockDb();
    await expect(ensureLegacyPayrollSubjects(db, person({ affiliation: "external" }), 8)).rejects.toThrow("不属于人员工资");
    await expect(ensureLegacyPayrollSubjects(db, person({ projectId: null }), 8)).rejects.toThrow("归属项目");
    data.set(s.personnelPeople, [person({ legacyWorkerId: 12 })]);
    await expect(ensureLegacyPayrollSubjects(db, person({ legacyWorkerId: 12 }), 8)).rejects.toThrow("工资主体不存在");
    expect(writes).toHaveLength(0);
  });
  it("undefined及空文本保留，null显式清空，手机号冲突拒绝不猜并", async () => {
    expect(omitUnchangedLegacyFields({ teamName: undefined, phone: "", bankName: null, name: "真实人员" })).toEqual({ bankName: null, name: "真实人员" });
    const { db, writes } = mockDb(new Map([[s.laborWorkers, [{ id: 13, phoneFingerprint: "hash:same" }]]]));
    await expect(syncLegacyMirrors(db, person({ legacyWorkerId: 12, phoneFingerprint: "hash:same" }))).rejects.toThrow("不会按手机号合并");
    expect(writes).toEqual([]);
  });
  it("业务核验可维护但不能越权修改已映射人事姓名或薪资", async () => {
    const { db } = mockDb(new Map([[s.personnelSourceLinks, [{ personId: 1, sourceType: "worker", sourceId: 12 }]]]));
    await expect(assertLegacyCoreEditSafe(db, "worker", 12, { realName: "真实人员", identityVerificationStatus: "verified" }, { realName: "真实人员" })).resolves.toBeUndefined();
    await expect(assertLegacyCoreEditSafe(db, "worker", 12, { realName: "另一人" }, { realName: "真实人员" })).rejects.toThrow("业务权限不能越权");
  });
});

describe("生效工资与结算通道", () => {
  it("逐日匹配历史薪资，未来调薪不改过去，同月跨生效日期用不同版本", () => {
    const rows = [{ attendanceDate: "2026-08-01", workHours: 8, overtimeHours: 0, status: "confirmed" as const }, { attendanceDate: "2026-08-20", workHours: 8, overtimeHours: 1, status: "locked" as const }];
    const history = [{ effectiveFrom: "2026-01-01", salaryBasis: "monthly" as const, baseSalary: "9000", payrollEnabled: true, affiliation: "company" }, { effectiveFrom: "2026-08-15", salaryBasis: "hourly" as const, baseSalary: "50", payrollEnabled: true, affiliation: "company" }, { effectiveFrom: "2026-12-01", salaryBasis: "daily" as const, baseSalary: "900", payrollEnabled: true, affiliation: "company" }];
    expect(calculateEffectiveSalaryAccrual(rows, history)).toMatchObject({ calculable: true, payableAmount: 750 });
    expect(calculateEffectiveSalaryAccrual(rows, history.slice(1))).toMatchObject({ calculable: false, payableAmount: null });
  });
  it("外部/未启用/临时日结生效版本及计件无验收数据不能生成工资", () => {
    const attendance = [{ attendanceDate: "2026-08-01", workHours: 8, overtimeHours: 0, status: "confirmed" as const }];
    for (const override of [{ payrollEnabled: false }, { affiliation: "external" }, { affiliation: "temporary" }, { salaryBasis: "piecework" as const }]) expect(calculateEffectiveSalaryAccrual(attendance, [{ effectiveFrom: "2026-01-01", salaryBasis: "monthly", baseSalary: "9000", payrollEnabled: true, affiliation: "company", ...override }]).calculable).toBe(false);
  });
  it("全person worker别名日结/月薪互斥并锁真实worker和person", async () => {
    const map: MockData = new Map([[s.laborWorkers, [{ id: 12, projectId: 10, workerCategory: "company_admin" }]], [s.personnelPeople, [person()]], [s.personnelSourceLinks, [{ personId: 1, sourceType: "worker", sourceId: 12 }, { personId: 1, sourceType: "worker", sourceId: 13 }]], [s.personnelSalaryHistory, [{ personId: 1, effectiveFrom: "2026-01-01", payrollEnabled: true, affiliation: "company" }]], [s.temporaryDailyWageSettlements, [{ workerId: 13, projectId: 10, settlementDate: new Date("2026-08-02Z"), status: "paid" }]]]);
    const { db, locks, writes } = mockDb(map);
    await expect(assertCompensationChannel(db, { workerId: 12, projectId: 10, period: "2026-08", channel: "monthly", lock: true })).rejects.toThrow("已有日结记录");
    expect(locks.map(t => t === s.personnelPeople ? "person" : t === s.laborWorkers ? "worker" : "history").slice(0, 2)).toEqual(["person", "worker"]); expect(writes).toEqual([]);
    map.set(s.laborWorkers, [{ id: 12, projectId: 10, workerCategory: "temporary_daily" }]); map.set(s.payrollStatements, [{ workerId: 13, projectId: 10, period: "2026-08", status: "partial" }]);
    map.set(s.personnelSalaryHistory, [{ personId: 1, effectiveFrom: "2026-01-01", payrollEnabled: true, affiliation: "temporary" }]);
    await expect(assertCompensationChannel(db, { workerId: 12, projectId: 10, period: "2026-08", settlementDate: "2026-08-02", channel: "daily" })).rejects.toThrow("已有月度工资");
    // 已有月薪历史单据不能因今天/错误新类别被抹除签名，仍按旧范围防双算。
    await expect(assertCompensationChannel(db, { workerId: 12, projectId: 10, period: "2026-08", channel: "monthly" })).rejects.toThrow("无该历史任职主体");
  });
  it("工资生成实际写事务draft及历史核算金额，而非当前profile薪资", async () => {
    const { db, writes, locks } = mockDb(new Map([[s.employeeProfiles, [profile({ baseSalary: "99999" })]], [s.laborWorkers, [{ id: 12, projectId: 10, workerCategory: "company_admin" }]], [s.personnelPeople, [person({ legacyProfileId: 4, legacyWorkerId: 12 })]], [s.personnelSourceLinks, [{ personId: 1, sourceType: "worker", sourceId: 12 }]], [s.personnelSalaryHistory, [{ personId: 1, effectiveFrom: "2026-01-01", salaryBasis: "monthly", baseSalary: "9000", payrollEnabled: true, affiliation: "company" }]], [s.attendanceRecords, [{ workerId: 12, projectId: 10, attendanceDate: "2026-08-01", workHours: "8", overtimeHours: "0", status: "confirmed" }]]]));
    vi.mocked(getDb).mockResolvedValue(db);
    const result = await generatePayrollDraftForEmployeeProfile({ employeeProfileId: 4, period: "2026-08", actorUserId: 8, source: "manual" });
    expect(result.status).toBe("created"); expect(db.transaction).toHaveBeenCalledOnce();
    expect(writes.find(w => w.table === s.payrollStatements)!.values).toMatchObject({ workerId: 12, payableAmount: "300", actualAmount: "300", status: "draft" });
    expect(locks.slice(0, 2).map(t => t === s.personnelPeople ? "person" : "worker")).toEqual(["person", "worker"]);
    expect(locks.filter(t => t === s.employeeProfiles)).toHaveLength(2);
    expect(writes.filter(w => w.table === s.employeeProfiles)).toEqual([]);
  });
  it("已有审核工资生成重试只skip不覆盖历史金额", async () => {
    const { db, writes } = mockDb(new Map([[s.employeeProfiles, [profile()]], [s.laborWorkers, [{ id: 12, projectId: 10, workerCategory: "company_admin" }]], [s.payrollStatements, [{ id: 90, workerId: 12, projectId: 10, period: "2026-08", status: "paid", payableAmount: "777", actualAmount: "700" }]], [s.attendanceRecords, [{ workerId: 12, projectId: 10, attendanceDate: "2026-08-01", workHours: "8", overtimeHours: "0", status: "locked" }]]]));
    vi.mocked(getDb).mockResolvedValue(db);
    expect((await generatePayrollDraftForEmployeeProfile({ employeeProfileId: 4, period: "2026-08", actorUserId: 8, source: "manual" })).status).toBe("skipped");
    expect(writes).toEqual([]);
  });
});

describe("真实transition不搬历史金额", () => {
  function transitionFixture(overrides: Record<string, any> = {}) {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    const current = person({ userId: 7, legacyWorkerId: 12, legacyProfileId: 4, phoneEncrypted: "cipher:13800138000", phoneFingerprint: "hash:13800138000", ...overrides });
    const oldWorker = { id: 12, projectId: 10, workerCategory: "company_admin", realName: "旧名字", entryDate: new Date("2026-01-01Z"), exitDate: null, phoneEncrypted: "cipher:13800138000", phoneFingerprint: "hash:13800138000" };
    const financialTables = [s.payrollStatements, s.attendanceRecords, s.employeePayrollAdvances, s.employeeInsurancePolicies, s.temporaryDailyWageSettlements, s.settlementPaymentRecords];
    const data: MockData = new Map([[s.personnelPeople, [current]], [s.laborWorkers, [oldWorker]], [s.employeeProfiles, [profile()]], [s.personnelSourceLinks, [{ personId: 1, sourceType: "user", sourceId: 7 }, { personId: 1, sourceType: "profile", sourceId: 4 }, { personId: 1, sourceType: "worker", sourceId: 12 }]], [s.personnelSalaryHistory, [{ personId: 1, effectiveFrom: "2026-01-01", salaryBasis: "monthly", baseSalary: "9000", payrollEnabled: true, affiliation: "company" }]]]);
    financialTables.forEach((table, i) => data.set(table, [{ id: 50 + i, workerId: 12, projectId: 10, employeeProfileId: 4, period: "2026-08", payableAmount: "9000.12", actualAmount: "8000.34", amount: "123.45", status: "paid", paymentReference: "immutable-proof" }]));
    const baseline = financialTables.map(t => JSON.stringify(data.get(t)));
    return { ...mockDb(data), current, financialTables, baseline };
  }
  it("转项目关闭旧范围，append新subject，全部source同一master，历史金额考勤保险预支付款零改写", async () => {
    const { db, data, writes, current, financialTables, baseline } = transitionFixture({ projectId: 20 });
    const pointers = await db.transaction((tx: any) => ensureLegacyPayrollSubjects(tx, current, 8));
    expect(pointers.legacyWorkerId).not.toBe(12); expect(pointers.legacyProfileId).not.toBe(4);
    expect(data.get(s.laborWorkers)![0]).toMatchObject({ id: 12, projectId: 10, workerCategory: "company_admin", phoneFingerprint: "hash:13800138000", exitDate: new Date("2026-11-02Z") });
    expect(data.get(s.employeeProfiles)![0]).toMatchObject({ userId: 7, laborWorkerId: 12, projectId: 10, baseSalary: "9000", joinedAt: new Date("2026-01-01Z"), leftAt: new Date("2026-11-02Z") });
    expect(data.get(s.laborWorkers)!.at(-1)).toMatchObject({ projectId: 20, workerCategory: "company_admin", entryDate: new Date("2026-11-03Z"), phoneFingerprint: null });
    expect(data.get(s.employeeProfiles)!.at(-1)).toMatchObject({ userId: 7, laborWorkerId: pointers.legacyWorkerId, projectId: 20, joinedAt: new Date("2026-11-03Z") });
    expect(data.get(s.personnelPeople)![0]).toMatchObject(pointers);
    expect(data.get(s.personnelSourceLinks)).toHaveLength(5); expect(data.get(s.personnelSourceLinks)!.every(l => l.personId === 1)).toBe(true);
    expect(financialTables.map(t => JSON.stringify(data.get(t)))).toEqual(baseline);
    expect(writes.some(w => financialTables.includes(w.table as any))).toBe(false);
    await syncLegacyMirrors(db, { ...current, ...pointers });
    expect(data.get(s.laborWorkers)![0].realName).toBe("旧名字");
    expect(data.get(s.laborWorkers)!.at(-1)!.phoneFingerprint).toBeNull();
    expect(data.get(s.employeeProfiles)!.at(-1)!.joinedAt).toEqual(new Date("2026-11-03Z"));
  });
  it("转人关闭旧阶段所有已确认worker/profile aliases，不漏重复任职或删除来源", async () => {
    const { db, data, current } = transitionFixture({ projectId: 20 });
    data.get(s.laborWorkers)!.push({ ...data.get(s.laborWorkers)![0], id: 13, phoneFingerprint: null });
    data.get(s.employeeProfiles)!.push(profile({ id: 5 }), profile({ id: 6, laborWorkerId: 13, baseSalary: "6000" }));
    data.get(s.personnelSourceLinks)!.push({ personId: 1, sourceType: "worker", sourceId: 13 }, { personId: 1, sourceType: "profile", sourceId: 5 }, { personId: 1, sourceType: "profile", sourceId: 6 });
    await ensureLegacyPayrollSubjects(db, current, 8);
    expect(data.get(s.employeeProfiles)!.filter(p => p.projectId === 10).map(p => p.leftAt)).toEqual([new Date("2026-11-02Z"), new Date("2026-11-02Z"), new Date("2026-11-02Z")]);
    expect(data.get(s.laborWorkers)!.filter(w => w.projectId === 10).every(w => w.exitDate.getTime() === new Date("2026-11-02Z").getTime())).toBe(true);
    expect(data.get(s.employeeProfiles)![2].baseSalary).toBe("6000");
    expect(data.get(s.personnelSourceLinks)).toHaveLength(8);
  });
  it("同项目类别切换保留旧工资报表分类，external关闭原历史而不将公司工资改归劳务", async () => {
    const { db, data, current } = transitionFixture({ affiliation: "temporary" });
    const pointers = await ensureLegacyPayrollSubjects(db, current, 8);
    expect(data.get(s.laborWorkers)!.map(w => w.workerCategory)).toEqual(["company_admin", "temporary_daily"]);
    const external = { ...current, ...pointers, affiliation: "external", payrollEnabled: false };
    Object.assign(data.get(s.personnelPeople)![0], external);
    await syncLegacyMirrors(db, external);
    expect(data.get(s.laborWorkers)!.map(w => w.workerCategory)).toEqual(["company_admin", "temporary_daily"]);
    expect(data.get(s.employeeProfiles)!.every(p => p.leftAt)).toBe(true);
    expect(data.get(s.laborWorkers)).toHaveLength(2);
  });
  it("未来重新开启仅准备未来范围主体，今日false不提前关闭未来subject", async () => {
    const { db, data, current } = transitionFixture({ payrollEnabled: false });
    data.get(s.laborWorkers)![0].exitDate = new Date("2026-10-31Z"); data.get(s.employeeProfiles)![0].leftAt = new Date("2026-10-31Z");
    data.get(s.personnelSalaryHistory)!.push({ personId: 1, effectiveFrom: "2026-12-01", payrollEnabled: true, affiliation: "company", salaryBasis: "monthly", baseSalary: "10000" });
    const pointers = await ensureLegacyPayrollSubjects(db, { ...current, payrollEnabled: true }, 8);
    await syncLegacyMirrors(db, { ...current, ...pointers });
    expect(data.get(s.employeeProfiles)!.at(-1)).toMatchObject({ joinedAt: new Date("2026-12-01Z"), leftAt: null });
    expect(data.get(s.laborWorkers)!.at(-1)).toMatchObject({ entryDate: new Date("2026-12-01Z"), exitDate: null });
  });
  it("旧caller version冲突无任何写入；pointer CAS失败同事务回滚新subject", async () => {
    const { db, data, writes, current } = transitionFixture({ projectId: 20 });
    await expect(ensureLegacyPayrollSubjects(db, { ...current, version: 0 }, 8)).rejects.toThrow("人员版本"); expect(writes).toEqual([]);
    const originalUpdate = db.update;
    db.update = vi.fn((table: unknown) => table === s.personnelPeople ? { set: () => ({ where: async () => [{ affectedRows: 0 }] }) } : originalUpdate(table));
    await expect(db.transaction((tx: any) => ensureLegacyPayrollSubjects(tx, current, 8))).rejects.toThrow("同事务回滚");
    expect(data.get(s.laborWorkers)).toHaveLength(1); expect(data.get(s.employeeProfiles)).toHaveLength(1); expect(writes).toEqual([]);
  });
  it("同person已确认多worker电话别名可同步，别人的source绝不电话合并", async () => {
    const { db, data, current } = transitionFixture({ projectId: 20 });
    const pointers = await ensureLegacyPayrollSubjects(db, current, 8);
    await expect(syncLegacyMirrors(db, { ...current, ...pointers })).resolves.toBeUndefined();
    data.get(s.personnelSourceLinks)!.find(l => l.sourceType === "worker" && l.sourceId === 12)!.personId = 2;
    await expect(db.transaction((tx: any) => syncLegacyMirrors(tx, { ...current, ...pointers }))).rejects.toThrow("不会按手机号合并");
    expect(data.get(s.personnelPeople)).toHaveLength(1);
  });
  it("历史资格解析返回旧project profile，不依当前external/disabled；关停后考勤不纳月薪", async () => {
    const { db, data } = transitionFixture({ projectId: 20, affiliation: "external", payrollEnabled: false });
    data.get(s.personnelSalaryHistory)!.push({ personId: 1, effectiveFrom: "2026-11-03", payrollEnabled: false, affiliation: "external", salaryBasis: "monthly", baseSalary: "9000" });
    expect(await getPersonnelPayrollProfilesForPeriod(db, 1, "2026-08")).toEqual([{ employeeProfileId: 4, workerId: 12, projectId: 10, ranges: [{ start: "2026-08-01", end: "2026-08-31" }] }]);
    const preview = buildPayrollAccrualPreview({ profile: profile(), period: "2026-11", asOfDate: "2026-11-30", attendanceRows: ["2026-11-02", "2026-11-04"].map(attendanceDate => ({ attendanceDate, workHours: 8, overtimeHours: 0, status: "locked" as const })), salaryHistory: data.get(s.personnelSalaryHistory) as any });
    expect(preview).toMatchObject({ calculable: true, payableAmount: 300, confirmedAttendanceDays: 1 });
  });
  it("同月转项目无重叠阶段可分别生成；重复profile/worker alias重叠阶段禁止双算", async () => {
    const { db, data } = transitionFixture();
    data.set(s.employeeProfiles, [profile({ leftAt: new Date("2026-11-02Z") }), profile({ id: 5, laborWorkerId: 13, projectId: 20, joinedAt: new Date("2026-11-03Z") })]);
    data.get(s.laborWorkers)!.push({ id: 13, projectId: 20, workerCategory: "company_admin" });
    data.get(s.personnelSourceLinks)!.push({ personId: 1, sourceType: "worker", sourceId: 13 });
    data.set(s.payrollStatements, [{ workerId: 12, projectId: 10, period: "2026-11", status: "paid" }]);
    await expect(assertCompensationChannel(db, { workerId: 13, projectId: 20, period: "2026-11", channel: "monthly", lock: true })).resolves.toMatchObject({ workerIds: [13, 12] });
    data.get(s.payrollStatements)![0].projectId = 20;
    await expect(assertCompensationChannel(db, { workerId: 13, projectId: 20, period: "2026-11", channel: "monthly", lock: true })).rejects.toThrow("不能重复制单");
    data.get(s.payrollStatements)![0].projectId = 10;
    data.get(s.employeeProfiles)![1].joinedAt = new Date("2026-11-02Z");
    await expect(assertCompensationChannel(db, { workerId: 13, projectId: 20, period: "2026-11", channel: "monthly", lock: true })).rejects.toThrow("不能重复制单");
    data.set(s.payrollStatements, []); data.get(s.laborWorkers)![1].workerCategory = "temporary_daily";
    data.set(s.personnelSalaryHistory, [{ personId: 1, effectiveFrom: "2026-01-01", payrollEnabled: true, affiliation: "temporary" }]);
    data.set(s.temporaryDailyWageSettlements, [{ workerId: 12, settlementDate: "2026-11-04", status: "paid" }]);
    await expect(assertCompensationChannel(db, { workerId: 13, projectId: 20, period: "2026-11", settlementDate: "2026-11-04", channel: "daily", lock: true })).rejects.toThrow("已有当日日结");
  });
});

describe("资源真实人员与门户授权", () => {
  it("换person不自动赋权，只保留真实同人原账号，显式错账号拒绝", () => {
    expect(resolveResourceLoginBinding(7, 7)).toBe(7);
    expect(resolveResourceLoginBinding(9, 7)).toBeNull();
    expect(resolveResourceLoginBinding(9, null)).toBeNull();
    expect(resolveResourceLoginBinding(null, 7)).toBeNull();
    expect(() => resolveResourceLoginBinding(9, 7, 7)).toThrow("不是所选人员");
  });
  it("真实姓名电话来自person并校验项目和岗位，不读取工资/账号权限", async () => {
    const map: MockData = new Map([[s.personnelPeople, [person({ userId: 7, name: "实名司机", phoneEncrypted: "cipher:13800138000", phoneMasked: "****8000" })]], [s.personnelPositions, [{ id: 3, category: "driver", status: "active" }]]]);
    const { db, writes } = mockDb(map);
    await expect(resolveResourcePerson(db, { personId: 1, assetType: "vehicle", projectId: 10, previousUserId: 7 })).resolves.toMatchObject({ name: "实名司机", phoneMasked: "****8000", userId: 7 });
    await expect(resolveResourcePerson(db, { personId: 1, assetType: "vehicle", projectId: 20, previousUserId: 7 })).rejects.toThrow("当前资源项目");
    map.set(s.personnelPositions, [{ id: 3, category: "management", status: "active" }]);
    await expect(resolveResourcePerson(db, { personId: 1, assetType: "vehicle", projectId: 10, previousUserId: 7 })).rejects.toThrow("对应司机/操作员岗位"); expect(writes).toEqual([]);
  });
  it("资源换人锁行、关闭历史、新增历史，剥离他人门户绑定而不改运单快照", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    const { db, writes, locks } = mockDb(new Map([[s.transportVehicles, [{ id: 30, projectId: 10, driverPersonId: 2, driverUserId: 7, createdAt: new Date("2026-01-01Z") }]], [s.personnelPeople, [person({ userId: 9 }), person({ id: 2, userId: 7 })]], [s.personnelPositions, [{ id: 3, category: "driver", status: "active" }]], [s.personnelResourceBindings, [{ id: 80, personId: 2, assetType: "vehicle", assetId: 30, effectiveFrom: "2026-01-01", effectiveTo: null }]]]));
    await saveResourceBinding(db, { personId: 1, assetType: "vehicle", assetId: 30, effectiveFrom: today, actorUserId: 8, projectId: 10 });
    expect(locks.map(t => t === s.transportVehicles ? "asset" : "history")).toEqual(["asset", "history"]);
    expect(writes.find(w => w.table === s.transportVehicles)!.values).toMatchObject({ driverPersonId: 1, driverUserId: null, driverName: "真实人员" });
    expect(writes.filter(w => w.table === s.personnelResourceBindings)).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "update", values: { effectiveTo: today } }), expect.objectContaining({ operation: "insert", values: expect.objectContaining({ personId: 1, effectiveFrom: today }) })]));
    expect(writes.some(w => w.table === s.transportTrips || w.table === s.users)).toBe(false);
  });
  it("未来日期、过去日期和指定截止明确拒绝，历史不得覆盖", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    const { db, writes } = mockDb(new Map([[s.transportVehicles, [{ id: 30, projectId: 10, driverPersonId: 2, driverUserId: null }]], [s.personnelPeople, [person()]], [s.personnelPositions, [{ id: 3, category: "driver", status: "active" }]], [s.personnelResourceBindings, [{ personId: 2, effectiveFrom: today }]]]));
    const input = { personId: 1, assetType: "vehicle" as const, assetId: 30, effectiveFrom: today, actorUserId: 8, projectId: 10 };
    await expect(saveResourceBinding(db, { ...input, effectiveFrom: "2026-12-01" })).rejects.toThrow("今日即时生效");
    await expect(saveResourceBinding(db, { ...input, effectiveFrom: "2026-11-02" })).rejects.toThrow("今日即时生效");
    await expect(saveResourceBinding(db, { ...input, effectiveTo: "2026-11-04" })).rejects.toThrow("今日即时生效"); expect(writes).toEqual([]);
  });
  it("同资产同日反复换司机/操作员append零覆盖，createdAt同秒按id顺序，旧登录关联留审计", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    for (const assetType of ["vehicle", "machine"] as const) {
      const table = assetType === "vehicle" ? s.transportVehicles : s.machines;
      const pointer = assetType === "vehicle" ? "driverPersonId" : "operatorPersonId";
      const userPointer = assetType === "vehicle" ? "driverUserId" : "operatorUserId";
      const { db, data, writes, locks } = mockDb(new Map([[table, [{ id: 30, projectId: 10, [pointer]: 2, [userPointer]: 7, createdAt: new Date("2026-11-03T07:00:00Z") }]], [s.personnelPeople, [person({ userId: 9 }), person({ id: 2, userId: 7 })]], [s.personnelPositions, [{ id: 3, category: "driver", status: "active" }]]]));
      for (const personId of [1, 2, 1]) await db.transaction((tx: any) => saveResourceBinding(tx, { personId, assetType, assetId: 30, effectiveFrom: today, actorUserId: 8, projectId: 10 }));
      const rows = data.get(s.personnelResourceBindings)!;
      expect(rows.map(h => h.personId)).toEqual([2, 1, 2, 1]);
      expect(rows.map(h => h.effectiveFrom)).toEqual([today, today, today, today]);
      expect(rows.map(h => h.effectiveTo ?? null)).toEqual([today, today, today, null]);
      expect(rows.slice(1).every(h => h.createdAt.getTime() === new Date("2026-11-03T08:00:00Z").getTime())).toBe(true);
      expect(rows.map(h => h.id)).toEqual([...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).map(h => h.id));
      expect(data.get(table)![0]).toMatchObject({ [pointer]: 1, [userPointer]: null });
      expect(locks.every((t, i) => t === (i % 2 ? s.personnelResourceBindings : table))).toBe(true);
      expect(data.get(s.personnelChanges)!.some(h => h.changes.resourceBinding.before.userId === 7)).toBe(true);
      expect(writes.filter(w => w.table === s.personnelResourceBindings && w.operation === "update").every(w => Object.keys(w.values).join() === "effectiveTo")).toBe(true);
      const count = rows.length;
      await saveResourceBinding(db, { personId: 1, assetType, assetId: 30, effectiveFrom: today, actorUserId: 8, projectId: 10, requestedUserId: 9 });
      expect(data.get(s.personnelResourceBindings)).toHaveLength(count); // 同人绑定登录账号不捏造换班。
      expect(data.get(s.personnelChanges)!.at(-1)!.changes.resourceBinding.after.userId).toBe(9);
    }
  });
});

describe("真实统一付款明细", () => {
  it("已付按active expense逐笔汇总不以actualAmount充当已付，冲正及income不计", async () => {
    const { db } = mockDb(new Map([[s.payrollStatements, [{ id: 90, workerId: 12, period: "2026-08", actualAmount: "9000", status: "partial", paymentReference: "secret" }]], [s.settlementPaymentRecords, [{ id: 1, settlementType: "payroll", settlementId: 90, amount: "1000", direction: "expense", status: "active" }, { id: 2, settlementType: "payroll", settlementId: 90, amount: "500", direction: "expense", status: "reversed" }, { id: 3, settlementType: "payroll", settlementId: 90, amount: "100", direction: "income", status: "active" }]]]));
    const result = await getLegacyCompensation(db, { profileIds: [4], workerIds: [12], period: "2026-08" });
    expect(result.payroll[0]).toMatchObject({ actualAmount: "9000", paidAmount: 1000 });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.payments).toHaveLength(3);
  });
});
