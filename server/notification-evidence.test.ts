import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 所有外部基础设施均使用 Mock，测试不读取真实影像、不调用模型也不向企业微信发送网络请求。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storageGet: vi.fn(), storageGetSignedUrl: vi.fn(), storagePut: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./services/secretVault", () => ({ decryptSecret: vi.fn((value: string) => value.replace(/^cipher:/, "")) }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: vi.fn(), getCurrentDataScope: vi.fn(), getDepartmentModuleDataScope: vi.fn(), getEffectiveRoleCodes: vi.fn() };
});

import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getCurrentDataScope, getDepartmentModuleDataScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { evidenceRouter } from "./routers/evidence";
import { createInAppMessage, messageRouter } from "./routers/messages";
import { inspectPublishedOfficialAccountTemplateCapability, listPublishedOfficialAccountPrivateTemplates, loadPublishedOfficialAccountConfig, loadPublishedOfficialAccountCredentials, testPublishedOfficialAccountConfiguration } from "./services/officialAccountNotifier";
import { storageGet, storageGetSignedUrl, storagePut } from "./storage";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 生成最小登录态，所有真正的权限校验仍由路由调用的访问控制函数承担。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = { id: 9, openId: "notification-test-user", email: "notification-test@example.com", name: "消息测试人员", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 兼容路由不同查询链的轻量 Drizzle Mock。 */
function createSelectDb(rows: unknown[]) {
  const queryResult = () => Object.assign(Promise.resolve(rows), {
    orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
    limit: vi.fn(async () => rows),
  });
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => queryResult()),
        orderBy: vi.fn(async () => rows),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };
}

