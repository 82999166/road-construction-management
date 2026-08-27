import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./services/secretVault", () => ({
  decryptSecret: vi.fn((value: string) => value.replace(/^cipher:/, "")),
  encryptSecret: vi.fn(() => "cipher:opaque-value"),
  maskSecret: vi.fn(() => "********MASK"),
}));
vi.mock("./services/officialAccountNotifier", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/officialAccountNotifier")>();
  return { ...actual, listPublishedOfficialAccountPrivateTemplates: vi.fn(), testPublishedOfficialAccountConfiguration: vi.fn() };
});
vi.mock("./services/aliyunOssPhotoStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/aliyunOssPhotoStorage")>();
  return { ...actual, testAliyunOssPhotoStorageConnection: vi.fn() };
});

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";
import { encryptSecret, maskSecret } from "./services/secretVault";
import { listPublishedOfficialAccountPrivateTemplates, testPublishedOfficialAccountConfiguration } from "./services/officialAccountNotifier";
import { testAliyunOssPhotoStorageConnection } from "./services/aliyunOssPhotoStorage";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-settings-workflow",
    email: "admin@example.com",
    name: "系统配置管理员",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 支持配置路由的 select / update / insert 链，并记录写入参数供安全断言使用。 */
function createSettingsDb(selectResponses: unknown[][] = []) {
  let index = 0;
  const take = () => selectResponses[index++] ?? [];
  const insertedValues: unknown[] = [];
  const updatedValues: unknown[] = [];
  const deletedTargets: unknown[] = [];
  const createQuery = () => {
    let settled = false;
    let rows: unknown[] = [];
    const readRows = () => {
      if (!settled) {
        rows = take();
        settled = true;
      }
      return rows;
    };
    const query: Record<string, unknown> = {};
    query.where = vi.fn(() => query);
    query.orderBy = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.innerJoin = vi.fn(() => query);
    query.leftJoin = vi.fn(() => query);
    query.then = (onFulfilled?: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(readRows()).then(onFulfilled, onRejected);
    return query;
  };
  const db: Record<string, unknown> = {
    select: vi.fn(() => ({ from: vi.fn(() => createQuery()) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { insertedValues.push(value); }) })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => { updatedValues.push(value); return { where: vi.fn(async () => undefined) }; }) })),
    delete: vi.fn(() => ({ where: vi.fn(async (target: unknown) => { deletedTargets.push(target); return [{ affectedRows: 1 }]; }) })),
    insertedValues,
    updatedValues,
    deletedTargets,
  };
  db.transaction = vi.fn(async callback => callback(db));
  return db;
}

