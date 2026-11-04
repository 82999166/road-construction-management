import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const mock = vi.hoisted(() => ({
  db: null as any,
  superAdmin: true,
  sms: vi.fn(),
  notice: vi.fn(),
  driverNotice: vi.fn(),
  risk: vi.fn(),
  map: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: async () => {},
  assertProjectInCurrentScope: async (_ctx: unknown, id: number) => {
    if (id !== 10)
      throw new TRPCError({ code: "FORBIDDEN", message: "测试项目越界" });
  },
  getEffectiveRoleCodes: async () => ["TRANSPORT_MANAGER"],
  getSuperAdminAccess: async () => ({ canAccess: mock.superAdmin }),
  hasUserSpecificOperationPermission: async () => true,
  getRoleOperationPermissionDecision: async () => ({
    hasDetailedPermissions: true,
    allowed: true,
    source: "role",
  }),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: mock.notice,
}));
vi.mock("./services/officialAccountDriverBinding", () => ({
  sendOfficialAccountDriverNotification: mock.driverNotice,
}));
vi.mock("./services/smsNotifier", async original => ({
  ...(await original<typeof import("./services/smsNotifier")>()),
  notifyAliyunSmsSafely: mock.sms,
}));
vi.mock("./services/transportNfcSupport", async original => ({
  ...(await original<typeof import("./services/transportNfcSupport")>()),
  triggerTransportRiskScan: mock.risk,
}));
vi.mock("./_core/map", () => ({ makeRequest: mock.map }));
import { transportRouter } from "./routers/operations";
import { buildTransportNfcDeepLink } from "./services/rfidCardPayload";

type Row = Record<string, any>;
const normalize = (value: any): any =>
  value instanceof Date
    ? value.toISOString().slice(0, 23).replace("T", " ")
    : typeof value === "boolean"
      ? Number(value)
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : (value ?? null);

/** Reuses the SqlFixture pattern from vehicleManagement.caller.test.ts and the transport
 * rows from operations.cross-channel-unload.test.ts. Those fixtures are not exported;
 * copying locally avoids importing and re-registering their existing tests or modifying them.
 * SQLite executes emitted Drizzle predicates and ORDER BY; no live DB or external delivery.
 * Defaults, Date/boolean/JSON, undefined writes and conditional affectedRows are preserved. */
