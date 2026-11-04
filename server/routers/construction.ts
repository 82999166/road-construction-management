import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  constructionDailyReports,
  evidenceRecords,
  projects,
  systemRoles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import {
  assertConstructionDailyReportStatusTransition,
  ConstructionDomainError,
  getBusinessStatusLabel,
} from "../../shared/domain";
import {
  assertDepartmentBusinessAccess,
  assertExistingBusinessRecordChangeAccess,
  assertProjectInCurrentScope,
  type BusinessOperationAction,
  getCurrentDataScope,
  getEffectiveRoleCodes,
  requireAuthenticatedUser,
} from "../access";
import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { isSupervisorReviewAutoApprove } from "../services/supervisorReview";
import { createInAppMessage } from "./messages";
import { constructionOutputBatches } from "../../shared/constructionWorkspace";
import { getSuperAdminAccess } from "../access";

const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");
const reportStatusSchema = z.enum([
  "draft",
  "submitted",
  "approved",
  "rejected",
  "locked",
]);
const constructionReportFilterShape = {
  projectId: z.number().int().positive(),
  dateFrom: businessDateSchema.optional(),
  dateTo: businessDateSchema.optional(),
  createdBy: z.number().int().positive().optional(),
  keyword: z
    .string()
    .trim()
    .min(1, "关键词不能为空")
    .max(100, "关键词不得超过 100 个字符")
    .optional(),
  status: reportStatusSchema.optional(),
  scope: z.enum(["ledger", "review", "issues", "archive"]).default("ledger"),
  issueScope: z
    .enum(["all", "recorded", "quality", "safety", "unreplied", "replied"])
    .default("all"),
};
const constructionReportFilterInput = z
  .object(constructionReportFilterShape)
  .superRefine(validateFilterDates);
function validateFilterDates(
  value: { dateFrom?: string; dateTo?: string },
  context: z.RefinementCtx
) {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: "custom",
      message: "开始日期不能晚于结束日期",
      path: ["dateTo"],
    });
  }
}
type ConstructionReportFilter = z.infer<typeof constructionReportFilterInput>;
const outputInput = z
  .object({
    ...constructionReportFilterShape,
    reportIds: z.array(z.number().int().positive()).min(1).max(250).optional(),
  })
  .superRefine((value, context) => {
    validateFilterDates(value, context);
    if (
      value.reportIds &&
      new Set(value.reportIds).size !== value.reportIds.length
    )
      context.addIssue({
        code: "custom",
        path: ["reportIds"],
        message: "输出批次不能包含重复日报",
      });
  });

async function readOutputReports(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof outputInput>,
  action: "print" | "export"
) {
  await assertConstructionAccess(ctx, action);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const predicates = getConstructionReportPredicates(input);
  if (input.reportIds)
    predicates.push(inArray(constructionDailyReports.id, input.reportIds));
  const rows = await db
    .select(constructionReportProjection)
    .from(constructionDailyReports)
    .leftJoin(users, eq(constructionDailyReports.createdBy, users.id))
    .where(and(...predicates))
    .orderBy(
      desc(constructionDailyReports.reportDate),
      desc(constructionDailyReports.id)
    )
    .limit(251);
  if (rows.length > 250)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "当前筛选结果超过 250 份日报，请使用输出清单逐批打印或导出，或缩小筛选范围",
    });
  if (
    input.reportIds &&
    (rows.length !== input.reportIds.length ||
      rows.some(row => !input.reportIds!.includes(row.id)))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "输出清单中的日报已变化或不再符合当前筛选，请刷新输出清单后重试；未生成不完整批次",
    });
  }
  return withSubmitterDisplayName(rows);
}

