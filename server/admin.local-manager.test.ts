import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { appRouter } from "./routers";

const adminUser = {
  id: 9100,
  openId: "super-admin",
  name: "超级管理员",
  email: null,
  loginMethod: "temporary_local",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createCaller(user: typeof adminUser | null = adminUser) {
  return appRouter.createCaller({
    req: { protocol: "https", headers: { "x-forwarded-proto": "https" } } as never,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as never,
    user: user as never,
  });
}

describe("后台普通管理人员本地账号管理", () => {
  beforeEach(() => vi.clearAllMocks());

  it("超级管理员可创建普通本地账号，密码仅以不可逆摘要写入且审计不包含初始密码", async () => {
    const insertValues = vi.fn().mockResolvedValue({});
    const limit = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7301 }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(() => ({ from })),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const initialPassword = "123456";
    await expect(createCaller().admin.personnel.createLocalUser({
      username: "zhangsan",
      displayName: "张三",
      initialPassword,
      status: "active",
      wecomUserId: "zhangsan-wecom",
    })).resolves.toEqual({ success: true, userId: 7301 });

    const payloads = insertValues.mock.calls.map(([payload]) => payload);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        openId: "local-manager:zhangsan",
        localUsername: "zhangsan",
        loginMethod: "local_manager",
        role: "user",
        localAccountStatus: "active",
        localPasswordChangeRequired: false,
        localPasswordHash: expect.stringMatching(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/),
      }),
      expect.objectContaining({ userId: 7301, wecomUserId: "zhangsan-wecom" }),
      expect.objectContaining({ action: "create_local_manager_account", targetId: "7301" }),
    ]));
    expect(JSON.stringify(payloads)).not.toContain(initialPassword);
  });

  it("超级管理员可启停后台创建的普通账号，普通人员不能调用任何后台账号管理接口", async () => {
    const auditValues = vi.fn().mockResolvedValue({});
    const limit = vi.fn().mockResolvedValue([{ id: 7301, name: "张三", loginMethod: "local_manager" }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const updateWhere = vi.fn().mockResolvedValue({});
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const statusDb = {
      select: vi.fn(() => ({ from })),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    const roleQuery = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue([]) };
    roleQuery.from.mockReturnValue(roleQuery);
    roleQuery.innerJoin.mockReturnValue(roleQuery);
    roleQuery.where.mockReturnValue(roleQuery);
    vi.mocked(getDb)
      .mockResolvedValueOnce(statusDb as never)
      .mockResolvedValueOnce({ select: vi.fn(() => roleQuery) } as never)
      .mockResolvedValueOnce({ select: vi.fn(() => roleQuery) } as never);

    await expect(createCaller().admin.personnel.setLocalUserStatus({ userId: 7301, status: "disabled" })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ localAccountStatus: "disabled" }));
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ action: "disable_local_manager_account" }));

    const ordinaryUser = { ...adminUser, id: 7301, role: "user", loginMethod: "local_manager" };
    await expect(createCaller(ordinaryUser).admin.personnel.createLocalUser({
      username: "lisi",
      displayName: "李四",
      initialPassword: "ManagerPass2026",
      status: "active",
      wecomUserId: null,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createCaller(ordinaryUser).admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("超级管理员不能向普通本地账号授予 SUPER_ADMIN 角色", async () => {
    const targetLimit = vi.fn()
      .mockResolvedValueOnce([{ id: 7301, loginMethod: "local_manager" }])
      .mockResolvedValueOnce([{ code: "SUPER_ADMIN" }]);
    const targetWhere = vi.fn(() => ({ limit: targetLimit }));
    const targetFrom = vi.fn(() => ({ where: targetWhere }));
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => ({ from: targetFrom })) } as never);

    await expect(createCaller().admin.personnel.saveAssignment({
      userId: 7301,
      roleId: 99,
      organizationId: null,
      projectId: null,
      validFrom: null,
      validTo: null,
      status: "active",
    })).rejects.toMatchObject({ code: "FORBIDDEN", message: "普通管理人员账号不得被授予超级管理员权限" });
  });
});
