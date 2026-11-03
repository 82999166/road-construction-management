import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

const { sms, businessNotice, driverNotice, riskScan } = vi.hoisted(() => ({
  sms: vi.fn(), businessNotice: vi.fn(), driverNotice: vi.fn(), riskScan: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: businessNotice }));
vi.mock("./services/officialAccountDriverBinding", () => ({ sendOfficialAccountDriverNotification: driverNotice }));
vi.mock("./services/smsNotifier", async importOriginal => ({
  ...await importOriginal<typeof import("./services/smsNotifier")>(), notifyAliyunSmsSafely: sms,
}));
vi.mock("./services/transportNfcSupport", async importOriginal => ({
  ...await importOriginal<typeof import("./services/transportNfcSupport")>(), triggerTransportRiskScan: riskScan,
}));
vi.mock("./access", async importOriginal => ({
  ...await importOriginal<typeof import("./access")>(),
  assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(), hasUserSpecificOperationPermission: vi.fn(),
  getSuperAdminAccess: vi.fn(), getRoleOperationPermissionDecision: vi.fn(),
}));

import { assertProjectInCurrentScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, getSuperAdminAccess, hasUserSpecificOperationPermission } from "./access";
import { getDb } from "./db";
import { router } from "./_core/trpc";
import { transportRouter } from "./routers/operations";
import { buildTransportNfcDeepLink } from "./services/rfidCardPayload";

// 保留真实 tRPC 权限中间件、签名校验及 SQL 条件；仅隔离数据库和所有外部投递。
const testRouter = router({ transport: transportRouter });
function caller() {
  return testRouter.createCaller({ user: {
    id: 1, openId: "cross-channel-test", name: "现场测试员", email: null,
    loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  }, req: {}, res: {} } as TrpcContext).transport;
}

type Row = Record<string, any>;
const startAt = "2026-11-03T00:00:00.000Z";
const arrivedAt = "2026-11-03T00:20:00.000Z";
const fingerprint = "a".repeat(64);
function token(cardId = 21) {
  return new URL(buildTransportNfcDeepLink({ projectId: 10, cardId, payloadVersion: 1 })).searchParams.get("nfc")!;
}
function unloadInput(overrides: Row = {}) {
  return { token: token(), expectedUnloadTripId: 51, idempotencyKey: "mobile-unload-original", latitude: 30, longitude: 120, occurredAt: arrivedAt, ...overrides };
}
function photoInput(overrides: Row = {}) {
  return { tripId: 51, projectId: 10, unloadEvidenceId: 302, idempotencyKey: "photo-unload-original", latitude: 30, longitude: 120, occurredAt: arrivedAt, ...overrides };
}

