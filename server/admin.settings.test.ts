import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 后台设置测试使用内存桩，避免访问真实数据库、密文或外部服务号接口。 */
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

/** 已发布成组配置查询的最小桩；用于验证敏感配置不会通过状态接口回显。 */
function createPublishedSettingsDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => rows) })),
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

  it("认证服务号 AppSecret 在配置列表中只返回掩码预览，并过滤已退役的企业微信 Webhook", async () => {
    const appSecret = "official-account-secret-value";
    const db = createListDb([
      {
        id: 8,
        category: "notification",
        settingKey: "WECHAT_WORK_WEBHOOK",
        displayName: "企业微信机器人",
        valueJson: null,
        valuePreview: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****",
        isSensitive: true,
        status: "disabled",
        version: 1,
        publishedAt: null,
        updatedAt: new Date(),
        remarks: "历史配置",
      },
      {
        id: 9,
        category: "wechat_official",
        settingKey: "WECHAT_OFFICIAL_APP_SECRET",
        displayName: "认证服务号 AppSecret",
        valueJson: null,
        valuePreview: "offi****alue",
        isSensitive: true,
        status: "published",
        version: 1,
        publishedAt: new Date(),
        updatedAt: new Date(),
        remarks: "加密托管",
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await adminRouter.createCaller(createAdminContext()).settings.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.settingKey).toBe("WECHAT_OFFICIAL_APP_SECRET");
    expect(result[0]).not.toHaveProperty("secretEncrypted");
    expect(JSON.stringify(result)).not.toContain(appSecret);
    expect(result[0]?.valuePreview).toContain("****");
  });

  it("认证服务号敏感配置版本历史删除密文、明文快照和原始快照字符串", async () => {
    const appSecret = "official-account-history-secret";
    const db = createHistoryDb([{
      id: 17,
      settingId: 9,
      operation: "publish",
      version: 1,
      operatorId: 1,
      createdAt: new Date(),
      snapshotJson: JSON.stringify({
        category: "wechat_official",
        settingKey: "WECHAT_OFFICIAL_APP_SECRET",
        displayName: "认证服务号 AppSecret",
        valueJson: appSecret,
        secretEncrypted: `cipher:${appSecret}`,
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
    expect(JSON.stringify(result)).not.toContain(appSecret);
  });

  it("OSS 照片存储状态仅返回掩码状态和非敏感参数，不回显 AccessKey 明文或密文", async () => {
    const accessKeyId = "oss-access-key-id-secret";
    const accessKeySecret = "oss-access-key-secret-value";
    const db = createPublishedSettingsDb([
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_ENABLED", valueJson: "true", valuePreview: "true", secretEncrypted: null },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_REGION", valueJson: "oss-cn-hangzhou", valuePreview: "oss-cn-hangzhou", secretEncrypted: null },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_ENDPOINT", valueJson: "https://oss-cn-hangzhou.aliyuncs.com", valuePreview: "https://oss-cn-hangzhou.aliyuncs.com", secretEncrypted: null },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_BUCKET", valueJson: "project-photo-archive", valuePreview: "project-photo-archive", secretEncrypted: null },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_PREFIX", valueJson: "photos", valuePreview: "photos", secretEncrypted: null },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_ID", valueJson: null, valuePreview: "********-id", secretEncrypted: `cipher:${accessKeyId}` },
      { settingKey: "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_SECRET", valueJson: null, valuePreview: "********alue", secretEncrypted: `cipher:${accessKeySecret}` },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await adminRouter.createCaller(createAdminContext()).settings.getAliyunOssPhotoStorageConfiguration();

    expect(result).toMatchObject({ configured: true, enabled: true, region: "oss-cn-hangzhou", bucket: "project-photo-archive", accessKeyIdConfigured: true, accessKeySecretConfigured: true });
    expect(result).not.toHaveProperty("accessKeyId");
    expect(result).not.toHaveProperty("accessKeySecret");
    expect(JSON.stringify(result)).not.toContain(accessKeyId);
    expect(JSON.stringify(result)).not.toContain(accessKeySecret);
  });
});
