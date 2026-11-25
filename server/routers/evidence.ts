import { TRPCError } from "@trpc/server";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assertEvidenceImageSignature } from "../../shared/domain";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, normalizeEvidenceWatermarkTemplate, WATERMARK_TEMPLATE_SETTING_KEY, type EvidenceWatermarkTemplate } from "../../shared/watermarkTemplate";
import { auditLogs, constructionDailyReports, evidenceRecords, projects, systemSettings } from "../../drizzle/schema";
import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { appendIntegrityProtectedAudit } from "../services/auditIntegrity";
import { assertEvidenceConditionalWrite, collectEvidenceReferences, evidenceDeleteBlockedReason, GENERAL_EVIDENCE_SOURCES, isGeneralEvidenceVisible, lockEvidenceProject, type EvidenceRow, type EvidenceTransaction } from "../services/evidenceIntegrity";

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const evidenceSourceSchema = z.enum(["site_photo", "safety", "transport", "attendance", "purchase", "diesel_receipt", "other"]);
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
 * 施工日报的现场照片是施工业务的从属凭证。若账号没有独立“影像取证”入口，
 * 但已具备施工模块和现场岗位授权，仍允许它在已有施工项目范围内生成日报水印照片。
 * 其他取证类型继续必须使用 EVIDENCE 授权，避免扩大通用影像采集范围。
 */
async function assertConstructionSitePhotoAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION");
  const roles = await getEffectiveRoleCodes(ctx);
  if (!roles.includes("ALL") && !roles.some(role => ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"].includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获施工日报现场照片上传授权" });
  }
}

async function assertEvidenceUploadAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0], sourceType: z.infer<typeof evidenceSourceSchema>) {
  try {
    await assertEvidenceAccess(ctx);
    return "EVIDENCE" as const;
  } catch (error) {
    if (sourceType !== "site_photo") throw error;
    await assertConstructionSitePhotoAccess(ctx);
    return "CONSTRUCTION" as const;
  }
}

async function assertModuleProjectScope(ctx: Parameters<typeof requireAuthenticatedUser>[0], tx: EvidenceTransaction, projectId: number, module: "EVIDENCE" | "CONSTRUCTION") {
  const scope = await getDepartmentModuleDataScope(ctx, module);
  if (scope.hasAllProjects || scope.projectIds.includes(projectId)) return;
  if (scope.organizationIds.length) {
    const [project] = await tx.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (project?.organizationId && scope.organizationIds.includes(project.organizationId)) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "当前模块未获该项目授权" });
}

function constructionReportSourceId(sourceType: string, sourceId: string | null | undefined) {
  if (!sourceId?.startsWith("construction-report")) return null;
  const match = /^construction-report-([1-9]\d*)$/.exec(sourceId);
  const id = match ? Number(match[1]) : NaN;
  if (sourceType !== "site_photo" || !Number.isSafeInteger(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "日报照片来源编号格式无效，请从日报上传入口重试" });
  return id;
}

async function assertConstructionPhotoParent(ctx: Parameters<typeof requireAuthenticatedUser>[0], tx: EvidenceTransaction, input: z.infer<typeof evidenceUploadInput>, lock = false) {
  const reportId = constructionReportSourceId(input.sourceType, input.sourceId);
  if (reportId === null) return;
  await assertConstructionSitePhotoAccess(ctx);
  await assertModuleProjectScope(ctx, tx, input.projectId, "CONSTRUCTION");
  const query = tx.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, reportId)).limit(1);
  const [report] = await (lock ? query.for("update") : query);
  if (!report || report.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "日报不存在或不属于当前项目，请从日报详情重新上传" });
  if (!["draft", "rejected"].includes(report.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "仅草稿或退回日报允许追加照片；已提交、审核或归档日报请走补证流程" });
  if (report.createdBy !== ctx.user?.id) await assertExistingBusinessRecordChangeAccess(ctx);
}

async function assertGeneralEvidence(ctx: Parameters<typeof requireAuthenticatedUser>[0], tx: EvidenceTransaction, evidence: EvidenceRow, lock = false) {
  if (!evidence || evidence.status !== "active") throw new TRPCError({ code: "NOT_FOUND", message: "影像记录不存在或已被删除" });
  if (!evidence.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "未归属项目的影像不能执行通用操作" });
  await assertProjectInCurrentScope(ctx, evidence.projectId);
  await assertModuleProjectScope(ctx, tx, evidence.projectId, "EVIDENCE");
  if (!GENERAL_EVIDENCE_SOURCES.includes(evidence.sourceType as typeof GENERAL_EVIDENCE_SOURCES[number])) throw new TRPCError({ code: "FORBIDDEN", message: "该附件属于专用业务，请在原业务模块查看或处理" });
  const references = (await collectEvidenceReferences(tx, [evidence], lock)).get(evidence.id)!;
  if (!isGeneralEvidenceVisible(evidence, references)) throw new TRPCError({ code: "FORBIDDEN", message: "该附件已用于专用或不明确的来源业务，请在原业务模块查看或处理" });
  return references;
}

