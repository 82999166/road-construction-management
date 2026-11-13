import { and, desc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  attendanceCheckIns,
  attendanceDeviceBindings,
  attendanceRecords,
  auditLogs,
  evidenceRecords,
  laborWorkers,
  payrollStatements,
  projects,
  temporaryDailyWageSettlements,
  users,
} from "../../drizzle/schema";
import {
  assertAttendanceWorkHours,
  assertCertificateFileSignature,
  assertPayrollStatusTransition,
  calculatePayrollAmounts,
  canApprovePayroll,
  canPayPayroll,
  canVoidPayroll,
  summarizePayrollStatements,
} from "../../shared/domain";
import {
  assertDepartmentBusinessAccess,
  assertExistingBusinessRecordChangeAccess,
  assertProjectInCurrentScope,
  getCurrentDataScope,
  getEffectiveRoleCodes,
  requireAuthenticatedUser,
  type BusinessOperationAction,
} from "../access";
import { getDb } from "../db";
import { createInAppMessage } from "./messages";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  revealBusinessSecret,
} from "../services/secretVault";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { storageGet, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { makeRequest, type GeocodingResult } from "../_core/map";
import {
  appendIntegrityProtectedAudit,
  recordSensitiveDataAccess,
} from "../services/auditIntegrity";
import { getPublishedAttendanceDeviceLimit } from "../services/attendanceDevicePolicy";
import {
  assertCompensationChannel,
  assertLegacyCoreEditSafe,
  omitUnchangedLegacyFields,
} from "../services/personnelLegacyBridge";

/** 工资结算期间统一使用 YYYY-MM，避免将时区信息混入按月结算的业务口径。 */
const payrollPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "工资期间格式应为 YYYY-MM");

/** 定位反查失败不会阻断依法必需的考勤打卡；列表只显示中文地址或待解析状态，绝不回退展示经纬度。 */
async function resolveAttendanceAddress(latitude: number, longitude: number) {
  try {
    const result = await makeRequest<GeocodingResult>(
      "/maps/api/geocode/json",
      { latlng: `${latitude},${longitude}`, language: "zh-CN", region: "cn" }
    );
    return result.status === "OK"
      ? (result.results?.[0]?.formatted_address ?? null)
      : null;
  } catch {
    return null;
  }
}

/** 劳务人员档案输入；敏感原文只在写入时出现，查询响应中绝不返回。 */
const workerInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  teamName: z.string().trim().max(128).nullable().optional(),
  workerCategory: z
    .enum(["company_admin", "labor_team", "temporary_daily"])
    .optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  realName: z.string().trim().min(2, "请填写实名姓名").max(64),
  identityNo: z
    .string()
    .trim()
    .min(15, "请填写有效身份证号码")
    .max(32)
    .optional(),
  phone: z
    .string()
    .trim()
    .min(6, "请填写有效联系电话")
    .max(32)
    .nullable()
    .optional(),
  bankAccount: z
    .string()
    .trim()
    .min(8, "请填写有效银行卡号")
    .max(64)
    .nullable()
    .optional(),
  bankName: z.string().trim().max(128).nullable().optional(),
  identityVerificationStatus: z
    .enum(["pending", "verified", "rejected"])
    .optional(),
  identityVerificationNote: z
    .string()
    .trim()
    .max(500, "实名审核备注不得超过 500 个字符")
    .nullable()
    .optional(),
  attendanceStatus: z.enum(["pending", "active", "left"]).optional(),
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
    note: z
      .string()
      .trim()
      .max(500, "考勤备注不得超过 500 个字符")
      .nullable()
      .optional(),
    source: z.enum(["manual", "mobile", "device", "import"]).default("mobile"),
    status: z.enum(["draft", "confirmed"]).default("confirmed"),
  })
  .refine(value => value.workHours + value.overtimeHours <= 24, {
    message: "正常工时与加班工时合计不得超过 24 小时",
    path: ["overtimeHours"],
  });

/** 设备原始标识仅在浏览器本地生成并哈希；服务端只接收不可逆的 SHA-256 指纹。 */
const mobileCheckInInput = z.object({
  projectId: z.number().int().positive(),
  punchType: z.enum(["in", "out"]).default("in"),
  deviceFingerprintHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "设备指纹格式无效"),
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
    deductionAmount: z
      .number()
      .min(0, "扣款金额不得为负数")
      .max(999999999999.99)
      .default(0),
  })
  .refine(value => value.deductionAmount <= value.payableAmount, {
    message: "扣款金额不得大于应发金额",
    path: ["deductionAmount"],
  });

const dailyWageSaveInput = z
  .object({
    workerId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    settlementDate: z.string().date(),
    payableAmount: z.number().min(0),
    deductionAmount: z.number().min(0).default(0),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .refine(value => value.deductionAmount <= value.payableAmount, {
    message: "扣款金额不得大于应发金额",
    path: ["deductionAmount"],
  });

/** 实名制证照仅支持常见图片或 PDF，单文件限制为 5MB，防止移动端误传视频等大文件。 */
const certificateUploadInput = z.object({
  workerId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  certificateName: z.string().trim().min(1, "请填写证照名称").max(128),
  fileName: z.string().trim().min(1, "缺少证照文件名").max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  base64Data: z
    .string()
    .min(1, "证照文件不能为空")
    .max(7_000_000, "证照文件超过 5MB 限制"),
});

const LABOR_CERTIFICATE_SOURCE_TYPE = "labor_worker_certificate";
const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;

/**
 * 只有劳资、项目、财务及会计岗位可以进入劳务工资数据域。
 * 管理员对应 ALL 标记，用于系统初始化、应急处理和后台授权后的完整数据访问。
 */
async function assertLaborBusinessAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  action: BusinessOperationAction = "read"
) {
  await assertDepartmentBusinessAccess(ctx, "LABOR", action);
  return getEffectiveRoleCodes(ctx);
}

/** 付款凭证属于内部资金流水，只允许会计、财务负责人和系统级应急角色查看。 */
function canViewPayrollPaymentReference(roleCodes: readonly string[]) {
  return (
    roleCodes.includes("ALL") ||
    roleCodes.includes("ACCOUNTANT") ||
    roleCodes.includes("FINANCE_MANAGER")
  );
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
  if (
    header &&
    typeof header === "object" &&
    "affectedRows" in header &&
    Number((header as { affectedRows?: unknown }).affectedRows) === 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "工资条已被其他用户更新，请刷新后重试",
    });
  }
}

/** 下班更新必须真实命中本人、项目和当天的未下班记录，禁止把 0 行更新误报为移动端成功。 */
function assertAttendanceCheckoutWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (
    header &&
    typeof header === "object" &&
    "affectedRows" in header &&
    Number((header as { affectedRows?: unknown }).affectedRows) === 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "未确认到可更新的今日上班记录，请刷新考勤状态后重试下班打卡",
    });
  }
}

/** 将 YYYY-MM-DD 业务日期固定转换为 UTC 零点，避免客户端时区影响项目日考勤口径。 */
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 考勤日期统一按中国标准时间裁切，实际打卡时间始终由服务端生成并保存为 UTC。 */
function getChinaBusinessDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * MySQL DATE 与 JavaScript Date 在不同运行时区下比较可能发生序列化偏移。
 * 考勤状态、上下班衔接和台账筛选统一以中国自然日对应的 UTC 时间区间匹配真实上班时间，
 * 而 businessDate 继续仅承担唯一键和审计标签职责。
 */
