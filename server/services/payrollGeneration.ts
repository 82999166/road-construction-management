import { and, eq, inArray } from "drizzle-orm";
import {
  attendanceRecords,
  auditLogs,
  employeeProfiles,
  laborWorkers,
  payrollGenerationRuns,
  payrollGenerationSchedules,
  payrollStatements,
  projects,
  personnelPeople,
  personnelSourceLinks,
  personnelSalaryHistory,
} from "../../drizzle/schema";
import { calculateEmployeePayrollAccrual } from "../../shared/domain";
import { getDb } from "../db";
import { assertCompensationChannel, type BridgeDb } from "./personnelLegacyBridge";
import { chinaBusinessDate, chinaBusinessMonth } from "./chinaBusinessTime";
import { decryptSecret } from "./secretVault";
import { resolvePersonnelSalaryPayer } from "../../shared/personnel";

export const PAYROLL_GENERATION_SCOPE_KEY = "company-monthly-payroll-draft";

export type PayrollAccrualPreview = {
  period: string;
  asOfDate: string;
  eligibleStartDate: string | null;
  eligibleEndDate: string | null;
  confirmedAttendanceDays: number;
  lockedAttendanceDays: number;
  normalHours: number;
  overtimeHours: number;
  calculable: boolean;
  payableAmount: number | null;
  calculationLabel: string;
  blockedReason: string | null;
  existingPayroll: { id: number; status: string; payableAmount: number; actualAmount: number } | null;
  approvedAdvanceAmount: number;
};

type EmployeeProfileForAccrual = {
  id: number;
  laborWorkerId: number | null;
  projectId: number | null;
  employmentStatus: "active" | "suspended" | "left";
  joinedAt: Date | string | null;
  leftAt: Date | string | null;
  salaryBasis: "monthly" | "daily" | "hourly" | "piecework";
  baseSalary: string | number | null;
};

type AttendanceForAccrual = {
  attendanceDate: Date | string;
  workHours: string | number;
  overtimeHours: string | number;
  status: "draft" | "confirmed" | "locked";
};

function assertPayrollPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("工资期间格式必须为 YYYY-MM");
}

function dateKey(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return chinaBusinessDate(value);
}

