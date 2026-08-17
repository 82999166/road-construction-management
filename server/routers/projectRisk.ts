import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
  assetMaintenanceRecords,
  auditLogs,
  attendanceCheckIns,
  constructionDailyReports,
  dieselRefuelRecords,
  financialRecords,
  machineCostRecords,
  machines,
  notificationRecords,
  payrollStatements,
  projectRiskAlerts,
  projectRiskBriefings,
  projectRiskRules,
  projects,
  systemRoles,
  transportTrips,
  transportVehicles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import { assertSuperAdmin, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { invokeLLM } from "../_core/llm";
import { protectedProcedure, router } from "../_core/trpc";

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "期间格式应为 YYYY-MM");
const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");

const RISK_RECIPIENT_ROLES = ["PROJECT_MANAGER", "FINANCE_MANAGER", "TRANSPORT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER", "SUPER_ADMIN"] as const;

type RiskCategory = "construction" | "attendance" | "fuel" | "transport";
type RiskSeverity = "notice" | "warning" | "critical";
type RiskRule = {
  enabled: boolean;
  maxFuelFillRatio: number;
  maxTransportSpeedKmh: number;
  maxTransportDurationMinutes: number;
  maxOpenCheckInHours: number;
  maxPendingReportHours: number;
  overdueEscalationEnabled: boolean;
  overdueEscalationHourChina: number;
  overdueEscalationCronTaskUid: string | null;
};
type CandidateRisk = {
  category: RiskCategory;
  severity: RiskSeverity;
  ruleCode: string;
  sourceType: string;
  sourceId: string;
  title: string;
  summary: string;
  evidence: Record<string, number | string | boolean | null>;
};

const DEFAULT_RISK_RULE: RiskRule = {
  enabled: true,
  maxFuelFillRatio: 1.1,
  maxTransportSpeedKmh: 80,
  maxTransportDurationMinutes: 360,
  maxOpenCheckInHours: 14,
  maxPendingReportHours: 24,
  overdueEscalationEnabled: false,
  overdueEscalationHourChina: 9,
  overdueEscalationCronTaskUid: null,
};

const FINANCE_CATEGORY_LABELS: Record<string, string> = {
  living: "生活开支",
  diesel: "柴油油料",
  payroll: "工资劳务",
  machinery: "机械成本",
  vehicle_transport: "车辆与运输",
  purchasing: "采购材料",
  other: "其他开支",
};

function monthRange(period: string) {
  const start = new Date(`${period}-01T00:00:00.000Z`);
  const endExclusive = new Date(start);
  endExclusive.setUTCMonth(endExclusive.getUTCMonth() + 1);
  return { start, endExclusive };
}

function businessDateValue(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "日期无效" });
  return date;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function round(value: number, digits = 2) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function asRule(row: typeof projectRiskRules.$inferSelect | undefined): RiskRule {
  if (!row) return { ...DEFAULT_RISK_RULE };
  return {
    enabled: row.enabled,
    maxFuelFillRatio: Number(row.maxFuelFillRatio),
    maxTransportSpeedKmh: Number(row.maxTransportSpeedKmh),
    maxTransportDurationMinutes: row.maxTransportDurationMinutes,
    maxOpenCheckInHours: row.maxOpenCheckInHours,
    maxPendingReportHours: row.maxPendingReportHours,
    overdueEscalationEnabled: row.overdueEscalationEnabled,
    overdueEscalationHourChina: row.overdueEscalationHourChina,
    overdueEscalationCronTaskUid: row.overdueEscalationCronTaskUid,
  };
}

/** 中国标准时间每天整点转换为 Heartbeat 所需的 UTC 六段 cron 表达式。 */
export function buildRiskOverdueEscalationCron(hourChina: number) {
  if (!Number.isInteger(hourChina) || hourChina < 0 || hourChina > 23) throw new TRPCError({ code: "BAD_REQUEST", message: "逾期升级检查时间必须为 0—23 点（中国标准时间）" });
  return `0 0 ${(hourChina + 16) % 24} * * *`;
}

/** 费用分类只依据已登记业务类别与来源标识，未知类别保留在“其他”，绝不凭 AI 猜测会计科目。 */
export function classifyFinanceCategory(input: { category?: string | null; sourceType?: string | null; assetType?: "vehicle" | "machine" | null; costType?: string | null }) {
  const text = `${input.category ?? ""} ${input.sourceType ?? ""} ${input.costType ?? ""}`.toLowerCase();
  if (text.includes("diesel") || text.includes("fuel") || /柴油|油料|加油/.test(text)) return "diesel";
  if (text.includes("payroll") || text.includes("labor") || /工资|劳务|薪资/.test(text)) return "payroll";
  if (input.assetType === "machine" || text.includes("machine") || /机械|设备/.test(text)) return "machinery";
  if (input.assetType === "vehicle" || text.includes("transport") || text.includes("vehicle") || /车辆|运输|运费/.test(text)) return "vehicle_transport";
  if (text.includes("purchase") || /采购|材料|库存|物料/.test(text)) return "purchasing";
  if (/生活|餐|食堂|住宿|后勤|办公|水电/.test(text)) return "living";
  return "other";
}

