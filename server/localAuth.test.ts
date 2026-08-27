import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  hasPermanentAdministrator: vi.fn(),
  getLoginRateLimitState: vi.fn().mockResolvedValue(undefined),
  recordLoginRateLimitFailure: vi.fn().mockResolvedValue(undefined),
  clearLoginRateLimitState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn().mockResolvedValue("signed-temporary-admin-session") },
}));

import { assertSuperAdmin } from "./access";
import { getDb, getLoginRateLimitState, getUserByOpenId, hasPermanentAdministrator, upsertUser } from "./db";
import { resetTemporaryAdminLoginRateLimitForTests, shouldBlockTemporaryAdminLogin } from "./localAuth";
import { appRouter } from "./routers";

function createUnauthenticatedCaller(response = { cookie: vi.fn(), clearCookie: vi.fn() }) {
  return {
    response,
    caller: appRouter.createCaller({
      req: { protocol: "https", headers: { "x-forwarded-proto": "https" } } as never,
      res: response as never,
      user: null,
    }),
  };
}

describe("临时本地超级管理员登录", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTemporaryAdminLoginRateLimitForTests();
    vi.mocked(getLoginRateLimitState).mockResolvedValue(undefined);
    vi.mocked(getDb).mockResolvedValue({
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue({}) })),
    } as never);
    vi.mocked(getUserByOpenId).mockResolvedValue({
      id: 9001,
      openId: "local-temporary-super-admin",
      name: "临时超级管理员",
      email: null,
      loginMethod: "temporary_local",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as never);
    vi.mocked(hasPermanentAdministrator).mockResolvedValue(false);
  });

  it("生产环境已有正式管理员时默认关闭临时入口，仅显式应急开关可保留", () => {
    expect(shouldBlockTemporaryAdminLogin({ isProduction: true, configuredOverride: "", hasPermanentAdministrator: true })).toBe(true);
    expect(shouldBlockTemporaryAdminLogin({ isProduction: true, configuredOverride: "true", hasPermanentAdministrator: true })).toBe(false);
    expect(shouldBlockTemporaryAdminLogin({ isProduction: false, configuredOverride: "", hasPermanentAdministrator: true })).toBe(false);
    expect(shouldBlockTemporaryAdminLogin({ isProduction: true, configuredOverride: "false", hasPermanentAdministrator: false })).toBe(true);
    expect(shouldBlockTemporaryAdminLogin({ isProduction: true, configuredOverride: "unexpected", hasPermanentAdministrator: true })).toBe(true);
  });

  it("持久化锁定窗口存在时不得因服务重启后的内存清空而重新签发临时会话", async () => {
    vi.mocked(getLoginRateLimitState).mockResolvedValue({
      failureCount: 5,
      windowStartedAt: new Date(Date.now() - 1_000),
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const { caller, response } = createUnauthenticatedCaller();

    await expect(caller.auth.localAdminLogin({
      username: process.env.TEMP_ADMIN_USERNAME!,
      password: process.env.TEMP_ADMIN_PASSWORD!,
    })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("使用部署环境中的临时账号和口令可获取八小时受签名会话", async () => {
    const username = process.env.TEMP_ADMIN_USERNAME;
    const password = process.env.TEMP_ADMIN_PASSWORD;
    expect(username).toBeTruthy();
    expect(password).toBeTruthy();

    const { caller, response } = createUnauthenticatedCaller();
    await expect(caller.auth.localAdminLogin({ username: username!, password: password! })).resolves.toMatchObject({ success: true });

    expect(upsertUser).toHaveBeenCalledWith(expect.objectContaining({ role: "admin", loginMethod: "temporary_local" }));
    expect(response.cookie).toHaveBeenCalledWith(
      expect.any(String),
      "signed-temporary-admin-session",
      expect.objectContaining({ httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }),
    );
  });

  it("错误口令不会签发会话，且对外错误信息不包含环境变量中的口令", async () => {
    const { caller, response } = createUnauthenticatedCaller();
    try {
      await caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: "incorrect-password" });
      throw new Error("错误口令不应通过认证");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHORIZED", message: "账号或密码错误" });
      expect(JSON.stringify(error)).not.toContain(process.env.TEMP_ADMIN_PASSWORD!);
    }
    expect(response.cookie).not.toHaveBeenCalled();
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it("连续五次错误登录后短时间内拒绝后续尝试，即使改用正确口令也不签发会话", async () => {
    const { caller, response } = createUnauthenticatedCaller();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: "incorrect-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: "incorrect-password" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: process.env.TEMP_ADMIN_PASSWORD! })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("成功和失败审计只保留固定事件摘要，不记录临时口令", async () => {
    const auditValues = vi.fn().mockResolvedValue({});
    vi.mocked(getDb).mockResolvedValue({
      insert: vi.fn(() => ({ values: auditValues })),
    } as never);
    const { caller } = createUnauthenticatedCaller();

    await expect(caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: "incorrect-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: process.env.TEMP_ADMIN_PASSWORD! });

    const auditPayloads = auditValues.mock.calls.map(([value]) => value);
    expect(auditPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "temporary_admin_login_failed", summary: "临时超级管理员登录失败" }),
      expect.objectContaining({ action: "temporary_admin_login_success", summary: "临时超级管理员登录成功" }),
    ]));
    expect(JSON.stringify(auditPayloads)).not.toContain(process.env.TEMP_ADMIN_PASSWORD!);
  });

  it("临时账号以管理员角色通过服务端后台断言，并可沿用统一安全退出清除会话 Cookie", async () => {
    const { caller, response } = createUnauthenticatedCaller();
    await caller.auth.localAdminLogin({ username: process.env.TEMP_ADMIN_USERNAME!, password: process.env.TEMP_ADMIN_PASSWORD! });

    await expect(assertSuperAdmin({
      req: {} as never,
      res: response as never,
      user: {
        id: 9001,
        openId: "local-temporary-super-admin",
        name: "临时超级管理员",
        email: null,
        loginMethod: "temporary_local",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    } as never)).resolves.toMatchObject({ role: "admin" });

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(response.clearCookie).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxAge: -1 }));
  });
});
