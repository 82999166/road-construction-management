import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditLogs, dailyProjectDigestSchedules, projects } from "../../drizzle/schema";
import { assertSuperAdmin } from "../access";
import { getDb } from "../db";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { protectedProcedure, router } from "../_core/trpc";
import { buildDailyDigestCron, buildProjectDailyDigest, DAILY_DIGEST_SCOPE_KEY, runDailyProjectDigest } from "../services/dailyProjectDigest";

const settingsInput = z.object({
  enabled: z.boolean(),
  deliveryHour: z.number().int().min(0).max(23),
  deliveryMinute: z.number().int().min(0).max(59),
  includeEmptyProjects: z.boolean().default(false),
});

export const dailyDigestRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return null;
    const [schedule] = await db.select().from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.scopeKey, DAILY_DIGEST_SCOPE_KEY)).limit(1);
    return schedule ?? { enabled: false, timezone: "Asia/Shanghai", deliveryHour: 17, deliveryMinute: 30, includeEmptyProjects: false, scheduleCronTaskUid: null, lastAttemptedAt: null, lastSuccessfulBusinessDate: null, lastResultJson: null };
  }),

  saveSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new Error("数据库连接暂不可用");
    const [existing] = await db.select().from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.scopeKey, DAILY_DIGEST_SCOPE_KEY)).limit(1);
    if (existing) {
      await db.update(dailyProjectDigestSchedules).set({ enabled: false, timezone: "Asia/Shanghai", deliveryHour: input.deliveryHour, deliveryMinute: input.deliveryMinute, includeEmptyProjects: input.includeEmptyProjects, updatedBy: user.id }).where(eq(dailyProjectDigestSchedules.id, existing.id));
    } else {
      await db.insert(dailyProjectDigestSchedules).values({ scopeKey: DAILY_DIGEST_SCOPE_KEY, enabled: false, timezone: "Asia/Shanghai", deliveryHour: input.deliveryHour, deliveryMinute: input.deliveryMinute, includeEmptyProjects: input.includeEmptyProjects, createdBy: user.id, updatedBy: user.id });
    }
    const [saved] = await db.select().from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.scopeKey, DAILY_DIGEST_SCOPE_KEY)).limit(1);
    if (!saved) throw new Error("每日汇总配置保存失败");
    const cron = buildDailyDigestCron(input.deliveryHour, input.deliveryMinute);
    let taskUid = saved.scheduleCronTaskUid;
    if (input.enabled) {
      if (taskUid) {
        await updateHeartbeatJob(taskUid, { cron, path: "/api/scheduled/daily-project-digest", method: "POST", payload: {}, description: "道路施工项目每日产值、开支与运输汇总", enable: true }, "");
      } else {
        const task = await createHeartbeatJob({ name: "daily-project-digest", cron, path: "/api/scheduled/daily-project-digest", method: "POST", payload: {}, description: "道路施工项目每日产值、开支与运输汇总" }, "");
        taskUid = task.taskUid;
      }
    } else if (taskUid) {
      await updateHeartbeatJob(taskUid, { enable: false }, "");
    }
    await db.update(dailyProjectDigestSchedules).set({ enabled: input.enabled, scheduleCronTaskUid: taskUid, updatedBy: user.id }).where(eq(dailyProjectDigestSchedules.id, saved.id));
    await db.insert(auditLogs).values({ userId: user.id, module: "notification", action: "save_daily_project_digest_schedule", targetType: "daily_project_digest_schedule", targetId: String(saved.id), summary: `每日项目汇总已${input.enabled ? "启用" : "停用"}：每天 ${String(input.deliveryHour).padStart(2, "0")}:${String(input.deliveryMinute).padStart(2, "0")}（中国标准时间）` });
    return { success: true, taskUid };
  }),

  preview: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), businessDate: z.string().date() })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new Error("数据库连接暂不可用");
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new Error("项目不存在");
    return buildProjectDailyDigest(project, input.businessDate);
  }),

  runNow: protectedProcedure.input(z.object({ businessDate: z.string().date().optional() })).mutation(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new Error("数据库连接暂不可用");
    const [schedule] = await db.select().from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.scopeKey, DAILY_DIGEST_SCOPE_KEY)).limit(1);
    if (!schedule || !schedule.enabled) throw new Error("请先保存并启用每日汇总任务");
    return runDailyProjectDigest(schedule.id, input.businessDate);
  }),
});