async function getProjectOrThrow(projectId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [project] = await db.select({ id: projects.id, name: projects.name, organizationId: projects.organizationId, status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.status === "archived") throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在或已归档" });
  return { db, project };
}

/** 只向项目直属及项目上级组织的有效管理岗位投递，范围、有效期与角色状态均由服务端重新核验。 */
async function resolveRiskRecipients(project: { id: number; organizationId: number | null }) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const rows = await db
    .select({ userId: userRoleAssignments.userId, projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(and(
      eq(userRoleAssignments.status, "active"),
      eq(systemRoles.status, "active"),
      inArray(systemRoles.code, [...RISK_RECIPIENT_ROLES]),
      or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
      or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
    ));
  return Array.from(new Set(rows.filter(row => row.projectId === project.id || (project.organizationId !== null && row.organizationId === project.organizationId)).map(row => row.userId)));
}

/** 责任人仅能从当前项目有效管理岗位中选择，防止跨项目派单或向已失效账号分配整改。 */
async function resolveRiskAssignees(project: { id: number; organizationId: number | null }) {
  const db = await getDb();
  if (!db) return [] as Array<{ id: number; name: string | null }>;
  const recipientIds = await resolveRiskRecipients(project);
  if (!recipientIds.length) return [];
  return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, recipientIds));
}

export function detectTransportRisk(trip: typeof transportTrips.$inferSelect, rule: RiskRule): CandidateRisk[] {
  if (!trip.endAt || trip.status === "void") return [];
  const distanceKm = Number(trip.actualDistanceKm ?? 0);
  const durationMinutes = (trip.endAt.getTime() - trip.startAt.getTime()) / 60_000;
  const sharedEvidence = { distanceKm: round(distanceKm, 3), durationMinutes: round(durationMinutes, 1), tripId: Number(trip.id) };
  if (durationMinutes <= 0) return [{ category: "transport", severity: "critical", ruleCode: "TRANSPORT_TIME_ORDER", sourceType: "transport_trip", sourceId: String(trip.id), title: "运输趟次起止时间异常", summary: "该趟运输的结束时间早于或等于起始时间，无法形成有效运输闭环，请立即核验。", evidence: sharedEvidence }];
  if (distanceKm < 2) return [];
  const speedKmh = distanceKm / (durationMinutes / 60);
  const results: CandidateRisk[] = [];
  if (speedKmh > rule.maxTransportSpeedKmh) results.push({ category: "transport", severity: "critical", ruleCode: "TRANSPORT_SPEED_HIGH", sourceType: "transport_trip", sourceId: String(trip.id), title: "运输速度与里程不匹配", summary: `该趟平均速度 ${round(speedKmh, 1)} km/h，超过项目阈值 ${rule.maxTransportSpeedKmh} km/h，请核对起止时间、实际公里数及刷卡记录。`, evidence: { ...sharedEvidence, speedKmh: round(speedKmh, 1), thresholdKmh: rule.maxTransportSpeedKmh } });
  if (durationMinutes > rule.maxTransportDurationMinutes) results.push({ category: "transport", severity: "warning", ruleCode: "TRANSPORT_DURATION_LONG", sourceType: "transport_trip", sourceId: String(trip.id), title: "运输时长异常偏长", summary: `该趟 ${round(distanceKm, 1)} km 已耗时 ${round(durationMinutes, 0)} 分钟，超过项目阈值 ${rule.maxTransportDurationMinutes} 分钟，请核对车辆滞留、装卸或起止时间。`, evidence: { ...sharedEvidence, thresholdMinutes: rule.maxTransportDurationMinutes } });
  return results;
}