/** 施工日报输入只接收现场业务说明和完成比例，不接收任何认证、资金或个人敏感字段。 */
const dailyReportInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  reportDate: businessDateSchema,
  workArea: z.string().trim().min(2, "请填写施工部位或作业面").max(200),
  weather: z.enum(["sunny", "cloudy", "rainy", "snowy", "windy", "other"]),
  workContent: z.string().trim().min(4, "请填写当日施工内容").max(8000),
  safetyNotes: z.string().trim().max(1000).nullable().optional(),
  issueNotes: z.string().trim().max(1000).nullable().optional(),
  progressPercent: z
    .number()
    .min(0, "累计完成比例不能小于 0")
    .max(100, "累计完成比例不能超过 100"),
});

function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** MySQL LIKE 中将通配字符视为普通文字，避免关键词改变检索范围。 */
function escapeLikeKeyword(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function getConstructionReportPredicates(input: ConstructionReportFilter) {
  const predicates = [eq(constructionDailyReports.projectId, input.projectId)];
  if (input.dateFrom)
    predicates.push(
      gte(constructionDailyReports.reportDate, toBusinessDate(input.dateFrom))
    );
  if (input.dateTo)
    predicates.push(
      lte(constructionDailyReports.reportDate, toBusinessDate(input.dateTo))
    );
  if (input.status)
    predicates.push(eq(constructionDailyReports.status, input.status));
  if (input.scope === "review")
    predicates.push(eq(constructionDailyReports.status, "submitted"));
  if (input.scope === "archive")
    predicates.push(eq(constructionDailyReports.status, "locked"));
  // MySQL TRIM只去普通空格，追加空白字符类确保Tab/换行不与JS trim统计口径冲突。
  const quality = sql`(CHAR_LENGTH(TRIM(COALESCE(${constructionDailyReports.issueNotes}, ''))) > 0 AND COALESCE(${constructionDailyReports.issueNotes}, '') REGEXP '[^[:space:]]')`;
  const safety = sql`(CHAR_LENGTH(TRIM(COALESCE(${constructionDailyReports.safetyNotes}, ''))) > 0 AND COALESCE(${constructionDailyReports.safetyNotes}, '') REGEXP '[^[:space:]]')`;
  const hasReply = sql`(CHAR_LENGTH(TRIM(COALESCE(${constructionDailyReports.reviewReply}, ''))) > 0 AND COALESCE(${constructionDailyReports.reviewReply}, '') REGEXP '[^[:space:]]')`;
  // 问题视图表示原日报记录了问题或安全情况，不推断业务已整改/闭环，也不重写历史状态。
  if (input.scope === "issues" || input.issueScope !== "all")
    predicates.push(or(quality, safety)!);
  if (input.issueScope === "quality") predicates.push(quality);
  if (input.issueScope === "safety") predicates.push(safety);
  if (input.issueScope === "unreplied") predicates.push(sql`NOT (${hasReply})`);
  if (input.issueScope === "replied") predicates.push(hasReply);
  if (input.createdBy)
    predicates.push(eq(constructionDailyReports.createdBy, input.createdBy));
  if (input.keyword) {
    const keyword = `%${escapeLikeKeyword(input.keyword)}%`;
    predicates.push(
      or(
        like(constructionDailyReports.workArea, keyword),
        like(constructionDailyReports.workContent, keyword),
        like(constructionDailyReports.safetyNotes, keyword),
        like(constructionDailyReports.issueNotes, keyword),
        like(constructionDailyReports.reviewReply, keyword)
      )!
    );
  }
  return predicates;
}

const constructionReportProjection = {
  id: constructionDailyReports.id,
  projectId: constructionDailyReports.projectId,
  reportDate: constructionDailyReports.reportDate,
  workArea: constructionDailyReports.workArea,
  weather: constructionDailyReports.weather,
  workContent: constructionDailyReports.workContent,
  safetyNotes: constructionDailyReports.safetyNotes,
  issueNotes: constructionDailyReports.issueNotes,
  progressPercent: constructionDailyReports.progressPercent,
  status: constructionDailyReports.status,
  createdBy: constructionDailyReports.createdBy,
  createdByName: users.name,
  reviewReply: constructionDailyReports.reviewReply,
  reviewedBy: constructionDailyReports.reviewedBy,
  reviewedAt: constructionDailyReports.reviewedAt,
  reviewedByName: sql<
    string | null
  >`(SELECT reviewer.name FROM users reviewer WHERE reviewer.id = ${constructionDailyReports.reviewedBy} LIMIT 1)`,
  createdAt: constructionDailyReports.createdAt,
  updatedAt: constructionDailyReports.updatedAt,
};

function withSubmitterDisplayName<
  T extends {
    createdBy: number;
    createdByName: string | null;
    reviewedBy?: number | null;
    reviewedByName?: string | null;
  },
>(rows: T[]) {
  return rows.map(row => ({
    ...row,
    createdByName: row.createdByName?.trim() || `管理员 #${row.createdBy}`,
    reviewedByName:
      row.reviewedByName?.trim() ||
      (row.reviewedBy ? `管理员 #${row.reviewedBy}` : null),
  }));
}

/** 施工现场业务仅面向项目负责人、施工负责人、安全负责人及全局超级管理员。 */
async function assertConstructionAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  action: BusinessOperationAction = "read"
) {
  await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION", action);
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"];
  if (
    !roleCodes.includes("ALL") &&
    !roleCodes.some(role => allowed.includes(role))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位未获施工现场业务授权",
    });
  }
  return roleCodes;
}