function clampEligibleRange(profile: EmployeeProfileForAccrual, period: string, asOfDate: string) {
  const periodStart = `${period}-01`;
  const [year, month] = period.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const joinedAt = dateKey(profile.joinedAt);
  const leftAt = dateKey(profile.leftAt);
  const start = [periodStart, joinedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? periodStart;
  const end = [periodEnd, asOfDate, leftAt].filter((value): value is string => Boolean(value)).sort()[0] ?? asOfDate;
  return start > end ? null : { start, end };
}

export function buildPayrollAccrualPreview(params: {
  profile: EmployeeProfileForAccrual;
  period: string;
  asOfDate: string;
  attendanceRows: AttendanceForAccrual[];
  existingPayroll?: { id: number; status: string; payableAmount: string | number; actualAmount: string | number } | null;
  approvedAdvanceAmount?: number;
  salaryHistory?: SalaryVersion[];
}): PayrollAccrualPreview {
  assertPayrollPeriod(params.period);
  const range = clampEligibleRange(params.profile, params.period, params.asOfDate);
  const inRange = range
    ? params.attendanceRows.filter(row => {
        const attendanceDate = dateKey(row.attendanceDate);
        return Boolean(attendanceDate && attendanceDate >= range.start && attendanceDate <= range.end);
      })
    : [];
  const versions = params.salaryHistory === undefined ? undefined : [...params.salaryHistory].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const eligibleAttendance = inRange.filter(row => {
    if (row.status !== "confirmed" && row.status !== "locked") return false;
    const version = versions?.find(v => v.effectiveFrom <= dateKey(row.attendanceDate)!);
    // 无覆盖历史必须保留给核算函数明确阻断；已证明关停/外部/日结阶段不属于月薪。
    return !version || resolvePersonnelSalaryPayer(version).salaryPayerType === "company" && version.payrollEnabled && version.affiliation !== "external" && version.affiliation !== "temporary";
  });
  const confirmedAttendanceDays = eligibleAttendance.length;
  const lockedAttendanceDays = eligibleAttendance.filter(row => row.status === "locked").length;
  const normalHours = eligibleAttendance.reduce((sum, row) => sum + Number(row.workHours), 0);
  const overtimeHours = eligibleAttendance.reduce((sum, row) => sum + Number(row.overtimeHours), 0);
  const existingPayroll = params.existingPayroll
    ? {
        id: params.existingPayroll.id,
        status: params.existingPayroll.status,
        payableAmount: Number(params.existingPayroll.payableAmount),
        actualAmount: Number(params.existingPayroll.actualAmount),
      }
    : null;

  if (!params.profile.laborWorkerId || !params.profile.projectId) {
    return {
      period: params.period,
      asOfDate: params.asOfDate,
      eligibleStartDate: range?.start ?? null,
      eligibleEndDate: range?.end ?? null,
      confirmedAttendanceDays,
      lockedAttendanceDays,
      normalHours,
      overtimeHours,
      calculable: false,
      payableAmount: null,
      calculationLabel: "—",
      blockedReason: "该员工尚未关联统一劳务工资主体或项目，不能自动生成工资条",
      existingPayroll,
      approvedAdvanceAmount: params.approvedAdvanceAmount ?? 0,
    };
  }
  if (params.profile.employmentStatus !== "active" && !range) {
    return {
      period: params.period,
      asOfDate: params.asOfDate,
      eligibleStartDate: null,
      eligibleEndDate: null,
      confirmedAttendanceDays: 0,
      lockedAttendanceDays: 0,
      normalHours: 0,
      overtimeHours: 0,
      calculable: false,
      payableAmount: null,
      calculationLabel: "—",
      blockedReason: "该员工在所选工资期间无有效在职日期",
      existingPayroll,
      approvedAdvanceAmount: params.approvedAdvanceAmount ?? 0,
    };
  }
  if (!confirmedAttendanceDays) {
    return {
      period: params.period,
      asOfDate: params.asOfDate,
      eligibleStartDate: range?.start ?? null,
      eligibleEndDate: range?.end ?? null,
      confirmedAttendanceDays,
      lockedAttendanceDays,
      normalHours,
      overtimeHours,
      calculable: false,
      payableAmount: null,
      calculationLabel: "—",
      blockedReason: "所选期间暂无已确认或已锁定考勤，不能自动生成工资条",
      existingPayroll,
      approvedAdvanceAmount: params.approvedAdvanceAmount ?? 0,
    };
  }
  const calculation = params.salaryHistory !== undefined
    ? calculateEffectiveSalaryAccrual(eligibleAttendance, params.salaryHistory)
    : calculateEmployeePayrollAccrual({
    salaryBasis: params.profile.salaryBasis,
    baseSalary: params.profile.baseSalary === null ? null : Number(params.profile.baseSalary),
    confirmedAttendanceDays,
    normalHours,
    overtimeHours,
  });
  return {
    period: params.period,
    asOfDate: params.asOfDate,
    eligibleStartDate: range?.start ?? null,
    eligibleEndDate: range?.end ?? null,
    confirmedAttendanceDays,
    lockedAttendanceDays,
    normalHours,
    overtimeHours,
    ...calculation,
    existingPayroll,
    approvedAdvanceAmount: params.approvedAdvanceAmount ?? 0,
  };
}

export type SalaryVersion = { effectiveFrom: string; salaryBasis: "monthly" | "daily" | "hourly" | "piecework"; baseSalary: string | number | null; payrollEnabled: boolean; affiliation?: string; salaryPayerType?: string | null; salaryPayerName?: string | null };

/** 同月调薪逐考勤日匹配生效版本，不以今天mirror回写历史。月薪沿用现有30天折算。 */
export function calculateEffectiveSalaryAccrual(attendance: AttendanceForAccrual[], history: SalaryVersion[]) {
  const versions = [...history].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  let total = 0;
  for (const row of attendance) {
    const date = dateKey(row.attendanceDate)!;
    const version = versions.find(v => v.effectiveFrom <= date);
    if (!version) return { calculable: false, payableAmount: null, calculationLabel: "—", blockedReason: "考勤日期缺少生效薪资历史，不能用今天薪资猜算过去工资" };
    if (resolvePersonnelSalaryPayer(version).salaryPayerType === "owner") return { calculable: false, payableAmount: null, calculationLabel: "—", blockedReason: "考勤当日由车队/机械老板自行发放工资，不属于公司工资" };
    if (!version.payrollEnabled || version.affiliation === "external" || version.affiliation === "temporary") return { calculable: false, payableAmount: null, calculationLabel: "—", blockedReason: "考勤当日未启用月度工资或属于外部/临时日结人员" };
    // 避免每日四舍五入累积；先校验单日规则，再按未舍入金额汇总。
    const calculation = calculateEmployeePayrollAccrual({ salaryBasis: version.salaryBasis, baseSalary: version.baseSalary === null ? null : Number(version.baseSalary), confirmedAttendanceDays: 1, normalHours: Number(row.workHours), overtimeHours: Number(row.overtimeHours) });
    if (!calculation.calculable) return calculation;
    const rate = Number(version.baseSalary);
    total += version.salaryBasis === "monthly" ? rate / 30 : version.salaryBasis === "daily" ? rate : rate * (Number(row.workHours) + Number(row.overtimeHours));
  }
  return { calculable: true, payableAmount: Math.round((total + Number.EPSILON) * 100) / 100, calculationLabel: "按每条已确认考勤日期的生效薪资版本核算（月薪按30天折算）", blockedReason: null };
}

async function getProfileAccrualData(profile: EmployeeProfileForAccrual, period: string, asOfDate: string, suppliedDb?: BridgeDb) {
  const db = suppliedDb ?? await getDb();
  if (!db) throw new Error("database_unavailable");
  const empty = () => buildPayrollAccrualPreview({ profile, period, asOfDate, attendanceRows: [] });
  if (!profile.laborWorkerId || !profile.projectId) return empty();
  let channel;
  try { channel = await assertCompensationChannel(db, { workerId: profile.laborWorkerId, projectId: profile.projectId, period, channel: "monthly", lock: Boolean(suppliedDb), historicalEligibility: true }); }
  catch (error) { return { ...empty(), calculable: false, payableAmount: null, blockedReason: error instanceof Error ? error.message : "工资主体校验失败" }; }
  if (suppliedDb) {
    // 锁master/worker后使用current read，不能沿用事务开始时读到的转人前任职范围。
    const [currentProfile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, profile.id)).limit(1).for("update");
    if (!currentProfile || currentProfile.laborWorkerId !== profile.laborWorkerId || currentProfile.projectId !== profile.projectId) return { ...empty(), calculable: false, payableAmount: null, blockedReason: "工资主体归属已变化，请刷新后重试" };
    profile = currentProfile;
  }
  if (!profile.laborWorkerId || !profile.projectId) return empty();
  const existingQuery = db.select({ id: payrollStatements.id, status: payrollStatements.status, payableAmount: payrollStatements.payableAmount, actualAmount: payrollStatements.actualAmount }).from(payrollStatements).where(and(eq(payrollStatements.workerId, profile.laborWorkerId), eq(payrollStatements.projectId, profile.projectId), eq(payrollStatements.period, period))).limit(1);
  const [attendanceRows, existingRows] = await Promise.all([
    db.select({ attendanceDate: attendanceRecords.attendanceDate, workHours: attendanceRecords.workHours, overtimeHours: attendanceRecords.overtimeHours, status: attendanceRecords.status }).from(attendanceRecords).where(and(eq(attendanceRecords.workerId, profile.laborWorkerId), eq(attendanceRecords.projectId, profile.projectId))),
    suppliedDb ? existingQuery.for("update") : existingQuery,
  ]);
  let salaryHistory: SalaryVersion[];
  if (channel.person) {
    const salaryQuery = db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, channel.person.id));
    salaryHistory = await (suppliedDb ? salaryQuery.for("update") : salaryQuery);
  } else {
    // 未采用旧档案没有历史版本，仅创建时间及以后可证明适用当前旧薪资，早于该日期不可猜算。
    const [original] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, profile.id)).limit(1);
    salaryHistory = original ? [{ effectiveFrom: dateKey(original.joinedAt ?? original.createdAt)!, salaryBasis: original.salaryBasis, baseSalary: original.baseSalary, payrollEnabled: true }] : [];
  }
  return buildPayrollAccrualPreview({ profile, period, asOfDate, attendanceRows, existingPayroll: existingRows[0] ?? null, salaryHistory });
}

