import { withNumberingFixture } from "./services/businessDocumentNumber.fixtureAdapter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { auditLogs } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import * as numbering from "./services/businessDocumentNumber";
import { isBusinessDocumentNumber } from "../shared/businessDocumentNumber";

const mocks = vi.hoisted(() => ({ db: vi.fn(), roles: vi.fn(), projectAccess: vi.fn(), notify: vi.fn(), messages: vi.fn() }));
vi.mock("./db", () => ({ getDb: async (...args: any[]) => withNumberingFixture(await mocks.db(...args)) }));
vi.mock("./access", async load => ({ ...await load<typeof import("./access")>(), assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: mocks.projectAccess, getEffectiveRoleCodes: mocks.roles }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mocks.notify }));
vi.mock("./routers/messages", () => ({ createInAppMessage: mocks.messages }));
vi.mock("./services/auditIntegrity", () => ({ appendIntegrityProtectedAudit: async (tx: any, data: unknown) => tx.insert(auditLogs).values(data), recordSensitiveDataAccess: vi.fn() }));
import { financeRouter } from "./routers/finance";
import { laborRouter } from "./routers/labor";
const numberSpy = vi.spyOn(numbering, "allocateBusinessDocumentNumber"); // Call-through: real allocator and SQLite metadata constraints execute.

const ctx = { user: { id: 23, openId: "correction-test", role: "user" }, req: {}, res: {} } as TrpcContext;
const record = { id: 71, projectId: 10, recordNo: "OLD-FIN-71", direction: "expense", category: "人工差旅", amount: "800.00", occurredAt: new Date("2026-11-01T08:00:00Z"), settlementStatus: "paid", sourceType: null, sourceId: null };
const payroll = { id: 9, workerId: 7, projectId: 10, period: "2026-11", status: "approved", actualAmount: "800.00", submittedBy: 2 };
function database(options: { record?: any; payroll?: any; payment?: any[]; closure?: any[]; reversals?: any[]; affectedRows?: number | null; failAudit?: boolean } = {}) {
  const tables: Record<string, any[]> = { projects: [{ id: 10 }], financial_records: [options.record ?? { ...record }, ...(options.reversals ?? [])], payroll_statements: [options.payroll ?? { ...payroll }], temporary_daily_wage_settlements: [options.payroll ?? { ...payroll, status: "reviewing", settlementDate: new Date("2026-11-01") }], settlement_payment_records: options.payment ?? [], daily_accounting_closures: options.closure ?? [], audit_logs: [] };
  const events: string[] = [];
  let queue = Promise.resolve();
  const db: any = {
    transaction: vi.fn(async (fn: any) => {
      const previous = queue; let unlock!: () => void;
      queue = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      const snapshot = structuredClone(tables);
      try { return await fn(db); } catch (e) { for (const key of Object.keys(tables)) tables[key] = snapshot[key]; throw e; } finally { unlock(); }
    }),
    select: vi.fn(() => ({ from: vi.fn((table: any) => {
      const name = getTableName(table); let condition: any; let locked = false;
      const builder: any = { where: vi.fn((c: any) => { condition = c; return builder; }), innerJoin: vi.fn(() => builder), limit: vi.fn(() => builder), for: vi.fn(() => { locked = true; events.push(`lock:${name}`); return builder; }), orderBy: vi.fn(() => builder), then: (resolve: any, reject: any) => {
        let rows = tables[name] ?? [];
        if (name === "financial_records") {
          // Locked id query locates manual original; reversal-chain query has only sourceType/sourceId.
          const chunks = JSON.stringify(condition, (key, value) => key === "table" ? undefined : typeof value === "bigint" ? String(value) : value);
          rows = chunks.includes("financial_reversal") ? rows.filter(row => row.sourceType === "financial_reversal") : (chunks.includes("payroll_statement") || chunks.includes("temporary_daily_wage")) ? rows.filter(row => ["payroll", "payroll_statement", "daily_wage", "temporary_daily_wage"].includes(row.sourceType)) : rows.filter(row => row.id === 71);
        }
        return Promise.resolve(rows).then(resolve, reject);
      } };
      return builder;
    }) })),
    insert: vi.fn((table: any) => ({ values: vi.fn(async (data: any) => {
      const name = getTableName(table); events.push(`insert:${name}`);
      if (name === "audit_logs" && options.failAudit) throw new Error("audit failed");
      const row = { id: 100 + tables[name].length, ...data }; tables[name].push(row); return [{ insertId: row.id, affectedRows: 1 }];
    }) })),
    update: vi.fn((table: any) => ({ set: vi.fn((data: any) => ({ where: vi.fn(async () => {
      const count = options.affectedRows === undefined ? 1 : options.affectedRows;
      if (count === 1) Object.assign(tables[getTableName(table)][0], data);
      return count === null ? undefined : [{ affectedRows: count }];
    }) })) })),
  };
  mocks.db.mockResolvedValue(db);
  return { db, tables, events };
}