class SqlFixture {
  rows: Record<string, Row[]> = {};
  writes: { table: string; values: Row; affectedRows?: number }[] = [];
  sql: string[] = [];
  failNextClosure = false;
  select(projection?: any) {
    return { from: (table: any) => this.query(table, projection) };
  }
  private matches(table: any, condition?: SQL, order: any[] = []) {
    const name = getTableName(table),
      rows = this.rows[name] ?? [];
    const dialect = new MySqlDialect();
    const where = condition
      ? dialect.sqlToQuery(condition)
      : { sql: "1", params: [] };
    const sorting = order.map(value => dialect.sqlToQuery(sql`${value}`));
    const statement = `SELECT __index FROM \`${name}\` WHERE ${where.sql}${sorting.length ? ` ORDER BY ${sorting.map(item => item.sql).join(", ")}` : ""}`;
    this.sql.push(statement);
    const sqlite = new DatabaseSync(":memory:");
    try {
      const columns = [
        ...new Set([
          ...Object.values(getTableColumns(table)).map((col: any) => col.name),
          ...rows.flatMap(row => Object.keys(row)),
        ]),
      ];
      sqlite.exec(
        `CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`
      );
      const insert = sqlite.prepare(
        `INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`
      );
      rows.forEach((row, index) =>
        insert.run(index, ...columns.map(col => normalize(row[col])))
      );
      return sqlite
        .prepare(statement)
        .all(
          ...[...where.params, ...sorting.flatMap(item => item.params)].map(
            normalize
          )
        )
        .map((row: any) => rows[row.__index]);
    } finally {
      sqlite.close();
    }
  }
  private query(table: any, projection?: any) {
    let condition: SQL | undefined,
      limit: number | undefined,
      order: any[] = [];
    const builder: any = {
      where: (value: SQL) => {
        condition = value;
        return builder;
      },
      orderBy: (...values: any[]) => {
        order = values;
        return builder;
      },
      limit: (value: number) => {
        limit = value;
        return builder;
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve()
          .then(() => {
            let rows = this.matches(table, condition, order);
            if (limit !== undefined) rows = rows.slice(0, limit);
            return rows.map(row =>
              structuredClone(
                projection
                  ? Object.fromEntries(
                      Object.entries(projection).map(([key, column]: any) => [
                        key,
                        row[column.name],
                      ])
                    )
                  : row
              )
            );
          })
          .then(resolve, reject),
    };
    return builder;
  }
  insert(table: any) {
    return {
      values: (data: any) => {
        const commit = async () => {
          const name = getTableName(table),
            rows = (this.rows[name] ??= []),
            values = Array.isArray(data) ? data : [data];
          let first = 0;
          for (const input of values) {
            const defaults = Object.fromEntries(
              Object.entries(getTableColumns(table)).map(([key, col]: any) => [
                key,
                col.default instanceof Date ||
                ["string", "boolean", "number"].includes(typeof col.default)
                  ? structuredClone(col.default)
                  : ["createdAt", "updatedAt"].includes(key)
                    ? new Date()
                    : null,
              ])
            );
            const value: Row = {
              ...defaults,
              ...Object.fromEntries(
                Object.entries(input).filter(([, v]) => v !== undefined)
              ),
            };
            if (
              name === "transport_card_events" &&
              rows.some(row => row.idempotencyKey === value.idempotencyKey)
            )
              throw new Error("duplicate idempotencyKey");
            if (
              name === "transport_trips" &&
              rows.some(
                row =>
                  row.tripNo === value.tripNo ||
                  (value.activeVehicleTransitKey &&
                    row.activeVehicleTransitKey ===
                      value.activeVehicleTransitKey)
              )
            )
              throw new Error(
                "transport_trips_project_active_vehicle_transit_unique"
              );
            if ("id" in getTableColumns(table) && value.id == null)
              value.id = Math.max(0, ...rows.map(row => row.id ?? 0)) + 1;
            first ||= Number(value.id);
            rows.push(structuredClone(value));
            this.writes.push({ table: name, values: structuredClone(value) });
          }
          return [{ insertId: first, affectedRows: values.length }];
        };
        return {
          then: (resolve: any, reject: any) => commit().then(resolve, reject),
          onDuplicateKeyUpdate: async () => commit(),
        };
      },
    };
  }
  update(table: any) {
    return {
      set: (patch: Row) => ({
        where: async (condition: SQL) => {
          const rows = this.matches(table, condition),
            values = Object.fromEntries(
              Object.entries(patch).filter(([, value]) => value !== undefined)
            );
          if (getTableName(table) === "transport_trips" && values.unloadConfirmedAt && this.failNextClosure) {
            this.failNextClosure = false;
            return [{ affectedRows: 0 }];
          }
          rows.forEach(row => Object.assign(row, structuredClone(values)));
          this.writes.push({
            table: getTableName(table),
            values: structuredClone(values),
            affectedRows: rows.length,
          });
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
}

const startAt = "2026-11-03T00:00:00.000Z";
const shortAt = "2026-11-03T00:01:00.000Z";
const boundaryAt = "2026-11-03T00:02:00.000Z";
const arrivedAt = "2026-11-03T00:20:00.000Z";
const fingerprint = "a".repeat(64);
const defaultSafety = {
  minimumTransitMinutes: 10,
  minimumTransitEnabled: true,
  unloadGeofenceMeters: 300,
  unloadGeofenceEnabled: true,
};
const combinations = [
  { label: "时间拦截/定位拦截", time: true, gps: true },
  { label: "时间拦截/定位提示", time: true, gps: false },
  { label: "时间提示/定位拦截", time: false, gps: true },
  { label: "时间提示/定位提示", time: false, gps: false },
];
function fixture(withTrip = false, invoiceMode = "nfc_card") {
  const state = new SqlFixture();
  state.rows = {
    users: [{ id: 1, name: "安全设置测试管理员" }],
    transport_vehicles: [
      {
        id: 11,
        projectId: 10,
        status: "active",
        plateNo: "湘A12345",
        driverUserId: 7,
        driverPhoneEncrypted: null,
        boxLengthMeters: "6",
        boxWidthMeters: "2",
        boxHeightMeters: "1",
        loadFactor: "1",
      },
    ],
    transport_vehicle_rfid_cards: [
      {
        id: 21,
        projectId: 10,
        vehicleId: 11,
        status: "active",
        payloadVersion: 1,
        cardUidFingerprint: fingerprint,
      },
    ],
    transport_sites: [
      {
        id: 71,
        projectId: 10,
        siteType: "load",
        status: "active",
        name: "装土区",
        address: "测试装土地址",
        administratorUserId: 1,
        latitude: "30",
        longitude: "120",
        ...defaultSafety,
      },
      {
        id: 72,
        projectId: 10,
        siteType: "unload",
        status: "active",
        name: "卸土区",
        address: "测试卸土地址",
        administratorUserId: 1,
        latitude: "30",
        longitude: "120",
        ...defaultSafety,
      },
    ],
    transport_route_presets: [
      {
        id: 91,
        projectId: 10,
        status: "active",
        loadSiteId: 71,
        unloadSiteId: 72,
        freightRuleId: 12,
        presetDistanceKm: "8",
        isDefault: true,
        unloadOnlyCloseEnabled: false,
        ...defaultSafety,
      },
    ],
    freight_rate_rules: [
      {
        id: 12,
        projectId: 10,
        status: "active",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: null,
        settlementUnit: "cubic_meter",
        startDistanceKm: "0",
        basePricePerUnit: "10",
        stepMeters: 500,
        stepIncreasePerUnit: "0",
      },
    ],
    evidence_records: [
      { id: 302, projectId: 10, sourceType: "transport", sourceId: null },
    ],
    transport_reader_devices: [
      {
        id: 41,
        projectId: 10,
        siteId: 72,
        deviceCode: "UNLOAD-01",
        displayName: "卸土读卡器",
        status: "active",
      },
      {
        id: 42,
        projectId: 10,
        siteId: 71,
        deviceCode: "LOAD-01",
        displayName: "装土读卡器",
        status: "active",
      },
    ],
    transport_trips: withTrip
      ? [
          {
            id: 51,
            tripNo: "TR-51",
            projectId: 10,
            vehicleId: 11,
            invoiceMode,
            status: "submitted",
            startAt: new Date(startAt),
            endAt: null,
            loadSiteId: 71,
            unloadSiteId: 72,
            loadConfirmedAt: new Date(startAt),
            loadConfirmedBy: 1,
            loadEventId: null,
            unloadConfirmedAt: null,
            unloadEventId: null,
            exceptionStatus: "none",
            actualDistanceKm: "8",
            calculatedAmount: "120",
            activeVehicleTransitKey: "vehicle:10:11",
            nfcTransitKey: "nfc:10:21",
            routeSnapshot: {
              routePresetId: 91,
              safetyPolicy: { ...defaultSafety },
            },
          },
        ]
      : [],
    transport_card_events: [],
    audit_logs: [],
    notification_records: [],
    system_settings: [],
    vehicle_fleet_profiles: [],
  };
  mock.db = state;
  return state;
}
function caller() {
  return transportRouter.createCaller({
    user: {
      id: 1,
      openId: "site-safety-behavior",
      name: "安全测试管理员",
      email: null,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {},
    res: {},
  } as TrpcContext);
}
function token() {
  return new URL(
    buildTransportNfcDeepLink({ projectId: 10, cardId: 21, payloadVersion: 1 })
  ).searchParams.get("nfc")!;
}
function siteInput(patch: Row = {}) {
  return {
    id: 72,
    projectId: 10,
    siteType: "unload" as const,
    name: "卸土区",
    address: "测试卸土地址",
    administratorUserId: 1,
    status: "active" as const,
    ...defaultSafety,
    ...patch,
  };
}
function routeInput(patch: Row = {}) {
  return {
    id: 91,
    projectId: 10,
    loadSiteId: 71,
    unloadSiteId: 72,
    freightRuleId: 12,
    presetDistanceKm: 8,
    status: "active" as const,
    isDefault: true,
    unloadOnlyCloseEnabled: false,
    ...defaultSafety,
    ...patch,
  };
}
function scanInput(device = "UNLOAD-01", patch: Row = {}) {
  return {
    projectId: 10,
    readerDeviceCode: device,
    cardFingerprint: fingerprint,
    idempotencyKey: "safety-reader-original",
    latitude: 30,
    longitude: 120,
    occurredAt: arrivedAt,
    ...patch,
  };
}
function photoInput(patch: Row = {}) {
  return {
    tripId: 51,
    projectId: 10,
    unloadEvidenceId: 302,
    idempotencyKey: "safety-photo-original",
    latitude: 30,
    longitude: 120,
    occurredAt: arrivedAt,
    ...patch,
  };
}
function trip(state: SqlFixture) {
  return state.rows.transport_trips.at(-1)!;
}
function event(state: SqlFixture) {
  return state.rows.transport_card_events.at(-1)!;
}
async function setPolicy(
  c: ReturnType<typeof caller>,
  combination: (typeof combinations)[number],
  extra: Row = {}
) {
  await c.saveSite(
    siteInput({
      minimumTransitMinutes: 2,
      minimumTransitEnabled: combination.time,
      unloadGeofenceMeters: 300,
      unloadGeofenceEnabled: combination.gps,
      ...extra,
    })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "site-safety-test-only-signing-secret";
  mock.superAdmin = true;
  mock.sms.mockResolvedValue(undefined);
  mock.notice.mockResolvedValue([]);
  mock.driverNotice.mockResolvedValue(undefined);
  mock.map.mockRejectedValue(new Error("本回归禁止任何地图网络访问"));
});

describe("卸土点安全设置真实保存与实时读取", () => {
  it.each(combinations)(
    "$label：2分钟/5000米保存并完整回读，保留false且隐藏坐标",
    async combination => {
      const state = fixture();
      const c = caller();
      await setPolicy(c, combination, { unloadGeofenceMeters: 5000 });
      const expected = {
        minimumTransitMinutes: 2,
        minimumTransitEnabled: combination.time,
        unloadGeofenceMeters: 5000,
        unloadGeofenceEnabled: combination.gps,
      };
      const sites = await c.listSites({ projectId: 10 });
      expect(sites.find(row => row.id === 72)).toMatchObject({
        ...expected,
        addressResolved: true,
        administratorName: "安全设置测试管理员",
      });
      expect(sites.find(row => row.id === 72)).not.toHaveProperty("latitude");
      expect(sites.find(row => row.id === 72)).not.toHaveProperty("longitude");
      await c.saveRoutePreset(routeInput());
      expect(state.rows.transport_route_presets[0]).toMatchObject(expected);
      expect(await c.listRoutePresets({ projectId: 10 })).toMatchObject([
        { ...expected, safetySource: "unload_site" },
      ]);
      expect(mock.map).not.toHaveBeenCalled();
    }
  );
  it.each(["site", "route"])(
    "%s：两项仅提示也拒绝49000米，任何写入均未发生",
    async target => {
      const state = fixture();
      const patch = {
        minimumTransitMinutes: 2,
        minimumTransitEnabled: false,
        unloadGeofenceMeters: 49000,
        unloadGeofenceEnabled: false,
      };
      await expect(
        target === "site"
          ? caller().saveSite(siteInput(patch))
          : caller().saveRoutePreset(routeInput(patch))
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("5000"),
      });
      expect(state.writes).toHaveLength(0);
    }
  );
  it.each([
    { minimumTransitMinutes: 0 },
    { minimumTransitMinutes: 1441 },
    { minimumTransitMinutes: 1.5 },
    { unloadGeofenceMeters: 29 },
    { unloadGeofenceMeters: 5001 },
    { unloadGeofenceMeters: 30.5 },
  ])("仅提示不跳过数值契约：%j", async patch => {
    const state = fixture();
    await expect(
      caller().saveSite(
        siteInput({
          minimumTransitEnabled: false,
          unloadGeofenceEnabled: false,
          ...patch,
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.writes).toHaveLength(0);
  });
  it.each([
    { minimumTransitMinutes: 1, unloadGeofenceMeters: 30 },
    { minimumTransitMinutes: 1440, unloadGeofenceMeters: 5000 },
  ])("包含边界：%j", async patch => {
    fixture();
    await expect(caller().saveSite(siteInput(patch))).resolves.toMatchObject({
      success: true,
    });
  });
  it("非超级管理员只能保留卸土点原安全配置，不得修改开关", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3]);
    mock.superAdmin = false;
    await expect(
      c.saveSite(
        siteInput({
          minimumTransitMinutes: 2,
          minimumTransitEnabled: false,
          unloadGeofenceEnabled: false,
          name: "改名卸土区",
        })
      )
    ).resolves.toMatchObject({ success: true });
    const count = state.writes.length;
    await expect(c.saveSite(siteInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(state.writes).toHaveLength(count);
  });
  it("同一caller重复读取和已开运单卸土采用saveSite最新值，不用旧路线/运单快照", async () => {
    const state = fixture(true);
    const c = caller();
    expect(await c.listRoutePresets({ projectId: 10 })).toMatchObject([
      { ...defaultSafety },
    ]);
    await setPolicy(c, combinations[3]);
    expect(state.rows.transport_route_presets[0]).toMatchObject(defaultSafety);
    expect(await c.listRoutePresets({ projectId: 10 })).toMatchObject([
      {
        minimumTransitMinutes: 2,
        minimumTransitEnabled: false,
        unloadGeofenceEnabled: false,
      },
    ]);
    await expect(
      c.confirmMobileNfcInvoice({
        token: token(),
        expectedUnloadTripId: 51,
        idempotencyKey: "latest-policy-unload",
        occurredAt: shortAt,
      })
    ).resolves.toMatchObject({ success: true, stage: "completed" });
    expect(trip(state)).toMatchObject({
      exceptionStatus: "open",
      activeVehicleTransitKey: null,
      routeSnapshot: {
        safetyPolicy: {
          minimumTransitMinutes: 2,
          minimumTransitEnabled: false,
          unloadGeofenceEnabled: false,
        },
      },
    });
    expect(event(state).validationReason).toContain("最短运输时间拦截已关闭");
    expect(event(state).validationReason).toContain("定位范围拦截已关闭");
  });
  it("从提示切到拦截立即影响同一caller下一次卸土，路线旧提示不能覆盖地点", async () => {
    const state = fixture(true);
    const c = caller();
    Object.assign(state.rows.transport_route_presets[0], {
      minimumTransitMinutes: 1,
      minimumTransitEnabled: false,
      unloadGeofenceEnabled: false,
    });
    await setPolicy(c, combinations[0]);
    await expect(
      c.confirmMobileNfcInvoice({
        token: token(),
        expectedUnloadTripId: 51,
        idempotencyKey: "latest-hard-unload",
        latitude: 30,
        longitude: 120,
        occurredAt: shortAt,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(trip(state).unloadConfirmedAt).toBeNull();
  });
  it("saveRoutePreset审计描述实际保存的地点权威参数而非请求旧参数", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3], { unloadGeofenceMeters: 5000 });
    await c.saveRoutePreset(routeInput());
    expect(state.rows.transport_route_presets[0]).toMatchObject({
      minimumTransitMinutes: 2,
      minimumTransitEnabled: false,
      unloadGeofenceMeters: 5000,
      unloadGeofenceEnabled: false,
    });
    expect(state.rows.audit_logs.at(-1).summary).toContain(
      "最短 2 分钟（提示）"
    );
    expect(state.rows.audit_logs.at(-1).summary).toContain(
      "卸土容差 5000 米（提示）"
    );
  });
  it("超级管理员仅维护名称并省略安全字段完整保留2分钟/300米/双提示", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3]);
    await c.saveSite({
      id: 72,
      projectId: 10,
      siteType: "unload",
      name: "仅改名称",
      address: "测试卸土地址",
      administratorUserId: 1,
      status: "active",
    });
    expect(state.rows.transport_sites[1]).toMatchObject({
      name: "仅改名称",
      minimumTransitMinutes: 2,
      minimumTransitEnabled: false,
      unloadGeofenceMeters: 300,
      unloadGeofenceEnabled: false,
    });
    expect(state.rows.audit_logs.at(-1).summary).toContain("最短 2 分钟（仅提示）");
  });
  it("非超级管理员省略安全字段可维护自定义卸土点且不改安全策略", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3]);
    mock.superAdmin = false;
    await expect(
      c.saveSite({
        id: 72,
        projectId: 10,
        siteType: "unload",
        name: "仅改名称",
        address: "测试卸土地址",
        administratorUserId: 1,
        status: "active",
      })
    ).resolves.toMatchObject({ success: true });
    expect(state.rows.transport_sites[1]).toMatchObject({
      name: "仅改名称",
      minimumTransitMinutes: 2,
      minimumTransitEnabled: false,
      unloadGeofenceEnabled: false,
    });
  });
});

describe.each(combinations)("NFC双刷 $label", combination => {
  it.each([
    {
      label: "仅时间不足",
      at: shortAt,
      latitude: 30,
      longitude: 120,
      short: true,
      outside: false,
    },
    {
      label: "仅定位超界",
      at: arrivedAt,
      latitude: 31,
      longitude: 120,
      short: false,
      outside: true,
    },
    {
      label: "时间不足且定位超界",
      at: shortAt,
      latitude: 31,
      longitude: 120,
      short: true,
      outside: true,
    },
    {
      label: "没有手机定位",
      at: arrivedAt,
      latitude: undefined,
      longitude: undefined,
      short: false,
      outside: true,
    },
  ])("$label：独立拦截或放行留痕", async scenario => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combination);
    await expect(
      c.scanNfcReader(
        scanInput("LOAD-01", {
          idempotencyKey: "double-load-original",
          occurredAt: startAt,
          latitude: undefined,
          longitude: undefined,
        })
      )
    ).resolves.toMatchObject({
      success: true,
      stage: "in_transit",
      singleScanClosed: false,
    });
    const result = await c.scanNfcReader(
      scanInput("UNLOAD-01", {
        occurredAt: scenario.at,
        latitude: scenario.latitude,
        longitude: scenario.longitude,
      })
    );
    const blocked =
      (scenario.short && combination.time) ||
      (scenario.outside && combination.gps);
    expect(result).toMatchObject({ success: !blocked, needsReview: blocked });
    expect(event(state).validationStatus).toBe(
      blocked ? "needs_review" : "accepted"
    );
    if (blocked) expect(trip(state).unloadConfirmedAt).toBeNull();
    else
      expect(trip(state)).toMatchObject({
        unloadConfirmedAt: new Date(scenario.at),
        activeVehicleTransitKey: null,
        exceptionStatus: "open",
      });
    expect(state.rows.transport_trips).toHaveLength(1);
  });
  it("达到2分钟且在围栏内均能完成，无异常；2分钟边界包含", async () => {
    const state = fixture(true);
    const c = caller();
    await setPolicy(c, combination);
    const result = await c.recordUnloadEvent({
      tripId: 51,
      projectId: 10,
      siteId: 72,
      cardFingerprint: fingerprint,
      idempotencyKey: "boundary-unload-original",
      latitude: 30,
      longitude: 120,
      occurredAt: boundaryAt,
    });
    expect(result).toMatchObject({ success: true, needsReview: false });
    expect(trip(state).exceptionStatus).toBe("none");
  });
});

