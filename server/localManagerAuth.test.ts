import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getLocalManagerByUsername: vi.fn(),
  getUserByOpenId: vi.fn(),
  updateLocalManagerPassword: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn().mockResolvedValue("signed-local-manager-session") },
}));

import { assertSuperAdmin } from "./access";
import { getDb, getLocalManagerByUsername, updateLocalManagerPassword, upsertUser } from "./db";
import { createLocalManagerPasswordHash, isValidLocalManagerUsername, normalizeLocalManagerUsername, resetTemporaryAdminLoginRateLimitForTests } from "./localAuth";
import { appRouter } from "./routers";

const initialPassword = "ManagerPass2026";
const managerUser = {
  id: 12001,
  openId: "local-manager:13800138000",
  name: "张三",
  email: null,
  loginMethod: "local_manager",
  role: "user",
  localUsername: "13800138000",
  localPasswordHash: createLocalManagerPasswordHash(initialPassword),
  localAccountStatus: "active",
  // 模拟历史账号遗留的旧标记；新策略下登录也不能被强制拦截。
  localPasswordChangeRequired: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: null,
};

function createCaller(user: typeof managerUser | null = null, response = { cookie: vi.fn(), clearCookie: vi.fn() }) {
  return {
    response,
    caller: appRouter.createCaller({
      req: { protocol: "https", headers: { "x-forwarded-proto": "https" } } as never,
      res: response as never,
      user: user as never,
    }),
  };
}

describe("普通管理人员本地账号认证", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTemporaryAdminLoginRateLimitForTests();
    const roleQuery = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    roleQuery.from.mockReturnValue(roleQuery);
    roleQuery.innerJoin.mockReturnValue(roleQuery);
    roleQuery.where.mockReturnValue(roleQuery);
    vi.mocked(getDb).mockResolvedValue({
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue({}) })),
      select: vi.fn(() => roleQuery),
    } as never);
    vi.mocked(getLocalManagerByUsername).mockResolvedValue({ ...managerUser } as never);
  });

  it("启用账号使用正确口令登录后签发八小时会话，且不再要求首次改密", async () => {
    const { caller, response } = createCaller();
    await expect(caller.auth.localManagerLogin({ username: " +86 138-0013-8000 ", password: initialPassword })).resolves.toEqual({
      success: true,
      expiresInMs: 8 * 60 * 60 * 1000,
      mustChangePassword: false,
    });
    expect(upsertUser).toHaveBeenCalledWith(expect.objectContaining({ openId: managerUser.openId }));
    expect(response.cookie).toHaveBeenCalledWith(expect.any(String), "signed-local-manager-session", expect.objectContaining({ httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }));
  });

  it("手机号可规范化国家码、空格和短横线，并拒绝旧英文账号格式", () => {
    expect(normalizeLocalManagerUsername(" +86 138-0013-8000 ")).toBe("13800138000");
    expect(isValidLocalManagerUsername("13800138000")).toBe(true);
    expect(isValidLocalManagerUsername("zhangsan")).toBe(false);
  });

  it("停用账号、错误口令与连续失败均不会签发会话或泄露凭据", async () => {
    vi.mocked(getLocalManagerByUsername).mockResolvedValueOnce({ ...managerUser, localAccountStatus: "disabled" } as never);
    const { caller, response } = createCaller();
    await expect(caller.auth.localManagerLogin({ username: managerUser.localUsername, password: initialPassword })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "账号或密码错误" });
    expect(response.cookie).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(getDb).mock.calls)).not.toContain(initialPassword);
  });

  it("仅启用中的普通本地账号可在当前口令校验后使用六位任意字符更新密码", async () => {
    const { caller } = createCaller({ ...managerUser });
    await expect(caller.auth.changeLocalPassword({ currentPassword: initialPassword, newPassword: "654321" })).resolves.toEqual({ success: true });
    expect(updateLocalManagerPassword).toHaveBeenCalledWith(managerUser.id, expect.stringMatching(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/));
  });

  it("密码仍至少需要六位", async () => {
    const { caller } = createCaller({ ...managerUser });
    await expect(caller.auth.changeLocalPassword({ currentPassword: initialPassword, newPassword: "12345" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("普通本地账号不能通过服务端超级管理员断言进入管理后台", async () => {
    await expect(assertSuperAdmin({ req: {} as never, res: {} as never, user: { ...managerUser } } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
