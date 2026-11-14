import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  roles: vi.fn(),
  scope: vi.fn(),
  department: vi.fn(),
  super: vi.fn(),
  permission: vi.fn(),
  sms: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./access", async load => ({
  ...(await load<any>()),
  getEffectiveRoleCodes: mocks.roles,
  assertProjectInCurrentScope: mocks.scope,
  assertDepartmentBusinessAccess: mocks.department,
  getSuperAdminAccess: mocks.super,
  hasUserSpecificOperationPermission: mocks.permission,
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: mocks.notify,
}));
vi.mock("./services/smsNotifier", () => ({
  notifyAliyunSmsSafely: mocks.sms,
  formatChinaSmsTime: () => "2026/11/14 12:00:00",
}));
import { machineryRouter } from "./routers/operations";
import { adminRouter } from "./routers/admin";
const ctx: any = {
  user: {
    id: 9,
    role: "admin",
    userType: "super_admin",
    status: "active",
    openId: "synthetic-test",
    name: "合成管理员",
  },
  req: { headers: {} },
  res: {},
};
const now = new Date("2026-11-14T04:00:00Z");
function database() {
  const state: Record<string, any[]> = {
    machines: [{ id: 13, projectId: 3, name: "合成挖机", ownerUserId: null }],
    projects: [{ id: 3, status: "active", name: "测试项目" }],
    diesel_guideline_prices: [
      {
        id: 5,
        projectId: 3,
        status: "active",
        pricePerLiter: "8.61",
        effectiveFrom: new Date("2026-11-01T00:00:00Z"),
        effectiveTo: null,
      },
    ],
    machine_cost_records: [],
    diesel_refuel_records: [],
    audit_logs: [],
    system_settings: [],
    users: [{ id: 9, name: "合成管理员" }],
  };
  const fault = { audit: false, cas: false, photo: false };
  let nextCost = 10,
    nextFuel = 20;
  const chain = (rows: any[]) => {
    const result: any = {
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    for (const name of ["where", "orderBy", "limit", "for"])
      result[name] = () => result;
    return result;
  };
  const db: any = {
    state,
    fault,
    select: () => ({
      from: (table: any) => chain(state[getTableName(table)] ?? []),
    }),
    insert: (table: any) => ({
      values: async (value: any) => {
        const name = getTableName(table);
        if (name === "audit_logs" && fault.audit)
          throw Error("synthetic audit failure");
        const id =
          name === "machine_cost_records"
            ? nextCost++
            : name === "diesel_refuel_records"
              ? nextFuel++
              : (state[name]?.length ?? 0) + 1;
        const row = { id, createdAt: now, ...value };
        (state[name] ??= []).push(row);
        return [{ insertId: id, affectedRows: 1 }];
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          if (fault.cas) return [{ affectedRows: 0 }];
          const row = state[getTableName(table)]?.[0];
          if (row) Object.assign(row, values);
          return [{ affectedRows: row ? 1 : 0 }];
        },
      }),
    }),
    transaction: async (fn: any) => {
      const before = structuredClone(state);
      try {
        return await fn(db);
      } catch (e) {
        for (const key of Object.keys(state)) state[key] = before[key] ?? [];
        throw e;
      }
    },
  };
  return db;
}
let db: any;
beforeEach(() => {
  vi.clearAllMocks();
  db = database();
  mocks.db.mockResolvedValue(db);
  mocks.roles.mockResolvedValue(["MACHINERY_MANAGER", "FINANCE_MANAGER"]);
  mocks.scope.mockResolvedValue(undefined);
  mocks.department.mockResolvedValue(undefined);
  mocks.super.mockResolvedValue({ canAccess: true });
  mocks.permission.mockResolvedValue(false);
  mocks.sms.mockResolvedValue({ sent: false });
  mocks.notify.mockResolvedValue([]);
});
const input = {
  machineId: 13,
  projectId: 3,
  costType: "fuel" as const,
  costName: "机械柴油",
  quantity: 10,
  unitPrice: 99,
  occurredAt: now.toISOString(),
};
describe("机械柴油归集真实路由", () => {
  it("按发生日期指导价生成一笔柴油和一笔关联机械成本，原记录保持草稿", async () => {
    const r = await machineryRouter.createCaller(ctx).saveCost(input);
    expect(r).toMatchObject({
      id: 10,
      dieselRefuelRecordId: 20,
      amount: 86.1,
      unitPrice: 8.61,
    });
    expect(db.state.machine_cost_records).toHaveLength(1);
    expect(db.state.machine_cost_records[0]).toMatchObject({
      dieselRefuelRecordId: 20,
      status: "draft",
      amount: "86.1",
    });
    expect(db.state.diesel_refuel_records).toHaveLength(1);
    expect(db.state.diesel_refuel_records[0]).toMatchObject({
      recordNo: "DS-MC-10",
      status: "draft",
      assetType: "machine",
      machineId: 13,
      supplyMethod: "project_supply",
      createdBy: 9,
      deductFromFreight: false,
    });
    expect(mocks.sms).toHaveBeenCalledTimes(1);
  });
  it("同机同量临近重复拒绝，事务不新增成本", async () => {
    await machineryRouter.createCaller(ctx).saveCost(input);
    await expect(
      machineryRouter.createCaller(ctx).saveCost(input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.machine_cost_records).toHaveLength(1);
    expect(db.state.diesel_refuel_records).toHaveLength(1);
    expect(mocks.sms).toHaveBeenCalledTimes(1);
  });
  it("审核和结算两账状态同步，不再生成成本或柴油记录", async () => {
    await machineryRouter.createCaller(ctx).saveCost(input);
    await machineryRouter
      .createCaller(ctx)
      .transitionCost({ id: 10, projectId: 3, nextStatus: "approved" });
    expect(db.state.diesel_refuel_records[0]).toMatchObject({
      status: "approved",
      approvedBy: 9,
    });
    await machineryRouter
      .createCaller(ctx)
      .transitionCost({ id: 10, projectId: 3, nextStatus: "settled" });
    expect(db.state.machine_cost_records[0].status).toBe("settled");
    expect(db.state.diesel_refuel_records[0].status).toBe("settled");
    expect(db.state.diesel_refuel_records).toHaveLength(1);
  });
  it("未结算作废同步两账，已结算不准回退", async () => {
    await machineryRouter.createCaller(ctx).saveCost(input);
    await machineryRouter
      .createCaller(ctx)
      .transitionCost({ id: 10, projectId: 3, nextStatus: "void" });
    expect(db.state.diesel_refuel_records[0].status).toBe("void");
    await expect(
      machineryRouter
        .createCaller(ctx)
        .transitionCost({ id: 10, projectId: 3, nextStatus: "approved" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("CAS失败不改变两账，不投递新通知", async () => {
    await machineryRouter.createCaller(ctx).saveCost(input);
    db.fault.cas = true;
    const n = mocks.notify.mock.calls.length;
    await expect(
      machineryRouter
        .createCaller(ctx)
        .transitionCost({ id: 10, projectId: 3, nextStatus: "approved" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.machine_cost_records[0].status).toBe("draft");
    expect(db.state.diesel_refuel_records[0].status).toBe("draft");
    expect(mocks.notify.mock.calls).toHaveLength(n);
  });
  it("审计写入失败全部回滚，不发短信", async () => {
    db.fault.audit = true;
    await expect(
      machineryRouter.createCaller(ctx).saveCost(input)
    ).rejects.toThrow();
    expect(db.state.machine_cost_records).toHaveLength(0);
    expect(db.state.diesel_refuel_records).toHaveLength(0);
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("不同项目、未授权或未登录不能借柴油归集入口创建", async () => {
    mocks.scope.mockRejectedValue(new Error("synthetic scope denied"));
    await expect(
      machineryRouter.createCaller(ctx).saveCost(input)
    ).rejects.toThrow();
    expect(db.state.machine_cost_records).toHaveLength(0);
    mocks.scope.mockResolvedValue(undefined);
    await expect(
      machineryRouter.createCaller({ ...ctx, user: null }).saveCost(input)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("非油料成本不创建柴油，零升数不创建任一账", async () => {
    await machineryRouter
      .createCaller(ctx)
      .saveCost({ ...input, costType: "repair", costName: "维修" });
    expect(db.state.diesel_refuel_records).toHaveLength(0);
    await expect(
      machineryRouter.createCaller(ctx).saveCost({ ...input, quantity: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.state.machine_cost_records).toHaveLength(1);
  });
  it("柴油编辑不能改机械来源以绕过原成本流程", async () => {
    await machineryRouter.createCaller(ctx).saveCost(input);
    await expect(
      adminRouter.createCaller(ctx).diesel.saveRefuelRecord({
        id: 20,
        projectId: 3,
        assetType: "machine",
        machineId: 13,
        supplyMethod: "project_supply",
        liters: 10,
        refueledAt: now.toISOString(),
        status: "approved",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.diesel_refuel_records[0].status).toBe("draft");
  });
});
