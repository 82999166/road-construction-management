import { withNumberingFixture } from "./services/businessDocumentNumber.fixtureAdapter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mocks = vi.hoisted(() => ({ db: null as any, roles: ["MACHINERY_MANAGER"], denied: false,
  department: vi.fn(), notify: vi.fn(), sms: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => withNumberingFixture(mocks.db) }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "fixture-only-confirm-secret" } }));
vi.mock("./access", async original => ({ ...(await original<any>()),
  assertDepartmentBusinessAccess: mocks.department,
  assertProjectInCurrentScope: async (_ctx: unknown, id: number) => { if (mocks.denied || id !== 3) throw new Error("未授权项目"); },
  getEffectiveRoleCodes: async () => mocks.roles,
  hasUserSpecificOperationPermission: async () => false,
}));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mocks.notify }));
vi.mock("./services/smsNotifier", () => ({ notifyAliyunSmsSafely: mocks.sms, formatChinaSmsTime: () => "fixture" }));
import { machineryRouter } from "./routers/operations";
const normalize = (value: any) => value instanceof Date ? value.toISOString().slice(0, 23).replace("T", " ")
  : typeof value === "boolean" ? Number(value) : value ?? null;
class FixtureDb {
  rows: Record<string, any[]> = {
    machines: [{ id: 13, projectId: 3, name: "合成洒水车", code: "M04", ownerUserId: null }],
    projects: [{ id: 3, status: "active" }],
    machine_cost_records: [], diesel_refuel_records: [], audit_logs: [], evidence_records: [{ id: 8, projectId: 3, sourceType: "other", status: "active", sourceId: "machine-cost-pending-13-1", mimeType: "image/jpeg" }],
    diesel_guideline_prices: [{ id: 5, projectId: 3, status: "active", pricePerLiter: "8.64", effectiveFrom: new Date("2026-11-01T00:00:00Z"), effectiveTo: null }],
  };
  gate = Promise.resolve(); locks: string[] = []; beforeTransaction?: () => void; failAudit = false;
  private matches(table: any, condition?: SQL) {
    const name = getTableName(table), rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const query = new MySqlDialect().sqlToQuery(condition);
    const sqlite = new DatabaseSync(":memory:");
    const columns = [...new Set([...Object.values(getTableColumns(table)).map((c: any) => c.name), ...rows.flatMap(row => Object.keys(row))])];
    sqlite.exec(`CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`);
    const insert = sqlite.prepare(`INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`);
    rows.forEach((row, i) => insert.run(i, ...columns.map(col => normalize(row[col]))));
    const indices = sqlite.prepare(`SELECT __index FROM \`${name}\` WHERE ${query.sql}`).all(...query.params.map(normalize)).map((row: any) => row.__index);
    sqlite.close(); return indices.map(i => rows[i]);
  }
  select(projection?: any) { return { from: (table: any) => {
    let condition: SQL | undefined, limit: number | undefined;
    const builder: any = { where: (value: SQL) => { condition = value; return builder; }, orderBy: () => builder,
      limit: (value: number) => { limit = value; return builder; }, for: () => { this.locks.push(getTableName(table)); return builder; },
      then: (ok: any, fail: any) => Promise.resolve().then(() => {
        let rows = this.matches(table, condition); if (limit) rows = rows.slice(0, limit);
        return rows.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, col]: any) => [key, row[col.name]])) : structuredClone(row));
      }).then(ok, fail),
    }; return builder;
  } }; }
  insert(table: any) { return { values: (value: any) => {
    const execute = async () => {
    const name = getTableName(table); if (name === "audit_logs" && this.failAudit) throw Error("fixture audit failure");
    const rows = this.rows[name] ??= []; const id = Math.max(0, ...rows.map(row => row.id)) + 1;
    rows.push({ id, createdAt: new Date(), ...structuredClone(value) }); return [{ insertId: id, affectedRows: 1 }];
    }; let result: any; const once = async () => result ??= await execute();
    return { $returningId: async () => (await once()).map((r: any) => ({ id: r.insertId })), then: (ok: any, fail: any) => once().then(ok, fail) };
  } }; }
  update(table: any) { return { set: (value: any) => ({ where: async (condition: SQL) => {
    const rows = this.matches(table, condition); rows.forEach(row => Object.assign(row, value)); return [{ affectedRows: rows.length }];
  } }) }; }
  async transaction(fn: any) {
    const previous = this.gate; let release!: () => void; this.gate = new Promise(resolve => { release = resolve; });
    await previous; this.beforeTransaction?.(); const before = structuredClone(this.rows);
    try { return await fn(this); } catch (error) { this.rows = before; throw error; } finally { release(); }
  }
}
const ctx: any = { user: { id: 9, role: "user", openId: "fixture", name: "测试", loginMethod: "manus" }, req: { headers: {} }, res: {} };
const base = { machineId: 13, projectId: 3, costType: "repair" as const, costName: "发动机维修", quantity: 23.15, unitPrice: 8.64, occurredAt: "2026-11-09T10:37:00.000Z" };
const later = { ...base, occurredAt: "2026-11-09T12:00:00.000Z" };
const caller = () => machineryRouter.createCaller(ctx);
let db: FixtureDb;
function seed(overrides: any = {}) { const row = { id: (db.rows.machine_cost_records.length + 1), ...base, quantity: "23.150", unitPrice: "8.64", amount: "200.02", occurredAt: new Date(base.occurredAt), status: "approved", evidenceId: null, remarks: null, ...overrides }; db.rows.machine_cost_records.push(row); return row; }
beforeEach(() => { vi.clearAllMocks(); db = new FixtureDb(); mocks.db = db; mocks.roles = ["MACHINERY_MANAGER"]; mocks.denied = false;
  mocks.department.mockResolvedValue(undefined); mocks.notify.mockResolvedValue([]); mocks.sms.mockResolvedValue({ sent: false }); });
