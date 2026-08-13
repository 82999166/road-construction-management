import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  constructionDailyReports,
  dailyProjectDigestRuns,
  dailyProjectDigestSchedules,
  financialRecords,
  measurementClaims,
  notificationRecords,
  organizations,
  projects,
  systemRoles,
  transportTrips,
  userRoleAssignments,
} from "../../drizzle/schema";
import { getDb } from "../db";

const DIGEST_SCOPE_KEY = "all_active_projects";
const DIGEST_RECIPIENT_ROLES = ["PROJECT_MANAGER", "FINANCE_MANAGER", "TRANSPORT_MANAGER", "CONSTRUCTION_MANAGER", "SUPER_ADMIN"];

export type DailyProjectDigestScheduleInput = {
  enabled: boolean;
  deliveryHour: number;
  deliveryMinute: number;
  includeEmptyProjects: boolean;
};

type ProjectDigestSummary = {
  projectId: number;
  projectName: string;
  businessDate: string;
  construction: { reportCount: number; submittedCount: number; approvedCount: number; averageProgressPercent: number };
  finance: { incomeAmount: number; expenseAmount: number; netAmount: number; topExpenseCategories: Array<{ category: string; amount: number }> };
  measurement: { declaredAmount: number; approvedAmount: number; claimCount: number };
  transport: { tripCount: number; loadConfirmedCount: number; unloadConfirmedCount: number; volumeCubicMeters: number; weightTons: number; amount: number; exceptionTripCount: number };
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function toUtcDayRange(businessDate: string) {
  const start = new Date(`${businessDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("invalid_business_date");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function toBusinessDateValue(businessDate: string) {
  return toUtcDayRange(businessDate).start;
}

function formatShanghaiBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatCurrency(value: number) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function compactContent(summary: ProjectDigestSummary) {
  const categories = summary.finance.topExpenseCategories.map(item => `${item.category}${formatCurrency(item.amount)}`).join("、");
  const content = [
    `${summary.businessDate}：施工日报${summary.construction.reportCount}份（已报${summary.construction.submittedCount}、已审${summary.construction.approvedCount}），平均进度${summary.construction.averageProgressPercent}%。`,
    `产值/收入${formatCurrency(summary.finance.incomeAmount)}，开支${formatCurrency(summary.finance.expenseAmount)}，净额${formatCurrency(summary.finance.netAmount)}${categories ? `（${categories}）` : ""}。`,
    `运输${summary.transport.tripCount}趟，装土${summary.transport.loadConfirmedCount}、卸土${summary.transport.unloadConfirmedCount}，${summary.transport.volumeCubicMeters}方/${summary.transport.weightTons}吨，异常${summary.transport.exceptionTripCount}趟。`,
  ].join(" ");
  return content.slice(0, 180);
}

async function resolveDigestRecipientIds(project: { id: number; organizationId: number | null }) {
  const db = await getDb();
  if (!db) return [];
  const recipientIds = new Set<number>();
  if (project.organizationId) {
    const rows = await db.select({ id: organizations.id, parentId: organizations.parentId, managerUserId: organizations.managerUserId }).from(organizations);
    const byId = new Map(rows.map(row => [row.id, row]));
    let currentId: number | null = project.organizationId;
    for (let depth = 0; currentId && depth < 16; depth += 1) {
      const organization = byId.get(currentId);
      if (!organization) break;
      if (organization.managerUserId) recipientIds.add(organization.managerUserId);
      currentId = organization.parentId;
    }
  }
  const now = new Date();
  const assignments = await db
    .select({ userId: userRoleAssignments.userId, projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId, validFrom: userRoleAssignments.validFrom, validTo: userRoleAssignments.validTo, roleCode: systemRoles.code })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(and(eq(userRoleAssignments.status, "active"), eq(systemRoles.status, "active"), inArray(systemRoles.code, DIGEST_RECIPIENT_ROLES)));
  for (const assignment of assignments) {
    const isEffective = (!assignment.validFrom || assignment.validFrom <= now) && (!assignment.validTo || assignment.validTo > now);
    const isScoped = assignment.projectId === project.id || (project.organizationId !== null && assignment.organizationId === project.organizationId);
    if (isEffective && isScoped) recipientIds.add(assignment.userId);
  }
  return Array.from(recipientIds);
}

export async function buildProjectDailyDigest(project: { id: number; name: string }, businessDate: string): Promise<ProjectDigestSummary> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const range = toUtcDayRange(businessDate);
  const [reports, financeRows, claims, trips] = await Promise.all([
    db.select({ status: constructionDailyReports.status, progressPercent: constructionDailyReports.progressPercent }).from(constructionDailyReports).where(and(eq(constructionDailyReports.projectId, project.id), eq(constructionDailyReports.reportDate, range.start))),
    db.select({ direction: financialRecords.direction, category: financialRecords.category, amount: financialRecords.amount, settlementStatus: financialRecords.settlementStatus }).from(financialRecords).where(and(eq(financialRecords.projectId, project.id), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.end))),
    db.select({ declaredAmount: measurementClaims.declaredAmount, approvedAmount: measurementClaims.approvedAmount, status: measurementClaims.status }).from(measurementClaims).where(and(eq(measurementClaims.projectId, project.id), gte(measurementClaims.createdAt, range.start), lt(measurementClaims.createdAt, range.end))),
    db.select({ volumeCubicMeters: transportTrips.volumeCubicMeters, weightTons: transportTrips.weightTons, calculatedAmount: transportTrips.calculatedAmount, status: transportTrips.status, loadConfirmedAt: transportTrips.loadConfirmedAt, unloadConfirmedAt: transportTrips.unloadConfirmedAt, exceptionStatus: transportTrips.exceptionStatus }).from(transportTrips).where(and(eq(transportTrips.projectId, project.id), gte(transportTrips.startAt, range.start), lt(transportTrips.startAt, range.end))),
  ]);
  const validFinance = financeRows.filter(row => row.settlementStatus !== "void");
  const expenseCategoryTotals = new Map<string, number>();
  for (const row of validFinance.filter(item => item.direction === "expense")) {
    expenseCategoryTotals.set(row.category, roundMoney((expenseCategoryTotals.get(row.category) ?? 0) + Number(row.amount)));
  }
  const activeTrips = trips.filter(trip => trip.status !== "void");
  const activeClaims = claims.filter(claim => claim.status !== "void" && claim.status !== "rejected");
  return {
    projectId: project.id,
    projectName: project.name,
    businessDate,
    construction: {
      reportCount: reports.length,
      submittedCount: reports.filter(row => row.status === "submitted").length,
      approvedCount: reports.filter(row => ["approved", "locked"].includes(row.status)).length,
      averageProgressPercent: reports.length ? roundMoney(reports.reduce((total, row) => total + Number(row.progressPercent ?? 0), 0) / reports.length) : 0,
    },
    finance: {
      incomeAmount: roundMoney(validFinance.filter(row => row.direction === "income").reduce((total, row) => total + Number(row.amount), 0)),
      expenseAmount: roundMoney(validFinance.filter(row => row.direction === "expense").reduce((total, row) => total + Number(row.amount), 0)),
      netAmount: roundMoney(validFinance.reduce((total, row) => total + (row.direction === "income" ? Number(row.amount) : -Number(row.amount)), 0)),
      topExpenseCategories: Array.from(expenseCategoryTotals.entries()).sort((left, right) => right[1] - left[1]).slice(0, 2).map(([category, amount]) => ({ category, amount })),
    },
    measurement: {
      declaredAmount: roundMoney(activeClaims.reduce((total, row) => total + Number(row.declaredAmount), 0)),
      approvedAmount: roundMoney(activeClaims.reduce((total, row) => total + Number(row.approvedAmount ?? 0), 0)),
      claimCount: activeClaims.length,
    },
    transport: {
      tripCount: activeTrips.length,
      loadConfirmedCount: activeTrips.filter(row => row.loadConfirmedAt).length,
      unloadConfirmedCount: activeTrips.filter(row => row.unloadConfirmedAt).length,
      volumeCubicMeters: roundQuantity(activeTrips.reduce((total, row) => total + Number(row.volumeCubicMeters ?? 0), 0)),
      weightTons: roundQuantity(activeTrips.reduce((total, row) => total + Number(row.weightTons ?? 0), 0)),
      amount: roundMoney(activeTrips.reduce((total, row) => total + Number(row.calculatedAmount ?? 0), 0)),
      exceptionTripCount: activeTrips.filter(row => row.exceptionStatus === "open").length,
    },
  };
}

function isEmptyDigest(summary: ProjectDigestSummary) {
  return summary.construction.reportCount === 0 && summary.finance.incomeAmount === 0 && summary.finance.expenseAmount === 0 && summary.measurement.claimCount === 0 && summary.transport.tripCount === 0;
}

async function getOrCreateDigestRun(scheduleId: number, projectId: number, businessDate: string, summary: ProjectDigestSummary) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const businessDateValue = toBusinessDateValue(businessDate);
  const [existing] = await db.select().from(dailyProjectDigestRuns).where(and(eq(dailyProjectDigestRuns.scheduleId, scheduleId), eq(dailyProjectDigestRuns.projectId, projectId), eq(dailyProjectDigestRuns.businessDate, businessDateValue))).limit(1);
  if (existing) return existing;
  try {
    await db.insert(dailyProjectDigestRuns).values({ scheduleId, projectId, businessDate: businessDateValue, summaryJson: JSON.stringify(summary), status: "pending" });
  } catch {
    // 同一 Heartbeat 出现并发重放时，由唯一索引确保只产生一份审计记录。
  }
  const [created] = await db.select().from(dailyProjectDigestRuns).where(and(eq(dailyProjectDigestRuns.scheduleId, scheduleId), eq(dailyProjectDigestRuns.projectId, projectId), eq(dailyProjectDigestRuns.businessDate, businessDateValue))).limit(1);
  if (!created) throw new Error("digest_run_create_failed");
  return created;
}

export async function runDailyProjectDigest(scheduleId: number, businessDate = formatShanghaiBusinessDate()) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [schedule] = await db.select().from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.id, scheduleId)).limit(1);
  if (!schedule || !schedule.enabled) return { status: "ignored" as const, businessDate, projectCount: 0, deliveredCount: 0, failedCount: 0 };
  const activeProjects = await db.select({ id: projects.id, name: projects.name, organizationId: projects.organizationId }).from(projects).where(eq(projects.status, "active"));
  let deliveredCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  for (const project of activeProjects) {
    const summary = await buildProjectDailyDigest(project, businessDate);
    const run = await getOrCreateDigestRun(schedule.id, project.id, businessDate, summary);
    if (run.status === "completed") continue;
    processedCount += 1;
    if (!schedule.includeEmptyProjects && isEmptyDigest(summary)) {
      await db.update(dailyProjectDigestRuns).set({ status: "skipped", summaryJson: JSON.stringify(summary), recipientCount: 0, deliveredCount: 0, failedCount: 0, completedAt: new Date() }).where(eq(dailyProjectDigestRuns.id, run.id));
      continue;
    }
    const recipientUserIds = await resolveDigestRecipientIds(project);
    if (!recipientUserIds.length) {
      await db.update(dailyProjectDigestRuns).set({ status: "skipped", summaryJson: JSON.stringify(summary), recipientCount: 0, deliveredCount: 0, failedCount: 0, completedAt: new Date() }).where(eq(dailyProjectDigestRuns.id, run.id));
      continue;
    }
    const results = await Promise.all(recipientUserIds.map(async recipientUserId => {
      const idempotencyKey = `inapp:daily-project-digest:${project.id}:${businessDate}:${recipientUserId}`;
      await db.insert(notificationRecords).values({
        eventCode: "daily_project_digest",
        idempotencyKey,
        recipientUserId,
        title: `每日项目汇总｜${project.name}`,
        content: compactContent(summary),
        deepLink: "/mobile/messages",
        status: "sent",
        sentAt: new Date(),
        channel: "in_app",
      }).onDuplicateKeyUpdate({
        set: { title: `每日项目汇总｜${project.name}`, content: compactContent(summary), deepLink: "/mobile/messages", status: "sent", sentAt: new Date() },
      });
      return "sent" as const;
    }));
    const delivered = results.filter(result => result === "sent").length;
    const failed = results.length - delivered;
    deliveredCount += delivered;
    failedCount += failed;
    await db.update(dailyProjectDigestRuns).set({ status: failed ? "partial" : "completed", summaryJson: JSON.stringify(summary), recipientCount: recipientUserIds.length, deliveredCount: delivered, failedCount: failed, completedAt: new Date() }).where(eq(dailyProjectDigestRuns.id, run.id));
  }
  await db.update(dailyProjectDigestSchedules).set({ lastAttemptedAt: new Date(), lastSuccessfulBusinessDate: failedCount === 0 ? toBusinessDateValue(businessDate) : schedule.lastSuccessfulBusinessDate, lastResultJson: JSON.stringify({ businessDate, processedCount, deliveredCount, failedCount }).slice(0, 5000) }).where(eq(dailyProjectDigestSchedules.id, schedule.id));
  return { status: failedCount ? "partial" as const : "completed" as const, businessDate, projectCount: processedCount, deliveredCount, failedCount };
}

export async function runDailyProjectDigestForHeartbeatTask(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [schedule] = await db.select().from(dailyProjectDigestSchedules).where(and(eq(dailyProjectDigestSchedules.scheduleCronTaskUid, taskUid), eq(dailyProjectDigestSchedules.enabled, true))).limit(1);
  if (!schedule) return { status: "ignored" as const, businessDate: formatShanghaiBusinessDate(), projectCount: 0, deliveredCount: 0, failedCount: 0 };
  return runDailyProjectDigest(schedule.id);
}

export function buildDailyDigestCron(deliveryHour: number, deliveryMinute: number) {
  // Heartbeat 使用 UTC；后台暂固定中国标准时间，避免用户配置与 Cron 时区出现歧义。
  const utcHour = (deliveryHour + 16) % 24;
  return `0 ${deliveryMinute} ${utcHour} * * *`;
}

export const DAILY_DIGEST_SCOPE_KEY = DIGEST_SCOPE_KEY;