describe.each(combinations)("全局NFC单次闭环 $label", combination => {
  it.each(["reader", "link", "mobile"])(
    "%s：首笔无GPS完成特殊闭环，连续开票始终按地点2分钟硬拦截",
    async channel => {
      const state = fixture();
      const c = caller();
      await setPolicy(c, combination);
      await c.setNfcSingleScanCloseSetting({ projectId: 10, enabled: true });
      expect(
        await c.getNfcSingleScanCloseSetting({ projectId: 10 })
      ).toMatchObject({ enabled: true });
      const run = (at: string, key: string) =>
        channel === "mobile"
          ? c.confirmMobileNfcInvoice({
              token: token(),
              routePresetId: 91,
              idempotencyKey: key,
              occurredAt: at,
            })
          : channel === "link"
            ? c.scanNfcLink({
                token: token(),
                readerDeviceCode: "LOAD-01",
                idempotencyKey: key,
                occurredAt: at,
              })
            : c.scanNfcReader(
                scanInput("LOAD-01", {
                  occurredAt: at,
                  idempotencyKey: key,
                  latitude: undefined,
                  longitude: undefined,
                })
              );
      await expect(
        run(startAt, "single-first-original")
      ).resolves.toMatchObject({
        success: true,
        stage: "completed",
        singleScanClosed: true,
      });
      expect(trip(state)).toMatchObject({
        endAt: new Date(startAt),
        unloadEventId: null,
        unloadConfirmedBy: null,
        activeVehicleTransitKey: null,
        routeSnapshot: { nfcSingleScanClosed: true },
      });
      expect(
        state.rows.transport_card_events.map(row => row.eventType)
      ).toEqual(["load"]);
      const count = state.writes.length;
      await expect(run(shortAt, "single-short-original")).rejects.toMatchObject(
        {
          code: "BAD_REQUEST",
          message: expect.stringContaining("最小间隔 2 分钟"),
        }
      );
      expect(state.writes).toHaveLength(count);
      await expect(
        run(boundaryAt, "single-boundary-original")
      ).resolves.toMatchObject({ success: true, singleScanClosed: true });
      expect(state.rows.transport_trips).toHaveLength(2);
    }
  );
});

