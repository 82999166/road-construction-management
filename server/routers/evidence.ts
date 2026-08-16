import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assertEvidenceImageSignature } from "../../shared/domain";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, normalizeEvidenceWatermarkTemplate, WATERMARK_TEMPLATE_SETTING_KEY, type EvidenceWatermarkTemplate } from "../../shared/watermarkTemplate";
import { attendanceRecords, auditLogs, dieselRefuelRecords, evidenceRecords, financialInvoices, financialRecords, machineCostRecords, measurementTakeoffEvidences, projects, purchaseOrders, systemSettings, transportTrips } from "../../drizzle/schema";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const evidenceSourceSchema = z.enum(["site_photo", "safety", "transport", "attendance", "purchase", "other"]);
const CAPTURE_CONNECTOR_SETTING_KEYS = ["EVIDENCE_CAMERA_PROVIDER", "EVIDENCE_LOCATION_PROVIDER", "EVIDENCE_LOCATION_REQUIRED", WATERMARK_TEMPLATE_SETTING_KEY] as const;
type CaptureConnectorConfig = {
  camera: { provider: "browser" | "disabled"; enabled: boolean };
  location: { provider: "browser" | "disabled"; enabled: boolean; required: boolean };
  watermark: EvidenceWatermarkTemplate;
};
const ocrResultSchema = z.object({
  documentType: z.string().max(80),
  issuer: z.string().max(200),
  documentNo: z.string().max(120),
  issueDate: z.string().max(32),
  amount: z.string().max(64),
  currency: z.string().max(16),
  summary: z.string().max(500),
  confidence: z.number().min(0).max(1),
  requiresManualReview: z.boolean(),
});

/** 现场影像元数据；经纬度可缺省，但一旦上传必须落在合法地理范围。 */
const evidenceUploadInput = z.object({
  projectId: z.number().int().positive(),
  sourceType: evidenceSourceSchema,
  sourceId: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().min(1, "请填写现场说明").max(500),
  capturedAt: z.string().datetime(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64Data: z.string().min(1).max(11_500_000),
});

/** 图片文件名只保留路径安全的中文、数字和常用扩展字符。 */
function getSafeEvidenceFileName(fileName: string) {
  return fileName.replace(/[^\w.()\-\u4e00-\u9fa5]/g, "_").slice(0, 160) || "evidence.jpg";
}

/** 严格校验 Base64 编码，避免 Buffer 对非编码字符的宽松容错掩盖非法上传。 */
function decodeEvidenceBase64(value: string) {
  const normalized = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "影像文件编码无效" });
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length || buffer.length > MAX_EVIDENCE_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "影像文件为空或超过 8MB 限制" });
  }
  return buffer;
}

/** 从兼容的模型响应中提取文本内容，多模态回显不可作为 OCR 结构化结果使用。 */
function getOcrResponseText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  const textPart = content.find((item): item is { type: "text"; text: string } => Boolean(item && typeof item === "object" && "type" in item && (item as { type?: unknown }).type === "text" && "text" in item && typeof (item as { text?: unknown }).text === "string"));
  if (!textPart) throw new Error("OCR 服务未返回可解析文本");
  return textPart.text;
}

/** 解析受 JSON Schema 约束的 OCR 结果；模型输出始终被标记为需人工复核。 */
function parseOcrResult(rawText: string) {
  const normalized = rawText.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = ocrResultSchema.parse(JSON.parse(normalized));
  return { ...parsed, requiresManualReview: true };
}

/**
 * 现场取证仅暴露浏览器采集连接器的公开运行状态；配置值来自已发布、非敏感的系统设置。
 * 上传接口仍在服务端强制执行该状态，避免仅依赖移动端禁用按钮而被绕过。
 */
