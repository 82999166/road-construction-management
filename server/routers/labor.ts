import { and, desc, eq, gte, isNull, lt, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { attendanceCheckIns, attendanceDeviceBindings, attendanceRecords, auditLogs, evidenceRecords, laborWorkers, payrollStatements, projects, users } from "../../drizzle/schema";
import { assertAttendanceWorkHours, assertCertificateFileSignature, assertPayrollStatusTransition, calculatePayrollAmounts, canApprovePayroll, canPayPayroll, canVoidPayroll, summarizePayrollStatements } from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, maskSensitiveValue, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { createInAppMessage } from "./messages";
import { decryptSecret, encryptSecret } from "../services/secretVault";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { storageGet, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

/** 工资结算期间统一使用 YYYY-MM，避免将时区信息混入按月结算的业务口径。 */
const payrollPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "工资期间格式应为 YYYY-MM");

/** 劳务人员档案输入；敏感原文只在写入时出现，查询响应中绝不返回。 */
const workerInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  teamName: z.string().trim().max(128).nullable().optional(),
  realName: z.string().trim().min(2, "请填写实名姓名").max(64),
  identityNo: z.string().trim().min(15, "请填写有效身份证号码").max(32).optional(),
  phone: z.string().trim().min(6, "请填写有效联系电话").max(32).nullable().optional(),
  bankAccount: z.string().trim().min(8, "请填写有效银行卡号").max(64).nullable().optional(),
  bankName: z.string().trim().max(128).nullable().optional(),
  identityVerificationStatus: z.enum(["pending", "verified", "rejected"]).optional(),
  identityVerificationNote: z.string().trim().max(500, "实名审核备注不得超过 500 个字符").nullable().optional(),
  attendanceStatus: z.enum(["pending", "active", "left"]).default("pending"),
  entryDate: z.string().date().nullable().optional(),
  exitDate: z.string().date().nullable().optional(),
});

/** 考勤录入输入。工时与加班工时均使用小时作为统一计量单位。 */
const attendanceInput = z
  .object({
    workerId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    attendanceDate: z.string().date(),
    workHours: z.number().min(0).max(24),
    overtimeHours: z.number().min(0).max(24).default(0),
    note: z.string().trim().max(500, "考勤备注不得超过 500 个字符").nullable().optional(),
    source: z.enum(["manual", "mobile", "device", "import"]).default("mobile"),
    status: z.enum(["draft", "confirmed"]).default("confirmed"),
  })
  .refine(value => value.workHours + value.overtimeHours <= 24, { message: "正常工时与加班工时合计不得超过 24 小时", path: ["overtimeHours"] });

/** 设备原始标识仅在浏览器本地生成并哈希；服务端只接收不可逆的 SHA-256 指纹。 */
const mobileCheckInInput = z.object({
  projectId: z.number().int().positive(),
  punchType: z.enum(["in", "out"]).default("in"),
  deviceFingerprintHash: z.string().regex(/^[a-f0-9]{64}$/i, "设备指纹格式无效"),
  deviceLabel: z.string().trim().min(1).max(160),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  locationAccuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
});

/** 工资草稿输入。实发金额由服务端按应发减扣款计算，前端不得直接篡改。 */
const payrollSaveInput = z
  .object({
    workerId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    period: payrollPeriodSchema,
    payableAmount: z.number().min(0, "应发金额不得为负数").max(999999999999.99),
    deductionAmount: z.number().min(0, "扣款金额不得为负数").max(999999999999.99).default(0),
  })
  .refine(value => value.deductionAmount <= value.payableAmount, { message: "扣款金额不得大于应发金额", path: ["deductionAmount"] });

/** 实名制证照仅支持常见图片或 PDF，单文件限制为 5MB，防止移动端误传视频等大文件。 */
const certificateUploadInput = z.object({
  workerId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  certificateName: z.string().trim().min(1, "请填写证照名称").max(128),
  fileName: z.string().trim().min(1, "缺少证照文件名").max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  base64Data: z.string().min(1, "证照文件不能为空").max(7_000_000, "证照文件超过 5MB 限制"),
});

const LABOR_CERTIFICATE_SOURCE_TYPE = "labor_worker_certificate";
const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;

/**
 * 只有劳资、项目、财务及会计岗位可以进入劳务工资数据域。
 * 管理员对应 ALL 标记，用于系统初始化、应急处理和后台授权后的完整数据访问。
 */
async function assertLaborBusinessAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "LABOR");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowedCodes = ["LABOR_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowedCodes.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获劳务工资数据访问授权" });
  }
  return roleCodes;
}

/** 付款凭证属于内部资金流水，只允许会计、财务负责人和系统级应急角色查看。 */
function canViewPayrollPaymentReference(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT") || roleCodes.includes("FINANCE_MANAGER");
}

/** 将金额按两位小数归一化，避免 JavaScript 浮点误差扩散至工资单。 */
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 工资条状态是发放与审计的核心凭据。写入必须以读取时的旧状态为条件，
 * 0 行受影响说明已有并发操作完成，后续审计和通知均不得继续执行。
 */
function assertConditionalPayrollWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "工资条已被其他用户更新，请刷新后重试" });
  }
}

/** 将 YYYY-MM-DD 业务日期固定转换为 UTC 零点，避免客户端时区影响项目日考勤口径。 */
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 考勤日期统一按中国标准时间裁切，实际打卡时间始终由服务端生成并保存为 UTC。 */
function getChinaBusinessDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => ["year", "month", "day"].includes(part.type)).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** 从加密敏感字段生成只读掩码；密文异常时宁可返回全掩码也不泄露原值。 */
function getMaskedEncryptedValue(cipherText: string | null | undefined, visibleTail = 4) {
  if (!cipherText) return null;
  try {
    return maskSensitiveValue(decryptSecret(cipherText), visibleTail);
  } catch {
    return "****";
  }
}

