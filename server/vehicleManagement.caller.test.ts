import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mock = vi.hoisted(() => ({
  db: null as any,
  roles: ["TRANSPORT_MANAGER"],
  permissions: ["read", "edit", "create", "export", "review", "manage"],
  projectIds: [1, 2],
  superAdmin: false,
  accessChecks: [] as string[],
  storagePut: vi.fn(async (key: string, _bytes: string, _mime: string) => ({
    key,
    url: "/never-public",
  })),
}));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  getEffectiveRoleCodes: async () => mock.roles,
  getSuperAdminAccess: async () => ({ canAccess: mock.superAdmin }),
  assertDepartmentBusinessAccess: async (
    _ctx: unknown,
    module: string,
    action = "read"
  ) => {
    mock.accessChecks.push(`${module}:${action}`);
    if (module !== "TRANSPORT" || !mock.permissions.includes(action))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `缺少${module}:${action}权限`,
      });
  },
  getDepartmentModuleDataScope: async () => ({
    hasAllProjects: false,
    projectIds: mock.projectIds,
  }),
  getCurrentDataScope: async () => ({
    hasAllProjects: false,
    projectIds: mock.projectIds,
  }),
  assertProjectInCurrentScope: async (_ctx: unknown, projectId: number) => {
    if (!mock.projectIds.includes(projectId))
      throw new TRPCError({ code: "FORBIDDEN", message: "未授权项目" });
  },
  getRoleOperationPermissionDecision: async (
    _ctx: unknown,
    _module: string,
    action: string
  ) => ({ allowed: mock.permissions.includes(action), source: "role" }),
  hasUserSpecificOperationPermission: async (
    _ctx: unknown,
    _module: string,
    action: string
  ) => mock.permissions.includes(action),
}));
vi.mock("./storage", () => ({
  storagePut: mock.storagePut,
  storageGetSignedUrl: async () => {
    throw new Error("测试禁止存储网络访问");
  },
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: async () => {},
}));
vi.mock("./services/officialAccountDriverBinding", () => ({
  sendOfficialAccountDriverNotification: async () => {},
}));
vi.mock("./services/transportRisk", () => ({
  triggerTransportRiskScan: async () => {},
}));
vi.mock("./services/smsNotifier", () => ({
  formatChinaSmsTime: () => "测试时间",
  notifyAliyunSmsSafely: async () => {},
}));
import { vehicleManagementRouter } from "./routers/vehicleManagement";
import { transportRouter } from "./routers/operations";
import { decryptSecret } from "./services/secretVault";

const time = new Date("2026-11-04T02:00:00Z");
const earlier = new Date("2026-11-03T02:00:00Z");
const normalize = (value: any): any =>
  value instanceof Date
    ? value.toISOString().slice(0, 23).replace("T", " ")
    : typeof value === "boolean"
      ? Number(value)
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : (value ?? null);
/** All Drizzle AND/OR/NULL/range/CAS predicates are executed by SQLite, not mocked true.
 * Rows preserve Date/boolean/JSON types; schema defaults and undefined writes match Drizzle.
 * Serialized rollback transactions and injected write failures never touch the application DB. */
