import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import * as s from "../../drizzle/schema";
import { adoptLegacy, ensureLegacyPayrollSubjects, syncLegacyMirrors } from "./personnelLegacyBridge";
import { saveDirectoryPerson } from "./personnelDirectory";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { calculateEffectiveSalaryAccrual } from "./payrollGeneration";

const suite = process.env.PERSONNEL_BRIDGE_REAL_DB_TEST === "1" ? describe : describe.skip;
const today = chinaBusinessDate(new Date());
let connection: mysql.Connection;
let db: ReturnType<typeof drizzle<typeof s>>;
const tables = [s.personnelPeople, s.personnelSourceLinks, s.personnelAssignments, s.personnelSalaryHistory, s.personnelChanges, s.personnelTeams, s.personnelPositions, s.projects, s.employeeProfiles, s.laborWorkers, s.users, s.userProfiles, s.attendanceRecords, s.payrollStatements, s.temporaryDailyWageSettlements, s.employeePayrollAdvances, s.settlementPaymentRecords, s.transportVehicles, s.machines];
const base = { name: "合成桥接人员", affiliation: "company" as const, employmentStatus: "active" as const, primaryPositionId: null, projectId: 10, payrollEnabled: true, salaryPayerType: "company" as const, baseSalary: 9000, entryDate: "2026-01-01", salaryEffectiveFrom: "2026-01-01" };
async function person(id: number) { return (await db.select().from(s.personnelPeople).where(eq(s.personnelPeople.id, id)))[0]; }
async function worker(id: number) { return (await db.select().from(s.laborWorkers).where(eq(s.laborWorkers.id, id)))[0]; }
async function profile(id: number) { return (await db.select().from(s.employeeProfiles).where(eq(s.employeeProfiles.id, id)))[0]; }