/** 将劳务档案投影为移动端安全视图，严格排除所有密文字段。 */
function toSafeWorker(worker: typeof laborWorkers.$inferSelect) {
  return {
    id: worker.id,
    projectId: worker.projectId,
    teamName: worker.teamName,
    realName: worker.realName,
    identityNoMasked: getMaskedEncryptedValue(worker.identityNoEncrypted),
    phoneMasked: getMaskedEncryptedValue(worker.phoneEncrypted),
    bankAccountMasked: getMaskedEncryptedValue(worker.bankAccountEncrypted),
    bankName: worker.bankName,
    identityVerificationStatus: worker.identityVerificationStatus,
    identityVerificationNote: worker.identityVerificationNote,
    identityVerifiedAt: worker.identityVerifiedAt,
    attendanceStatus: worker.attendanceStatus,
    entryDate: worker.entryDate,
    exitDate: worker.exitDate,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
}

/** 校验人员存在、项目一致且当前用户已被授权访问其所属项目。 */
async function getScopedWorker(ctx: Parameters<typeof requireAuthenticatedUser>[0], workerId: number, projectId: number) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const rows = await db.select().from(laborWorkers).where(eq(laborWorkers.id, workerId)).limit(1);
  const worker = rows[0];
  if (!worker || worker.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的劳务人员档案" });
  }
  return { db, worker };
}

