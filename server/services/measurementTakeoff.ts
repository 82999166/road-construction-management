import { TRPCError } from "@trpc/server";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { assertEvidenceImageSignature } from "../../shared/domain";
import { BUSINESS_DOCUMENT_MODULES } from "../../shared/businessDocumentNumber";
import { takeoffMeasurementRowSchema, type MeasurementTakeoffInput, type TakeoffAttachmentUploadInput } from "../../shared/measurementTakeoff";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, normalizeEvidenceWatermarkTemplate, WATERMARK_TEMPLATE_SETTING_KEY } from "../../shared/watermarkTemplate";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, getSuperAdminAccess, requireAuthenticatedUser } from "../access";
import { createContext, type TrpcContext } from "../_core/context";
import { ENV } from "../_core/env";
import { assertLocalManagerTerminalAccess } from "../localAuth";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { isAliyunOssPhotoStorageKey } from "./aliyunOssPhotoStorage";
import { appendIntegrityProtectedAudit } from "./auditIntegrity";
import { allocateBusinessDocumentNumber } from "./businessDocumentNumber";
import { businessCreationRequestKey, businessDocumentCreationDatabase, runBusinessDocumentCreation } from "./businessDocumentCreation";
import { lockBusinessEvidenceBindings } from "./evidenceBinding";
import { assertEvidenceConditionalWrite, collectEvidenceReferences, isGeneralEvidenceVisible, lockEvidenceProject, type EvidenceRow } from "./evidenceIntegrity";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReadDb = Pick<Db, "select">;
type RecordRow = typeof s.measurementTakeoffRecords.$inferSelect;
const MAX_BYTES = 8 * 1024 * 1024;
const allowedRoles = ["MEASUREMENT_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "ACCOUNTANT"];
const canWrite = (roles: string[]) => roles.includes("ALL") || roles.some(role => ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER"].includes(role));
const pendingSource = (actorId: number) => new RegExp(`^takeoff-pending-${actorId}-[a-f0-9-]{36}$`);
const fail: (code: "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND", message: string) => never = (code, message) => { throw new TRPCError({ code, message }); };
async function requireDb() { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" }); return db; }

/** 不复用聚合项目范围；每次检查 MEASUREMENT 的真实模块范围与当前岗位。 */
export async function assertTakeoffAccess(ctx: TrpcContext, db: ReadDb, projectId: number, action: "read" | "print" | "create" | "edit" = "read") {
  const actor = requireAuthenticatedUser(ctx);
  await assertDepartmentBusinessAccess(ctx, "MEASUREMENT", action);
  const roles = await getEffectiveRoleCodes(ctx);
  if (!roles.includes("ALL") && !roles.some(role => allowedRoles.includes(role))) fail("FORBIDDEN", "当前岗位未获工程计量数据访问授权");
  if (["create", "edit"].includes(action) && !canWrite(roles)) fail("FORBIDDEN", "项目经理或施工管理员方可维护收方资料");
  // HTTP预览没有RPC中间件；已有记录编辑也须锁后重验原高影响权限边界。
  if (action === "edit" && !(await getSuperAdminAccess(ctx)).canAccess) {
    const permission = await getRoleOperationPermissionDecision(ctx, "MEASUREMENT", "edit");
    if (!permission.hasDetailedPermissions || !permission.allowed) fail("FORBIDDEN", "当前账号无修改既有业务记录权限");
  }
  await assertProjectInCurrentScope(ctx, projectId);
  const scope = await getDepartmentModuleDataScope(ctx, "MEASUREMENT");
  const [project] = await db.select({ id: s.projects.id, name: s.projects.name, status: s.projects.status, organizationId: s.projects.organizationId }).from(s.projects).where(eq(s.projects.id, projectId)).limit(1);
  if (!project) fail("NOT_FOUND", "收方所属项目不存在");
  if (!scope.hasAllProjects && !scope.projectIds.includes(projectId) && !(project.organizationId !== null && scope.organizationIds.includes(project.organizationId))) fail("FORBIDDEN", "当前计量模块未获该项目授权");
  if (["create", "edit"].includes(action) && ["suspended", "completed", "archived"].includes(project.status)) fail("BAD_REQUEST", "已停用、完结或归档项目不能维护收方或新增图片，请走补证流程");
  return { actor, project };
}
function parseWatermark(row: EvidenceRow): Record<string, unknown> { try { const parsed = JSON.parse(row.watermarkJson ?? "null"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** 内容 + 真实最新审计ID + 原附件指针digest；同秒编辑及附件新增均改变版本。 */
export function takeoffVersion(record: RecordRow, auditId: number, evidences: EvidenceRow[]) {
  return `takeoff-v1:${createHash("sha256").update(JSON.stringify(canonical({ record, auditId, evidences: evidences.map(row => ({ id: row.id, projectId: row.projectId, sourceType: row.sourceType, sourceId: row.sourceId, fileKey: row.fileKey, fileName: row.fileName, mimeType: row.mimeType, status: row.status, contentSha256: row.contentSha256, contentBytes: row.contentBytes, capturedAt: row.capturedAt, description: parseWatermark(row).description ?? null })).sort((a, b) => a.id - b.id) }))).digest("hex")}`;
}
async function versionFor(db: ReadDb, record: RecordRow, evidences: EvidenceRow[], lock = false) {
  const query = db.select({ id: s.auditLogs.id }).from(s.auditLogs).where(and(eq(s.auditLogs.module, "measurement"), eq(s.auditLogs.targetType, "measurement_takeoff"), eq(s.auditLogs.targetId, String(record.id)))).orderBy(desc(s.auditLogs.id)).limit(1);
  const [audit] = await (lock ? query.for("update") : query);
  return takeoffVersion(record, Number(audit?.id ?? 0), evidences);
}
async function originalEvidence(db: ReadDb, takeoffId: number, projectId: number) {
  const links = await db.select().from(s.measurementTakeoffEvidences).where(eq(s.measurementTakeoffEvidences.takeoffId, takeoffId));
  const rows = await db.select().from(s.evidenceRecords).where(or(eq(s.evidenceRecords.sourceId, `takeoff-${takeoffId}`), links.length ? inArray(s.evidenceRecords.id, links.map(link => link.evidenceId)) : undefined)).orderBy(asc(s.evidenceRecords.id));
  return { links, rows, projectId };
}
async function checkReadableEvidence(db: ReadDb, row: EvidenceRow, projectId: number, takeoffId: number, linked: boolean) {
  if (row.projectId !== projectId || row.status !== "active" || row.sourceType !== "site_photo" || !["image/jpeg", "image/png"].includes(row.mimeType ?? "") || !row.fileKey || !(row.sourceId === `takeoff-${takeoffId}` || linked && row.sourceId === null)) fail("FORBIDDEN", "收方图片引用已失效或来源不一致，请在原业务核验，不能跳过引用打印");
  if (row.contentBytes !== null && (!Number.isSafeInteger(row.contentBytes) || row.contentBytes <= 0 || row.contentBytes > MAX_BYTES) || row.contentSha256 !== null && !/^[a-f0-9]{64}$/.test(row.contentSha256)) fail("FORBIDDEN", "收方图片完整性资料不一致");
  const refs = (await collectEvidenceReferences(db, [row])).get(row.id)!;
  if (!isGeneralEvidenceVisible(row, refs)) fail("FORBIDDEN", "收方图片属于财税、合同或其它专用附件，不能借用");
}

export async function saveMeasurementTakeoff(ctx: TrpcContext, input: MeasurementTakeoffInput) {
  const db = await requireDb();
  const actor = requireAuthenticatedUser(ctx);
  await assertTakeoffAccess(ctx, db, input.projectId, input.id ? "edit" : "create");
  return runBusinessDocumentCreation(db, { actorId: actor.id, scope: "finance:saveTakeoff", projectId: input.projectId, input, revalidate: async () => assertTakeoffAccess(ctx, businessDocumentCreationDatabase() ?? db, input.projectId, input.id ? "edit" : "create") }, async tx => {
    const original = input.id ? await originalEvidence(tx, input.id, input.projectId) : { links: [], rows: [] as EvidenceRow[] };
    const oldIds = Array.from(new Set([...original.links.map(link => link.evidenceId), ...original.rows.map(row => row.id)]));
    const addedIds = Array.from(new Set(input.attachmentEvidenceIds ?? []));
    const binding = await lockBusinessEvidenceBindings(tx, { projectId: input.projectId, actorId: actor.id, module: "measurement", targetType: "measurement_takeoff", targetId: String(input.id ?? "new"), parent: input.id ? { table: s.measurementTakeoffRecords, id: input.id } : undefined, oldPointers: { evidenceIds: oldIds }, retainedPointers: { evidenceIds: oldIds }, bindings: addedIds.map(id => ({ field: "attachmentEvidenceId", id, allowedSourceTypes: ["site_photo"], sourcePattern: new RegExp(`^(?:takeoff-pending-${actor.id}-[a-f0-9-]{36}${input.id ? `|takeoff-${input.id}` : ""})$`) })) });
    await assertTakeoffAccess(ctx, tx, input.projectId, input.id ? "edit" : "create");
    const current = binding.parent as RecordRow | undefined;
    if (current && !["draft", "rejected"].includes(current.status)) fail("CONFLICT", "仅草稿或被退回收方记录可修改");
    if (current && input.expectedVersion && await versionFor(tx, current, binding.rows.filter(row => oldIds.includes(row.id)), true) !== input.expectedVersion) fail("CONFLICT", "收方资料或附件已被其他用户更新，请刷新后重试");
    for (const id of addedIds) {
      const row = binding.rows.find(row => row.id === id)!;
      const metadata = parseWatermark(row);
      const isExisting = Boolean(current && oldIds.includes(id) && row.sourceId === `takeoff-${current.id}`);
      if (!isExisting && (row.uploadedBy !== actor.id || !pendingSource(actor.id).test(row.sourceId ?? "") || metadata.takeoffAttachment !== true || metadata.pendingTakeoffId !== (input.id ?? null))) fail("BAD_REQUEST", "只能绑定本人从当前收方入口新上传的图片");
      if (!["image/jpeg", "image/png"].includes(row.mimeType ?? "") || !Number.isSafeInteger(row.contentBytes) || row.contentBytes === null || row.contentBytes <= 0 || row.contentBytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(row.contentSha256 ?? "")) fail("BAD_REQUEST", "新上传图片缺少真实完整性资料");
      const refs = (await collectEvidenceReferences(tx, [row])).get(row.id)!;
      // 通用预览封锁pending，专属入口已核实本人产物；仍用真实helper检查财税引用和私有文件路径。
      if (!isGeneralEvidenceVisible(isExisting ? row : { ...row, sourceId: null }, refs)) fail("BAD_REQUEST", "图片已经用于其它专用业务，不能接管");
    }
    if (input.measurementClaimId) {
      const [claim] = await tx.select().from(s.measurementClaims).where(eq(s.measurementClaims.id, input.measurementClaimId)).limit(1).for("update");
      if (!claim || claim.projectId !== input.projectId) fail("NOT_FOUND", "未找到当前项目的关联计量申报");
      if (claim.status === "void") fail("CONFLICT", "已作废计量申报不可关联收方记录");
    }
    const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const declaredAmount = roundMoney(input.quantity * input.unitPrice);
    // 保持原数量/单价/金额口径，新测量明细永不自动代入结算量。
    const values = { projectId: input.projectId, measurementClaimId: input.measurementClaimId ?? null, workItem: input.workItem, workLocation: input.workLocation, unit: input.unit, quantity: String(input.quantity), unitPrice: String(roundMoney(input.unitPrice)), declaredAmount: String(declaredAmount), takeoffDate: new Date(`${input.takeoffDate}T00:00:00.000Z`), ...(input.workDescription !== undefined ? { workDescription: input.workDescription } : {}), ...(input.measurementBasis !== undefined ? { measurementBasis: input.measurementBasis } : {}), ...(input.measurementRows !== undefined ? { measurementRows: input.measurementRows } : {}) };
    let takeoffId = input.id;
    if (current) {
      const result = await tx.update(s.measurementTakeoffRecords).set({ ...values, status: "draft", reviewNote: null }).where(and(eq(s.measurementTakeoffRecords.id, current.id), eq(s.measurementTakeoffRecords.projectId, input.projectId), eq(s.measurementTakeoffRecords.status, current.status)));
      assertEvidenceConditionalWrite(result);
    } else {
      const { number } = await allocateBusinessDocumentNumber(tx, { module: BUSINESS_DOCUMENT_MODULES.measurementTakeoff, actor: { kind: "user", userId: actor.id }, scope: `project:${input.projectId}:measurement-takeoff`, requestKey: businessCreationRequestKey(input) });
      const result = await tx.insert(s.measurementTakeoffRecords).values({ ...values, takeoffNo: number, status: "draft", submittedBy: actor.id });
      takeoffId = Number(result[0]?.insertId);
      if (!Number.isSafeInteger(takeoffId) || takeoffId <= 0) throw new Error("收方记录保存未返回真实ID");
    }
    for (const id of addedIds) {
      const row = binding.rows.find(row => row.id === id)!;
      if (row.sourceId !== `takeoff-${takeoffId}`) {
        const result = await tx.update(s.evidenceRecords).set({ sourceId: `takeoff-${takeoffId}` }).where(and(eq(s.evidenceRecords.id, id), eq(s.evidenceRecords.projectId, input.projectId), eq(s.evidenceRecords.sourceType, "site_photo"), eq(s.evidenceRecords.status, "active"), eq(s.evidenceRecords.uploadedBy, actor.id), eq(s.evidenceRecords.sourceId, row.sourceId!)));
        assertEvidenceConditionalWrite(result);
      }
      await tx.insert(s.measurementTakeoffEvidences).values({ takeoffId: takeoffId!, evidenceId: id, linkedBy: actor.id }).onDuplicateKeyUpdate({ set: { takeoffId: takeoffId! } });
    }
    await binding.retain(String(takeoffId));
    await appendIntegrityProtectedAudit(tx, { userId: actor.id, module: "measurement", action: input.id ? "update_takeoff" : "create_takeoff", targetType: "measurement_takeoff", targetId: String(takeoffId), summary: `${input.id ? "维护" : "新建"}项目计量收方：${input.workItem}`, beforeJson: current ? JSON.stringify(current) : null, afterJson: JSON.stringify({ ...values, attachmentEvidenceIds: addedIds }) });
    const [saved] = await tx.select().from(s.measurementTakeoffRecords).where(eq(s.measurementTakeoffRecords.id, takeoffId!)).limit(1);
    const final = await originalEvidence(tx, takeoffId!, input.projectId);
    return { success: true as const, takeoffId: takeoffId!, declaredAmount, version: await versionFor(tx, saved, final.rows, true) };
  });
}

/** 与既有取证配置相同的已发布键及模板规则；不修改通用router。 */
async function captureConfig(db: ReadDb) {
  const rows = await db.select({ settingKey: s.systemSettings.settingKey, valueJson: s.systemSettings.valueJson, isSensitive: s.systemSettings.isSensitive }).from(s.systemSettings).where(and(eq(s.systemSettings.status, "published"), inArray(s.systemSettings.settingKey, ["EVIDENCE_CAMERA_PROVIDER", "EVIDENCE_LOCATION_PROVIDER", "EVIDENCE_LOCATION_REQUIRED", WATERMARK_TEMPLATE_SETTING_KEY])));
  const values = new Map(rows.filter(row => !row.isSensitive && row.valueJson !== null).map(row => [row.settingKey, String(row.valueJson).trim().toLowerCase()]));
  const cameraProvider = values.get("EVIDENCE_CAMERA_PROVIDER") === "disabled" ? "disabled" as const : "browser" as const;
  const locationProvider = values.get("EVIDENCE_LOCATION_PROVIDER") === "disabled" ? "disabled" as const : "browser" as const;
  let watermark = { ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields] };
  try { const raw = rows.find(row => row.settingKey === WATERMARK_TEMPLATE_SETTING_KEY && !row.isSensitive)?.valueJson; watermark = normalizeEvidenceWatermarkTemplate(raw ? JSON.parse(raw) : null); } catch { /* 与既有配置一致：损坏模板安全降级。 */ }
  return { camera: { provider: cameraProvider, enabled: cameraProvider === "browser" }, location: { provider: locationProvider, enabled: locationProvider === "browser", required: locationProvider === "browser" && values.get("EVIDENCE_LOCATION_REQUIRED") === "true" }, watermark };
}
export async function getTakeoffCaptureConfig(ctx: TrpcContext) {
  await assertDepartmentBusinessAccess(ctx, "MEASUREMENT");
  const roles = await getEffectiveRoleCodes(ctx);
  if (!roles.includes("ALL") && !roles.some(role => allowedRoles.includes(role))) fail("FORBIDDEN", "当前岗位未获收方图片采集授权");
  return captureConfig(await requireDb());
}
async function assertCaptureConfig(db: ReadDb, input: TakeoffAttachmentUploadInput) {
  const config = await captureConfig(db);
  if (!config.camera.enabled) fail("FORBIDDEN", "现场影像采集连接器已被管理员停用");
  if (config.location.required && (input.longitude == null || input.latitude == null)) fail("BAD_REQUEST", "当前配置要求真实定位，请允许定位后重试；相册图片不能伪造坐标");
}
export function decodeTakeoffImage(value: string, mimeType: "image/jpeg" | "image/png") {
  const normalized = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) fail("BAD_REQUEST", "影像文件编码无效");
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== normalized) fail("BAD_REQUEST", "影像文件编码无效、为空或超过8MB限制");
  try { assertEvidenceImageSignature(bytes, mimeType); } catch { fail("BAD_REQUEST", "影像真实内容与JPEG/PNG声明不符"); }
  return bytes;
}
export async function uploadTakeoffAttachment(ctx: TrpcContext, input: TakeoffAttachmentUploadInput) {
  const db = await requireDb();
  const { actor } = await assertTakeoffAccess(ctx, db, input.projectId, input.takeoffId ? "edit" : "create");
  const bytes = decodeTakeoffImage(input.base64Data, input.mimeType);
  await assertCaptureConfig(db, input);
  if (input.takeoffId) {
    const [record] = await db.select().from(s.measurementTakeoffRecords).where(eq(s.measurementTakeoffRecords.id, input.takeoffId)).limit(1);
    if (!record || record.projectId !== input.projectId) fail("NOT_FOUND", "未找到当前项目收方记录");
    if (!["draft", "rejected"].includes(record.status)) fail("CONFLICT", "仅草稿或退回收方可上传图片");
  }
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const safeName = input.fileName.replace(/[^\w.()\-\u4e00-\u9fa5]/g, "_").slice(0, 160) || "takeoff.jpg";
  const stored = await storagePut(`evidence/${input.projectId}/${capturedAt.toISOString().slice(0, 10)}/${actor.id}-${randomUUID()}-${safeName}`, bytes, input.mimeType);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  return db.transaction(async tx => {
    await lockEvidenceProject(tx, input.projectId);
    await assertTakeoffAccess(ctx, tx, input.projectId, input.takeoffId ? "edit" : "create");
    await assertCaptureConfig(tx, input);
    if (input.takeoffId) {
      const [record] = await tx.select().from(s.measurementTakeoffRecords).where(eq(s.measurementTakeoffRecords.id, input.takeoffId)).limit(1).for("update");
      if (!record || record.projectId !== input.projectId) fail("NOT_FOUND", "未找到当前项目收方记录");
      if (!["draft", "rejected"].includes(record.status)) fail("CONFLICT", "收方已提交或审核，本次迟到图片不绑定");
    }
    const result = await tx.insert(s.evidenceRecords).values({ projectId: input.projectId, sourceType: "site_photo", sourceId: `takeoff-pending-${actor.id}-${randomUUID()}`, fileKey: stored.key, fileName: safeName, mimeType: input.mimeType, contentSha256, contentBytes: bytes.length, watermarkJson: JSON.stringify({ description: input.description ?? null, capturedAt: capturedAt.toISOString(), capturedAtMeaning: "本次归档记录时刻（非EXIF核验）", longitude: input.longitude ?? null, latitude: input.latitude ?? null, takeoffAttachment: true, pendingTakeoffId: input.takeoffId ?? null, version: 1 }), longitude: input.longitude == null ? null : String(input.longitude), latitude: input.latitude == null ? null : String(input.latitude), capturedAt, retentionUntil: null, status: "active", uploadedBy: actor.id });
    const evidenceId = Number(result[0]?.insertId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) throw new Error("图片归档未返回真实ID");
    await appendIntegrityProtectedAudit(tx, { userId: actor.id, module: "measurement", action: "upload_takeoff_attachment", targetType: "evidence", targetId: String(evidenceId), summary: "归档本人收方待关联图片", afterJson: JSON.stringify({ evidenceId, projectId: input.projectId, takeoffId: input.takeoffId ?? null, contentSha256, contentBytes: bytes.length }) });
    return { success: true as const, evidenceId, fileName: safeName, mimeType: input.mimeType };
  });
}

// 不含storage key/裸URL的短时令牌，绑定真实登录用户、项目、父单、图片、操作来源。
type Preview = { actorId: number; projectId: number; takeoffId: number; evidenceId: number; action: "read" | "print"; expires: number };
const previews = new Map<string, Preview>();
function previewUrl(item: Omit<Preview, "expires">) {
  const now = Date.now();
  for (const [token, value] of Array.from(previews)) if (value.expires <= now) previews.delete(token);
  if (previews.size >= 10000) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "图片预览繁忙，请稍后重试" });
  const token = randomUUID().replace(/-/g, "");
  previews.set(token, { ...item, expires: now + 10 * 60 * 1000 });
  return `/api/measurement-takeoff/preview/${token}`;
}
async function lockedDetail(ctx: TrpcContext, tx: Tx, input: { projectId: number; id: number }, action: "read" | "print") {
  await lockEvidenceProject(tx, input.projectId);
  const auth = await assertTakeoffAccess(ctx, tx, input.projectId, action);
  const original = await originalEvidence(tx, input.id, input.projectId);
  const ids = Array.from(new Set([...original.links.map(link => link.evidenceId), ...original.rows.map(row => row.id)])).sort((a, b) => a - b);
  const rows = ids.length ? await tx.select().from(s.evidenceRecords).where(inArray(s.evidenceRecords.id, ids)).orderBy(asc(s.evidenceRecords.id)).for("update") : [];
  if (rows.length !== ids.length) fail("CONFLICT", "收方存在缺失图片引用，不能跳过打印，请联系管理员核验");
  const [record] = await tx.select().from(s.measurementTakeoffRecords).where(eq(s.measurementTakeoffRecords.id, input.id)).limit(1).for("update");
  if (!record || record.projectId !== input.projectId) fail("NOT_FOUND", "未找到当前项目收方记录");
  await assertTakeoffAccess(ctx, tx, input.projectId, action);
  for (const row of rows) await checkReadableEvidence(tx, row, input.projectId, input.id, original.links.some(link => link.evidenceId === row.id));
  return { ...auth, record, rows, version: await versionFor(tx, record, rows, true) };
}
export async function getTakeoffDetail(ctx: TrpcContext, input: { projectId: number; id: number }, action: "read" | "print" = "read") {
  const db = await requireDb();
  await assertTakeoffAccess(ctx, db, input.projectId, action);
  return db.transaction(async tx => {
    const detail = await lockedDetail(ctx, tx, input, action);
    const personIds = [detail.record.submittedBy, detail.record.reviewedBy].filter((id): id is number => id !== null);
    const names = personIds.length ? await tx.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, personIds)) : [];
    const measurementRows = detail.record.measurementRows === null ? null : zRows(detail.record.measurementRows);
    return { record: { ...detail.record, measurementRows, workDescription: detail.record.workDescription ?? null, measurementBasis: detail.record.measurementBasis ?? null, version: detail.version }, project: { id: detail.project.id, name: detail.project.name }, submittedByName: names.find(person => person.id === detail.record.submittedBy)?.name ?? null, reviewedByName: names.find(person => person.id === detail.record.reviewedBy)?.name ?? null, evidences: detail.rows.map(row => ({ evidenceId: row.id, fileName: row.fileName || "历史照片（文件名未记录）", mimeType: row.mimeType!, url: previewUrl({ actorId: detail.actor.id, projectId: input.projectId, takeoffId: input.id, evidenceId: row.id, action }), capturedAt: row.capturedAt, description: typeof parseWatermark(row).description === "string" ? String(parseWatermark(row).description) : null })) };
  });
}
function zRows(value: unknown) { return takeoffMeasurementRowSchema.array().max(100).parse(value); }
export async function listTakeoffsWithVersion(ctx: TrpcContext, projectId: number) {
  const db = await requireDb(); await assertTakeoffAccess(ctx, db, projectId);
  const records = await db.select().from(s.measurementTakeoffRecords).where(eq(s.measurementTakeoffRecords.projectId, projectId)).orderBy(desc(s.measurementTakeoffRecords.updatedAt));
  return Promise.all(records.map(async record => ({ ...record, version: await versionFor(db, record, (await originalEvidence(db, record.id, projectId)).rows) })));
}
async function readTakeoffStorage(fileKey: string) {
  if (ENV.selfHostStorageDir && !isAliyunOssPhotoStorageKey(fileKey)) {
    const root = path.resolve(ENV.selfHostStorageDir); const target = path.resolve(root, fileKey);
    if (!target.startsWith(root + path.sep)) throw new Error("invalid storage key");
    const realRoot = await fs.realpath(root), realTarget = await fs.realpath(target);
    if (!realTarget.startsWith(realRoot + path.sep)) throw new Error("invalid storage path");
    const stat = await fs.stat(realTarget); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("photo too large");
    const bytes = await fs.readFile(realTarget); if (bytes.length > MAX_BYTES) throw new Error("photo too large"); return bytes;
  }
  const signed = await storageGetSignedUrl(fileKey);
  if (!/^https:\/\//.test(signed)) throw new Error("invalid storage URL");
  const response = await fetch(signed, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("photo unavailable");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("photo too large"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) throw new Error("photo too large"); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
  return Buffer.concat(chunks, size);
}
/** 父任务接入Express入口；每次实际图片读取重验登录、模块、项目、父单与来源，不返回跳转或存储URL。 */
export function registerTakeoffAttachmentPreview(app: Express) {
  app.get("/api/measurement-takeoff/preview/:token", async (req, res) => {
    res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer");
    try {
      const item = previews.get(String(req.params.token));
      if (!item || item.expires <= Date.now()) { res.status(410).send("图片预览已过期，请重新打开详情或打印"); return; }
      const ctx = await createContext({ req, res, info: {} as any });
      const actor = requireAuthenticatedUser(ctx);
      if (actor.id !== item.actorId) fail("FORBIDDEN", "图片预览未经授权");
      assertLocalManagerTerminalAccess(ctx);
      if (actor.loginMethod === "local_manager" && actor.localPasswordChangeRequired) fail("FORBIDDEN", "请先修改初始密码");
      const db = await requireDb();
      const bytes = await db.transaction(async tx => {
        const detail = await lockedDetail(ctx, tx, { projectId: item.projectId, id: item.takeoffId }, item.action);
        const evidence = detail.rows.find(row => row.id === item.evidenceId);
        if (!evidence) fail("FORBIDDEN", "图片关联已变化，请重新打开详情");
        const bytes = await readTakeoffStorage(evidence.fileKey);
        assertEvidenceImageSignature(bytes, evidence.mimeType as "image/jpeg" | "image/png");
        if (!bytes.length || bytes.length > MAX_BYTES || evidence.contentBytes !== null && bytes.length !== evidence.contentBytes || evidence.contentSha256 !== null && createHash("sha256").update(bytes).digest("hex") !== evidence.contentSha256) throw new Error("photo integrity failed");
        // 远端读取可能耗时，真正发送前再次重核当前模块/项目权限。
        await assertTakeoffAccess(ctx, tx, item.projectId, item.action);
        return { bytes, mimeType: evidence.mimeType! };
      });
      if (item.expires <= Date.now()) { res.status(410).send("图片预览已过期，请重新打开"); return; }
      res.set("Content-Type", bytes.mimeType); res.set("X-Content-Type-Options", "nosniff"); res.set("Content-Disposition", "inline"); res.set("Content-Security-Policy", "sandbox"); res.send(bytes.bytes);
    } catch (error) { res.status(error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code) ? 403 : 404).send("图片不可预览，请重新授权或在原收方业务核验"); }
  });
}