describe("系统设置安全工作流", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
    vi.mocked(testPublishedOfficialAccountConfiguration).mockResolvedValue({ success: true, message: "服务号凭据校验通过" });
    vi.mocked(testAliyunOssPhotoStorageConnection).mockResolvedValue({ success: true, code: "connected", message: "OSS 连接、Bucket 定位和只读对象权限校验通过；未上传、覆盖或删除任何照片。" });
  });

  it("OSS 连接测试仅调用受控服务并写入不含密钥的最小审计", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.testAliyunOssPhotoStorageConnection()).resolves.toMatchObject({ success: true, code: "connected" });

    expect(testAliyunOssPhotoStorageConnection).toHaveBeenCalledTimes(1);
    expect(db.insertedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: "settings",
        action: "test_aliyun_oss_photo_storage_connection",
        targetType: "photo_storage",
        targetId: "aliyun_oss",
        summary: expect.stringContaining("未读写业务照片"),
      }),
    ]));
    expect(JSON.stringify(db.insertedValues)).not.toContain("accessKey");
    expect(JSON.stringify(db.insertedValues)).not.toContain("credential");
  });

  it("微信登录管理解除绑定仅撤销绑定状态并写入最小化审计", async () => {
    const db = createSettingsDb([[{ id: 9, status: "active", userId: 7, displayName: "测试人员" }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await adminRouter.createCaller(createAdminContext()).wechatLogin.revoke({ userId: 7 });

    expect(db.updatedValues).toContainEqual(expect.objectContaining({ status: "revoked" }));
    expect(db.insertedValues).toContainEqual(expect.objectContaining({
      module: "security",
      action: "wechat_oauth_binding_revoked",
      targetType: "official_account_binding",
      targetId: "7",
    }));
    expect(JSON.stringify(db.insertedValues)).not.toContain("openid");
  });

  it("通用外部 API 密钥必须加密托管，草稿和审计写入均不保留明文", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const rawKey = "map-live-api-key-secret";

    await adminRouter.createCaller(createAdminContext()).settings.saveDraft({
      category: "external_api",
      settingKey: "MAP_API_KEY",
      displayName: "地图服务密钥",
      value: rawKey,
      isSensitive: true,
      remarks: "用于受控地图连接器",
    });

    expect(encryptSecret).toHaveBeenCalledWith(rawKey);
    expect(maskSecret).toHaveBeenCalledWith(rawKey);
    const settingInsert = db.insertedValues[0] as Record<string, unknown>;
    expect(settingInsert).toMatchObject({ settingKey: "MAP_API_KEY", valueJson: null, secretEncrypted: "cipher:opaque-value", valuePreview: "********MASK", isSensitive: true, status: "draft" });
    expect(JSON.stringify(db.insertedValues)).not.toContain(rawKey);
  });

  it("密钥类配置拒绝非加密草稿，消息模板则允许作为非敏感业务参数保存", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await expect(caller.settings.saveDraft({ category: "external_api", settingKey: "OCR_API_TOKEN", displayName: "OCR 令牌", value: "plain-token", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.settings.saveDraft({ category: "message_template", settingKey: "MESSAGE_TEMPLATE_PAYROLL", displayName: "工资审批通知模板", value: "工资单已审核，请在移动端查看。", isSensitive: false, remarks: null });

    const templateDraft = db.insertedValues.find(value => (value as { settingKey?: string }).settingKey === "MESSAGE_TEMPLATE_PAYROLL");
    expect(templateDraft).toMatchObject({ settingKey: "MESSAGE_TEMPLATE_PAYROLL", valueJson: "工资单已审核，请在移动端查看。", secretEncrypted: null, isSensitive: false });
  });

  it("认证服务号仅 AppSecret 使用密文托管，公开字段必须符合 HTTPS 与 JSON 安全约束", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_ID", displayName: "服务号 AppID", value: "wx1234567890abcdef", isSensitive: false, remarks: null });
    await caller.settings.saveDraft({ category: "公众号消息模板", settingKey: "WECHAT_OFFICIAL_TEMPLATE_FIELDS", displayName: "字段映射", value: "{\"first\":\"{title}\"}", isSensitive: false, remarks: null });
    await caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_URL", displayName: "跳转地址", value: "https://road.example.com", isSensitive: false, remarks: null });
    await caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_SECRET", displayName: "服务号 AppSecret", value: "official-account-secret", isSensitive: true, remarks: null });

    await expect(caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_ID", displayName: "服务号 AppID", value: "wx1234567890abcdef", isSensitive: true, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_SECRET", displayName: "服务号 AppSecret", value: "official-account-secret", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.settings.saveDraft({ category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_URL", displayName: "跳转地址", value: "http://localhost:3000", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.settings.saveDraft({ category: "公众号消息模板", settingKey: "WECHAT_OFFICIAL_TEMPLATE_FIELDS", displayName: "字段映射", value: "[]", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.settings.saveDraft({ category: "通知", settingKey: "WECHAT_WORK_WEBHOOK", displayName: "企业微信机器人", value: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=retired", isSensitive: true, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const officialDrafts = db.insertedValues.filter(value => (value as { settingKey?: string }).settingKey?.startsWith("WECHAT_OFFICIAL_"));
    expect(officialDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_ID", valueJson: "wx1234567890abcdef", secretEncrypted: null, isSensitive: false }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_TEMPLATE_FIELDS", valueJson: "{\"first\":\"{title}\"}", secretEncrypted: null, isSensitive: false }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_URL", valueJson: "https://road.example.com", secretEncrypted: null, isSensitive: false }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_SECRET", valueJson: null, secretEncrypted: "cipher:opaque-value", isSensitive: true }),
    ]));
    expect(JSON.stringify(db.insertedValues)).not.toContain("official-account-secret");
  });

  it("服务号五项配置一次保存、发布并统一校验，敏感值不进入公开字段或审计", async () => {
    const db = createSettingsDb([[]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await adminRouter.createCaller(createAdminContext()).settings.saveOfficialAccountConfiguration({
      appId: "wx1234567890abcdef",
      appSecret: "official-account-secret",
      appUrl: "https://road.example.com",
      egressUrl: "https://wechat-egress.example.com",
      egressSigningSecret: "egress-signing-secret",
    });

    expect(result).toEqual({ success: true, message: "服务号凭据校验通过" });
    expect(testPublishedOfficialAccountConfiguration).toHaveBeenCalledTimes(1);
    const settings = db.insertedValues.filter(value => (value as { settingKey?: string }).settingKey?.startsWith("WECHAT_OFFICIAL_"));
    expect(settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_ID", valueJson: "wx1234567890abcdef", isSensitive: false, status: "published" }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_SECRET", valueJson: null, secretEncrypted: "cipher:opaque-value", isSensitive: true, status: "published" }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_APP_URL", valueJson: "https://road.example.com", isSensitive: false, status: "published" }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_EGRESS_URL", valueJson: "https://wechat-egress.example.com", isSensitive: false, status: "published" }),
      expect.objectContaining({ settingKey: "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET", valueJson: null, secretEncrypted: "cipher:opaque-value", isSensitive: true, status: "published" }),
    ]));
    expect(JSON.stringify(db.insertedValues)).not.toContain("official-account-secret");
    expect(JSON.stringify(db.insertedValues)).not.toContain("egress-signing-secret");
  });

  it("身份恢复地址必须以非敏感公开 HTTPS 配置保存，并移除浏览器片段", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await expect(caller.settings.saveDraft({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份恢复", value: "https://id.example.com/recover", isSensitive: true, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.settings.saveDraft({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份恢复", value: "http://id.example.com/recover", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.settings.saveDraft({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份恢复", value: "https://id.example.com/recover#temporary-token", isSensitive: false, remarks: "由身份平台处理找回与重置" });
    const recoveryDraft = db.insertedValues[0] as Record<string, unknown>;
    expect(recoveryDraft).toMatchObject({ settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", valueJson: "https://id.example.com/recover", secretEncrypted: null, isSensitive: false, status: "draft" });
    expect(JSON.stringify(recoveryDraft)).not.toContain("temporary-token");
  });

  it("发布敏感草稿仅保存服务器端密文快照，回滚继续使用密文而不会恢复明文", async () => {
    const snapshot = {
      category: "external_api",
      settingKey: "MAP_API_KEY",
      displayName: "地图服务密钥",
      valueJson: null,
      secretEncrypted: "cipher:historical-key",
      valuePreview: "********ical",
      isSensitive: true,
      remarks: "历史版本",
    };
    const existing = { id: 12, version: 3, ...snapshot };
    const published = { ...existing, version: 4, status: "published" };
    const db = createSettingsDb([[existing], [published], [{ id: 66, settingId: 12, version: 2, snapshotJson: JSON.stringify(snapshot) }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await expect(caller.settings.publish({ id: 12, expectedVersion: 3 })).resolves.toEqual({ success: true, version: 4 });
    await expect(caller.settings.rollback({ settingId: 12, publishLogId: 66, expectedVersion: 4 })).resolves.toEqual({ success: true, version: 5 });

    expect(db.updatedValues[0]).toMatchObject({ status: "published", version: 4 });
    expect(db.updatedValues[1]).toMatchObject({ secretEncrypted: "cipher:historical-key", valueJson: null, status: "published", version: 5 });
    expect(db.updatedValues[1]).not.toMatchObject({ secretEncrypted: "historical-key" });
  });

  it("过期配置版本不能覆盖已被其他管理员修订的当前版本", async () => {
    const existing = {
      id: 14,
      version: 6,
      category: "business_parameter",
      settingKey: "TRANSPORT_START_PRICE",
      displayName: "运输起步价",
      valueJson: "120",
      secretEncrypted: null,
      valuePreview: "120",
      isSensitive: false,
      remarks: "按元/趟配置",
    };
    const db = createSettingsDb([[existing]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.publish({ id: 14, expectedVersion: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.updatedValues).toHaveLength(0);
    expect(db.insertedValues).toHaveLength(0);
  });

  it("编辑既有草稿与停用配置均以 expectedVersion 条件写入，并递增版本记录审计", async () => {
    const existingDraft = { id: 18, version: 3, category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", valueJson: "120", secretEncrypted: null, valuePreview: "120", isSensitive: false, remarks: "旧草稿" };
    const draftDb = createSettingsDb([[existingDraft]]);
    vi.mocked(getDb).mockResolvedValue(draftDb as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.saveDraft({ id: 18, expectedVersion: 3, category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", value: "130", isSensitive: false, remarks: "修订草稿" })).resolves.toEqual({ success: true, version: 4 });
    expect(draftDb.updatedValues[0]).toMatchObject({ valueJson: "130", status: "draft", version: 4 });
    expect(draftDb.insertedValues).toHaveLength(2);

    const existingPublished = { ...existingDraft, id: 19, version: 7, status: "published" };
    const disableDb = createSettingsDb([[existingPublished]]);
    vi.mocked(getDb).mockResolvedValue(disableDb as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.disable({ id: 19, expectedVersion: 7 })).resolves.toEqual({ success: true, version: 8 });
    expect(disableDb.updatedValues[0]).toMatchObject({ status: "disabled", version: 8 });
    expect(disableDb.insertedValues).toHaveLength(2);
  });

  it("过期 expectedVersion 会拒绝草稿保存和配置停用，且不写入更新、审计或历史", async () => {
    const existing = { id: 20, version: 9, category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", valueJson: "120", secretEncrypted: null, valuePreview: "120", isSensitive: false, remarks: null };
    const staleDraftDb = createSettingsDb([[existing]]);
    vi.mocked(getDb).mockResolvedValue(staleDraftDb as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.saveDraft({ id: 20, expectedVersion: 8, category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", value: "130", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(staleDraftDb.updatedValues).toHaveLength(0);
    expect(staleDraftDb.insertedValues).toHaveLength(0);

    const staleDisableDb = createSettingsDb([[existing]]);
    vi.mocked(getDb).mockResolvedValue(staleDisableDb as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.disable({ id: 20, expectedVersion: 8 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(staleDisableDb.updatedValues).toHaveLength(0);
    expect(staleDisableDb.insertedValues).toHaveLength(0);
  });

  it("既有配置的草稿修订缺少 expectedVersion 时一律拒绝，后台新建表单不会绕过版本锁", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.saveDraft({ id: 21, category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", value: "130", isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.updatedValues).toHaveLength(0);
    expect(db.insertedValues).toHaveLength(0);
  });

  it("删除认证服务号密钥会校验当前版本、清除活动密文及历史快照可恢复内容，并仅保留最小化审计", async () => {
    const appSecret = "official-account-remove-secret";
    const existing = {
      id: 31,
      version: 4,
      category: "wechat_official",
      settingKey: "WECHAT_OFFICIAL_APP_SECRET",
      displayName: "认证服务号 AppSecret",
      valueJson: null,
      secretEncrypted: "cipher:remove-test-secret",
      valuePreview: "********MASK",
      isSensitive: true,
      remarks: "待删除的服务号密钥",
    };
    const historicalSnapshot = JSON.stringify({ ...existing, valueJson: appSecret });
    const db = createSettingsDb([[existing], [{ id: 71, snapshotJson: historicalSnapshot }]]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(adminRouter.createCaller(createAdminContext()).settings.remove({ id: 31, expectedVersion: 4 })).resolves.toEqual({ success: true });

    expect(db.deletedTargets).toHaveLength(1);
    expect(db.updatedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ snapshotJson: expect.stringContaining("[已删除]") }),
    ]));
    expect(JSON.stringify(db.updatedValues)).not.toContain("cipher:remove-test-secret");
    expect(JSON.stringify(db.updatedValues)).not.toContain(appSecret);
    expect(JSON.stringify(db.insertedValues)).not.toContain("cipher:remove-test-secret");
    expect(JSON.stringify(db.insertedValues)).not.toContain(appSecret);
    expect(db.insertedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "delete", targetId: "WECHAT_OFFICIAL_APP_SECRET" }),
    ]));
  });

  it("认证服务号密钥与业务参数均可在统一配置中心经历草稿、发布、历史脱敏与回滚闭环", async () => {
    const appSecret = "official-account-unit-secret";
    const officialSnapshot = {
      category: "wechat_official",
      settingKey: "WECHAT_OFFICIAL_APP_SECRET",
      displayName: "认证服务号 AppSecret",
      valueJson: null,
      secretEncrypted: "cipher:official-secret",
      valuePreview: "********MASK",
      isSensitive: true,
      remarks: "用于服务号模板通知",
    };
    const businessSnapshot = {
      category: "business_parameter",
      settingKey: "TRANSPORT_START_PRICE",
      displayName: "运输起步价",
      valueJson: "120",
      secretEncrypted: null,
      valuePreview: "120",
      isSensitive: false,
      remarks: "按元/趟配置",
    };
    const officialSetting = { id: 42, version: 1, ...officialSnapshot };
    const businessSetting = { id: 43, version: 5, ...businessSnapshot };
    const officialLog = { id: 81, settingId: 42, version: 1, operation: "publish", snapshotJson: JSON.stringify(officialSnapshot) };
    const businessLog = { id: 82, settingId: 43, version: 5, operation: "publish", snapshotJson: JSON.stringify(businessSnapshot) };
    const db = createSettingsDb([[officialSetting], [officialLog], [{ ...officialSetting, version: 2 }], [officialLog], [businessSetting], [businessLog], [{ ...businessSetting, version: 6 }], [businessLog]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await expect(caller.settings.saveDraft({ category: "wechat_official", settingKey: "WECHAT_OFFICIAL_APP_SECRET", displayName: "认证服务号 AppSecret", value: appSecret, isSensitive: false, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.settings.saveDraft({ category: "wechat_official", settingKey: "WECHAT_OFFICIAL_APP_SECRET", displayName: "认证服务号 AppSecret", value: appSecret, isSensitive: true, remarks: "用于服务号模板通知" });
    await expect(caller.settings.publish({ id: 42, expectedVersion: 1 })).resolves.toEqual({ success: true, version: 2 });
    const officialHistory = await caller.settings.history({ settingId: 42 });
    await expect(caller.settings.rollback({ settingId: 42, publishLogId: 81, expectedVersion: 2 })).resolves.toEqual({ success: true, version: 3 });

    await caller.settings.saveDraft({ category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", value: "120", isSensitive: false, remarks: "按元/趟配置" });
    await expect(caller.settings.publish({ id: 43, expectedVersion: 5 })).resolves.toEqual({ success: true, version: 6 });
    const businessHistory = await caller.settings.history({ settingId: 43 });
    await expect(caller.settings.rollback({ settingId: 43, publishLogId: 82, expectedVersion: 6 })).resolves.toEqual({ success: true, version: 7 });

    expect(JSON.stringify(db.insertedValues)).not.toContain(appSecret);
    expect(JSON.stringify(officialHistory)).not.toContain("cipher:official-secret");
    expect(JSON.stringify(businessHistory)).toContain("TRANSPORT_START_PRICE");
    expect(db.updatedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ secretEncrypted: "cipher:official-secret", valueJson: null, status: "published" }),
      expect.objectContaining({ valueJson: "120", secretEncrypted: null, status: "published" }),
    ]));
  });

  it("所有密钥类配置均强制加密保存，列表和历史读取路径均不暴露明文或密文", async () => {
    const secretEntries = [
      ["MAP_API_KEY", "map-secret-value"],
      ["OCR_API_TOKEN", "ocr-secret-value"],
      ["CAMERA_APP_KEY", "camera-secret-value"],
      ["LOCATION_CREDENTIAL", "location-secret-value"],
      ["WECHAT_OFFICIAL_APP_SECRET", "official-account-secret-value"],
    ] as const;
    const writeDb = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(writeDb as never);
    const caller = adminRouter.createCaller(createAdminContext());

    for (const [settingKey, value] of secretEntries) {
      await caller.settings.saveDraft({ category: "external_api", settingKey, displayName: `${settingKey} 配置`, value, isSensitive: true, remarks: null });
    }

    expect(writeDb.insertedValues).toHaveLength(secretEntries.length * 2);
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("map-secret-value");
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("ocr-secret-value");
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("camera-secret-value");
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("location-secret-value");
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("official-account-secret-value");

    const safeRows = secretEntries.map(([settingKey]) => ({ id: settingKey.length, settingKey, valueJson: null, valuePreview: "********MASK", isSensitive: true, status: "published" }));
    const historyLog = { id: 91, settingId: 9, version: 1, snapshotJson: JSON.stringify({ settingKey: "MAP_API_KEY", isSensitive: true, secretEncrypted: "cipher:opaque-value", valueJson: null }) };
    const readDb = createSettingsDb([safeRows, [historyLog]]);
    vi.mocked(getDb).mockResolvedValue(readDb as never);

    const listed = await caller.settings.list();
    const history = await caller.settings.history({ settingId: 9 });
    const listProjection = readDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(listProjection)).not.toContain("secretEncrypted");
    expect(JSON.stringify(listed)).not.toContain("secret-");
    expect(JSON.stringify(history)).not.toContain("cipher:opaque-value");
    expect(JSON.stringify(history)).not.toContain("secretEncrypted");
  });

  it("已有服务号模板配置可安全替换为新草稿，并保留旧值的可回退历史", async () => {
    const existingTemplateId = { id: 71, version: 4, category: "公众号消息模板", settingKey: "WECHAT_OFFICIAL_TEMPLATE_ID", displayName: "公众号业务通知模板 ID", valueJson: "old-template", secretEncrypted: null, valuePreview: "old-template", isSensitive: false, status: "published", remarks: "旧模板" };
    const existingTemplateFields = { id: 72, version: 6, category: "公众号消息模板", settingKey: "WECHAT_OFFICIAL_TEMPLATE_FIELDS", displayName: "公众号模板字段映射", valueJson: "{\"content\":\"{content}\"}", secretEncrypted: null, valuePreview: "旧映射", isSensitive: false, status: "published", remarks: "旧字段映射" };
    const db = createSettingsDb([[existingTemplateId, existingTemplateFields]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(listPublishedOfficialAccountPrivateTemplates).mockResolvedValue({ success: true, message: "ok", templates: [{ templateId: "new-template", title: "工程待办通知", content: "{{first.DATA}}", fieldMapping: { first: "{title}" } }] });

    await expect(adminRouter.createCaller(createAdminContext()).settings.createOfficialAccountTemplateDraft({ templateId: "new-template" })).resolves.toMatchObject({ success: true, replacedExisting: true });

    expect(db.updatedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ valueJson: "new-template", status: "draft", version: 5, publishedAt: null }),
      expect.objectContaining({ valueJson: "{\"first\":\"{title}\"}", status: "draft", version: 7, publishedAt: null }),
    ]));
    expect(db.insertedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "update", settingId: 71, version: 5 }),
      expect.objectContaining({ operation: "update", settingId: 72, version: 7 }),
      expect.objectContaining({ action: "official_account_template_draft", targetId: "new-template" }),
    ]));
    expect(JSON.stringify(db.updatedValues)).not.toContain("WECHAT_OFFICIAL_APP_SECRET");
  });

  it("已知会触发微信 40037 的订阅模板占位条目不能被发布为持续业务通知模板", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(listPublishedOfficialAccountPrivateTemplates).mockResolvedValue({ success: true, message: "ok", templates: [{ templateId: "subscription-placeholder", title: "订阅模板消息", content: "{{content.DATA}}", fieldMapping: { content: "{content}" } }] });

    await expect(adminRouter.createCaller(createAdminContext()).settings.createOfficialAccountTemplateDraft({ templateId: "subscription-placeholder" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("40037") });
    expect(db.updatedValues).toHaveLength(0);
    expect(db.insertedValues).toHaveLength(0);
  });
});
