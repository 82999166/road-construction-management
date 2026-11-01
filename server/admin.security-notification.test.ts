import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { mockCreateInAppMessage, mockNotifyOfficialAccountBusinessEventSafely } = vi.hoisted(() => ({
  mockCreateInAppMessage: vi.fn(),
  mockNotifyOfficialAccountBusinessEventSafely: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./routers/messages", () => ({ createInAppMessage: mockCreateInAppMessage }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mockNotifyOfficialAccountBusinessEventSafely }));

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 构造不依赖真实身份提供方的最小超级管理员上下文。 */
function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-security-notification-test",
    email: "admin@example.com",
    name: "安全通知测试管理员",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 支持权限保存、授权写入和配置连通性测试的最小数据库替身。 */
function createAdminDb(selectResponses: unknown[][] = []) {
  let selectIndex = 0;
  const insertedValues: unknown[] = [];
  const query = () => {
    const rows = selectResponses[selectIndex++] ?? [];
    const result = Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) }) as Promise<unknown[]> & { where?: ReturnType<typeof vi.fn> };
    result.where = vi.fn(() => result);
    return result;
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => query()) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { insertedValues.push(value); }) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    insertedValues,
  };
}

describe("后台安全通知", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
    mockCreateInAppMessage.mockResolvedValue({ created: true });
    mockNotifyOfficialAccountBusinessEventSafely.mockResolvedValue([]);
  });

  it("角色权限更新后发送最小化公众号安全通知，且投递失败不回滚权限写入", async () => {
    const db = createAdminDb([[{ id: 12, name: "运输管理员" }], [{ id: 3 }, { id: 4 }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    mockNotifyOfficialAccountBusinessEventSafely.mockRejectedValueOnce(new Error("通知通道暂不可用"));

    await expect(adminRouter.createCaller(createAdminContext()).role.setPermissions({ roleId: 12, permissionIds: [3, 4] })).resolves.toEqual({ success: true });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insertedValues).toEqual(expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ roleId: 12, permissionId: 3 })]) ]));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "role_permissions_updated", targetType: "role", targetId: "12", deepLink: "/admin/permission" }));
  });

  it("人员授权变更同时写入用户可见的站内提醒和公众号投递事件", async () => {
    const db = createAdminDb([[{ id: 18, loginMethod: "oauth" }], [{ code: "SUPER_ADMIN" }], [{ id: 88, status: "active" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({ userId: 18, roleId: 6, projectId: 88, organizationId: null, validFrom: null, validTo: null, status: "active" })).resolves.toEqual({ success: true });

    expect(mockCreateInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 18, eventCode: "user_access_updated", deepLink: "/mobile/profile" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "user_access_updated", targetType: "user", targetId: "18" }));
  });

  it("普通业务角色授权必须绑定启用的部门或项目部", async () => {
    const db = createAdminDb([[{ id: 18, loginMethod: "oauth" }], [{ code: "LABOR_MANAGER" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({ userId: 18, roleId: 6, projectId: null, organizationId: null, validFrom: null, validTo: null, status: "active" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "业务角色至少须选择所属部门/项目部或具体项目范围",
    });
  });

  it("超级管理员可为有效部门启用标准业务模块并写入审计", async () => {
    const db = createAdminDb([[{ id: 22, type: "department", status: "active" }], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).department.saveScope({ scopeType: "organization", scopeId: 22, module: "LABOR", status: "active" })).resolves.toEqual({ success: true });

    expect(db.insertedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: 22, module: "LABOR", status: "active", configuredBy: 1 }),
      expect.objectContaining({ module: "department", action: "enable_business_scope", targetId: "organization:22:LABOR" }),
    ]));
  });

  it("超级管理员可直接为已有未归档项目启用业务模块，不要求先建立组织节点", async () => {
    const db = createAdminDb([[{ id: 88, status: "active" }], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).department.saveScope({ scopeType: "project", scopeId: 88, module: "CONSTRUCTION", status: "active" })).resolves.toEqual({ success: true });

    expect(db.insertedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: null, projectId: 88, module: "CONSTRUCTION", status: "active", configuredBy: 1 }),
      expect.objectContaining({ module: "department", action: "enable_business_scope", targetId: "project:88:CONSTRUCTION" }),
    ]));
  });

  it("外部连接测试失败仍记录审计并生成不含连接地址的系统异常提醒", async () => {
    const db = createAdminDb([[{ id: 9, settingKey: "REMOTE_ENDPOINT", displayName: "远程服务", isSensitive: false, valueJson: "https://example.com/service" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503 })));

    const result = await adminRouter.createCaller(createAdminContext()).settings.test({ id: 9 });

    expect(result.success).toBe(false);
    expect(mockCreateInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "system_connector_test_failed", recipientUserId: 1, deepLink: "/admin/settings" }));
    expect(mockNotifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "system_connector_test_failed", targetType: "setting", targetId: "9" }));
    expect(JSON.stringify(mockCreateInAppMessage.mock.calls)).not.toContain("https://example.com/service");
    vi.unstubAllGlobals();
  });
});