async function buildRiskCandidates(projectId: number, businessDate: string, rule: RiskRule) {
  const { db } = await getProjectOrThrow(projectId);
  const businessDateAt = businessDateValue(businessDate);
  const nextDate = new Date(businessDateAt);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const now = new Date();
  const reportDeadline = new Date(now.getTime() - rule.maxPendingReportHours * 3_600_000);
  const checkInDeadline = new Date(now.getTime() - rule.maxOpenCheckInHours * 3_600_000);
  const [reports, checkIns, dieselRows, trips] = await Promise.all([
    db.select().from(constructionDailyReports).where(and(eq(constructionDailyReports.projectId, projectId), inArray(constructionDailyReports.status, ["draft", "submitted", "rejected"]), lte(constructionDailyReports.updatedAt, reportDeadline))),
    db.select().from(attendanceCheckIns).where(and(eq(attendanceCheckIns.projectId, projectId), isNull(attendanceCheckIns.checkedOutAt), lte(attendanceCheckIns.checkedInAt, checkInDeadline))),
    db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, projectId), gte(dieselRefuelRecords.refueledAt, businessDateAt), lt(dieselRefuelRecords.refueledAt, nextDate))),
    db.select().from(transportTrips).where(and(eq(transportTrips.projectId, projectId), gte(transportTrips.startAt, businessDateAt), lt(transportTrips.startAt, nextDate))),
  ]);
  const vehicleIds = Array.from(new Set(dieselRows.filter(row => row.assetType === "vehicle" && row.vehicleId).map(row => Number(row.vehicleId))));
  const machineIds = Array.from(new Set(dieselRows.filter(row => row.assetType === "machine" && row.machineId).map(row => Number(row.machineId))));
  const [vehicles, machineRows] = await Promise.all([
    vehicleIds.length ? db.select({ id: transportVehicles.id, fuelTankCapacityLiters: transportVehicles.fuelTankCapacityLiters }).from(transportVehicles).where(inArray(transportVehicles.id, vehicleIds)) : [],
    machineIds.length ? db.select({ id: machines.id, fuelTankCapacityLiters: machines.fuelTankCapacityLiters }).from(machines).where(inArray(machines.id, machineIds)) : [],
  ]);
  const vehicleCapacity = new Map(vehicles.map(item => [item.id, Number(item.fuelTankCapacityLiters ?? 0)]));
  const machineCapacity = new Map(machineRows.map(item => [item.id, Number(item.fuelTankCapacityLiters ?? 0)]));
  const candidates: CandidateRisk[] = [];

  for (const report of reports) {
    const pendingHours = (now.getTime() - report.updatedAt.getTime()) / 3_600_000;
    candidates.push({ category: "construction", severity: report.status === "rejected" ? "warning" : "notice", ruleCode: "CONSTRUCTION_REPORT_PENDING", sourceType: "construction_daily_report", sourceId: String(report.id), title: report.status === "rejected" ? "施工日报已退回待修订" : "施工日报待提交或审核", summary: `${dateKey(report.reportDate)} 的施工日报当前为“${report.status === "draft" ? "草稿" : report.status === "submitted" ? "已提交待审核" : "已退回"}”，已停留 ${round(pendingHours, 1)} 小时，超过项目阈值 ${rule.maxPendingReportHours} 小时。`, evidence: { reportId: Number(report.id), pendingHours: round(pendingHours, 1), thresholdHours: rule.maxPendingReportHours, status: report.status } });
  }
  for (const checkIn of checkIns) {
    const openHours = (now.getTime() - checkIn.checkedInAt.getTime()) / 3_600_000;
    candidates.push({ category: "attendance", severity: "warning", ruleCode: "ATTENDANCE_CHECKOUT_MISSING", sourceType: "attendance_check_in", sourceId: String(checkIn.id), title: "考勤下班打卡未完成", summary: `该考勤记录已上班 ${round(openHours, 1)} 小时仍未完成下班打卡，超过项目阈值 ${rule.maxOpenCheckInHours} 小时，请由管理人员复核。`, evidence: { checkInId: Number(checkIn.id), openHours: round(openHours, 1), thresholdHours: rule.maxOpenCheckInHours, locationMissing: checkIn.status === "location_missing" } });
  }
  for (const row of dieselRows.filter(item => item.status !== "void")) {
    const capacity = row.assetType === "vehicle" ? vehicleCapacity.get(Number(row.vehicleId)) ?? 0 : machineCapacity.get(Number(row.machineId)) ?? 0;
    if (capacity <= 0) continue;
    const liters = Number(row.liters);
    const ratio = liters / capacity;
    if (ratio > rule.maxFuelFillRatio) candidates.push({ category: "fuel", severity: ratio > rule.maxFuelFillRatio * 1.25 ? "critical" : "warning", ruleCode: "FUEL_FILL_OVER_CAPACITY", sourceType: "diesel_refuel", sourceId: String(row.id), title: "加油量超过设备核定油箱容量", summary: `本次加油 ${round(liters, 2)} L，占核定油箱 ${round(capacity, 2)} L 的 ${round(ratio * 100, 1)}%，超过项目阈值 ${round(rule.maxFuelFillRatio * 100, 1)}%，请核对设备、油表和加油单。`, evidence: { refuelId: Number(row.id), liters: round(liters, 2), tankCapacityLiters: round(capacity, 2), fillRatio: round(ratio, 3), thresholdRatio: rule.maxFuelFillRatio } });
  }
  for (const trip of trips) candidates.push(...detectTransportRisk(trip, rule));
  return { candidates, scanned: { pendingConstructionReports: reports.length, openAttendanceCheckIns: checkIns.length, dieselRefuelRecords: dieselRows.filter(item => item.status !== "void").length, transportTrips: trips.filter(item => item.status !== "void").length } };
}

