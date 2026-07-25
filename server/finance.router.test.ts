import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 防止路由回归测试对外投递真实消息，同时验证每个业务模块传递正确的深链。 */
const { mockNotifyWecomBusinessEvent } = vi.hoisted(() => ({
  mockNotifyWecomBusinessEvent: vi.fn(),
}));

/** 路由测试隔离数据库与范围授权基础设施，只验证采购、计量和财务的业务安全边界。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/businessNotifier", () => ({ notifyWecomBusinessEvent: mockNotifyWecomBusinessEvent }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertProjectInCurrentScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertProjectInCurrentScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { financeRouter, measurementRouter, purchasingRouter } from "./routers/finance";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 构造最小登录上下文，避免测试绑定真实 OAuth 会话或数据库用户记录。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "finance-test-user",
    email: "finance-test@example.com",
    name: "财务测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 构造满足 Drizzle 链式读取接口的轻量 mock。 */
function createSelectDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => rows),
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  };
}

/** 为需要按查询顺序返回不同结果的状态机测试构造轻量数据库桩。 */
function createSelectDbSequence(...responses: unknown[][]) {
  let queryIndex = 0;
  return {
    select: vi.fn(() => {
      const rows = responses[queryIndex++] ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => rows),
            limit: vi.fn(async () => rows),
          })),
        })),
      };
    }),
  };
}