/** 对真实 Drizzle SQL 的 AND 谓词执行过滤，避免按读取顺序返回任意行而掩盖车辆/状态条件回归。 */
function createMemoryDb(withTrip = true, invoiceMode = "plate_photo") {
  const vehicle = { id: 11, projectId: 10, status: "active", plateNo: "湘A12345", driverUserId: 7, driverName: "张师傅", driverPhoneEncrypted: null, boxLengthMeters: "6", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" };
  const siteSafety = { minimumTransitMinutes: 10, minimumTransitEnabled: true, unloadGeofenceMeters: 300, unloadGeofenceEnabled: true };
  const tables: Record<string, Row[]> = {
    transport_vehicles: [vehicle, { ...vehicle, id: 12, plateNo: "湘B67890" }],
    transport_vehicle_rfid_cards: [{ id: 21, projectId: 10, vehicleId: 11, status: "active", payloadVersion: 1, cardUidFingerprint: fingerprint }, { id: 22, projectId: 10, vehicleId: 12, status: "active", payloadVersion: 1, cardUidFingerprint: "b".repeat(64) }],
    transport_sites: [{ id: 71, projectId: 10, siteType: "load", status: "active", name: "装土区", administratorUserId: 1, latitude: "30", longitude: "120", ...siteSafety }, { id: 72, projectId: 10, siteType: "unload", status: "active", name: "卸土区", administratorUserId: 1, latitude: "30", longitude: "120", ...siteSafety }],
    transport_route_presets: [{ id: 91, projectId: 10, status: "active", loadSiteId: 71, unloadSiteId: 72, freightRuleId: 12, presetDistanceKm: "8", isDefault: true, unloadOnlyCloseEnabled: false, ...siteSafety }],
    freight_rate_rules: [{ id: 12, projectId: 10, status: "active", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, settlementUnit: "cubic_meter", startDistanceKm: "0", basePricePerUnit: "10", stepMeters: 500, stepIncreasePerUnit: "0" }],
    evidence_records: [{ id: 301, projectId: 10, sourceType: "transport", sourceId: "transport-trip-TR-51" }, { id: 302, projectId: 10, sourceType: "transport", sourceId: null }, { id: 303, projectId: 10, sourceType: "transport", sourceId: null }],
    transport_reader_devices: [{ id: 41, projectId: 10, siteId: 72, deviceCode: "UNLOAD-01", displayName: "卸土读卡器", status: "active" }, { id: 42, projectId: 10, siteId: 71, deviceCode: "LOAD-01", displayName: "装土读卡器", status: "active" }],
    transport_trips: withTrip ? [{ id: 51, tripNo: "TR-51", projectId: 10, vehicleId: 11, invoiceMode, status: "submitted", startAt: new Date(startAt), endAt: null, loadSiteId: 71, unloadSiteId: 72, loadConfirmedAt: new Date(startAt), loadConfirmedBy: 1, loadEventId: null, unloadConfirmedAt: null, unloadEventId: null, exceptionStatus: "none", evidenceId: 301, actualDistanceKm: "8", calculatedAmount: "120", activeVehicleTransitKey: "vehicle:10:11", nfcTransitKey: invoiceMode === "nfc_card" ? "nfc:10:21" : null, routeSnapshot: { source: invoiceMode === "plate_photo" ? "mobile" : "mobile_nfc_invoice", invoiceMode, routePresetId: 91, platePhotoEvidenceId: invoiceMode === "plate_photo" ? 301 : null } }] : [],
    transport_card_events: [], notification_records: [], audit_logs: [], system_settings: [],
  };
  const writes: { table: string; values: Row; affectedRows?: number }[] = [];
  const dialect = new MySqlDialect();
  function matches(row: Row, condition?: SQL) {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition);
    let paramIndex = 0;
    const terms = [...query.sql.matchAll(/`[^`]+`\.`([^`]+)`\s*(is not null|is null|<>|>=|<=|=|>|<)\s*(\?)?/g)];
    if (!terms.length || /\bor\b/i.test(query.sql)) throw new Error(`测试桩尚未支持此 SQL: ${query.sql}`);
    return terms.map(term => {
      const value = row[term[1]];
      const operator = term[2];
      if (operator === "is null") return value == null;
      if (operator === "is not null") return value != null;
      const parameter = query.params[paramIndex++];
      if (operator === "=") return value === parameter;
      if (operator === "<>") return value !== parameter;
      throw new Error(`测试桩尚未支持运算符 ${operator}`);
    }).every(Boolean);
  }
  let failNextTripWrite = false;
  const db = {
    select: vi.fn(() => ({ from: (table: any) => {
      const name = getTableName(table);
      let condition: SQL | undefined;
      let count = Infinity;
      const execute = () => structuredClone((tables[name] ?? []).filter(row => matches(row, condition)).sort((a, b) => b.id - a.id).slice(0, count));
      const query = {
        where: (value: SQL) => { condition = value; return query; },
        orderBy: (..._args: unknown[]) => query,
        limit: (value: number) => { count = value; return Promise.resolve(execute()); },
        then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(execute).then(resolve, reject),
      };
      return query;
    } })),
    insert: vi.fn((table: any) => ({ values: (values: Row) => {
      const name = getTableName(table);
      const execute = () => {
        const rows = tables[name] ?? (tables[name] = []);
        if (name === "transport_card_events" && rows.some(row => row.idempotencyKey === values.idempotencyKey)) throw new Error("duplicate idempotencyKey");
        const id = Math.max(50, ...rows.map(row => row.id ?? 0)) + 1;
        rows.push({ id, ...(name === "transport_trips" ? { unloadConfirmedAt: null, endAt: null, loadEventId: null, unloadEventId: null } : {}), ...structuredClone(values) });
        writes.push({ table: name, values: structuredClone(values) });
        return [{ affectedRows: 1 }];
      };
      return { then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(execute).then(resolve, reject), onDuplicateKeyUpdate: async () => execute() };
    } })),
    update: vi.fn((table: any) => ({ set: (values: Row) => ({ where: async (condition: SQL) => {
      const name = getTableName(table);
      let affectedRows = 0;
      if (name === "transport_trips" && "unloadConfirmedAt" in values && failNextTripWrite) failNextTripWrite = false;
      else for (const row of tables[name] ?? []) if (matches(row, condition)) { Object.assign(row, structuredClone(values)); affectedRows++; }
      writes.push({ table: name, values: structuredClone(values), affectedRows });
      return [{ affectedRows }];
    } }) })),
  };
  vi.mocked(getDb).mockResolvedValue(db as never);
  return { tables, writes, db, trip: () => tables.transport_trips[0], failClosure: () => { failNextTripWrite = true; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "cross-channel-test-only-signing-secret";
  vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
  vi.mocked(getSuperAdminAccess).mockResolvedValue({ canAccess: false, reason: "not_super_admin" });
  vi.mocked(hasUserSpecificOperationPermission).mockResolvedValue(false);
  vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({ hasDetailedPermissions: true, allowed: true } as never);
  sms.mockResolvedValue(undefined); businessNotice.mockResolvedValue([]); driverNotice.mockResolvedValue(undefined);
});

function assertNoClosure(state: ReturnType<typeof createMemoryDb>) {
  expect(state.trip()?.unloadConfirmedAt).toBeNull();
  expect(state.tables.transport_trips).toHaveLength(1);
  expect(sms).not.toHaveBeenCalledWith(expect.objectContaining({ eventCode: "transport_unload_completed" }));
  expect(state.tables.notification_records.filter(row => row.eventCode === "transport_unload_completed")).toHaveLength(0);
}

describe("同车辆同趟运输双向卸土互通", () => {
  it("拍照开票→NFC预览识别原运单→明确确认卸土，仅闭环原趟且来源不变", async () => {
    const state = createMemoryDb(false);
    const result = await caller().saveTrip({ tripNo: "TR-PLATE-NEW", vehicleId: 11, projectId: 10, routePresetId: 91, invoiceMode: "plate_photo", evidenceId: 301, startAt });
    const trip = state.trip();
    expect(result.dailyVehicleTripOrdinal).toBe(1);
    const writesBeforePreview = state.writes.length;
    expect(await caller().previewMobileNfcInvoice({ token: token() })).toMatchObject({ vehicle: { id: 11 }, routes: [], activeTrip: { id: trip.id, invoiceMode: "plate_photo", loadConfirmed: true } });
    expect(state.writes).toHaveLength(writesBeforePreview);
    const loadAt = trip.loadConfirmedAt;
    expect(await caller().confirmMobileNfcInvoice(unloadInput({ expectedUnloadTripId: trip.id }))).toMatchObject({ success: true, duplicate: false, stage: "completed", tripNo: "TR-PLATE-NEW", dailyVehicleTripOrdinal: 1 });
    expect(trip).toMatchObject({ invoiceMode: "plate_photo", loadConfirmedAt: loadAt, loadEventId: null, unloadConfirmedAt: new Date(arrivedAt), activeVehicleTransitKey: null, nfcTransitKey: null, endAt: new Date(arrivedAt), status: "submitted", evidenceId: 301, routeSnapshot: { source: "mobile", invoiceMode: "plate_photo", platePhotoEvidenceId: 301, unloadConfirmationMode: "nfc_card" } });
    expect(state.tables.transport_trips).toHaveLength(1);
    expect(state.tables.transport_card_events.map(row => row.eventType)).toEqual(["unload"]);
    expect(sms.mock.calls.filter(([input]) => input.eventCode === "transport_unload_completed")).toHaveLength(1);
  });

  it("NFC开票→拍照卸土，需上传凭证并释放原NFC与车辆锁，不改装土来源", async () => {
    const state = createMemoryDb(false);
    const issued = await caller().confirmMobileNfcInvoice({ token: token(), routePresetId: 91, idempotencyKey: "mobile-load-original", occurredAt: startAt });
    expect(issued).toMatchObject({ success: true, stage: "in_transit", dailyVehicleTripOrdinal: 1 });
    const trip = state.trip();
    const loadEventId = trip.loadEventId;
    expect(await caller().confirmPlatePhotoUnload(photoInput({ tripId: trip.id }))).toMatchObject({ success: true, duplicate: false, dailyVehicleTripOrdinal: 1 });
    expect(trip).toMatchObject({ invoiceMode: "nfc_card", loadEventId, loadConfirmedAt: new Date(startAt), unloadConfirmedAt: new Date(arrivedAt), nfcTransitKey: null, activeVehicleTransitKey: null, routeSnapshot: { source: "mobile_nfc_invoice", invoiceMode: "nfc_card", unloadPhotoEvidenceId: 302, unloadConfirmationMode: "photo" } });
    expect(state.tables.evidence_records.find(row => row.id === 302)?.sourceId).toBe(`transport-unload-${trip.tripNo}`);
    expect(state.tables.transport_trips).toHaveLength(1);
    expect(state.tables.transport_card_events.map(row => [row.eventType, row.source])).toEqual([["load", "card_reader"], ["unload", "manual_review"]]);
  });

  it("现场签名卡scanNfcLink也能匹配拍照原趟，不进入无在途补刷卡/额外开票", async () => {
    const state = createMemoryDb();
    const input = { token: token(), readerDeviceCode: "UNLOAD-01", idempotencyKey: "link-unload-original", latitude: 30, longitude: 120, occurredAt: arrivedAt };
    expect(await caller().scanNfcLink(input)).toMatchObject({ success: true, stage: "completed", tripId: 51, tripNo: "TR-51", dailyVehicleTripOrdinal: 1 });
    expect(state.trip()).toMatchObject({ invoiceMode: "plate_photo", nfcTransitKey: null, activeVehicleTransitKey: null, endAt: new Date(arrivedAt) });
    expect(state.tables.transport_trips).toHaveLength(1);
    const writeCount = state.writes.length;
    const smsCount = sms.mock.calls.length;
    expect(await caller().scanNfcLink(input)).toMatchObject({ success: true, duplicate: true, stage: "completed" });
    expect(state.writes).toHaveLength(writeCount);
    expect(sms).toHaveBeenCalledTimes(smsCount);
    await expect(caller().scanNfcLink({ ...input, longitude: 121 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("现场卡recordUnloadEvent允许拍照票据卸土，但recordLoadEvent仍拒绝改写拍照装土", async () => {
    const state = createMemoryDb();
    await expect(caller().recordLoadEvent({ tripId: 51, projectId: 10, siteId: 71, cardFingerprint: fingerprint, idempotencyKey: "wrong-load-original", occurredAt: arrivedAt })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.writes).toHaveLength(0);
    expect(await caller().recordUnloadEvent({ tripId: 51, projectId: 10, siteId: 72, cardFingerprint: fingerprint, latitude: 30, longitude: 120, idempotencyKey: "field-unload-original", occurredAt: arrivedAt })).toMatchObject({ success: true, dailyVehicleTripOrdinal: 1 });
    expect(state.trip()).toMatchObject({ loadEventId: null, unloadConfirmedAt: new Date(arrivedAt), activeVehicleTransitKey: null });
  });

  it("相同NFC卸土确认重试即使带路线也不额外开票、不重复车数或通知", async () => {
    const state = createMemoryDb();
    const input = unloadInput({ routePresetId: 91 });
    await caller().confirmMobileNfcInvoice(input);
    const count = state.writes.length;
    const smsCount = sms.mock.calls.length;
    const riskCount = riskScan.mock.calls.length;
    expect(await caller().confirmMobileNfcInvoice(input)).toMatchObject({ success: true, duplicate: true, stage: "completed", tripNo: "TR-51" });
    expect(state.writes).toHaveLength(count);
    expect(sms).toHaveBeenCalledTimes(smsCount);
    expect(riskScan).toHaveBeenCalledTimes(riskCount);
    expect(state.tables.transport_card_events).toHaveLength(1);
    expect(state.tables.transport_trips).toHaveLength(1);
    await expect(caller().confirmMobileNfcInvoice(unloadInput({ idempotencyKey: "new-target-retry", routePresetId: 91 }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.tables.transport_trips).toHaveLength(1);
  });

  it("NFC开票相同确认重试仍返回装土原回执，不误执行卸土", async () => {
    const state = createMemoryDb(false);
    const input = { token: token(), routePresetId: 91, idempotencyKey: "load-retry-original", occurredAt: startAt };
    await caller().confirmMobileNfcInvoice(input);
    const count = state.writes.length;
    expect(await caller().confirmMobileNfcInvoice(input)).toMatchObject({ success: true, duplicate: true, stage: "in_transit" });
    expect(state.writes).toHaveLength(count);
    expect(state.trip().unloadConfirmedAt).toBeNull();
  });

  it("拍照重复确认与已拍照闭环后的现场卡重复确认均不新增卸土事件/车数/通知", async () => {
    const state = createMemoryDb(true, "nfc_card");
    await caller().confirmPlatePhotoUnload(photoInput());
    const count = state.writes.length;
    const noticeCount = driverNotice.mock.calls.length;
    expect(await caller().confirmPlatePhotoUnload(photoInput())).toMatchObject({ success: true, duplicate: true });
    expect(await caller().confirmPlatePhotoUnload(photoInput({ idempotencyKey: "photo-fresh-retry" }))).toMatchObject({ success: true, duplicate: true });
    expect(await caller().recordUnloadEvent({ tripId: 51, projectId: 10, siteId: 72, cardFingerprint: fingerprint, latitude: 30, longitude: 120, idempotencyKey: "field-after-photo", occurredAt: arrivedAt })).toMatchObject({ success: true, duplicate: true });
    expect(state.writes).toHaveLength(count);
    expect(driverNotice).toHaveBeenCalledTimes(noticeCount);
    expect(sms).not.toHaveBeenCalled();
    expect(state.tables.transport_card_events).toHaveLength(1);
  });

  it("卸土确认不把已经核验的运单回退至待核验", async () => {
    const state = createMemoryDb();
    state.trip().status = "verified";
    await caller().confirmMobileNfcInvoice(unloadInput());
    expect(state.trip().status).toBe("verified");
    const photoState = createMemoryDb(true, "nfc_card");
    photoState.trip().status = "verified";
    await caller().confirmPlatePhotoUnload(photoInput());
    expect(photoState.trip().status).toBe("verified");
  });
});

describe("跨通道卸土仍保留车辆、权限、现场与幂等边界", () => {
  it("扫错车辆卡时服务端拒绝expectedUnloadTripId，不关闭任意车辆且不创建新趟", async () => {
    const state = createMemoryDb();
    state.tables.transport_trips.push({ ...structuredClone(state.trip()), id: 52, tripNo: "TR-52", vehicleId: 12, activeVehicleTransitKey: "vehicle:10:12" });
    expect(await caller().previewMobileNfcInvoice({ token: token(22) })).toMatchObject({ vehicle: { id: 12, plateNo: "湘B67890" }, activeTrip: { id: 52 } });
    await expect(caller().confirmMobileNfcInvoice(unloadInput({ token: token(22) }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("不一致") });
    expect(state.writes).toHaveLength(0);
    expect(state.tables.transport_trips.every(trip => !trip.unloadConfirmedAt)).toBe(true);
    expect(sms).not.toHaveBeenCalled();
  });

  it("有效卡但没有目标在途时不能退回开票，错误项目范围也在读取/写入前拒绝", async () => {
    const state = createMemoryDb();
    await expect(caller().confirmMobileNfcInvoice(unloadInput({ token: token(22), routePresetId: 91 }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.mocked(assertProjectInCurrentScope).mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "不在项目范围" }));
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().confirmPlatePhotoUnload(photoInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.writes).toHaveLength(0);
  });

  it("真实权限中间件拒绝未授权确认，纯司机也不能操作他人车辆", async () => {
    const state = createMemoryDb();
    vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({ hasDetailedPermissions: true, allowed: false } as never);
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({ hasDetailedPermissions: true, allowed: true } as never);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["DRIVER"]);
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.writes).toHaveLength(0);
  });

  it("拍照运单无卡指纹拒绝，错车卡只留异常而不卸土", async () => {
    const state = createMemoryDb();
    const input = { tripId: 51, projectId: 10, siteId: 72, idempotencyKey: "field-wrong-card", latitude: 30, longitude: 120, occurredAt: arrivedAt };
    await expect(caller().recordUnloadEvent(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller().recordUnloadEvent({ ...input, cardFingerprint: "b".repeat(64) })).toMatchObject({ success: false, needsReview: true });
    assertNoClosure(state);
  });

  it("停用/旧版本车辆卡及篡改签名在预览前拒绝", async () => {
    const state = createMemoryDb();
    state.tables.transport_vehicle_rfid_cards[0].status = "revoked";
    await expect(caller().previewMobileNfcInvoice({ token: token() })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    state.tables.transport_vehicle_rfid_cards[0].status = "active";
    state.tables.transport_vehicle_rfid_cards[0].payloadVersion = 2;
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().previewMobileNfcInvoice({ token: "tampered-token-abcdef" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    ["最短运输时间", { occurredAt: "2026-11-03T00:01:00.000Z" }],
    ["GPS围栏", { latitude: 31 }],
    ["缺失GPS", { latitude: undefined, longitude: undefined }],
  ])("拍照开票→NFC卸土仍拦截%s，不能释放车辆锁", async (_label, overrides) => {
    const state = createMemoryDb();
    await expect(caller().confirmMobileNfcInvoice(unloadInput(overrides))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    assertNoClosure(state);
    expect(state.trip().activeVehicleTransitKey).toBe("vehicle:10:11");
  });

  it.each([
    ["未装土", { loadConfirmedAt: null }],
    ["已作废", { status: "void" }],
    ["已结算", { status: "settled" }],
  ])("现场卡跨通道确认仍拒绝%s", async (_label, changes) => {
    const state = createMemoryDb();
    Object.assign(state.trip(), changes);
    expect(await caller().recordUnloadEvent({ tripId: 51, projectId: 10, siteId: 72, cardFingerprint: fingerprint, latitude: 30, longitude: 120, idempotencyKey: "field-state-invalid", occurredAt: arrivedAt })).toMatchObject({ success: false, needsReview: true });
    assertNoClosure(state);
  });

  it("现场设备卸土点错误或装土点已有拍照在途时拒绝，不把拍照装土改成刷卡", async () => {
    const state = createMemoryDb();
    state.tables.transport_sites.push({ ...state.tables.transport_sites[1], id: 73 });
    state.tables.transport_reader_devices[0].siteId = 73;
    await expect(caller().scanNfcLink({ token: token(), readerDeviceCode: "UNLOAD-01", idempotencyKey: "wrong-site-original", occurredAt: arrivedAt })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().scanNfcLink({ token: token(), readerDeviceCode: "LOAD-01", idempotencyKey: "load-existing-photo", occurredAt: arrivedAt })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    ["缺少上传凭证", { unloadEvidenceId: 999 }],
    ["凭证项目越界", { unloadEvidenceId: 302 }, "evidence"],
    ["未达最短时间", { occurredAt: "2026-11-03T00:01:00.000Z" }],
    ["超出GPS围栏", { latitude: 31 }],
  ])("NFC开票→photo卸土拒绝%s", async (_label, overrides, change) => {
    const state = createMemoryDb(true, "nfc_card");
    if (change === "evidence") state.tables.evidence_records[1].projectId = 20;
    await expect(caller().confirmPlatePhotoUnload(photoInput(overrides))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    assertNoClosure(state);
    expect(state.writes).toHaveLength(0);
  });

  it("NFC事件条件写入失败不记成功车数或成功短信，不能把失败事件重放为成功", async () => {
    const state = createMemoryDb();
    state.failClosure();
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    assertNoClosure(state);
    await expect(caller().confirmMobileNfcInvoice(unloadInput())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    assertNoClosure(state);
    expect(riskScan).not.toHaveBeenCalled();
  });

  it("已登记但尚未绑定到运单的现场卡事件不能重复返回卸土成功", async () => {
    const state = createMemoryDb();
    const input = { tripId: 51, projectId: 10, siteId: 72, cardFingerprint: fingerprint, latitude: 30, longitude: 120, idempotencyKey: "field-incomplete-replay", occurredAt: arrivedAt };
    await caller().recordUnloadEvent(input);
    state.trip().unloadEventId = null;
    state.trip().unloadConfirmedAt = null;
    const count = state.writes.length;
    await expect(caller().recordUnloadEvent(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.writes).toHaveLength(count);
  });

  it("photo条件写入失败不发布成功结果，失败未绑定事件也不能重放成功", async () => {
    const state = createMemoryDb(true, "nfc_card");
    state.failClosure();
    await expect(caller().confirmPlatePhotoUnload(photoInput())).rejects.toMatchObject({ code: "CONFLICT" });
    assertNoClosure(state);
    await expect(caller().confirmPlatePhotoUnload(photoInput())).rejects.toMatchObject({ code: "CONFLICT" });
    assertNoClosure(state);
    expect(driverNotice).not.toHaveBeenCalled();
  });

  it("幂等键更换GPS或拍照凭证必须冲突，而不是复用其他确认", async () => {
    const state = createMemoryDb();
    await caller().confirmMobileNfcInvoice(unloadInput());
    await expect(caller().confirmMobileNfcInvoice(unloadInput({ longitude: 121 }))).rejects.toMatchObject({ code: "CONFLICT" });
    const photoState = createMemoryDb(true, "nfc_card");
    await caller().confirmPlatePhotoUnload(photoInput());
    await expect(caller().confirmPlatePhotoUnload(photoInput({ unloadEvidenceId: 303 }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(photoState.tables.transport_card_events).toHaveLength(1);
    expect(state.tables.transport_card_events).toHaveLength(1);
  });

  it("兼容历史无车辆锁/无NFC键的拍照在途；多张历史在途拒绝猜测", async () => {
    const state = createMemoryDb();
    state.trip().activeVehicleTransitKey = null;
    expect(await caller().previewMobileNfcInvoice({ token: token() })).toMatchObject({ activeTrip: { id: 51 } });
    state.tables.transport_trips.push({ ...structuredClone(state.trip()), id: 52, tripNo: "TR-HISTORY-52" });
    await expect(caller().previewMobileNfcInvoice({ token: token() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.writes).toHaveLength(0);
  });
});
