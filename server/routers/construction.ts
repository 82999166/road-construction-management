import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, constructionDailyReports, evidenceRecords, projects, systemRoles, userRoleAssignments } from "../../drizzle/schema";
import { assertConstructionDailyReportStatusTransition, ConstructionDomainError } from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, type BusinessOperationAction, getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { isSupervisorReviewAutoApprove } from "../services/supervisorReview";
import { createInAppMessage } from "./messages";

const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");
const reportStatusSchema = z.enum(["draft", "submitted", "approved", "rejected", "locked"]);

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
  progressPercent: z.number().min(0, "累计完成比例不能小于 0").max(100, "累计完成比例不能超过 100"),
});

function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 施工现场业务仅面向项目负责人、施工负责人、安全负责人及全局超级管理员。 */
async function assertConstructionAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0], action: BusinessOperationAction = "read") {
  await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION", action);
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获施工现场业务授权" });
  }
  return roleCodes;
}

/** 返回当前施工模块范围内的项目选项，空范围绝不被解释为全项目权限。 */
async function listConstructionProjects(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  const scope = await getCurrentDataScope(ctx);
  const db = await getDb();
  if (!db) return [];
  const allProjects = await db.select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status, organizationId: projects.organizationId }).from(projects).orderBy(projects.sortOrder, projects.id);
  if (scope.hasAllProjects) return allProjects;
  return allProjects.filter(project => scope.projectIds.includes(project.id) || (project.organizationId !== null && scope.organizationIds.includes(project.organizationId)));
}

function asBadRequest(error: unknown): never {
  if (error instanceof ConstructionDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/** 仅将公共天气码映射为日报枚举；坐标只用于本次请求，不写入日报或审计记录。 */
function mapCurrentWeather(weatherCode: number, windSpeed: number): "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other" {
  if (windSpeed >= 10.8) return "windy";
  if ([0].includes(weatherCode)) return "sunny";
  if ([1, 2, 3].includes(weatherCode)) return "cloudy";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return "rainy";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snowy";
  return "other";
}

/**
 * 施工日报的草稿维护和状态流转均以读取时的状态作为写入条件。
 * 若受影响行数为 0，表示另一请求已先行更新，禁止继续写入审计。
 */
function assertConditionalDailyReportWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "施工日报已被其他用户更新，请刷新后重试" });
  }
}