beforeEach(() => { vi.clearAllMocks(); mocks.roles.mockResolvedValue(["FINANCE_MANAGER"]); mocks.projectAccess.mockResolvedValue(undefined); mocks.notify.mockResolvedValue([]); mocks.messages.mockResolvedValue({ created: true }); });

describe("财务人工纠错事务", () => {
  it("重复点击和并发重试只产生一条冲销链、一次审计及通知，原单保持不变", async () => {
    const { tables, events } = database();
    const input = { id: 71, projectId: 10, reason: "已核对退款资金事实", reversedAt: "2026-11-24T00:00:00.000Z" };
    const caller = financeRouter.createCaller(ctx);
    const result = await Promise.all([caller.reverseRecord(input), caller.reverseRecord(input)]);
    expect(result).toEqual([{ success: true, reversalDirection: "income" }, { success: true, reversalDirection: "income" }]);
    expect(tables.financial_records).toHaveLength(2);
    expect(tables.financial_records[0]).toMatchObject(record);
    expect(tables.financial_records[1]).toMatchObject({ amount: "800", direction: "income", sourceType: "financial_reversal", sourceId: "71" });
    expect(isBusinessDocumentNumber(tables.financial_records[1].recordNo)).toBe(true);
    expect(tables.financial_records[1].recordNo).toMatch(/^RV\d{14}0023\d{4}$/);
    expect(tables.audit_logs).toHaveLength(1); expect(mocks.notify).toHaveBeenCalledTimes(1); expect(numberSpy).toHaveBeenCalledTimes(1);
    expect(events.indexOf("lock:projects")).toBeLessThan(events.indexOf("lock:financial_records"));
  });
  it.each(["partial", "paid"])("%s 记录不可作废", async status => {
    const { tables } = database({ record: { ...record, settlementStatus: status } });
    await expect(financeRouter.createCaller(ctx).voidRecord({ id: 71, projectId: 10, reason: "不允许删改" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.audit_logs).toHaveLength(0); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it.each(["settlement_payment", "financial_reversal", "measurement_payment"])("来源 %s 不可直接冲销", async sourceType => {
    database({ record: { ...record, sourceType, sourceId: "1" } });
    await expect(financeRouter.createCaller(ctx).reverseRecord({ id: 71, projectId: 10, reason: "来源保护", reversedAt: "2026-11-24T00:00:00.000Z" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(numberSpy).not.toHaveBeenCalled();
  });
  it("等待项目锁后重核角色，已收回权限不入账", async () => {
    database(); mocks.roles.mockResolvedValueOnce(["FINANCE_MANAGER"]).mockResolvedValue(["CASHIER"]);
    await expect(financeRouter.createCaller(ctx).reverseRecord({ id: 71, projectId: 10, reason: "重新鉴权", reversedAt: "2026-11-24T00:00:00.000Z" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(numberSpy).not.toHaveBeenCalled();
  });
  it("锁内发现封账后拒绝冲销；审计失败同事务回滚", async () => {
    let state = database({ closure: [{ status: "closed", closingNo: "OLD-DAY" }] });
    const input = { id: 71, projectId: 10, reason: "开放日期保护", reversedAt: "2026-11-24T00:00:00.000Z" };
    await expect(financeRouter.createCaller(ctx).reverseRecord(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.tables.financial_records).toHaveLength(1); expect(numberSpy).not.toHaveBeenCalled();
    state = database({ failAudit: true });
    await expect(financeRouter.createCaller(ctx).reverseRecord(input)).rejects.toThrow();
    expect(state.tables.financial_records).toHaveLength(1); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it.each([0, null])("CAS 响应 %s 不能伪成功作废", async affectedRows => {
    const { tables } = database({ record: { ...record, settlementStatus: "unpaid" }, affectedRows });
    await expect(financeRouter.createCaller(ctx).voidRecord({ id: 71, projectId: 10, reason: "冲突保护" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.audit_logs).toHaveLength(0); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("人工录入禁止冒充来源业务；历史冲销额异常不得继续生成", async () => {
    mocks.roles.mockResolvedValue(["ALL"]); database();
    await expect(financeRouter.createCaller(ctx).saveRecord({ projectId: 10, direction: "expense", category: "工资资金", amount: 800, occurredAt: "2026-11-24T00:00:00.000Z", settlementStatus: "paid", sourceType: "settlement_payment", sourceId: "7" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(numberSpy).not.toHaveBeenCalled();
    database({ reversals: [{ ...record, id: 100, direction: "income", sourceType: "financial_reversal", sourceId: "71", amount: "799" }] });
    await expect(financeRouter.createCaller(ctx).reverseRecord({ id: 71, projectId: 10, reason: "历史余额核查", reversedAt: "2026-11-24T00:00:00.000Z" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(numberSpy).not.toHaveBeenCalled();
  });

});

describe("工资撤销资金与锁保护", () => {
  it("工资状态未回写但已存在 active 付款时不能作废", async () => {
    const { tables, events } = database({ payment: [{ id: 1, status: "active" }] });
    await expect(laborRouter.createCaller(ctx).payroll.void({ id: 9, reason: "核对工资" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.payroll_statements[0].status).toBe("approved"); expect(tables.audit_logs).toHaveLength(0);
    expect(events.indexOf("lock:projects")).toBeLessThan(events.indexOf("lock:payroll_statements"));
    expect(events.indexOf("lock:payroll_statements")).toBeLessThan(events.indexOf("lock:settlement_payment_records"));
  });
  it.each(["partial", "paid"])("%s 工资不作废", async status => {
    database({ payroll: { ...payroll, status } });
    await expect(laborRouter.createCaller(ctx).payroll.void({ id: 9, reason: "工资只读保护" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("工资审核退回若有有效付款必须拒绝", async () => {
    mocks.roles.mockResolvedValue(["ACCOUNTANT"]); database({ payroll: { ...payroll, status: "reviewing" }, payment: [{ id: 1 }] });
    await expect(laborRouter.createCaller(ctx).payroll.approve({ id: 9, decision: "returned", reason: "核对金额" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("工资作废审计失败回滚状态，不发送消息", async () => {
    const { tables } = database({ failAudit: true });
    await expect(laborRouter.createCaller(ctx).payroll.void({ id: 9, reason: "金额核对" })).rejects.toThrow();
    expect(tables.payroll_statements[0].status).toBe("approved"); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("日结退回已有有效付款时拒绝，零CAS不能伪成功", async () => {
    mocks.roles.mockResolvedValue(["ACCOUNTANT"]);
    database({ payroll: { ...payroll, status: "reviewing" }, payment: [{ id: 1 }] });
    await expect(laborRouter.createCaller(ctx).dailyWage.review({ id: 9, decision: "returned", reason: "核对日结" })).rejects.toMatchObject({ code: "CONFLICT" });
    const { tables } = database({ payroll: { ...payroll, status: "reviewing" }, affectedRows: 0 });
    await expect(laborRouter.createCaller(ctx).dailyWage.review({ id: 9, decision: "returned", reason: "核对日结" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tables.audit_logs).toHaveLength(0);
  });
  it("日结审核退回成功同事务写原因审计，原金额保留", async () => {
    mocks.roles.mockResolvedValue(["ACCOUNTANT"]);
    const { tables } = database({ payroll: { ...payroll, status: "reviewing" } });
    await expect(laborRouter.createCaller(ctx).dailyWage.review({ id: 9, decision: "returned", reason: "核对日结" })).resolves.toMatchObject({ status: "draft" });
    expect(tables.temporary_daily_wage_settlements[0]).toMatchObject({ actualAmount: "800.00", status: "draft" });
    expect(tables.audit_logs[0].summary).toContain("核对日结");
  });

});