function getChinaBusinessDateRange(value: string) {
  const start = new Date(`${value}T00:00:00.000+08:00`);
  return {
    start,
    endExclusive: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

function attendanceCheckInDateRangeFilter(value: string) {
  const { start, endExclusive } = getChinaBusinessDateRange(value);
  return and(
    gte(attendanceCheckIns.checkedInAt, start),
    lt(attendanceCheckIns.checkedInAt, endExclusive)
  );
}

/** 返回已完成项目和岗位权限校验的业务资料完整值；数据库仍保存加密密文。 */
function getBusinessEncryptedValue(cipherText: string | null | undefined) {
  try {
    return revealBusinessSecret(cipherText);
  } catch {
    return null;
  }
}

/** 将劳务档案投影为移动端安全视图，严格排除所有密文字段。 */
function toSafeWorker(worker: typeof laborWorkers.$inferSelect) {
  return {
    id: worker.id,
    projectId: worker.projectId,
    teamName: worker.teamName,
    workerCategory: worker.workerCategory,
    remarks: worker.remarks,
    realName: worker.realName,
    identityNoMasked: getBusinessEncryptedValue(worker.identityNoEncrypted),
    phoneMasked: getBusinessEncryptedValue(worker.phoneEncrypted),
    bankAccountMasked: getBusinessEncryptedValue(worker.bankAccountEncrypted),
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
async function getScopedWorker(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  workerId: number,
  projectId: number
) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const rows = await db
    .select()
    .from(laborWorkers)
    .where(eq(laborWorkers.id, workerId))
    .limit(1);
  const worker = rows[0];
  if (!worker || worker.projectId !== projectId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到指定项目下的劳务人员档案",
    });
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
    endExclusive: toBusinessDate(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
    ),
  };
}

/** 将用户提供的文件名归一化为对象存储安全路径片段，保留中文、数字、短横线和扩展名。 */
function getSafeStorageFileName(fileName: string) {
  return (
    fileName.replace(/[^\w.()\-\u4e00-\u9fa5]/g, "_").slice(0, 160) ||
    "certificate"
  );
}

/** 从证照元数据中恢复业务名称；旧记录或解析失败时回退到原始文件名。 */
function getCertificateName(metadata: string | null, fallback: string | null) {
  try {
    const parsed = metadata
      ? (JSON.parse(metadata) as { certificateName?: unknown })
      : null;
    return typeof parsed?.certificateName === "string" &&
      parsed.certificateName.trim()
      ? parsed.certificateName.trim()
      : fallback || "未命名证照";
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
      return db
        .select({
          id: projects.id,
          code: projects.code,
          name: projects.name,
          status: projects.status,
          organizationId: projects.organizationId,
        })
        .from(projects)
        .orderBy(projects.sortOrder, projects.id);
    }
    if (!scope.projectIds.length && !scope.organizationIds.length) return [];
    const allProjects = await db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        status: projects.status,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .orderBy(projects.sortOrder, projects.id);
    return allProjects.filter(
      project =>
        scope.projectIds.includes(project.id) ||
        (project.organizationId !== null &&
          scope.organizationIds.includes(project.organizationId))
    );
  }),

  /** 按项目读取实名制人员台账，统一返回完整身份证、手机号和银行卡号；数据库仍使用加密字段。 */
  listWorkers: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        includeLeft: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertLaborBusinessAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(laborWorkers)
        .where(eq(laborWorkers.projectId, input.projectId))
        .orderBy(laborWorkers.teamName, laborWorkers.realName);
      return rows
        .filter(
          worker => input.includeLeft || worker.attendanceStatus !== "left"
        )
        .map(toSafeWorker);
    }),

  /** 新建或维护实名制人员档案；身份证、手机号和银行卡在服务端加密后才会持久化。 */
  saveWorker: protectedProcedure
    .input(workerInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertLaborBusinessAccess(ctx, input.id ? "edit" : "create");
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (
        input.entryDate &&
        input.exitDate &&
        input.exitDate < input.entryDate
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "退场日期不得早于进场日期",
        });
      }

      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });

      const baseValues: Partial<typeof laborWorkers.$inferInsert> = {
        projectId: input.projectId,
        teamName: input.teamName,
        workerCategory: input.workerCategory,
        remarks: input.remarks,
        realName: input.realName,
        bankName: input.bankName,
        attendanceStatus: input.attendanceStatus,
        entryDate:
          input.entryDate === undefined
            ? undefined
            : input.entryDate
              ? toBusinessDate(input.entryDate)
              : null,
        exitDate:
          input.exitDate === undefined
            ? undefined
            : input.exitDate
              ? toBusinessDate(input.exitDate)
              : null,
      };
      if (input.identityNo)
        baseValues.identityNoEncrypted = encryptSecret(input.identityNo);
      if (input.phone !== undefined && input.phone !== "") {
        const phone = input.phone?.replace(/[\s\-()]/g, "") ?? null;
        baseValues.phoneEncrypted = phone ? encryptSecret(phone) : null;
        baseValues.phoneFingerprint = phone ? fingerprintSecret(phone) : null;
      }
      if (input.bankAccount !== undefined)
        baseValues.bankAccountEncrypted = input.bankAccount
          ? encryptSecret(input.bankAccount)
          : null;

      if (input.id) {
        const existingRows = await db
          .select()
          .from(laborWorkers)
          .where(eq(laborWorkers.id, input.id))
          .limit(1);
        const existing = existingRows[0];
        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "劳务人员档案不存在",
          });
        // 对原项目及目标项目均校验范围，防止利用编辑接口跨项目转移人员档案。
        await assertProjectInCurrentScope(ctx, existing.projectId);
        if (input.identityVerificationStatus) {
          if (
            input.identityVerificationStatus === "verified" &&
            !input.identityNo &&
            !existing.identityNoEncrypted
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "完成实名核验前必须录入身份证号码",
            });
          }
          baseValues.identityVerificationStatus =
            input.identityVerificationStatus;
          baseValues.identityVerificationNote =
            input.identityVerificationNote ?? null;
          baseValues.identityVerifiedAt =
            input.identityVerificationStatus === "verified" ? new Date() : null;
          baseValues.identityVerifiedBy =
            input.identityVerificationStatus === "verified" ? user.id : null;
        } else if (input.identityVerificationNote !== undefined) {
          baseValues.identityVerificationNote = input.identityVerificationNote;
        }
        await assertLegacyCoreEditSafe(
          db,
          "worker",
          existing.id,
          input,
          existing as unknown as Record<string, unknown>
        );
        await db
          .update(laborWorkers)
          .set(omitUnchangedLegacyFields(baseValues))
          .where(eq(laborWorkers.id, input.id));
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "update_worker",
          targetType: "labor_worker",
          targetId: String(input.id),
          summary: `更新劳务实名制档案：${input.realName}${input.identityVerificationStatus ? ` · 实名状态：${input.identityVerificationStatus}` : ""}`,
        });
        if (
          input.identityVerificationStatus === "verified" &&
          existing.identityVerificationStatus !== "verified"
        ) {
          try {
            const messageResult = await createInAppMessage({
              eventCode: "IDENTITY_VERIFIED",
              idempotencyKey: `identity-verified:${input.id}`,
              recipientUserId: user.id,
              title: "劳务人员实名核验已完成",
              content:
                "您已完成一名劳务人员的实名核验，详细档案请在系统内查看。",
              deepLink: "/mobile/labor",
            });
            if (
              !messageResult.created &&
              messageResult.reason === "database_unavailable"
            ) {
              await db.insert(auditLogs).values({
                userId: user.id,
                module: "labor",
                action: "notification_unavailable",
                targetType: "labor_worker",
                targetId: String(input.id),
                summary: "实名核验站内消息未能写入：数据库暂不可用",
              });
            }
          } catch (error) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_failed",
              targetType: "labor_worker",
              targetId: String(input.id),
              summary: `实名核验站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
            });
          }
          // 公众号通知不携带姓名、身份证号等个人信息，实名详情只能在受权限保护的台账中查看。
          void notifyOfficialAccountBusinessEventSafely({
            userId: user.id,
            module: "labor",
            eventCode: "labor_identity_verified",
            targetType: "labor_worker",
            targetId: String(input.id),
            title: "劳务实名核验已完成",
            content: "一项劳务实名核验已完成，请进入系统查看受控台账。",
            deepLink: "/mobile/labor",
          }).catch(() => undefined);
        }
        return { success: true, id: input.id };
      }

      if (!input.identityNo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新建实名制人员必须录入身份证号码",
        });
      }
      baseValues.workerCategory = input.workerCategory ?? "labor_team";
      baseValues.attendanceStatus = input.attendanceStatus ?? "pending";
      const verificationStatus = input.identityVerificationStatus ?? "pending";
      if (verificationStatus === "verified" && !input.identityNo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完成实名核验前必须录入身份证号码",
        });
      }
      baseValues.identityVerificationStatus = verificationStatus;
      baseValues.identityVerificationNote =
        input.identityVerificationNote ?? null;
      baseValues.identityVerifiedAt =
        verificationStatus === "verified" ? new Date() : null;
      baseValues.identityVerifiedBy =
        verificationStatus === "verified" ? user.id : null;
      const result = await db
        .insert(laborWorkers)
        .values(baseValues as typeof laborWorkers.$inferInsert);
      const insertId = Number(
        (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
      );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "labor",
        action: "create_worker",
        targetType: "labor_worker",
        targetId: String(insertId || input.realName),
        summary: `新建劳务实名制档案：${input.realName}`,
      });
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
          if (
            !messageResult.created &&
            messageResult.reason === "database_unavailable"
          ) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_unavailable",
              targetType: "labor_worker",
              targetId: String(insertId || input.realName),
              summary: "实名核验站内消息未能写入：数据库暂不可用",
            });
          }
        } catch (error) {
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: "notification_failed",
            targetType: "labor_worker",
            targetId: String(insertId || input.realName),
            summary: `实名核验站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
          });
        }
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          module: "labor",
          eventCode: "labor_identity_verified",
          targetType: "labor_worker",
          targetId: String(insertId || input.realName),
          title: "劳务实名核验已完成",
          content: "一项劳务实名核验已完成，请进入系统查看受控台账。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
      }
      return { success: true, id: insertId || null };
    }),

  certificates: router({
    /** 读取指定劳务人员的证照元数据和安全存储地址，文件本体不进入数据库。 */
    list: protectedProcedure
      .input(
        z.object({
          workerId: z.number().int().positive(),
          projectId: z.number().int().positive(),
        })
      )
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        const { db } = await getScopedWorker(
          ctx,
          input.workerId,
          input.projectId
        );
        const rows = await db
          .select({
            id: evidenceRecords.id,
            fileKey: evidenceRecords.fileKey,
            fileName: evidenceRecords.fileName,
            mimeType: evidenceRecords.mimeType,
            ocrResultJson: evidenceRecords.ocrResultJson,
            createdAt: evidenceRecords.createdAt,
          })
          .from(evidenceRecords)
          .where(
            and(
              eq(evidenceRecords.projectId, input.projectId),
              eq(evidenceRecords.sourceType, LABOR_CERTIFICATE_SOURCE_TYPE),
              eq(evidenceRecords.sourceId, String(input.workerId))
            )
          )
          .orderBy(desc(evidenceRecords.createdAt));
        return Promise.all(
          rows.map(async row => ({
            id: row.id,
            certificateName: getCertificateName(
              row.ocrResultJson,
              row.fileName
            ),
            fileName: row.fileName || "未命名文件",
            mimeType: row.mimeType || "application/octet-stream",
            url: (await storageGet(row.fileKey)).url,
            createdAt: row.createdAt,
          }))
        );
      }),

    /** 上传并关联实名制证照；上传前校验人员归属、项目范围、MIME 类型与二进制大小。 */
    upload: protectedProcedure
      .input(certificateUploadInput)
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertLaborBusinessAccess(ctx);
        const { db, worker } = await getScopedWorker(
          ctx,
          input.workerId,
          input.projectId
        );
        const bytes = Buffer.from(input.base64Data, "base64");
        if (!bytes.length || bytes.length > MAX_CERTIFICATE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "证照文件为空或超过 5MB 限制",
          });
        }
        try {
          assertCertificateFileSignature(bytes, input.mimeType);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error ? error.message : "证照文件格式校验失败",
          });
        }
        const safeFileName = getSafeStorageFileName(input.fileName);
        const contentSha256 = createHash("sha256").update(bytes).digest("hex");
        const upload = await storagePut(
          `labor-certificates/project-${input.projectId}/worker-${input.workerId}/${safeFileName}`,
          bytes,
          input.mimeType
        );
        let insertId = 0;
        await db.transaction(async tx => {
          const result = await tx.insert(evidenceRecords).values({
            projectId: input.projectId,
            sourceType: LABOR_CERTIFICATE_SOURCE_TYPE,
            sourceId: String(input.workerId),
            fileKey: upload.key,
            fileName: safeFileName,
            mimeType: input.mimeType,
            contentSha256,
            contentBytes: bytes.length,
            ocrResultJson: JSON.stringify({
              certificateName: input.certificateName.trim(),
            }),
            retentionUntil: null,
            status: "active",
            uploadedBy: user.id,
          });
          insertId = Number(
            (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
          );
          await appendIntegrityProtectedAudit(tx, {
            userId: user.id,
            module: "labor",
            action: "upload_worker_certificate",
            targetType: "evidence_record",
            targetId: String(insertId || `${input.workerId}-${safeFileName}`),
            summary: `上传劳务人员证照：${worker.realName} · ${input.certificateName.trim()}`,
            afterJson: JSON.stringify({
              projectId: input.projectId,
              workerId: input.workerId,
              contentSha256,
              contentBytes: bytes.length,
              mimeType: input.mimeType,
            }),
          });
        });
        try {
          const messageResult = await createInAppMessage({
            eventCode: "WORKER_CERTIFICATE_ARCHIVED",
            idempotencyKey: `worker-certificate:${insertId || `${input.workerId}-${safeFileName}`}`,
            recipientUserId: user.id,
            title: "劳务人员证照已归档",
            content: "您已完成一份劳务人员证照归档，请在系统内继续办理核验。",
            deepLink: "/mobile/labor",
          });
          if (
            !messageResult.created &&
            messageResult.reason === "database_unavailable"
          ) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_unavailable",
              targetType: "evidence_record",
              targetId: String(insertId || `${input.workerId}-${safeFileName}`),
              summary: "证照归档站内消息未能写入：数据库暂不可用",
            });
          }
        } catch (error) {
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: "notification_failed",
            targetType: "evidence_record",
            targetId: String(insertId || `${input.workerId}-${safeFileName}`),
            summary: `证照归档站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
          });
        }
        // 仅提醒“证照已归档”这一流程节点，证照名称和人员身份信息不发送到公众号。
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          module: "labor",
          eventCode: "labor_certificate_archived",
          targetType: "evidence_record",
          targetId: String(insertId || `${input.workerId}-${safeFileName}`),
          title: "劳务人员证照已归档",
          content: "一份劳务人员证照已归档，请进入系统完成受控核验。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
        return { success: true, id: insertId || null, url: upload.url };
      }),
  }),

  attendance: router({
    /** 当前账号在已授权项目上的上下班状态；只返回本人设备的匿名标签和受控定位状态。 */
    myCheckInStatus: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db)
          return {
            checkedIn: false,
            checkedOut: false,
            businessDate: getChinaBusinessDate(new Date()),
            checkIn: null,
            checkOut: null,
          };
        const businessDate = getChinaBusinessDate(new Date());
        const [checkIn] = await db
          .select({
            id: attendanceCheckIns.id,
            checkedInAt: attendanceCheckIns.checkedInAt,
            checkedOutAt: attendanceCheckIns.checkedOutAt,
            deviceLabel: attendanceCheckIns.deviceLabel,
            status: attendanceCheckIns.status,
            checkoutStatus: attendanceCheckIns.checkoutStatus,
            checkInAddress: attendanceCheckIns.checkInAddress,
            checkoutAddress: attendanceCheckIns.checkoutAddress,
            locationAccuracyMeters: attendanceCheckIns.locationAccuracyMeters,
            checkoutLocationAccuracyMeters:
              attendanceCheckIns.checkoutLocationAccuracyMeters,
          })
          .from(attendanceCheckIns)
          .where(
            and(
              eq(attendanceCheckIns.userId, user.id),
              eq(attendanceCheckIns.projectId, input.projectId),
              attendanceCheckInDateRangeFilter(businessDate)
            )
          )
          .limit(1);
        return {
          checkedIn: Boolean(checkIn),
          checkedOut: Boolean(checkIn?.checkedOutAt),
          businessDate,
          checkIn: checkIn
            ? {
                ...checkIn,
                locationProtection:
                  checkIn.status === "normal"
                    ? "定位已受保护，业务页面仅显示中文地址"
                    : "未采集定位",
              }
            : null,
          checkOut: checkIn?.checkedOutAt
            ? {
                checkedOutAt: checkIn.checkedOutAt,
                status: checkIn.checkoutStatus,
                address: checkIn.checkoutAddress,
                locationAccuracyMeters: checkIn.checkoutLocationAccuracyMeters,
                locationProtection:
                  checkIn.checkoutStatus === "normal"
                    ? "定位已受保护，业务页面仅显示中文地址"
                    : "未采集定位",
              }
            : null,
        };
      }),

    /** 上班/下班打卡绑定首台设备；每人每天每项目仅允许各完成一次，服务端时间为准。 */
    checkIn: protectedProcedure
      .input(mobileCheckInInput)
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const now = new Date();
        const businessDateText = getChinaBusinessDate(now);
        const businessDate = toBusinessDate(businessDateText);
        const hasLocation =
          input.longitude !== null &&
          input.longitude !== undefined &&
          input.latitude !== null &&
          input.latitude !== undefined;
        if (!hasLocation)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "上下班打卡必须上传实时定位信息，请允许浏览器定位后重试",
          });
        const attendanceAddress = hasLocation
          ? await resolveAttendanceAddress(input.latitude!, input.longitude!)
          : null;
        const [existing] = await db
          .select({
            id: attendanceCheckIns.id,
            checkedInAt: attendanceCheckIns.checkedInAt,
            checkedOutAt: attendanceCheckIns.checkedOutAt,
            status: attendanceCheckIns.status,
            checkoutStatus: attendanceCheckIns.checkoutStatus,
          })
          .from(attendanceCheckIns)
          .where(
            and(
              eq(attendanceCheckIns.userId, user.id),
              eq(attendanceCheckIns.projectId, input.projectId),
              attendanceCheckInDateRangeFilter(businessDateText)
            )
          )
          .limit(1);
        if (input.punchType === "in" && existing)
          return {
            success: true,
            duplicate: true,
            punchType: "in" as const,
            id: existing.id,
            checkedInAt: existing.checkedInAt,
            businessDate: businessDateText,
            status: existing.status,
          };
        if (input.punchType === "out" && !existing)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先完成今日上班打卡后再进行下班打卡",
          });
        if (input.punchType === "out" && existing?.checkedOutAt)
          return {
            success: true,
            duplicate: true,
            punchType: "out" as const,
            id: existing.id,
            checkedOutAt: existing.checkedOutAt,
            businessDate: businessDateText,
            status: existing.checkoutStatus ?? "normal",
          };
        let newlyBound = false;
        let createdCheckInId = 0;
        try {
          await db.transaction(async tx => {
            const [binding] = await tx
              .select()
              .from(attendanceDeviceBindings)
              .where(
                and(
                  eq(attendanceDeviceBindings.userId, user.id),
                  eq(
                    attendanceDeviceBindings.deviceFingerprintHash,
                    input.deviceFingerprintHash.toLowerCase()
                  )
                )
              )
              .limit(1);
            if (binding?.status === "disabled")
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "当前考勤设备已被禁用，请联系管理员核验后重新绑定",
              });
            if (!binding) {
              const activeDevices = await tx
                .select({ id: attendanceDeviceBindings.id })
                .from(attendanceDeviceBindings)
                .where(
                  and(
                    eq(attendanceDeviceBindings.userId, user.id),
                    eq(attendanceDeviceBindings.status, "active")
                  )
                );
              const deviceLimit = await getPublishedAttendanceDeviceLimit(tx);
              if (activeDevices.length >= deviceLimit)
                throw new TRPCError({
                  code: "CONFLICT",
                  message: `当前账号已绑定 ${deviceLimit} 台考勤设备，请联系管理员停用旧设备或调整“考勤设备绑定上限”后再绑定`,
                });
              try {
                await tx.insert(attendanceDeviceBindings).values({
                  userId: user.id,
                  deviceFingerprintHash:
                    input.deviceFingerprintHash.toLowerCase(),
                  deviceLabel: input.deviceLabel,
                  status: "active",
                  firstBoundAt: now,
                  lastUsedAt: now,
                });
                newlyBound = true;
              } catch {
                const [concurrentBinding] = await tx
                  .select({ status: attendanceDeviceBindings.status })
                  .from(attendanceDeviceBindings)
                  .where(
                    and(
                      eq(attendanceDeviceBindings.userId, user.id),
                      eq(
                        attendanceDeviceBindings.deviceFingerprintHash,
                        input.deviceFingerprintHash.toLowerCase()
                      )
                    )
                  )
                  .limit(1);
                if (
                  !concurrentBinding ||
                  concurrentBinding.status === "disabled"
                )
                  throw new TRPCError({
                    code: "CONFLICT",
                    message: "考勤设备绑定并发冲突，请重试",
                  });
              }
            } else {
              await tx
                .update(attendanceDeviceBindings)
                .set({ deviceLabel: input.deviceLabel, lastUsedAt: now })
                .where(eq(attendanceDeviceBindings.id, binding.id));
            }
            if (input.punchType === "out" && existing) {
              const checkoutWrite = await tx
                .update(attendanceCheckIns)
                .set({
                  checkedOutAt: now,
                  checkoutAddress: attendanceAddress,
                  checkoutLongitude: hasLocation
                    ? String(input.longitude)
                    : null,
                  checkoutLatitude: hasLocation ? String(input.latitude) : null,
                  checkoutLocationAccuracyMeters:
                    input.locationAccuracyMeters === null ||
                    input.locationAccuracyMeters === undefined
                      ? null
                      : String(input.locationAccuracyMeters),
                  checkoutStatus: hasLocation ? "normal" : "location_missing",
                })
                .where(
                  and(
                    eq(attendanceCheckIns.id, existing.id),
                    eq(attendanceCheckIns.userId, user.id),
                    eq(attendanceCheckIns.projectId, input.projectId),
                    attendanceCheckInDateRangeFilter(businessDateText),
                    isNull(attendanceCheckIns.checkedOutAt)
                  )
                );
              assertAttendanceCheckoutWrite(checkoutWrite);
              await tx.insert(auditLogs).values({
                userId: user.id,
                module: "labor",
                action: "mobile_check_out",
                targetType: "attendance_check_in",
                targetId: String(existing.id),
                summary: `移动下班打卡：${businessDateText} · 已记录定位 · 设备 ${input.deviceLabel.slice(0, 60)}`,
              });
              return;
            }
            const [created] = await tx
              .insert(attendanceCheckIns)
              .values({
                userId: user.id,
                projectId: input.projectId,
                businessDate,
                checkedInAt: now,
                deviceFingerprintHash:
                  input.deviceFingerprintHash.toLowerCase(),
                deviceLabel: input.deviceLabel,
                checkInAddress: attendanceAddress,
                longitude: hasLocation ? String(input.longitude) : null,
                latitude: hasLocation ? String(input.latitude) : null,
                locationAccuracyMeters:
                  input.locationAccuracyMeters === null ||
                  input.locationAccuracyMeters === undefined
                    ? null
                    : String(input.locationAccuracyMeters),
                status: hasLocation ? "normal" : "location_missing",
              })
              .$returningId();
            createdCheckInId = Number(created?.id ?? 0);
            if (!createdCheckInId)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "打卡记录保存后未返回编号，请稍后重试",
              });
            await tx.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: newlyBound
                ? "bind_device_and_check_in"
                : "mobile_check_in",
              targetType: "attendance_check_in",
              targetId: String(createdCheckInId),
              summary: `移动一键打卡：${businessDateText} · 已记录定位 · 设备 ${input.deviceLabel.slice(0, 60)}`,
            });
          });
          if (input.punchType === "out" && existing)
            return {
              success: true,
              duplicate: false,
              punchType: "out" as const,
              id: existing.id,
              checkedOutAt: now,
              businessDate: businessDateText,
              status: "normal" as const,
              newlyBound,
            };
          return {
            success: true,
            duplicate: false,
            punchType: "in" as const,
            id: createdCheckInId,
            checkedInAt: now,
            businessDate: businessDateText,
            status: "normal" as const,
            newlyBound,
          };
        } catch (error) {
          if (input.punchType === "out") throw error;
          // 设备禁用、设备数量上限、项目范围等均为可处理的业务错误，不能被泛化为“保存失败”。
          if (error instanceof TRPCError) throw error;
          const [concurrent] = await db
            .select({
              id: attendanceCheckIns.id,
              checkedInAt: attendanceCheckIns.checkedInAt,
              status: attendanceCheckIns.status,
            })
            .from(attendanceCheckIns)
            .where(
              and(
                eq(attendanceCheckIns.userId, user.id),
                eq(attendanceCheckIns.projectId, input.projectId),
                attendanceCheckInDateRangeFilter(businessDateText)
              )
            )
            .limit(1);
          if (concurrent)
            return {
              success: true,
              duplicate: true,
              punchType: "in" as const,
              id: concurrent.id,
              checkedInAt: concurrent.checkedInAt,
              businessDate: businessDateText,
              status: concurrent.status,
            };
          console.error("[Attendance] 上班打卡事务保存失败", {
            projectId: input.projectId,
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "打卡保存失败，请稍后重试",
          });
        }
      }),

    /** 按授权项目范围核验登录人员上下班打卡；设备标识仅显示匿名标签，不返回原始指纹。 */
    listCheckIns: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive().optional(),
          businessDate: z.string().date().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        const db = await getDb();
        if (!db) return [];
        const businessDateText =
          input.businessDate ?? getChinaBusinessDate(new Date());
        let scopedProjectIds: number[] | null = null;
        if (input.projectId) {
          await assertProjectInCurrentScope(ctx, input.projectId);
          scopedProjectIds = [input.projectId];
        } else {
          const scope = await getCurrentDataScope(ctx);
          if (!scope.hasAllProjects) {
            const projectRows = await db
              .select({
                id: projects.id,
                organizationId: projects.organizationId,
              })
              .from(projects);
            scopedProjectIds = projectRows
              .filter(
                project =>
                  scope.projectIds.includes(project.id) ||
                  (project.organizationId !== null &&
                    scope.organizationIds.includes(project.organizationId))
              )
              .map(project => project.id);
            if (!scopedProjectIds.length) return [];
          }
        }
        const filters = [attendanceCheckInDateRangeFilter(businessDateText)];
        if (scopedProjectIds)
          filters.push(inArray(attendanceCheckIns.projectId, scopedProjectIds));
        return db
          .select({
            id: attendanceCheckIns.id,
            userId: attendanceCheckIns.userId,
            userName: users.name,
            projectId: attendanceCheckIns.projectId,
            projectName: projects.name,
            businessDate: attendanceCheckIns.businessDate,
            checkedInAt: attendanceCheckIns.checkedInAt,
            checkedOutAt: attendanceCheckIns.checkedOutAt,
            deviceLabel: attendanceCheckIns.deviceLabel,
            checkInAddress: attendanceCheckIns.checkInAddress,
            locationAccuracyMeters: attendanceCheckIns.locationAccuracyMeters,
            status: attendanceCheckIns.status,
            checkoutAddress: attendanceCheckIns.checkoutAddress,
            checkoutLocationAccuracyMeters:
              attendanceCheckIns.checkoutLocationAccuracyMeters,
            checkoutStatus: attendanceCheckIns.checkoutStatus,
          })
          .from(attendanceCheckIns)
          .innerJoin(users, eq(attendanceCheckIns.userId, users.id))
          .innerJoin(projects, eq(attendanceCheckIns.projectId, projects.id))
          .where(and(...filters))
          .orderBy(desc(attendanceCheckIns.checkedInAt));
      }),

    /** 原始坐标只用于考勤争议核验；请求人须为项目/劳资负责人并说明用途，读取行为写入敏感访问日志。 */
    getDisputeCoordinates: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          id: z.number().int().positive(),
          purpose: z
            .string()
            .trim()
            .min(10, "请说明争议核验用途，至少 10 个字符")
            .max(300),
        })
      )
      .query(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (
          !roleCodes.includes("ALL") &&
          !roleCodes.some(role =>
            ["LABOR_MANAGER", "PROJECT_MANAGER"].includes(role)
          )
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "仅项目负责人或劳资负责人可发起定位争议核验",
          });
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const [record] = await db
          .select({
            id: attendanceCheckIns.id,
            projectId: attendanceCheckIns.projectId,
            longitude: attendanceCheckIns.longitude,
            latitude: attendanceCheckIns.latitude,
            checkoutLongitude: attendanceCheckIns.checkoutLongitude,
            checkoutLatitude: attendanceCheckIns.checkoutLatitude,
          })
          .from(attendanceCheckIns)
          .where(eq(attendanceCheckIns.id, input.id))
          .limit(1);
        if (!record || record.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到当前项目考勤打卡记录",
          });
        await recordSensitiveDataAccess(db, {
          userId: user.id,
          projectId: input.projectId,
          module: "labor",
          dataCategory: "raw_location_coordinate",
          accessPurpose: input.purpose,
          targetType: "attendance_check_in",
          targetId: String(input.id),
          recordCount: 1,
          result: "reviewed",
        });
        return {
          checkIn:
            record.latitude !== null && record.longitude !== null
              ? { latitude: record.latitude, longitude: record.longitude }
              : null,
          checkOut:
            record.checkoutLatitude !== null &&
            record.checkoutLongitude !== null
              ? {
                  latitude: record.checkoutLatitude,
                  longitude: record.checkoutLongitude,
                }
              : null,
        };
      }),

    /** 按项目和日期范围查询考勤台账，并携带实名人员姓名以便移动端展示。 */
    list: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          startDate: z.string().date().optional(),
          endDate: z.string().date().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        if (
          input.startDate &&
          input.endDate &&
          input.endDate < input.startDate
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "结束日期不得早于开始日期",
          });
        }
        const db = await getDb();
        if (!db) return [];
        const startDate = input.startDate
          ? toBusinessDate(input.startDate)
          : undefined;
        const endDate = input.endDate
          ? toBusinessDate(input.endDate)
          : undefined;
        const filter =
          input.startDate && input.endDate
            ? and(
                eq(attendanceRecords.projectId, input.projectId),
                gte(attendanceRecords.attendanceDate, startDate!),
                lte(attendanceRecords.attendanceDate, endDate!)
              )
            : input.startDate
              ? and(
                  eq(attendanceRecords.projectId, input.projectId),
                  gte(attendanceRecords.attendanceDate, startDate!)
                )
              : input.endDate
                ? and(
                    eq(attendanceRecords.projectId, input.projectId),
                    lte(attendanceRecords.attendanceDate, endDate!)
                  )
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
          .innerJoin(
            laborWorkers,
            eq(attendanceRecords.workerId, laborWorkers.id)
          )
          .where(filter)
          .orderBy(
            desc(attendanceRecords.attendanceDate),
            laborWorkers.realName
          );
      }),

    /** 按“人员 + 日期”幂等保存考勤，锁定后的记录不可覆盖。 */
    save: protectedProcedure
      .input(attendanceInput)
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertLaborBusinessAccess(ctx);
        const { db, worker } = await getScopedWorker(
          ctx,
          input.workerId,
          input.projectId
        );
        assertAttendanceWorkHours(input.workHours, input.overtimeHours);
        const attendanceDate = toBusinessDate(input.attendanceDate);
        const existingRows = await db
          .select({
            id: attendanceRecords.id,
            status: attendanceRecords.status,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.workerId, input.workerId),
              eq(attendanceRecords.attendanceDate, attendanceDate)
            )
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing?.status === "locked") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该考勤记录已锁定，不能再编辑",
          });
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
          await db
            .update(attendanceRecords)
            .set(values)
            .where(eq(attendanceRecords.id, existing.id));
        } else {
          await db.insert(attendanceRecords).values(values);
        }
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: existing ? "update_attendance" : "create_attendance",
          targetType: "attendance_record",
          targetId: String(
            existing?.id ?? `${input.workerId}-${input.attendanceDate}`
          ),
          summary: `${input.attendanceDate} 考勤${existing ? "更新" : "录入"}：${input.workHours} 小时，加班 ${input.overtimeHours} 小时`,
        });
        return { success: true, id: existing?.id ?? null };
      }),
  }),

  dailyWage: router({
    list: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          settlementDate: z.string().date().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db) return [];
        const filter = input.settlementDate
          ? and(
              eq(temporaryDailyWageSettlements.projectId, input.projectId),
              eq(
                temporaryDailyWageSettlements.settlementDate,
                toBusinessDate(input.settlementDate)
              )
            )
          : eq(temporaryDailyWageSettlements.projectId, input.projectId);
        return db
          .select({
            id: temporaryDailyWageSettlements.id,
            workerId: temporaryDailyWageSettlements.workerId,
            workerName: laborWorkers.realName,
            teamName: laborWorkers.teamName,
            settlementDate: temporaryDailyWageSettlements.settlementDate,
            payableAmount: temporaryDailyWageSettlements.payableAmount,
            deductionAmount: temporaryDailyWageSettlements.deductionAmount,
            actualAmount: temporaryDailyWageSettlements.actualAmount,
            status: temporaryDailyWageSettlements.status,
            reviewedAt: temporaryDailyWageSettlements.reviewedAt,
            paidAt: temporaryDailyWageSettlements.paidAt,
            remarks: temporaryDailyWageSettlements.remarks,
          })
          .from(temporaryDailyWageSettlements)
          .innerJoin(
            laborWorkers,
            eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)
          )
          .where(filter)
          .orderBy(
            desc(temporaryDailyWageSettlements.settlementDate),
            laborWorkers.realName
          );
      }),
    save: protectedProcedure
      .input(dailyWageSaveInput)
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (
          !roleCodes.includes("ALL") &&
          !roleCodes.includes("LABOR_MANAGER") &&
          !roleCodes.includes("PROJECT_MANAGER")
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "临时日结录入仅限劳资负责人或项目经理",
          });
        const { db, worker } = await getScopedWorker(
          ctx,
          input.workerId,
          input.projectId
        );
        if (worker.workerCategory !== "temporary_daily")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "仅临时日结人员可创建日结记录",
          });
        return db.transaction(async db => {
          await assertCompensationChannel(db, {
            workerId: input.workerId,
            projectId: input.projectId,
            period: input.settlementDate.slice(0, 7),
            channel: "daily",
            settlementDate: input.settlementDate,
            lock: true,
          });
          const money = calculatePayrollAmounts(input);
          const existing = (
            await db
              .select()
              .from(temporaryDailyWageSettlements)
              .where(
                and(
                  eq(temporaryDailyWageSettlements.workerId, input.workerId),
                  eq(
                    temporaryDailyWageSettlements.settlementDate,
                    toBusinessDate(input.settlementDate)
                  )
                )
              )
              .limit(1)
          )[0];
          if (existing && existing.status !== "draft")
            throw new TRPCError({
              code: "CONFLICT",
              message: "已提交、已审核或已付款日结须按流程处理，不能直接修改",
            });
          const values = {
            workerId: input.workerId,
            projectId: input.projectId,
            settlementDate: toBusinessDate(input.settlementDate),
            payableAmount: String(money.payableAmount),
            deductionAmount: String(money.deductionAmount),
            actualAmount: String(money.actualAmount),
            remarks: input.remarks ?? null,
            status: "draft" as const,
            submittedBy: null,
            submittedAt: null,
            reviewedBy: null,
            reviewedAt: null,
            paidBy: null,
            paidAt: null,
            paymentReference: null,
          };
          if (existing)
            await db
              .update(temporaryDailyWageSettlements)
              .set(values)
              .where(eq(temporaryDailyWageSettlements.id, existing.id));
          else await db.insert(temporaryDailyWageSettlements).values(values);
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: existing ? "update_daily_wage" : "create_daily_wage",
            targetType: "temporary_daily_wage",
            targetId: String(
              existing?.id ?? `${input.workerId}-${input.settlementDate}`
            ),
            summary: `${input.settlementDate} 临时日结${existing ? "更新" : "录入"}`,
          });
          return { success: true, actualAmount: money.actualAmount };
        });
      }),
    submit: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (
          !roleCodes.includes("ALL") &&
          !roleCodes.includes("LABOR_MANAGER") &&
          !roleCodes.includes("PROJECT_MANAGER")
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "临时日结提交仅限劳资负责人或项目经理",
          });
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const settlement = (
          await db
            .select()
            .from(temporaryDailyWageSettlements)
            .where(eq(temporaryDailyWageSettlements.id, input.id))
            .limit(1)
        )[0];
        if (!settlement)
          throw new TRPCError({ code: "NOT_FOUND", message: "临时日结不存在" });
        await assertProjectInCurrentScope(ctx, settlement.projectId);
        if (settlement.status !== "draft")
          throw new TRPCError({
            code: "CONFLICT",
            message: "仅草稿可提交审核",
          });
        await db
          .update(temporaryDailyWageSettlements)
          .set({
            status: "reviewing",
            submittedBy: user.id,
            submittedAt: new Date(),
            reviewedBy: null,
            reviewedAt: null,
          })
          .where(
            and(
              eq(temporaryDailyWageSettlements.id, settlement.id),
              eq(temporaryDailyWageSettlements.status, "draft")
            )
          );
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "submit_daily_wage",
          targetType: "temporary_daily_wage",
          targetId: String(settlement.id),
          summary: `${settlement.settlementDate} 临时日结提交审核`,
        });
        return { success: true };
      }),
    review: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          decision: z.enum(["approved", "returned"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (
          !roleCodes.includes("ALL") &&
          !roleCodes.includes("ACCOUNTANT") &&
          !roleCodes.includes("FINANCE_MANAGER")
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "临时日结审核仅限会计或财务负责人",
          });
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const settlement = (
          await db
            .select()
            .from(temporaryDailyWageSettlements)
            .where(eq(temporaryDailyWageSettlements.id, input.id))
            .limit(1)
        )[0];
        if (!settlement)
          throw new TRPCError({ code: "NOT_FOUND", message: "临时日结不存在" });
        await assertProjectInCurrentScope(ctx, settlement.projectId);
        if (settlement.status !== "reviewing")
          throw new TRPCError({
            code: "CONFLICT",
            message: "仅审核中的临时日结可以办理审核",
          });
        const approved = input.decision === "approved";
        await db
          .update(temporaryDailyWageSettlements)
          .set({
            status: approved ? "approved" : "draft",
            reviewedBy: user.id,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(temporaryDailyWageSettlements.id, settlement.id),
              eq(temporaryDailyWageSettlements.status, "reviewing")
            )
          );
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: approved ? "approve_daily_wage" : "return_daily_wage",
          targetType: "temporary_daily_wage",
          targetId: String(settlement.id),
          summary: `${settlement.settlementDate} 临时日结${approved ? "审核通过" : "退回草稿"}`,
        });
        return {
          success: true,
          status: approved ? ("approved" as const) : ("draft" as const),
        };
      }),
    /** @deprecated 实际付款必须走 settlementPayment.record，确保每笔均有关联凭证和余额校验。 */
    pay: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          paidAt: z.coerce.date(),
          paymentReference: z.string().trim().max(64).optional().nullable(),
        })
      )
      .mutation(async ({ ctx }) => {
        requireAuthenticatedUser(ctx);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "临时日结实际付款已统一至PC财务台账，请上传本次付款凭证后分笔登记",
        });
      }),
    /** 普通工资报表返回开户行与完整卡号，按人员分类供 PC 后台生成多工作表 Excel。 */
    exportWorkbookData: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          period: payrollPeriodSchema.optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const payrollFilter = input.period
          ? and(
              eq(payrollStatements.projectId, input.projectId),
              eq(payrollStatements.period, input.period)
            )
          : eq(payrollStatements.projectId, input.projectId);
        const payrollRows = await db
          .select({
            workerName: laborWorkers.realName,
            workerCategory: laborWorkers.workerCategory,
            teamName: laborWorkers.teamName,
            bankName: laborWorkers.bankName,
            bankAccountEncrypted: laborWorkers.bankAccountEncrypted,
            period: payrollStatements.period,
            payableAmount: payrollStatements.payableAmount,
            deductionAmount: payrollStatements.deductionAmount,
            actualAmount: payrollStatements.actualAmount,
            status: payrollStatements.status,
            paidAt: payrollStatements.paidAt,
          })
          .from(payrollStatements)
          .innerJoin(
            laborWorkers,
            eq(payrollStatements.workerId, laborWorkers.id)
          )
          .where(payrollFilter)
          .orderBy(
            desc(payrollStatements.period),
            laborWorkers.workerCategory,
            laborWorkers.teamName,
            laborWorkers.realName
          );
        const dailyRows = await db
          .select({
            workerName: laborWorkers.realName,
            workerCategory: laborWorkers.workerCategory,
            teamName: laborWorkers.teamName,
            bankName: laborWorkers.bankName,
            bankAccountMasked: laborWorkers.bankAccountEncrypted,
            settlementDate: temporaryDailyWageSettlements.settlementDate,
            payableAmount: temporaryDailyWageSettlements.payableAmount,
            deductionAmount: temporaryDailyWageSettlements.deductionAmount,
            actualAmount: temporaryDailyWageSettlements.actualAmount,
            status: temporaryDailyWageSettlements.status,
            paidAt: temporaryDailyWageSettlements.paidAt,
          })
          .from(temporaryDailyWageSettlements)
          .innerJoin(
            laborWorkers,
            eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)
          )
          .where(eq(temporaryDailyWageSettlements.projectId, input.projectId))
          .orderBy(
            desc(temporaryDailyWageSettlements.settlementDate),
            laborWorkers.realName
          );
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "export_payroll_workbook_data",
          targetType: "labor_project",
          targetId: String(input.projectId),
          summary: `导出普通工资分类报表数据：${input.period ?? "全部期间"}；工资条 ${payrollRows.length} 条，临时日结 ${dailyRows.length} 条`,
        });
        return {
          roleCodes,
          payrollRows: payrollRows.map(row => ({
            ...row,
            bankAccountMasked: getBusinessEncryptedValue(
              row.bankAccountEncrypted
            ),
            bankAccountEncrypted: undefined,
          })),
          dailyRows: dailyRows.map(row => ({
            ...row,
            bankAccountMasked: getBusinessEncryptedValue(row.bankAccountMasked),
          })),
        };
      }),
    /** 付款专用清单仅向会计、财务负责人、项目经理和系统级角色返回完整银行卡，查询即写入导出审计。 */
    exportPaymentList: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          period: payrollPeriodSchema.optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (
          !roleCodes.includes("ALL") &&
          !roleCodes.some(role =>
            ["ACCOUNTANT", "FINANCE_MANAGER", "PROJECT_MANAGER"].includes(role)
          )
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "付款专用清单仅限会计、财务负责人、项目经理或超级管理员生成",
          });
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const payrollFilter = input.period
          ? and(
              eq(payrollStatements.projectId, input.projectId),
              eq(payrollStatements.period, input.period)
            )
          : eq(payrollStatements.projectId, input.projectId);
        const payrollRows = await db
          .select({
            sourceType: payrollStatements.id,
            workerName: laborWorkers.realName,
            workerCategory: laborWorkers.workerCategory,
            teamName: laborWorkers.teamName,
            bankName: laborWorkers.bankName,
            bankAccountEncrypted: laborWorkers.bankAccountEncrypted,
            period: payrollStatements.period,
            settlementDate: payrollStatements.period,
            actualAmount: payrollStatements.actualAmount,
            status: payrollStatements.status,
            paidAt: payrollStatements.paidAt,
          })
          .from(payrollStatements)
          .innerJoin(
            laborWorkers,
            eq(payrollStatements.workerId, laborWorkers.id)
          )
          .where(payrollFilter)
          .orderBy(desc(payrollStatements.period), laborWorkers.realName);
        const dailyRows = await db
          .select({
            sourceType: temporaryDailyWageSettlements.id,
            workerName: laborWorkers.realName,
            workerCategory: laborWorkers.workerCategory,
            teamName: laborWorkers.teamName,
            bankName: laborWorkers.bankName,
            bankAccountEncrypted: laborWorkers.bankAccountEncrypted,
            settlementDate: temporaryDailyWageSettlements.settlementDate,
            actualAmount: temporaryDailyWageSettlements.actualAmount,
            status: temporaryDailyWageSettlements.status,
            paidAt: temporaryDailyWageSettlements.paidAt,
          })
          .from(temporaryDailyWageSettlements)
          .innerJoin(
            laborWorkers,
            eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)
          )
          .where(eq(temporaryDailyWageSettlements.projectId, input.projectId))
          .orderBy(
            desc(temporaryDailyWageSettlements.settlementDate),
            laborWorkers.realName
          );
        const mapPaymentRow = (row: {
          sourceType: number;
          workerName: string;
          workerCategory: string;
          teamName: string | null;
          bankName: string | null;
          bankAccountEncrypted: string | null;
          settlementDate: Date | string;
          actualAmount: string | number;
          status: string;
          paidAt: Date | string | null;
        }) => ({
          ...row,
          bankAccount: row.bankAccountEncrypted
            ? decryptSecret(row.bankAccountEncrypted)
            : null,
        });
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "export_payment_list",
          targetType: "labor_project",
          targetId: String(input.projectId),
          summary: `生成付款专用清单：${input.period ?? "全部期间"}；工资条 ${payrollRows.length} 条，临时日结 ${dailyRows.length} 条；含完整银行卡`,
        });
        return {
          payrollRows: payrollRows.map(mapPaymentRow),
          dailyRows: dailyRows.map(mapPaymentRow),
          generatedAt: new Date(),
        };
      }),
  }),

  payroll: router({
    /** 按项目和工资期间查询工资条，银行卡按授权展示完整值。 */
    list: protectedProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          period: payrollPeriodSchema.optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const roleCodes = await assertLaborBusinessAccess(ctx);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const db = await getDb();
        if (!db) return [];
        const filter = input.period
          ? and(
              eq(payrollStatements.projectId, input.projectId),
              eq(payrollStatements.period, input.period)
            )
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
            bankAccountEncrypted: laborWorkers.bankAccountEncrypted,
            status: payrollStatements.status,
            accountantId: payrollStatements.accountantId,
            paidAt: payrollStatements.paidAt,
            paymentReference: payrollStatements.paymentReference,
            createdAt: payrollStatements.createdAt,
            updatedAt: payrollStatements.updatedAt,
          })
          .from(payrollStatements)
          .innerJoin(
            laborWorkers,
            eq(payrollStatements.workerId, laborWorkers.id)
          )
          .where(filter)
          .orderBy(desc(payrollStatements.period), laborWorkers.realName);
        const mayViewPaymentReference =
          canViewPayrollPaymentReference(roleCodes);
        return rows.map(row => ({
          ...row,
          bankAccountMasked: getBusinessEncryptedValue(
            row.bankAccountEncrypted
          ),
          bankAccountEncrypted: undefined,
          paymentReference: mayViewPaymentReference
            ? row.paymentReference
            : null,
        }));
      }),

    /** 保存工资草稿；服务端通过应发减扣款计算实发金额并读取完整银行卡号。 */
    save: protectedProcedure
      .input(payrollSaveInput)
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertLaborBusinessAccess(ctx);
        const { db, worker } = await getScopedWorker(
          ctx,
          input.workerId,
          input.projectId
        );
        return db.transaction(async db => {
          await assertCompensationChannel(db, {
            workerId: input.workerId,
            projectId: input.projectId,
            period: input.period,
            channel: "monthly",
            lock: true,
          });
          const money = calculatePayrollAmounts({
            payableAmount: input.payableAmount,
            deductionAmount: input.deductionAmount,
          });
          const bankAccountMasked = getBusinessEncryptedValue(
            worker.bankAccountEncrypted
          );
          const existingRows = await db
            .select()
            .from(payrollStatements)
            .where(
              and(
                eq(payrollStatements.workerId, input.workerId),
                eq(payrollStatements.projectId, input.projectId),
                eq(payrollStatements.period, input.period)
              )
            )
            .limit(1);
          const existing = existingRows[0];
          if (existing && existing.status !== "draft") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "已审核、已支付或已作废的工资条不可直接修改",
            });
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
            const updateResult = await db
              .update(payrollStatements)
              .set(values)
              .where(
                and(
                  eq(payrollStatements.id, existing.id),
                  eq(payrollStatements.status, existing.status)
                )
              );
            assertConditionalPayrollWrite(updateResult);
          } else {
            await db.insert(payrollStatements).values(values);
          }
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: existing ? "update_payroll" : "create_payroll",
            targetType: "payroll_statement",
            targetId: String(
              existing?.id ?? `${input.workerId}-${input.period}`
            ),
            summary: `${input.period} 工资条${existing ? "更新" : "创建"}：应发 ${money.payableAmount} 元，实发 ${money.actualAmount} 元`,
          });
          return {
            success: true,
            id: existing?.id ?? null,
            actualAmount: money.actualAmount,
          };
        });
      }),

    /** 将工资草稿提交至会计审核队列，提交后仍可被会计退回草稿修订。 */
    submit: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        await assertLaborBusinessAccess(ctx);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const rows = await db
          .select()
          .from(payrollStatements)
          .where(eq(payrollStatements.id, input.id))
          .limit(1);
        const payroll = rows[0];
        if (!payroll)
          throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        try {
          assertPayrollStatusTransition(payroll.status, "reviewing");
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message: "仅工资草稿可以提交会计审核",
          });
        }
        const updateResult = await db
          .update(payrollStatements)
          .set({
            status: "reviewing",
            submittedBy: user.id,
            submittedAt: new Date(),
            accountantId: null,
            reviewedAt: null,
          })
          .where(
            and(
              eq(payrollStatements.id, payroll.id),
              eq(payrollStatements.status, payroll.status)
            )
          );
        assertConditionalPayrollWrite(updateResult);
        const periodStart = toBusinessDate(`${payroll.period}-01`);
        const [year, month] = payroll.period.split("-").map(Number);
        const periodEndExclusive = new Date(Date.UTC(year, month, 1));
        // 草稿期间允许劳资核对并修订考勤；一经提交审核，纳入本工资条的已确认考勤即锁定，
        // 防止审批与付款阶段的应发金额被事后悄然改变。
        await db
          .update(attendanceRecords)
          .set({ status: "locked" })
          .where(
            and(
              eq(attendanceRecords.workerId, payroll.workerId),
              eq(attendanceRecords.projectId, payroll.projectId),
              eq(attendanceRecords.status, "confirmed"),
              gte(attendanceRecords.attendanceDate, periodStart),
              lt(attendanceRecords.attendanceDate, periodEndExclusive)
            )
          );
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "submit_payroll",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          summary: `${payroll.period} 工资条提交会计审核`,
        });
        try {
          const messageResult = await createInAppMessage({
            eventCode: "PAYROLL_SUBMITTED",
            idempotencyKey: `payroll-submitted:${payroll.id}`,
            recipientUserId: user.id,
            title: "工资条已提交会计审核",
            content: `${payroll.period} 工资条已提交会计审核，后续处理结果会在此通知。`,
            deepLink: "/mobile/labor",
          });
          if (
            !messageResult.created &&
            messageResult.reason === "database_unavailable"
          ) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_unavailable",
              targetType: "payroll_statement",
              targetId: String(payroll.id),
              summary: "工资提交站内消息未能写入：数据库暂不可用",
            });
          }
        } catch (error) {
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: "notification_failed",
            targetType: "payroll_statement",
            targetId: String(payroll.id),
            summary: `工资提交站内消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
          });
        }
        // 公众号只投递通用业务节点摘要，不携带姓名、金额、银行卡等工资敏感信息。
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          module: "labor",
          eventCode: "payroll_submitted",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          title: "工资条已提交会计审核",
          content: "一份工资条已提交会计审核，请进入系统办理。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
        return { success: true };
      }),

    /** 会计专属审核入口；可批准或退回工资草稿，且必须在服务端复核角色与项目范围。 */
    approve: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          decision: z.enum(["approved", "returned"]).default("approved"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (!canApprovePayroll(roleCodes)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "工资审核仅限会计岗位办理",
          });
        }
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const rows = await db
          .select()
          .from(payrollStatements)
          .where(eq(payrollStatements.id, input.id))
          .limit(1);
        const payroll = rows[0];
        if (!payroll)
          throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        const isApproved = input.decision === "approved";
        try {
          assertPayrollStatusTransition(
            payroll.status,
            isApproved ? "approved" : "draft"
          );
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message: "仅审核中的工资条可以办理会计审核",
          });
        }
        const reviewedAt = new Date();
        const updateResult = await db
          .update(payrollStatements)
          .set({
            status: isApproved ? "approved" : "draft",
            accountantId: user.id,
            reviewedAt,
          })
          .where(
            and(
              eq(payrollStatements.id, payroll.id),
              eq(payrollStatements.status, payroll.status)
            )
          );
        assertConditionalPayrollWrite(updateResult);
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: isApproved ? "approve_payroll" : "return_payroll",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          summary: `${payroll.period} 工资条已${isApproved ? "审核通过" : "退回草稿"}`,
        });
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
            if (
              !messageResult.created &&
              messageResult.reason === "database_unavailable"
            ) {
              await db.insert(auditLogs).values({
                userId: user.id,
                module: "labor",
                action: "notification_unavailable",
                targetType: "payroll_statement",
                targetId: String(payroll.id),
                summary: "工资审核结论未能写入站内消息：数据库暂不可用",
              });
            }
          } catch (error) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_failed",
              targetType: "payroll_statement",
              targetId: String(payroll.id),
              summary: `工资审核结论消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
            });
          }
        }
        // 公众号通知仅表述流程结论，详细工资信息必须在受权限保护的系统内查看。
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          recipientUserIds: payroll.submittedBy
            ? [payroll.submittedBy]
            : undefined,
          module: "labor",
          eventCode: isApproved ? "payroll_approved" : "payroll_returned",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          title: isApproved ? "工资条已完成会计审核" : "工资条已退回修订",
          content: "工资条审核状态已更新，请进入系统查看受控处理记录。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
        return { success: true, status: isApproved ? "approved" : "draft" };
      }),

    /** @deprecated 兼容接口已封存，实际发放必须关联独立付款凭证。 */
    pay: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          paymentReference: z
            .string()
            .trim()
            .min(4, "请填写付款凭证号或资金流水号")
            .max(64),
        })
      )
      .mutation(async ({ ctx }) => {
        requireAuthenticatedUser(ctx);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "工资实际发放已统一至PC财务台账，请上传本次付款凭证后分笔登记",
        });
      }),

    /** 工资条可在支付前由会计或财务负责人作废，原因只保存于受控审计和站内业务记录。 */
    void: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z
            .string()
            .trim()
            .min(1, "请填写作废原因")
            .max(500, "作废原因不得超过 500 个字符"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = requireAuthenticatedUser(ctx);
        const roleCodes = await assertLaborBusinessAccess(ctx);
        if (!canVoidPayroll(roleCodes)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "工资条作废仅限会计或财务负责人办理",
          });
        }
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "数据库连接暂不可用",
          });
        const rows = await db
          .select()
          .from(payrollStatements)
          .where(eq(payrollStatements.id, input.id))
          .limit(1);
        const payroll = rows[0];
        if (!payroll)
          throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在" });
        await assertProjectInCurrentScope(ctx, payroll.projectId);
        try {
          assertPayrollStatusTransition(payroll.status, "void");
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message: "已发放或已作废的工资条不可作废",
          });
        }
        const voidedAt = new Date();
        const updateResult = await db
          .update(payrollStatements)
          .set({ status: "void" })
          .where(
            and(
              eq(payrollStatements.id, payroll.id),
              eq(payrollStatements.status, payroll.status)
            )
          );
        assertConditionalPayrollWrite(updateResult);
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "labor",
          action: "void_payroll",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          summary: `${payroll.period} 工资条已作废，原因：${input.reason}`,
        });
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
          if (
            !messageResult.created &&
            messageResult.reason === "database_unavailable"
          ) {
            await db.insert(auditLogs).values({
              userId: user.id,
              module: "labor",
              action: "notification_unavailable",
              targetType: "payroll_statement",
              targetId: String(payroll.id),
              summary: "工资作废结论未能写入站内消息：数据库暂不可用",
            });
          }
        } catch (error) {
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "labor",
            action: "notification_failed",
            targetType: "payroll_statement",
            targetId: String(payroll.id),
            summary: `工资作废结论消息写入失败：${error instanceof Error ? error.message.slice(0, 180) : "未知错误"}`,
          });
        }
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          recipientUserIds: [recipientUserId],
          module: "labor",
          eventCode: "payroll_voided",
          targetType: "payroll_statement",
          targetId: String(payroll.id),
          title: "工资条已作废",
          content: "一份工资条已作废，请进入系统查看受控处理记录。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
        return { success: true, status: "void" as const };
      }),
  }),

  /** 汇总项目指定工资期间内的考勤与工资口径，供移动端统计卡片和打印视图复用。 */
  summary: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        period: payrollPeriodSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertLaborBusinessAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) {
        return {
          totalWorkers: 0,
          activeWorkers: 0,
          attendanceDays: 0,
          workHours: 0,
          overtimeHours: 0,
          payableAmount: 0,
          deductionAmount: 0,
          actualAmount: 0,
          awaitingReviewCount: 0,
          awaitingReviewAmount: 0,
          approvedCount: 0,
        };
      }
      const range = getPeriodRange(input.period);
      const [workers, attendance, payrolls] = await Promise.all([
        db
          .select({
            id: laborWorkers.id,
            attendanceStatus: laborWorkers.attendanceStatus,
          })
          .from(laborWorkers)
          .where(eq(laborWorkers.projectId, input.projectId)),
        db
          .select({
            workHours: attendanceRecords.workHours,
            overtimeHours: attendanceRecords.overtimeHours,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.projectId, input.projectId),
              gte(attendanceRecords.attendanceDate, range.start),
              lt(attendanceRecords.attendanceDate, range.endExclusive)
            )
          ),
        db
          .select({
            payableAmount: payrollStatements.payableAmount,
            deductionAmount: payrollStatements.deductionAmount,
            actualAmount: payrollStatements.actualAmount,
            status: payrollStatements.status,
          })
          .from(payrollStatements)
          .where(
            and(
              eq(payrollStatements.projectId, input.projectId),
              eq(payrollStatements.period, input.period)
            )
          ),
      ]);
      const payrollSummary = summarizePayrollStatements(payrolls);
      return {
        totalWorkers: workers.length,
        activeWorkers: workers.filter(
          worker => worker.attendanceStatus === "active"
        ).length,
        attendanceDays: attendance.length,
        workHours: roundMoney(
          attendance.reduce((sum, item) => sum + Number(item.workHours), 0)
        ),
        overtimeHours: roundMoney(
          attendance.reduce((sum, item) => sum + Number(item.overtimeHours), 0)
        ),
        ...payrollSummary,
      };
    }),
});