class SqlFixture {
  rows: Record<string, any[]> = {
    projects: [
      { id: 1, status: "active" },
      { id: 2, status: "active" },
      { id: 3, status: "active" },
    ],
    users: [
      { id: 1, name: "运输办理人" },
      { id: 2, name: "独立复核人" },
      { id: 10, name: "旧司机" },
      { id: 11, name: "新司机" },
    ],
    transport_vehicles: [
      {
        id: 1,
        projectId: 1,
        status: "active",
        ownership: "leased",
        vehicleType: "dump_truck",
        plateNo: "湘A12345",
        driverPersonId: null,
        driverUserId: null,
        createdAt: earlier,
        updatedAt: earlier,
        boxLengthMeters: "5",
        boxWidthMeters: "2",
        boxHeightMeters: "1",
        loadFactor: "1",
      },
    ],
    vehicle_fleet_profiles: [
      {
        vehicleId: 1,
        projectId: 1,
        version: 0,
        propertyType: "rented",
        settlementMode: "monthly",
        purpose: "general",
        technicalStatus: "normal",
        dispatchStatus: "working",
        projectStatus: "on_site",
        archived: false,
        trailerVehicleId: null,
        createdBy: 1,
        updatedBy: 1,
      },
    ],
  };
  private gate = Promise.resolve();
  beforeTransaction?: () => void;
  failInsertTable?: string;
  zeroVersionWrite = false;
  locks: string[] = [];
  sql: string[] = [];
  select(projection?: any) {
    return { from: (table: any) => this.query(table, projection) };
  }
  private matches(table: any, condition?: SQL) {
    const name = getTableName(table),
      rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const query = new MySqlDialect().sqlToQuery(condition);
    this.sql.push(query.sql);
    const sqlite = new DatabaseSync(":memory:");
    try {
      const columns = [
        ...new Set([
          ...Object.values(getTableColumns(table)).map((c: any) => c.name),
          ...rows.flatMap(row => Object.keys(row)),
        ]),
      ];
      sqlite.exec(
        `CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`
      );
      const insert = sqlite.prepare(
        `INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`
      );
      rows.forEach((row, i) =>
        insert.run(i, ...columns.map(col => normalize(row[col])))
      );
      return sqlite
        .prepare(`SELECT __index FROM \`${name}\` WHERE ${query.sql}`)
        .all(...query.params.map(normalize))
        .map((row: any) => rows[row.__index]);
    } finally {
      sqlite.close();
    }
  }
  private query(table: any, projection?: any) {
    let condition: SQL | undefined, limit: number | undefined;
    const builder: any = {
      where: (sql: SQL) => {
        condition = sql;
        return builder;
      },
      orderBy: () => builder,
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      for: () => {
        this.locks.push(getTableName(table));
        return builder;
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve()
          .then(() => {
            let rows = this.matches(table, condition);
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
          const name = getTableName(table);
          if (this.failInsertTable === name)
            throw new Error(`注入写入故障:${name}`);
          const rows = (this.rows[name] ??= []),
            values = Array.isArray(data) ? data : [data];
          let first = 0;
          for (const input of values) {
            const defaults = Object.fromEntries(
              Object.entries(getTableColumns(table)).map(([key, col]: any) => [
                key,
                col.default instanceof Date ||
                typeof col.default === "string" ||
                typeof col.default === "boolean" ||
                typeof col.default === "number"
                  ? structuredClone(col.default)
                  : ["createdAt", "updatedAt"].includes(key)
                    ? new Date()
                    : null,
              ])
            );
            const value = {
              ...defaults,
              ...Object.fromEntries(
                Object.entries(input).filter(([, v]) => v !== undefined)
              ),
            };
            if (
              name === "vehicle_changes" &&
              rows.some(
                row =>
                  row.vehicleId === value.vehicleId &&
                  row.version === value.version
              )
            )
              throw new Error("vehicle_change_version_unique");
            if ("id" in getTableColumns(table) && value.id == null)
              value.id = Math.max(0, ...rows.map(row => row.id ?? 0)) + 1;
            first ||= Number(value.id ?? value.vehicleId);
            rows.push(structuredClone(value));
          }
          return [{ insertId: first }];
        };
        // The unload route uses Drizzle's insert ... on duplicate key for local notifications.
        return {
          then: (resolve: any, reject: any) => commit().then(resolve, reject),
          onDuplicateKeyUpdate: async () => commit(),
        };
      },
    };
  }
  update(table: any) {
    return {
      set: (patch: any) => ({
        where: async (condition: SQL) => {
          const isCas =
            getTableName(table) === "vehicle_fleet_profiles" &&
            Object.keys(patch).includes("version");
          const rows =
            this.zeroVersionWrite && isCas
              ? []
              : this.matches(table, condition);
          rows.forEach(row =>
            Object.assign(
              row,
              structuredClone(
                Object.fromEntries(
                  Object.entries(patch).filter(
                    ([, value]) => value !== undefined
                  )
                )
              )
            )
          );
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
  delete(table: any) {
    return {
      where: async (condition: SQL) => {
        const rows = this.matches(table, condition),
          name = getTableName(table);
        this.rows[name] = (this.rows[name] ?? []).filter(
          row => !rows.includes(row)
        );
        return [{ affectedRows: rows.length }];
      },
    };
  }
  async transaction<T>(fn: (tx: SqlFixture) => Promise<T>) {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    this.beforeTransaction?.();
    this.beforeTransaction = undefined;
    const saved = structuredClone(this.rows);
    try {
      return await fn(this);
    } catch (error) {
      this.rows = saved;
      throw error;
    } finally {
      release();
    }
  }
}
const context = (actorId = 1, extra: Record<string, unknown> = {}) =>
  ({
    user: { id: actorId, role: "user", loginMethod: "manus", ...extra },
    req: {},
    res: {},
  }) as TrpcContext;
const caller = (actorId = 1, extra: Record<string, unknown> = {}) =>
  vehicleManagementRouter.createCaller(context(actorId, extra));
const db = (): SqlFixture => mock.db;
const base = { vehicleId: 1, projectId: 1, version: 0 };
const state = {
  ...base,
  dispatchStatus: "paused" as const,
  reason: "现场安全暂停",
};
const profile = () => db().rows.vehicle_fleet_profiles[0];
const assignment = (action: "exit" | "handover" | "transfer") => ({
  ...base,
  action,
  occurredAt: time.getTime() - 1000,
  condition: "车辆状态已核对",
  reason: "现场即时责任交接",
  ...(action === "transfer" ? { targetProjectId: 2 } : {}),
});
const checkItems = (result: "pass" | "fail" | "unknown" = "pass") =>
  (["brakes", "tires", "lights", "leaks", "sealing"] as const).map(key => ({
    key,
    result: key === "brakes" ? result : ("pass" as const),
  }));
const inspection = (
  result: "pass" | "fail" | "unknown" = "fail",
  version = 0
) => ({
  ...base,
  version,
  occurredAt: time.getTime() - 1000,
  items: checkItems(result),
  safetyFault: false,
  notes: "制动系统现场检查记录",
});
function seedWorkOrder(id = 1, extra = {}) {
  (db().rows.vehicle_work_orders ??= []).push({
    id,
    vehicleId: 1,
    projectId: 1,
    status: "reported",
    createdBy: 1,
    purchaseOrderIds: [],
    inspectionId: id,
    safetyFault: true,
    ...extra,
  });
  profile().technicalStatus = "safety_hold";
  profile().dispatchStatus = "paused";
}
const transition = (
  action: "start" | "submit_acceptance" | "accept" | "release" | "reject",
  version = 0,
  workOrderId = 1
) => ({
  ...base,
  version,
  action,
  workOrderId,
  reason: "修复验收记录已现场核对",
});
function seedContract(extra = {}) {
  db().rows.transport_vehicle_lease_rules = [
    {
      id: 1,
      vehicleId: 1,
      projectId: 1,
      billingType: "monthly",
      rate: "3000",
      effectiveFrom: new Date("2026-11-01T00:00:00Z"),
      effectiveTo: null,
      status: "active",
      ...extra,
    },
  ];
}
const contract = {
  ...base,
  billingType: "monthly" as const,
  rate: 4000,
  effectiveFrom: "2026-11-10",
  reason: "续租版本只对未发生区间生效",
};
const grant = {
  ...base,
  userId: 10,
  role: "driver" as const,
  scope: "service_period" as const,
  effectiveFrom: earlier.getTime(),
  effectiveTo: time.getTime() + 86400000,
  reason: "司机本人明确服务期间只读",
};
function seedTransit() {
  db().rows.transport_trips = [
    {
      id: 1,
      vehicleId: 1,
      projectId: 1,
      tripNo: "TR-001",
      status: "draft",
      invoiceMode: "plate_photo",
      loadConfirmedAt: new Date(time.getTime() - 600000),
      loadConfirmedBy: 1,
      unloadConfirmedAt: null,
      unloadEventId: null,
      startAt: earlier,
      routeSnapshot: { routePresetId: 1 },
      unloadSiteId: 2,
      activeVehicleTransitKey: "vehicle:1",
    },
  ];
}
function seedDriver() {
  Object.assign(db().rows.transport_vehicles[0], {
    driverPersonId: 100,
    driverUserId: 10,
    driverName: "旧司机",
  });
  db().rows.personnel_positions = [
    { id: 1, status: "active", category: "driver" },
  ];
  db().rows.personnel_people = [100, 101].map((id, i) => ({
    id,
    projectId: 1,
    userId: 10 + i,
    name: i ? "新司机" : "旧司机",
    primaryPositionId: 1,
    secondaryPositionIds: [],
    employmentStatus: "active",
    version: 1,
    phoneEncrypted: null,
    phoneMasked: null,
  }));
  db().rows.official_account_driver_bindings = [
    {
      id: 50,
      vehicleId: 1,
      projectId: 1,
      status: "active",
      driverName: "旧司机",
    },
  ];
  db().rows.vehicle_assignments = [
    {
      id: 1,
      vehicleId: 1,
      projectId: 1,
      driverPersonId: 100,
      driverUserId: 10,
      driverBindingId: 50,
      effectiveFrom: earlier,
      effectiveTo: null,
      action: "enter",
    },
  ];
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
  vi.stubEnv("JWT_SECRET", "vehicle-caller-test-only-encryption-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("本测试禁止任何网络访问");
    })
  );
  mock.db = new SqlFixture();
  mock.roles = ["TRANSPORT_MANAGER"];
  mock.permissions = ["read", "edit", "create", "export", "review", "manage"];
  mock.projectIds = [1, 2];
  mock.superAdmin = false;
  mock.accessChecks = [];
  mock.storagePut.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("车辆 caller：权限必须显式按动作和项目收口", () => {
  it.each(["DRIVER", "VEHICLE_OWNER"])(
    "%s身份不能隐式读取、编辑、授权或验收车辆",
    async role => {
      mock.roles = [role];
      await expect(caller().list({ projectId: 1 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller().setState(state)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller().grantAccess(grant)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(profile().version).toBe(0);
      expect(db().rows.vehicle_access_grants ?? []).toEqual([]);
    }
  );
  it("local_driver即使附管理角色也不能办理；未登录不进入SQL", async () => {
    await expect(
      caller(10, {
        loginMethod: "local_driver",
        localAccountStatus: "active",
      }).setState(state)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      vehicleManagementRouter
        .createCaller({ ...context(), user: null })
        .detail({ vehicleId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db().sql).toHaveLength(0);
  });
  it("只读不允许edit、manage/review缺失不能借edit权限放行", async () => {
    mock.permissions = ["read"];
    expect((await caller().list({ projectId: 1 })).total).toBe(1);
    await expect(caller().setState(state)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    mock.permissions = ["read", "edit"];
    await expect(caller().grantAccess(grant)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    seedWorkOrder(1, { status: "awaiting_acceptance" });
    await expect(
      caller(2).transitionWorkOrder(transition("accept"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.accessChecks).toContain("TRANSPORT:manage");
    expect(mock.accessChecks).toContain("TRANSPORT:review");
    expect(profile().version).toBe(0);
  });
  it("跨项目读写/调配目标均拒绝，导出另需export权限", async () => {
    mock.projectIds = [1];
    mock.permissions = ["read", "edit"];
    await expect(
      caller().detail({ vehicleId: 1, projectId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().setState({ ...state, projectId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().assign(assignment("transfer"))).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(
      caller().list({ projectId: 1, all: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db().rows.vehicle_assignments ?? []).toHaveLength(0);
    expect(profile().version).toBe(0);
  });
});
describe("车辆 caller：CAS、封账和原子回滚", () => {
  it("并发相同version仅一次成功，重复提交无第二次历史或审计", async () => {
    const result = await Promise.allSettled([
      caller().setState(state),
      caller().setState(state),
    ]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(result.find(r => r.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect(profile().version).toBe(1);
    expect(db().rows.vehicle_changes).toHaveLength(1);
    expect(db().rows.audit_logs).toHaveLength(1);
    expect(db().locks.slice(0, 3)).toEqual([
      "projects",
      "daily_accounting_closures",
      "transport_vehicles",
    ]);
  });
  it.each(["closed", "archived"])(
    "%s封账拒绝，没有业务/历史/版本副作用",
    async status => {
      db().rows.daily_accounting_closures = [
        {
          id: 1,
          projectId: 1,
          closingDate: new Date("2026-11-04T00:00:00Z"),
          status,
        },
      ];
      const saved = structuredClone(db().rows);
      await expect(caller().inspect(inspection())).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(db().rows).toEqual(saved);
    }
  );
  it("事务开始前新增封账仍拒绝；别项目/别日期封账不误拦", async () => {
    db().rows.daily_accounting_closures = [
      {
        id: 1,
        projectId: 2,
        closingDate: new Date("2026-11-04T00:00:00Z"),
        status: "closed",
      },
      {
        id: 2,
        projectId: 1,
        closingDate: new Date("2026-11-03T00:00:00Z"),
        status: "closed",
      },
    ];
    await caller().setState(state);
    db().beforeTransaction = () => {
      db().rows.daily_accounting_closures.push({
        id: 3,
        projectId: 1,
        closingDate: new Date("2026-11-04T00:00:00Z"),
        status: "closed",
      });
    };
    await expect(
      caller().setState({ ...state, version: 1 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(profile().version).toBe(1);
    expect(db().rows.vehicle_changes).toHaveLength(1);
  });
  it("故障检查在最后审计写入失败时回滚工单、检查、状态、CAS和历史", async () => {
    db().failInsertTable = "audit_logs";
    const saved = structuredClone(db().rows);
    await expect(caller().inspect(inspection())).rejects.toThrow(
      "注入写入故障:audit_logs"
    );
    expect(db().rows).toEqual(saved);
  });
  it("最终version条件写入0行必须冲突并回滚，不能伪报成功", async () => {
    db().zeroVersionWrite = true;
    const saved = structuredClone(db().rows);
    await expect(caller().setState(state)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db().rows).toEqual(saved);
  });
  it("无profile时从version0初始化，真实Schema默认normal/on_site可继续检查", async () => {
    db().rows.vehicle_fleet_profiles = [];
    const result = await caller().inspect(inspection("pass"));
    expect(result).toMatchObject({ version: 1, outcome: "passed" });
    expect(profile()).toMatchObject({
      version: 1,
      technicalStatus: "normal",
      projectStatus: "on_site",
      archived: false,
    });
  });
});
describe("车辆 caller：在途和安全闭环", () => {
  it.each(["exit", "handover", "transfer"] as const)(
    "在途票据阻止%s且不改变责任或项目",
    async action => {
      seedTransit();
      const saved = structuredClone(db().rows);
      await expect(caller().assign(assignment(action))).rejects.toThrow(
        "在途票据"
      );
      expect(db().rows).toEqual(saved);
    }
  );
  it("在途阻止归档/remove，暂停调度不因在途而拒绝", async () => {
    seedTransit();
    await expect(
      caller().retire({ ...base, reason: "归档申请" })
    ).rejects.toThrow("在途票据");
    await expect(
      caller().remove({ ...base, reason: "删除申请" })
    ).rejects.toThrow("在途票据");
    await caller().setState(state);
    expect(profile()).toMatchObject({
      dispatchStatus: "paused",
      version: 1,
      archived: false,
    });
  });
  it("故障暂停后已有票据仍可真实照片卸土，不解除安全状态", async () => {
    seedTransit();
    await caller().inspect(inspection());
    db().rows.evidence_records = [
      {
        id: 8,
        projectId: 1,
        sourceType: "transport",
        status: "active",
        mimeType: "image/jpeg",
      },
    ];
    db().rows.transport_route_presets = [
      { id: 1, projectId: 1, status: "active" },
    ];
    db().rows.transport_sites = [
      {
        id: 2,
        projectId: 1,
        siteType: "unload",
        status: "active",
        name: "卸土点",
        latitude: "28",
        longitude: "112",
        minimumTransitMinutes: 1,
        minimumTransitEnabled: true,
        unloadGeofenceMeters: 100,
        unloadGeofenceEnabled: true,
        administratorUserId: null,
      },
    ];
    const result = await transportRouter
      .createCaller(context())
      .confirmPlatePhotoUnload({
        tripId: 1,
        projectId: 1,
        unloadEvidenceId: 8,
        idempotencyKey: "vehicle-safety-unload-1",
        latitude: 28,
        longitude: 112,
        occurredAt: time.toISOString(),
      });
    expect(result.success).toBe(true);
    expect(db().rows.transport_trips[0]).toMatchObject({
      status: "submitted",
      unloadConfirmedAt: time,
      activeVehicleTransitKey: null,
    });
    expect(profile()).toMatchObject({
      technicalStatus: "safety_hold",
      dispatchStatus: "paused",
      version: 1,
    });
    expect(db().rows.transport_card_events[0]).toMatchObject({
      eventType: "unload",
      validationStatus: "accepted",
    });
  });
  it("故障车辆不能新发车，拒绝发生在真实运输saveTrip入口", async () => {
    await caller().inspect(inspection());
    db().rows.freight_rate_rules = [
      {
        id: 1,
        projectId: 1,
        status: "active",
        effectiveFrom: earlier,
        effectiveTo: null,
        settlementUnit: "cubic_meter",
        startDistanceKm: "1",
        basePricePerUnit: "10",
        stepMeters: 500,
        stepIncreasePerUnit: "1",
      },
    ];
    await expect(
      transportRouter
        .createCaller(context())
        .saveTrip({
          vehicleId: 1,
          projectId: 1,
          freightRuleId: 1,
          startAt: time.toISOString(),
        })
    ).rejects.toThrow("不能新出车");
    expect(db().rows.transport_trips ?? []).toHaveLength(0);
  });
});
describe("车辆 caller：租赁合同历史只追加", () => {
  it("不显式supersedes不能覆盖开放历史；新增不重叠区间保留原行", async () => {
    seedContract();
    const saved = structuredClone(db().rows);
    await expect(caller().saveContract(contract)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db().rows).toEqual(saved);
    db().rows.transport_vehicle_lease_rules[0].effectiveTo = new Date(
      "2026-11-09T00:00:00Z"
    );
    const old = structuredClone(db().rows.transport_vehicle_lease_rules[0]);
    await caller().saveContract(contract);
    expect(db().rows.transport_vehicle_lease_rules).toHaveLength(2);
    expect(db().rows.transport_vehicle_lease_rules[0]).toEqual(old);
  });
  it("显式supersedes只关闭旧合同未发生区间，不改旧价格/起点/ID", async () => {
    seedContract();
    await caller().saveContract({ ...contract, supersedesContractId: 1 });
    expect(db().rows.transport_vehicle_lease_rules[0]).toMatchObject({
      id: 1,
      rate: "3000",
      effectiveFrom: new Date("2026-11-01T00:00:00Z"),
      effectiveTo: new Date("2026-11-09T00:00:00Z"),
      status: "active",
    });
    expect(db().rows.transport_vehicle_lease_rules[1]).toMatchObject({
      id: 2,
      rate: "4000",
      effectiveFrom: new Date("2026-11-10T00:00:00Z"),
      effectiveTo: null,
    });
    expect(profile().version).toBe(1);
  });
  it.each(["draft", "approved", "paid"])(
    "已有未来%s租赁结算不允许截断且不污染旧合同",
    async status => {
      seedContract();
      db().rows.transport_vehicle_settlements = [
        {
          id: 1,
          vehicleId: 1,
          projectId: 1,
          settlementKind: "lease",
          status,
          periodEnd: new Date("2026-11-10T00:00:00Z"),
        },
      ];
      const saved = structuredClone(db().rows);
      await expect(
        caller().saveContract({ ...contract, supersedesContractId: 1 })
      ).rejects.toThrow("已有租赁结算");
      expect(db().rows).toEqual(saved);
    }
  );
  it("作废未来结算不误阻断，回溯新增禁止；错误替代ID拒绝", async () => {
    seedContract();
    await expect(
      caller().saveContract({
        ...contract,
        effectiveFrom: "2026-11-03",
        supersedesContractId: 1,
      })
    ).rejects.toThrow("不能回溯");
    await expect(
      caller().saveContract({ ...contract, supersedesContractId: 99 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    db().rows.transport_vehicle_settlements = [
      {
        id: 1,
        vehicleId: 1,
        projectId: 1,
        settlementKind: "lease",
        status: "void",
        periodEnd: new Date("2026-11-10T00:00:00Z"),
      },
    ];
    await caller().saveContract({ ...contract, supersedesContractId: 1 });
    expect(db().rows.transport_vehicle_lease_rules).toHaveLength(2);
  });
  it("旧区间截断后新合同插入失败必须原样回滚", async () => {
    seedContract();
    db().failInsertTable = "transport_vehicle_lease_rules";
    const saved = structuredClone(db().rows);
    await expect(
      caller().saveContract({ ...contract, supersedesContractId: 1 })
    ).rejects.toThrow("注入写入故障");
    expect(db().rows).toEqual(saved);
  });
});
describe("车辆 caller：维修/独立验收/放行不可跳过", () => {
  it("检查故障自动建立工单并停调，随后通过检查不能自行恢复normal", async () => {
    const result = await caller().inspect(inspection());
    expect(result).toMatchObject({
      inspectionId: 1,
      workOrderId: 1,
      outcome: "fault",
      version: 1,
    });
    expect(db().rows.vehicle_work_orders[0]).toMatchObject({
      status: "reported",
      safetyFault: true,
      inspectionId: 1,
      purchaseOrderIds: [],
    });
    expect(profile()).toMatchObject({
      technicalStatus: "safety_hold",
      dispatchStatus: "paused",
    });
    await caller().inspect(inspection("pass", 1));
    expect(profile().technicalStatus).toBe("safety_hold");
    await expect(
      caller().setState({ ...state, version: 2, dispatchStatus: "standby" })
    ).rejects.toThrow("验收放行");
  });
  it.each(["submit_acceptance", "accept", "release"] as const)(
    "reported不能直接%s，不留错误状态/审计",
    async action => {
      seedWorkOrder();
      const saved = structuredClone(db().rows);
      await expect(
        caller(2).transitionWorkOrder(transition(action))
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(db().rows).toEqual(saved);
    }
  );
  it("reporter不能自行验收，accept仍不能调度；独立放行后必须另恢复调度", async () => {
    seedWorkOrder();
    await caller().transitionWorkOrder(transition("start", 0));
    expect(profile().technicalStatus).toBe("repair");
    await caller().transitionWorkOrder(transition("submit_acceptance", 1));
    await expect(
      caller().transitionWorkOrder(transition("accept", 2))
    ).rejects.toThrow("独立验收");
    await expect(
      caller(2).transitionWorkOrder(transition("release", 2))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await caller(2).transitionWorkOrder(transition("accept", 2));
    await expect(
      caller().setState({ ...state, version: 3, dispatchStatus: "standby" })
    ).rejects.toThrow("验收放行");
    await caller(2).transitionWorkOrder(transition("release", 3));
    expect(profile()).toMatchObject({
      technicalStatus: "normal",
      dispatchStatus: "paused",
      version: 4,
    });
    await caller().setState({
      ...state,
      version: 4,
      dispatchStatus: "standby",
    });
    expect(profile().dispatchStatus).toBe("standby");
    expect(db().rows.vehicle_work_orders[0]).toMatchObject({
      status: "released",
      acceptedBy: 2,
      releasedBy: 2,
    });
  });
  it("另一未放行工单阻止本单release恢复normal，所有工单放行才可恢复", async () => {
    seedWorkOrder(1, { status: "accepted" });
    seedWorkOrder(2, { status: "accepted" });
    await caller(2).transitionWorkOrder(transition("release", 0, 1));
    expect(profile()).toMatchObject({
      technicalStatus: "safety_hold",
      dispatchStatus: "paused",
    });
    await expect(
      caller().setState({ ...state, version: 1, dispatchStatus: "working" })
    ).rejects.toThrow("验收放行");
    await caller(2).transitionWorkOrder(transition("release", 1, 2));
    expect(profile()).toMatchObject({
      technicalStatus: "normal",
      dispatchStatus: "paused",
    });
  });
});
describe("车辆 caller：只读授权和证照附件安全", () => {
  it("服务期间必须明确止点、实际账号且账号/绑定只能二选一", async () => {
    const { effectiveTo: _end, ...open } = grant;
    await expect(caller().grantAccess(open)).rejects.toThrow("必须明确起止");
    await expect(
      caller().grantAccess({ ...grant, userId: 999 })
    ).rejects.toThrow("账号不存在");
    await expect(
      caller().grantAccess({ ...grant, driverBindingId: 50 })
    ).rejects.toThrow("只能选择一个");
    await expect(
      caller().grantAccess({ ...grant, effectiveTo: grant.effectiveFrom })
    ).rejects.toThrow("结束必须晚于开始");
    await expect(
      caller().grantAccess({ ...grant, validTo: time.getTime() })
    ).rejects.toThrow("晚于当前时间");
    expect(profile().version).toBe(0);
    expect(db().rows.vehicle_access_grants ?? []).toHaveLength(0);
    const users = structuredClone(db().rows.users);
    await caller().grantAccess(grant);
    expect(db().rows.vehicle_access_grants[0]).toMatchObject({
      userId: 10,
      scope: "service_period",
      effectiveFrom: earlier,
      effectiveTo: new Date(grant.effectiveTo),
    });
    expect(db().rows.users).toEqual(users);
    expect(mock.roles).toEqual(["TRANSPORT_MANAGER"]);
  });
  it("错误车辆/项目的服务号绑定ID不能被授权", async () => {
    db().rows.official_account_driver_bindings = [
      { id: 50, vehicleId: 99, projectId: 1, status: "active" },
      { id: 51, vehicleId: 1, projectId: 2, status: "active" },
    ];
    const { userId: _user, ...input } = grant;
    for (const driverBindingId of [50, 51, 999])
      await expect(
        caller().grantAccess({ ...input, driverBindingId })
      ).rejects.toThrow("不属于该车辆项目");
    expect(db().rows.vehicle_access_grants ?? []).toHaveLength(0);
  });
  it("detail和compliance DTO不泄露fileKey、摘要或车辆密文", async () => {
    db().rows.vehicle_documents = [
      {
        id: 1,
        vehicleId: 1,
        projectId: 1,
        kind: "insurance",
        title: "车辆保险",
        applicable: true,
        fileKey: "vehicle-private/1/secret.enc",
        contentSha256: "private-sha256",
        mimeType: "application/pdf",
        contentBytes: 10,
        verificationStatus: "pending",
      },
      {
        id: 2,
        vehicleId: 1,
        projectId: 2,
        fileKey: "secret-other-project",
        contentSha256: "other-hash",
      },
    ];
    db().rows.transport_vehicles[0].driverPhoneEncrypted = "private-phone";
    const detail = await caller().detail({ vehicleId: 1, projectId: 1 });
    const records = await caller().records({
      vehicleIds: [1],
      projectId: 1,
      category: "compliance",
    });
    for (const documents of [detail.documents, records.documents]) {
      expect(documents).toHaveLength(1);
      expect(documents[0]).toHaveProperty("documentId", 1);
      expect(documents[0]).not.toHaveProperty("fileKey");
      expect(documents[0]).not.toHaveProperty("contentSha256");
    }
    expect(detail.vehicle).not.toHaveProperty("driverPhoneEncrypted");
    expect(JSON.stringify([detail, records])).not.toContain("private-sha256");
  });
  it.each(["image/jpeg", "image/png", "application/pdf"] as const)(
    "%s魔术签名不匹配时不写存储/SQL",
    async mimeType => {
      const saved = structuredClone(db().rows);
      await expect(
        caller().uploadDocument({
          ...base,
          kind: "insurance",
          title: "车辆保险",
          applicable: true,
          originalName: "evil.pdf",
          mimeType,
          base64: Buffer.from("<script>not-an-image</script>").toString(
            "base64"
          ),
        })
      ).rejects.toThrow("附件内容与");
      expect(mock.storagePut).not.toHaveBeenCalled();
      expect(db().rows).toEqual(saved);
    }
  );
  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0, 0x00]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]],
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]],
  ] as const)(
    "%s正确magic只存加密私有附件，响应不泄露key或hash",
    async (mimeType, signature) => {
      const bytes = Buffer.from(signature);
      const result = await caller().uploadDocument({
        ...base,
        kind: "insurance",
        title: "车辆保险",
        applicable: true,
        originalName: "../../insurance.file",
        mimeType,
        base64: bytes.toString("base64"),
      });
      expect(result).toMatchObject({ documentId: 1, version: 1 });
      expect(result).not.toHaveProperty("fileKey");
      expect(result).not.toHaveProperty("contentSha256");
      expect(mock.storagePut).toHaveBeenCalledTimes(1);
      const [key, encrypted, storageMime] = mock.storagePut.mock.calls[0];
      expect(key).toMatch(/^vehicle-private\/1\/.+\.enc$/);
      expect(storageMime).toBe("application/octet-stream");
      expect(decryptSecret(encrypted)).toBe(bytes.toString("base64"));
      expect(db().rows.vehicle_documents[0]).toMatchObject({
        originalName: "insurance.file",
        mimeType,
        contentBytes: bytes.length,
        fileKey: key,
        verificationStatus: "pending",
      });
    }
  );
  it("非canonical base64拒绝且有效签名也不能穿过封账", async () => {
    const input = {
      ...base,
      kind: "insurance" as const,
      title: "车辆保险",
      applicable: true,
      originalName: "insurance.pdf",
      mimeType: "application/pdf" as const,
      base64: Buffer.from("%PDF-1.7").toString("base64"),
    };
    await expect(
      caller().uploadDocument({ ...input, base64: `${input.base64}\n` })
    ).rejects.toThrow("附件编码无效");
    db().rows.daily_accounting_closures = [
      {
        id: 1,
        projectId: 1,
        closingDate: new Date("2026-11-04T00:00:00Z"),
        status: "closed",
      },
    ];
    await expect(caller().uploadDocument(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mock.storagePut).not.toHaveBeenCalled();
  });
});

// Handover regression is added after the parent's source fix is present; real personnel bridge is deliberately not mocked.
describe("车辆 caller：交接换人不得转授旧绑定", () => {
  it("换司机撤销旧服务号绑定，新责任历史不继承旧bindingId", async () => {
    seedDriver();
    const users = structuredClone(db().rows.users);
    await caller().assign({
      ...assignment("handover"),
      driverPersonId: 101,
      driverUserId: 11,
    });
    expect(db().rows.transport_vehicles[0]).toMatchObject({
      driverPersonId: 101,
      driverUserId: 11,
      driverName: "新司机",
    });
    expect(db().rows.official_account_driver_bindings[0]).toMatchObject({
      id: 50,
      status: "revoked",
    });
    expect(db().rows.vehicle_assignments[0]).toMatchObject({
      driverPersonId: 100,
      driverUserId: 10,
      driverBindingId: 50,
      effectiveTo: new Date(time.getTime() - 1000),
    });
    expect(db().rows.vehicle_assignments[1]).toMatchObject({
      driverPersonId: 101,
      driverUserId: 11,
      driverBindingId: null,
      effectiveTo: null,
    });
    expect(
      db().rows.personnel_resource_bindings.filter(r => r.effectiveTo === null)
    ).toHaveLength(1);
    expect(
      db().rows.personnel_resource_bindings.find(r => r.effectiveTo === null)
    ).toMatchObject({ personId: 101 });
    expect(db().rows.users).toEqual(users);
    expect(db().rows.vehicle_access_grants ?? []).toHaveLength(0);
  });
  it("显式传入旧司机bindingId也不能转授新账号，拒绝后责任历史原样保留", async () => {
    seedDriver();
    db().rows.official_account_driver_bindings[0].openIdFingerprint =
      "old-driver-fingerprint";
    db().rows.official_account_bindings = [
      {
        id: 1,
        userId: 10,
        openIdFingerprint: "old-driver-fingerprint",
        status: "active",
      },
    ];
    const saved = structuredClone(db().rows);
    await expect(
      caller().assign({
        ...assignment("handover"),
        driverPersonId: 101,
        driverUserId: 11,
        driverBindingId: 50,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db().rows).toEqual(saved);
  });
  it("只有新司机本人真实服务号账号绑定可显式保留，旧绑定仍撤销", async () => {
    seedDriver();
    db().rows.official_account_driver_bindings.push({
      id: 51,
      vehicleId: 1,
      projectId: 1,
      status: "active",
      openIdFingerprint: "new-driver-fingerprint",
    });
    db().rows.official_account_bindings = [
      {
        id: 2,
        userId: 11,
        openIdFingerprint: "new-driver-fingerprint",
        status: "active",
      },
    ];
    await caller().assign({
      ...assignment("handover"),
      driverPersonId: 101,
      driverUserId: 11,
      driverBindingId: 51,
    });
    expect(
      db().rows.official_account_driver_bindings.map(r => r.status)
    ).toEqual(["revoked", "active"]);
    expect(db().rows.vehicle_assignments[1]).toMatchObject({
      driverPersonId: 101,
      driverUserId: 11,
      driverBindingId: 51,
    });
  });
  it("交接最后审计失败撤销、人员mirror和责任历史必须同事务回滚", async () => {
    seedDriver();
    db().failInsertTable = "audit_logs";
    const saved = structuredClone(db().rows);
    await expect(
      caller().assign({
        ...assignment("handover"),
        driverPersonId: 101,
        driverUserId: 11,
      })
    ).rejects.toThrow("注入写入故障");
    expect(db().rows).toEqual(saved);
  });
});