describe.each(combinations)("路线卸土补刷 $label", combination => {
  it("首笔没有上一笔运输不伪造时间，GPS通过即可受控闭环", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combination);
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    await expect(
      c.scanNfcReader(scanInput("UNLOAD-01", { occurredAt: startAt }))
    ).resolves.toMatchObject({
      success: true,
      unloadOnlyClosed: true,
      stage: "completed",
    });
    expect(trip(state)).toMatchObject({
      loadConfirmedAt: null,
      loadEventId: null,
      unloadConfirmedAt: new Date(startAt),
      status: "submitted",
      routeSnapshot: { unloadOnlyCardClose: true, loadCardRecorded: false },
    });
    expect(state.rows.transport_card_events.map(row => row.eventType)).toEqual([
      "unload",
    ]);
  });
  it("距上一笔结束1分钟且定位超界时按各自开关组合执行", async () => {
    const state = fixture(true);
    const c = caller();
    Object.assign(trip(state), {
      unloadConfirmedAt: new Date(startAt),
      endAt: new Date(startAt),
      activeVehicleTransitKey: null,
      nfcTransitKey: null,
    });
    await setPolicy(c, combination);
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    const count = state.writes.length;
    const result = c.scanNfcReader(
      scanInput("UNLOAD-01", { occurredAt: shortAt, latitude: 31 })
    );
    if (combination.time) {
      await expect(result).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("间隔拦截"),
      });
      expect(state.writes).toHaveLength(count);
      expect(state.rows.transport_trips).toHaveLength(1);
    } else {
      await expect(result).resolves.toMatchObject({
        success: !combination.gps,
        needsReview: combination.gps,
        unloadOnlyClosed: !combination.gps,
      });
      expect(state.rows.transport_trips).toHaveLength(2);
      if (!combination.gps) {
        expect(trip(state)).toMatchObject({
          exceptionStatus: "open",
          loadConfirmedAt: null,
          activeVehicleTransitKey: null,
        });
        expect(event(state).validationReason).toContain("同车连续间隔");
        expect(event(state).validationReason).toContain("定位范围拦截已关闭");
      } else expect(trip(state).unloadConfirmedAt).toBeNull();
    }
  });
});

