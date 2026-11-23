import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
  WATERMARK_TEMPLATE_SETTING_KEY,
  type EvidenceWatermarkTemplate,
} from "../shared/watermarkTemplate";
import { auditLogs, configPublishLogs, systemSettings } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/** 只运行真实路由与校验逻辑；所有数据库、权限和外部设施均为内存 Mock。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertSuperAdmin: vi.fn(),
    assertDepartmentBusinessAccess: vi.fn(),
    getDepartmentModuleDataScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertDepartmentBusinessAccess, assertSuperAdmin, getDepartmentModuleDataScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";
import { evidenceRouter } from "./routers/evidence";

function createContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "watermark-layout-test",
      email: "watermark@example.com",
      name: "水印测试管理员",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const historicalInput = {
  title: "道路施工取证",
  organizationLabel: "南丰高速项目部",
  footerLabel: "工程影像 · 防伪归档",
  fields: ["project", "capturedAt", "coordinates"] as EvidenceWatermarkTemplate["fields"],
};

function createSettingsDb(rows: unknown[] = [], affectedRows = 1) {
  const inserted: { table: unknown; value: Record<string, unknown> }[] = [];
  const updated: { table: unknown; value: Record<string, unknown>; condition?: unknown }[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Object.assign(Promise.resolve(rows), {
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (value: Record<string, unknown>) => { inserted.push({ table, value }); }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async (condition: unknown) => {
          updated.push({ table, value, condition });
          return [{ affectedRows }];
        }),
      })),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    inserted,
    updated,
  };
  return db;
}

describe("工程水印布局的设置发布与捕获配置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createContext().user!);
    vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue(undefined);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["SITE_MANAGER"]);
    vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [], roleCodes: ["SITE_MANAGER"] });
  });

  it.each([
    ["bottom_left", "compact"], ["bottom_left", "standard"],
    ["bottom_right", "compact"], ["bottom_right", "standard"],
    ["top_left", "compact"], ["top_left", "standard"],
    ["top_right", "compact"], ["top_right", "standard"],
  ] as const)("保存 %s / %s 为现有设置 JSON，并保留发布事务及审计", async (position, size) => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const ctx = createContext();

    await expect(adminRouter.createCaller(ctx).settings.saveEvidenceWatermarkTemplate({ ...historicalInput, position, size })).resolves.toEqual({ success: true, version: 1 });

    expect(assertSuperAdmin).toHaveBeenCalledTimes(1);
    expect(assertSuperAdmin).toHaveBeenCalledWith(ctx);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const setting = db.inserted.find(entry => entry.table === systemSettings)?.value;
    expect(setting).toMatchObject({ settingKey: WATERMARK_TEMPLATE_SETTING_KEY, category: "文档影像", status: "published", isSensitive: false, updatedBy: 7 });
    expect(JSON.parse(String(setting?.valueJson))).toEqual({ ...historicalInput, style: "engineering_card", position, size });
    expect(setting?.publishedAt).toBeInstanceOf(Date);
    expect(db.inserted.find(entry => entry.table === auditLogs)?.value).toMatchObject({ userId: 7, module: "settings", action: "save_evidence_watermark_template", targetType: "setting", targetId: WATERMARK_TEMPLATE_SETTING_KEY });
    expect(db.updated).toHaveLength(0);
  });

  it("旧客户端省略布局仍可保存，归一后持久化左下紧凑且保留字段排序", async () => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await adminRouter.createCaller(createContext()).settings.saveEvidenceWatermarkTemplate(historicalInput);
    expect(JSON.parse(String(db.inserted[0]?.value.valueJson))).toEqual({ ...historicalInput, style: "engineering_card", position: "bottom_left", size: "compact" });
  });

  it.each([{ position: "center" }, { position: null }, { size: "large" }, { size: null }])("保存接口严格拒绝无效布局 %j，且没有设置写入", async layout => {
    const db = createSettingsDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const input = { ...historicalInput, ...layout } as Parameters<ReturnType<typeof adminRouter.createCaller>["settings"]["saveEvidenceWatermarkTemplate"]>[0];
    await expect(adminRouter.createCaller(createContext()).settings.saveEvidenceWatermarkTemplate(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getDb).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.inserted).toHaveLength(0);
  });

  it("读取历史已发布配置只补默认布局，不改原设置 JSON、字段排序和版本", async () => {
    const valueJson = JSON.stringify(historicalInput);
    const db = createSettingsDb([{ valueJson, version: 3, status: "published" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const ctx = createContext();
    await expect(adminRouter.createCaller(ctx).settings.evidenceWatermarkTemplate()).resolves.toEqual({
      template: { ...historicalInput, style: "engineering_card", position: "bottom_left", size: "compact" },
      version: 3,
      status: "published",
    });
    expect(assertSuperAdmin).toHaveBeenCalledTimes(1);
    expect(assertSuperAdmin).toHaveBeenCalledWith(ctx);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.inserted).toHaveLength(0);
    expect(db.updated).toHaveLength(0);
  });

  it("读取当前布局与损坏或无效历史配置都通过共享归一化", async () => {
    const caller = adminRouter.createCaller(createContext());
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ valueJson: JSON.stringify({ ...historicalInput, position: "top_right", size: "standard" }), version: 4, status: "published" }]) as never);
    await expect(caller.settings.evidenceWatermarkTemplate()).resolves.toMatchObject({ template: { ...historicalInput, position: "top_right", size: "standard" } });
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ valueJson: JSON.stringify({ ...historicalInput, position: "center", size: "large" }), version: 4, status: "published" }]) as never);
    await expect(caller.settings.evidenceWatermarkTemplate()).resolves.toMatchObject({ template: { ...historicalInput, position: "bottom_left", size: "compact" } });
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ valueJson: "{broken", version: 4, status: "published" }]) as never);
    await expect(caller.settings.evidenceWatermarkTemplate()).resolves.toEqual({ template: DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, version: 4, status: "published" });
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(caller.settings.evidenceWatermarkTemplate()).resolves.toEqual({ template: DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, version: 0, status: "default" });
  });

  it("修订保存仍使用原版本条件、递增发布版本并记录未改写的旧 JSON 快照", async () => {
    const existing = { id: 21, version: 5, category: "文档影像", settingKey: WATERMARK_TEMPLATE_SETTING_KEY, displayName: "工程水印信息模板", valueJson: JSON.stringify(historicalInput), secretEncrypted: null, valuePreview: "道路施工取证 · 3 项信息", isSensitive: false, remarks: "历史模板" };
    const db = createSettingsDb([existing]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(adminRouter.createCaller(createContext()).settings.saveEvidenceWatermarkTemplate({ ...historicalInput, position: "bottom_right", size: "standard" })).resolves.toEqual({ success: true, version: 6 });
    expect(db.updated).toHaveLength(1);
    expect(db.updated[0]).toMatchObject({ table: systemSettings, value: { status: "published", version: 6, updatedBy: 7 }, condition: expect.anything() });
    expect(JSON.parse(String(db.updated[0]?.value.valueJson))).toEqual({ ...historicalInput, style: "engineering_card", position: "bottom_right", size: "standard" });
    const history = db.inserted.find(entry => entry.table === configPublishLogs)?.value;
    expect(history).toMatchObject({ settingId: 21, operation: "publish", version: 6, operatorId: 7 });
    expect(JSON.parse(String(history?.snapshotJson))).toEqual({ category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: null, valuePreview: existing.valuePreview, isSensitive: false, remarks: "历史模板" });
    expect(db.inserted.filter(entry => entry.table === auditLogs)).toHaveLength(1);
  });

  it("并发版本冲突仍拒绝写入发布历史与成功审计", async () => {
    const db = createSettingsDb([{ id: 21, version: 5 }], 0);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(adminRouter.createCaller(createContext()).settings.saveEvidenceWatermarkTemplate({ ...historicalInput, position: "top_left", size: "compact" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.inserted).toHaveLength(0);
  });

  it("无超级管理员权限时读取和保存都在 getDb 前拒绝", async () => {
    vi.mocked(assertSuperAdmin).mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    const caller = adminRouter.createCaller(createContext());
    await expect(caller.settings.evidenceWatermarkTemplate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.settings.saveEvidenceWatermarkTemplate({ ...historicalInput, position: "top_left", size: "standard" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assertSuperAdmin).toHaveBeenCalledTimes(2);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("未登录读取和保存均保留 protectedProcedure 拒绝流程", async () => {
    const caller = adminRouter.createCaller({ ...createContext(), user: null });
    await expect(caller.settings.evidenceWatermarkTemplate()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.settings.saveEvidenceWatermarkTemplate(historicalInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(assertSuperAdmin).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("captureConfig 包含发布 JSON 的位置和大小，同时保留取证岗位与部门守卫", async () => {
    const db = createSettingsDb([{ settingKey: WATERMARK_TEMPLATE_SETTING_KEY, valueJson: JSON.stringify({ ...historicalInput, position: "top_right", size: "standard" }), isSensitive: false }]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const ctx = createContext();
    await expect(evidenceRouter.createCaller(ctx).captureConfig()).resolves.toMatchObject({ watermark: { ...historicalInput, style: "engineering_card", position: "top_right", size: "standard" } });
    expect(getEffectiveRoleCodes).toHaveBeenCalledWith(ctx);
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(ctx, "EVIDENCE");
    expect(getDepartmentModuleDataScope).toHaveBeenCalledWith(ctx, "EVIDENCE");
    expect(db.updated).toHaveLength(0);
    expect(db.inserted).toHaveLength(0);
  });

  it("captureConfig 历史布局默认、损坏模板降级和敏感设置排除仍保留", async () => {
    const caller = evidenceRouter.createCaller(createContext());
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ settingKey: WATERMARK_TEMPLATE_SETTING_KEY, valueJson: JSON.stringify(historicalInput), isSensitive: false }]) as never);
    await expect(caller.captureConfig()).resolves.toMatchObject({ watermark: { ...historicalInput, position: "bottom_left", size: "compact" } });
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ settingKey: WATERMARK_TEMPLATE_SETTING_KEY, valueJson: "{broken", isSensitive: false }]) as never);
    expect((await caller.captureConfig()).watermark).toEqual(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE);
    vi.mocked(getDb).mockResolvedValue(createSettingsDb([{ settingKey: WATERMARK_TEMPLATE_SETTING_KEY, valueJson: JSON.stringify({ ...historicalInput, position: "top_left", size: "standard" }), isSensitive: true }]) as never);
    expect((await caller.captureConfig()).watermark).toEqual(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE);
    vi.mocked(getDb).mockResolvedValue(null);
    expect((await caller.captureConfig()).watermark).toEqual(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE);
  });
});
