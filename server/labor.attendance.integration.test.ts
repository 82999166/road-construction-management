import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, is } from "drizzle-orm";
import { MySqlTable, getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import * as s from "../drizzle/schema";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), getDb: async () => holder.db }));
import { laborRouter } from "./routers/labor";
import { personnelRouter } from "./routers/personnel";

const enabled = process.env.ATTENDANCE_REAL_DB_TEST === "1";
const suite = enabled ? describe : describe.skip;
let setup: mysql.Connection;
let pool: mysql.Pool;
let db: any;
let hook: null | (() => Promise<void>) = null;
let hookOperation: "update" | "insert" = "update";
const caller = (role: "admin" | "user" = "admin", id = role === "admin" ? 1 : 2) => laborRouter.createCaller({ user: { id, role, loginMethod: "test", name: "合成回归用户" }, req: { headers: {} }, res: {} } as any);
const input = (extra: Record<string, unknown> = {}) => ({ workerId: 3, projectId: 10, attendanceDate: "2026-08-16", workHours: 7.5, overtimeHours: 0.5, ...extra });
const rows = () => db.select().from(s.attendanceRecords);
const audits = () => db.select().from(s.auditLogs);

suite("考勤：隔离MariaDB真实caller及事务并发交错", () => {
  beforeAll(async () => {
    const url = new URL(process.env.ATTENDANCE_TEST_DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "33316" || url.pathname !== "/attendance_regression") throw new Error("仅允许127.0.0.1:33316/attendance_regression合成数据，禁止远端与其他数据库");
    setup = await mysql.createConnection(url.toString());
    const dialect = new MySqlDialect();
    for (const table of Object.values(s).filter(t => is(t, MySqlTable))) {
      const config = getTableConfig(table as MySqlTable);
      await setup.query(`DROP TABLE IF EXISTS \`${config.name}\``);
      const columns = config.columns.map(c => {
        let definition = `\`${c.name}\` ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}${(c as any).autoIncrement ? " AUTO_INCREMENT" : ""}${c.primary ? " PRIMARY KEY" : ""}`;
        if (c.default !== undefined) definition += " DEFAULT " + (typeof c.default === "boolean" ? Number(c.default) : typeof c.default === "number" ? c.default : typeof c.default === "string" ? mysql.escape(c.default) : `(${dialect.sqlToQuery(c.default as any).sql})`);
        return definition;
      });
      const unique = config.indexes.filter(i => i.config.unique).map(i => `UNIQUE KEY \`${i.config.name}\` (${i.config.columns.map(c => `\`${(c as any).name}\``).join(",")})`);
      await setup.query(`CREATE TABLE \`${config.name}\` (${[...columns, ...unique].join(",")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    pool = mysql.createPool({ uri: url.toString(), timezone: "+08:00", connectionLimit: 5 });
    db = drizzle(pool, { schema: s, mode: "default" });
    holder.db = new Proxy(db, { get(target, key) {
      if (key !== "transaction") { const value = target[key]; return typeof value === "function" ? value.bind(target) : value; }
      return (callback: any) => target.transaction((tx: any) => callback(new Proxy(tx, { get(t, k) {
        if (k === "update" || k === "insert") return (table: any) => {
          const builder = t[k](table);
          if (table !== s.attendanceRecords) return builder;
          const method = k === "update" ? "set" : "values";
          return new Proxy(builder, { get(b, m) {
            if (m !== method) return typeof b[m] === "function" ? b[m].bind(b) : b[m];
            return (values: any) => {
              const query = b[m](values);
              const runHook = async () => { if (hook && hookOperation === k) { const fn = hook; hook = null; await fn(); } };
              if (k === "insert") return { then: async (resolve: any, reject: any) => { try { await runHook(); return await Promise.resolve(query).then(resolve, reject); } catch (e) { return reject(e); } } };
              return new Proxy(query, { get(q, n) { if (n === "where") return async (condition: any) => { await runHook(); return await q.where(condition); }; return typeof q[n] === "function" ? q[n].bind(q) : q[n]; } });
            };
          } });
        };
        const value = t[k]; return typeof value === "function" ? value.bind(t) : value;
      } })));
    } });
    await db.insert(s.projects).values([{ id: 10, code: "ATT-OLD", name: "合成旧项目", nodeType: "project" }, { id: 11, code: "ATT-NEW", name: "合成新项目", nodeType: "project" }]);
    await db.insert(s.users).values([{ id: 1, openId: "att-super", role: "admin" }, { id: 2, openId: "att-manager", role: "user" }, { id: 9, openId: "att-denied", role: "user" }]);
    await db.insert(s.systemRoles).values({ id: 1, code: "LABOR_MANAGER", name: "合成劳资管理员" });
    await db.insert(s.userRoleAssignments).values({ userId: 2, roleId: 1, projectId: 10 });
    await db.insert(s.laborWorkers).values([{ id: 3, projectId: 10, realName: "同名合成人员", attendanceStatus: "left", entryDate: new Date("2026-08-01T00:00:00Z"), exitDate: new Date("2026-08-31T00:00:00Z") }, { id: 4, projectId: 11, realName: "同名合成人员", attendanceStatus: "active", entryDate: new Date("2026-09-01T00:00:00Z") }]);
  }, 30000);
  beforeEach(async () => { hook = null; hookOperation = "update"; await setup.query("DROP TRIGGER IF EXISTS attendance_audit_failure"); await setup.query("DELETE FROM attendance_records"); await setup.query("DELETE FROM audit_logs"); await setup.query("DELETE FROM payroll_statements"); });
  afterAll(async () => { await setup?.query("DROP TRIGGER IF EXISTS attendance_audit_failure"); await setup?.end(); await pool?.end(); });

  it("left历史闭区间补录及修改成功；边界之外与新阶段错日期拒绝，真实ID不漂移", async () => {
    const first = await caller().attendance.save(input({ attendanceDate: "2026-08-01" }));
    expect(first.id).toBeTypeOf("number");
    expect((await audits())[0].targetId).toBe(String(first.id));
    expect(await caller().attendance.save(input({ id: first.id, attendanceDate: "2026-08-01", workHours: 6 }))).toMatchObject({ id: first.id, success: true });
    await caller().attendance.save(input({ attendanceDate: "2026-08-31" }));
    for (const attendanceDate of ["2026-07-31", "2026-09-01"]) await expect(caller().attendance.save(input({ attendanceDate }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().attendance.save(input({ workerId: 4, projectId: 11 }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().attendance.save(input({ id: first.id, attendanceDate: "2026-08-02" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await rows()).toHaveLength(2);
  });
  it("原权限：授权普通管理员可新增，显式或隐式旧记录修改均拒绝，越项目与未登录拒绝", async () => {
    const created = await caller("user").attendance.save(input());
    await expect(caller("user").attendance.save(input({ workHours: 4 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").attendance.save(input({ id: created.id }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").attendance.save(input({ workerId: 4, projectId: 11, attendanceDate: "2026-09-01" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user", 9).attendance.save(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(laborRouter.createCaller({ user: null, req: { headers: {} }, res: {} } as any).attendance.save(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await rows())[0].workHours).toBe("7.50");
  });
  it("真实save读confirmed后先由真实payroll.submit锁定，CAS拒绝且无成功修改审计", async () => {
    const created = await caller().attendance.save(input({ workHours: 8, overtimeHours: 0 }));
    const [payroll] = await db.insert(s.payrollStatements).values({ workerId: 3, projectId: 10, period: "2026-08", payableAmount: "100", deductionAmount: "0", actualAmount: "100", status: "draft" });
    hook = async () => { await caller().payroll.submit({ id: Number(payroll.insertId) }); };
    await expect(caller().attendance.save(input({ id: created.id, workHours: 4 }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await rows())[0]).toMatchObject({ id: created.id, status: "locked", workHours: "8.00", overtimeHours: "0.00" });
    expect((await audits()).filter((a: any) => a.action === "update_attendance")).toHaveLength(0);
    await expect(caller().attendance.save(input())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller("user").attendance.save(input())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("真实数据库审计失败导致新增与修改整体回滚", async () => {
    const created = await caller().attendance.save(input());
    await setup.query("CREATE TRIGGER attendance_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'");
    await expect(caller().attendance.save(input({ id: created.id, workHours: 3 }))).rejects.toThrow();
    await expect(caller().attendance.save(input({ attendanceDate: "2026-08-17" }))).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].workHours).toBe("7.50");
    expect(await audits()).toHaveLength(1);
  });
  it("真实唯一键并发新增返回明确CONFLICT，保留胜者且无失败请求审计", async () => {
    hookOperation = "insert";
    hook = async () => { await db.insert(s.attendanceRecords).values({ workerId: 3, projectId: 10, attendanceDate: new Date("2026-08-16T00:00:00Z"), workHours: "9", status: "confirmed" }); };
    await expect(caller().attendance.save(input())).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("不能重复新增") });
    expect((await rows())[0].workHours).toBe("9.00");
    expect(await audits()).toHaveLength(0);
  });
  it("详情保留草稿、按中国月份与真实worker来源过滤，汇总仅confirmed/locked", async () => {
    await db.insert(s.personnelPeople).values({ id: 1, personNo: "ATT-P1", name: "同名合成人员", affiliation: "company", legacyWorkerId: 3, secondaryPositionIds: [], createdBy: 1, updatedBy: 1 });
    await db.insert(s.personnelSourceLinks).values({ personId: 1, sourceType: "worker", sourceId: 4, createdBy: 1 });
    await db.insert(s.attendanceRecords).values([
      { workerId: 3, projectId: 10, attendanceDate: new Date("2026-08-01T00:00:00Z"), workHours: "7.5", overtimeHours: "0.5", status: "confirmed" },
      { workerId: 4, projectId: 11, attendanceDate: new Date("2026-08-02T00:00:00Z"), workHours: "6.25", overtimeHours: "1.25", status: "locked" },
      { workerId: 3, projectId: 10, attendanceDate: new Date("2026-08-03T00:00:00Z"), workHours: "20", status: "draft" },
      { workerId: 3, projectId: 10, attendanceDate: new Date("2026-09-01T00:00:00Z"), workHours: "8", status: "confirmed" },
      { workerId: 99, projectId: 10, attendanceDate: new Date("2026-08-04T00:00:00Z"), workHours: "8", status: "confirmed" },
    ]);
    const ctx = { user: { id: 1, role: "admin", loginMethod: "test" }, req: { headers: {} }, res: {} } as any;
    const detail = await personnelRouter.createCaller(ctx).detail({ personId: 1, period: "2026-08" } as any);
    expect(detail.attendance).toMatchObject({ days: 2, workHours: 13.75, overtimeHours: 1.75, summaryBasis: "confirmed_and_locked" });
    expect(detail.attendance.rows).toHaveLength(3);
    expect(detail.attendance.rows.some(r => r.status === "draft")).toBe(true);
    await expect(personnelRouter.createCaller({ ...ctx, user: { id: 2, role: "user" } }).detail({ personId: 1, period: "2026-08" } as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await audits()).toHaveLength(0);
  });
});