describe("卸土补刷保护及异常重试恢复", () => {
  it("路线默认关闭，即使两项仅提示也不能无在途直接补刷", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3]);
    const count = state.writes.length;
    await expect(c.scanNfcReader(scanInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("未开启"),
    });
    expect(state.writes).toHaveLength(count);
  });
  it("多条启用补刷路线拒绝猜测，按吨路线拒绝自动闭环", async () => {
    const state = fixture();
    const c = caller();
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    state.rows.transport_route_presets.push({
      ...state.rows.transport_route_presets[0],
      id: 92,
    });
    await expect(c.scanNfcReader(scanInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("多条"),
    });
    state.rows.transport_route_presets.pop();
    state.rows.freight_rate_rules[0].settlementUnit = "ton";
    await expect(c.scanNfcReader(scanInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("过磅"),
    });
    expect(state.rows.transport_trips).toHaveLength(0);
  });
  it("补刷围栏失败后保留无装土在途，GPS恢复后新刷卡受控恢复同一运单", async () => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[2]);
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    await expect(
      c.scanNfcReader(
        scanInput("UNLOAD-01", { latitude: 31, occurredAt: startAt })
      )
    ).resolves.toMatchObject({
      success: false,
      needsReview: true,
      unloadOnlyClosed: false,
    });
    expect(trip(state)).toMatchObject({
      loadConfirmedAt: null,
      unloadConfirmedAt: null,
      activeVehicleTransitKey: "vehicle:10:11",
      routeSnapshot: { unloadOnlyCardClose: true },
    });
    await expect(
      c.scanNfcReader(
        scanInput("UNLOAD-01", {
          idempotencyKey: "unload-only-recovered",
          occurredAt: arrivedAt,
        })
      )
    ).resolves.toMatchObject({
      success: true,
      needsReview: false,
      unloadOnlyClosed: true,
    });
    expect(state.rows.transport_trips).toHaveLength(1);
    expect(trip(state)).toMatchObject({
      unloadConfirmedAt: new Date(arrivedAt),
      loadConfirmedAt: null,
      loadEventId: null,
      activeVehicleTransitKey: null,
      nfcTransitKey: null,
      exceptionStatus: "open",
      routeSnapshot: { unloadOnlyCardClosedAt: arrivedAt },
    });
  });
});

