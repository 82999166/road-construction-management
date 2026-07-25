import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 路由测试隔离数据库和数据范围基础设施，只验证机械、运输的业务权限与状态边界。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
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
import { machineryRouter, transportRouter } from "./routers/operations";

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

describe("机械与运输 tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  });

  it("机械台账列表在读取前强制校验调用方的项目数据范围", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MACHINERY_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(machineryRouter.createCaller(createAuthContext()).listMachines({ projectId: 10 })).resolves.toEqual([]);
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
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
});
