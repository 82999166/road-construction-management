import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Vitest 会提升模块替身；所有替身必须在提升阶段创建，避免 TDZ 初始化错误。 */
const mocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  createSessionToken: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getDb: vi.fn(),
  auditValues: vi.fn(),
  notifyWecomBusinessEvent: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    getUserInfo: mocks.getUserInfo,
    createSessionToken: mocks.createSessionToken,
  },
}));

vi.mock("./db", () => ({
  upsertUser: mocks.upsertUser,
  getUserByOpenId: mocks.getUserByOpenId,
  getDb: mocks.getDb,
}));

vi.mock("./services/businessNotifier", () => ({ notifyWecomBusinessEvent: mocks.notifyWecomBusinessEvent }));

import { registerOAuthRoutes } from "./_core/oauth";

type CallbackHandler = (req: any, res: any) => Promise<void>;

function registerCallback(): CallbackHandler {
  let callbackHandler: CallbackHandler | undefined;
  registerOAuthRoutes({
    get: vi.fn((path: string, handler: CallbackHandler) => {
      if (path === "/api/oauth/callback") callbackHandler = handler;
    }),
  } as any);
  if (!callbackHandler) throw new Error("OAuth callback route was not registered");
  return callbackHandler;
}

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    redirect: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("OAuth 登录安全审计", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchangeCodeForToken.mockResolvedValue({ accessToken: "access-should-not-be-audited" });
    mocks.getUserInfo.mockResolvedValue({
      openId: "oauth-user-1",
      name: "现场成员",
      email: "member@example.com",
      loginMethod: "manus",
    });
    mocks.createSessionToken.mockResolvedValue("session-token");
    mocks.upsertUser.mockResolvedValue(undefined);
    mocks.getUserByOpenId.mockResolvedValue({ id: 42, openId: "oauth-user-1" });
    mocks.auditValues.mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue({ insert: vi.fn(() => ({ values: mocks.auditValues })) });
    mocks.notifyWecomBusinessEvent.mockResolvedValue({ delivered: true });
  });

  it("成功登录只记录最小化安全审计并异步发送不含身份敏感信息的提醒", async () => {
    const handler = registerCallback();
    const state = encodeOAuthState({ redirectUri: "https://app.example/callback", nonce: "csrf-nonce" });
    const response = createResponse();

    await handler(
      { query: { code: "authorization-code", state }, headers: { cookie: `${OAUTH_STATE_COOKIE}=csrf-nonce` }, protocol: "https" },
      response,
    );

    expect(mocks.auditValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      module: "security",
      action: "oauth_login_success",
      targetType: "account",
      targetId: "42",
      summary: "企业统一身份登录成功",
    }));
    expect(JSON.stringify(mocks.auditValues.mock.calls[0]?.[0])).not.toContain("member@example.com");
    expect(JSON.stringify(mocks.auditValues.mock.calls[0]?.[0])).not.toContain("authorization-code");
    expect(JSON.stringify(mocks.auditValues.mock.calls[0]?.[0])).not.toContain("access-should-not-be-audited");
    expect(mocks.notifyWecomBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      module: "security",
      eventCode: "oauth_login_success",
      title: "账号安全提醒：已完成统一身份登录",
      deepLink: "/mobile/profile",
    }));
    expect(response.cookie).toHaveBeenCalledWith(expect.any(String), "session-token", expect.objectContaining({ httpOnly: true }));
    expect(response.redirect).toHaveBeenCalledWith(302, "/");
  });

  it("认证服务失败时仅写入固定失败审计且返回通用失败响应", async () => {
    const handler = registerCallback();
    const state = encodeOAuthState({ redirectUri: "https://app.example/callback", nonce: "csrf-nonce" });
    const response = createResponse();
    mocks.exchangeCodeForToken.mockRejectedValue(new Error("upstream failure with secret details"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await handler(
      { query: { code: "authorization-code", state }, headers: { cookie: `${OAUTH_STATE_COOKIE}=csrf-nonce` }, protocol: "https" },
      response,
    );

    expect(mocks.auditValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      module: "security",
      action: "oauth_login_failed",
      targetType: "oauth_callback",
      targetId: null,
      summary: "企业统一身份登录回调失败",
    }));
    expect(JSON.stringify(mocks.auditValues.mock.calls[0]?.[0])).not.toContain("secret details");
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: "OAuth callback failed" });
    expect(mocks.notifyWecomBusinessEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
