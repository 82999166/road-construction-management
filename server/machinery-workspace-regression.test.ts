import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { MySqlDialect } from "drizzle-orm/mysql-core";
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi.fn(async () => []),
}));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: vi.fn(async () => undefined),
  assertProjectInCurrentScope: vi.fn(async () => undefined),
  getEffectiveRoleCodes: vi.fn(async () => ["MACHINERY_MANAGER"]),
  hasUserSpecificOperationPermission: vi.fn(async () => false),
  getRoleOperationPermissionDecision: vi.fn(async () => ({
    allowed: true,
    hasDetailedPermissions: true,
  })),
}));
import { getDb } from "./db";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  getRoleOperationPermissionDecision,
  hasUserSpecificOperationPermission,
} from "./access";
import { machineryRouter } from "./routers/operations";

const ctx = () =>
  ({
    user: {
      id: 1,
      openId: "machinery-test",
      role: "user",
      name: "回归",
      loginMethod: "manus",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {},
    res: {},
  }) as TrpcContext;
function mockDb(responses: unknown[][] = [], affectedRows = 1) {
  let index = 0;
  const writes = vi.fn(async () => ({ affectedRows }));
  const updateValues = vi.fn();
  const predicates: any[] = [];
  const limits: number[] = [];
  const select = vi.fn(() => {
    const rows = responses[index++] ?? [];
    const chain: any = {
      from: () => chain,
      where: (predicate: any) => {
        predicates.push(predicate);
        return chain;
      },
      orderBy: () => chain,
      limit: (value: number) => {
        limits.push(value);
        return chain;
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  });
  return {
    select,
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateValues(values);
        return { where: writes };
      },
    })),
    insert: vi.fn(() => ({ values: writes })),
    writes,
    updateValues,
    predicates,
    limits,
  };
}
const sqlQuery = (predicate: any) => new MySqlDialect().sqlToQuery(predicate);
const zeroInput = {
  projectId: 10,
  machineId: 7,
  occurredOn: "2026-11-04",
  shiftCount: 0,
  shiftRate: 0,
  workHours: 0,
  overtimeHours: 2,
  overtimeHourlyRate: 50,
  outputAmount: 0,
  driverWageAmount: 0,
};