/**
 * 水印影像取证路由。
 * 文件字节保存在对象存储，数据库仅保存可审计的文件键、时间、坐标和业务关联元数据。
 */
export const evidenceRouter = router({
  /** 已发布的采集连接器运行状态，供移动端在发起浏览器 API 前给出明确提示。 */
  captureConfig: protectedProcedure.query(async ({ ctx }) => {
    try {
      await assertEvidenceAccess(ctx);
    } catch (error) {
      await assertConstructionSitePhotoAccess(ctx).catch(() => { throw error; });
    }
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
      await assertModuleProjectScope(ctx, db, input.projectId, "EVIDENCE");
      const rows = await db
        .select()
        .from(evidenceRecords)
        .where(and(eq(evidenceRecords.projectId, input.projectId), eq(evidenceRecords.status, "active"), inArray(evidenceRecords.sourceType, input.sourceType ? [input.sourceType] : [...GENERAL_EVIDENCE_SOURCES])))
        .orderBy(desc(evidenceRecords.capturedAt), desc(evidenceRecords.createdAt))
        .limit(input.limit);
      const references = await collectEvidenceReferences(db, rows);
      const filteredRows = rows.filter(row => (!input.sourceType || row.sourceType === input.sourceType) && isGeneralEvidenceVisible(row, references.get(row.id)!));
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
          sourceAssociationStatus: references.get(row.id)!.length ? "referenced" as const : row.sourceId?.trim() ? "unverified_marker" as const : "unassigned" as const,
          fileName: row.fileName,
          mimeType: row.mimeType,
          description: watermark?.description ?? "现场影像",
          locationProtection: row.longitude !== null && row.latitude !== null ? "原始坐标已受保护；仅可在争议核验流程中受控查看" : "未采集定位",
          contentSha256: row.contentSha256,
          contentBytes: row.contentBytes,
          capturedAt: row.capturedAt,
          createdAt: row.createdAt,
          url: signedImageUrl,
          ocrResult,
          canDelete: !evidenceDeleteBlockedReason(row, references.get(row.id)!) && (row.uploadedBy === ctx.user?.id || deleteDecision.allowed),
          deletionBlockedReason: evidenceDeleteBlockedReason(row, references.get(row.id)!),
        };
      }));
    }),

  upload: protectedProcedure.input(evidenceUploadInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const accessModule = await assertEvidenceUploadAccess(ctx, input.sourceType);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const reportId = constructionReportSourceId(input.sourceType, input.sourceId);
    if (accessModule === "CONSTRUCTION" && reportId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "施工照片必须从已保存的日报入口上传，不能以自由来源号宣称关联" });
    if (/^takeoff-pending(?:-|$)/i.test(input.sourceId ?? "")) throw new TRPCError({ code: "BAD_REQUEST", message: "收方待关联照片请使用工程量收方专用上传入口" });
    if (/^(?:payroll|salary|settlement[-_]payment|financial|personnel|employee|insurance|tax|contract)[-_:]/i.test(input.sourceId ?? "")) throw new TRPCError({ code: "BAD_REQUEST", message: "专用业务附件请使用原业务上传入口" });
    await assertModuleProjectScope(ctx, db, input.projectId, accessModule);
    await assertConstructionPhotoParent(ctx, db, input);
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
    if (captureConfig.location.required && input.sourceType !== "diesel_receipt" && (input.longitude === null || input.longitude === undefined || input.latitude === null || input.latitude === undefined)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "当前项目要求上传现场影像时附带有效定位" });
    }
    const capturedAt = new Date(input.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "拍摄时间无效" });
    const contentSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const storedFile = await storagePut(`evidence/${input.projectId}/${capturedAt.toISOString().slice(0, 10)}/${user.id}-${randomUUID()}-${getSafeEvidenceFileName(input.fileName)}`, imageBytes, input.mimeType);
    const watermarkJson = JSON.stringify({ description: input.description, capturedAt: capturedAt.toISOString(), longitude: input.longitude ?? null, latitude: input.latitude ?? null, version: 1, genericEvidenceUpload: true, validatedConstructionReportId: reportId });
    let evidenceId = 0;
    await db.transaction(async tx => {
      const project = await lockEvidenceProject(tx, input.projectId);
      if (["completed", "archived"].includes(project.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "已完结或归档项目不能新增影像，请走补证流程" });
      await assertModuleProjectScope(ctx, tx, input.projectId, accessModule);
      await assertConstructionPhotoParent(ctx, tx, input, true);
      const result = await tx.insert(evidenceRecords).values({ projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId ?? null, fileKey: storedFile.key, fileName: input.fileName, mimeType: input.mimeType, contentSha256, contentBytes: imageBytes.length, watermarkJson, longitude: input.longitude === null || input.longitude === undefined ? null : String(input.longitude), latitude: input.latitude === null || input.latitude === undefined ? null : String(input.latitude), capturedAt, retentionUntil: null, status: "active", uploadedBy: user.id });
      evidenceId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "影像未能归档，请重试" });
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "evidence", action: "upload", targetType: "evidence", targetId: String(evidenceId || storedFile.key), summary: `归档现场影像：${input.sourceType} · ${input.description.slice(0, 80)}`, afterJson: JSON.stringify({ contentSha256, contentBytes: imageBytes.length, projectId: input.projectId, sourceType: input.sourceType }) });
    });
    return { success: true, id: evidenceId || null, url: storedFile.url };
  }),

  /**
   * 未使用误上传只 soft delete，原文件键/水印/坐标/指纹和来源指针全部保留。
   * 当前、历史、JSON/自由文本引用及来源不明确者不得删除；对象不物理移除。
   */
  delete: protectedProcedure.input(z.object({ id: z.number().int().positive(), deletionReason: z.string().trim().min(5, "请说明删除原因，至少 5 个字符").max(500) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertEvidenceAccess(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [evidence] = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.id)).limit(1);
    if (!evidence || evidence.status !== "active") throw new TRPCError({ code: "NOT_FOUND", message: "影像记录不存在或已被删除" });
    if (!evidence.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "未归属项目的影像不能执行删除" });
    await assertProjectInCurrentScope(ctx, evidence.projectId);
    await assertModuleProjectScope(ctx, db, evidence.projectId, "EVIDENCE");
    if (evidence.uploadedBy !== user.id) {
      await assertDepartmentBusinessAccess(ctx, "EVIDENCE", "void");
    }
    await db.transaction(async tx => {
      await lockEvidenceProject(tx, evidence.projectId!);
      const [locked] = await tx.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.id)).limit(1).for("update");
      if (!locked || locked.projectId !== evidence.projectId || locked.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "影像状态或归属已变化，请刷新后重试" });
      if (locked.uploadedBy !== user.id) await assertDepartmentBusinessAccess(ctx, "EVIDENCE", "void");
      const references = await assertGeneralEvidence(ctx, tx, locked, true);
      const blockedReason = evidenceDeleteBlockedReason(locked, references);
      if (blockedReason) throw new TRPCError({ code: "BAD_REQUEST", message: blockedReason });
      const result = await tx.update(evidenceRecords).set({ status: "deleted", deletedAt: new Date(), deletedBy: user.id, deletionReason: input.deletionReason }).where(and(eq(evidenceRecords.id, locked.id), eq(evidenceRecords.projectId, locked.projectId!), eq(evidenceRecords.status, "active")));
      assertEvidenceConditionalWrite(result);
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "evidence", action: "soft_delete", targetType: "evidence", targetId: String(locked.id), summary: `受控删除未关联现场影像：${locked.sourceType} · ${locked.fileName}；对象键保留以便审计追溯`, beforeJson: JSON.stringify({ contentSha256: locked.contentSha256, contentBytes: locked.contentBytes, fileKey: locked.fileKey, sourceType: locked.sourceType, sourceId: locked.sourceId, watermarkJson: locked.watermarkJson }), afterJson: JSON.stringify({ status: "deleted", deletionReason: input.deletionReason }) });
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
    await assertGeneralEvidence(ctx, db, evidence);
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
      await db.transaction(async tx => {
        await lockEvidenceProject(tx, evidence.projectId!);
        const [locked] = await tx.select().from(evidenceRecords).where(eq(evidenceRecords.id, evidence.id)).limit(1).for("update");
        if (!locked || locked.projectId !== evidence.projectId) throw new TRPCError({ code: "CONFLICT", message: "影像归属已变化，请刷新后重试" });
        await assertGeneralEvidence(ctx, tx, locked, true);
        const write = await tx.update(evidenceRecords).set({ ocrResultJson: JSON.stringify(ocrResult) }).where(and(eq(evidenceRecords.id, evidence.id), eq(evidenceRecords.status, "active")));
        assertEvidenceConditionalWrite(write);
        await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "evidence", action: "ocr", targetType: "evidence", targetId: String(evidence.id), summary: `执行票据 OCR：${ocrResult.documentType || "未识别类型"}，结果需人工复核` });
      });
      return { success: true, ocrResult };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      await db.insert(auditLogs).values({ userId: user.id, module: "evidence", action: "ocr_failed", targetType: "evidence", targetId: String(evidence.id), summary: "票据 OCR 未完成；可稍后重试或人工录入" });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "票据识别暂不可用，请稍后重试或人工录入" });
    }
  }),
});