/** 根据工资期间生成左闭右开的考勤日期区间，确保跨月统计不会重复计算。 */
function getPeriodRange(period: string) {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: toBusinessDate(`${period}-01`),
    endExclusive: toBusinessDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`),
  };
}

/** 将用户提供的文件名归一化为对象存储安全路径片段，保留中文、数字、短横线和扩展名。 */
function getSafeStorageFileName(fileName: string) {
  return fileName.replace(/[^\w.()\-\u4e00-\u9fa5]/g, "_").slice(0, 160) || "certificate";
}

/** 从证照元数据中恢复业务名称；旧记录或解析失败时回退到原始文件名。 */
function getCertificateName(metadata: string | null, fallback: string | null) {
  try {
    const parsed = metadata ? JSON.parse(metadata) as { certificateName?: unknown } : null;
    return typeof parsed?.certificateName === "string" && parsed.certificateName.trim() ? parsed.certificateName.trim() : fallback || "未命名证照";
  } catch {
    return fallback || "未命名证照";
  }
}

/**
 * 劳务实名制、考勤和工资业务路由。
 * 各过程均在服务端执行岗位及项目范围校验，移动端的菜单显示只作为体验层，不构成安全边界。
 */
export const laborRouter = router({
  /** 返回当前用户有权查看的项目，供移动端筛选器使用。 */
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertLaborBusinessAccess(ctx);
    const scope = await getCurrentDataScope(ctx);
    const db = await getDb();
    if (!db) return [];

    if (scope.hasAllProjects) {
      return db.select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status, organizationId: projects.organizationId }).from(projects).orderBy(projects.sortOrder, projects.id);
    }
    if (!scope.projectIds.length && !scope.organizationIds.length) return [];
    const allProjects = await db.select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status, organizationId: projects.organizationId }).from(projects).orderBy(projects.sortOrder, projects.id);
    return allProjects.filter(project => scope.projectIds.includes(project.id) || (project.organizationId !== null && scope.organizationIds.includes(project.organizationId)));
  }),

  /** 按项目读取实名制人员台账，统一返回脱敏后的身份证、手机号和银行卡尾号。 */
  listWorkers: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), includeLeft: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      await assertLaborBusinessAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(laborWorkers).where(eq(laborWorkers.projectId, input.projectId)).orderBy(laborWorkers.teamName, laborWorkers.realName);
      return rows.filter(worker => input.includeLeft || worker.attendanceStatus !== "left").map(toSafeWorker);
    }),

  /** 新建或维护实名制人员档案；身份证、手机号和银行卡在服务端加密后才会持久化。 */
  saveWorker: protectedProcedure.input(workerInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertLaborBusinessAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (input.entryDate && input.exitDate && input.exitDate < input.entryDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "退场日期不得早于进场日期" });
    }

    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

    const baseValues: Partial<typeof laborWorkers.$inferInsert> = {
      projectId: input.projectId,
      teamName: input.teamName ?? null,
      realName: input.realName,
      bankName: input.bankName ?? null,
      attendanceStatus: input.attendanceStatus,
      entryDate: input.entryDate ? toBusinessDate(input.entryDate) : null,
      exitDate: input.exitDate ? toBusinessDate(input.exitDate) : null,
    };
    if (input.identityNo) baseValues.identityNoEncrypted = encryptSecret(input.identityNo);
    if (input.phone !== undefined) baseValues.phoneEncrypted = input.phone ? encryptSecret(input.phone) : null;
    if (input.bankAccount !== undefined) baseValues.bankAccountEncrypted = input.bankAccount ? encryptSecret(input.bankAccount) : null;

    if (input.id) {
      const existingRows = await db.select().from(laborWorkers).where(eq(laborWorkers.id, input.id)).limit(1);
      const existing = existingRows[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "劳务人员档案不存在" });
      // 对原项目及目标项目均校验范围，防止利用编辑接口跨项目转移人员档案。
      await assertProjectInCurrentScope(ctx, existing.projectId);
      if (input.identityVerificationStatus) {
        if (input.identityVerificationStatus === "verified" && !input.identityNo && !existing.identityNoEncrypted) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "完成实名核验前必须录入身份证号码" });
        }
        baseValues.identityVerificationStatus = input.identityVerificationStatus;
        baseValues.identityVerificationNote = input.identityVerificationNote ?? null;
        baseValues.identityVerifiedAt = input.identityVerificationStatus === "verified" ? new Date() : null;
        baseValues.identityVerifiedBy = input.identityVerificationStatus === "verified" ? user.id : null;
      } else if (input.identityVerificationNote !== undefined) {
        baseValues.identityVerificationNote = input.identityVerificationNote;
      }
      await db.update(laborWorkers).set(baseValues).where(eq(laborWorkers.id, input.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "update_worker", targetType: "labor_worker", targetId: String(input.id), summary: `更新劳务实名制档案：${input.realName}${input.identityVerificationStatus ? ` · 实名状态：${input.identityVerificationStatus}` : ""}` });
      if (input.identityVerificationStatus === "verified" && existing.identityVerificationStatus !== "verified") {
        try {
          const messageResult = await createInAppMessage({
            eventCode: "IDENTITY_VERIFIED",
            idempotencyKey: `identity-verified:${input.id}`,
            recipientUserId: user.id,
            title: "劳务人员实名核验已完成",
            content: "您已完成一名劳务人员的实名核验，详细档案请在系统内查看。",
            deepLink: "/mobile/labor",
          });
          if (!messageResult.created && messageResult.reason === "database_unavailable") {
            await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "labor_worker", targetId: String(input.id), summary: "实名核验站内消息未能写入：数据库暂不可用" });
          }
        } catch (error) {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "labor_worker", targetId: String(input.id), summary: `实名核验站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
        }
        // 公众号通知不携带姓名、身份证号等个人信息，实名详情只能在受权限保护的台账中查看。
        void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "labor", eventCode: "labor_identity_verified", targetType: "labor_worker", targetId: String(input.id), title: "劳务实名核验已完成", content: "一项劳务实名核验已完成，请进入系统查看受控台账。", deepLink: "/mobile/labor" }).catch(() => undefined);
      }
      return { success: true, id: input.id };
    }

    if (!input.identityNo) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "新建实名制人员必须录入身份证号码" });
    }
    const verificationStatus = input.identityVerificationStatus ?? "pending";
    if (verificationStatus === "verified" && !input.identityNo) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "完成实名核验前必须录入身份证号码" });
    }
    baseValues.identityVerificationStatus = verificationStatus;
    baseValues.identityVerificationNote = input.identityVerificationNote ?? null;
    baseValues.identityVerifiedAt = verificationStatus === "verified" ? new Date() : null;
    baseValues.identityVerifiedBy = verificationStatus === "verified" ? user.id : null;
    const result = await db.insert(laborWorkers).values(baseValues as typeof laborWorkers.$inferInsert);
    const insertId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
    await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "create_worker", targetType: "labor_worker", targetId: String(insertId || input.realName), summary: `新建劳务实名制档案：${input.realName}` });
    if (verificationStatus === "verified") {
      try {
        const messageResult = await createInAppMessage({
          eventCode: "IDENTITY_VERIFIED",
          idempotencyKey: `identity-verified:${insertId || `new-${user.id}-${input.projectId}`}`,
          recipientUserId: user.id,
          title: "劳务人员实名核验已完成",
          content: "您已完成一名劳务人员的实名核验，详细档案请在系统内查看。",
          deepLink: "/mobile/labor",
        });
        if (!messageResult.created && messageResult.reason === "database_unavailable") {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "labor_worker", targetId: String(insertId || input.realName), summary: "实名核验站内消息未能写入：数据库暂不可用" });
        }
      } catch (error) {
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "labor_worker", targetId: String(insertId || input.realName), summary: `实名核验站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
      }
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "labor", eventCode: "labor_identity_verified", targetType: "labor_worker", targetId: String(insertId || input.realName), title: "劳务实名核验已完成", content: "一项劳务实名核验已完成，请进入系统查看受控台账。", deepLink: "/mobile/labor" }).catch(() => undefined);
    }
    return { success: true, id: insertId || null };
  }),

  certificates: router({
    /** 读取指定劳务人员的证照元数据和安全存储地址，文件本体不进入数据库。 */
    list: protectedProcedure
      .input(z.object({ workerId: z.number().int().positive(), projectId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        const { db } = await getScopedWorker(ctx, input.workerId, input.projectId);
        const rows = await db
          .select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType, ocrResultJson: evidenceRecords.ocrResultJson, createdAt: evidenceRecords.createdAt })
          .from(evidenceRecords)
          .where(and(eq(evidenceRecords.projectId, input.projectId), eq(evidenceRecords.sourceType, LABOR_CERTIFICATE_SOURCE_TYPE), eq(evidenceRecords.sourceId, String(input.workerId))))
          .orderBy(desc(evidenceRecords.createdAt));
        return Promise.all(rows.map(async row => ({
          id: row.id,
          certificateName: getCertificateName(row.ocrResultJson, row.fileName),
          fileName: row.fileName || "未命名文件",
          mimeType: row.mimeType || "application/octet-stream",
          url: (await storageGet(row.fileKey)).url,
          createdAt: row.createdAt,
        })));
      }),

    /** 上传并关联实名制证照；上传前校验人员归属、项目范围、MIME 类型与二进制大小。 */
    upload: protectedProcedure.input(certificateUploadInput).mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertLaborBusinessAccess(ctx);
      const { db, worker } = await getScopedWorker(ctx, input.workerId, input.projectId);
      const bytes = Buffer.from(input.base64Data, "base64");
      if (!bytes.length || bytes.length > MAX_CERTIFICATE_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "证照文件为空或超过 5MB 限制" });
      }
      try {
        assertCertificateFileSignature(bytes, input.mimeType);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "证照文件格式校验失败" });
      }
      const safeFileName = getSafeStorageFileName(input.fileName);
      const upload = await storagePut(`labor-certificates/project-${input.projectId}/worker-${input.workerId}/${safeFileName}`, bytes, input.mimeType);
      const result = await db.insert(evidenceRecords).values({
        projectId: input.projectId,
        sourceType: LABOR_CERTIFICATE_SOURCE_TYPE,
        sourceId: String(input.workerId),
        fileKey: upload.key,
        fileName: safeFileName,
        mimeType: input.mimeType,
        ocrResultJson: JSON.stringify({ certificateName: input.certificateName.trim() }),
        uploadedBy: user.id,
      });
      const insertId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "upload_worker_certificate", targetType: "evidence_record", targetId: String(insertId || `${input.workerId}-${safeFileName}`), summary: `上传劳务人员证照：${worker.realName} · ${input.certificateName.trim()}` });
      try {
        const messageResult = await createInAppMessage({
          eventCode: "WORKER_CERTIFICATE_ARCHIVED",
          idempotencyKey: `worker-certificate:${insertId || `${input.workerId}-${safeFileName}`}`,
          recipientUserId: user.id,
          title: "劳务人员证照已归档",
          content: "您已完成一份劳务人员证照归档，请在系统内继续办理核验。",
          deepLink: "/mobile/labor",
        });
        if (!messageResult.created && messageResult.reason === "database_unavailable") {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "evidence_record", targetId: String(insertId || `${input.workerId}-${safeFileName}`), summary: "证照归档站内消息未能写入：数据库暂不可用" });
        }
      } catch (error) {
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "evidence_record", targetId: String(insertId || `${input.workerId}-${safeFileName}`), summary: `证照归档站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
      }
      // 仅提醒“证照已归档”这一流程节点，证照名称和人员身份信息不发送到公众号。
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "labor", eventCode: "labor_certificate_archived", targetType: "evidence_record", targetId: String(insertId || `${input.workerId}-${safeFileName}`), title: "劳务人员证照已归档", content: "一份劳务人员证照已归档，请进入系统完成受控核验。", deepLink: "/mobile/labor" }).catch(() => undefined);
      return { success: true, id: insertId || null, url: upload.url };
    }),
  }),

  attendance: router({
    /** 当前账号在已授权项目上的上下班状态；只返回本人设备的匿名标签和受控定位状态。 */
    myCheckInStatus: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return { checkedIn: false, checkedOut: false, businessDate: getChinaBusinessDate(new Date()), checkIn: null, checkOut: null };
      const businessDate = getChinaBusinessDate(new Date());
      const [checkIn] = await db.select({ id: attendanceCheckIns.id, checkedInAt: attendanceCheckIns.checkedInAt, checkedOutAt: attendanceCheckIns.checkedOutAt, deviceLabel: attendanceCheckIns.deviceLabel, status: attendanceCheckIns.status, checkoutStatus: attendanceCheckIns.checkoutStatus, longitude: attendanceCheckIns.longitude, latitude: attendanceCheckIns.latitude, locationAccuracyMeters: attendanceCheckIns.locationAccuracyMeters, checkoutLongitude: attendanceCheckIns.checkoutLongitude, checkoutLatitude: attendanceCheckIns.checkoutLatitude, checkoutLocationAccuracyMeters: attendanceCheckIns.checkoutLocationAccuracyMeters }).from(attendanceCheckIns).where(and(eq(attendanceCheckIns.userId, user.id), eq(attendanceCheckIns.projectId, input.projectId), eq(attendanceCheckIns.businessDate, toBusinessDate(businessDate)))).limit(1);
      return { checkedIn: Boolean(checkIn), checkedOut: Boolean(checkIn?.checkedOutAt), businessDate, checkIn: checkIn ?? null, checkOut: checkIn?.checkedOutAt ? { checkedOutAt: checkIn.checkedOutAt, status: checkIn.checkoutStatus, longitude: checkIn.checkoutLongitude, latitude: checkIn.checkoutLatitude, locationAccuracyMeters: checkIn.checkoutLocationAccuracyMeters } : null };
    }),

    /** 上班/下班打卡绑定首台设备；每人每天每项目仅允许各完成一次，服务端时间为准。 */
    checkIn: protectedProcedure.input(mobileCheckInInput).mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const now = new Date();
      const businessDateText = getChinaBusinessDate(now);
      const businessDate = toBusinessDate(businessDateText);
      const hasLocation = input.longitude !== null && input.longitude !== undefined && input.latitude !== null && input.latitude !== undefined;
      if (!hasLocation) throw new TRPCError({ code: "BAD_REQUEST", message: "上下班打卡必须上传实时定位信息，请允许浏览器定位后重试" });
      const [existing] = await db.select({ id: attendanceCheckIns.id, checkedInAt: attendanceCheckIns.checkedInAt, checkedOutAt: attendanceCheckIns.checkedOutAt, status: attendanceCheckIns.status, checkoutStatus: attendanceCheckIns.checkoutStatus }).from(attendanceCheckIns).where(and(eq(attendanceCheckIns.userId, user.id), eq(attendanceCheckIns.projectId, input.projectId), eq(attendanceCheckIns.businessDate, businessDate))).limit(1);
      if (input.punchType === "in" && existing) return { success: true, duplicate: true, punchType: "in" as const, id: existing.id, checkedInAt: existing.checkedInAt, businessDate: businessDateText, status: existing.status };
      if (input.punchType === "out" && !existing) throw new TRPCError({ code: "BAD_REQUEST", message: "请先完成今日上班打卡后再进行下班打卡" });
      if (input.punchType === "out" && existing?.checkedOutAt) return { success: true, duplicate: true, punchType: "out" as const, id: existing.id, checkedOutAt: existing.checkedOutAt, businessDate: businessDateText, status: existing.checkoutStatus ?? "normal" };
      const [binding] = await db.select().from(attendanceDeviceBindings).where(and(eq(attendanceDeviceBindings.userId, user.id), eq(attendanceDeviceBindings.deviceFingerprintHash, input.deviceFingerprintHash.toLowerCase()))).limit(1);
      if (binding?.status === "disabled") throw new TRPCError({ code: "FORBIDDEN", message: "当前考勤设备已被禁用，请联系管理员核验后重新绑定" });
      let newlyBound = false;
      if (!binding) {
        const activeDevices = await db.select({ id: attendanceDeviceBindings.id }).from(attendanceDeviceBindings).where(and(eq(attendanceDeviceBindings.userId, user.id), eq(attendanceDeviceBindings.status, "active")));
        if (activeDevices.length >= 3) throw new TRPCError({ code: "CONFLICT", message: "当前账号已绑定 3 台考勤设备，请联系管理员停用旧设备后再绑定" });
        try {
          await db.insert(attendanceDeviceBindings).values({ userId: user.id, deviceFingerprintHash: input.deviceFingerprintHash.toLowerCase(), deviceLabel: input.deviceLabel, status: "active", firstBoundAt: now, lastUsedAt: now });
          newlyBound = true;
        } catch {
          // 并发首次打卡可能已插入相同绑定，后续打卡唯一键仍可作为最终保护。
        }
      } else {
        await db.update(attendanceDeviceBindings).set({ deviceLabel: input.deviceLabel, lastUsedAt: now }).where(eq(attendanceDeviceBindings.id, binding.id));
      }
      if (input.punchType === "out" && existing) {
        await db.update(attendanceCheckIns).set({ checkedOutAt: now, checkoutLongitude: hasLocation ? String(input.longitude) : null, checkoutLatitude: hasLocation ? String(input.latitude) : null, checkoutLocationAccuracyMeters: input.locationAccuracyMeters === null || input.locationAccuracyMeters === undefined ? null : String(input.locationAccuracyMeters), checkoutStatus: hasLocation ? "normal" : "location_missing" }).where(and(eq(attendanceCheckIns.id, existing.id), eq(attendanceCheckIns.userId, user.id), eq(attendanceCheckIns.projectId, input.projectId), eq(attendanceCheckIns.businessDate, businessDate), isNull(attendanceCheckIns.checkedOutAt)));
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "mobile_check_out", targetType: "attendance_check_in", targetId: String(existing.id), summary: `移动下班打卡：${businessDateText} · 已记录定位 · 设备 ${input.deviceLabel.slice(0, 60)}` });
        return { success: true, duplicate: false, punchType: "out" as const, id: existing.id, checkedOutAt: now, businessDate: businessDateText, status: "normal" as const, newlyBound };
      }
      try {
        const [created] = await db.insert(attendanceCheckIns).values({ userId: user.id, projectId: input.projectId, businessDate, checkedInAt: now, deviceFingerprintHash: input.deviceFingerprintHash.toLowerCase(), deviceLabel: input.deviceLabel, longitude: hasLocation ? String(input.longitude) : null, latitude: hasLocation ? String(input.latitude) : null, locationAccuracyMeters: input.locationAccuracyMeters === null || input.locationAccuracyMeters === undefined ? null : String(input.locationAccuracyMeters), status: hasLocation ? "normal" : "location_missing" }).$returningId();
        const id = Number(created?.id);
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: newlyBound ? "bind_device_and_check_in" : "mobile_check_in", targetType: "attendance_check_in", targetId: String(id), summary: `移动一键打卡：${businessDateText} · 已记录定位 · 设备 ${input.deviceLabel.slice(0, 60)}` });
        return { success: true, duplicate: false, punchType: "in" as const, id, checkedInAt: now, businessDate: businessDateText, status: "normal" as const, newlyBound };
      } catch {
        const [concurrent] = await db.select({ id: attendanceCheckIns.id, checkedInAt: attendanceCheckIns.checkedInAt, status: attendanceCheckIns.status }).from(attendanceCheckIns).where(and(eq(attendanceCheckIns.userId, user.id), eq(attendanceCheckIns.projectId, input.projectId), eq(attendanceCheckIns.businessDate, businessDate))).limit(1);
        if (concurrent) return { success: true, duplicate: true, punchType: "in" as const, id: concurrent.id, checkedInAt: concurrent.checkedInAt, businessDate: businessDateText, status: concurrent.status };
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "打卡保存失败，请稍后重试" });
      }
    }),

    /** 项目负责人或劳资负责人可按日期查看打卡留痕；设备标识仅显示匿名标签，不返回原始指纹。 */
    listCheckIns: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), businessDate: z.string().date().optional() })).query(async ({ ctx, input }) => {
      const roleCodes = await assertLaborBusinessAccess(ctx);
      if (!roleCodes.includes("ALL") && !roleCodes.some(role => ["LABOR_MANAGER", "PROJECT_MANAGER"].includes(role))) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无考勤打卡核验权限" });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const businessDate = input.businessDate ? toBusinessDate(input.businessDate) : toBusinessDate(getChinaBusinessDate(new Date()));
      return db.select({ id: attendanceCheckIns.id, userId: attendanceCheckIns.userId, userName: users.name, projectId: attendanceCheckIns.projectId, businessDate: attendanceCheckIns.businessDate, checkedInAt: attendanceCheckIns.checkedInAt, checkedOutAt: attendanceCheckIns.checkedOutAt, deviceLabel: attendanceCheckIns.deviceLabel, longitude: attendanceCheckIns.longitude, latitude: attendanceCheckIns.latitude, locationAccuracyMeters: attendanceCheckIns.locationAccuracyMeters, status: attendanceCheckIns.status, checkoutLongitude: attendanceCheckIns.checkoutLongitude, checkoutLatitude: attendanceCheckIns.checkoutLatitude, checkoutLocationAccuracyMeters: attendanceCheckIns.checkoutLocationAccuracyMeters, checkoutStatus: attendanceCheckIns.checkoutStatus }).from(attendanceCheckIns).innerJoin(users, eq(attendanceCheckIns.userId, users.id)).where(and(eq(attendanceCheckIns.projectId, input.projectId), eq(attendanceCheckIns.businessDate, businessDate))).orderBy(desc(attendanceCheckIns.checkedInAt));
    }),

    /** 按项目和日期范围查询考勤台账，并携带实名人员姓名以便移动端展示。 */
    list: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive(), startDate: z.string().date().optional(), endDate: z.string().date().optional() }))
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        if (input.startDate && input.endDate && input.endDate < input.startDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "结束日期不得早于开始日期" });
        }
        const db = await getDb();
        if (!db) return [];
        const startDate = input.startDate ? toBusinessDate(input.startDate) : undefined;
        const endDate = input.endDate ? toBusinessDate(input.endDate) : undefined;
        const filter = input.startDate && input.endDate
          ? and(eq(attendanceRecords.projectId, input.projectId), gte(attendanceRecords.attendanceDate, startDate!), lte(attendanceRecords.attendanceDate, endDate!))
          : input.startDate
            ? and(eq(attendanceRecords.projectId, input.projectId), gte(attendanceRecords.attendanceDate, startDate!))
            : input.endDate
              ? and(eq(attendanceRecords.projectId, input.projectId), lte(attendanceRecords.attendanceDate, endDate!))
              : eq(attendanceRecords.projectId, input.projectId);
        return db
          .select({
            id: attendanceRecords.id,
            workerId: attendanceRecords.workerId,
            workerName: laborWorkers.realName,
            teamName: laborWorkers.teamName,
            projectId: attendanceRecords.projectId,
            attendanceDate: attendanceRecords.attendanceDate,
            workHours: attendanceRecords.workHours,
            overtimeHours: attendanceRecords.overtimeHours,
            note: attendanceRecords.note,
            source: attendanceRecords.source,
            status: attendanceRecords.status,
            createdAt: attendanceRecords.createdAt,
            updatedAt: attendanceRecords.updatedAt,
          })
          .from(attendanceRecords)
          .innerJoin(laborWorkers, eq(attendanceRecords.workerId, laborWorkers.id))
          .where(filter)
          .orderBy(desc(attendanceRecords.attendanceDate), laborWorkers.realName);
      }),

    /** 按“人员 + 日期”幂等保存考勤，锁定后的记录不可覆盖。 */
    save: protectedProcedure.input(attendanceInput).mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertLaborBusinessAccess(ctx);
      const { db, worker } = await getScopedWorker(ctx, input.workerId, input.projectId);
      assertAttendanceWorkHours(input.workHours, input.overtimeHours);
      const attendanceDate = toBusinessDate(input.attendanceDate);
      const existingRows = await db
        .select({ id: attendanceRecords.id, status: attendanceRecords.status })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.workerId, input.workerId), eq(attendanceRecords.attendanceDate, attendanceDate)))
        .limit(1);
      const existing = existingRows[0];
      if (existing?.status === "locked") {
        throw new TRPCError({ code: "CONFLICT", message: "该考勤记录已锁定，不能再编辑" });
      }
      if (existing) await assertExistingBusinessRecordChangeAccess(ctx);
      const values = {
        workerId: input.workerId,
        projectId: input.projectId,
        attendanceDate,
        workHours: String(input.workHours),
        overtimeHours: String(input.overtimeHours),
        note: input.note?.trim() || null,
        source: input.source,
        status: input.status,
      } as const;
      if (existing) {
        await db.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, existing.id));
      } else {
        await db.insert(attendanceRecords).values(values);
      }
      await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: existing ? "update_attendance" : "create_attendance", targetType: "attendance_record", targetId: String(existing?.id ?? `${input.workerId}-${input.attendanceDate}`), summary: `${input.attendanceDate} 考勤${existing ? "更新" : "录入"}：${input.workHours} 小时，加班 ${input.overtimeHours} 小时` });
      return { success: true, id: existing?.id ?? null };
    }),
  }),

  payroll: router({
    /** 按项目和工资期间查询工资条，银行卡仅展示由服务端生成的尾号掩码。 */
    list: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive(), period: payrollPeriodSchema.optional() }))
      .query(async ({ ctx, input }) => {
        const roleCodes = await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db) return [];
        const filter = input.period
          ? and(eq(payrollStatements.projectId, input.projectId), eq(payrollStatements.period, input.period))
          : eq(payrollStatements.projectId, input.projectId);
        const rows = await db
          .select({
            id: payrollStatements.id,
            workerId: payrollStatements.workerId,
            workerName: laborWorkers.realName,
            teamName: laborWorkers.teamName,
            projectId: payrollStatements.projectId,
            period: payrollStatements.period,
            payableAmount: payrollStatements.payableAmount,
            deductionAmount: payrollStatements.deductionAmount,
            actualAmount: payrollStatements.actualAmount,
            bankAccountMasked: payrollStatements.bankAccountMasked,
            status: payrollStatements.status,
            accountantId: payrollStatements.accountantId,
            paidAt: payrollStatements.paidAt,
            paymentReference: payrollStatements.paymentReference,
            createdAt: payrollStatements.createdAt,
            updatedAt: payrollStatements.updatedAt,
          })
          .from(payrollStatements)
          .innerJoin(laborWorkers, eq(payrollStatements.workerId, laborWorkers.id))
          .where(filter)
          .orderBy(desc(payrollStatements.period), laborWorkers.realName);
        const mayViewPaymentReference = canViewPayrollPaymentReference(roleCodes);
        return rows.map(row => ({
          ...row,
          paymentReference: mayViewPaymentReference ? row.paymentReference : null,
        }));
      }),

    /** 保存工资草稿；服务端通过应发减扣款计算实发金额并读取银行卡尾号。 */
    save: protectedProcedure.input(payrollSaveInput).mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertLaborBusinessAccess(ctx);
      const { db, worker } = await getScopedWorker(ctx, input.workerId, input.projectId);
      const money = calculatePayrollAmounts({ payableAmount: input.payableAmount, deductionAmount: input.deductionAmount });
      const bankAccountMasked = getMaskedEncryptedValue(worker.bankAccountEncrypted);
      const existingRows = await db
        .select()
        .from(payrollStatements)
        .where(and(eq(payrollStatements.workerId, input.workerId), eq(payrollStatements.projectId, input.projectId), eq(payrollStatements.period, input.period)))
        .limit(1);
      const existing = existingRows[0];
      if (existing && ["approved", "paid", "void"].includes(existing.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "已审核、已支付或已作废的工资条不可直接修改" });
      }
      if (existing) await assertExistingBusinessRecordChangeAccess(ctx);
      const values = {
        workerId: input.workerId,
        projectId: input.projectId,
        period: input.period,
        payableAmount: String(money.payableAmount),
        deductionAmount: String(money.deductionAmount),
        actualAmount: String(money.actualAmount),
        bankAccountMasked,
        status: "draft" as const,
        submittedBy: null,
        submittedAt: null,
        accountantId: null,
        reviewedAt: null,
        paidAt: null,
      };
      if (existing) {
        const updateResult = await db.update(payrollStatements)
          .set(values)
          .where(and(eq(payrollStatements.id, existing.id), eq(payrollStatements.status, existing.status)));
        assertConditionalPayrollWrite(updateResult);
      } else {
        await db.insert(payrollStatements).values(values);
      }
      await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: existing ? "update_payroll" : "create_payroll", targetType: "payroll_statement", targetId: String(existing?.id ?? `${input.workerId}-${input.period}`), summary: `${input.period} 工资条${existing ? "更新" : "创建"}：应发 ${money.payableAmount} 元，实发 ${money.actualAmount} 元` });
      return { success: true, id: existing?.id ?? null, actualAmount: money.actualAmount };
    }),

    /** 将工资草稿提交至会计审核队列，提交后仍可被会计退回草稿修订。 */
    submit: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertLaborBusinessAccess(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const rows = await db.select().from(payrollStatements).where(eq(payrollStatements.id, input.id)).limit(1);
      const payroll = rows[0];
      if (!payroll) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
      await assertProjectInCurrentScope(ctx, payroll.projectId);
      try {
        assertPayrollStatusTransition(payroll.status, "reviewing");
      } catch {
        throw new TRPCError({ code: "CONFLICT", message: "仅工资草稿可以提交会计审核" });
      }
      const updateResult = await db.update(payrollStatements)
        .set({ status: "reviewing", submittedBy: user.id, submittedAt: new Date(), accountantId: null, reviewedAt: null })
        .where(and(eq(payrollStatements.id, payroll.id), eq(payrollStatements.status, payroll.status)));
      assertConditionalPayrollWrite(updateResult);
      await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "submit_payroll", targetType: "payroll_statement", targetId: String(payroll.id), summary: `${payroll.period} 工资条提交会计审核` });
      try {
        const messageResult = await createInAppMessage({
          eventCode: "PAYROLL_SUBMITTED",
          idempotencyKey: `payroll-submitted:${payroll.id}`,
          recipientUserId: user.id,
          title: "工资条已提交会计审核",
          content: `${payroll.period} 工资条已提交会计审核，后续处理结果会在此通知。`,
          deepLink: "/mobile/labor",
        });
        if (!messageResult.created && messageResult.reason === "database_unavailable") {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "payroll_statement", targetId: String(payroll.id), summary: "工资提交站内消息未能写入：数据库暂不可用" });
        }
      } catch (error) {
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "payroll_statement", targetId: String(payroll.id), summary: `工资提交站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
      }
      // 公众号只投递通用业务节点摘要，不携带姓名、金额、银行卡等工资敏感信息。
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "labor", eventCode: "payroll_submitted", targetType: "payroll_statement", targetId: String(payroll.id), title: "工资条已提交会计审核", content: "一份工资条已提交会计审核，请进入系统办理。", deepLink: "/mobile/labor" }).catch(() => undefined);
      return { success: true };
    }),

    /** 会计专属审核入口；可批准或退回工资草稿，且必须在服务端复核角色与项目范围。 */
    approve: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), decision: z.enum(["approved", "returned"]).default("approved") }))
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (!canApprovePayroll(roleCodes)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "工资审核仅限会计岗位办理" });
        }
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
        const rows = await db.select().from(payrollStatements).where(eq(payrollStatements.id, input.id)).limit(1);
        const payroll = rows[0];
        if (!payroll) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        const isApproved = input.decision === "approved";
        try {
          assertPayrollStatusTransition(payroll.status, isApproved ? "approved" : "draft");
        } catch {
          throw new TRPCError({ code: "CONFLICT", message: "仅审核中的工资条可以办理会计审核" });
        }
        const reviewedAt = new Date();
        const updateResult = await db.update(payrollStatements)
          .set({ status: isApproved ? "approved" : "draft", accountantId: user.id, reviewedAt })
          .where(and(eq(payrollStatements.id, payroll.id), eq(payrollStatements.status, payroll.status)));
        assertConditionalPayrollWrite(updateResult);
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: isApproved ? "approve_payroll" : "return_payroll", targetType: "payroll_statement", targetId: String(payroll.id), summary: `${payroll.period} 工资条已${isApproved ? "审核通过" : "退回草稿"}` });
        // 通知只写入审核结论和业务入口，不写入工资金额、银行卡等敏感工资信息。
        if (payroll.submittedBy) {
          try {
            const messageResult = await createInAppMessage({
              eventCode: isApproved ? "PAYROLL_APPROVED" : "PAYROLL_RETURNED",
              idempotencyKey: `payroll-review:${payroll.id}:${reviewedAt.getTime()}:${input.decision}`,
              recipientUserId: payroll.submittedBy,
              title: isApproved ? "工资条已完成会计审核" : "工资条已退回修订",
              content: `${payroll.period} 工资条已${isApproved ? "审核通过，请按流程继续办理" : "退回草稿，请核对后重新提交"}。`,
              deepLink: "/mobile/labor",
            });
            if (!messageResult.created && messageResult.reason === "database_unavailable") {
              await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "payroll_statement", targetId: String(payroll.id), summary: "工资审核结论未能写入站内消息：数据库暂不可用" });
            }
          } catch (error) {
            await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "payroll_statement", targetId: String(payroll.id), summary: `工资审核结论消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
          }
        }
        // 公众号通知仅表述流程结论，详细工资信息必须在受权限保护的系统内查看。
        void notifyOfficialAccountBusinessEventSafely({ userId: user.id, recipientUserIds: payroll.submittedBy ? [payroll.submittedBy] : undefined, module: "labor", eventCode: isApproved ? "payroll_approved" : "payroll_returned", targetType: "payroll_statement", targetId: String(payroll.id), title: isApproved ? "工资条已完成会计审核" : "工资条已退回修订", content: "工资条审核状态已更新，请进入系统查看受控处理记录。", deepLink: "/mobile/labor" }).catch(() => undefined);
        return { success: true, status: isApproved ? "approved" : "draft" };
      }),

    /**
     * 由财务负责人确认外部资金已完成发放。系统只保存付款凭证引用，不发起银行转账，
     * 以保证资金执行与系统台账确认之间具有可追溯且不越权的边界。
     */
    pay: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), paymentReference: z.string().trim().min(4, "请填写付款凭证号或资金流水号").max(64) }))
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (!canPayPayroll(roleCodes)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "工资发放确认仅限财务负责人办理" });
        }
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
        const rows = await db.select().from(payrollStatements).where(eq(payrollStatements.id, input.id)).limit(1);
        const payroll = rows[0];
        if (!payroll) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        try {
          assertPayrollStatusTransition(payroll.status, "paid");
        } catch {
          throw new TRPCError({ code: "CONFLICT", message: "仅审核通过的工资条可以确认发放" });
        }
        const paidAt = new Date();
        const updateResult = await db.update(payrollStatements)
          .set({ status: "paid", paidAt, paymentReference: input.paymentReference })
          .where(and(eq(payrollStatements.id, payroll.id), eq(payrollStatements.status, payroll.status)));
        assertConditionalPayrollWrite(updateResult);
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "pay_payroll", targetType: "payroll_statement", targetId: String(payroll.id), summary: `${payroll.period} 工资条已确认发放，付款凭证：${input.paymentReference}` });
        const recipientUserId = payroll.submittedBy ?? user.id;
        try {
          const messageResult = await createInAppMessage({
            eventCode: "PAYROLL_PAID",
            idempotencyKey: `payroll-paid:${payroll.id}:${paidAt.getTime()}`,
            recipientUserId,
            title: "工资条已确认发放",
            content: `${payroll.period} 工资条已完成发放确认，请在系统内查看处理记录。`,
            deepLink: "/mobile/labor",
          });
          if (!messageResult.created && messageResult.reason === "database_unavailable") {
            await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "payroll_statement", targetId: String(payroll.id), summary: "工资发放结论未能写入站内消息：数据库暂不可用" });
          }
        } catch (error) {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "payroll_statement", targetId: String(payroll.id), summary: `工资发放结论消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
        }
        // 公众号不传递金额、人员身份、银行卡或付款凭证，仅提醒责任人在受控页面查看结果。
        void notifyOfficialAccountBusinessEventSafely({ userId: user.id, recipientUserIds: [recipientUserId], module: "labor", eventCode: "payroll_paid", targetType: "payroll_statement", targetId: String(payroll.id), title: "工资条已确认发放", content: "工资条已完成发放确认，请进入系统查看受控处理记录。", deepLink: "/mobile/labor" }).catch(() => undefined);
        return { success: true, status: "paid" as const, paidAt };
      }),

    /** 工资条可在支付前由会计或财务负责人作废，原因只保存于受控审计和站内业务记录。 */
    void: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1, "请填写作废原因").max(500, "作废原因不得超过 500 个字符") }))
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (!canVoidPayroll(roleCodes)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "工资条作废仅限会计或财务负责人办理" });
        }
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
        const rows = await db.select().from(payrollStatements).where(eq(payrollStatements.id, input.id)).limit(1);
        const payroll = rows[0];
        if (!payroll) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        try {
          assertPayrollStatusTransition(payroll.status, "void");
        } catch {
          throw new TRPCError({ code: "CONFLICT", message: "已发放或已作废的工资条不可作废" });
        }
        const voidedAt = new Date();
        const updateResult = await db.update(payrollStatements)
          .set({ status: "void" })
          .where(and(eq(payrollStatements.id, payroll.id), eq(payrollStatements.status, payroll.status)));
        assertConditionalPayrollWrite(updateResult);
        await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "void_payroll", targetType: "payroll_statement", targetId: String(payroll.id), summary: `${payroll.period} 工资条已作废，原因：${input.reason}` });
        const recipientUserId = payroll.submittedBy ?? user.id;
        try {
          const messageResult = await createInAppMessage({
            eventCode: "PAYROLL_VOIDED",
            idempotencyKey: `payroll-void:${payroll.id}:${voidedAt.getTime()}`,
            recipientUserId,
            title: "工资条已作废",
            content: `${payroll.period} 工资条已作废，请在系统内查看处理记录。`,
            deepLink: "/mobile/labor",
          });
          if (!messageResult.created && messageResult.reason === "database_unavailable") {
            await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_unavailable", targetType: "payroll_statement", targetId: String(payroll.id), summary: "工资作废结论未能写入站内消息：数据库暂不可用" });
          }
        } catch (error) {
          await db.insert(auditLogs).values({ userId: user.id, module: "labor", action: "notification_failed", targetType: "payroll_statement", targetId: String(payroll.id), summary: `工资作废结论消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}` });
        }
        void notifyOfficialAccountBusinessEventSafely({ userId: user.id, recipientUserIds: [recipientUserId], module: "labor", eventCode: "payroll_voided", targetType: "payroll_statement", targetId: String(payroll.id), title: "工资条已作废", content: "一份工资条已作废，请进入系统查看受控处理记录。", deepLink: "/mobile/labor" }).catch(() => undefined);
        return { success: true, status: "void" as const };
      }),
  }),

  /** 汇总项目指定工资期间内的考勤与工资口径，供移动端统计卡片和打印视图复用。 */
  summary: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), period: payrollPeriodSchema }))
    .query(async ({ ctx, input }) => {
      await assertLaborBusinessAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) {
        return { totalWorkers: 0, activeWorkers: 0, attendanceDays: 0, workHours: 0, overtimeHours: 0, payableAmount: 0, deductionAmount: 0, actualAmount: 0, awaitingReviewCount: 0, awaitingReviewAmount: 0, approvedCount: 0 };
      }
      const range = getPeriodRange(input.period);
      const [workers, attendance, payrolls] = await Promise.all([
        db.select({ id: laborWorkers.id, attendanceStatus: laborWorkers.attendanceStatus }).from(laborWorkers).where(eq(laborWorkers.projectId, input.projectId)),
        db.select({ workHours: attendanceRecords.workHours, overtimeHours: attendanceRecords.overtimeHours }).from(attendanceRecords).where(and(eq(attendanceRecords.projectId, input.projectId), gte(attendanceRecords.attendanceDate, range.start), lt(attendanceRecords.attendanceDate, range.endExclusive))),
        db.select({ payableAmount: payrollStatements.payableAmount, deductionAmount: payrollStatements.deductionAmount, actualAmount: payrollStatements.actualAmount, status: payrollStatements.status }).from(payrollStatements).where(and(eq(payrollStatements.projectId, input.projectId), eq(payrollStatements.period, input.period))),
      ]);
      const payrollSummary = summarizePayrollStatements(payrolls);
      return {
        totalWorkers: workers.length,
        activeWorkers: workers.filter(worker => worker.attendanceStatus === "active").length,
        attendanceDays: attendance.length,
        workHours: roundMoney(attendance.reduce((sum, item) => sum + Number(item.workHours), 0)),
        overtimeHours: roundMoney(attendance.reduce((sum, item) => sum + Number(item.overtimeHours), 0)),
        ...payrollSummary,
      };
    }),
});
