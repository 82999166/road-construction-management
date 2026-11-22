import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 全部基础设施隔离；本文件仅调用真实 tRPC caller，不连接 MySQL、不写业务、不发通知。 */
const mocks = vi.hoisted(() => ({ db: vi.fn(), scope: vi.fn(), permission: vi.fn(), notify: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertProjectInCurrentScope: mocks.scope,
  getRoleOperationPermissionDecision: mocks.permission,
}));
vi.mock("./services/refuelCompletionNotifier", () => ({ notifyRefuelCompletedSafely: mocks.notify }));
import { dieselRouter } from "./routers/diesel";

const ctx: any = {
  user: { id: 9, name: "合成加油员", role: "user", loginMethod: "manus", status: "active" },
  req: { headers: {} }, res: {},
};
const refueledAt = new Date("2026-11-14T04:00:00.000Z");
const base = {
  projectId: 3, assetType: "vehicle" as "vehicle" | "machine", assetId: 13,
  supplyMethod: "project_supply" as const, liters: 10, refueledAt: refueledAt.toISOString(), evidenceId: 6,
};

function database() {
  const state: Record<string, any[]> = {
    projects: [{ id: 3, status: "active" }],
    evidence_records: [{ id: 6, projectId: 3, sourceType: "diesel_receipt", status: "active" }],
    transport_vehicles: [{ id: 13, projectId: 3 }],
    machines: [{ id: 13, projectId: 3 }],
    diesel_guideline_prices: [{ id: 5, projectId: 3, status: "active", pricePerLiter: "8.61", effectiveFrom: new Date("2026-11-01T00:00:00Z"), effectiveTo: null }],
    diesel_refuel_records: [], machine_cost_records: [], audit_logs: [],
  };
  const fault = { audit: false, cost: false, commit: false, noInsertId: false };
  const db: any = { state, fault, committed: false };
  const chain = (rows: any[]) => {
    const result: any = { then: (ok: any, fail: any) => Promise.resolve(rows).then(ok, fail) };
    for (const name of ["where", "orderBy", "limit", "for"]) result[name] = () => result;
    return result;
  };
  db.select = () => ({ from: (table: any) => chain(state[getTableName(table)] ?? []) });
  db.insert = (table: any) => ({ values: async (value: any) => {
    const tableName = getTableName(table);
    if (tableName === "audit_logs" && fault.audit) throw Error("synthetic audit failure");
    if (tableName === "machine_cost_records" && fault.cost) throw Error("synthetic machine cost failure");
    const id = (state[tableName]?.length ?? 0) + (tableName === "diesel_refuel_records" ? 20 : 1);
    (state[tableName] ??= []).push({ id, ...value });
    return [{ insertId: fault.noInsertId && tableName === "diesel_refuel_records" ? 0 : id }];
  } });
  db.transaction = async (fn: any) => {
    const before = structuredClone(state);
    try {
      const result = await fn(db);
      if (fault.commit) throw Error("synthetic transaction commit failure");
      db.committed = true;
      return result;
    } catch (error) {
      for (const key of Object.keys(state)) state[key] = before[key] ?? [];
      throw error;
    }
  };
  return db;
}
let db: ReturnType<typeof database>;
beforeEach(() => {
  vi.resetAllMocks();
  db = database();
  mocks.db.mockResolvedValue(db);
  mocks.scope.mockResolvedValue(undefined);
  mocks.permission.mockResolvedValue({ allowed: true, hasDetailedPermissions: true });
  mocks.notify.mockResolvedValue(undefined);
});

describe("手机柴油加油通知真实 caller 提交边界", () => {
  it.each(["vehicle", "machine"] as const)("%s 成功提交后且仅一次调用完成通知，不改变原业务返回", async assetType => {
    let atNotification: unknown;
    mocks.notify.mockImplementation(async notificationInput => {
      atNotification = { committed: db.committed, auditCount: db.state.audit_logs.length,
        dieselCount: db.state.diesel_refuel_records.length, costCount: db.state.machine_cost_records.length,
        recordId: notificationInput.recordId };
    });
    const result = await dieselRouter.createCaller(ctx).mobileCreateRefuel({ ...base, assetType });
    // 在 mock 外检查快照，通知安全 catch 不能吞掉测试断言。
    expect(atNotification).toEqual({ committed: true, auditCount: 1, dieselCount: 1,
      costCount: assetType === "machine" ? 1 : 0, recordId: 20 });
    expect(result).toMatchObject({ success: true, id: 20, amount: 86.1, appliedUnitPrice: 8.61, recordNo: expect.stringMatching(/^DS3/) });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith({ actorUserId: 9, projectId: 3, recordId: 20, assetType, assetId: 13, liters: 10, amount: 86.1, refueledAt });
    expect(db.state.diesel_refuel_records[0]).toMatchObject({ status: "approved", assetType, amount: "86.1", createdBy: 9 });
    if (assetType === "machine") expect(db.state.machine_cost_records[0]).toMatchObject({ dieselRefuelRecordId: 20, status: "approved", amount: "86.1" });
  });

  it.each(["vehicle", "machine"] as const)("%s 五分钟内重复拒绝，不额外写账且不额外通知", async assetType => {
    const caller = dieselRouter.createCaller(ctx);
    await caller.mobileCreateRefuel({ ...base, assetType });
    mocks.notify.mockClear();
    await expect(caller.mobileCreateRefuel({ ...base, assetType })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.diesel_refuel_records).toHaveLength(1);
    expect(db.state.machine_cost_records).toHaveLength(assetType === "machine" ? 1 : 0);
    expect(db.state.audit_logs).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["vehicle", "audit"], ["machine", "audit"], ["machine", "cost"],
    ["vehicle", "commit"], ["machine", "commit"], ["vehicle", "noInsertId"],
  ] as const)("%s 的 %s 失败回滚，绝不调用通知", async (assetType, fault) => {
    db.fault[fault] = true;
    await expect(dieselRouter.createCaller(ctx).mobileCreateRefuel({ ...base, assetType })).rejects.toThrow();
    expect(db.state.diesel_refuel_records).toHaveLength(0);
    expect(db.state.machine_cost_records).toHaveLength(0);
    expect(db.state.audit_logs).toHaveLength(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each(["vehicle", "machine"] as const)("%s 通知 helper 拒绝不影响已提交业务或金额返回", async assetType => {
    mocks.notify.mockRejectedValue(Error("synthetic notification unavailable"));
    await expect(dieselRouter.createCaller(ctx).mobileCreateRefuel({ ...base, assetType })).resolves.toMatchObject({ success: true, id: 20, amount: 86.1 });
    expect(db.committed).toBe(true);
    expect(db.state.diesel_refuel_records).toHaveLength(1);
    expect(db.state.machine_cost_records).toHaveLength(assetType === "machine" ? 1 : 0);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("没有柴油创建权限、项目范围失败或现场凭证无效均不通知", async () => {
    const caller = dieselRouter.createCaller(ctx);
    mocks.permission.mockResolvedValueOnce({ allowed: false, hasDetailedPermissions: true });
    await expect(caller.mobileCreateRefuel(base)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.scope.mockRejectedValueOnce(Error("synthetic scope denied"));
    await expect(caller.mobileCreateRefuel(base)).rejects.toThrow("synthetic scope denied");
    db.state.evidence_records[0].status = "void";
    await expect(caller.mobileCreateRefuel(base)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.state.diesel_refuel_records).toHaveLength(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
