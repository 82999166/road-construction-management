import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { mockCreateInAppMessage, mockNotifyWecomBusinessEvent } = vi.hoisted(() => ({
  mockCreateInAppMessage: vi.fn(),
  mockNotifyWecomBusinessEvent: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./routers/messages", () => ({ createInAppMessage: mockCreateInAppMessage }));
vi.mock("./services/businessNotifier", () => ({ notifyWecomBusinessEvent: mockNotifyWecomBusinessEvent }));

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
    return {
      where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
    };
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
    mockNotifyWecomBusinessEvent.mockResolvedValue({ delivered: true, reason: "sent" });
  });

  it("角色权限更新后发送最小化企业微信安全通知，且投递失败不回滚权限写入", async () => {
    const db = createAdminDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    mockNotifyWecomBusinessEvent.mockRejectedValueOnce(new Error("通知通道暂不可用"));

    await expect(adminRouter.createCaller(createAdminContext()).role.setPermissions({ roleId: 12, permissionIds: [3, 4] })).resolves.toEqual({ success: true });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insertedValues).toEqual(expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ roleId: 12, permissionId: 3 })])]));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "role_permissions_updated", targetType: "role", targetId: "12", deepLink: "/admin/permission" }));
  });

  it("人员授权变更同时写入用户可见的站内提醒和企业微信审计事件", async () => {
    const db = createAdminDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).personnel.saveAssignment({ userId: 18, roleId: 6, projectId: 88, organizationId: null, validFrom: null, validTo: null, status: "active" })).resolves.toEqual({ success: true });

    expect(mockCreateInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 18, eventCode: "user_access_updated", deepLink: "/mobile/profile" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "user_access_updated", targetType: "user", targetId: "18" }));
  });

  it("外部连接测试失败仍记录审计并生成不含连接地址的系统异常提醒", async () => {
    const db = createAdminDb([[{ id: 9, settingKey: "REMOTE_ENDPOINT", displayName: "远程服务", isSensitive: false, valueJson: "https://example.com/service" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503 })));

    const result = await adminRouter.createCaller(createAdminContext()).settings.test({ id: 9 });

    expect(result.success).toBe(false);
    expect(mockCreateInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "system_connector_test_failed", recipientUserId: 1, deepLink: "/admin/settings" }));
    expect(mockNotifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "system_connector_test_failed", targetType: "setting", targetId: "9" }));
    expect(JSON.stringify(mockCreateInAppMessage.mock.calls)).not.toContain("https://example.com/service");
    vi.unstubAllGlobals();
  });
});