async function getCaptureConnectorConfig(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<CaptureConnectorConfig> {
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson, isSensitive: systemSettings.isSensitive })
    .from(systemSettings)
    .where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, CAPTURE_CONNECTOR_SETTING_KEYS)));
  const values = new Map(rows.filter(row => !row.isSensitive && row.valueJson !== null).map(row => [row.settingKey, String(row.valueJson).trim()]));
  const cameraProvider = values.get("EVIDENCE_CAMERA_PROVIDER")?.toLowerCase() === "disabled" ? "disabled" : "browser";
  const locationProvider = values.get("EVIDENCE_LOCATION_PROVIDER")?.toLowerCase() === "disabled" ? "disabled" : "browser";
  const locationRequired = locationProvider === "browser" && values.get("EVIDENCE_LOCATION_REQUIRED")?.toLowerCase() === "true";
  let watermark = { ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields] };
  try { watermark = normalizeEvidenceWatermarkTemplate(values.get(WATERMARK_TEMPLATE_SETTING_KEY) ? JSON.parse(values.get(WATERMARK_TEMPLATE_SETTING_KEY)!) : null); } catch { /* 损坏模板安全降级为默认工程水印 */ }
  return {
    camera: { provider: cameraProvider, enabled: cameraProvider === "browser" },
    location: { provider: locationProvider, enabled: locationProvider === "browser", required: locationRequired },
    watermark,
  };
}

/** 影像取证同时要求有效业务岗位、现场取证部门模块与该模块项目范围。 */
async function assertEvidenceAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  const roles = await getEffectiveRoleCodes(ctx);
  if (!roles.length) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未获现场影像取证授权" });
  await assertDepartmentBusinessAccess(ctx, "EVIDENCE");
  return getDepartmentModuleDataScope(ctx, "EVIDENCE");
}

/**
 * 水印影像取证路由。
 * 文件字节保存在对象存储，数据库仅保存可审计的文件键、时间、坐标和业务关联元数据。
 */