async function persistRiskCandidate(projectId: number, businessDate: string, candidate: CandidateRisk) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const day = businessDateValue(businessDate);
  const [existing] = await db.select().from(projectRiskAlerts).where(and(eq(projectRiskAlerts.projectId, projectId), eq(projectRiskAlerts.ruleCode, candidate.ruleCode), eq(projectRiskAlerts.sourceId, candidate.sourceId), eq(projectRiskAlerts.businessDate, day))).limit(1);
  const values = { category: candidate.category, severity: candidate.severity, sourceType: candidate.sourceType, title: candidate.title, summary: candidate.summary, evidenceJson: JSON.stringify(candidate.evidence).slice(0, 8000) };
  if (existing) {
    await db.update(projectRiskAlerts).set(values).where(eq(projectRiskAlerts.id, existing.id));
    return { alert: { ...existing, ...values }, created: false };
  }
  try {
    await db.insert(projectRiskAlerts).values({ projectId, businessDate: day, ruleCode: candidate.ruleCode, sourceId: candidate.sourceId, ...values });
  } catch {
    // 并行扫描由唯一索引去重；下方读取同一条记录继续处理。
  }
  const [created] = await db.select().from(projectRiskAlerts).where(and(eq(projectRiskAlerts.projectId, projectId), eq(projectRiskAlerts.ruleCode, candidate.ruleCode), eq(projectRiskAlerts.sourceId, candidate.sourceId), eq(projectRiskAlerts.businessDate, day))).limit(1);
  if (!created) throw new Error("risk_alert_create_failed");
  return { alert: created, created: true };
}

async function notifyRiskRecipients(project: { id: number; name: string; organizationId: number | null }, alert: typeof projectRiskAlerts.$inferSelect) {
  const db = await getDb();
  if (!db) return 0;
  const recipients = await resolveRiskRecipients(project);
  await Promise.all(recipients.map(recipientUserId => db.insert(notificationRecords).values({
    eventCode: "project_risk_alert",
    idempotencyKey: `inapp:risk:${alert.id}:${recipientUserId}`,
    recipientUserId,
    title: `项目风险提醒｜${project.name}`.slice(0, 200),
    content: `${alert.title}：${alert.summary}`.slice(0, 1000),
    deepLink: "/admin/risk",
    status: "sent",
    sentAt: new Date(),
    channel: "in_app",
  }).onDuplicateKeyUpdate({ set: { title: `项目风险提醒｜${project.name}`.slice(0, 200), content: `${alert.title}：${alert.summary}`.slice(0, 1000), deepLink: "/admin/risk", status: "sent", sentAt: new Date(), channel: "in_app" } })));
  if (recipients.length) await db.update(projectRiskAlerts).set({ notifiedAt: new Date() }).where(eq(projectRiskAlerts.id, alert.id));
  return recipients.length;
}

/** 向整改责任人与项目管理岗位发送逾期升级提醒；按预警、日期、收件人幂等，重试不产生重复消息。 */
async function notifyOverdueRiskEscalation(project: { id: number; name: string; organizationId: number | null }, alert: typeof projectRiskAlerts.$inferSelect, now = new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const escalationDay = dateKey(now);
  const recipientIds = new Set(await resolveRiskRecipients(project));
  if (alert.assigneeUserId) recipientIds.add(alert.assigneeUserId);
  const deadline = alert.dueAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hour12: false }).format(alert.dueAt) : "未设置";
  for (const recipientUserId of Array.from(recipientIds)) {
    const isAssignee = recipientUserId === alert.assigneeUserId;
    await db.insert(notificationRecords).values({
      eventCode: isAssignee ? "project_risk_overdue_owner" : "project_risk_overdue_escalation",
      idempotencyKey: `inapp:risk-overdue:${alert.id}:${escalationDay}:${recipientUserId}`,
      recipientUserId,
      title: `${isAssignee ? "整改已逾期" : "项目风险整改升级"}｜${project.name}`.slice(0, 200),
      content: `${alert.title}：整改期限 ${deadline}，当前仍未解决。请及时核验、更新整改说明或完成处置。`.slice(0, 1000),
      deepLink: "/admin/risk",
      status: "sent",
      sentAt: now,
      channel: "in_app",
    }).onDuplicateKeyUpdate({ set: { title: `${isAssignee ? "整改已逾期" : "项目风险整改升级"}｜${project.name}`.slice(0, 200), content: `${alert.title}：整改期限 ${deadline}，当前仍未解决。请及时核验、更新整改说明或完成处置。`.slice(0, 1000), deepLink: "/admin/risk", status: "sent", sentAt: now, channel: "in_app" } });
  }
  return recipientIds.size;
}

