import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "./_core/context";

/** 业务节点通知在路由中异步投递；测试仅校验公众号调用契约，不发起真实外部请求。 */
const { mockNotifyOfficialAccountBusinessEventSafely } = vi.hoisted(() => ({
  mockNotifyOfficialAccountBusinessEventSafely: vi.fn(),
}));

/** 路由测试隔离数据库和数据范围基础设施，只验证机械、运输的业务权限与状态边界。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mockNotifyOfficialAccountBusinessEventSafely }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertDepartmentBusinessAccess: vi.fn(),
    assertProjectInCurrentScope: vi.fn(),
    getCurrentDataScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
    getSuperAdminAccess: vi.fn(),
    hasUserSpecificOperationPermission: vi.fn(),
  };
});

import { assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, getSuperAdminAccess, hasUserSpecificOperationPermission } from "./access";
import { getDb } from "./db";
import { machineryRouter, transportRouter } from "./routers/operations";
import { encryptSecret } from "./services/secretVault";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 创建不依赖真实 OAuth 会话的最小登录上下文。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "operations-test-user",
    email: "operations-test@example.com",
    name: "机械运输测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 构造基础查询链，供只读机械、车辆与状态记录测试复用。 */
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

function createProjectOptionsDb(rows: unknown[]) {
  return { select: vi.fn(() => ({ from: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })) })) };
}

/** 支持运输保存流程按车辆、影像与运价规则的读取顺序返回不同数据。 */
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
            then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
          })),
        })),
      };
    }),
  };
}