afterEach(() => vi.useRealTimers());
describe("机械费用防重真实 caller（SQL内存fixture，无业务DB/通知）", () => {
  it("普通成功金额两位，由服务端核算；同日不同名称或金额可正常录入", async () => {
    expect(await caller().saveCost(base)).toMatchObject({ success: true, amount: 200.02 });
    expect(await caller().saveCost({ ...base, costName: "轮胎维修" })).toMatchObject({ success: true });
    expect(await caller().saveCost({ ...base, unitPrice: 9 })).toMatchObject({ success: true });
    expect(db.rows.machine_cost_records).toHaveLength(3); expect(db.locks[0]).toBe("projects"); expect(db.locks).toContain("machines"); expect(db.locks.indexOf("projects")).toBeLessThan(db.locks.indexOf("machines"));
  });
  it("预检返回真实编号日期状态，取消/无确认提交均不新增", async () => {
    seed(); const check = await caller().checkCostDuplicate(later);
    expect(check.candidates[0]).toMatchObject({ id: 1, amount: "200.02", quantity: "23.150", status: "approved", occurredAt: new Date(base.occurredAt) });
    expect(check.confirmationToken).toBeTruthy(); expect(await caller().saveCost(later)).toMatchObject({ success: false });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("真实另笔需签名凭据和理由，可录入且审计依据；客户端boolean不能绕过", async () => {
    seed(); const input = { ...later, requestId: "97b7b21f-3b62-4256-9e33-3f939ea7d187" }; const check = await caller().checkCostDuplicate(input);
    expect(await caller().saveCost({ ...input, force: true } as any)).toMatchObject({ success: false });
    expect(await caller().saveCost({ ...input, duplicateConfirmation: { token: check.confirmationToken!, reason: "第二次独立维修，有新的供应商票号123" } })).toMatchObject({ success: true });
    expect(db.rows.machine_cost_records).toHaveLength(2);
    expect(db.rows.audit_logs.find(row => row.action === "confirm_distinct_cost")?.summary).toContain("供应商票号123");
  });
  it.each(["new", "status", "amount", "input", "expired", "tamper"])("确认后的%s变化必须重新核验", async kind => {
    const row = seed(); const check = await caller().checkCostDuplicate(later); let input = later;
    if (kind === "new") seed({ id: 2, occurredAt: new Date("2026-11-09T11:00:00Z") });
    if (kind === "status") row.status = "settled";
    if (kind === "amount") row.amount = "200.01";
    if (kind === "input") input = { ...later, remarks: "修改后的业务依据" } as any;
    if (kind === "expired") { vi.useFakeTimers(); vi.setSystemTime(check.expiresAt! + 1); }
    const token = kind === "tamper" ? `${check.confirmationToken}x` : check.confirmationToken!;
    expect(await caller().saveCost({ ...input, duplicateConfirmation: { token, reason: "第二次独立维修，票号不同请核对" } })).toMatchObject({ success: false });
    expect(db.rows.machine_cost_records).toHaveLength(kind === "new" ? 2 : 1);
  });
  it("跨项目不泄漏，角色/撤销权限/登录状态在预检和保存重新拒绝", async () => {
    seed({ projectId: 8 }); expect((await caller().checkCostDuplicate(later)).candidates).toEqual([]);
    await expect(caller().checkCostDuplicate({ ...base, projectId: 8 })).rejects.toThrow("未授权");
    mocks.roles = ["DRIVER"]; await expect(caller().checkCostDuplicate(base)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.roles = ["MACHINERY_MANAGER"]; await caller().checkCostDuplicate(base); mocks.denied = true;
    await expect(caller().saveCost(base)).rejects.toThrow("未授权");
    mocks.denied = false; db.beforeTransaction = () => { mocks.denied = true; };
    await expect(caller().saveCost(base)).rejects.toThrow("未授权");
    await expect(machineryRouter.createCaller({ ...ctx, user: null }).saveCost(base)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("NULL兼容，作废忽略，数量和单价按两位比较", async () => {
    seed({ costName: null, quantity: null, unitPrice: null, status: null });
    expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(1);
    db.rows.machine_cost_records = []; seed({ status: "void" }); expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(0);
    db.rows.machine_cost_records = []; seed({ quantity: "23.154" }); expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(1);
  });
  it("北京时间16:00Z边界按同一自然日，而非UTC日期", async () => {
    seed({ occurredAt: new Date("2026-11-08T16:00:00Z") });
    expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(1);
    db.rows.machine_cost_records[0].occurredAt = new Date("2026-11-08T15:59:59Z");
    expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(0);
  });
  it("同瞬时与同照片来源硬阻断，签名也不能确认重录", async () => {
    seed({ evidenceId: 8 }); expect((await caller().checkCostDuplicate(base)).hardConflict).toBe(true);
    const changed = { ...later, costName: "另一个名称", quantity: 1, occurredAt: "2026-11-10T12:00:00Z", evidenceId: 8 };
    expect(await caller().saveCost(changed)).toMatchObject({ success: false, duplicateCheck: { hardConflict: true } });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("同请求并发与网络重试持久回执仅入一笔，换输入/换用户不能借用回执", async () => {
    const input = { ...base, requestId: "b428d876-dab1-455e-900c-393471b95a12" };
    const results = await Promise.all([caller().saveCost(input), caller().saveCost(input)]);
    expect(results.map(r => r.success)).toEqual([true, true]); expect(results[1]).toMatchObject({ duplicate: true });
    expect(db.rows.machine_cost_records).toHaveLength(1); expect(mocks.sms).toHaveBeenCalledTimes(1);
    expect(await caller().saveCost(input)).toMatchObject({ duplicate: true });
    await expect(caller().saveCost({ ...input, quantity: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(machineryRouter.createCaller({ ...ctx, user: { ...ctx.user, id: 10 } }).saveCost(input)).rejects.toMatchObject({ code: "CONFLICT" });
    db.rows.machine_cost_records[0].status = "void"; await expect(caller().saveCost(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("同秒不同毫秒双方归一化仍硬阻断，不能拿确认令牌重录", async () => {
    seed({ occurredAt: new Date("2026-11-09T10:37:00.321Z") });
    const input = { ...base, occurredAt: "2026-11-09T10:37:00.987Z" };
    expect(await caller().checkCostDuplicate(input)).toMatchObject({ hardConflict: true, confirmationToken: null });
    expect(await caller().saveCost(input)).toMatchObject({ success: false, duplicateCheck: { hardConflict: true } });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("确认签名绑定actor与payload，理由短/超长均拒绝", async () => {
    seed(); const check = await caller().checkCostDuplicate(later);
    const input = { ...later, duplicateConfirmation: { token: check.confirmationToken!, reason: "第二次独立维修，供应商票据编号不同" } };
    expect(await machineryRouter.createCaller({ ...ctx, user: { ...ctx.user, id: 10 } }).saveCost(input)).toMatchObject({ success: false });
    await expect(caller().saveCost({ ...input, duplicateConfirmation: { ...input.duplicateConfirmation, reason: "不足十字" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().saveCost({ ...input, duplicateConfirmation: { ...input.duplicateConfirmation, reason: "字".repeat(301) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("无请求ID的并发和确认令牌并发也不能重复入账", async () => {
    const plain = await Promise.all([caller().saveCost(base), caller().saveCost(base)]);
    expect(plain.filter(r => r.success)).toHaveLength(1); expect(db.rows.machine_cost_records).toHaveLength(1);
    const check = await caller().checkCostDuplicate(later);
    const input = { ...later, duplicateConfirmation: { token: check.confirmationToken!, reason: "第二次独立维修，新的维修票号" } };
    const confirmed = await Promise.all([caller().saveCost(input), caller().saveCost(input)]);
    expect(confirmed.filter(r => r.success)).toHaveLength(1); expect(db.rows.machine_cost_records).toHaveLength(2);
  });
  it("审计失败事务回滚费用，重试不被错误回执阻塞", async () => {
    db.failAudit = true; const input = { ...base, requestId: "b428d876-dab1-455e-900c-393471b95a12" };
    await expect(caller().saveCost(input)).rejects.toThrow("audit failure"); expect(db.rows.machine_cost_records).toHaveLength(0);
    db.failAudit = false; expect(await caller().saveCost(input)).toMatchObject({ success: true });
  });
  it("油料统一关联一笔柴油；同日疑似确认不能绕过柴油5分钟防重", async () => {
    const fuel = { ...base, costType: "fuel" as const, costName: "柴油" };
    expect(await caller().saveCost(fuel)).toMatchObject({ success: true, dieselRefuelRecordId: 1, amount: 200.02 });
    expect(db.rows.diesel_refuel_records).toHaveLength(1); expect(db.rows.machine_cost_records[0].dieselRefuelRecordId).toBe(1);
    const nearby = { ...fuel, occurredAt: "2026-11-09T10:39:00Z" }; const check = await caller().checkCostDuplicate(nearby);
    await expect(caller().saveCost({ ...nearby, duplicateConfirmation: { token: check.confirmationToken!, reason: "误以为另笔柴油，仍不可绕过来源" } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("截图式五行五个真实ID列表完整且汇总只计各ID一次，无JOIN投影倍增", async () => {
    for (let id = 1; id <= 5; id++) seed({ id });
    db.rows.machines.push({ ...db.rows.machines[0], name: "模拟重复标签投影" });
    const list = await caller().listCosts({ projectId: 3, machineId: 13, period: "2026-11" });
    const summary = await caller().printSummary({ projectId: 3, period: "2026-11" });
    expect(list.map(row => row.id)).toEqual([1, 2, 3, 4, 5]); expect(new Set(summary.records.map(row => row.id)).size).toBe(5);
    expect(summary.summary.recordCount).toBe(5); expect(summary.summary.amount).toBeCloseTo(1000.1, 2);
    expect((await caller().checkCostDuplicate(later)).candidates).toHaveLength(5);
  });
});