/** 仅从当前项目的有效主管角色中解析审核收件人，避免日报提交越权通知到无关项目。 */
async function getProjectReportSupervisorIds(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: number, excludeUserId: number) {
  const now = new Date();
  const rows = await db
    .select({ userId: userRoleAssignments.userId })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(and(
      eq(userRoleAssignments.projectId, projectId),
      eq(userRoleAssignments.status, "active"),
      eq(systemRoles.status, "active"),
      inArray(systemRoles.code, ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"]),
      or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
      or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
    ));
  return Array.from(new Set(rows.map(row => row.userId).filter(userId => userId !== excludeUserId)));
}

/** 主管通知不回滚日报状态；站内消息和服务号通知均保留独立投递审计。 */
async function notifyReportSupervisors(input: { projectId: number; reportId: number; supervisorIds: number[]; eventCode: string; title: string; content: string }) {
  await Promise.all(input.supervisorIds.map(async supervisorId => {
    await createInAppMessage({
      eventCode: input.eventCode,
      idempotencyKey: `${input.eventCode}:${input.reportId}:${supervisorId}`,
      recipientUserId: supervisorId,
      title: input.title,
      content: input.content,
      deepLink: "/mobile/construction",
    }).catch(() => undefined);
    void notifyOfficialAccountBusinessEventSafely({ userId: supervisorId, projectId: input.projectId, module: "construction", eventCode: input.eventCode, targetType: "construction_daily_report", targetId: String(input.reportId), title: input.title, content: input.content, deepLink: "/mobile/construction" }).catch(() => undefined);
  }));
}

/** 施工日报路由：项目范围、岗位权限、终态锁定及审计均由服务端强制执行。 */
export const constructionRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertConstructionAccess(ctx);
    return listConstructionProjects(ctx);
  }),

  /** 新建日报时按用户已授权定位自动读取当前天气；外部服务异常只返回可人工选择的降级结果。 */
  resolveCurrentWeather: protectedProcedure.input(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx);
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${input.latitude.toFixed(4)}&longitude=${input.longitude.toFixed(4)}&current=weather_code,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error(`天气服务返回 HTTP ${response.status}`);
      const payload = await response.json() as { current?: { weather_code?: number; wind_speed_10m?: number; time?: string } };
      const weatherCode = payload.current?.weather_code;
      if (!Number.isFinite(weatherCode)) throw new Error("天气服务未返回有效天气码");
      const windSpeed = Number(payload.current?.wind_speed_10m ?? 0);
      return { weather: mapCurrentWeather(Number(weatherCode), windSpeed), observedAt: payload.current?.time ?? new Date().toISOString(), source: "auto" as const };
    } catch {
      return { weather: "other" as const, observedAt: new Date().toISOString(), source: "fallback" as const };
    }
  }),

  listReports: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(constructionDailyReports).where(eq(constructionDailyReports.projectId, input.projectId)).orderBy(desc(constructionDailyReports.reportDate), desc(constructionDailyReports.updatedAt));
  }),

  /** 日报附件影像仅对当前日报项目范围内的施工业务人员返回，URL 为短时签名地址。 */
  reportEvidence: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), reportIds: z.array(z.number().int().positive()).min(1).max(100) })).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const sourceIds = input.reportIds.map(id => `construction-report-${id}`);
    const rows = await db.select().from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), eq(evidenceRecords.sourceType, "site_photo"), inArray(evidenceRecords.sourceId, sourceIds))).orderBy(desc(evidenceRecords.capturedAt), desc(evidenceRecords.createdAt));
    return Promise.all(rows.map(async row => {
      let description = "施工日报现场影像";
      try { description = row.watermarkJson ? (JSON.parse(row.watermarkJson) as { description?: string }).description || description : description; } catch { /* 损坏元数据不阻断受控影像读取 */ }
      return { id: row.id, reportId: Number(String(row.sourceId || "").replace("construction-report-", "")), fileName: row.fileName, capturedAt: row.capturedAt, description, url: await storageGetSignedUrl(row.fileKey) };
    }));
  }),

  summary: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { total: 0, draft: 0, submitted: 0, approved: 0, locked: 0, averageProgressPercent: 0 };
    const rows = await db.select({ status: constructionDailyReports.status, progressPercent: constructionDailyReports.progressPercent }).from(constructionDailyReports).where(eq(constructionDailyReports.projectId, input.projectId));
    const total = rows.length;
    return {
      total,
      draft: rows.filter(row => row.status === "draft").length,
      submitted: rows.filter(row => row.status === "submitted").length,
      approved: rows.filter(row => row.status === "approved").length,
      locked: rows.filter(row => row.status === "locked").length,
      averageProgressPercent: total ? Math.round(rows.reduce((sum, row) => sum + Number(row.progressPercent ?? 0), 0) / total * 100) / 100 : 0,
    };
  }),

  /** 新日报可由获授权现场岗位创建；更新既有日报仅限超级管理员，防止普通人员重写历史现场记录。 */
  saveReport: protectedProcedure.input(dailyReportInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertConstructionAccess(ctx, input.id ? "edit" : "create");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
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
      const [existing] = await db.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的施工日报" });
      }
      if (existing.status !== "draft" && existing.status !== "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅草稿或退回的施工日报可修改" });
      }
      if (existing.createdBy !== user.id) await assertExistingBusinessRecordChangeAccess(ctx);
      const updateResult = await db.update(constructionDailyReports)
        .set({ ...values, status: existing.status === "rejected" ? "draft" : existing.status, reviewReply: existing.status === "rejected" ? null : existing.reviewReply, reviewedBy: existing.status === "rejected" ? null : existing.reviewedBy, reviewedAt: existing.status === "rejected" ? null : existing.reviewedAt })
        .where(and(eq(constructionDailyReports.id, input.id), eq(constructionDailyReports.projectId, input.projectId), eq(constructionDailyReports.status, existing.status)));
      assertConditionalDailyReportWrite(updateResult);
      await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "update_daily_report", targetType: "construction_daily_report", targetId: String(input.id), summary: `更新施工日报：${input.reportDate} ${input.workArea}` });
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "construction", eventCode: "construction_daily_report_updated", targetType: "construction_daily_report", targetId: String(input.id), title: "施工日报已更新", content: "一份施工日报已更新，请进入系统查看受控记录。", deepLink: "/mobile/construction" }).catch(() => undefined);
      return { id: input.id, updated: true };
    }

    const [created] = await db.insert(constructionDailyReports).values({ ...values, createdBy: user.id }).$returningId();
    const id = Number(created?.id);
    await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "create_daily_report", targetType: "construction_daily_report", targetId: String(id), summary: `新建施工日报：${input.reportDate} ${input.workArea}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "construction", eventCode: "construction_daily_report_created", targetType: "construction_daily_report", targetId: String(id), title: "施工日报已提交记录", content: "一份施工日报已录入，请进入系统办理或查看。", deepLink: "/mobile/construction" }).catch(() => undefined);
    return { id, created: true };
  }),

  /** 现场填报人将草稿上报至本项目有效主管角色，提交后不可再直接编辑。 */
  submitReportForReview: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertConstructionAccess(ctx, "submit");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, input.id)).limit(1);
    if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的施工日报" });
    if (existing.createdBy !== user.id) throw new TRPCError({ code: "FORBIDDEN", message: "仅日报填报人可以提交主管审核" });
    try { assertConstructionDailyReportStatusTransition(existing.status, "submitted"); } catch (error) { asBadRequest(error); }
    const autoApprove = await isSupervisorReviewAutoApprove(db);
    const supervisors = autoApprove ? [] : await getProjectReportSupervisorIds(db, input.projectId, user.id);
    if (!autoApprove && !supervisors.length) throw new TRPCError({ code: "BAD_REQUEST", message: "当前项目未配置有效主管审核人，请联系超级管理员先分配项目主管岗位" });
    const updateResult = await db.update(constructionDailyReports).set(autoApprove ? { status: "locked", reviewReply: "系统设置已开启上级主管审核自动通过，日报自动归档。", reviewedBy: user.id, reviewedAt: new Date() } : { status: "submitted" }).where(and(eq(constructionDailyReports.id, input.id), eq(constructionDailyReports.projectId, input.projectId), eq(constructionDailyReports.status, "draft")));
    assertConditionalDailyReportWrite(updateResult);
    await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: autoApprove ? "auto_approve_daily_report_by_supervisor_setting" : "submit_daily_report_for_review", targetType: "construction_daily_report", targetId: String(input.id), summary: autoApprove ? "统一上级主管审核开关已开启：施工日报自动审核通过并归档" : `施工日报提交项目主管审核，通知 ${supervisors.length} 位主管` });
    if (!autoApprove) await notifyReportSupervisors({ projectId: input.projectId, reportId: input.id, supervisorIds: supervisors, eventCode: "construction_daily_report_review_requested", title: "施工日报待您审核", content: "一份施工日报已提交至项目主管审核，请填写回复并确认处理。" });
    return { success: true, supervisorCount: supervisors.length, autoApproved: autoApprove };
  }),

  /** 项目主管填写审核回复：确认通过即自动归档锁定，退回则回到填报人修改。 */
  reviewReport: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), decision: z.enum(["confirm", "return"]), reply: z.string().trim().min(2, "请填写审核回复").max(1000, "审核回复不得超过 1000 字") })).mutation(async ({ ctx, input }) => {
    const reviewer = requireAuthenticatedUser(ctx);
    await assertConstructionAccess(ctx, "review");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, input.id)).limit(1);
    if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的施工日报" });
    if (existing.status !== "submitted") throw new TRPCError({ code: "BAD_REQUEST", message: "仅待审核施工日报可以回复处理" });
    const supervisorIds = await getProjectReportSupervisorIds(db, input.projectId, -1);
    if (!supervisorIds.includes(reviewer.id)) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是该项目的有效主管审核人" });
    if (input.decision === "confirm") {
      try { assertConstructionDailyReportStatusTransition(existing.status, "approved"); assertConstructionDailyReportStatusTransition("approved", "locked"); } catch (error) { asBadRequest(error); }
    } else {
      try { assertConstructionDailyReportStatusTransition(existing.status, "rejected"); } catch (error) { asBadRequest(error); }
    }
    const nextStatus = input.decision === "confirm" ? "locked" : "rejected";
    const updateResult = await db.update(constructionDailyReports).set({ status: nextStatus, reviewReply: input.reply, reviewedBy: reviewer.id, reviewedAt: new Date() }).where(and(eq(constructionDailyReports.id, input.id), eq(constructionDailyReports.projectId, input.projectId), eq(constructionDailyReports.status, "submitted")));
    assertConditionalDailyReportWrite(updateResult);
    await db.insert(auditLogs).values({ userId: reviewer.id, module: "construction", action: input.decision === "confirm" ? "confirm_and_archive_daily_report" : "return_daily_report", targetType: "construction_daily_report", targetId: String(input.id), summary: input.decision === "confirm" ? "主管确认施工日报并自动归档" : "主管退回施工日报修改" });
    await createInAppMessage({ eventCode: `construction_daily_report_${nextStatus}`, idempotencyKey: `construction_daily_report_${nextStatus}:${input.id}:${existing.createdBy}`, recipientUserId: existing.createdBy, title: input.decision === "confirm" ? "施工日报已确认归档" : "施工日报已退回修改", content: input.reply, deepLink: "/mobile/construction" }).catch(() => undefined);
    void notifyOfficialAccountBusinessEventSafely({ userId: existing.createdBy, projectId: input.projectId, module: "construction", eventCode: `construction_daily_report_${nextStatus}`, targetType: "construction_daily_report", targetId: String(input.id), title: input.decision === "confirm" ? "施工日报已确认归档" : "施工日报已退回修改", content: "您的施工日报已由项目主管处理，请进入系统查看审核回复。", deepLink: "/mobile/construction" }).catch(() => undefined);
    return { success: true, status: nextStatus };
  }),

  /** 日报提交、审核和归档属于高影响动作，仅超级管理员可处理，已锁定日报不支持回退。 */
  transitionReport: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), nextStatus: reportStatusSchema })).mutation(async ({ ctx, input }) => {
    const user = await assertExistingBusinessRecordChangeAccess(ctx);
    await assertConstructionAccess(ctx, input.nextStatus === "submitted" ? "submit" : input.nextStatus === "locked" ? "void" : "review");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, input.id)).limit(1);
    if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的施工日报" });
    try {
      assertConstructionDailyReportStatusTransition(existing.status, input.nextStatus);
    } catch (error) {
      asBadRequest(error);
    }
    const reviewed = input.nextStatus === "approved" || input.nextStatus === "rejected" || input.nextStatus === "locked";
    const updateResult = await db.update(constructionDailyReports)
      .set({ status: input.nextStatus, reviewedBy: reviewed ? user.id : null, reviewedAt: reviewed ? new Date() : null })
      .where(and(eq(constructionDailyReports.id, input.id), eq(constructionDailyReports.projectId, input.projectId), eq(constructionDailyReports.status, existing.status)));
    assertConditionalDailyReportWrite(updateResult);
    await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "transition_daily_report", targetType: "construction_daily_report", targetId: String(input.id), summary: `施工日报状态从 ${existing.status} 变更为 ${input.nextStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "construction", eventCode: `construction_daily_report_${input.nextStatus}`, targetType: "construction_daily_report", targetId: String(input.id), title: `施工日报已${input.nextStatus}`, content: "施工日报处理状态已更新，请进入系统查看受控记录。", deepLink: "/mobile/construction" }).catch(() => undefined);
    return { success: true };
  }),
});