/** 单人员详情使用：数据按人员、期间按需读取，避免花名册全量扫描用于工资核算。 */
export async function getEmployeePayrollAccrualPreview(employeeProfileId: number, period = chinaBusinessMonth(new Date()), asOfDate = chinaBusinessDate(new Date())) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [profile] = await db.select({
    id: employeeProfiles.id,
    laborWorkerId: employeeProfiles.laborWorkerId,
    projectId: employeeProfiles.projectId,
    employmentStatus: employeeProfiles.employmentStatus,
    joinedAt: employeeProfiles.joinedAt,
    leftAt: employeeProfiles.leftAt,
    salaryBasis: employeeProfiles.salaryBasis,
    baseSalary: employeeProfiles.baseSalary,
  }).from(employeeProfiles).where(eq(employeeProfiles.id, employeeProfileId)).limit(1);
  if (!profile) throw new Error("employee_profile_not_found");
  return getProfileAccrualData(profile, period, asOfDate);
}

export async function generatePayrollDraftForEmployeeProfile(input: { employeeProfileId: number; period: string; actorUserId: number; source: "manual" | "schedule" }) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  assertPayrollPeriod(input.period);
  return db.transaction(async tx => {
  const [profile] = await tx.select({
    id: employeeProfiles.id,
    laborWorkerId: employeeProfiles.laborWorkerId,
    projectId: employeeProfiles.projectId,
    employmentStatus: employeeProfiles.employmentStatus,
    joinedAt: employeeProfiles.joinedAt,
    leftAt: employeeProfiles.leftAt,
    salaryBasis: employeeProfiles.salaryBasis,
    baseSalary: employeeProfiles.baseSalary,
  }).from(employeeProfiles).where(eq(employeeProfiles.id, input.employeeProfileId)).limit(1);
  if (!profile) throw new Error("employee_profile_not_found");
  const asOfDate = `${input.period}-${new Date(Date.UTC(Number(input.period.slice(0, 4)), Number(input.period.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, "0")}`;
  const preview = await getProfileAccrualData(profile, input.period, asOfDate, tx);
  if (preview.existingPayroll) return { status: "skipped" as const, reason: "已有同项目同期间工资条", preview };
  if (!preview.calculable || preview.payableAmount === null) return { status: "blocked" as const, reason: preview.blockedReason ?? "工资核算条件未满足", preview };
  const [worker] = await tx.select({ bankAccountEncrypted: laborWorkers.bankAccountEncrypted }).from(laborWorkers).where(eq(laborWorkers.id, profile.laborWorkerId!)).limit(1);
  const bankAccountMasked = worker?.bankAccountEncrypted ? decryptSecret(worker.bankAccountEncrypted) : null;
  try {
    await tx.insert(payrollStatements).values({
      workerId: profile.laborWorkerId!,
      projectId: profile.projectId!,
      period: input.period,
      payableAmount: String(preview.payableAmount),
      deductionAmount: "0",
      actualAmount: String(preview.payableAmount),
      bankAccountMasked,
      status: "draft",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (/duplicate|unique/i.test(code)) return { status: "skipped" as const, reason: "已有同项目同期间工资条", preview };
    throw error;
  }
  await tx.insert(auditLogs).values({
    userId: input.actorUserId,
    module: "labor",
    action: input.source === "schedule" ? "auto_generate_payroll_draft" : "generate_payroll_draft",
    targetType: "payroll_statement",
    targetId: `${profile.laborWorkerId}-${input.period}`,
    summary: `${input.period} 根据已确认考勤生成工资草稿；需经会计审核和财务发放确认`,
  });
  return { status: "created" as const, preview };
  });
}

/** 全项目批量生成仅创建草稿；已存在工资条、缺少考勤或计件数据均不会覆盖或写入零金额。 */
export async function generatePayrollDraftsForProject(input: { projectId: number; period: string; actorUserId: number; source: "manual" | "schedule" }) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  // 今日离任/转项目不能排除旧项目往月资格，逐profile有效日期与salaryHistory由service判断。
  const profiles = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.projectId, input.projectId));
  let createdCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;
  for (const profile of profiles) {
    const result = await generatePayrollDraftForEmployeeProfile({ ...input, employeeProfileId: profile.id });
    if (result.status === "created") createdCount += 1;
    else if (result.status === "skipped") skippedCount += 1;
    else blockedCount += 1;
  }
  return { projectId: input.projectId, period: input.period, createdCount, skippedCount, blockedCount };
}