export const evidenceRouter = router({
  /** 已发布的采集连接器运行状态，供移动端在发起浏览器 API 前给出明确提示。 */
  captureConfig: protectedProcedure.query(async ({ ctx }) => {
    await assertEvidenceAccess(ctx);
    const db = await getDb();
    if (!db) return { camera: { provider: "browser" as const, enabled: true }, location: { provider: "browser" as const, enabled: true, required: false }, watermark: { ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields] } };
    return getCaptureConnectorConfig(db);
  }),

  /** 返回当前用户在授权项目和组织范围内可选择的项目，避免移动端通过猜测 ID 探测项目。 */
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    const [db, scope] = await Promise.all([getDb(), assertEvidenceAccess(ctx)]);
    if (!db) return [];
    const rows = await db.select({ id: projects.id, name: projects.name, organizationId: projects.organizationId, status: projects.status }).from(projects).orderBy(projects.sortOrder, projects.id);
    return rows.filter(project => scope.hasAllProjects || scope.projectIds.includes(project.id) || (project.organizationId !== null && scope.organizationIds.includes(project.organizationId)));
  }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), sourceType: evidenceSourceSchema.optional(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      await assertEvidenceAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(evidenceRecords)
        .where(eq(evidenceRecords.projectId, input.projectId))
        .orderBy(desc(evidenceRecords.capturedAt), desc(evidenceRecords.createdAt))
        .limit(input.limit);
      const filteredRows = input.sourceType ? rows.filter(row => row.sourceType === input.sourceType) : rows;
      const deleteDecision = await getRoleOperationPermissionDecision(ctx, "EVIDENCE", "void");
      return Promise.all(filteredRows.map(async row => {
        // 正式部署的托管存储代理可能以 307 跳转到对象域名；部分微信浏览器不会在
        // `<img>` 请求中可靠跟随该跳转，直接签发短时图片 URL 可避免页面只显示 alt 文本。
        const signedImageUrl = await storageGetSignedUrl(row.fileKey);
        let watermark: { description?: string } | null = null;
        let ocrResult: z.infer<typeof ocrResultSchema> | null = null;
        try { watermark = row.watermarkJson ? JSON.parse(row.watermarkJson) as { description?: string } : null; } catch { watermark = null; }
        try { ocrResult = row.ocrResultJson ? ocrResultSchema.parse(JSON.parse(row.ocrResultJson)) : null; } catch { ocrResult = null; }
        return {
          id: row.id,
          projectId: row.projectId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          fileName: row.fileName,
          mimeType: row.mimeType,
          description: watermark?.description ?? "现场影像",
          longitude: row.longitude,
          latitude: row.latitude,
          capturedAt: row.capturedAt,
          createdAt: row.createdAt,
          url: signedImageUrl,
          ocrResult,
          canDelete: row.uploadedBy === ctx.user?.id || deleteDecision.allowed,
        };
      }));
    }),

  upload: protectedProcedure.input(evidenceUploadInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertEvidenceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const imageBytes = decodeEvidenceBase64(input.base64Data);
    try {
      assertEvidenceImageSignature(imageBytes, input.mimeType);
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "影像文件格式无效" });
    }
    const captureConfig = await getCaptureConnectorConfig(db);
    if (!captureConfig.camera.enabled) {
      throw new TRPCError({ code: "FORBIDDEN", message: "现场影像采集连接器已被管理员停用" });
    }
    if (captureConfig.location.required && (input.longitude === null || input.longitude === undefined || input.latitude === null || input.latitude === undefined)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "当前项目要求上传现场影像时附带有效定位" });
    }
    const capturedAt = new Date(input.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "拍摄时间无效" });
    const storedFile = await storagePut(`evidence/${input.projectId}/${capturedAt.toISOString().slice(0, 10)}/${user.id}-${getSafeEvidenceFileName(input.fileName)}`, imageBytes, input.mimeType);
    const watermarkJson = JSON.stringify({ description: input.description, capturedAt: capturedAt.toISOString(), longitude: input.longitude ?? null, latitude: input.latitude ?? null, version: 1 });
    const result = await db.insert(evidenceRecords).values({
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      fileKey: storedFile.key,
      fileName: input.fileName,
      mimeType: input.mimeType,
      watermarkJson,
      longitude: input.longitude === null || input.longitude === undefined ? null : String(input.longitude),
      latitude: input.latitude === null || input.latitude === undefined ? null : String(input.latitude),
      capturedAt,
      uploadedBy: user.id,
    });
    const evidenceId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
    await db.insert(auditLogs).values({ userId: user.id, module: "evidence", action: "upload", targetType: "evidence", targetId: String(evidenceId || storedFile.key), summary: `归档现场影像：${input.sourceType} · ${input.description.slice(0, 80)}` });
    return { success: true, id: evidenceId || null, url: storedFile.url };
  }),

  /**
   * 删除未被业务单据引用的取证影像。对象存储模板不提供物理删除接口；删除数据库
   * 文件键和所有 UI 引用后，对象会成为不可访问的无引用对象，由平台生命周期管理。
   */
  delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertEvidenceAccess(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [evidence] = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.id)).limit(1);
    if (!evidence) throw new TRPCError({ code: "NOT_FOUND", message: "影像记录不存在或已被删除" });
    if (!evidence.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "未归属项目的影像不能执行删除" });
    await assertProjectInCurrentScope(ctx, evidence.projectId);

    if (evidence.uploadedBy !== user.id) {
      await assertDepartmentBusinessAccess(ctx, "EVIDENCE", "void");
    }

    const dependencies = await Promise.all([
      db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(eq(attendanceRecords.evidenceId, evidence.id)).limit(1),
      db.select({ id: machineCostRecords.id }).from(machineCostRecords).where(eq(machineCostRecords.evidenceId, evidence.id)).limit(1),
      db.select({ id: dieselRefuelRecords.id }).from(dieselRefuelRecords).where(eq(dieselRefuelRecords.evidenceId, evidence.id)).limit(1),
      db.select({ id: transportTrips.id }).from(transportTrips).where(eq(transportTrips.evidenceId, evidence.id)).limit(1),
      db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.evidenceId, evidence.id)).limit(1),
      db.select({ id: measurementTakeoffEvidences.takeoffId }).from(measurementTakeoffEvidences).where(eq(measurementTakeoffEvidences.evidenceId, evidence.id)).limit(1),
      db.select({ id: financialRecords.id }).from(financialRecords).where(eq(financialRecords.evidenceId, evidence.id)).limit(1),
      db.select({ id: financialInvoices.id }).from(financialInvoices).where(eq(financialInvoices.evidenceId, evidence.id)).limit(1),
    ]);
    if (dependencies.some(rows => rows.length > 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "该影像已关联考勤、成本、运输、采购、计量或财务单据，不能删除；请保留作为业务审计凭证" });
    }

    await db.delete(evidenceRecords).where(eq(evidenceRecords.id, evidence.id));
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "evidence",
      action: "delete",
      targetType: "evidence",
      targetId: String(evidence.id),
      summary: `删除未关联现场影像：${evidence.sourceType} · ${evidence.fileName}；对象存储文件已失去系统引用`,
    });
    return { success: true };
  }),

  /**
   * 用户主动触发的票据 OCR。只将当前记录的短时签名地址交给模型；
   * 识别结果不得直接入账，始终标记为“需人工复核”。
   */
  ocr: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertEvidenceAccess(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const rows = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.id)).limit(1);
    const evidence = rows[0];
    if (!evidence) throw new TRPCError({ code: "NOT_FOUND", message: "影像记录不存在" });
    if (!evidence.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "未归属项目的影像不能执行票据识别" });
    await assertProjectInCurrentScope(ctx, evidence.projectId);
    if (!["image/jpeg", "image/png"].includes(evidence.mimeType || "")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "仅支持 JPG、PNG 影像进行票据识别" });
    }
    try {
      const signedUrl = await storageGetSignedUrl(evidence.fileKey);
      const result = await invokeLLM({
        maxTokens: 700,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "receipt_ocr_result",
            strict: true,
            schema: {
              type: "object",
              properties: {
                documentType: { type: "string" }, issuer: { type: "string" }, documentNo: { type: "string" }, issueDate: { type: "string" }, amount: { type: "string" }, currency: { type: "string" }, summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, requiresManualReview: { type: "boolean" },
              },
              required: ["documentType", "issuer", "documentNo", "issueDate", "amount", "currency", "summary", "confidence", "requiresManualReview"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          { role: "system", content: "你是施工承包系统的票据 OCR 助手。仅提取图像中可见文字；不确定时字段填空字符串、confidence 降低。不得推测或补全。所有结果都必须要求人工复核。" },
          { role: "user", content: [{ type: "text", text: "请读取这张票据或验收单影像，返回结构化 JSON。金额保留图中原始文本；不能确定的字段为空字符串。" }, { type: "image_url", image_url: { url: signedUrl, detail: "high" } }] },
        ],
      });
      const ocrResult = parseOcrResult(getOcrResponseText(result.choices[0]?.message.content ?? ""));
      await db.update(evidenceRecords).set({ ocrResultJson: JSON.stringify(ocrResult) }).where(eq(evidenceRecords.id, evidence.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "evidence", action: "ocr", targetType: "evidence", targetId: String(evidence.id), summary: `执行票据 OCR：${ocrResult.documentType || "未识别类型"}，结果需人工复核` });
      return { success: true, ocrResult };
    } catch {
      await db.insert(auditLogs).values({ userId: user.id, module: "evidence", action: "ocr_failed", targetType: "evidence", targetId: String(evidence.id), summary: "票据 OCR 未完成；可稍后重试或人工录入" });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "票据识别暂不可用，请稍后重试或人工录入" });
    }
  }),
});