describe.each(combinations)("拍照卸土 $label", combination => {
  it.each([
    {
      label: "仅时间不足",
      at: shortAt,
      latitude: 30,
      short: true,
      outside: false,
    },
    {
      label: "仅定位超界",
      at: arrivedAt,
      latitude: 31,
      short: false,
      outside: true,
    },
    {
      label: "时间不足且定位超界",
      at: shortAt,
      latitude: 31,
      short: true,
      outside: true,
    },
  ])("$label：有坐标时各硬拦截开关实际生效", async scenario => {
    const state = fixture(true);
    const c = caller();
    await setPolicy(c, combination);
    const count = state.writes.length;
    const result = c.confirmPlatePhotoUnload(
      photoInput({ occurredAt: scenario.at, latitude: scenario.latitude })
    );
    const blocked =
      (scenario.short && combination.time) ||
      (scenario.outside && combination.gps);
    if (blocked) {
      await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(state.writes).toHaveLength(count);
      expect(trip(state).unloadConfirmedAt).toBeNull();
    } else {
      await expect(result).resolves.toMatchObject({
        success: true,
        needsReview: true,
      });
      expect(trip(state).activeVehicleTransitKey).toBeNull();
      expect(trip(state).exceptionStatus).toBe("open");
    }
  });
});

describe("拍照仅提示与NFC统一安全留痕", () => {
  it("拍照两项仅提示放行时间/GPS异常并保留警告、异常与有效闭环", async () => {
    const state = fixture(true);
    const c = caller();
    await setPolicy(c, combinations[3]);
    await expect(
      c.confirmPlatePhotoUnload(
        photoInput({ occurredAt: shortAt, latitude: 31 })
      )
    ).resolves.toMatchObject({ success: true, needsReview: true });
    expect(trip(state).exceptionStatus).toBe("open");
    expect(event(state).validationReason).toContain("NFC 刷卡票据拍照卸土现场确认");
    expect(event(state).validationReason).toContain("最短运输时间拦截已关闭");
    expect(event(state).validationReason).toContain("定位范围拦截已关闭");
    expect(event(state).validationStatus).toBe("accepted");
  });
  it("定位仅提示且地点坐标未解析：拍照可完成并留提示，NFC重试不重写闭环", async () => {
    const state = fixture(true);
    const c = caller();
    await setPolicy(c, combinations[3]);
    Object.assign(state.rows.transport_sites[1], {
      latitude: null,
      longitude: null,
    });
    await expect(c.confirmPlatePhotoUnload(photoInput())).resolves.toMatchObject(
      { success: true, needsReview: true, reason: expect.stringContaining("地图定位校验") }
    );
    await expect(
      c.recordUnloadEvent({
        tripId: 51,
        projectId: 10,
        siteId: 72,
        cardFingerprint: fingerprint,
        idempotencyKey: "nfc-no-site-coordinate",
        latitude: 30,
        longitude: 120,
        occurredAt: arrivedAt,
      })
    ).resolves.toMatchObject({ success: true, duplicate: true });
    expect(event(state).validationReason).toContain("定位范围拦截已关闭");
  });
  it("定位仅提示且无手机GPS：拍照可放行留提示，NFC重试不重写闭环", async () => {
    const state = fixture(true);
    const c = caller();
    await setPolicy(c, combinations[3]);
    await expect(
      c.confirmPlatePhotoUnload(
        photoInput({ latitude: undefined, longitude: undefined })
      )
    ).resolves.toMatchObject({ success: true, needsReview: true });
    await expect(
      c.recordUnloadEvent({
        tripId: 51,
        projectId: 10,
        siteId: 72,
        cardFingerprint: fingerprint,
        idempotencyKey: "nfc-no-mobile-coordinate",
        occurredAt: arrivedAt,
      })
    ).resolves.toMatchObject({ success: true, duplicate: true });
    expect(event(state).validationReason).toContain("未取得现场定位");
    expect(trip(state).exceptionStatus).toBe("open");
  });
});

async function createFailedUnloadOnly(state: SqlFixture, c: ReturnType<typeof caller>) {
  await setPolicy(c, combinations[2]);
  await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
  const result = await c.scanNfcReader(scanInput("UNLOAD-01", { latitude: 31, occurredAt: startAt }));
  expect(result).toMatchObject({ success: false, needsReview: true, stage: "in_transit" });
  return trip(state).id as number;
}

