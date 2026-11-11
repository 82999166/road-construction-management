import { createHash } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  laborWorkers,
  machinePaymentSettlements,
  payrollStatements,
  projects,
  subcontractPaymentSettlements,
  temporaryDailyWageSettlements,
  transportVehicleSettlements,
} from "../../drizzle/schema";
import { canApprovePayroll } from "../../shared/domain";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getDepartmentModuleDataScope,
  getEffectiveRoleCodes,
  getRoleOperationPermissionDecision,
  getSuperAdminAccess,
  hasUserSpecificOperationPermission,
  requireAuthenticatedUser,
} from "../access";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";

export const financeApprovalTypeSchema = z.enum([
  "transport_vehicle",
  "machine",
  "payroll",
  "daily_wage",
  "subcontract",
]);
export type FinanceApprovalType = z.infer<typeof financeApprovalTypeSchema>;
const labels: Record<FinanceApprovalType, string> = {
  transport_vehicle: "车辆结算",
  machine: "机械结算",
  payroll: "工资发放",
  daily_wage: "临时日结",
  subcontract: "分包结算",
};
export const financeApprovalQueueInput = z.object({
  projectId: z.number().int().positive(),
  sourceTypes: z.array(financeApprovalTypeSchema).max(5).optional(),
  keyword: z.string().trim().max(128).default(""),
});
export const financeApproveInput = z.object({
  projectId: z.number().int().positive(),
  settlementType: financeApprovalTypeSchema,
  settlementId: z.number().int().positive(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FinanceApprovalRow = {
  sourceType: FinanceApprovalType;
  settlementId: number;
  settlementNo: string;
  sourceLabel: string;
  counterpartyDisplay: string;
  periodLabel: string;
  businessStatus: "submitted" | "reviewing";
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  createdAt: string | null;
  updatedAt: string | null;
  submittedAt: string | null;
  itemsSummary: string;
  canApprove: boolean;
  approvalUnavailableReason: string | null;
  fingerprint: string;
};
type ApprovalDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
function isolated(ctx: TrpcContext): TrpcContext {
  return { ...ctx };
}
export async function assertFinanceApprovalRead(
  ctx: TrpcContext,
  projectId?: number
) {
  const user = requireAuthenticatedUser(ctx);
  if (user.loginMethod === "local_driver")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "司机账号不能访问财务审核中心",
    });
  const financeCtx = isolated(ctx);
  await assertDepartmentBusinessAccess(financeCtx, "FINANCE", "read");
  const roles = await getEffectiveRoleCodes(financeCtx);
  if (
    !roles.some(role =>
      ["ALL", "ACCOUNTANT", "FINANCE_MANAGER", "CASHIER"].includes(role)
    )
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位无权查看财务审核中心",
    });
  if (projectId !== undefined)
    await assertProjectInCurrentScope(financeCtx, projectId);
  return { financeCtx, roles };
}
export async function financeApprovalDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用，无法读取财务待审数量",
    });
  return db;
}
async function forbiddenAsReason(fn: () => Promise<void>) {
  try {
    await fn();
    return null;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN")
      return error.message;
    throw error; // 数据库/鉴权服务故障不得伪装为无权限或假0。
  }
}
/** 精确延续现有 protectedProcedure 的详细权限与普通管理员高影响守卫；不扩大原业务权限。 */
async function originalMutationGuard(
  ctx: TrpcContext,
  module: "FINANCE" | "TRANSPORT" | "MACHINERY" | "LABOR" | "MEASUREMENT",
  action: "settle" | "review",
  dedicated = false
) {
  const { canAccess } = await getSuperAdminAccess(ctx);
  if (canAccess) return;
  const decision = await getRoleOperationPermissionDecision(
    ctx,
    module,
    action
  );
  if (!decision.allowed || (!dedicated && !decision.hasDetailedPermissions))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "原业务审核入口需要对应详细操作授权，请联系超级管理员核实权限矩阵",
    });
}
export async function financeApprovalCapability(
  ctx: TrpcContext,
  projectId: number,
  sourceType: FinanceApprovalType
) {
  const user = requireAuthenticatedUser(ctx);
  return forbiddenAsReason(async () => {
    const financeCtx = isolated(ctx);
    await assertDepartmentBusinessAccess(financeCtx, "FINANCE", "review");
    await assertProjectInCurrentScope(financeCtx, projectId);
    // settlementPayment.approve 的现有通用中间件按 payment 命名推导 settle，须同样满足。
    await originalMutationGuard(financeCtx, "FINANCE", "settle");
    const roles = await getEffectiveRoleCodes(financeCtx);
    if (
      !roles.some(role =>
        ["ALL", "ACCOUNTANT", "FINANCE_MANAGER"].includes(role)
      )
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "财务审核仅限会计、财务负责人或系统管理员",
      });
    const originalCtx = isolated(ctx);
    if (sourceType === "transport_vehicle" || sourceType === "machine") {
      const module = sourceType === "machine" ? "MACHINERY" : "TRANSPORT";
      await assertDepartmentBusinessAccess(originalCtx, module, "read");
      const permittedRoles =
        sourceType === "machine"
          ? ["ALL", "MACHINERY_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"]
          : [
              "ALL",
              "TRANSPORT_MANAGER",
              "DRIVER",
              "PROJECT_MANAGER",
              "FINANCE_MANAGER",
              "ACCOUNTANT",
            ];
      if (
        !roles.some(role => permittedRoles.includes(role)) &&
        !(await hasUserSpecificOperationPermission(originalCtx, module, "read"))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位未获原业务数据访问授权",
        });
      await assertProjectInCurrentScope(originalCtx, projectId);
      await assertDepartmentBusinessAccess(originalCtx, module, "review");
      await originalMutationGuard(originalCtx, module, "settle");
    } else if (sourceType === "payroll" || sourceType === "daily_wage") {
      await assertDepartmentBusinessAccess(originalCtx, "LABOR", "read");
      await assertProjectInCurrentScope(originalCtx, projectId);
      await assertDepartmentBusinessAccess(originalCtx, "LABOR", "review");
      if (sourceType === "payroll" && !canApprovePayroll(roles))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "工资审核仅限会计岗位办理",
        });
      // 工资虽然由会计岗位办理，但仍必须保留原劳务结算的详细授权；
      // 不能因为进入财务审核中心就绕过劳务模块的高影响操作守卫。
      await originalMutationGuard(
        originalCtx,
        "LABOR",
        sourceType === "payroll" ? "settle" : "review"
      );
    } else {
      // 与原分包路由相同：计量read优先，FORBIDDEN时回退财务read，不能混用项目范围。
      try {
        await assertDepartmentBusinessAccess(
          originalCtx,
          "MEASUREMENT",
          "read"
        );
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN")
          throw error;
        await assertDepartmentBusinessAccess(originalCtx, "FINANCE", "read");
      }
      await assertProjectInCurrentScope(originalCtx, projectId);
      await originalMutationGuard(originalCtx, "MEASUREMENT", "review");
    }
    if (user.loginMethod === "local_driver")
      throw new TRPCError({ code: "FORBIDDEN", message: "司机账号不能审核" });
  });
}
function dateText(value: Date | string | null | undefined) {
  return value == null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : String(value);
}
function money(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount))
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "结算金额数据异常，请核实后再审核",
    });
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
/** 显式列投影：即使未来主表增加密文、账户或证据字段也不会进入财务审核 DTO。 */
async function readPending(
  db: ApprovalDb,
  projectId: number,
  type: FinanceApprovalType
) {
  if (type === "transport_vehicle") {
    const t = transportVehicleSettlements;
    const rows = await db
      .select({
        id: t.id,
        projectId: t.projectId,
        no: t.settlementNo,
        object: t.payeeName,
        start: t.periodStart,
        end: t.periodEnd,
        status: t.status,
        gross: t.grossFreightAmount,
        fuel: t.fuelDeductionAmount,
        asset: t.assetDeductionAmount,
        carry: t.carryForwardDeductionAmount,
        net: t.netPayableAmount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        submittedAt: t.submittedAt,
        submittedBy: t.submittedBy,
        tripCount: t.tripCount,
        volume: t.totalVolumeCubicMeters,
        kind: t.settlementKind,
        basis: t.basisDescription,
      })
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.status, "submitted")));
    return rows.map(row => ({
      ...row,
      period: `${dateText(row.start)?.slice(0, 10)} 至 ${dateText(row.end)?.slice(0, 10)}`,
      deduction: money(row.fuel) + money(row.asset) + money(row.carry),
      summary: `${row.kind === "lease" ? "租赁" : row.kind === "adjustment" ? "调整" : "运费"}结算；${row.tripCount} 趟，${row.volume} m³；油款 ${row.fuel}，资产费用 ${row.asset}，前期抵扣 ${row.carry}${row.basis ? `；${row.basis}` : ""}`,
    }));
  }
  if (type === "machine") {
    const t = machinePaymentSettlements;
    const rows = await db
      .select({
        id: t.id,
        projectId: t.projectId,
        no: t.settlementNo,
        object: t.payeeName,
        period: t.period,
        status: t.status,
        gross: t.grossPayableAmount,
        deduction: t.manualDeductionAmount,
        net: t.netPayableAmount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        submittedAt: t.submittedAt,
        submittedBy: t.submittedBy,
        monthlyId: t.monthlyStatementId,
        fuel: t.fuelCostAmount,
        repair: t.repairCostAmount,
      })
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.status, "submitted")));
    return rows.map(row => ({
      ...row,
      summary: `已审核机械月结 #${row.monthlyId}；油料成本 ${row.fuel}、维修成本 ${row.repair} 为参考依据，不重复扣减；受控扣款 ${row.deduction}`,
    }));
  }
  if (type === "subcontract") {
    const t = subcontractPaymentSettlements;
    const rows = await db
      .select({
        id: t.id,
        projectId: t.projectId,
        no: t.settlementNo,
        object: t.payeeName,
        period: t.packageNoSnapshot,
        status: t.status,
        gross: t.grossPayableAmount,
        deduction: t.manualDeductionAmount,
        net: t.netPayableAmount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        submittedAt: t.submittedAt,
        submittedBy: t.submittedBy,
        workItem: t.workItemSnapshot,
        quantity: t.quantitySnapshot,
        unit: t.unitSnapshot,
        invoiceStatus: t.invoiceStatus,
      })
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.status, "submitted")));
    return rows.map(row => ({
      ...row,
      summary: `${row.period}；${row.workItem} ${row.quantity} ${row.unit}；发票状态 ${row.invoiceStatus}`,
    }));
  }
  if (type === "payroll") {
    const t = payrollStatements;
    const rows = await db
      .select({
        id: t.id,
        projectId: t.projectId,
        object: laborWorkers.realName,
        period: t.period,
        status: t.status,
        gross: t.payableAmount,
        deduction: t.deductionAmount,
        net: t.actualAmount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        submittedAt: t.submittedAt,
        submittedBy: t.submittedBy,
      })
      .from(t)
      .leftJoin(laborWorkers, eq(t.workerId, laborWorkers.id))
      .where(and(eq(t.projectId, projectId), eq(t.status, "reviewing")));
    return rows.map(row => ({
      ...row,
      no: `工资-${row.period}-${row.id}`,
      summary: `${row.period} 已提交工资条；应发减扣款为实发`,
    }));
  }
  const t = temporaryDailyWageSettlements;
  const rows = await db
    .select({
      id: t.id,
      projectId: t.projectId,
      object: laborWorkers.realName,
      date: t.settlementDate,
      status: t.status,
      gross: t.payableAmount,
      deduction: t.deductionAmount,
      net: t.actualAmount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      submittedAt: t.submittedAt,
      submittedBy: t.submittedBy,
    })
    .from(t)
    .leftJoin(laborWorkers, eq(t.workerId, laborWorkers.id))
    .where(and(eq(t.projectId, projectId), eq(t.status, "reviewing")));
  return rows.map(row => ({
    ...row,
    period: dateText(row.date)!.slice(0, 10),
    no: `日结-${dateText(row.date)!.slice(0, 10)}-${row.id}`,
    summary: `${dateText(row.date)!.slice(0, 10)} 已提交临时日结；应发减扣款为实发`,
  }));
}
export async function readFinanceApprovalRows(
  ctx: TrpcContext,
  db: ApprovalDb,
  projectId: number,
  sourceTypes: readonly FinanceApprovalType[] = financeApprovalTypeSchema.options
) {
  const user = requireAuthenticatedUser(ctx);
  const roles = await getEffectiveRoleCodes(ctx);
  const batches = await Promise.all(
    Array.from(new Set(sourceTypes)).map(async sourceType => {
      const [pending, unavailable] = await Promise.all([
        readPending(db, projectId, sourceType),
        financeApprovalCapability(ctx, projectId, sourceType),
      ]);
      return pending.map(raw => {
        const reason =
          sourceType === "subcontract" &&
          raw.submittedBy === user.id &&
          !roles.includes("ALL")
            ? "提交人与会计审核人必须职责分离"
            : unavailable;
        const row: Omit<FinanceApprovalRow, "fingerprint"> = {
          sourceType,
          settlementId: raw.id,
          settlementNo: raw.no,
          sourceLabel: labels[sourceType],
          counterpartyDisplay: raw.object || "待核实收款对象",
          periodLabel: raw.period,
          businessStatus: raw.status as "submitted" | "reviewing",
          grossAmount: money(raw.gross),
          deductionAmount: money(raw.deduction),
          netAmount: money(raw.net),
          createdAt: dateText(raw.createdAt),
          updatedAt: dateText(raw.updatedAt),
          submittedAt: dateText(raw.submittedAt),
          itemsSummary: raw.summary,
          canApprove: reason === null,
          approvalUnavailableReason: reason,
        };
        // 能力不是版本事实，授权变动需重新校验；金额/状态/源单摘要/提交人与时间必须匹配用户看到的快照。
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              projectId,
              sourceType,
              id: raw.id,
              no: row.settlementNo,
              object: row.counterpartyDisplay,
              period: row.periodLabel,
              state: row.businessStatus,
              gross: row.grossAmount,
              deductions: row.deductionAmount,
              net: row.netAmount,
              updatedAt: row.updatedAt,
              submittedAt: row.submittedAt,
              submittedBy: raw.submittedBy,
              summary: row.itemsSummary,
            })
          )
          .digest("hex");
        return { ...row, fingerprint };
      });
    })
  );
  return batches
    .flat()
    .sort(
      (a, b) =>
        (b.submittedAt ?? b.createdAt ?? "").localeCompare(
          a.submittedAt ?? a.createdAt ?? ""
        ) || a.settlementNo.localeCompare(b.settlementNo, "zh-CN")
    );
}
export async function readFinanceApprovalSummary(
  ctx: TrpcContext,
  projectId?: number
) {
  const { financeCtx } = await assertFinanceApprovalRead(ctx, projectId);
  const db = await financeApprovalDb();
  let projectIds = projectId === undefined ? ([] as number[]) : [projectId];
  if (projectId === undefined) {
    const scope = await getDepartmentModuleDataScope(financeCtx, "FINANCE");
    if (scope.hasAllProjects)
      projectIds = (await db.select({ id: projects.id }).from(projects)).map(
        row => row.id
      );
    else if (scope.projectIds.length || scope.organizationIds.length) {
      const conditions = [
        ...(scope.projectIds.length
          ? [inArray(projects.id, scope.projectIds)]
          : []),
        ...(scope.organizationIds.length
          ? [inArray(projects.organizationId, scope.organizationIds)]
          : []),
      ];
      projectIds = (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(or(...conditions))
      ).map(row => row.id);
    }
  }
  const byType = financeApprovalTypeSchema.options.map(sourceType => ({
    sourceType,
    sourceLabel: labels[sourceType],
    pendingCount: 0,
    approvableCount: 0,
  }));
  // 有限顺序聚合避免多项目同时展开权限和来源查询；跨项目只向调用者返回计数。
  for (const id of projectIds) {
    await assertProjectInCurrentScope(financeCtx, id);
    const rows = await readFinanceApprovalRows(ctx, db, id);
    for (const row of rows) {
      const bucket = byType.find(item => item.sourceType === row.sourceType)!;
      bucket.pendingCount++;
      if (row.canApprove) bucket.approvableCount++;
    }
  }
  const pendingCount = byType.reduce((sum, item) => sum + item.pendingCount, 0);
  return {
    scope:
      projectId === undefined
        ? ("all_accessible_finance_projects" as const)
        : ("project" as const),
    count: pendingCount,
    pendingCount,
    approvableCount: byType.reduce(
      (sum, item) => sum + item.approvableCount,
      0
    ),
    byType,
  };
}