describe("机械与运输 tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "operations-router-rfid-test-secret";
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    vi.mocked(getCurrentDataScope).mockResolvedValue({ userId: 1, hasAllProjects: false, projectIds: [], organizationIds: [] });
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ canAccess: false, reason: "not_super_admin" });
    vi.mocked(hasUserSpecificOperationPermission).mockResolvedValue(false);
    mockNotifyOfficialAccountBusinessEventSafely.mockResolvedValue([{ delivered: true, reason: "sent" }]);
  });

  it("机械台账列表在读取前强制校验调用方的项目数据范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(machineryRouter.createCaller(createAuthContext()).listMachines({ projectId: 10 })).resolves.toEqual([]);
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("机械成本汇总仅返回当前项目内未作废的真实成本，并在读取前校验项目范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([
      { machineId: 7, amount: "1200.50", costType: "repair", status: "approved", occurredAt: new Date("2026-08-16T00:00:00.000Z") },
      { machineId: 7, amount: "300", costType: "fuel", status: "draft", occurredAt: new Date("2026-08-15T00:00:00.000Z") },
      { machineId: 8, amount: "999", costType: "repair", status: "void", occurredAt: new Date("2026-08-14T00:00:00.000Z") },
    ]) as never);

    await expect(machineryRouter.createCaller(createAuthContext()).listCostSummaries({ projectId: 10 })).resolves.toEqual([
      expect.objectContaining({ machineId: 7, totalAmount: 1500.5, repairAmount: 1200.5, recordCount: 2 }),
    ]);
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("会计机械月度明细只读取当前项目与期间的审计快照，并在读取前校验项目范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([
      { id: 91, projectId: 10, machineId: 7, period: "2026-08", status: "draft", totalOutput: "6800", driverTotalWage: "2400", machineShareAmount: "1800" },
    ]) as never);

    await expect(machineryRouter.createCaller(createAuthContext()).listMonthlyStatements({ projectId: 10, period: "2026-08" })).resolves.toEqual([
      expect.objectContaining({ id: 91, projectId: 10, machineId: 7, period: "2026-08", status: "draft" }),
    ]);
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("单机分析仅汇总当前项目的日作业、维修和柴油凭证，并以柴油台账优先避免油料重复计入", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [{ id: 7, projectId: 10, name: "挖掘机", code: "EX-007", model: "375" }],
      [{ id: 81, machineId: 7, projectId: 10, period: "2026-08", totalOutput: "10000", driverTotalWage: "2500", repairAmount: "600", fuelAmount: "800", fuelLiters: "100", status: "draft" }],
      [{ id: 91, machineId: 7, projectId: 10, occurredOn: new Date("2026-08-16T00:00:00.000Z"), workHours: "10", overtimeHours: "2", outputAmount: "1200", driverWageAmount: "300", status: "draft", remarks: null }],
      [{ id: 101, machineId: 7, projectId: 10, occurredAt: new Date("2026-08-16T03:00:00.000Z"), costType: "fuel", quantity: "80", amount: "620", status: "approved" }],
      [{ id: 102, assetId: 7, projectId: 10, assetType: "machine", occurredAt: new Date("2026-08-16T04:00:00.000Z"), costCategory: "repair", amount: "200", status: "approved" }],
      [{ id: 103, machineId: 7, projectId: 10, assetType: "machine", refueledAt: new Date("2026-08-16T05:00:00.000Z"), liters: "90", amount: "720", status: "approved" }],
    ) as never);

    const result = await machineryRouter.createCaller(createAuthContext()).getMachineAnalysis({ machineId: 7, projectId: 10, period: "2026-08" });

    expect(result.machine).toMatchObject({ id: 7, code: "EX-007" });
    expect(result.monthly[0]).toMatchObject({ totalOutput: 10000, netIncome: 6100 });
    expect(result.daily[0]).toMatchObject({ outputAmount: 1200, driverWageAmount: 300, repairAmount: 200, fuelLiters: 90, fuelAmount: 720, netIncome: -20 });
  });

  it("已结算机械日作业不可回退，且状态流转仍校验项目范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 93, projectId: 10, machineId: 7, status: "settled" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    } as never);

    await expect(machineryRouter.createCaller(createAuthContext()).transitionDailyOperation({ id: 93, projectId: 10, nextStatus: "void" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("用户专属运输查看权限可在已有项目范围内读取项目选项，不再受旧岗位白名单误拦截", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(hasUserSpecificOperationPermission).mockResolvedValueOnce(true);
    vi.mocked(getCurrentDataScope).mockResolvedValueOnce({ userId: 1, hasAllProjects: false, projectIds: [88], organizationIds: [] });
    vi.mocked(getDb).mockResolvedValue(createProjectOptionsDb([{ id: 88, code: "TR-88", name: "运输授权项目", status: "active", organizationId: null }]) as never);

    await expect(transportRouter.createCaller(createAuthContext()).projectOptions()).resolves.toEqual([{ id: 88, code: "TR-88", name: "运输授权项目", status: "active", organizationId: null }]);
    expect(vi.mocked(hasUserSpecificOperationPermission)).toHaveBeenCalledWith(expect.anything(), "TRANSPORT", "read");
  });

  it("拒绝外租机械遗漏出租方、租金或租赁起止时间，防止产生无法结算的台账", async () => {
    await expect(machineryRouter.createCaller(createAuthContext()).saveMachine({
      projectId: 10,
      operatorUserId: null,
      code: "EXC-001",
      name: "挖掘机",
      model: null,
      ownership: "leased",
      supplierName: null,
      plateOrAssetNo: null,
      status: "idle",
      leaseTerms: null,
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("外租机械") });
  });

  it("纯司机岗位仅能读取分配给本人的车辆台账", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["DRIVER"]);
    const db = createSelectDb([
      { id: 11, projectId: 10, driverUserId: 1, plateNo: "粤A12345", boxLengthMeters: "6", boxWidthMeters: "2.3", boxHeightMeters: "1.2", loadFactor: "0.9" },
      { id: 12, projectId: 10, driverUserId: 2, plateNo: "粤B67890", boxLengthMeters: "6", boxWidthMeters: "2.3", boxHeightMeters: "1.2", loadFactor: "0.9" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await transportRouter.createCaller(createAuthContext()).listVehicles({ projectId: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 11, driverUserId: 1, theoreticalVolumeCubicMeters: 14.904 });
  });

  it("运输管理角色可为车辆卡绑定预填驾驶员电话，但车辆查询绝不返回电话加密密文", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{
      id: 11,
      projectId: 10,
      driverUserId: 1,
      plateNo: "粤A12345",
      driverName: "王师傅",
      driverPhoneEncrypted: encryptSecret("13800138000"),
      driverPhoneMasked: "138****8000",
      boxLengthMeters: "6",
      boxWidthMeters: "2.3",
      boxHeightMeters: "1.2",
      loadFactor: "0.9",
    }]) as never);

    const result = await transportRouter.createCaller(createAuthContext()).listVehicles({ projectId: 10 });
    expect(result[0]).toMatchObject({ plateNo: "粤A12345", driverName: "王师傅", driverPhone: "13800138000" });
    expect(result[0]).not.toHaveProperty("driverPhoneEncrypted");
  });

  it("单车分析只汇总当前项目的运输、柴油和维修记录，并按柴油金额计算占运输收入比例", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [{ id: 11, projectId: 10, plateNo: "粤A12345", vehicleType: "dump_truck", ownership: "owned", ownerName: null, status: "active", driverUserId: 1 }],
      [
        { id: 71, vehicleId: 11, projectId: 10, tripNo: "TR-001", startAt: new Date("2026-08-16T08:00:00.000Z"), actualDistanceKm: "35", calculatedAmount: "1000", netSettlementAmount: "880", status: "settled" },
        { id: 72, vehicleId: 11, projectId: 10, tripNo: "TR-VOID", startAt: new Date("2026-08-16T09:00:00.000Z"), actualDistanceKm: "20", calculatedAmount: "500", netSettlementAmount: "500", status: "void" },
      ],
      [{ id: 81, vehicleId: 11, projectId: 10, assetType: "vehicle", refueledAt: new Date("2026-08-16T10:00:00.000Z"), liters: "20", amount: "160", status: "approved" }],
      [
        { id: 91, assetId: 11, projectId: 10, assetType: "vehicle", occurredAt: new Date("2026-08-16T11:00:00.000Z"), costCategory: "repair", amount: "100", status: "approved" },
        { id: 92, assetId: 11, projectId: 10, assetType: "vehicle", occurredAt: new Date("2026-08-16T12:00:00.000Z"), costCategory: "maintenance", amount: "40", status: "approved" },
      ],
      [],
    ) as never);

    const result = await transportRouter.createCaller(createAuthContext()).getVehicleAnalysis({ vehicleId: 11, projectId: 10, period: "2026-08" });

    expect(result.vehicle).toMatchObject({ id: 11, plateNo: "粤A12345" });
    expect(result.summary).toMatchObject({ tripCount: 1, grossIncome: 1000, settlementIncome: 880, fuelLiters: 20, fuelAmount: 160, repairAmount: 100, maintenanceAmount: 40, fuelCostRatio: 16, netIncome: 700 });
    expect(result.daily[0]).toMatchObject({ date: "2026-08-16", tripCount: 1, fuelAmount: 160, netIncome: 700 });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("运输趟次将 GPS 与影像关联固化为快照，并由服务端返回缺失证据预警", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDbSequence(
        [{ id: 11, projectId: 10, status: "active", boxLengthMeters: "6", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" }],
        [{ id: 12, projectId: 10, status: "active", effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), effectiveTo: null, settlementUnit: "cubic_meter", startDistanceKm: "0", basePricePerUnit: "10", stepMeters: 500, stepIncreasePerUnit: "0" }],
      ),
      insert: vi.fn(() => ({ values })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await transportRouter.createCaller(createAuthContext()).saveTrip({ tripNo: "TR-TEST-01", vehicleId: 11, projectId: 10, freightRuleId: 12, startAt: "2026-07-25T08:00:00.000Z", endAt: null, actualDistanceKm: 0.1, volumeCubicMeters: 2, weightTons: null, evidenceId: null, startLatitude: 30.2, startLongitude: 120.1, endLatitude: null, endLongitude: null });

    expect(result.anomalies.map(item => item.code)).toEqual(expect.arrayContaining(["MISSING_EVIDENCE", "MISSING_GPS", "MISSING_END_TIME", "ABNORMAL_DISTANCE"]));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: null, routeSnapshot: expect.objectContaining({ startLatitude: 30.2, startLongitude: 120.1, endLatitude: null, endLongitude: null }) }));
  });

  it("未提供趟次编号时由服务端生成以日期时间秒为主体的项目内审计编号", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const values = vi.fn(async () => undefined);
    const db = {
      ...createSelectDbSequence(
        [{ id: 11, projectId: 10, status: "active", boxLengthMeters: "6", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" }],
        [{ id: 12, projectId: 10, status: "active", effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), effectiveTo: null, settlementUnit: "cubic_meter", startDistanceKm: "0", basePricePerUnit: "10", stepMeters: 500, stepIncreasePerUnit: "0" }],
      ),
      insert: vi.fn(() => ({ values })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await transportRouter.createCaller(createAuthContext()).saveTrip({ vehicleId: 11, projectId: 10, freightRuleId: 12, startAt: "2026-07-25T08:00:00.000Z", endAt: null, actualDistanceKm: 1, volumeCubicMeters: 2, weightTons: null, evidenceId: null, startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null });

    expect(result.tripNo).toMatch(/^TR-10-\d{14}-\d{2}$/);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tripNo: result.tripNo }));
  });

  it("机械成本和运输趟次的状态流转均保留项目范围校验，已结算记录不可回退", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    const machineCostDb = {
      ...createSelectDb([{ id: 21, projectId: 10, status: "settled" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(machineCostDb as never);

    await expect(machineryRouter.createCaller(createAuthContext()).transitionCost({ id: 21, projectId: 10, nextStatus: "void" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);

    const tripDb = {
      ...createSelectDb([{ id: 31, projectId: 10, vehicleId: 11, status: "settled" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(tripDb as never);

    await expect(transportRouter.createCaller(createAuthContext()).transitionTrip({ id: 31, projectId: 10, nextStatus: "void" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("会计机械月度明细按草稿、提交、审核、结算状态机流转，已结算快照不可回退", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    const updateValues = vi.fn();
    const monthlyStatementDb = {
      ...createSelectDb([{ id: 92, projectId: 10, status: "draft", machineId: 7, period: "2026-08" }]),
      update: vi.fn(() => ({ set: vi.fn((values: unknown) => { updateValues(values); return { where: vi.fn(async () => undefined) }; }) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(monthlyStatementDb as never);

    await expect(machineryRouter.createCaller(createAuthContext()).transitionMonthlyStatement({ id: 92, projectId: 10, nextStatus: "submitted" })).resolves.toEqual({ success: true });
    expect(updateValues).toHaveBeenCalledWith(expect.objectContaining({ status: "submitted" }));
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("运输结算将已核准的项目供油从总运费扣除，固化净结算快照并锁定柴油记录", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    const settlementWrites: unknown[] = [];
    const update = vi.fn(() => ({ set: vi.fn((values: unknown) => {
      settlementWrites.push(values);
      return { where: vi.fn(async () => [{ affectedRows: 1 }]) };
    }) }));
    const auditValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 33, projectId: 10, vehicleId: 11, status: "verified", calculatedAmount: "1200.00" }],
        [{ id: 701, recordNo: "DS1001", liters: "60", appliedUnitPrice: "7.50", amount: "450.00", supplyMethod: "project_supply", deductFromFreight: true, status: "approved" }],
      ),
      update,
      insert: vi.fn(() => ({ values: auditValues })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).transitionTrip({ id: 33, projectId: 10, nextStatus: "settled" })).resolves.toEqual({ success: true });

    expect(settlementWrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "settled", fuelDeductionAmount: "450", netSettlementAmount: "750", fuelSettlementSnapshot: expect.objectContaining({ grossFreightAmount: 1200, fuelDeductionAmount: 450, netSettlementAmount: 750 }) }),
      expect.objectContaining({ status: "settled" }),
    ]));
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "transport", action: "transition_trip", summary: expect.stringContaining("油款扣减¥450.00") }));
  });

  it("机械与运输正向流转同时留下审计和公众号业务深链", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    const machineAuditValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 22, projectId: 10, status: "draft" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: machineAuditValues })),
    } as never);

    await expect(machineryRouter.createCaller(createAuthContext()).transitionCost({ id: 22, projectId: 10, nextStatus: "approved" })).resolves.toEqual({ success: true });
    expect(machineAuditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "machinery", action: "transition_cost", targetId: "22" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenLastCalledWith(expect.objectContaining({
      module: "machinery", eventCode: "machine_cost_approved", targetId: "22", deepLink: "/mobile/machinery",
    }));

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const tripAuditValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 32, projectId: 10, vehicleId: 11, status: "draft" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: tripAuditValues })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).transitionTrip({ id: 32, projectId: 10, nextStatus: "submitted" })).resolves.toEqual({ success: true });
    expect(tripAuditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "transport", action: "transition_trip", targetId: "32" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenLastCalledWith(expect.objectContaining({
      module: "transport", eventCode: "transport_trip_submitted", targetId: "32", deepLink: "/mobile/transport",
    }));
  });

  it("机械成本和运输趟次在条件状态更新冲突时不继续审计或投递通知", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    const machineAuditValues = vi.fn(async () => undefined);
    const machineUpdateWhere = vi.fn(async () => [{ affectedRows: 0 }]);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 41, projectId: 10, status: "draft" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: machineUpdateWhere })) })),
      insert: vi.fn(() => ({ values: machineAuditValues })),
    } as never);

    await expect(machineryRouter.createCaller(createAuthContext()).transitionCost({ id: 41, projectId: 10, nextStatus: "approved" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(machineUpdateWhere).toHaveBeenCalledTimes(1);
    expect(machineAuditValues).not.toHaveBeenCalled();
    expect(mockNotifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalled();

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const tripAuditValues = vi.fn(async () => undefined);
    const tripUpdateWhere = vi.fn(async () => [{ affectedRows: 0 }]);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 42, projectId: 10, vehicleId: 11, status: "draft" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: tripUpdateWhere })) })),
      insert: vi.fn(() => ({ values: tripAuditValues })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).transitionTrip({ id: 42, projectId: 10, nextStatus: "submitted" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tripUpdateWhere).toHaveBeenCalledTimes(1);
    expect(tripAuditValues).not.toHaveBeenCalled();
    expect(mockNotifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalled();
  });

  it("新建运输票据必须同时配置装土点和卸土点，避免无法闭环的单地点票据", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([
      { id: 11, projectId: 10, status: "active", boxLengthMeters: "6", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" },
    ]) as never);

    await expect(transportRouter.createCaller(createAuthContext()).saveTrip({
      tripNo: "TR-SITE-PARTIAL", vehicleId: 11, projectId: 10, freightRuleId: 12, loadSiteId: 71, startAt: "2026-07-25T08:00:00.000Z", endAt: null,
      actualDistanceKm: 8, volumeCubicMeters: 2, weightTons: null, evidenceId: null, startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null,
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("同时选择装土点和卸土点") });
  });

  it("车牌直拍票据必须关联现场影像、直接进入待核验并向主管投递核验提醒", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const inserted: unknown[] = [];
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 11, projectId: 10, status: "active", plateNo: "湘A12345", boxLengthMeters: "6", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" }],
        [{ id: 71, projectId: 10, siteType: "load", status: "active", name: "K12 装土区", administratorUserId: 1 }],
        [{ id: 72, projectId: 10, siteType: "unload", status: "active", name: "K18 卸土区", administratorUserId: 1 }],
        [{ id: 301, projectId: 10, sourceType: "transport" }],
        [{ id: 12, projectId: 10, status: "active", effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), effectiveTo: null, settlementUnit: "cubic_meter", startDistanceKm: "0", basePricePerUnit: "10", stepMeters: 500, stepIncreasePerUnit: "0" }],
      ),
      insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { inserted.push(value); }) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).saveTrip({ tripNo: "TR-PLATE-001", vehicleId: 11, projectId: 10, freightRuleId: 12, invoiceMode: "plate_photo", loadSiteId: 71, unloadSiteId: 72, startAt: "2026-07-25T08:00:00.000Z", endAt: null, actualDistanceKm: 8, volumeCubicMeters: 2, weightTons: null, evidenceId: 301, startLatitude: 30.2, startLongitude: 120.1, endLatitude: null, endLongitude: null })).resolves.toMatchObject({ success: true, tripNo: "TR-PLATE-001" });

    expect(inserted).toEqual(expect.arrayContaining([expect.objectContaining({ tripNo: "TR-PLATE-001", invoiceMode: "plate_photo", evidenceId: 301, status: "submitted", routeSnapshot: expect.objectContaining({ invoiceMode: "plate_photo", platePhotoEvidenceId: 301 }) })]));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_plate_photo_ticket_submitted", targetId: "TR-PLATE-001" }));
  });

  it("车牌直拍票据不能被误送入 NFC 装卸刷卡状态机", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([
      { id: 62, projectId: 10, vehicleId: 11, invoiceMode: "plate_photo", status: "submitted", loadSiteId: 71, unloadSiteId: 72, loadConfirmedAt: null, unloadConfirmedAt: null },
    ]) as never);

    await expect(transportRouter.createCaller(createAuthContext()).recordLoadEvent({ tripId: 62, projectId: 10, siteId: 71, idempotencyKey: "reader-photo-block-0001", occurredAt: "2026-07-25T08:00:00.000Z" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("不进入 NFC 刷卡流程") });
  });

  it("运输日汇总按车辆拆分 NFC 与直拍票据数量，并保留运费与待核验数量", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [
        { id: 81, projectId: 10, vehicleId: 11, invoiceMode: "nfc_card", status: "verified", startAt: new Date("2026-07-25T08:00:00.000Z"), volumeCubicMeters: "3", weightTons: "0", calculatedAmount: "150", routeSnapshot: {}, evidenceId: 1 },
        { id: 82, projectId: 10, vehicleId: 11, invoiceMode: "plate_photo", status: "submitted", startAt: new Date("2026-07-25T09:00:00.000Z"), volumeCubicMeters: "2", weightTons: "0", calculatedAmount: "100", routeSnapshot: {}, evidenceId: 2 },
      ],
      [{ id: 11, plateNo: "湘A12345" }],
    ) as never);

    const result = await transportRouter.createCaller(createAuthContext()).dailySummary({ projectId: 10, date: "2026-07-25" });
    expect(result).toMatchObject({ tripCount: 2, nfcCardTicketCount: 1, platePhotoTicketCount: 1, amount: 250, vehicleSummaries: [expect.objectContaining({ plateNo: "湘A12345", ticketCount: 2, nfcCardTicketCount: 1, platePhotoTicketCount: 1, amount: 250, pendingReviewCount: 1 })] });
  });

  it("地点无需配置现场管理员即可由具备运输权限的用户保存", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence([{ id: 71 }]),
      insert,
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).saveSite({ projectId: 10, siteType: "load", name: "K12 装土区", address: null, latitude: null, longitude: null, administratorUserId: null, status: "active" })).resolves.toMatchObject({ success: true, id: 71 });
    expect(insert).toHaveBeenCalled();
  });

  it("运输负责人可读取项目级单次刷卡闭环设置，缺省值保持关闭", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(transportRouter.createCaller(createAuthContext()).getNfcSingleScanCloseSetting({ projectId: 10 })).resolves.toEqual({ enabled: false, minimumIntervalPolicy: "route_minimum_transit_minutes" });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("仅超级管理员可启用单次刷卡闭环并留下审计记录", async () => {
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ canAccess: true, reason: "super_admin" });
    const settingUpdate = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const auditValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 900, version: 2 }]),
      update: vi.fn(() => ({ set: settingUpdate })),
      insert: vi.fn(() => ({ values: auditValues })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).setNfcSingleScanCloseSetting({ projectId: 10, enabled: true })).resolves.toEqual({ success: true, enabled: true });
    expect(settingUpdate).toHaveBeenCalledWith(expect.objectContaining({ valueJson: "true", status: "published", version: 3 }));
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "transport", action: "set_nfc_single_scan_close", targetId: "TRANSPORT_NFC_SINGLE_SCAN_CLOSE_PROJECT:10" }));
  });

  it("非超级管理员不得通过移动端或接口启用单次刷卡闭环", async () => {
    await expect(transportRouter.createCaller(createAuthContext()).setNfcSingleScanCloseSetting({ projectId: 10, enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("NFC 单次闭环保留最小连续开票拦截和真实状态标记，不伪造卸土刷卡事件", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const supportSource = readFileSync(new URL("./services/transportNfcSupport.ts", import.meta.url), "utf8");
    expect(source).toContain("assertVehicleMinimumNfcInvoiceInterval");
    expect(source).toContain("minimumTransitMinutes: route.minimumTransitMinutes");
    expect(source).toContain("completeNfcTripBySingleScan");
    expect(supportSource).toContain("nfcSingleScanClosed: true");
    expect(source).toContain("singleScanClosed");
    expect(supportSource).toContain("activeVehicleTransitKey: null");
    expect(supportSource).toContain("nfcTransitKey: null");
  });

  it("装土刷卡按事件幂等记录、条件更新趟次，并向已绑定司机账号写入站内消息", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
    const db = {
      ...createSelectDbSequence(
        [{ id: 50, projectId: 10, vehicleId: 11, status: "draft", loadConfirmedAt: null, unloadConfirmedAt: null }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7 }],
        [],
        [{ id: 100, tripId: 50, eventType: "load", validationStatus: "accepted", validationReason: null }],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await transportRouter.createCaller(createAuthContext()).recordLoadEvent({ tripId: 50, projectId: 10, idempotencyKey: "reader-load-0001", occurredAt: "2026-07-25T08:00:00.000Z" });

    expect(result).toMatchObject({ success: true, duplicate: false, needsReview: false, eventId: 100, driverNotificationQueued: true });
    expect(insertValues).toHaveBeenNthCalledWith(1, expect.objectContaining({ tripId: 50, vehicleId: 11, eventType: "load", validationStatus: "accepted" }));
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenNthCalledWith(2, expect.objectContaining({ module: "transport", action: "record_load_card_event", targetId: "100" }));
    expect(insertValues).toHaveBeenNthCalledWith(3, expect.objectContaining({ eventCode: "transport_load_driver_notice", recipientUserId: 7, idempotencyKey: "inapp:transport-load:100:7", channel: "in_app", deepLink: "/mobile/transport" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_load_card_confirmed", targetId: "100" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_load_driver_notice" }));
  });

  it("同一装土读卡事件重复重放时不重复写入、不重复提醒", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const input = { tripId: 50, projectId: 10, idempotencyKey: "reader-load-0002", occurredAt: "2026-07-25T08:00:00.000Z" };
    const payloadFingerprint = createHash("sha256").update(JSON.stringify({ eventType: "load", tripId: 50, projectId: 10, siteId: null, idempotencyKey: "reader-load-0002", deviceId: null, cardFingerprint: null, latitude: null, longitude: null, occurredAt: "2026-07-25T08:00:00.000Z" })).digest("hex");
    const insertValues = vi.fn(async () => undefined);
    const db = {
      ...createSelectDbSequence(
        [{ id: 50, projectId: 10, vehicleId: 11, status: "draft", loadConfirmedAt: null, unloadConfirmedAt: null }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7 }],
        [{ id: 101, tripId: 50, eventType: "load", payloadFingerprint, validationStatus: "accepted", validationReason: null }],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(transportRouter.createCaller(createAuthContext()).recordLoadEvent(input)).resolves.toMatchObject({ success: true, duplicate: true, eventId: 101 });
    expect(insertValues).not.toHaveBeenCalled();
    expect(mockNotifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalled();
  });

  it("卸土先于装土时将事件留痕并标记待人工复核，而不关闭运输闭环", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
    const db = {
      ...createSelectDbSequence(
        [{ id: 51, projectId: 10, vehicleId: 11, status: "draft", loadConfirmedAt: null, unloadConfirmedAt: null }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7 }],
        [],
        [{ id: 102, tripId: 51, eventType: "unload", validationStatus: "accepted", validationReason: null }],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(transportRouter.createCaller(createAuthContext()).recordUnloadEvent({ tripId: 51, projectId: 10, idempotencyKey: "reader-unload-0001", occurredAt: "2026-07-25T08:10:00.000Z" })).resolves.toMatchObject({ success: false, needsReview: true, validationStatus: "needs_review" });
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ module: "transport", action: "record_card_event_needs_review", targetId: "102" }));
    expect(insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ eventCode: "transport_card_event_exception", recipientUserId: 7, idempotencyKey: "inapp:transport-card-review:102:7", channel: "in_app", deepLink: "/mobile/transport" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_card_event_exception", targetId: "102" }));
  });

  it("司机柴油扣款明细仅投影本人车辆的有效运输扣油记录和加油机表数", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["DRIVER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [
        { id: 11, plateNo: "川A12345", driverUserId: 1 },
        { id: 12, plateNo: "川A99999", driverUserId: 2 },
      ],
      [
        { id: 201, recordNo: "DS1001", vehicleId: 11, transportTripId: 50, assetType: "vehicle", deductFromFreight: true, status: "approved", refueledAt: new Date("2026-08-26T02:30:00.000Z"), liters: "42.5", amount: "310.25", appliedUnitPrice: "7.30", supplyMethod: "project_supply", stationOrSupplierName: "项目油库", meterReading: "1234.5", receiptNo: "RC-001", evidenceId: null, remarks: "当日运输扣油" },
        { id: 202, recordNo: "DS1002", vehicleId: 12, transportTripId: 51, assetType: "vehicle", deductFromFreight: true, status: "approved", refueledAt: new Date("2026-08-26T02:40:00.000Z"), liters: "30", amount: "219", appliedUnitPrice: "7.30", supplyMethod: "project_supply", stationOrSupplierName: null, meterReading: "2000", receiptNo: null, evidenceId: null, remarks: null },
        { id: 203, recordNo: "DS1003", vehicleId: 11, transportTripId: 52, assetType: "vehicle", deductFromFreight: false, status: "approved", refueledAt: new Date("2026-08-26T02:50:00.000Z"), liters: "20", amount: "146", appliedUnitPrice: "7.30", supplyMethod: "project_supply", stationOrSupplierName: null, meterReading: null, receiptNo: null, evidenceId: null, remarks: null },
        { id: 204, recordNo: "DS1004", vehicleId: 11, transportTripId: 53, assetType: "vehicle", deductFromFreight: true, status: "void", refueledAt: new Date("2026-08-26T03:00:00.000Z"), liters: "10", amount: "73", appliedUnitPrice: "7.30", supplyMethod: "project_supply", stationOrSupplierName: null, meterReading: null, receiptNo: null, evidenceId: null, remarks: null },
      ],
    ) as never);

    await expect(transportRouter.createCaller(createAuthContext()).driverFuelDeductionDetails({ projectId: 10, date: "2026-08-26" })).resolves.toMatchObject({
      date: "2026-08-26",
      recordCount: 1,
      totalLiters: 42.5,
      totalAmount: 310.25,
      records: [expect.objectContaining({ id: 201, vehiclePlateNo: "川A12345", meterReading: 1234.5, receiptNo: "RC-001", evidence: null })],
    });
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("现场传入未绑定的射频卡指纹时只留痕待复核，不能确认装土状态", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 52, projectId: 10, vehicleId: 11, status: "draft", loadConfirmedAt: null, unloadConfirmedAt: null }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7 }],
        [],
        [{ id: 103, tripId: 52, eventType: "load", validationStatus: "accepted", validationReason: null }],
        [],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).recordLoadEvent({ tripId: 52, projectId: 10, idempotencyKey: "reader-load-unbound-card", cardFingerprint: "a".repeat(64), occurredAt: "2026-07-25T08:00:00.000Z" })).resolves.toMatchObject({ success: false, needsReview: true, validationStatus: "needs_review" });
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_card_event_exception", targetId: "103" }));
  });

  it("车辆射频卡绑定只保存 UID 指纹、司机电话密文与掩码，不将原始信息写入审计", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 11, projectId: 10, status: "active", driverUserId: null, driverName: "张司机", plateNo: "粤A12345" }],
        [],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    await expect(transportRouter.createCaller(createAuthContext()).saveVehicleRfidCard({ projectId: 10, vehicleId: 11, writerDeviceId: null, cardUid: "ABCD1234", driverPhone: "13800138000", status: "active" })).resolves.toEqual({ success: true });
    const binding = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(binding).toMatchObject({ vehicleId: 11, cardUidMasked: "****1234", driverPhoneMasked: "*******8000", status: "active" });
    expect(binding.cardUidFingerprint).not.toBe("ABCD1234");
    expect(binding.driverPhoneEncrypted).not.toBe("13800138000");
    expect(insertValues.mock.calls[1]?.[0]).toMatchObject({ action: "bind_vehicle_rfid_card", summary: expect.not.stringContaining("13800138000") });
  });

  it("写卡任务临时返回含车牌、司机与电话的签名卡载荷，数据库只保存载荷摘要并保留确认任务", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 21, projectId: 10, vehicleId: 11, writerDeviceId: null, status: "active", payloadVersion: 1, driverPhoneEncrypted: encryptSecret("13800138000") }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: null, driverName: "张司机", plateNo: "粤A12345", vehicleType: "dump_truck", boxLengthMeters: "6", boxWidthMeters: "2.3", boxHeightMeters: "1.2", loadFactor: "1" }],
        [{ id: 401 }],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const result = await transportRouter.createCaller(createAuthContext()).prepareRfidCardWrite({ projectId: 10, cardId: 21, writerDeviceId: null, action: "issue" });
    expect(result).toMatchObject({ success: true, jobId: 401, hardwareMode: "manual_confirmation", payload: { t: "RC3", c: 21, p: 10, r: 1, v: "粤A12345", d: "张司机", h: "13800138000", n: expect.any(String), s: expect.any(String) } });
    expect(JSON.stringify(result.payload)).not.toMatch(/route|amount|volume|cargo|settlement/i);
    expect(insertValues.mock.calls[0]?.[0]).toMatchObject({ cardId: 21, payloadVersion: 1, action: "issue" });
    expect(JSON.stringify(insertValues.mock.calls[0]?.[0])).not.toContain("13800138000");
    expect(insertValues.mock.calls[1]?.[0]).toMatchObject({ action: "prepare_rfid_card_write", targetId: "401" });
  });

  it("本地硬件测试只登记项目范围内的读写结果和 UID 指纹摘要，不会签发或激活正式车辆卡", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const auditValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({ insert: vi.fn(() => ({ values: auditValues })) } as never);

    await expect(transportRouter.createCaller(createAuthContext()).recordRfidHardwareTest({
      projectId: 10,
      writerDeviceId: null,
      success: true,
      cardUidFingerprint: "a".repeat(64),
    })).resolves.toEqual({ success: true });

    expect(assertProjectInCurrentScope).toHaveBeenCalledWith(expect.anything(), 10);
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({
      module: "transport",
      action: "rfid_hardware_test_success",
      targetType: "rfid_writer_hardware_test",
      summary: expect.stringContaining("uTrust 本地测试写卡与回读通过"),
    }));
    expect(JSON.stringify(auditValues.mock.calls[0]?.[0])).not.toContain("a".repeat(64));
  });
});
