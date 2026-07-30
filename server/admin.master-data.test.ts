import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 主数据路由测试使用内存桩，验证超级管理员守卫后的业务约束而不访问真实组织数据。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageGetSignedUrl: vi.fn() }));

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";
import { storagePut } from "./storage";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 构造最小超级管理员上下文；每个过程仍显式经过服务端守卫模拟。 */
function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "master-data-admin",
    email: "admin@example.com",
    name: "主数据管理员",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 按查询顺序返回单条记录，覆盖组织、项目与授权过程的逐层主数据验证。 */
function createSequentialLimitDb(...responses: unknown[][]) {
  let queryIndex = 0;
  const values = vi.fn(async () => undefined);
  const nextResponse = async () => responses[queryIndex++] ?? [];
  const writeWhere = vi.fn(async () => undefined);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const result = {
            limit: vi.fn(nextResponse),
            then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => nextResponse().then(resolve, reject),
          };
          return result;
        }),
      })),
    })),
    insert: vi.fn(() => ({ values })),
    delete: vi.fn(() => ({ where: writeWhere })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: writeWhere })) })),
    values,
    writeWhere,
  };
}

const organizationInput = {
  code: "DEPT_TRANSPORT",
  name: "运输管理部",
  type: "department" as const,
  managerUserId: null,
  costCenterCode: null,
  sortOrder: 0,
  status: "active" as const,
};

const vehicleInput = {
  projectId: 20,
  organizationId: null,
  plateNo: "粤A12345",
  vehicleType: "dump_truck" as const,
  ownerName: "自有车辆",
  driverUserId: null,
  boxLengthMeters: 6.2,
  boxWidthMeters: 2.3,
  boxHeightMeters: 1.4,
  loadFactor: 1,
  payloadTons: 20,
  status: "active" as const,
};

