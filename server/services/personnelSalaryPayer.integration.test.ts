import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { eq, is } from "drizzle-orm";
import { MySqlTable, getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import * as s from "../../drizzle/schema";
import { PERSONNEL_DEFAULT_POSITIONS, personnelSaveInput, resolvePersonnelSalaryPayer } from "../../shared/personnel";
import { getDb } from "../db";
import { personnelRouter } from "../routers/personnel";
import { adminRouter } from "../routers/admin";
import { directoryDetail, listDirectoryPeople, saveDirectoryPerson } from "./personnelDirectory";
import { assertCompanyPayrollAdvance, assertCompanyPayrollSettlement, assertCompensationChannel, historicalCompensationRanges } from "./personnelLegacyBridge";
import { generatePayrollDraftForEmployeeProfile, calculateEffectiveSalaryAccrual } from "./payrollGeneration";
import { chinaBusinessDate } from "./chinaBusinessTime";

const enabled = process.env.PERSONNEL_PAYER_REAL_DB_TEST === "1";
const suite = enabled ? describe : describe.skip;
const today = chinaBusinessDate(new Date());
const future = new Date(new Date(`${today}T00:00:00Z`).getTime() + 40 * 86400000).toISOString().slice(0, 10);
const oldPeriod = "2026-08";
const base = { name: "隔离真实服务人员", affiliation: "company" as const, primaryPositionId: null, employmentStatus: "active" as const, payrollEnabled: false };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let setup: mysql.Connection;
const caller = (role: "admin" | "user" = "admin") => personnelRouter.createCaller({ user: { id: role === "admin" ? 1 : 2, role, loginMethod: "test", name: "本地回归" }, req: { headers: {} }, res: {} } as any);
const adminCaller = () => adminRouter.createCaller({ user: { id: 1, role: "admin", loginMethod: "test", name: "本地回归" }, req: { headers: {} }, res: {} } as any);
async function main(id: number) { return (await db.select().from(s.personnelPeople).where(eq(s.personnelPeople.id, id)))[0]; }
async function history(id: number) { return await db.select().from(s.personnelSalaryHistory).where(eq(s.personnelSalaryHistory.personId, id)); }

suite("发薪主体：真实本地MariaDB / 原服务与授权caller", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "33316" || url.pathname !== "/personnel_payer_regression") throw new Error("仅允许指定本地隔离回归数据库，禁止开发/生产远端数据库");
    setup = await mysql.createConnection(url.toString());
    const tables = [s.personnelPeople, s.personnelPositions, s.personnelSalaryHistory, s.personnelAssignments, s.personnelSourceLinks, s.personnelChanges, s.personnelTeams, s.personnelDocuments, s.personnelResourceBindings, s.projects, s.users, s.userProfiles, s.userRoleAssignments, s.systemRoles, s.userPermissions, s.rolePermissions, s.systemPermissions, s.laborWorkers, s.employeeProfiles, s.employeePayrollAdvances, s.employeeInsurancePolicies, s.payrollStatements, s.temporaryDailyWageSettlements, s.attendanceRecords, s.settlementPaymentRecords, s.transportVehicles, s.machines, s.auditLogs];
    const dialect = new MySqlDialect();
    for (const table of tables) {
      if (!is(table, MySqlTable)) throw new Error("不是MySQL表");
      const config = getTableConfig(table);
      await setup.query(`DROP TABLE IF EXISTS \`${config.name}\``);
      const columns = config.columns.map(c => {
        let definition = `\`${c.name}\` ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}${(c as any).autoIncrement ? " AUTO_INCREMENT" : ""}${c.primary ? " PRIMARY KEY" : ""}`;
        if (c.default !== undefined) {
          const value = c.default;
          definition += " DEFAULT " + (typeof value === "boolean" ? Number(value) : typeof value === "number" ? value : typeof value === "string" ? mysql.escape(value) : `(${dialect.sqlToQuery(value as any).sql})`);
        }
        return definition;
      });
      const uniqueIndexes = config.indexes.filter(i => i.config.unique).map(i => `UNIQUE KEY \`${i.config.name}\` (${i.config.columns.map(c => `\`${(c as any).name}\``).join(",")})`);
      await setup.query(`CREATE TABLE \`${config.name}\` (${[...columns, ...uniqueIndexes].join(",")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    db = (await getDb())!;
    await db.insert(s.projects).values({ id: 10, code: "PAYER-LOCAL", name: "回环发薪隔离项目", nodeType: "project", status: "active" });
    await db.insert(s.users).values([{ id: 1, openId: "payer-local-admin", name: "回归管理员", role: "admin" }, { id: 2, openId: "payer-local-user", name: "普通无授权用户", role: "user" }]);
    await db.insert(s.personnelPositions).values(PERSONNEL_DEFAULT_POSITIONS.map(p => ({ ...p })));
  }, 30000);
  afterAll(async () => { await setup?.end(); if (db) await (db as any).$client.end(); });

  it("共享分类保留原名，owner矛盾与字段长度拒绝，停薪不推断老板", () => {
    expect(PERSONNEL_DEFAULT_POSITIONS).toHaveLength(23);
    expect(PERSONNEL_DEFAULT_POSITIONS.some(p => p.name === "运输司机")).toBe(true);
    expect(PERSONNEL_DEFAULT_POSITIONS.some(p => p.name === "碴土车驾驶员")).toBe(true);
    expect(resolvePersonnelSalaryPayer({ affiliation: "company" })).toEqual({ salaryPayerType: "company", salaryPayerName: null });
    expect(resolvePersonnelSalaryPayer({ affiliation: "external" })).toEqual({ salaryPayerType: "owner", salaryPayerName: null });
    expect(personnelSaveInput.safeParse({ ...base, salaryPayerType: "owner", payrollEnabled: true }).success).toBe(false);
    expect(personnelSaveInput.safeParse({ ...base, salaryPayerName: "名".repeat(129) }).success).toBe(false);
  });

  it("真实caller新增两种发薪与分类，不创建用户权限；列表详情一致", async () => {
    const [position] = await db.select().from(s.personnelPositions).where(eq(s.personnelPositions.name, "推土机驾驶员"));
    const owner = await caller().save({ ...base, primaryPositionId: position.id, salaryPayerType: "owner", salaryPayerName: "登记老板（未核验）", baseSalary: 9000 });
    const company = await caller().save({ ...base, name: "公司计薪人员", projectId: 10, payrollEnabled: true, salaryPayerType: "company", baseSalary: 6000, entryDate: today });
    expect(await main(owner.id)).toMatchObject({ salaryPayerType: "owner", salaryPayerName: "登记老板（未核验）", legacyWorkerId: null, legacyProfileId: null });
    expect(await main(company.id)).toMatchObject({ salaryPayerType: "company", payrollEnabled: true });
    expect((await main(company.id)).legacyWorkerId).toBeTypeOf("number");
    const list = await listDirectoryPeople(undefined);
    const detail = await directoryDetail(owner.id);
    expect(list.find(p => p.id === owner.id)).toMatchObject({ salaryPayerType: "owner", salaryPayerName: "登记老板（未核验）", positionName: "推土机驾驶员" });
    expect(detail.person).toMatchObject({ salaryPayerType: "owner", salaryPayerName: "登记老板（未核验）" });
    expect(detail.salaryHistory[0]).toMatchObject({ salaryPayerType: "owner", salaryPayerName: "登记老板（未核验）" });
    expect(await db.select().from(s.users)).toHaveLength(2);
    expect(await db.select().from(s.userRoleAssignments)).toHaveLength(0);
    expect(await db.select().from(s.userPermissions)).toHaveLength(0);
  });

  it("旧caller省略保留owner登记及未来版本，不要求新分类；CAS冲突回滚", async () => {
    const created = await caller().save({ ...base, salaryPayerType: "owner", salaryPayerName: "原车队" });
    const first = await caller().save({ ...base, id: created.id, version: 1, name: "旧caller只更正姓名" });
    expect(await main(created.id)).toMatchObject({ version: 2, salaryPayerType: "owner", salaryPayerName: "原车队", primaryPositionId: null });
    const prior = await history(created.id);
    await expect(caller().save({ ...base, id: created.id, version: 1, salaryPayerName: null, salaryEffectiveFrom: future })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await history(created.id)).toEqual(prior);
    expect(first.id).toBe(created.id);
  });

  it("owner转未来公司版本准备未来主体，今天不计薪，未来公司预支可以办理", async () => {
    const created = await caller().save({ ...base, projectId: 10, salaryPayerType: "owner", salaryPayerName: "原老板" });
    await caller().save({ ...base, id: created.id, version: 1, projectId: 10, salaryPayerType: "company", payrollEnabled: true, salaryEffectiveFrom: future, baseSalary: 6000 });
    const p = await main(created.id);
    const detail = await directoryDetail(p.id);
    expect(detail.person).toMatchObject({ salaryPayerType: "owner", payrollEnabled: false });
    expect(p.legacyWorkerId).toBeTypeOf("number");
    expect(detail.payrollSubjects[0]).toMatchObject({ joinedAt: future, leftAt: null });
    await expect(adminCaller().employee.saveAdvance({ employeeProfileId: p.legacyProfileId!, advanceDate: today, amount: 100, status: "draft" })).rejects.toThrow("公司工资预支");
    const advance = await caller().saveAdvance({ personId: p.id, employeeProfileId: p.legacyProfileId!, advanceDate: future, amount: 100 });
    expect(advance.success).toBe(true);
    expect((await db.select().from(s.employeePayrollAdvances).where(eq(s.employeePayrollAdvances.id, Number(advance.id))))[0]).toMatchObject({ employeeProfileId: p.legacyProfileId, amount: "100.00", status: "draft" });
    await expect(caller().save({ ...base, id: p.id, version: 2, projectId: 10, salaryPayerType: "company", payrollEnabled: true, salaryEffectiveFrom: "2020-01-01" })).rejects.toThrow("不能追溯覆盖历史薪资");
    await expect(caller().save({ ...base, id: p.id, version: 2, projectId: 10, salaryPayerType: "company", payrollEnabled: true, salaryEffectiveFrom: future })).rejects.toThrow("该生效日期已有薪资版本");
  });

  it("未来转owner只追加历史，不改当前公司/往月工资，省略字段保留未来安排", async () => {
    const created = await saveDirectoryPerson({ ...base, projectId: 10, payrollEnabled: true, salaryPayerType: "company", baseSalary: 9000, salaryEffectiveFrom: "2026-01-01", entryDate: "2026-01-01" }, 1, db);
    const p = await main(created.id);
    const baseline = (await history(p.id))[0];
    await db.insert(s.attendanceRecords).values({ workerId: p.legacyWorkerId!, projectId: 10, attendanceDate: new Date("2026-08-01T00:00:00Z"), status: "confirmed", workHours: "8", overtimeHours: "0" } as any);
    await caller().save({ ...base, id: p.id, version: 1, projectId: 10, salaryPayerType: "owner", salaryPayerName: "未来车队", payrollEnabled: false, salaryEffectiveFrom: future });
    expect((await directoryDetail(p.id)).person).toMatchObject({ salaryPayerType: "company", payrollEnabled: true });
    await caller().save({ ...base, id: p.id, version: 2, projectId: 10, payrollEnabled: true, name: "旧caller保留未来版本" });
    expect((await history(p.id))[0]).toEqual(baseline);
    expect((await history(p.id)).find(h => h.effectiveFrom === future)).toMatchObject({ salaryPayerType: "owner", salaryPayerName: "未来车队" });
    const generated = await generatePayrollDraftForEmployeeProfile({ employeeProfileId: p.legacyProfileId!, period: oldPeriod, actorUserId: 1, source: "manual" });
    expect(generated.status).toBe("created");
    expect(generated.preview.payableAmount).toBe(300);
    expect((await generatePayrollDraftForEmployeeProfile({ employeeProfileId: p.legacyProfileId!, period: future.slice(0, 7), actorUserId: 1, source: "manual" })).status).toBe("blocked");
  });

  it("当天转owner关闭未来公司办理，不抹历史薪资/已结算已付事实，旧公司期间仍可生成", async () => {
    const created = await saveDirectoryPerson({ ...base, projectId: 10, payrollEnabled: true, salaryPayerType: "company", baseSalary: 9000, salaryEffectiveFrom: "2026-01-01", entryDate: "2026-01-01" }, 1, db);
    const p = await main(created.id);
    await db.insert(s.attendanceRecords).values({ workerId: p.legacyWorkerId!, projectId: 10, attendanceDate: new Date("2026-08-01T00:00:00Z"), status: "confirmed", workHours: "8", overtimeHours: "0" } as any);
    const [paid] = await db.insert(s.payrollStatements).values({ workerId: p.legacyWorkerId!, projectId: 10, period: "2026-07", status: "paid", payableAmount: "777.12", actualAmount: "700.34" });
    await db.insert(s.settlementPaymentRecords).values({ projectId: 10, settlementType: "payroll", settlementId: Number(paid.insertId), direction: "expense", amount: "700.34", paymentDate: new Date("2026-07-31T00:00:00Z"), paymentMethod: "cash", status: "active", payeeNameSnapshot: p.name, paidBy: 1, paidAt: new Date("2026-07-31T00:00:00Z") });
    const originalHistory = (await history(p.id))[0];
    const financialBefore = JSON.stringify(await db.select().from(s.settlementPaymentRecords));
    await caller().save({ ...base, id: p.id, version: 1, projectId: 10, salaryPayerType: "owner", salaryPayerName: "自行发薪机械老板", salaryEffectiveFrom: today });
    expect(await main(p.id)).toMatchObject({ salaryPayerType: "owner", payrollEnabled: false });
    expect((await history(p.id))[0]).toEqual(originalHistory);
    expect(JSON.stringify(await db.select().from(s.settlementPaymentRecords))).toBe(financialBefore);
    expect((await db.select().from(s.payrollStatements).where(eq(s.payrollStatements.id, Number(paid.insertId))))[0]).toMatchObject({ status: "paid", payableAmount: "777.12", actualAmount: "700.34" });
    await expect(caller().save({ ...base, id: p.id, version: 2, projectId: 10, payrollEnabled: true, salaryEffectiveFrom: future })).rejects.toThrow("老板自行发放");
    await expect(adminCaller().employee.saveAdvance({ employeeProfileId: p.legacyProfileId!, advanceDate: today, amount: 100, status: "draft" })).rejects.toThrow("公司工资预支");
    await expect(caller().saveAdvance({ personId: p.id, advanceDate: today, amount: 100 })).rejects.toThrow("老板自行发薪");
    await expect(assertCompensationChannel(db, { workerId: p.legacyWorkerId!, projectId: 10, period: future.slice(0, 7), channel: "monthly", lock: true })).rejects.toThrow("有效计薪资格");
    await expect(assertCompanyPayrollSettlement(db, { workerId: p.legacyWorkerId!, projectId: 10, period: future.slice(0, 7), channel: "monthly" })).rejects.toThrow("不能办理公司工资结算");
    await expect(assertCompanyPayrollSettlement(db, { workerId: p.legacyWorkerId!, projectId: 10, period: "2026-07", channel: "monthly" })).resolves.toBeUndefined();
    expect((await generatePayrollDraftForEmployeeProfile({ employeeProfileId: p.legacyProfileId!, period: oldPeriod, actorUserId: 1, source: "manual" })).status).toBe("created");
    await expect(caller().saveAdvance({ personId: p.id, employeeProfileId: p.legacyProfileId!, advanceDate: "2026-08-05", amount: 10 })).resolves.toMatchObject({ success: true });
    const detail = await directoryDetail(p.id);
    expect(detail.compensation.payments.some(r => r.id && r.amount === "700.34")).toBe(true);
  });

  it("旧NULL发薪字段按当前薪资版本优先，不把停薪当老板，不批量回写", async () => {
    const created = await caller().save({ ...base });
    await db.update(s.personnelPeople).set({ affiliation: "external", salaryPayerType: null, salaryPayerName: null }).where(eq(s.personnelPeople.id, created.id));
    await db.insert(s.personnelSalaryHistory).values({ personId: created.id, affiliation: "company", payrollEnabled: false, salaryBasis: "monthly", baseSalary: null, effectiveFrom: "2026-01-01", createdBy: 1 });
    expect((await directoryDetail(created.id)).person.salaryPayerType).toBe("company");
    expect((await listDirectoryPeople(undefined)).find(p => p.id === created.id)?.salaryPayerType).toBe("company");
    expect(await main(created.id)).toMatchObject({ salaryPayerType: null, salaryPayerName: null });
  });

  it("同月发薪历史按区间裁切，owner即使污染为enabled也不计公司工资或日结", () => {
    const history = [{ effectiveFrom: "2026-08-01", affiliation: "company", payrollEnabled: true, salaryPayerType: "company", salaryBasis: "monthly" as const, baseSalary: "9000" }, { effectiveFrom: "2026-08-15", affiliation: "company", payrollEnabled: true, salaryPayerType: "owner", salaryBasis: "monthly" as const, baseSalary: "99999" }];
    expect(historicalCompensationRanges({ start: "2026-08-01", end: "2026-08-31" }, history, "monthly")).toEqual([{ start: "2026-08-01", end: "2026-08-14" }]);
    expect(calculateEffectiveSalaryAccrual([{ attendanceDate: "2026-08-16", workHours: 8, overtimeHours: 0, status: "confirmed" }], history)).toMatchObject({ calculable: false, payableAmount: null });
    expect(historicalCompensationRanges({ start: "2026-08-01", end: "2026-08-31" }, [{ ...history[1], affiliation: "temporary" }], "daily")).toEqual([]);
  });

  it("无角色用户不能建档/读档/预支，发薪名称不赋角色或门户权限", async () => {
    await expect(caller("user").save({ ...base, salaryPayerType: "owner", salaryPayerName: "超级管理员" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").saveAdvance({ personId: 1, advanceDate: today, amount: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(s.users)).toHaveLength(2);
    expect(await db.select().from(s.userRoleAssignments)).toHaveLength(0);
  });
});