describe("机械工作区真实tRPC caller行为（mock DB，无真实写入）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue(
      undefined as never
    );
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(hasUserSpecificOperationPermission).mockResolvedValue(false);
    vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({
      allowed: true,
      hasDetailedPermissions: true,
    });
  });
  it("原状态链提交、审核、结算、作废可达且按部门动作与岗位双重鉴权", async () => {
    for (const [status, nextStatus, role, action] of [
      ["draft", "submitted", "MACHINERY_MANAGER", "submit"],
      ["submitted", "approved", "FINANCE_MANAGER", "review"],
      ["approved", "settled", "FINANCE_MANAGER", "settle"],
      ["draft", "void", "MACHINERY_MANAGER", "void"],
    ] as const) {
      const db = mockDb([[{ id: 90, machineId: 7, projectId: 10, status }]]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(getEffectiveRoleCodes).mockResolvedValue([role]);
      await expect(
        machineryRouter
          .createCaller(ctx())
          .transitionDailyOperation({ id: 90, projectId: 10, nextStatus })
      ).resolves.toEqual({ success: true });
      expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
        expect.anything(),
        "MACHINERY",
        action
      );
      expect(db.update).toHaveBeenCalledTimes(1);
    }
  });
  it("只读与非财务岗不可审核结算，终态和跨项目不可变更", async () => {
    for (const [status, nextStatus, role, project, code] of [
      ["submitted", "approved", "MACHINERY_MANAGER", 10, "FORBIDDEN"],
      ["approved", "settled", "MACHINERY_MANAGER", 10, "FORBIDDEN"],
      ["settled", "void", "FINANCE_MANAGER", 10, "BAD_REQUEST"],
      ["void", "submitted", "MACHINERY_MANAGER", 10, "BAD_REQUEST"],
      ["draft", "submitted", "MACHINERY_MANAGER", 99, "NOT_FOUND"],
    ] as const) {
      const db = mockDb([
        [{ id: 90, machineId: 7, projectId: project, status }],
      ]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(getEffectiveRoleCodes).mockResolvedValue([role]);
      await expect(
        machineryRouter
          .createCaller(ctx())
          .transitionDailyOperation({ id: 90, projectId: 10, nextStatus })
      ).rejects.toMatchObject({ code });
      expect(db.update).not.toHaveBeenCalled();
    }
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["VIEWER"]);
    vi.mocked(hasUserSpecificOperationPermission).mockResolvedValue(true);
    const db = mockDb([[{ id: 90, projectId: 10, status: "draft" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      machineryRouter.createCaller(ctx()).transitionDailyOperation({
        id: 90,
        projectId: 10,
        nextStatus: "submitted",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("细粒度read-only权限服务端拒绝写操作，并在查数据库前收口项目", async () => {
    const db = mockDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
      async (_ctx, _module, action) => {
        if (action && action !== "read")
          throw new TRPCError({ code: "FORBIDDEN" });
        return undefined as never;
      }
    );
    await expect(
      machineryRouter.createCaller(ctx()).saveDailyOperation(zeroInput)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
    vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue(
      undefined as never
    );
    vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      machineryRouter
        .createCaller(ctx())
        .listDailyOperations({ projectId: 99, period: "2026-11" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
  });
  it("新登记只保存司机加班，拒绝台班/产值/重复工资且不覆盖同日历史金额", async () => {
    const db = mockDb([
      [
        {
          id: 7,
          projectId: 10,
          name: "挖机",
          operatorUserId: null,
          driverName: "司机",
        },
      ],
      [],
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      machineryRouter.createCaller(ctx()).saveDailyOperation(zeroInput)
    ).resolves.toEqual({ success: true });
    expect(db.writes).toHaveBeenCalledWith(
      expect.objectContaining({
        overtimeAmount: "100",
        shiftCount: "0",
        shiftAmount: "0",
        driverWageAmount: "0",
      })
    );
    const invalid = mockDb();
    vi.mocked(getDb).mockResolvedValue(invalid as never);
    await expect(
      machineryRouter
        .createCaller(ctx())
        .saveDailyOperation({ ...zeroInput, shiftCount: 1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(invalid.insert).not.toHaveBeenCalled();
    const historic = mockDb([
      [{ id: 7, projectId: 10 }],
      [
        {
          id: 9,
          projectId: 10,
          machineId: 7,
          status: "draft",
          shiftCount: "1",
          shiftRate: "100",
          outputAmount: "100",
          driverWageAmount: "0",
        },
      ],
    ]);
    vi.mocked(getDb).mockResolvedValue(historic as never);
    await expect(
      machineryRouter.createCaller(ctx()).saveDailyOperation(zeroInput)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(historic.update).not.toHaveBeenCalled();
  });
  it("加班返回安全全量业务字段、项目月范围与China日期，不暴露账户或凭证存储", async () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      id: index + 1,
      projectId: 10,
      machineId: 7,
      occurredOn: new Date("2026-11-03T16:00:00Z"),
      overtimeHours: "2",
      overtimeHourlyRate: "50",
      overtimeAmount: "100",
      driverNameSnapshot: "司机",
      status: "draft",
      remarks: null,
      shiftCount: "0",
      payeeAccount: "secret",
      signedUrl: "secret",
    }));
    const db = mockDb([rows, [{ id: 7, name: "挖机", code: "M7" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await machineryRouter
      .createCaller(ctx())
      .listDailyOperations({ projectId: 10, period: "2026-11" });
    expect(result).toHaveLength(125);
    expect(result[0]).toMatchObject({
      date: "2026-11-04",
      machineName: "挖机",
      overtimeAmount: 100,
    });
    expect(result[0]).not.toHaveProperty("payeeAccount");
    expect(result[0]).not.toHaveProperty("signedUrl");
    expect(assertProjectInCurrentScope).toHaveBeenCalledWith(
      expect.anything(),
      10
    );
  });
  it("同日多笔柴油先排除历史fuel再累加，跨UTC日期落入同China业务日", async () => {
    const db = mockDb([
      [{ id: 7, projectId: 10, name: "挖机", code: "M7" }],
      [],
      [],
      [
        {
          occurredAt: new Date("2026-11-03T17:00:00Z"),
          costType: "fuel",
          amount: "800",
          quantity: "100",
        },
      ],
      [],
      [
        {
          refueledAt: new Date("2026-11-03T18:00:00Z"),
          amount: "100",
          liters: "10",
        },
        {
          refueledAt: new Date("2026-11-04T02:00:00Z"),
          amount: "200",
          liters: "20",
        },
      ],
      [],
      [],
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await machineryRouter
      .createCaller(ctx())
      .getMachineAnalysis({ projectId: 10, machineId: 7, period: "2026-11" });
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]).toMatchObject({
      date: "2026-11-04",
      fuelLiters: 30,
      fuelAmount: 300,
    });
  });
  it("付款只读金额来源于原实际付款记录，已付旧单不能误报余额", async () => {
    const db = mockDb([
      [
        {
          id: 8,
          projectId: 10,
          monthlyStatementId: 9,
          status: "partial",
          netPayableAmount: "1000",
        },
        {
          id: 10,
          projectId: 10,
          monthlyStatementId: 11,
          status: "paid",
          netPayableAmount: "500",
        },
      ],
      [],
      [],
      [
        { settlementId: 8, amount: "200" },
        { settlementId: 8, amount: "100" },
      ],
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await machineryRouter
      .createCaller(ctx())
      .listPaymentSettlements({ projectId: 10 });
    expect(result[0]).toMatchObject({
      actualPaidAmount: 300,
      remainingAmount: 700,
      legacyFinalized: false,
    });
    expect(result[1]).toMatchObject({
      actualPaidAmount: null,
      remainingAmount: null,
      legacyFinalized: true,
      legacyPaymentUnconfirmed: true,
    });
  });

  it.each([
    "shiftCount",
    "shiftRate",
    "workHours",
    "outputAmount",
    "driverWageAmount",
  ] as const)(
    "新加班拒绝旧字段%s非零，不能恢复台班/工时/产值/双算工资",
    async field => {
      const db = mockDb();
      vi.mocked(getDb).mockResolvedValue(db as never);
      await expect(
        machineryRouter
          .createCaller(ctx())
          .saveDailyOperation({ ...zeroInput, [field]: 1 })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.select).not.toHaveBeenCalled();
      expect(db.writes).not.toHaveBeenCalled();
    }
  );
  it.each(["submitted", "approved", "settled", "void"] as const)(
    "%s已有记录不能由新保存覆盖",
    async status => {
      const db = mockDb([
        [{ id: 7, projectId: 10 }],
        [{ id: 9, machineId: 7, projectId: 10, status }],
      ]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      await expect(
        machineryRouter.createCaller(ctx()).saveDailyOperation(zeroInput)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.writes).not.toHaveBeenCalled();
    }
  );
  it("同日草稿更新必须额外有edit授权；仅create不能偷覆盖，拒绝时保留原记录", async () => {
    const historic = {
      id: 9,
      machineId: 7,
      projectId: 10,
      status: "draft",
      shiftCount: "0",
      shiftRate: "0",
      outputAmount: "0",
      driverWageAmount: "0",
    };
    const db = mockDb([[{ id: 7, projectId: 10 }], [historic]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
      async (_ctx, _module, action) => {
        if (action === "edit") throw new TRPCError({ code: "FORBIDDEN" });
        return undefined as never;
      }
    );
    await expect(
      machineryRouter.createCaller(ctx()).saveDailyOperation(zeroInput)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "MACHINERY",
      "create"
    );
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "MACHINERY",
      "edit"
    );
    expect(db.writes).not.toHaveBeenCalled();
  });
  it("已有纯加班草稿按id合法更新，保留零历史计价并写审计，不建立工资流水", async () => {
    const db = mockDb([
      [{ id: 7, projectId: 10, name: "挖机", driverName: "档案司机" }],
      [
        {
          id: 9,
          machineId: 7,
          projectId: 10,
          status: "draft",
          shiftCount: "0",
          shiftRate: "0",
          outputAmount: "0",
          driverWageAmount: "0",
        },
      ],
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      machineryRouter
        .createCaller(ctx())
        .saveDailyOperation({ ...zeroInput, id: 9, overtimeHours: 3 })
    ).resolves.toEqual({ success: true });
    expect(db.updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        overtimeAmount: "150",
        driverNameSnapshot: "档案司机",
        workHours: "0",
        shiftRate: "0",
        outputAmount: "0",
      })
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.writes).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "update_daily_operation" })
    );
  });
  it("状态条件更新冲突不留下成功审计或通知", async () => {
    const db = mockDb(
      [[{ id: 90, machineId: 7, projectId: 10, status: "draft" }]],
      0
    );
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      machineryRouter.createCaller(ctx()).transitionDailyOperation({
        id: 90,
        projectId: 10,
        nextStatus: "submitted",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.insert).not.toHaveBeenCalled();
  });
  it.each(["submitted", "approved", "settled", "void"] as const)(
    "详细权限read-only即使财务岗位也拒绝%s状态动作且不查DB",
    async nextStatus => {
      const db = mockDb();
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
      vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
        async (_ctx, _module, action) => {
          if (action) throw new TRPCError({ code: "FORBIDDEN" });
          return undefined as never;
        }
      );
      await expect(
        machineryRouter
          .createCaller(ctx())
          .transitionDailyOperation({ id: 90, projectId: 10, nextStatus })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.select).not.toHaveBeenCalled();
    }
  );
  it("付款查询实际SQL限定授权项目、机械expense、active状态与筛后单号；paid有流水也不能状态强制抹余额", async () => {
    const db = mockDb([
      [
        {
          id: 8,
          machineId: 7,
          projectId: 10,
          monthlyStatementId: 9,
          status: "paid",
          netPayableAmount: "1000",
        },
        {
          id: 12,
          machineId: 8,
          projectId: 10,
          monthlyStatementId: 12,
          status: "partial",
          netPayableAmount: "2000",
        },
      ],
      [],
      [],
      [
        { settlementId: 8, amount: "200.10" },
        { settlementId: 8, amount: "99.90" },
      ],
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await machineryRouter
      .createCaller(ctx())
      .listPaymentSettlements({ projectId: 10, machineId: 7, status: "paid" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actualPaidAmount: 300,
      remainingAmount: 700,
      legacyFinalized: false,
    });
    const predicate = sqlQuery(db.predicates.at(-1));
    expect(predicate.params).toEqual([10, "machine", "expense", "active", 8]);
    expect(predicate.sql).toContain(
      "`settlement_payment_records`.`settlementId`"
    );
    expect(db.limits).toEqual([]);
  });
  it("付款跨项目拒绝先于DB读取，不授权绝不返回账户；空集不查询资金流水", async () => {
    let db = mockDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      machineryRouter
        .createCaller(ctx())
        .listPaymentSettlements({ projectId: 99 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    db = mockDb([[], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      machineryRouter
        .createCaller(ctx())
        .listPaymentSettlements({ projectId: 10 })
    ).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
  it("业务DATE月份SQL采用月初左闭右开日期边界，单机加班列表无100条上限", async () => {
    const db = mockDb([[], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await machineryRouter
      .createCaller(ctx())
      .listDailyOperations({ projectId: 10, period: "2026-11" });
    const predicate = sqlQuery(db.predicates[0]);
    expect(predicate.params[0]).toBe(10);
    expect(
      predicate.params
        .slice(1)
        .map(value =>
          (value instanceof Date ? value.toISOString() : String(value)).slice(
            0,
            10
          )
        )
    ).toEqual(["2026-11-01", "2026-12-01"]);
    expect(predicate.sql).toContain(" >= ");
    expect(predicate.sql).toContain(" < ");
    expect(db.limits).toEqual([]);
  });
});