describe("超级管理主数据约束", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
  });

  it("拒绝组织节点选择自身或停用节点作为上级", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    await expect(adminRouter.createCaller(createAdminContext()).organization.save({ ...organizationInput, id: 7, parentId: 7 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("自身") });

    const db = createSequentialLimitDb([{ id: 8, parentId: null, status: "disabled" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(adminRouter.createCaller(createAdminContext()).organization.save({ ...organizationInput, parentId: 8 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("已启用") });
  });

  it("拒绝项目结束日期早于开始日期，避免无效计划节点写入", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    await expect(adminRouter.createCaller(createAdminContext()).project.save({
      code: "GZ-01",
      name: "高速一标段",
      nodeType: "项目",
      projectType: "highway",
      status: "planning",
      startDate: "2026-08-31",
      endDate: "2026-08-01",
      sortOrder: 0,
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("结束日期") });
  });

  it("业务角色授权拒绝归档项目，防止历史项目重新获得业务写入范围", async () => {
    const db = createSequentialLimitDb(
      [{ id: 12, loginMethod: "oauth" }],
      [{ code: "TRANSPORT_MANAGER" }],
      [{ type: "department", status: "active" }],
      [{ status: "archived" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({
      userId: 12,
      roleId: 3,
      organizationId: 9,
      projectId: 20,
      status: "active",
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("未归档") });
  });

  it("业务角色可直接绑定具体项目范围，不要求重复设置部门范围", async () => {
    const db = createSequentialLimitDb(
      [{ id: 12, loginMethod: "oauth" }],
      [{ code: "LOGISTICS_MANAGER" }],
      [{ status: "active" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({
      userId: 12,
      roleId: 9,
      organizationId: null,
      projectId: 20,
      status: "active",
    })).resolves.toEqual({ success: true });

    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, roleId: 9, organizationId: null, projectId: 20 }));
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ module: "permission", action: "grant_role", targetType: "user" }));
  });

  it("同时选择部门和具体项目时保存为最小的具体项目范围", async () => {
    const db = createSequentialLimitDb(
      [{ id: 12, loginMethod: "oauth" }],
      [{ code: "LOGISTICS_MANAGER" }],
      [{ type: "department", status: "active" }],
      [{ status: "active" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({
      userId: 12,
      roleId: 9,
      organizationId: 31,
      projectId: 20,
      status: "active",
    })).resolves.toEqual({ success: true });

    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, roleId: 9, organizationId: null, projectId: 20 }));
  });

  it("保存有效组织负责人时写入组织记录与最小化审计", async () => {
    const db = createSequentialLimitDb([{ id: 18 }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).organization.save({
      ...organizationInput,
      managerUserId: 18,
    })).resolves.toEqual({ success: true });

    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ managerUserId: 18, code: "DEPT_TRANSPORT" }));
    expect(db.values).toHaveBeenLastCalledWith(expect.objectContaining({ module: "organization", action: "create", targetType: "organization" }));
  });

  it("拒绝与既有台账重复的车牌，防止同一车辆在运输结算中被重复引用", async () => {
    const db = createSequentialLimitDb(
      [{ id: 20, status: "active" }],
      [{ id: 99 }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).vehicle.save(vehicleInput)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("车牌") });
  });

  it("拒绝直接停用存在未结算趟次的车辆", async () => {
    const db = createSequentialLimitDb(
      [{ id: 20, status: "active" }],
      [],
      [{ id: 7, projectId: 20, status: "active" }],
      [{ id: 300, status: "submitted" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).vehicle.save({ ...vehicleInput, id: 7, status: "disabled" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("未结算") });
  });

  it("保存有效车辆时写入唯一运输台账和最小化审计", async () => {
    const db = createSequentialLimitDb(
      [{ id: 20, status: "active" }],
      [],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).vehicle.save(vehicleInput)).resolves.toMatchObject({ success: true, theoreticalVolumeCubicMeters: 19.964 });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ plateNo: "粤A12345", vehicleType: "dump_truck", projectId: 20 }));
    expect(db.values).toHaveBeenLastCalledWith(expect.objectContaining({ module: "transport", action: "admin_create_vehicle", targetType: "transport_vehicle" }));
  });

  it("仅删除未被人员档案引用的岗位，并记录最小化审计", async () => {
    const db = createSequentialLimitDb(
      [{ id: 6, name: "运输调度员" }],
      [],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).masterData.remove({ resource: "position", id: 6 })).resolves.toEqual({ success: true, operation: "deleted" });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenLastCalledWith(expect.objectContaining({ module: "position", action: "delete", targetType: "position", targetId: "6" }));
  });

  it("阻止删除已产生运输趟次的车辆，要求改为停用", async () => {
    const db = createSequentialLimitDb(
      [{ id: 9, plateNo: "粤A88888" }],
      [{ id: 501 }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).masterData.remove({ resource: "vehicle", id: 9 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("运输趟次") });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("禁止删除系统内置角色，避免破坏基础权限模型", async () => {
    const db = createSequentialLimitDb([{ id: 1, name: "超级管理员", isSystem: true }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).masterData.remove({ resource: "role", id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("系统内置角色") });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("撤销角色授权而非物理删除，保留权限历史和审计证据", async () => {
    const db = createSequentialLimitDb([{ id: 31, userId: 18, roleId: 4, status: "active" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).masterData.remove({ resource: "role_assignment", id: 31 })).resolves.toEqual({ success: true, operation: "revoked" });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.values).toHaveBeenLastCalledWith(expect.objectContaining({ module: "permission", action: "revoke_assignment", targetType: "user_role_assignment", targetId: "31" }));
  });

  it("超级管理员创建业务数据备份时仅归档脱敏业务快照并保留审计", async () => {
    const values = vi.fn(() => ({ $returningId: async () => [{ id: 77 }] }));
    const db = {
      select: vi.fn(() => ({ from: vi.fn(async () => [{ total: 0 }]) })),
      insert: vi.fn(() => ({ values })),
      values,
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(storagePut).mockResolvedValue({ key: "admin-backups/verified.json", url: "/manus-storage/admin-backups/verified.json" });

    await expect(adminRouter.createCaller(createAdminContext()).backup.create()).resolves.toMatchObject({ id: 77, recordCount: 0, scopeVersion: "business-v1" });

    const snapshot = String(vi.mocked(storagePut).mock.calls[0]?.[1] ?? "");
    expect(snapshot).toContain("road-construction-management-logical-backup");
    expect(snapshot).not.toContain("localPasswordHash");
    expect(values).toHaveBeenLastCalledWith(expect.objectContaining({ module: "backup", action: "create", targetType: "business_data_backup" }));
  });
});