/** 返回当前施工模块范围内的项目选项，空范围绝不被解释为全项目权限。 */
async function listConstructionProjects(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  const scope = await getCurrentDataScope(ctx);
  const db = await getDb();
  if (!db) return [];
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
  if (scope.hasAllProjects) return allProjects;
  return allProjects.filter(
    project =>
      scope.projectIds.includes(project.id) ||
      (project.organizationId !== null &&
        scope.organizationIds.includes(project.organizationId))
  );
}

function asBadRequest(error: unknown): never {
  if (error instanceof ConstructionDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/** 仅将公共天气码映射为日报枚举；坐标只用于本次请求，不写入日报或审计记录。 */
function mapCurrentWeather(
  weatherCode: number,
  windSpeed: number
): "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other" {
  if (windSpeed >= 10.8) return "windy";
  if ([0].includes(weatherCode)) return "sunny";
  if ([1, 2, 3].includes(weatherCode)) return "cloudy";
  if (
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)
  )
    return "rainy";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snowy";
  return "other";
}

/**
 * 施工日报的草稿维护和状态流转均以读取时的状态作为写入条件。
 * 若受影响行数为 0，表示另一请求已先行更新，禁止继续写入审计。
 */
function assertConditionalDailyReportWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (
    header &&
    typeof header === "object" &&
    "affectedRows" in header &&
    Number((header as { affectedRows?: unknown }).affectedRows) === 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "施工日报已被其他用户更新，请刷新后重试",
    });
  }
}

/** 仅从当前项目的有效主管角色中解析审核收件人，避免日报提交越权通知到无关项目。 */
async function getProjectReportSupervisorIds(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number,
  excludeUserId: number
) {
  const now = new Date();
  const rows = await db
    .select({ userId: userRoleAssignments.userId })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(
      and(
        eq(userRoleAssignments.projectId, projectId),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        inArray(systemRoles.code, [
          "PROJECT_MANAGER",
          "CONSTRUCTION_MANAGER",
          "SAFETY_MANAGER",
        ]),
        or(
          isNull(userRoleAssignments.validFrom),
          lte(userRoleAssignments.validFrom, now)
        ),
        or(
          isNull(userRoleAssignments.validTo),
          gt(userRoleAssignments.validTo, now)
        )
      )
    );
  return Array.from(
    new Set(
      rows.map(row => row.userId).filter(userId => userId !== excludeUserId)
    )
  );
}

