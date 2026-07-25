import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 后台设置测试使用内存桩，避免访问真实数据库、密文或外部企业微信服务。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 构造最小超级管理员会话，权限判断仍通过 mock 的服务端守卫显式模拟。 */
function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-setting-test",
    email: "admin@example.com",
    name: "配置管理员",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 配置列表查询专用的轻量 Drizzle 链式桩。 */
function createListDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })),
    })),
  };
}

/** 配置版本历史查询专用的轻量 Drizzle 链式桩。 */
function createHistoryDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })) })),
      })),
    })),
  };
}

describe("后台敏感配置读取边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
  });

  it("企业微信 Webhook 在配置列表中只返回掩码预览，不返回密文或明文", async () => {
    const realWebhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=real-secret-key";
    const db = createListDb([{
      id: 9,
      category: "notification",
      settingKey: "WECHAT_WORK_WEBHOOK",
      displayName: "企业微信机器人",
      valueJson: null,
      valuePreview: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****",
      isSensitive: true,
      status: "published",
      version: 1,
      publishedAt: new Date(),
      updatedAt: new Date(),
      remarks: "加密托管",
    }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await adminRouter.createCaller(createAdminContext()).settings.list();

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("secretEncrypted");
    expect(JSON.stringify(result)).not.toContain(realWebhook);
    expect(result[0]?.valuePreview).toContain("****");
  });

  it("敏感配置版本历史删除密文、明文快照和原始快照字符串", async () => {
    const realWebhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=history-secret";
    const db = createHistoryDb([{
      id: 17,
      settingId: 9,
      operation: "publish",
      version: 1,
      operatorId: 1,
      createdAt: new Date(),
      snapshotJson: JSON.stringify({
        category: "notification",
        settingKey: "WECHAT_WORK_WEBHOOK",
        displayName: "企业微信机器人",
        valueJson: realWebhook,
        secretEncrypted: `cipher:${realWebhook}`,
        valuePreview: "****",
        isSensitive: true,
      }),
    }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await adminRouter.createCaller(createAdminContext()).settings.history({ settingId: 9 });

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("snapshotJson");
    expect(result[0]?.snapshot).not.toHaveProperty("secretEncrypted");
    expect(result[0]?.snapshot).not.toHaveProperty("valueJson");
    expect(JSON.stringify(result)).not.toContain(realWebhook);
  });
});