describe("采购、工程计量与财务 tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    mockNotifyWecomBusinessEvent.mockResolvedValue({ delivered: true });
  });

  it("已关闭采购申请不可回退，且状态操作始终保留项目范围校验", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 31, projectId: 10, status: "closed" }]) as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).transitionRequest({ id: 31, projectId: 10, targetStatus: "draft" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("仓储岗位不能越权批准采购申请", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["WAREHOUSE_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 32, projectId: 10, status: "submitted" }]) as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).transitionRequest({ id: 32, projectId: 10, targetStatus: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("采购订单只能由已批准申请创建，创建后申请状态同步为已下单", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    const requestStatusUpdate = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      ...createSelectDb([{ id: 33, projectId: 10, status: "approved", amount: "5000.00" }]),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({ set: requestStatusUpdate })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).createOrder({ requestId: 33, projectId: 10, supplierId: null, amount: 5000, orderedAt: "2026-07-25T08:00:00.000Z" })).resolves.toEqual({ success: true });
    expect(requestStatusUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "ordered" }));

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 34, projectId: 10, requestId: 33, status: "closed" }]) as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).transitionOrder({ id: 34, projectId: 10, targetStatus: "confirmed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("采购分类、跨项目申请与订单金额上限均由服务端拦截", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).saveRequest({ projectId: 10, categoryId: 12, amount: 99, description: "水泥采购" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "请选择有效的固定采购类别" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 35, projectId: 99, status: "approved", amount: "100.00" }]) as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).createOrder({ requestId: 35, projectId: 10, supplierId: null, amount: 100, orderedAt: "2026-07-25T08:00:00.000Z" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 36, projectId: 10, status: "approved", amount: "100.00" }]) as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).createOrder({ requestId: 36, projectId: 10, supplierId: null, amount: 100.01, orderedAt: "2026-07-25T08:00:00.000Z" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "采购订单金额不得高于申请批准金额" });
  });

  it("库存余额和库存成本仅按服务端不可变收发流水汇总", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["WAREHOUSE_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([
      { itemName: "水泥", unit: "袋", transactionType: "inbound", quantity: "10", amount: "500.00" },
      { itemName: "水泥", unit: "袋", transactionType: "outbound", quantity: "3", amount: "150.00" },
      { itemName: "水泥", unit: "袋", transactionType: "return", quantity: "1", amount: "50.00" },
    ]) as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).listInventory({ projectId: 10 })).resolves.toMatchObject({ balances: [{ itemName: "水泥", unit: "袋", balanceQuantity: 8, totalAmount: 400 }] });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("库存入库流水由服务端计算金额，并只允许库存岗位写入", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["WAREHOUSE_MANAGER"]);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDb([{ id: 37, projectId: 10, status: "received" }]),
      insert: vi.fn(() => ({ values })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).saveInventoryTransaction({ projectId: 10, requestId: 37, purchaseOrderId: null, transactionType: "inbound", itemName: "水泥", unit: "袋", quantity: 2.5, unitCost: 12.34, occurredAt: "2026-07-25T08:00:00.000Z", remarks: null })).resolves.toEqual({ success: true, amount: 30.85 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ transactionType: "inbound", amount: "30.85", requestId: 37 }));
  });

  it("采购结算只允许已收货订单分次付款，并由服务端拒绝超额结算", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDbSequence(
        [{ id: 38, projectId: 10, status: "received", amount: "1000.00" }],
        [{ amount: "300.00", settlementStatus: "partial" }],
      ),
      insert: vi.fn(() => ({ values })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(purchasingRouter.createCaller(createAuthContext()).recordSettlement({ orderId: 38, projectId: 10, amount: 500, settledAt: "2026-07-25T08:00:00.000Z", remarks: "首笔付款" })).resolves.toEqual({ success: true, settledAmount: 800, remainingAmount: 200 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ category: "采购结算", sourceType: "purchase_order_settlement", sourceId: "38", amount: "500" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ module: "purchasing", eventCode: "purchase_order_settlement", targetId: "38", deepLink: "/mobile/purchasing" }));

    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 39, projectId: 10, status: "received", amount: "1000.00" }],
        [{ amount: "950.00", settlementStatus: "partial" }],
      ),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    } as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).recordSettlement({ orderId: 39, projectId: 10, amount: 100, settledAt: "2026-07-25T08:00:00.000Z", remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "本次结算超过采购订单待结算余额" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 40, projectId: 10, status: "confirmed", amount: "1000.00" }]) as never);
    await expect(purchasingRouter.createCaller(createAuthContext()).recordSettlement({ orderId: 40, projectId: 10, amount: 100, settledAt: "2026-07-25T08:00:00.000Z", remarks: null })).rejects.toMatchObject({ code: "CONFLICT", message: "采购订单须已收货后才能登记结算" });
  });

  it("工程计量核定必须提交核定金额，禁止将空金额写入已审核状态", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 41, projectId: 10, status: "reviewing", declaredAmount: "1000.00", approvedAmount: null }]) as never);

    await expect(measurementRouter.createCaller(createAuthContext()).transitionClaim({ id: 41, projectId: 10, targetStatus: "approved", approvedAmount: null, reviewNote: "" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "核定通过时必须填写核定金额" });
  });

  it("工程计量已确认后不可回退，且非会计岗位不得执行结算确认", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 42, projectId: 10, status: "settled", declaredAmount: "1000.00", approvedAmount: "900.00" }]) as never);
    await expect(measurementRouter.createCaller(createAuthContext()).transitionClaim({ id: 42, projectId: 10, targetStatus: "reviewing", approvedAmount: null, reviewNote: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 43, projectId: 10, status: "approved", declaredAmount: "1000.00", approvedAmount: "900.00" }]) as never);
    await expect(measurementRouter.createCaller(createAuthContext()).transitionClaim({ id: 43, projectId: 10, targetStatus: "settled", approvedAmount: null, reviewNote: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("工程计量仅可在收入确认前由复核岗位作废，且作废会留下审计和通知深链", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    const updateWhere = vi.fn(async () => undefined);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDb([{ id: 44, projectId: 10, status: "approved", declaredAmount: "1000.00", approvedAmount: "900.00" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      insert: vi.fn(() => ({ values })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(measurementRouter.createCaller(createAuthContext()).transitionClaim({ id: 44, projectId: 10, targetStatus: "void", approvedAmount: null, reviewNote: "业主计量口径变更，取消本次申报" })).resolves.toEqual({ success: true });
    expect(updateWhere).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ module: "measurement", action: "transition_claim", targetId: "44" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ module: "measurement", eventCode: "measurement_void", targetId: "44", deepLink: "/mobile/measurement" }));

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 45, projectId: 10, status: "settled", declaredAmount: "1000.00", approvedAmount: "900.00" }]) as never);
    await expect(measurementRouter.createCaller(createAuthContext()).transitionClaim({ id: 45, projectId: 10, targetStatus: "void", approvedAmount: null, reviewNote: "不得冲销已确认收入" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("工程回款只能登记在已确认收入的计量申报上，且不得超过剩余可回款金额", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDbSequence(
        [{ id: 51, projectId: 10, status: "settled", declaredAmount: "1000.00", approvedAmount: "1000.00" }],
        [{ amount: "400.00", settlementStatus: "partial" }],
        [{ id: 701 }],
      ),
      insert: vi.fn(() => ({ values })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(measurementRouter.createCaller(createAuthContext()).recordPayment({ claimId: 51, projectId: 10, amount: 300, receivedAt: "2026-07-25T08:00:00.000Z", remarks: "第一笔回款" })).resolves.toEqual({ success: true, receivedAmount: 700, remainingAmount: 300 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ category: "工程计量回款", sourceType: "measurement_payment", sourceId: "51", settlementStatus: "partial" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ module: "measurement", eventCode: "measurement_payment", targetId: "51", deepLink: "/mobile/measurement" }));

    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [{ id: 52, projectId: 10, status: "settled", declaredAmount: "1000.00", approvedAmount: "1000.00" }],
      [{ amount: "950.00", settlementStatus: "partial" }],
    ) as never);
    await expect(measurementRouter.createCaller(createAuthContext()).recordPayment({ claimId: 52, projectId: 10, amount: 100, receivedAt: "2026-07-25T08:00:00.000Z", remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "本次回款超过可回款余额" });
  });

  it("工程回款拒绝未结算申报与零金额输入", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 53, projectId: 10, status: "approved", declaredAmount: "1000.00", approvedAmount: "1000.00" }]) as never);
    await expect(measurementRouter.createCaller(createAuthContext()).recordPayment({ claimId: 53, projectId: 10, amount: 10, receivedAt: "2026-07-25T08:00:00.000Z", remarks: null })).rejects.toMatchObject({ code: "CONFLICT", message: "仅已确认收入的工程计量可以登记回款" });
    await expect(measurementRouter.createCaller(createAuthContext()).recordPayment({ claimId: 53, projectId: 10, amount: 0, receivedAt: "2026-07-25T08:00:00.000Z", remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("财务流水由服务端审计并投递固定的财务深链", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    const values = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({ insert: vi.fn(() => ({ values })) } as never);

    await expect(financeRouter.createCaller(createAuthContext()).saveRecord({
      projectId: 10,
      direction: "expense",
      category: "项目材料费用",
      amount: 123.45,
      occurredAt: "2026-07-25T08:00:00.000Z",
      settlementStatus: "unpaid",
      sourceType: null,
      sourceId: null,
      evidenceId: null,
      remarks: null,
    })).resolves.toEqual({ success: true });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ module: "finance", action: "create_record", targetId: "项目材料费用" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ module: "finance", eventCode: "financial_expense", targetId: "项目材料费用", deepLink: "/mobile/finance" }));
  });

  it("人工财务流水仅可在支付前作废，并由会计或财务负责人对已支付流水创建反方向冲销记录", async () => {
    const manualPaidRecord = { id: 71, recordNo: "FIN-20260725-AAAA", projectId: 10, direction: "expense", category: "临时材料款", amount: "800.00", settlementStatus: "paid", sourceType: null };
    const insertValues = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      ...createSelectDbSequence([manualPaidRecord], []),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);

    await expect(financeRouter.createCaller(createAuthContext()).reverseRecord({ id: 71, projectId: 10, reversedAt: "2026-07-25T08:00:00.000Z", reason: "供应商退款已核实" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    await expect(financeRouter.createCaller(createAuthContext()).reverseRecord({ id: 71, projectId: 10, reversedAt: "2026-07-25T08:00:00.000Z", reason: "供应商退款已核实" })).resolves.toEqual({ success: true, reversalDirection: "income" });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ direction: "income", amount: "800", settlementStatus: "paid", sourceType: "financial_reversal", sourceId: "71" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "financial_reversed", deepLink: "/mobile/finance" }));

    const unpaidRecord = { ...manualPaidRecord, id: 72, recordNo: "FIN-20260725-BBBB", settlementStatus: "unpaid" };
    const voidDb = {
      ...createSelectDb([unpaidRecord]),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({ set: updateSet })),
    };
    vi.mocked(getDb).mockResolvedValue(voidDb as never);
    await expect(financeRouter.createCaller(createAuthContext()).voidRecord({ id: 72, projectId: 10, reason: "重复录入" })).resolves.toEqual({ success: true, status: "void" });
    expect(updateSet).toHaveBeenCalledWith({ settlementStatus: "void" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ ...manualPaidRecord, sourceType: "measurement_payment" }]) as never);
    await expect(financeRouter.createCaller(createAuthContext()).reverseRecord({ id: 71, projectId: 10, reversedAt: "2026-07-25T08:00:00.000Z", reason: "不应跨模块调整" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("财务月报仅汇总指定项目期间的有效收支，并分别计算未收未付", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([
      { id: 1, direction: "income", amount: "1000.00", settlementStatus: "unpaid" },
      { id: 2, direction: "income", amount: "500.50", settlementStatus: "paid" },
      { id: 3, direction: "expense", amount: "320.25", settlementStatus: "partial" },
      { id: 4, direction: "expense", amount: "99.99", settlementStatus: "void" },
    ]) as never);

    const result = await financeRouter.createCaller(createAuthContext()).summary({ projectId: 10, period: "2026-07" });
    expect(result).toMatchObject({ incomeAmount: 1500.5, expenseAmount: 320.25, profitAmount: 1180.25, receivableAmount: 1000, payableAmount: 320.25 });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("财务月报将计量收入确认与实际回款分开统计，并以回款余额计算应收", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([
      { id: 11, direction: "income", amount: "1000.00", settlementStatus: "partial", sourceType: "measurement_claim", sourceId: "61" },
      { id: 12, direction: "income", amount: "400.00", settlementStatus: "partial", sourceType: "measurement_payment", sourceId: "61" },
      { id: 13, direction: "expense", amount: "100.00", settlementStatus: "paid", sourceType: null, sourceId: null },
    ]) as never);

    const result = await financeRouter.createCaller(createAuthContext()).summary({ projectId: 10, period: "2026-07" });
    expect(result).toMatchObject({ incomeAmount: 1000, expenseAmount: 100, profitAmount: 900, receivableAmount: 600, cashInflowAmount: 400, cashOutflowAmount: 100, netCashFlowAmount: 300 });
  });
});