/** 供手动验收与 Heartbeat 共用；仅升级到期未解决预警，并用当日通知幂等键抵抗任务重试。 */
export async function runOverdueRiskEscalationForProject(projectId: number, now = new Date()) {
  const { db, project } = await getProjectOrThrow(projectId);
  const alerts = await db.select().from(projectRiskAlerts).where(and(eq(projectRiskAlerts.projectId, projectId), inArray(projectRiskAlerts.status, ["open", "acknowledged", "in_rectification"]), isNotNull(projectRiskAlerts.dueAt), lte(projectRiskAlerts.dueAt, now)));
  let notifiedCount = 0;
  let escalatedCount = 0;
  const today = dateKey(now);
  for (const alert of alerts) {
    if (alert.lastEscalatedAt && dateKey(alert.lastEscalatedAt) === today) continue;
    notifiedCount += await notifyOverdueRiskEscalation(project, alert, now);
    await db.update(projectRiskAlerts).set({ lastEscalatedAt: now, escalationCount: (alert.escalationCount ?? 0) + 1 }).where(eq(projectRiskAlerts.id, alert.id));
    escalatedCount += 1;
  }
  return { projectId, escalatedCount, notifiedCount };
}

/** 仅接受平台认证的 task UID 查询调度配置，绝不信任回调请求体内的项目编号。 */
export async function runOverdueRiskEscalationForHeartbeatTask(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [rule] = await db.select().from(projectRiskRules).where(eq(projectRiskRules.overdueEscalationCronTaskUid, taskUid)).limit(1);
  if (!rule || !rule.overdueEscalationEnabled) return { status: "skipped" as const, reason: "orphan_or_disabled" };
  return { status: "completed" as const, ...(await runOverdueRiskEscalationForProject(rule.projectId)) };
}

async function getFinanceCategoryAnalysis(projectId: number, period: string) {
  const { db } = await getProjectOrThrow(projectId);
  const range = monthRange(period);
  const [financeRows, dieselRows, payrollRows, machineCosts, maintenanceRows] = await Promise.all([
    db.select({ id: financialRecords.id, category: financialRecords.category, sourceType: financialRecords.sourceType, amount: financialRecords.amount, settlementStatus: financialRecords.settlementStatus, occurredAt: financialRecords.occurredAt }).from(financialRecords).where(and(eq(financialRecords.projectId, projectId), eq(financialRecords.direction, "expense"), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))),
    db.select({ id: dieselRefuelRecords.id, amount: dieselRefuelRecords.amount, refueledAt: dieselRefuelRecords.refueledAt, status: dieselRefuelRecords.status }).from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, projectId), gte(dieselRefuelRecords.refueledAt, range.start), lt(dieselRefuelRecords.refueledAt, range.endExclusive))),
    db.select({ id: payrollStatements.id, amount: payrollStatements.actualAmount, status: payrollStatements.status }).from(payrollStatements).where(and(eq(payrollStatements.projectId, projectId), eq(payrollStatements.period, period))),
    db.select({ id: machineCostRecords.id, costType: machineCostRecords.costType, amount: machineCostRecords.amount, occurredAt: machineCostRecords.occurredAt, dieselRefuelRecordId: machineCostRecords.dieselRefuelRecordId, status: machineCostRecords.status }).from(machineCostRecords).where(and(eq(machineCostRecords.projectId, projectId), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive))),
    db.select({ id: assetMaintenanceRecords.id, assetType: assetMaintenanceRecords.assetType, amount: assetMaintenanceRecords.amount, occurredAt: assetMaintenanceRecords.occurredAt, status: assetMaintenanceRecords.status }).from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.projectId, projectId), gte(assetMaintenanceRecords.occurredAt, range.start), lt(assetMaintenanceRecords.occurredAt, range.endExclusive))),
  ]);
  const buckets = new Map(Object.keys(FINANCE_CATEGORY_LABELS).map(code => [code, { code, label: FINANCE_CATEGORY_LABELS[code], amount: 0, recordCount: 0, sources: new Set<string>() }]));
  const add = (code: string, amount: number, source: string) => {
    const bucket = buckets.get(code) ?? buckets.get("other")!;
    bucket.amount += amount;
    bucket.recordCount += 1;
    bucket.sources.add(source);
  };
  for (const row of financeRows.filter(row => row.settlementStatus !== "void")) add(classifyFinanceCategory(row), Number(row.amount), "财务流水");
  for (const row of dieselRows.filter(row => row.status !== "void")) add("diesel", Number(row.amount), "柴油领用");
  for (const row of payrollRows.filter(row => ["approved", "paid"].includes(row.status))) add("payroll", Number(row.amount), "工资条");
  for (const row of machineCosts.filter(row => row.status !== "void")) add(row.costType === "fuel" ? "diesel" : "machinery", Number(row.amount), "机械成本");
  for (const row of maintenanceRows.filter(row => row.status !== "void")) add(row.assetType === "machine" ? "machinery" : "vehicle_transport", Number(row.amount), "维修保养");
  const categories = Array.from(buckets.values()).map(bucket => ({ ...bucket, amount: round(bucket.amount), sources: Array.from(bucket.sources) })).filter(bucket => bucket.amount > 0).sort((a, b) => b.amount - a.amount);
  const expenseAmount = round(categories.reduce((total, item) => total + item.amount, 0));
  return { period, projectId, expenseAmount, categories: categories.map(item => ({ ...item, percentage: expenseAmount ? round(item.amount / expenseAmount * 100, 2) : 0 })) };
}