describe("消息、影像与企业微信通知安全边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["SITE_MANAGER"]);
    vi.mocked(getCurrentDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [5], roleCodes: ["SITE_MANAGER"] });
    vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [5], roleCodes: ["SITE_MANAGER"] });
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  });

  it("消息列表只以当前登录收件人为条件，且站内消息拒绝开放跳转深链", async () => {
    const db = createSelectDb([{ id: 1, eventCode: "PAYROLL_APPROVED", title: "工资审核完成", content: "请在系统内查看", deepLink: "/mobile/labor", status: "sent", sentAt: new Date(), readAt: null, createdAt: new Date() }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(messageRouter.createCaller(createAuthContext()).list({ limit: 20 })).resolves.toHaveLength(1);
    await expect(createInAppMessage({ eventCode: "TEST", idempotencyKey: "message-test-1", recipientUserId: 9, title: "测试", content: "测试内容", deepLink: "https://untrusted.example" })).rejects.toThrow("消息深链必须为站内相对路径");
  });

  it("影像项目选择仅返回当前数据范围内的项目，并在对象存储前拒绝非法 Base64 编码", async () => {
    const db = createSelectDb([
      { id: 1, name: "组织范围项目", organizationId: 5, status: "active" },
      { id: 2, name: "项目直授权", organizationId: null, status: "active" },
      { id: 3, name: "无权项目", organizationId: 6, status: "active" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const options = await evidenceRouter.createCaller(createAuthContext()).projectOptions();
    expect(options.map(item => item.id)).toEqual([1, 2]);
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(expect.anything(), "EVIDENCE");
    await expect(evidenceRouter.createCaller(createAuthContext()).upload({ projectId: 2, sourceType: "site_photo", description: "路面摊铺现场", capturedAt: "2026-07-25T04:00:00.000Z", longitude: 120.1, latitude: 30.2, fileName: "现场.jpg", mimeType: "image/jpeg", base64Data: "%%%" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("取证连接器仅采纳已发布的公开配置，并在服务端强制执行必填定位", async () => {
    const db = createSelectDb([
      { settingKey: "EVIDENCE_CAMERA_PROVIDER", valueJson: "browser", isSensitive: false },
      { settingKey: "EVIDENCE_LOCATION_PROVIDER", valueJson: "browser", isSensitive: false },
      { settingKey: "EVIDENCE_LOCATION_REQUIRED", valueJson: "true", isSensitive: false },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(storagePut).mockResolvedValue({ key: "evidence/2/现场.jpg", url: "https://storage.example/evidence.jpg" } as never);

    await expect(evidenceRouter.createCaller(createAuthContext()).captureConfig()).resolves.toMatchObject({
      camera: { provider: "browser", enabled: true },
      location: { provider: "browser", enabled: true, required: true },
      watermark: expect.objectContaining({ title: "工程水印", fields: expect.arrayContaining(["capturedAt", "principal", "project"]) }),
    });
    const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
    await expect(evidenceRouter.createCaller(createAuthContext()).upload({ projectId: 2, sourceType: "site_photo", description: "定位必填测试", capturedAt: "2026-07-25T04:00:00.000Z", longitude: null, latitude: null, fileName: "现场.jpg", mimeType: "image/jpeg", base64Data: jpegBase64 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "当前项目要求上传现场影像时附带有效定位" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("取证连接器会读取已发布的工程水印字段顺序，损坏模板则安全降级为默认样式", async () => {
    const db = createSelectDb([
      { settingKey: "EVIDENCE_WATERMARK_TEMPLATE", valueJson: JSON.stringify({ title: "道路施工取证", organizationLabel: "南丰高速项目部", footerLabel: "工程影像 · 防伪归档", fields: ["project", "capturedAt", "coordinates"] }), isSensitive: false },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(evidenceRouter.createCaller(createAuthContext()).captureConfig()).resolves.toMatchObject({
      watermark: { title: "道路施工取证", organizationLabel: "南丰高速项目部", footerLabel: "工程影像 · 防伪归档", fields: ["project", "capturedAt", "coordinates"] },
    });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ settingKey: "EVIDENCE_WATERMARK_TEMPLATE", valueJson: "{损坏的配置", isSensitive: false }]) as never);
    await expect(evidenceRouter.createCaller(createAuthContext()).captureConfig()).resolves.toMatchObject({ watermark: expect.objectContaining({ title: "工程水印" }) });
  });

  it("票据 OCR 仅处理已授权项目的影像，并强制将模型结果标记为人工复核", async () => {
    const db = createSelectDb([{ id: 88, projectId: 2, fileKey: "evidence/2/receipt.jpg", mimeType: "image/jpeg" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(storageGetSignedUrl).mockResolvedValue("https://storage.example/signed-receipt.jpg" as never);
    vi.mocked(invokeLLM).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ documentType: "收据", issuer: "", documentNo: "", issueDate: "", amount: "", currency: "", summary: "", confidence: 0.42, requiresManualReview: false }) } }] } as never);

    const result = await evidenceRouter.createCaller(createAuthContext()).ocr({ id: 88 });

    expect(assertProjectInCurrentScope).toHaveBeenCalledWith(expect.anything(), 2);
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 700 }));
    expect(result.ocrResult.requiresManualReview).toBe(true);
    expect(result.ocrResult.documentType).toBe("收据");
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("公众号通知仅使用已发布的 AppID、加密 AppSecret 和模板标识，缺少任何必要项均不可用", async () => {
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-test-app" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: "cipher:super-secret" },
      { settingKey: "WECHAT_OFFICIAL_TEMPLATE_ID", status: "published", isSensitive: false, valueJson: "template-001" },
      { settingKey: "WECHAT_OFFICIAL_APP_URL", status: "published", isSensitive: false, valueJson: "https://app.example" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(loadPublishedOfficialAccountConfig()).resolves.toEqual(expect.objectContaining({ config: expect.objectContaining({ appId: "wx-test-app", appSecret: "super-secret", appUrl: "https://app.example", moduleTemplates: {}, fallbackTemplate: expect.objectContaining({ templateId: "template-001" }) }) }));

    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-test-app" }]) as never);
    await expect(loadPublishedOfficialAccountConfig()).resolves.toEqual({ reason: "disabled" });
  });

  it("新版开发者平台的凭据校验与网页绑定只依赖 AppID 和 AppSecret，模板消息可在后续独立配置", async () => {
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-test-credential" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: "cipher:credential-secret" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "test-access-token", expires_in: 7200 }) })));

    await expect(loadPublishedOfficialAccountCredentials()).resolves.toEqual({ config: { appId: "wx-test-credential", appSecret: "credential-secret", appUrl: null } });
    await expect(loadPublishedOfficialAccountConfig()).resolves.toEqual({ reason: "disabled" });
    await expect(testPublishedOfficialAccountConfiguration()).resolves.toEqual({ success: true, message: "服务号凭据校验通过；模板消息尚未配置，员工绑定可继续，业务通知将在模板配置发布后启用" });
  });

  it("服务号开发密钥校验会安全返回微信 40164 的出口 IP 诊断，且不会泄露 AppSecret", async () => {
    const secret = "credential-secret-must-not-leak";
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-ip-whitelist-check" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: `cipher:${secret}` },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 40164, errmsg: "invalid ip 203.0.113.10, not in whitelist" }) })));

    const result = await testPublishedOfficialAccountConfiguration();
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("203.0.113.10") });
    expect(result.message).not.toContain(secret);
  });

  it("模板能力检测会识别未开通的模板消息插件，而不要求管理员先填写旧模板 ID", async () => {
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-template-capability-check" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: "cipher:template-capability-secret" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL) => String(request).includes("cgi-bin/token")
      ? ({ ok: true, json: async () => ({ access_token: "template-capability-token", expires_in: 7200 }) })
      : ({ ok: true, json: async () => ({ errcode: 48001, errmsg: "api unauthorized" }) })));

    await expect(inspectPublishedOfficialAccountTemplateCapability()).resolves.toEqual({ success: false, message: "微信返回 48001：当前服务号尚未获得模板消息接口权限。请在服务号后台“功能 → 添加功能插件”申请并开通“模板消息”，完成服务类目设置后再检测。" });
  });

  it("模板插件已开通但仅返回订阅占位模板时，会从系统可选列表隐藏该模板并提示尚无可下发业务模板", async () => {
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-subscription-placeholder" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: "cipher:subscription-placeholder-secret" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL) => String(request).includes("cgi-bin/token")
      ? ({ ok: true, json: async () => ({ access_token: "subscription-placeholder-token", expires_in: 7200 }) })
      : ({ ok: true, json: async () => ({ template_list: [{ template_id: "subscription-placeholder", title: "订阅模板消息", content: "{{content.DATA}}" }] }) })));

    await expect(listPublishedOfficialAccountPrivateTemplates()).resolves.toEqual({
      success: true,
      message: "模板消息功能已开通，但系统已隐藏不可下发的订阅占位模板；当前尚无可下发业务模板。请在服务号后台添加合规业务模板后重新读取。",
      templates: [],
    });
    await expect(inspectPublishedOfficialAccountTemplateCapability()).resolves.toEqual({ success: true, message: "模板消息功能已开通，但系统已隐藏不可下发的订阅占位模板；当前尚无可下发业务模板。请在服务号后台添加合规业务模板后重新读取。" });
  });

  it("私有模板发现会返回模板 ID 与从 DATA 占位符生成的字段映射，且不返回密钥", async () => {
    const db = createSelectDb([
      { settingKey: "WECHAT_OFFICIAL_APP_ID", status: "published", isSensitive: false, valueJson: "wx-template-list" },
      { settingKey: "WECHAT_OFFICIAL_APP_SECRET", status: "published", isSensitive: true, secretEncrypted: "cipher:template-list-secret" },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL) => {
      if (String(request).includes("cgi-bin/token")) return { ok: true, json: async () => ({ access_token: "template-list-token", expires_in: 7200 }) };
      return { ok: true, json: async () => ({ template_list: [{ template_id: "tmpl-1", title: "运输提醒", content: "{{first.DATA}}\n车辆：{{keyword1.DATA}}\n{{remark.DATA}}" }] }) };
    }));

    await expect(listPublishedOfficialAccountPrivateTemplates()).resolves.toEqual({
      success: true,
      message: "已读取 1 个可下发私有模板；请选择符合施工业务通知场景的模板生成系统草稿。",
      templates: [{ templateId: "tmpl-1", title: "运输提醒", content: "{{first.DATA}}\n车辆：{{keyword1.DATA}}\n{{remark.DATA}}", fieldMapping: { first: "{title}", keyword1: "{content}", remark: "点击查看系统详情" } }],
    });
  });
});