/** 主管通知不回滚日报状态；站内消息和服务号通知均保留独立投递审计。 */
async function notifyReportSupervisors(input: {
  projectId: number;
  reportId: number;
  supervisorIds: number[];
  eventCode: string;
  title: string;
  content: string;
}) {
  await Promise.all(
    input.supervisorIds.map(async supervisorId => {
      await createInAppMessage({
        eventCode: input.eventCode,
        idempotencyKey: `${input.eventCode}:${input.reportId}:${supervisorId}`,
        recipientUserId: supervisorId,
        title: input.title,
        content: input.content,
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
      void notifyOfficialAccountBusinessEventSafely({
        userId: supervisorId,
        projectId: input.projectId,
        module: "construction",
        eventCode: input.eventCode,
        targetType: "construction_daily_report",
        targetId: String(input.reportId),
        title: input.title,
        content: input.content,
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
    })
  );
}

/** 施工日报路由：项目范围、岗位权限、终态锁定及审计均由服务端强制执行。 */
export const constructionRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertConstructionAccess(ctx);
    return listConstructionProjects(ctx);
  }),

  /** 只用于前端收敛按钮，所有实际操作仍独立鉴权；PC历史编辑与状态流转依旧仅限超级管理员。 */
  capabilities: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        surface: z.enum(["pc", "mobile"]).default("pc"),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
      const allowed = async (action: BusinessOperationAction) => {
        try {
          await assertConstructionAccess(ctx, action);
          return true;
        } catch (error) {
          if (error instanceof TRPCError && error.code === "FORBIDDEN")
            return false;
          throw error;
        }
      };
      const [
        canCreate,
        canEditAction,
        canSubmitAction,
        canReviewAction,
        canArchiveAction,
        canPrint,
        canExport,
      ] = await Promise.all(
        ["create", "edit", "submit", "review", "void", "print", "export"].map(
          action => allowed(action as BusinessOperationAction)
        )
      );
      const db =
        input.surface === "mobile" && canReviewAction ? await getDb() : null;
      const canSupervisorReview = Boolean(
        db &&
          (
            await getProjectReportSupervisorIds(db!, input.projectId, -1)
          ).includes(requireAuthenticatedUser(ctx).id)
      );
      return {
        canCreate,
        canEdit: isSuperAdmin && canEditAction,
        canSubmit: isSuperAdmin && canSubmitAction,
        canReview: isSuperAdmin && canReviewAction,
        canArchive: isSuperAdmin && canArchiveAction,
        canPrint,
        canExport,
        canSupervisorReview,
      };
    }),

  /** 快照记录号清单按稳定业务日期/ID排序；不暴露账户或文件路径。每批点击时再次读取并复核。 */
  outputManifest: protectedProcedure
    .input(
      z
        .object({
          ...constructionReportFilterShape,
          action: z.enum(["print", "export"]),
        })
        .superRefine(validateFilterDates)
    )
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, input.action);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const rows = await db
        .select({ id: constructionDailyReports.id })
        .from(constructionDailyReports)
        .where(and(...getConstructionReportPredicates(input)))
        .orderBy(
          desc(constructionDailyReports.reportDate),
          desc(constructionDailyReports.id)
        );
      return {
        total: rows.length,
        generatedAt: new Date(),
        batches: constructionOutputBatches(rows.map(row => row.id)),
      };
    }),

  /** 新建日报时按用户已授权定位自动读取当前天气；外部服务异常只返回可人工选择的降级结果。 */
  resolveCurrentWeather: protectedProcedure
    .input(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${input.latitude.toFixed(4)}&longitude=${input.longitude.toFixed(4)}&current=weather_code,wind_speed_10m&timezone=auto`,
          { signal: AbortSignal.timeout(6_000) }
        );
        if (!response.ok)
          throw new Error(`天气服务返回 HTTP ${response.status}`);
        const payload = (await response.json()) as {
          current?: {
            weather_code?: number;
            wind_speed_10m?: number;
            time?: string;
          };
        };
        const weatherCode = payload.current?.weather_code;
        if (!Number.isFinite(weatherCode))
          throw new Error("天气服务未返回有效天气码");
        const windSpeed = Number(payload.current?.wind_speed_10m ?? 0);
        return {
          weather: mapCurrentWeather(Number(weatherCode), windSpeed),
          observedAt: payload.current?.time ?? new Date().toISOString(),
          source: "auto" as const,
        };
      } catch {
        return {
          weather: "other" as const,
          observedAt: new Date().toISOString(),
          source: "fallback" as const,
        };
      }
    }),

  listReports: protectedProcedure
    .input(constructionReportFilterInput)
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select(constructionReportProjection)
        .from(constructionDailyReports)
        .leftJoin(users, eq(constructionDailyReports.createdBy, users.id))
        .where(and(...getConstructionReportPredicates(input)))
        .orderBy(
          desc(constructionDailyReports.reportDate),
          desc(constructionDailyReports.updatedAt)
        );
      return withSubmitterDisplayName(rows);
    }),

  /** 当前项目日报提交管理员下拉，仅返回受控显示名和内部筛选ID。 */
  reportSubmitterOptions: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({ id: constructionDailyReports.createdBy, name: users.name })
        .from(constructionDailyReports)
        .leftJoin(users, eq(constructionDailyReports.createdBy, users.id))
        .where(eq(constructionDailyReports.projectId, input.projectId));
      return Array.from(
        new Map(
          rows.map(row => [
            row.id,
            { id: row.id, name: row.name?.trim() || `管理员 #${row.id}` },
          ])
        ).values()
      ).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }),

  /** 日报附件影像仅对当前日报项目范围内的施工业务人员返回，URL 为短时签名地址。 */
  reportEvidence: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        reportIds: z.array(z.number().int().positive()).min(1).max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const sourceIds = input.reportIds.map(id => `construction-report-${id}`);
      const rows = await db
        .select()
        .from(evidenceRecords)
        .where(
          and(
            eq(evidenceRecords.projectId, input.projectId),
            eq(evidenceRecords.sourceType, "site_photo"),
            inArray(evidenceRecords.sourceId, sourceIds)
          )
        )
        .orderBy(
          desc(evidenceRecords.capturedAt),
          desc(evidenceRecords.createdAt)
        );
      return Promise.all(
        rows.map(async row => {
          let description = "施工日报现场影像";
          try {
            description = row.watermarkJson
              ? (JSON.parse(row.watermarkJson) as { description?: string })
                  .description || description
              : description;
          } catch {
            /* 损坏元数据不阻断受控影像读取 */
          }
          return {
            id: row.id,
            reportId: Number(
              String(row.sourceId || "").replace("construction-report-", "")
            ),
            fileName: row.fileName,
            capturedAt: row.capturedAt,
            description,
            url: await storageGetSignedUrl(row.fileKey),
          };
        })
      );
    }),

  summary: protectedProcedure
    .input(constructionReportFilterInput)
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          total: 0,
          draft: 0,
          submitted: 0,
          approved: 0,
          rejected: 0,
          locked: 0,
          issues: 0,
          unreplied: 0,
          averageProgressPercent: 0,
        };
      const rows = await db
        .select({
          status: constructionDailyReports.status,
          progressPercent: constructionDailyReports.progressPercent,
          issueNotes: constructionDailyReports.issueNotes,
          safetyNotes: constructionDailyReports.safetyNotes,
          reviewReply: constructionDailyReports.reviewReply,
        })
        .from(constructionDailyReports)
        .where(and(...getConstructionReportPredicates(input)));
      const total = rows.length;
      return {
        total,
        draft: rows.filter(row => row.status === "draft").length,
        submitted: rows.filter(row => row.status === "submitted").length,
        approved: rows.filter(row => row.status === "approved").length,
        locked: rows.filter(row => row.status === "locked").length,
        rejected: rows.filter(row => row.status === "rejected").length,
        issues: rows.filter(
          row => row.issueNotes?.trim() || row.safetyNotes?.trim()
        ).length,
        unreplied: rows.filter(
          row =>
            (row.issueNotes?.trim() || row.safetyNotes?.trim()) &&
            !row.reviewReply?.trim()
        ).length,
        averageProgressPercent: total
          ? Math.round(
              (rows.reduce(
                (sum, row) => sum + Number(row.progressPercent ?? 0),
                0
              ) /
                total) *
                100
            ) / 100
          : 0,
      };
    }),

  /** 默认兼容旧调用；超过250明确拒绝并引导分批，传清单ID时禁止静默漏记录。 */
  printReports: protectedProcedure
    .input(outputInput)
    .query(({ ctx, input }) => readOutputReports(ctx, input, "print")),
  exportReports: protectedProcedure
    .input(outputInput)
    .query(({ ctx, input }) => readOutputReports(ctx, input, "export")),

  /** 新日报可由获授权现场岗位创建；更新既有日报仅限超级管理员，防止普通人员重写历史现场记录。 */
  saveReport: protectedProcedure
    .input(dailyReportInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertConstructionAccess(ctx, input.id ? "edit" : "create");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const values = {
        projectId: input.projectId,
        reportDate: toBusinessDate(input.reportDate),
        workArea: input.workArea,
        weather: input.weather,
        workContent: input.workContent,
        safetyNotes: input.safetyNotes || null,
        issueNotes: input.issueNotes || null,
        progressPercent: String(input.progressPercent),
      };

      if (input.id) {
        const [existing] = await db
          .select()
          .from(constructionDailyReports)
          .where(eq(constructionDailyReports.id, input.id))
          .limit(1);
        if (!existing || existing.projectId !== input.projectId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "未找到指定项目下的施工日报",
          });
        }
        if (existing.status !== "draft" && existing.status !== "rejected") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "仅草稿或退回的施工日报可修改",
          });
        }
        if (existing.createdBy !== user.id)
          await assertExistingBusinessRecordChangeAccess(ctx);
        const updateResult = await db
          .update(constructionDailyReports)
          .set({
            ...values,
            status: existing.status === "rejected" ? "draft" : existing.status,
            reviewReply:
              existing.status === "rejected" ? null : existing.reviewReply,
            reviewedBy:
              existing.status === "rejected" ? null : existing.reviewedBy,
            reviewedAt:
              existing.status === "rejected" ? null : existing.reviewedAt,
          })
          .where(
            and(
              eq(constructionDailyReports.id, input.id),
              eq(constructionDailyReports.projectId, input.projectId),
              eq(constructionDailyReports.status, existing.status)
            )
          );
        assertConditionalDailyReportWrite(updateResult);
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "construction",
          action: "update_daily_report",
          targetType: "construction_daily_report",
          targetId: String(input.id),
          summary: `更新施工日报：${input.reportDate} ${input.workArea}`,
        });
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          projectId: input.projectId,
          module: "construction",
          eventCode: "construction_daily_report_updated",
          targetType: "construction_daily_report",
          targetId: String(input.id),
          title: "施工日报已更新",
          content: "一份施工日报已更新，请进入系统查看受控记录。",
          deepLink: "/mobile/construction",
        }).catch(() => undefined);
        return { id: input.id, updated: true };
      }

      const [created] = await db
        .insert(constructionDailyReports)
        .values({ ...values, createdBy: user.id })
        .$returningId();
      const id = Number(created?.id);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "construction",
        action: "create_daily_report",
        targetType: "construction_daily_report",
        targetId: String(id),
        summary: `新建施工日报：${input.reportDate} ${input.workArea}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "construction",
        eventCode: "construction_daily_report_created",
        targetType: "construction_daily_report",
        targetId: String(id),
        title: "施工日报已提交记录",
        content: "一份施工日报已录入，请进入系统办理或查看。",
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
      return { id, created: true };
    }),

  /** 现场填报人将草稿上报至本项目有效主管角色，提交后不可再直接编辑。 */
  submitReportForReview: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertConstructionAccess(ctx, "submit");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [existing] = await db
        .select()
        .from(constructionDailyReports)
        .where(eq(constructionDailyReports.id, input.id))
        .limit(1);
      if (!existing || existing.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到指定项目下的施工日报",
        });
      if (existing.createdBy !== user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅日报填报人可以提交主管审核",
        });
      try {
        assertConstructionDailyReportStatusTransition(
          existing.status,
          "submitted"
        );
      } catch (error) {
        asBadRequest(error);
      }
      const autoApprove = await isSupervisorReviewAutoApprove(db);
      const supervisors = autoApprove
        ? []
        : await getProjectReportSupervisorIds(db, input.projectId, user.id);
      if (!autoApprove && !supervisors.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "当前项目未配置有效主管审核人，请联系超级管理员先分配项目主管岗位",
        });
      const updateResult = await db
        .update(constructionDailyReports)
        .set(
          autoApprove
            ? {
                status: "locked",
                reviewReply:
                  "系统设置已开启上级主管审核自动通过，日报自动归档。",
                reviewedBy: user.id,
                reviewedAt: new Date(),
              }
            : { status: "submitted" }
        )
        .where(
          and(
            eq(constructionDailyReports.id, input.id),
            eq(constructionDailyReports.projectId, input.projectId),
            eq(constructionDailyReports.status, "draft")
          )
        );
      assertConditionalDailyReportWrite(updateResult);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "construction",
        action: autoApprove
          ? "auto_approve_daily_report_by_supervisor_setting"
          : "submit_daily_report_for_review",
        targetType: "construction_daily_report",
        targetId: String(input.id),
        summary: autoApprove
          ? "统一上级主管审核开关已开启：施工日报自动审核通过并归档"
          : `施工日报提交项目主管审核，通知 ${supervisors.length} 位主管`,
      });
      if (!autoApprove)
        await notifyReportSupervisors({
          projectId: input.projectId,
          reportId: input.id,
          supervisorIds: supervisors,
          eventCode: "construction_daily_report_review_requested",
          title: "施工日报待您审核",
          content: "一份施工日报已提交至项目主管审核，请填写回复并确认处理。",
        });
      return {
        success: true,
        supervisorCount: supervisors.length,
        autoApproved: autoApprove,
      };
    }),

  /** 项目主管填写审核回复：确认通过即自动归档锁定，退回则回到填报人修改。 */
  reviewReport: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        decision: z.enum(["confirm", "return"]),
        reply: z
          .string()
          .trim()
          .min(2, "请填写审核回复")
          .max(1000, "审核回复不得超过 1000 字"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const reviewer = requireAuthenticatedUser(ctx);
      await assertConstructionAccess(ctx, "review");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [existing] = await db
        .select()
        .from(constructionDailyReports)
        .where(eq(constructionDailyReports.id, input.id))
        .limit(1);
      if (!existing || existing.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到指定项目下的施工日报",
        });
      if (existing.status !== "submitted")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅待审核施工日报可以回复处理",
        });
      const supervisorIds = await getProjectReportSupervisorIds(
        db,
        input.projectId,
        -1
      );
      if (!supervisorIds.includes(reviewer.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前账号不是该项目的有效主管审核人",
        });
      if (input.decision === "confirm") {
        try {
          assertConstructionDailyReportStatusTransition(
            existing.status,
            "approved"
          );
          assertConstructionDailyReportStatusTransition("approved", "locked");
        } catch (error) {
          asBadRequest(error);
        }
      } else {
        try {
          assertConstructionDailyReportStatusTransition(
            existing.status,
            "rejected"
          );
        } catch (error) {
          asBadRequest(error);
        }
      }
      const nextStatus = input.decision === "confirm" ? "locked" : "rejected";
      const updateResult = await db
        .update(constructionDailyReports)
        .set({
          status: nextStatus,
          reviewReply: input.reply,
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(constructionDailyReports.id, input.id),
            eq(constructionDailyReports.projectId, input.projectId),
            eq(constructionDailyReports.status, "submitted")
          )
        );
      assertConditionalDailyReportWrite(updateResult);
      await db.insert(auditLogs).values({
        userId: reviewer.id,
        module: "construction",
        action:
          input.decision === "confirm"
            ? "confirm_and_archive_daily_report"
            : "return_daily_report",
        targetType: "construction_daily_report",
        targetId: String(input.id),
        summary:
          input.decision === "confirm"
            ? "主管确认施工日报并自动归档"
            : "主管退回施工日报修改",
      });
      await createInAppMessage({
        eventCode: `construction_daily_report_${nextStatus}`,
        idempotencyKey: `construction_daily_report_${nextStatus}:${input.id}:${existing.createdBy}`,
        recipientUserId: existing.createdBy,
        title:
          input.decision === "confirm"
            ? "施工日报已确认归档"
            : "施工日报已退回修改",
        content: input.reply,
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
      void notifyOfficialAccountBusinessEventSafely({
        userId: existing.createdBy,
        projectId: input.projectId,
        module: "construction",
        eventCode: `construction_daily_report_${nextStatus}`,
        targetType: "construction_daily_report",
        targetId: String(input.id),
        title:
          input.decision === "confirm"
            ? "施工日报已确认归档"
            : "施工日报已退回修改",
        content: "您的施工日报已由项目主管处理，请进入系统查看审核回复。",
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
      return { success: true, status: nextStatus };
    }),

  /** 日报提交、审核和归档属于高影响动作，仅超级管理员可处理，已锁定日报不支持回退。 */
  transitionReport: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        nextStatus: reportStatusSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await assertExistingBusinessRecordChangeAccess(ctx);
      await assertConstructionAccess(
        ctx,
        input.nextStatus === "submitted"
          ? "submit"
          : input.nextStatus === "locked"
            ? "void"
            : "review"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [existing] = await db
        .select()
        .from(constructionDailyReports)
        .where(eq(constructionDailyReports.id, input.id))
        .limit(1);
      if (!existing || existing.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到指定项目下的施工日报",
        });
      try {
        assertConstructionDailyReportStatusTransition(
          existing.status,
          input.nextStatus
        );
      } catch (error) {
        asBadRequest(error);
      }
      const reviewed =
        input.nextStatus === "approved" ||
        input.nextStatus === "rejected" ||
        input.nextStatus === "locked";
      const updateResult = await db
        .update(constructionDailyReports)
        .set({
          status: input.nextStatus,
          reviewedBy: reviewed ? user.id : null,
          reviewedAt: reviewed ? new Date() : null,
        })
        .where(
          and(
            eq(constructionDailyReports.id, input.id),
            eq(constructionDailyReports.projectId, input.projectId),
            eq(constructionDailyReports.status, existing.status)
          )
        );
      assertConditionalDailyReportWrite(updateResult);
      const currentStatusLabel = getBusinessStatusLabel(existing.status);
      const nextStatusLabel = getBusinessStatusLabel(input.nextStatus);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "construction",
        action: "transition_daily_report",
        targetType: "construction_daily_report",
        targetId: String(input.id),
        summary: `施工日报状态从${currentStatusLabel}变更为${nextStatusLabel}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "construction",
        eventCode: `construction_daily_report_${input.nextStatus}`,
        targetType: "construction_daily_report",
        targetId: String(input.id),
        title: `施工日报${nextStatusLabel}`,
        content: "施工日报处理状态已更新，请进入系统查看受控记录。",
        deepLink: "/mobile/construction",
      }).catch(() => undefined);
      return { success: true };
    }),
});