function safeParseBriefing(value: string | null | undefined) {
  if (!value) throw new Error("ai_empty_response");
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ai_invalid_response");
  const record = parsed as Record<string, unknown>;
  const toLines = (input: unknown) => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").map(item => item.slice(0, 240)).slice(0, 5) : [];
  if (typeof record.executiveSummary !== "string") throw new Error("ai_invalid_response");
  return { executiveSummary: record.executiveSummary.slice(0, 600), priorityActions: toLines(record.priorityActions), watchItems: toLines(record.watchItems), disclaimer: typeof record.disclaimer === "string" ? record.disclaimer.slice(0, 240) : "该摘要仅辅助管理判断，必须以原始业务单据和现场核验为准。" };
}

export const projectRiskRouter = router({
  getRule: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const { db } = await getProjectOrThrow(input.projectId);
    const [stored] = await db.select().from(projectRiskRules).where(eq(projectRiskRules.projectId, input.projectId)).limit(1);
    return { ...asRule(stored), configured: Boolean(stored) };
  }),

  capacityReadiness: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const { db } = await getProjectOrThrow(input.projectId);
    const [vehicleRows, machineRows] = await Promise.all([
      db.select({ id: transportVehicles.id, label: transportVehicles.plateNo, fuelTankCapacityLiters: transportVehicles.fuelTankCapacityLiters }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      db.select({ id: machines.id, label: machines.name, code: machines.code, fuelTankCapacityLiters: machines.fuelTankCapacityLiters }).from(machines).where(eq(machines.projectId, input.projectId)),
    ]);
    const unconfiguredVehicles = vehicleRows.filter(row => !row.fuelTankCapacityLiters || Number(row.fuelTankCapacityLiters) <= 0).map(row => ({ id: row.id, label: row.label, assetType: "vehicle" as const }));
    const unconfiguredMachines = machineRows.filter(row => !row.fuelTankCapacityLiters || Number(row.fuelTankCapacityLiters) <= 0).map(row => ({ id: row.id, label: `${row.label}（${row.code}）`, assetType: "machine" as const }));
    return { vehicleTotal: vehicleRows.length, vehicleConfigured: vehicleRows.length - unconfiguredVehicles.length, machineTotal: machineRows.length, machineConfigured: machineRows.length - unconfiguredMachines.length, unconfiguredAssets: [...unconfiguredVehicles, ...unconfiguredMachines] };
  }),

  listAssignees: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const { project } = await getProjectOrThrow(input.projectId);
    return resolveRiskAssignees(project);
  }),

  saveRule: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), enabled: z.boolean(), maxFuelFillRatio: z.number().min(1).max(3), maxTransportSpeedKmh: z.number().min(20).max(180), maxTransportDurationMinutes: z.number().int().min(15).max(1440), maxOpenCheckInHours: z.number().int().min(2).max(72), maxPendingReportHours: z.number().int().min(1).max(720), overdueEscalationEnabled: z.boolean().default(false), overdueEscalationHourChina: z.number().int().min(0).max(23).default(9) })).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const { db } = await getProjectOrThrow(input.projectId);
    const [existing] = await db.select().from(projectRiskRules).where(eq(projectRiskRules.projectId, input.projectId)).limit(1);
    let taskUid = existing?.overdueEscalationCronTaskUid ?? null;
    if (input.overdueEscalationEnabled) {
      if (process.env.NODE_ENV !== "production") throw new TRPCError({ code: "BAD_REQUEST", message: "请先保存并发布本版本，再在正式站点启用整改逾期升级任务" });
      const cron = buildRiskOverdueEscalationCron(input.overdueEscalationHourChina);
      if (taskUid) await updateHeartbeatJob(taskUid, { cron, path: "/api/scheduled/project-risk-overdue-escalation", method: "POST", payload: {}, description: `项目风险整改逾期升级｜项目 ${input.projectId}`, enable: true }, "");
      else {
        const task = await createHeartbeatJob({ name: `project-risk-overdue-${input.projectId}`, cron, path: "/api/scheduled/project-risk-overdue-escalation", method: "POST", payload: {}, description: `项目风险整改逾期升级｜项目 ${input.projectId}` }, "");
        taskUid = task.taskUid;
      }
    } else if (taskUid) await updateHeartbeatJob(taskUid, { enable: false }, "");
    const values = { ...input, overdueEscalationCronTaskUid: taskUid, maxFuelFillRatio: String(input.maxFuelFillRatio), maxTransportSpeedKmh: String(input.maxTransportSpeedKmh), createdBy: user.id, updatedBy: user.id };
    if (existing) await db.update(projectRiskRules).set({ ...values, createdBy: undefined }).where(eq(projectRiskRules.id, existing.id));
    else await db.insert(projectRiskRules).values(values);
    await db.insert(auditLogs).values({ userId: user.id, module: "risk", action: "save_project_risk_rule", targetType: "project_risk_rule", targetId: String(input.projectId), summary: `项目风险阈值已保存；逾期升级${input.overdueEscalationEnabled ? `已启用，每日 ${String(input.overdueEscalationHourChina).padStart(2, "0")}:00（中国标准时间）` : "已停用"}` });
    return { success: true, taskUid };
  }),

  scan: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), businessDate: businessDateSchema })).mutation(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const { db, project } = await getProjectOrThrow(input.projectId);
    const [storedRule] = await db.select().from(projectRiskRules).where(eq(projectRiskRules.projectId, input.projectId)).limit(1);
    const rule = asRule(storedRule);
    if (!rule.enabled) return { enabled: false, detectedCount: 0, createdCount: 0, notifiedCount: 0, alerts: [] };
    const { candidates, scanned } = await buildRiskCandidates(input.projectId, input.businessDate, rule);
    let createdCount = 0;
    let notifiedCount = 0;
    const alerts = [] as Array<typeof projectRiskAlerts.$inferSelect>;
    for (const candidate of candidates) {
      const persisted = await persistRiskCandidate(input.projectId, input.businessDate, candidate);
      alerts.push(persisted.alert);
      if (persisted.created) {
        createdCount += 1;
        notifiedCount += await notifyRiskRecipients(project, persisted.alert);
      }
    }
    return { enabled: true, scanned, detectedCount: candidates.length, createdCount, notifiedCount, alerts };
  }),

  listAlerts: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema, status: z.enum(["all", "open", "acknowledged", "in_rectification", "resolved", "ignored"]).default("all") })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const { db } = await getProjectOrThrow(input.projectId);
    const range = monthRange(input.period);
    const predicates = [eq(projectRiskAlerts.projectId, input.projectId), gte(projectRiskAlerts.businessDate, range.start), lt(projectRiskAlerts.businessDate, range.endExclusive)];
    if (input.status !== "all") predicates.push(eq(projectRiskAlerts.status, input.status));
    return db.select().from(projectRiskAlerts).where(and(...predicates)).orderBy(desc(projectRiskAlerts.businessDate), desc(projectRiskAlerts.createdAt));
  }),

  assignRectification: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), assigneeUserId: z.number().int().positive(), dueAt: z.string().datetime(), rectificationNote: z.string().trim().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const { db, project } = await getProjectOrThrow(input.projectId);
    const dueAt = new Date(input.dueAt);
    if (dueAt.getTime() <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: "整改期限必须晚于当前时间" });
    const [alert] = await db.select().from(projectRiskAlerts).where(and(eq(projectRiskAlerts.id, input.id), eq(projectRiskAlerts.projectId, input.projectId))).limit(1);
    if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "风险预警不存在" });
    if (["resolved", "ignored"].includes(alert.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "已完成处置的预警不能再分配整改" });
    const assignees = await resolveRiskAssignees(project);
    if (!assignees.some(item => item.id === input.assigneeUserId)) throw new TRPCError({ code: "FORBIDDEN", message: "责任人必须是当前项目范围内的有效管理人员" });
    const now = new Date();
    await db.update(projectRiskAlerts).set({ status: "in_rectification", assigneeUserId: input.assigneeUserId, assignedBy: user.id, assignedAt: now, dueAt, rectificationNote: input.rectificationNote ?? null }).where(eq(projectRiskAlerts.id, alert.id));
    await db.insert(notificationRecords).values({ eventCode: "project_risk_rectification_assigned", idempotencyKey: `inapp:risk-assigned:${alert.id}:${input.assigneeUserId}:${dueAt.toISOString()}`, recipientUserId: input.assigneeUserId, title: `风险整改待办｜${project.name}`.slice(0, 200), content: `${alert.title}：请在 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hour12: false }).format(dueAt)} 前完成整改并更新处置结果。`.slice(0, 1000), deepLink: "/admin/risk", status: "sent", sentAt: now, channel: "in_app" }).onDuplicateKeyUpdate({ set: { status: "sent", sentAt: now } });
    await db.insert(auditLogs).values({ userId: user.id, module: "risk", action: "assign_risk_rectification", targetType: "project_risk_alert", targetId: String(alert.id), summary: `已分配风险整改责任人 #${input.assigneeUserId}，期限 ${dueAt.toISOString()}` });
    return { success: true };
  }),

  runOverdueEscalation: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    return runOverdueRiskEscalationForProject(input.projectId);
  }),

  updateAlertStatus: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), status: z.enum(["acknowledged", "resolved", "ignored"]), resolutionNote: z.string().trim().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const { db } = await getProjectOrThrow(input.projectId);
    const [alert] = await db.select().from(projectRiskAlerts).where(and(eq(projectRiskAlerts.id, input.id), eq(projectRiskAlerts.projectId, input.projectId))).limit(1);
    if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "风险预警不存在" });
    const now = new Date();
    const values = input.status === "acknowledged" ? { status: input.status, acknowledgedBy: user.id, acknowledgedAt: now, resolutionNote: input.resolutionNote ?? null } : { status: input.status, resolvedBy: user.id, resolvedAt: now, rectifiedBy: input.status === "resolved" ? user.id : null, rectifiedAt: input.status === "resolved" ? now : null, resolutionNote: input.resolutionNote ?? null };
    await db.update(projectRiskAlerts).set(values).where(eq(projectRiskAlerts.id, alert.id));
    return { success: true };
  }),

  financeCategoryAnalysis: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    return getFinanceCategoryAnalysis(input.projectId, input.period);
  }),

  generateBriefing: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertSuperAdmin(ctx);
    const { db, project } = await getProjectOrThrow(input.projectId);
    const range = monthRange(input.period);
    const alerts = await db.select({ category: projectRiskAlerts.category, severity: projectRiskAlerts.severity, ruleCode: projectRiskAlerts.ruleCode, status: projectRiskAlerts.status }).from(projectRiskAlerts).where(and(eq(projectRiskAlerts.projectId, input.projectId), gte(projectRiskAlerts.businessDate, range.start), lt(projectRiskAlerts.businessDate, range.endExclusive)));
    const finance = await getFinanceCategoryAnalysis(input.projectId, input.period);
    const snapshot = { period: input.period, riskCounts: alerts.reduce<Record<string, number>>((result, item) => { const key = `${item.category}_${item.severity}_${item.status}`; result[key] = (result[key] ?? 0) + 1; return result; }, {}), financeCategories: finance.categories.map(item => ({ label: item.label, amount: item.amount, percentage: item.percentage })) };
    const fallback = { executiveSummary: `本期共识别 ${alerts.length} 条项目风险记录，当前支出 ${finance.expenseAmount} 元。请优先核验未关闭的高等级运输、柴油和考勤异常。`, priorityActions: ["按风险清单核对原始单据、现场记录和责任人处理情况。", "对未维护核定油箱容量的车辆与机械补齐主档案后再复核柴油异常。"], watchItems: ["财务分类基于已登记流水和业务成本，人工补录流水需选择准确类别。"], disclaimer: "该摘要仅辅助管理判断，必须以原始业务单据和现场核验为准。" };
    let briefing = fallback;
    let model = "rule-based-fallback";
    try {
      const result = await invokeLLM({ model: "gpt-5-mini", maxTokens: 1200, messages: [{ role: "system", content: "你是工程项目风险管理辅助系统。只根据给出的脱敏汇总生成审慎、可执行的中文管理摘要；不得虚构事实、不得给出法律或财务结论、不得包含任何个人信息。" }, { role: "user", content: `项目：${project.name}；期间：${input.period}。脱敏风险与费用汇总：${JSON.stringify(snapshot)}。请输出 JSON。` }], outputSchema: { name: "project_risk_briefing", strict: true, schema: { type: "object", properties: { executiveSummary: { type: "string" }, priorityActions: { type: "array", items: { type: "string" } }, watchItems: { type: "array", items: { type: "string" } }, disclaimer: { type: "string" } }, required: ["executiveSummary", "priorityActions", "watchItems", "disclaimer"], additionalProperties: false } } });
      briefing = safeParseBriefing(typeof result.choices[0]?.message.content === "string" ? result.choices[0].message.content : null);
      model = result.model || "gpt-5-mini";
    } catch {
      // AI 服务失败时保留可读的规则摘要，不阻断风险检测与财务查看。
    }
    await db.insert(projectRiskBriefings).values({ projectId: input.projectId, period: input.period, model, summaryJson: JSON.stringify(briefing), alertSnapshotJson: JSON.stringify(snapshot), generatedBy: user.id });
    return { source: model === "rule-based-fallback" ? "fallback" as const : "llm" as const, model, briefing };
  }),
});