suite("桥接人员阶段：本地MariaDB真实服务合成回归", () => {
  beforeAll(async () => {
    // 此套件不使用DATABASE_URL，固定回环独立库，绝不重建其他代理的库。
    connection = await mysql.createConnection({ host: "127.0.0.1", port: 33316, user: "root" });
    await connection.query("CREATE DATABASE IF NOT EXISTS personnel_bridge_regression");
    await connection.query("USE personnel_bridge_regression");
    const dialect = new MySqlDialect();
    for (const table of tables) {
      const config = getTableConfig(table);
      await connection.query(`DROP TABLE IF EXISTS \`${config.name}\``);
      const columns = config.columns.map(c => {
        let definition = `\`${c.name}\` ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}${(c as any).autoIncrement ? " AUTO_INCREMENT" : ""}${c.primary ? " PRIMARY KEY" : ""}`;
        if (c.default !== undefined) definition += " DEFAULT " + (typeof c.default === "boolean" ? Number(c.default) : typeof c.default === "number" ? c.default : typeof c.default === "string" ? mysql.escape(c.default) : `(${dialect.sqlToQuery(c.default as any).sql})`);
        return definition;
      });
      const uniqueIndexes = config.indexes.filter(i => i.config.unique).map(i => `UNIQUE KEY \`${i.config.name}\` (${i.config.columns.map(c => `\`${(c as any).name}\``).join(",")})`);
      await connection.query(`CREATE TABLE \`${config.name}\` (${[...columns, ...uniqueIndexes].join(",")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    db = drizzle(connection, { schema: s, mode: "default" });
    await db.insert(s.projects).values([{ id: 10, code: "BRIDGE-10", name: "合成项目10", nodeType: "project" }, { id: 20, code: "BRIDGE-20", name: "合成项目20", nodeType: "project" }]);
    await db.insert(s.users).values({ id: 1, openId: "bridge-local", role: "admin", name: "合成管理员" });
  }, 30000);
  afterAll(async () => { await connection?.end(); });

  it("离场连续基础编辑不重建；重新进场只新增一个阶段，工资付款只读保留", async () => {
    const created = await saveDirectoryPerson(base, 1, db as any);
    let p = await person(created.id);
    const wid = p.legacyWorkerId!, pid = p.legacyProfileId!;
    const [paid] = await db.insert(s.payrollStatements).values({ workerId: wid, projectId: 10, period: "2026-08", status: "paid", payableAmount: "777.12", actualAmount: "700.34" });
    await db.insert(s.settlementPaymentRecords).values({ projectId: 10, settlementType: "payroll", settlementId: Number(paid.insertId), direction: "expense", amount: "700.34", paymentDate: new Date("2026-08-31Z"), paymentMethod: "cash", status: "active", payeeNameSnapshot: p.name, paidBy: 1, paidAt: new Date("2026-08-31Z") });
    const finances = JSON.stringify([await db.select().from(s.payrollStatements), await db.select().from(s.settlementPaymentRecords)]);
    await expect(saveDirectoryPerson({ ...base, id: p.id, version: p.version, entryDate: "2026-01-02" }, 1, db as any)).rejects.toThrow("已核定工资或付款历史");
    expect(await person(p.id)).toMatchObject({ version: p.version, entryDate: "2026-01-01" });
    await saveDirectoryPerson({ ...base, id: p.id, version: p.version, employmentStatus: "left", exitDate: "2026-10-31" }, 1, db as any);
    for (const name of ["更正一", "更正二"]) {
      p = await person(p.id);
      await saveDirectoryPerson({ ...base, id: p.id, version: p.version, employmentStatus: "left", exitDate: "2026-10-31", name }, 1, db as any);
      expect(await person(p.id)).toMatchObject({ legacyWorkerId: wid, legacyProfileId: pid });
    }
    expect(await db.select().from(s.laborWorkers)).toHaveLength(1);
    p = await person(p.id);
    await saveDirectoryPerson({ ...base, id: p.id, version: p.version, entryDate: today, exitDate: null }, 1, db as any);
    p = await person(p.id);
    expect(p.legacyWorkerId).not.toBe(wid); expect(p.entryDate).toBe(today);
    await syncLegacyMirrors(db, p);
    expect(await db.select().from(s.laborWorkers)).toHaveLength(2);
    expect(JSON.stringify([await db.select().from(s.payrollStatements), await db.select().from(s.settlementPaymentRecords)])).toBe(finances);
  });

  it("当前日期同步，无锁定更正；锁定和超范围记录拒绝，主档CAS事务回滚", async () => {
    const created = await saveDirectoryPerson({ ...base, name: "日期合成人员" }, 1, db as any);
    let p = await person(created.id);
    await saveDirectoryPerson({ ...base, id: p.id, version: p.version, entryDate: "2026-02-01" }, 1, db as any);
    p = await person(p.id);
    expect((await worker(p.legacyWorkerId!)).entryDate?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect((await profile(p.legacyProfileId!)).joinedAt?.toISOString().slice(0, 10)).toBe("2026-02-01");
    await db.insert(s.attendanceRecords).values({ workerId: p.legacyWorkerId!, projectId: 10, attendanceDate: new Date("2026-02-15Z"), status: "locked" });
    await expect(saveDirectoryPerson({ ...base, id: p.id, version: p.version, entryDate: "2026-02-02" }, 1, db as any)).rejects.toThrow("锁定");
    expect(await person(p.id)).toMatchObject({ version: p.version, entryDate: "2026-02-01" });
    await db.update(s.attendanceRecords).set({ status: "draft" }).where(eq(s.attendanceRecords.workerId, p.legacyWorkerId!));
    await expect(saveDirectoryPerson({ ...base, id: p.id, version: p.version, entryDate: "2026-03-01" }, 1, db as any)).rejects.toThrow("真实未锁定");
    expect((await person(p.id)).version).toBe(p.version);
  });

  it("施工队明确换清同步双镜像，未提交保留文本且关闭历史不改", async () => {
    const created = await saveDirectoryPerson({ ...base, name: "施工队合成人员" }, 1, db as any);
    const p = await person(created.id);
    await db.update(s.laborWorkers).set({ teamName: "未映射旧队" }).where(eq(s.laborWorkers.id, p.legacyWorkerId!));
    await db.update(s.employeeProfiles).set({ teamName: "未映射旧队" }).where(eq(s.employeeProfiles.id, p.legacyProfileId!));
    await syncLegacyMirrors(db, p);
    expect((await profile(p.legacyProfileId!)).teamName).toBe("未映射旧队");
    await db.insert(s.personnelTeams).values({ id: 9, projectId: 10, name: "真实新队" });
    await db.update(s.personnelPeople).set({ teamId: 9 }).where(eq(s.personnelPeople.id, p.id));
    await syncLegacyMirrors(db, await person(p.id), { teamId: 9 });
    expect((await worker(p.legacyWorkerId!)).teamName).toBe("真实新队"); expect((await profile(p.legacyProfileId!)).teamName).toBe("真实新队");
    await db.update(s.personnelPeople).set({ teamId: null }).where(eq(s.personnelPeople.id, p.id));
    await syncLegacyMirrors(db, await person(p.id), { teamId: null });
    expect((await worker(p.legacyWorkerId!)).teamName).toBeNull(); expect((await profile(p.legacyProfileId!)).teamName).toBeNull();
  });

  it("历史引入按真实阶段不用updatedAt，薪资不伪造旧生效日，全部来源与旧金额保留", async () => {
    await db.insert(s.users).values({ id: 7, openId: "legacy-bridge-local", name: "真实来源账号" });
    const [w1] = await db.insert(s.laborWorkers).values({ projectId: 10, workerCategory: "company_admin", realName: "来源人", entryDate: new Date("2026-01-01Z"), exitDate: new Date("2026-07-31Z") });
    const [w2] = await db.insert(s.laborWorkers).values({ projectId: 20, workerCategory: "temporary_daily", realName: "来源人", entryDate: new Date("2026-08-01Z") });
    const [old] = await db.insert(s.employeeProfiles).values({ userId: 7, laborWorkerId: w1.insertId, projectId: 10, employeeType: "management", employmentStatus: "left", joinedAt: new Date("2026-01-01Z"), leftAt: new Date("2026-07-31Z"), baseSalary: "9000", updatedAt: new Date("2030-01-01Z") });
    const [current] = await db.insert(s.employeeProfiles).values({ userId: 7, laborWorkerId: w2.insertId, projectId: 20, employeeType: "construction_worker", joinedAt: new Date("2026-08-01Z"), salaryBasis: "daily", baseSalary: "400" });
    const result = await db.transaction(tx => adoptLegacy(tx, { sourceType: "user", sourceId: 7, actorUserId: 1 }));
    expect(await person(result.id)).toMatchObject({ legacyProfileId: current.insertId, legacyWorkerId: w2.insertId, projectId: 20 });
    const history = await db.select().from(s.personnelSalaryHistory).where(eq(s.personnelSalaryHistory.personId, result.id));
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ effectiveFrom: today, baseSalary: "400.00" });
    expect(calculateEffectiveSalaryAccrual([{ attendanceDate: "2026-08-01", workHours: 8, overtimeHours: 0, status: "confirmed" }], history)).toMatchObject({ calculable: false, payableAmount: null });
    expect((await profile(old.insertId)).baseSalary).toBe("9000.00");
    expect(await db.select().from(s.personnelSourceLinks).where(eq(s.personnelSourceLinks.personId, result.id))).toHaveLength(5);
    const scopes = (await db.select().from(s.personnelChanges).where(eq(s.personnelChanges.personId, result.id)))[0].changes as any;
    expect(scopes.sourceScopes.after.profiles).toHaveLength(2);
  });
});
