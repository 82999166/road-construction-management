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
    machine_cost_records: [], machine_monthly_statements: [], machine_payment_settlements: [], diesel_refuel_records: [], audit_logs: [], evidence_records: [{ id: 8, projectId: 3, sourceType: "other", status: "active", sourceId: "machine-cost-pending-13-1" }],
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
    let condition: SQL | undefined, limit: number | undefined, descending = false;
    const builder: any = { where: (value: SQL) => { condition = value; return builder; }, orderBy: (order: SQL) => { descending = Boolean(order && new MySqlDialect().sqlToQuery(order).sql.endsWith(" desc")); return builder; },
      limit: (value: number) => { limit = value; return builder; }, for: () => { this.locks.push(getTableName(table)); return builder; },
      then: (ok: any, fail: any) => Promise.resolve().then(() => {
        let rows = this.matches(table, condition); if (descending && getTableName(table) === "audit_logs") rows = [...rows].sort((a, b) => b.id - a.id); if (limit) rows = rows.slice(0, limit);
        return rows.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, col]: any) => [key, row[col.name]])) : structuredClone(row));
      }).then(ok, fail),
    }; return builder;
  } }; }
  insert(table: any) { return { values: (value: any) => {
    const execute = async () => {
    const name = getTableName(table); if (name === "audit_logs" && this.failAudit) throw Error("fixture audit failure");
    const rows = this.rows[name] ??= []; const id = Math.max(0, ...rows.map(row => row.id)) + 1;
    rows.push({ id, dieselRefuelRecordId: null, evidenceId: null, updatedAt: new Date(), createdAt: new Date(), ...structuredClone(value) }); return [{ insertId: id, affectedRows: 1 }];
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
const target = { id: 1, projectId: 3, machineId: 13 };
async function createDraft(overrides: any = {}) {
  await caller().saveCost({ ...base, ...overrides });
  const original = await caller().getCostForEdit(target);
  return { ...base, ...overrides, ...target, version: original.version, evidenceId: original.evidenceId };
}
describe("机械费用草稿修改真实caller（隔离SQL内存，无真实DB或通知）", () => {
  it("版本必需、金额系统算、身份固定、原时间毫秒照片默认保留", async () => {
    const input = await createDraft({ occurredAt: "2026-11-09T10:37:00.321Z", evidenceId: 8 });
    await expect(caller().updateCostDraft({ ...input, version: undefined } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller().updateCostDraft({ ...input, evidenceId: undefined, quantity: 2, unitPrice: 10 })).toMatchObject({ success: true, amount: 20 });
    expect(db.rows.machine_cost_records).toHaveLength(1);
    expect(db.rows.machine_cost_records[0]).toMatchObject({ amount: "20", evidenceId: 8, occurredAt: new Date("2026-11-09T10:37:00.321Z") });
    expect(db.rows.audit_logs.find(row => row.action === "edit_cost_draft").beforeJson).toContain('"evidenceId":8');
    await expect(caller().updateCostDraft({ ...input, machineId: 14 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().updateCostDraft({ ...input, projectId: 8 })).rejects.toThrow("未授权");
  });
  it("双请求同版本只有一次成功，旧版本和同输入旧创建回执不可重放", async () => {
    const requestId = "b428d876-dab1-455e-900c-393471b95a12"; const input = await createDraft({ requestId });
    const results = await Promise.allSettled([caller().updateCostDraft({ ...input, quantity: 2 }), caller().updateCostDraft({ ...input, quantity: 3 })]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    await expect(caller().saveCost({ ...base, requestId })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows.machine_cost_records).toHaveLength(1);
    await expect(caller().updateCostDraft(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["approved", "settled", "void"])("%s费用不能覆盖", async status => {
    const input = await createDraft(); db.rows.machine_cost_records[0].status = status;
    await expect(caller().updateCostDraft(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows.audit_logs.filter(row => row.action === "edit_cost_draft")).toHaveLength(0);
  });
  it("服务重核登记人、财务他人草稿、角色及锁等待期间收回权限", async () => {
    const input = await createDraft(); mocks.roles = ["FINANCE_MANAGER"];
    await expect(machineryRouter.createCaller({ ...ctx, user: { ...ctx.user, id: 10 } }).updateCostDraft(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.roles = ["DRIVER"]; await expect(caller().updateCostDraft(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.roles = ["MACHINERY_MANAGER"]; db.beforeTransaction = () => { mocks.denied = true; };
    await expect(caller().updateCostDraft(input)).rejects.toThrow("未授权");
  });
  it("输入变化排除self但仍保留同来源/同秒硬冲突", async () => {
    const input = await createDraft(); expect((await caller().checkCostEditDuplicate(input)).candidates).toHaveLength(0);
    seed({ id: 2, occurredAt: new Date(input.occurredAt) });
    expect(await caller().updateCostDraft(input)).toMatchObject({ success: false, duplicateCheck: { hardConflict: true } });
    db.rows.machine_cost_records[1].occurredAt = new Date("2026-11-10T00:00:00Z"); db.rows.machine_cost_records[1].evidenceId = 8;
    expect(await caller().updateCostDraft({ ...input, evidenceId: 8 })).toMatchObject({ success: false, duplicateCheck: { hardConflict: true } });
  });
  it("同日另笔需绑定编辑id版本输入的签名、理由", async () => {
    const input = await createDraft(); seed({ id: 2, occurredAt: new Date(later.occurredAt) }); const check = await caller().checkCostEditDuplicate(input);
    expect(check.hardConflict).toBe(false); expect(check.confirmationToken).toBeTruthy();
    expect(await caller().updateCostDraft({ ...input, quantity: 2, duplicateConfirmation: { token: check.confirmationToken!, reason: "不同真实维修单，供应商票号123" } })).toMatchObject({ success: false });
    expect(await caller().updateCostDraft({ ...input, duplicateConfirmation: { token: check.confirmationToken!, reason: "不同真实维修单，供应商票号123" } })).toMatchObject({ success: true });
    expect(db.rows.audit_logs.find(row => row.action === "edit_cost_draft").summary).toContain("供应商票号123");
  });
  it.each(["draft", "submitted", "approved", "settled", "payment-draft", "payment-paid"])("%s来源占用阻断费用草稿修改", async kind => {
    const input = await createDraft();
    if (kind.startsWith("payment")) db.rows.machine_payment_settlements.push({ id: 7, projectId: 3, machineId: 13, period: "2026-11", status: kind.slice(8) });
    else db.rows.machine_monthly_statements.push({ id: 7, projectId: 3, machineId: 13, period: "2026-11", status: kind });
    await expect(caller().updateCostDraft({ ...input, quantity: 2 })).rejects.toThrow("月结或付款");
  });
  it("编辑移入已审核月份也阻断，作废付款不占用", async () => {
    const input = await createDraft(); db.rows.machine_monthly_statements.push({ id: 7, projectId: 3, machineId: 13, period: "2026-12", status: "approved" });
    await expect(caller().updateCostDraft({ ...input, occurredAt: "2026-12-01T00:00:00Z" })).rejects.toThrow("月结或付款");
    db.rows.machine_monthly_statements = []; db.rows.machine_payment_settlements.push({ id: 7, projectId: 3, machineId: 13, period: "2026-11", status: "void" });
    expect(await caller().updateCostDraft({ ...input, quantity: 2 })).toMatchObject({ success: true });
  });
  it("燃油修改指导价重算原成本和唯一柴油镜像，同事务审计，燃油不能变维修", async () => {
    const input = await createDraft({ costType: "fuel", costName: "柴油", unitPrice: 99 });
    expect(await caller().updateCostDraft({ ...input, quantity: 10, unitPrice: 123 })).toMatchObject({ success: true, amount: 86.4, unitPrice: 8.64 });
    expect(db.rows.machine_cost_records[0].amount).toBe("86.4"); expect(db.rows.diesel_refuel_records[0]).toMatchObject({ amount: "86.4", liters: "10", appliedUnitPrice: "8.64", status: "draft", createdBy: 9 });
    expect(db.rows.diesel_refuel_records).toHaveLength(1); expect(db.rows.audit_logs.some(row => row.action === "edit_machine_fuel_draft")).toBe(true);
    const fresh = await caller().getCostForEdit(target); await expect(caller().updateCostDraft({ ...input, version: fresh.version, costType: "repair" })).rejects.toThrow("不能互改");
  });
  it("燃油不能绕5min其他柴油镜像，self镜像不冲突", async () => {
    const input = await createDraft({ costType: "fuel", costName: "柴油" });
    db.rows.diesel_refuel_records.push({ ...db.rows.diesel_refuel_records[0], id: 2, recordNo: "DS-SECOND", refueledAt: new Date("2026-11-09T10:39:00Z"), liters: "10" });
    await expect(caller().updateCostDraft({ ...input, quantity: 10 })).rejects.toThrow("5分钟"); expect(db.rows.machine_cost_records[0].quantity).toBe("23.15");
  });
  it("燃油作废沿用共同占用guard，已占用不能间接作废镜像", async () => {
    await createDraft({ costType: "fuel", costName: "柴油" }); db.rows.machine_payment_settlements.push({ id: 7, projectId: 3, machineId: 13, period: "2026-11", status: "draft" });
    await expect(caller().transitionCost({ id: 1, projectId: 3, nextStatus: "void" })).rejects.toThrow("月结或付款");
    expect(db.rows.machine_cost_records[0].status).toBe("draft"); expect(db.rows.diesel_refuel_records[0].status).toBe("draft");
  });
  it("旧新照片引用保留审计，不允许已删除证据", async () => {
    const input = await createDraft({ evidenceId: 8 }); db.rows.evidence_records.push({ id: 9, projectId: 3, status: "active", sourceType: "other", sourceId: "machine-cost-pending-13-2" });
    expect(await caller().updateCostDraft({ ...input, evidenceId: 9 })).toMatchObject({ success: true }); expect(db.rows.evidence_records[0].sourceId).toBe("machine-cost-1");
    const edit = db.rows.audit_logs.find(row => row.action === "edit_cost_draft"); expect(edit.beforeJson).toContain('"evidenceId":8'); expect(edit.afterJson).toContain('"evidenceId":9');
    const fresh = await caller().getCostForEdit(target); db.rows.evidence_records[0].status = "deleted";
    await expect(caller().updateCostDraft({ ...input, version: fresh.version, evidenceId: 8 })).rejects.toThrow("附件");
  });
  it("柴油审计失败成本镜像共同回滚，零更新同样失败", async () => {
    const input = await createDraft({ costType: "fuel", costName: "柴油" }); const before = structuredClone(db.rows); db.failAudit = true;
    await expect(caller().updateCostDraft({ ...input, quantity: 10 })).rejects.toThrow("audit failure"); expect(db.rows).toEqual(before);
    db.failAudit = false; const originalUpdate = db.update.bind(db); db.update = (table: any) => getTableName(table) === "machine_cost_records" ? { set: () => ({ where: async () => [{ affectedRows: 0 }] }) } : originalUpdate(table);
    await expect(caller().updateCostDraft({ ...input, quantity: 10 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(before);
  });
  it("同秒ABA改回原值仍由最新追加审计推进版本，旧版本不能覆盖", async () => {
    const input = await createDraft(); expect(await caller().updateCostDraft({ ...input, quantity: 2 })).toMatchObject({ success: true });
    const second = await caller().getCostForEdit(target); expect(await caller().updateCostDraft({ ...input, version: second.version })).toMatchObject({ success: true });
    const third = await caller().getCostForEdit(target); expect(third.version).not.toBe(input.version); expect(third.version).not.toBe(second.version);
    await expect(caller().updateCostDraft(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("草稿编辑锁序项目→证据→机械→成本，创建锁内检测已删除照片", async () => {
    const input = await createDraft({ evidenceId: 8 }); db.locks = []; await caller().updateCostDraft({ ...input, quantity: 2 });
    expect(db.locks.indexOf("projects")).toBeLessThan(db.locks.indexOf("evidence_records")); expect(db.locks.indexOf("evidence_records")).toBeLessThan(db.locks.indexOf("machines"));
    expect(db.locks.indexOf("machines")).toBeLessThan(db.locks.indexOf("machine_cost_records"));
    db.rows.evidence_records[0].status = "deleted"; await expect(caller().saveCost({ ...later, costName: "新费用", evidenceId: 8 })).rejects.toThrow("已删除");
    expect(db.rows.machine_cost_records).toHaveLength(1);
  });
  it("新月结共同项目机械锁重算来源，生成草稿后立即阻断费用编辑", async () => {
    const input = await createDraft(); db.rows.machine_lease_rules = [{ id: 3, machineId: 13, projectId: 3, billingType: "monthly", rate: "30000", overtimeHourlyRate: "100", status: "active", effectiveFrom: new Date("2026-11-01T00:00:00Z"), effectiveTo: null }];
    db.rows.asset_maintenance_records = []; db.rows.machines[0].ownership = "owned"; db.locks = [];
    expect(await caller().saveMonthlyStatement({ machineId: 13, projectId: 3, period: "2026-11", machineWorkDays: 30, machineOvertimeHours: 0, driverMonthlyWage: 0, driverWorkDays: 0, driverOvertimeHours: 0 })).toMatchObject({ success: true });
    expect(db.locks[0]).toBe("projects"); expect(db.locks[1]).toBe("machines"); expect(db.rows.machine_monthly_statements[0].repairAmount).toBe("200.02");
    await expect(caller().updateCostDraft({ ...input, quantity: 2 })).rejects.toThrow("月结或付款");
  });
  it("机械补证不能借用柴油专用凭证，燃油双账不同照片不能覆盖", async () => {
    const input = await createDraft({ costType: "fuel", costName: "柴油" });
    db.rows.evidence_records.push({ id: 9, projectId: 3, status: "active", sourceType: "diesel_receipt", sourceId: null });
    await expect(caller().updateCostDraft({ ...input, evidenceId: 9 })).rejects.toThrow("不能借用柴油专用");
    db.rows.diesel_refuel_records[0].evidenceId = 9;
    await expect(caller().updateCostDraft({ ...input, quantity: 2 })).rejects.toThrow("照片引用不同");
    expect(db.rows.machine_cost_records[0].quantity).toBe("23.15"); expect(db.rows.diesel_refuel_records[0].evidenceId).toBe(9);
  });
});
