import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, constructionDailyReports, projects } from "../../drizzle/schema";
import { assertConstructionDailyReportStatusTransition, ConstructionDomainError } from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

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
async function assertConstructionAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION");
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

/** 施工日报路由：项目范围、岗位权限、终态锁定及审计均由服务端强制执行。 */
export const constructionRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertConstructionAccess(ctx);
    return listConstructionProjects(ctx);
  }),

  listReports: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(constructionDailyReports).where(eq(constructionDailyReports.projectId, input.projectId)).orderBy(desc(constructionDailyReports.reportDate), desc(constructionDailyReports.updatedAt));
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
    await assertConstructionAccess(ctx);
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
      await assertExistingBusinessRecordChangeAccess(ctx);
      const [existing] = await db.select().from(constructionDailyReports).where(eq(constructionDailyReports.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的施工日报" });
      }
      if (existing.status !== "draft" && existing.status !== "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅草稿或退回的施工日报可修改" });
      }
      await db.update(constructionDailyReports).set(values).where(eq(constructionDailyReports.id, input.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "update_daily_report", targetType: "construction_daily_report", targetId: String(input.id), summary: `更新施工日报：${input.reportDate} ${input.workArea}` });
      return { id: input.id, updated: true };
    }

    const [created] = await db.insert(constructionDailyReports).values({ ...values, createdBy: user.id }).$returningId();
    const id = Number(created?.id);
    await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "create_daily_report", targetType: "construction_daily_report", targetId: String(id), summary: `新建施工日报：${input.reportDate} ${input.workArea}` });
    return { id, created: true };
  }),

  /** 日报提交、审核和归档属于高影响动作，仅超级管理员可处理，已锁定日报不支持回退。 */
  transitionReport: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), nextStatus: reportStatusSchema })).mutation(async ({ ctx, input }) => {
    const user = await assertExistingBusinessRecordChangeAccess(ctx);
    await assertConstructionAccess(ctx);
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
    await db.update(constructionDailyReports).set({ status: input.nextStatus, reviewedBy: reviewed ? user.id : null, reviewedAt: reviewed ? new Date() : null }).where(and(eq(constructionDailyReports.id, input.id), eq(constructionDailyReports.projectId, input.projectId)));
    await db.insert(auditLogs).values({ userId: user.id, module: "construction", action: "transition_daily_report", targetType: "construction_daily_report", targetId: String(input.id), summary: `施工日报状态从 ${existing.status} 变更为 ${input.nextStatus}` });
    return { success: true };
  }),
});