describe("修复后省略字段与权限保护", () => {
  it.each([true, false])("超级管理员=%s：仅名称编辑保留地址、坐标、管理员、禁用状态及安全策略", async superAdmin => {
    const state = fixture();
    const c = caller();
    await setPolicy(c, combinations[3], { unloadGeofenceMeters: 5000 });
    state.rows.transport_sites[1].status = "disabled";
    mock.superAdmin = superAdmin;
    await c.saveSite({ id: 72, projectId: 10, siteType: "unload", name: "仅名称新值" });
    expect(state.rows.transport_sites[1]).toMatchObject({
      name: "仅名称新值", address: "测试卸土地址", latitude: "30", longitude: "120",
      administratorUserId: 1, status: "disabled", minimumTransitMinutes: 2,
      minimumTransitEnabled: false, unloadGeofenceMeters: 5000, unloadGeofenceEnabled: false,
    });
    expect(mock.map).not.toHaveBeenCalled();
  });
  it("超级管理员仅修改一项阈值，其他三个字段保留", async () => {
    const state = fixture(); const c = caller();
    await setPolicy(c, combinations[3], { unloadGeofenceMeters: 5000 });
    await c.saveSite({ id: 72, projectId: 10, siteType: "unload", name: "卸土区", minimumTransitMinutes: 3 });
    expect(state.rows.transport_sites[1]).toMatchObject({ minimumTransitMinutes: 3, minimumTransitEnabled: false, unloadGeofenceMeters: 5000, unloadGeofenceEnabled: false });
  });
  it.each(["unload", "load"] as const)("非超级管理员不能借%s类型更改安全字段", async siteType => {
    const state = fixture(); mock.superAdmin = false;
    await expect(caller().saveSite({ id: 72, projectId: 10, siteType, name: "运输地点", minimumTransitEnabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.writes).toHaveLength(0);
  });
  it("新建省略字段仍使用10分钟/300米/双拦截默认值", async () => {
    const state = fixture(); mock.superAdmin = false;
    await caller().saveSite({ projectId: 10, siteType: "unload", name: "新卸土点" });
    expect(state.rows.transport_sites.at(-1)).toMatchObject({ ...defaultSafety, status: "active" });
  });
});

describe("修复后拍照定位、幂等与核验保护", () => {
  it.each([
    { label: "省略", latitude: undefined, longitude: undefined },
    { label: "双null", latitude: null, longitude: null },
    { label: "单坐标", latitude: 30, longitude: null },
  ])("$label坐标：定位拦截开启服务端仍拒绝且无写入", async coordinates => {
    const state = fixture(true);
    await expect(caller().confirmPlatePhotoUnload(photoInput(coordinates))).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("未取得现场定位") });
    expect(state.writes).toHaveLength(0);
    expect(trip(state).activeVehicleTransitKey).toBe("vehicle:10:11");
  });
  it.each(["nfc_card", "plate_photo"])("%s拍照提示完成闭环：相同/新键重试保留警告不重复写入，变更GPS冲突", async invoiceMode => {
    const state = fixture(true, invoiceMode); const c = caller();
    await setPolicy(c, combinations[3]);
    const input = photoInput({ occurredAt: shortAt, latitude: null, longitude: null });
    const result = await c.confirmPlatePhotoUnload(input);
    expect(result).toMatchObject({ success: true, duplicate: false, needsReview: true, reason: expect.stringContaining("未取得现场定位") });
    expect(result.safetyNotices).toHaveLength(2);
    expect(trip(state)).toMatchObject({ status: "submitted", exceptionStatus: "open", activeVehicleTransitKey: null, nfcTransitKey: null, routeSnapshot: { endLatitude: null, endLongitude: null, unloadSafetyNotices: result.safetyNotices } });
    expect(event(state)).toMatchObject({ validationStatus: "accepted", latitude: null, longitude: null });
    const count = state.writes.length;
    expect(await c.confirmPlatePhotoUnload(input)).toMatchObject({ success: true, duplicate: true, needsReview: true, safetyNotices: result.safetyNotices });
    expect(await c.confirmPlatePhotoUnload({ ...input, idempotencyKey: "photo-new-replay-key" })).toMatchObject({ success: true, duplicate: true, needsReview: true, reason: result.reason });
    await expect(c.confirmPlatePhotoUnload({ ...input, latitude: 30, longitude: 120 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.writes).toHaveLength(count);
    expect(state.rows.transport_card_events).toHaveLength(1);
  });
  it("正常拍照返回空警告且不主动改变异常状态", async () => {
    const state = fixture(true);
    expect(await caller().confirmPlatePhotoUnload(photoInput())).toMatchObject({ success: true, needsReview: false, reason: null, safetyNotices: [] });
    expect(trip(state)).toMatchObject({ exceptionStatus: "none", status: "submitted" });
  });
  it("仅提示不减弱照片凭证必填与项目校验", async () => {
    const state = fixture(true); const c = caller(); await setPolicy(c, combinations[3]);
    const count = state.writes.length;
    await expect(c.confirmPlatePhotoUnload(photoInput({ unloadEvidenceId: 999, latitude: null, longitude: null }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.writes).toHaveLength(count);
    expect(trip(state).unloadConfirmedAt).toBeNull();
  });
  it("条件闭环锁失败不返回成功，且已插入未绑定事件重试仍冲突", async () => {
    const state = fixture(true); const c = caller(); await setPolicy(c, combinations[3]);
    state.failNextClosure = true;
    const input = photoInput({ latitude: null, longitude: null });
    await expect(c.confirmPlatePhotoUnload(input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(c.confirmPlatePhotoUnload(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(trip(state).unloadConfirmedAt).toBeNull();
    expect(trip(state).activeVehicleTransitKey).toBe("vehicle:10:11");
    expect(state.rows.notification_records).toHaveLength(0);
  });
  it("提示警告不能直接核验：主管必须填写核对依据，审核前不产生付款事实", async () => {
    const state = fixture(true); const c = caller();
    state.rows.transport_card_events.push({ id: 100, tripId: 51, projectId: 10, eventType: "load", validationStatus: "accepted" });
    trip(state).loadEventId = 100;
    Object.assign(state.rows.evidence_records[0], { status: "active", mimeType: "image/jpeg" });
    await setPolicy(c, combinations[3]);
    await c.confirmPlatePhotoUnload(photoInput({ latitude: null, longitude: null }));
    await expect(c.transitionTrip({ id: 51, projectId: 10, nextStatus: "verified" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("核对依据") });
    expect(trip(state).status).toBe("submitted");
    await expect(c.transitionTrip({ id: 51, projectId: 10, nextStatus: "verified", reviewRemarks: "已现场核对照片与实际运输" })).resolves.toMatchObject({ success: true });
    expect(trip(state)).toMatchObject({ status: "verified", exceptionStatus: "resolved" });
    expect(state.rows.transport_vehicle_settlements ?? []).toHaveLength(0);
    expect(state.rows.payment_records ?? []).toHaveLength(0);
  });
});

describe("修复后补刷重试只恢复真实服务器特殊运单", () => {
  it.each(["reader", "link", "mobile"])("%s恢复同一运单并保留空装土事实，成功幂等重试不再开下一趟", async channel => {
    const state = fixture(); const c = caller(); const id = await createFailedUnloadOnly(state, c);
    const run = () => channel === "mobile"
      ? c.confirmMobileNfcInvoice({ token: token(), expectedUnloadTripId: id, idempotencyKey: "special-mobile-recovered", latitude: 30, longitude: 120, occurredAt: arrivedAt })
      : channel === "link"
        ? c.scanNfcLink({ token: token(), readerDeviceCode: "UNLOAD-01", idempotencyKey: "special-link-recovered", latitude: 30, longitude: 120, occurredAt: arrivedAt })
        : c.scanNfcReader(scanInput("UNLOAD-01", { idempotencyKey: "special-reader-recovered", occurredAt: arrivedAt }));
    expect(await run()).toMatchObject({ success: true, unloadOnlyClosed: true, stage: "completed" });
    const count = state.writes.length;
    expect(await run()).toMatchObject({ success: true, duplicate: true });
    expect(state.writes).toHaveLength(count);
    expect(state.rows.transport_trips).toHaveLength(1);
    expect(trip(state)).toMatchObject({ id, loadConfirmedAt: null, loadEventId: null, unloadConfirmedAt: new Date(arrivedAt), activeVehicleTransitKey: null, nfcTransitKey: null, exceptionStatus: "open" });
    expect(state.rows.transport_card_events.map(row => row.eventType)).toEqual(["unload", "unload"]);
  });
  it.each([
    { label: "路线关闭", change: (s: SqlFixture) => { s.rows.transport_route_presets[0].unloadOnlyCloseEnabled = false; } },
    { label: "路线停用", change: (s: SqlFixture) => { s.rows.transport_route_presets[0].status = "disabled"; } },
    { label: "装土点停用", change: (s: SqlFixture) => { s.rows.transport_sites[0].status = "disabled"; } },
    { label: "运价改吨", change: (s: SqlFixture) => { s.rows.freight_rate_rules[0].settlementUnit = "ton"; } },
    { label: "锁异常", change: (s: SqlFixture) => { trip(s).activeVehicleTransitKey = "vehicle:10:99"; } },
  ])("$label：GPS恢复不能绕开特殊配置复核", async scenario => {
    const state = fixture(); const c = caller(); await createFailedUnloadOnly(state, c); scenario.change(state);
    expect(await c.scanNfcReader(scanInput("UNLOAD-01", { idempotencyKey: `invalid-special-${scenario.label}`, occurredAt: arrivedAt }))).toMatchObject({ success: false, needsReview: true, stage: "in_transit", reason: expect.stringContaining("配置已失效") });
    expect(trip(state).unloadConfirmedAt).toBeNull();
    expect(state.rows.transport_trips).toHaveLength(1);
  });
  it("仅客户端传unloadOnlyClose不能给普通无装土运单授予特殊权限", async () => {
    const state = fixture(true); const c = caller();
    Object.assign(trip(state), { loadConfirmedAt: null, loadEventId: null });
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    expect(await c.recordUnloadEvent({ tripId: 51, projectId: 10, siteId: 72, cardFingerprint: fingerprint, idempotencyKey: "forged-unload-option", latitude: 30, longitude: 120, occurredAt: arrivedAt, unloadOnlyClose: true } as any)).toMatchObject({ success: false, needsReview: true, reason: expect.stringContaining("早于装土确认") });
    expect(trip(state).unloadConfirmedAt).toBeNull();
  });
  it("新启用时间拦截会在GPS恢复重试时重新限制同车连续间隔", async () => {
    const state = fixture(true); const c = caller();
    Object.assign(trip(state), { unloadConfirmedAt: new Date(startAt), endAt: new Date(startAt), activeVehicleTransitKey: null, nfcTransitKey: null });
    await setPolicy(c, combinations[2]);
    await c.saveRoutePreset(routeInput({ unloadOnlyCloseEnabled: true }));
    expect(await c.scanNfcReader(scanInput("UNLOAD-01", { occurredAt: shortAt, latitude: 31 }))).toMatchObject({ success: false, needsReview: true });
    await setPolicy(c, combinations[0], { minimumTransitMinutes: 30 });
    expect(await c.scanNfcReader(scanInput("UNLOAD-01", { occurredAt: arrivedAt, idempotencyKey: "retry-enforced-interval" }))).toMatchObject({ success: false, needsReview: true, reason: expect.stringContaining("间隔拦截") });
    expect(trip(state).unloadConfirmedAt).toBeNull();
    expect(trip(state).loadConfirmedAt).toBeNull();
  });
  it("另一辆车或错误卸土地点不能恢复目标特殊运单", async () => {
    const state = fixture(); const c = caller(); const id = await createFailedUnloadOnly(state, c);
    state.rows.transport_vehicles.push({ ...state.rows.transport_vehicles[0], id: 12, plateNo: "湘A99999" });
    state.rows.transport_vehicle_rfid_cards.push({ ...state.rows.transport_vehicle_rfid_cards[0], id: 22, vehicleId: 12, cardUidFingerprint: "b".repeat(64) });
    expect(await c.recordUnloadEvent({ tripId: id, projectId: 10, siteId: 72, cardFingerprint: "b".repeat(64), idempotencyKey: "other-vehicle-retry", latitude: 30, longitude: 120, occurredAt: arrivedAt })).toMatchObject({ success: false, needsReview: true });
    state.rows.transport_sites.push({ ...state.rows.transport_sites[1], id: 73 });
    state.rows.transport_reader_devices[0].siteId = 73;
    await expect(c.scanNfcReader(scanInput("UNLOAD-01", { idempotencyKey: "wrong-unload-site-retry" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(trip(state).unloadConfirmedAt).toBeNull();
    expect(trip(state).loadConfirmedAt).toBeNull();
  });
});
