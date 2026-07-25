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

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";
import { encryptSecret, maskSecret } from "./services/secretVault";

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
    query.then = (onFulfilled?: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(readRows()).then(onFulfilled, onRejected);
    return query;
  };
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => createQuery()) })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: unknown) => { insertedValues.push(value); }) })),
    update: vi.fn(() => ({ set: vi.fn((value: unknown) => { updatedValues.push(value); return { where: vi.fn(async () => undefined) }; }) })),
    insertedValues,
    updatedValues,
  };
  return db;
}

describe("系统设置安全工作流", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
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

  it("企业微信与业务参数均可在统一配置中心经历草稿、发布、历史脱敏与回滚闭环", async () => {
    const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=unit-test-key";
    const wecomSnapshot = {
      category: "wechat",
      settingKey: "WECHAT_WORK_WEBHOOK",
      displayName: "企业微信机器人",
      valueJson: null,
      secretEncrypted: "cipher:wecom-webhook",
      valuePreview: "********MASK",
      isSensitive: true,
      remarks: "用于业务待办通知",
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
    const wecomSetting = { id: 42, version: 1, ...wecomSnapshot };
    const businessSetting = { id: 43, version: 5, ...businessSnapshot };
    const wecomLog = { id: 81, settingId: 42, version: 1, operation: "publish", snapshotJson: JSON.stringify(wecomSnapshot) };
    const businessLog = { id: 82, settingId: 43, version: 5, operation: "publish", snapshotJson: JSON.stringify(businessSnapshot) };
    const db = createSettingsDb([[wecomSetting], [wecomLog], [{ ...wecomSetting, version: 2 }], [wecomLog], [businessSetting], [businessLog], [{ ...businessSetting, version: 6 }], [businessLog]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const caller = adminRouter.createCaller(createAdminContext());

    await expect(caller.settings.saveDraft({ category: "wechat", settingKey: "WECHAT_WORK_WEBHOOK", displayName: "企业微信机器人", value: "https://example.com/webhook", isSensitive: true, remarks: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.settings.saveDraft({ category: "wechat", settingKey: "WECHAT_WORK_WEBHOOK", displayName: "企业微信机器人", value: webhook, isSensitive: true, remarks: "用于业务待办通知" });
    await expect(caller.settings.publish({ id: 42, expectedVersion: 1 })).resolves.toEqual({ success: true, version: 2 });
    const wecomHistory = await caller.settings.history({ settingId: 42 });
    await expect(caller.settings.rollback({ settingId: 42, publishLogId: 81, expectedVersion: 2 })).resolves.toEqual({ success: true, version: 3 });

    await caller.settings.saveDraft({ category: "business_parameter", settingKey: "TRANSPORT_START_PRICE", displayName: "运输起步价", value: "120", isSensitive: false, remarks: "按元/趟配置" });
    await expect(caller.settings.publish({ id: 43, expectedVersion: 5 })).resolves.toEqual({ success: true, version: 6 });
    const businessHistory = await caller.settings.history({ settingId: 43 });
    await expect(caller.settings.rollback({ settingId: 43, publishLogId: 82, expectedVersion: 6 })).resolves.toEqual({ success: true, version: 7 });

    expect(JSON.stringify(db.insertedValues)).not.toContain(webhook);
    expect(JSON.stringify(wecomHistory)).not.toContain("cipher:wecom-webhook");
    expect(JSON.stringify(businessHistory)).toContain("TRANSPORT_START_PRICE");
    expect(db.updatedValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ secretEncrypted: "cipher:wecom-webhook", valueJson: null, status: "published" }),
      expect.objectContaining({ valueJson: "120", secretEncrypted: null, status: "published" }),
    ]));
  });

  it("所有密钥类配置均强制加密保存，列表和历史读取路径均不暴露明文或密文", async () => {
    const secretEntries = [
      ["MAP_API_KEY", "map-secret-value"],
      ["OCR_API_TOKEN", "ocr-secret-value"],
      ["CAMERA_APP_KEY", "camera-secret-value"],
      ["LOCATION_CREDENTIAL", "location-secret-value"],
      ["WECHAT_WORK_WEBHOOK", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-webhook"],
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
    expect(JSON.stringify(writeDb.insertedValues)).not.toContain("secret-webhook");

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
});