export async function runScheduledPayrollDraftGeneration(scheduleId: number) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [schedule] = await db.select().from(payrollGenerationSchedules).where(eq(payrollGenerationSchedules.id, scheduleId)).limit(1);
  if (!schedule || !schedule.enabled) return { status: "ignored" as const, period: chinaBusinessMonth(new Date()) };
  const now = new Date();
  const currentPeriod = chinaBusinessMonth(now);
  const [year, month] = currentPeriod.split("-").map(Number);
  const targetPeriod = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const actorUserId = schedule.updatedBy ?? schedule.createdBy;
  if (!actorUserId) throw new Error("payroll_schedule_missing_actor");
  const activeProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.status, "active"));
  let createdCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;
  let failedCount = 0;
  for (const project of activeProjects) {
    try {
      const result = await generatePayrollDraftsForProject({ projectId: project.id, period: targetPeriod, actorUserId, source: "schedule" });
      createdCount += result.createdCount;
      skippedCount += result.skippedCount;
      blockedCount += result.blockedCount;
      await db.insert(payrollGenerationRuns).values({
        scheduleId: schedule.id,
        projectId: project.id,
        period: targetPeriod,
        status: result.blockedCount ? "partial" : "completed",
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        blockedCount: result.blockedCount,
        summaryJson: JSON.stringify(result),
        completedAt: new Date(),
      }).onDuplicateKeyUpdate({ set: { status: result.blockedCount ? "partial" : "completed", createdCount: result.createdCount, skippedCount: result.skippedCount, blockedCount: result.blockedCount, summaryJson: JSON.stringify(result), completedAt: new Date() } });
    } catch {
      failedCount += 1;
    }
  }
  const summary = { period: targetPeriod, projectCount: activeProjects.length, createdCount, skippedCount, blockedCount, failedCount };
  await db.update(payrollGenerationSchedules).set({ lastAttemptedAt: now, lastSuccessfulPeriod: failedCount ? schedule.lastSuccessfulPeriod : targetPeriod, lastResultJson: JSON.stringify(summary) }).where(eq(payrollGenerationSchedules.id, schedule.id));
  return { status: failedCount ? "partial" as const : "completed" as const, ...summary };
}

export async function runScheduledPayrollDraftGenerationForHeartbeatTask(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const [schedule] = await db.select().from(payrollGenerationSchedules).where(and(eq(payrollGenerationSchedules.scheduleCronTaskUid, taskUid), eq(payrollGenerationSchedules.enabled, true))).limit(1);
  if (!schedule) return { status: "ignored" as const, reason: "orphan_or_disabled" };
  return runScheduledPayrollDraftGeneration(schedule.id);
}

export function buildMonthlyPayrollGenerationCron(generationDay: number, generationHour: number, generationMinute: number) {
  if (!Number.isInteger(generationDay) || generationDay < 1 || generationDay > 28) throw new Error("工资生成日期必须为每月 1—28 日");
  if (!Number.isInteger(generationHour) || generationHour < 0 || generationHour > 23 || !Number.isInteger(generationMinute) || generationMinute < 0 || generationMinute > 59) throw new Error("工资生成时间无效");
  return `0 ${generationMinute} ${(generationHour + 16) % 24} ${generationDay} * *`;
}
