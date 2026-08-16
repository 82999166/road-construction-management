import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
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
    hasUserSpecificOperationPermission: vi.fn(),
  };
});

import { assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, hasUserSpecificOperationPermission } from "./access";
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
    vi.mocked(hasUserSpecificOperationPermission).mockResolvedValue(false);
    mockNotifyOfficialAccountBusinessEventSafely.mockResolvedValue([{ delivered: true, reason: "sent" }]);
  });

  it("机械台账列表在读取前强制校验调用方的项目数据范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(machineryRouter.createCaller(createAuthContext()).listMachines({ projectId: 10 })).resolves.toEqual([]);
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

  it("未提供趟次编号时由服务端生成带随机后缀的项目内审计编号", async () => {
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

    expect(result.tripNo).toMatch(/^TR-10-\d{8}-[A-F0-9]{8}$/);
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

  it("装土刷卡按事件幂等记录、条件更新趟次，并同时通知司机与上级主管", async () => {
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
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_load_card_confirmed", targetId: "100" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_load_driver_notice", recipientUserIds: [7], targetId: "100" }));
  });

  it("同一装土读卡事件重复重放时不重复写入、不重复提醒", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const input = { tripId: 50, projectId: 10, idempotencyKey: "reader-load-0002", occurredAt: "2026-07-25T08:00:00.000Z" };
    const payloadFingerprint = createHash("sha256").update(JSON.stringify({ eventType: "load", tripId: 50, projectId: 10, idempotencyKey: "reader-load-0002", deviceId: null, cardFingerprint: null, occurredAt: "2026-07-25T08:00:00.000Z" })).digest("hex");
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
    expect(insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ module: "transport", action: "record_card_event_needs_review", targetId: "102" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_card_event_exception", targetId: "102" }));
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
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7, plateNo: "粤A12345" }],
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

  it("写卡任务仅临时返回完整车辆与司机载荷，数据库只保存载荷摘要并保留确认任务", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    const insertValues = vi.fn(async () => undefined);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDbSequence(
        [{ id: 21, projectId: 10, vehicleId: 11, writerDeviceId: null, status: "active", payloadVersion: 1, driverPhoneEncrypted: encryptSecret("13800138000") }],
        [{ id: 11, projectId: 10, status: "active", driverUserId: 7, plateNo: "粤A12345", vehicleType: "dump_truck", boxLengthMeters: "6", boxWidthMeters: "2.3", boxHeightMeters: "1.2", loadFactor: "1" }],
        [{ id: 7, name: "张司机" }],
        [{ id: 401 }],
      ),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const result = await transportRouter.createCaller(createAuthContext()).prepareRfidCardWrite({ projectId: 10, cardId: 21, writerDeviceId: null, action: "issue" });
    expect(result).toMatchObject({ success: true, jobId: 401, hardwareMode: "manual_confirmation", payload: expect.objectContaining({ vehicle: expect.objectContaining({ plateNo: "粤A12345" }), driver: expect.objectContaining({ name: "张司机", phone: "13800138000" }) }) });
    expect(insertValues.mock.calls[0]?.[0]).toMatchObject({ cardId: 21, payloadVersion: 1, action: "issue" });
    expect(JSON.stringify(insertValues.mock.calls[0]?.[0])).not.toContain("13800138000");
    expect(insertValues.mock.calls[1]?.[0]).toMatchObject({ action: "prepare_rfid_card_write", targetId: "401" });
  });
});
