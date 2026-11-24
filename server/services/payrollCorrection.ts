import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { financialRecords, payrollStatements, projects, settlementPaymentRecords, temporaryDailyWageSettlements } from "../../drizzle/schema";
import type { getDb } from "../db";

type CorrectionClient = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">;

/** 与付款/封账同序：项目 -> 工资主单 -> 有效资金。不要在工资锁后再等项目锁。 */
export async function lockPayrollCorrectionScope(tx: CorrectionClient, projectId: number) {
  const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "当前项目不存在，请刷新后重试" });
}

/** 状态可能来自历史数据，不能仅凭 approved/draft 假定从未付过款。 */
export async function assertPayrollHasNoEffectiveFunds(tx: CorrectionClient, input: { projectId: number; settlementId: number; settlementType: "payroll" | "daily_wage" }) {
  const payments = await tx.select({ id: settlementPaymentRecords.id }).from(settlementPaymentRecords).where(and(
    eq(settlementPaymentRecords.projectId, input.projectId), eq(settlementPaymentRecords.settlementType, input.settlementType),
    eq(settlementPaymentRecords.settlementId, input.settlementId), eq(settlementPaymentRecords.status, "active"),
  )).for("update");
  const legacyFunds = await tx.select({ id: financialRecords.id }).from(financialRecords).where(and(
    eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceId, String(input.settlementId)),
    inArray(financialRecords.sourceType, input.settlementType === "payroll" ? ["payroll", "payroll_statement"] : ["daily_wage", "temporary_daily_wage"]),
    inArray(financialRecords.settlementStatus, ["partial", "paid"]),
  )).for("update");
  if (payments.length || legacyFunds.length) throw new TRPCError({ code: "CONFLICT", message: "该工资记录已有有效资金发生，不可退回、覆盖或作废；请财务办理受控调整" });
}

export async function lockMonthlyPayroll(tx: CorrectionClient, id: number, projectId: number) {
  const [row] = await tx.select().from(payrollStatements).where(and(eq(payrollStatements.id, id), eq(payrollStatements.projectId, projectId))).limit(1).for("update");
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在或已变更项目" });
  return row;
}

export async function lockDailyPayroll(tx: CorrectionClient, id: number, projectId: number) {
  const [row] = await tx.select().from(temporaryDailyWageSettlements).where(and(eq(temporaryDailyWageSettlements.id, id), eq(temporaryDailyWageSettlements.projectId, projectId))).limit(1).for("update");
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "临时日结不存在或已变更项目" });
  return row;
}

export function assertPayrollCorrectionWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object" || !("affectedRows" in header) || Number((header as { affectedRows: unknown }).affectedRows) !== 1) {
    throw new TRPCError({ code: "CONFLICT", message: "工资记录已被其他用户更新，请刷新后重试" });
  }
}
