import { and, desc, eq, gte, inArray, lte, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ENV } from "../_core/env";
import { isAliyunOssPhotoStorageKey } from "../services/aliyunOssPhotoStorage";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  dailyAccountingClosures,
  employeeInsurancePolicies,
  employeeProfiles,
  evidenceRecords,
  financialRecords,
  laborWorkers,
  machinePaymentSettlements,
  payrollStatements,
  settlementPaymentRecords,
  subcontractPackages,
  subcontractPaymentSettlements,
  temporaryDailyWageSettlements,
  transportVehicleCarryForwardOffsets,
  transportVehicleSettlements,
  users,
} from "../../drizzle/schema";
import { assertCertificateFileSignature } from "../../shared/domain";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  requireAuthenticatedUser,
} from "../access";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { appendIntegrityProtectedAudit } from "../services/auditIntegrity";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { laborRouter } from "./labor";
import { machineryRouter, transportRouter } from "./operations";
import { subcontractRouter } from "./subcontract";
import { assertCompanyPayrollSettlement } from "../services/personnelLegacyBridge";
import {
  assertFinanceApprovalRead,
  financeApprovalDb,
  financeApprovalQueueInput,
  financeApproveInput,
  readFinanceApprovalRows,
  readFinanceApprovalSummary,
} from "../services/financeApproval";
import {
  assertSettlementPaymentStatusWrite,
  buildValidVehicleCarryForwardTotals,
  sumConfirmedCarryForwardOffsets,
  getActiveVehicleCarryForwardAmount,
  lockSettlementPaymentResource,
  lockSettlementPaymentScope,
  type SettlementPaymentQueryClient,
  type SettlementPaymentWriteClient,
} from "../services/settlementPayments";

/** 所有结算类型均以 settlement_payment_records 的逐笔实收付为唯一资金事实来源。 */
const settlementTypeSchema = z.enum([
  "transport_vehicle",
  "machine",
  "payroll",
  "daily_wage",
  "subcontract",
]);
type SettlementType = z.infer<typeof settlementTypeSchema>;
type PaymentDirection = "expense" | "income";
const paymentMethodSchema = z.enum([
  "bank_transfer",
  "corporate_account",
  "cash",
  "wechat",
  "alipay",
  "other",
]);
const MAX_PROOF_BYTES = 15 * 1024 * 1024;
const paymentProofUploadInput = z.object({
  projectId: z.number().int().positive(),
  settlementType: settlementTypeSchema,
  settlementId: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  base64Data: z.string().min(16).max(22_000_000),
  description: z.string().trim().min(2).max(300).default("付款凭证"),
});
const paymentRecordInput = z.object({
  projectId: z.number().int().positive(),
  settlementType: settlementTypeSchema,
  settlementId: z.number().int().positive(),
  amount: z.number().positive("本次金额必须大于 0").max(999999999999.99),
  paymentDate: z.string().date(),
  paymentMethod: paymentMethodSchema,
  /** 收款户名可在车辆/机械/分包收款资料中自动带入，工资默认取人员实名。 */
  payeeName: z.string().trim().min(1, "请填写收款人/补款人").max(128),
  payeeAccount: z.string().trim().max(160).nullable().optional(),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  evidenceId: z.number().int().positive("请先上传本次付款凭证"),
  remarks: z.string().trim().max(500).nullable().optional(),
});
const boardInput = z.object({
  projectId: z.number().int().positive(),
  /** 截至日仅影响实际付款与抵扣口径；业务单自身状态仍是当前状态。 */
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "截至日期格式应为 YYYY-MM-DD")
    .optional(),
  sourceTypes: z.array(settlementTypeSchema).max(5).optional(),
  direction: z.enum(["expense", "income", "all"]).default("all"),
  lifecycle: z
    .enum(["approval_pending", "ready", "partial", "completed", "void", "all"])
    .default("all"),
  keyword: z.string().trim().max(128).default(""),
});
const reconciliationInput = z.object({
  projectId: z.number().int().positive(),
  /** 仅按实际付款日期归属，不以业务结算期间替代资金期间。 */
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "会计月份格式应为 YYYY-MM"),
  sourceTypes: z.array(settlementTypeSchema).max(5).optional(),
  direction: z.enum(["expense", "income", "all"]).default("all"),
  status: z.enum(["active", "reversed", "all"]).default("active"),
  paymentMethod: z
    .union([paymentMethodSchema, z.literal("all")])
    .default("all"),
  keyword: z.string().trim().max(128).default(""),
});

const settlementTypeLabel: Record<SettlementType, string> = {
  transport_vehicle: "车辆结算",
  machine: "机械结算",
  payroll: "工资发放",
  daily_wage: "临时日结",
  subcontract: "分包结算",
};
const paymentMethodLabel: Record<
  z.infer<typeof paymentMethodSchema>,
  string
> = {
  bank_transfer: "银行卡转账",
  corporate_account: "对公账户",
  cash: "现金",
  wechat: "微信收款",
  alipay: "支付宝收款",
  other: "其他方式",
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function safeFileName(value: string, fallback: string) {
  return (
    value.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_").slice(-160) || fallback
  );
}
function canExecuteSettlementPayment(
  roleCodes: readonly string[],
  settlementType?: SettlementType
) {
  if (
    roleCodes.includes("ALL") ||
    roleCodes.includes("ACCOUNTANT") ||
    roleCodes.includes("FINANCE_MANAGER")
  )
    return true;
  /** 延续原有分包付款职责：出纳可登记分包实际付款，但不能借此办理其他结算。 */
  return settlementType === "subcontract" && roleCodes.includes("CASHIER");
}
function canViewSettlementPaymentBoard(roleCodes: readonly string[]) {
  return (
    roleCodes.includes("ALL") ||
    roleCodes.some(role =>
      ["ACCOUNTANT", "FINANCE_MANAGER", "CASHIER"].includes(role)
    )
  );
}
async function assertPaymentAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  settlementType?: SettlementType,
  action: "read" | "settle" = "read"
) {
  await assertDepartmentBusinessAccess(ctx, "FINANCE", action);
  const roleCodes = await getEffectiveRoleCodes(ctx);
  if (!canExecuteSettlementPayment(roleCodes, settlementType)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "实际付款、补款与付款凭证登记仅限会计、财务负责人或获授权的分包出纳",
    });
  }
  return roleCodes;
}
async function assertPaymentBoardAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  await assertDepartmentBusinessAccess(ctx, "FINANCE");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  if (!canViewSettlementPaymentBoard(roleCodes)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅会计、出纳、财务负责人或系统管理员可查看结算资金看板",
    });
  }
  return roleCodes;
}
function proofSourceId(settlementType: SettlementType, settlementId: number) {
  return `${settlementType}:${settlementId}`;
}
function decodeProofBase64(
  value: string,
  mimeType: "image/jpeg" | "image/png" | "application/pdf"
) {
  const normalized = value.includes(",")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(normalized))
    throw new TRPCError({ code: "BAD_REQUEST", message: "付款凭证编码无效" });
  const bytes = Buffer.from(normalized.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        mimeType === "application/pdf"
          ? "付款凭证 PDF 不能超过 15MB"
          : "付款凭证图片不能超过 15MB",
    });
  }
  try {
    assertCertificateFileSignature(bytes, mimeType);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "付款凭证文件内容与声明格式不一致",
    });
  }
  return bytes;
}

/** 读取结算主单；负的车辆净额必须登记为“司机/车主补款收入”。 */
async function getSettlementForPayment(
  db: SettlementPaymentQueryClient,
  input: {
    projectId: number;
    settlementType: SettlementType;
    settlementId: number;
  },
  lock = false
) {
  if (input.settlementType === "transport_vehicle") {
    const query = db
      .select()
      .from(transportVehicleSettlements)
      .where(eq(transportVehicleSettlements.id, input.settlementId))
      .limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.projectId !== input.projectId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "车辆结算单不存在或不属于当前项目",
      });
    const signedAmount = roundMoney(Number(row.netPayableAmount));
    const offsetAmount =
      signedAmount < 0
        ? await getActiveVehicleCarryForwardAmount(db, row, lock)
        : 0;
    return {
      row,
      amount: Math.abs(signedAmount),
      offsetAmount,
      direction: signedAmount >= 0 ? ("expense" as const) : ("income" as const),
      category: signedAmount >= 0 ? "车辆结算实际付款" : "车辆扣款补收",
      label: row.settlementNo,
      payeeName: row.payeeName,
      payeeAccount: row.payeeAccount,
      statuses: ["approved", "partial", "receivable"],
    };
  }
  if (input.settlementType === "machine") {
    const query = db
      .select()
      .from(machinePaymentSettlements)
      .where(eq(machinePaymentSettlements.id, input.settlementId))
      .limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.projectId !== input.projectId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "机械付款结算单不存在或不属于当前项目",
      });
    return {
      row,
      amount: roundMoney(Math.max(0, Number(row.netPayableAmount))),
      offsetAmount: 0,
      direction: "expense" as const,
      category: "机械结算实际付款",
      label: row.settlementNo,
      payeeName: row.payeeName,
      payeeAccount: row.payeeAccount,
      statuses: ["approved", "partial"],
    };
  }
  if (input.settlementType === "payroll") {
    const query = db
      .select({
        id: payrollStatements.id,
        workerId: payrollStatements.workerId,
        projectId: payrollStatements.projectId,
        status: payrollStatements.status,
        actualAmount: payrollStatements.actualAmount,
        period: payrollStatements.period,
        workerName: laborWorkers.realName,
      })
      .from(payrollStatements)
      .innerJoin(laborWorkers, eq(payrollStatements.workerId, laborWorkers.id))
      .where(eq(payrollStatements.id, input.settlementId))
      .limit(1);
    if (lock) {
      const [source] = await query;
      if (source?.projectId === input.projectId) await assertCompanyPayrollSettlement(db, { workerId: source.workerId, projectId: source.projectId, period: source.period, channel: "monthly" });
    }
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.projectId !== input.projectId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "工资条不存在或不属于当前项目",
      });
    return {
      row,
      amount: roundMoney(Number(row.actualAmount)),
      offsetAmount: 0,
      direction: "expense" as const,
      category: "工资实际发放",
      label: `${row.period} 工资条`,
      payeeName: row.workerName || "员工",
      payeeAccount: null,
      statuses: ["approved", "partial"],
    };
  }
  if (input.settlementType === "daily_wage") {
    const query = db
      .select({
        id: temporaryDailyWageSettlements.id,
        workerId: temporaryDailyWageSettlements.workerId,
        projectId: temporaryDailyWageSettlements.projectId,
        status: temporaryDailyWageSettlements.status,
        actualAmount: temporaryDailyWageSettlements.actualAmount,
        settlementDate: temporaryDailyWageSettlements.settlementDate,
        workerName: laborWorkers.realName,
      })
      .from(temporaryDailyWageSettlements)
      .innerJoin(
        laborWorkers,
        eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)
      )
      .where(eq(temporaryDailyWageSettlements.id, input.settlementId))
      .limit(1);
    if (lock) {
      const [source] = await query;
      if (source?.projectId === input.projectId) {
        const day = source.settlementDate.toISOString().slice(0, 10);
        await assertCompanyPayrollSettlement(db, { workerId: source.workerId, projectId: source.projectId, period: day.slice(0, 7), channel: "daily", settlementDate: day });
      }
    }
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.projectId !== input.projectId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "临时日结不存在或不属于当前项目",
      });
    return {
      row,
      amount: roundMoney(Number(row.actualAmount)),
      offsetAmount: 0,
      direction: "expense" as const,
      category: "临时日结实际发放",
      label: "临时日结",
      payeeName: row.workerName || "员工",
      payeeAccount: null,
      statuses: ["approved", "partial"],
    };
  }
  const query = db
    .select()
    .from(subcontractPaymentSettlements)
    .where(eq(subcontractPaymentSettlements.id, input.settlementId))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row || row.projectId !== input.projectId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "分包应付结算单不存在或不属于当前项目",
    });
  return {
    row,
    amount: roundMoney(Math.max(0, Number(row.netPayableAmount))),
    offsetAmount: 0,
    direction: "expense" as const,
    category: "分包结算实际付款",
    label: row.settlementNo,
    payeeName: row.payeeName,
    payeeAccount: row.payeeAccount,
    statuses: ["approved", "partial"],
  };
}

async function updateSettlementPaymentStatus(
  tx: SettlementPaymentWriteClient,
  input: {
    settlementType: SettlementType;
    settlementId: number;
    expectedStatus: string;
    final: boolean;
    direction: PaymentDirection;
    paymentDate: Date;
    paymentReference: string | null;
    paidBy: number;
  }
) {
  const now = new Date();
  const common = {
    paymentDate: input.paymentDate,
    paymentReference: input.paymentReference,
    paidBy: input.paidBy,
    paidAt: now,
  };
  if (input.settlementType === "transport_vehicle") {
    assertSettlementPaymentStatusWrite(
      await tx
        .update(transportVehicleSettlements)
        .set({
          ...common,
          status: input.final
            ? input.direction === "income"
              ? "offset"
              : "paid"
            : "partial",
        })
        .where(
          and(
            eq(transportVehicleSettlements.id, input.settlementId),
            eq(
              transportVehicleSettlements.status,
              input.expectedStatus as typeof transportVehicleSettlements.$inferSelect.status
            )
          )
        )
    );
  } else if (input.settlementType === "machine") {
    assertSettlementPaymentStatusWrite(
      await tx
        .update(machinePaymentSettlements)
        .set({ ...common, status: input.final ? "paid" : "partial" })
        .where(
          and(
            eq(machinePaymentSettlements.id, input.settlementId),
            eq(
              machinePaymentSettlements.status,
              input.expectedStatus as typeof machinePaymentSettlements.$inferSelect.status
            )
          )
        )
    );
  } else if (input.settlementType === "payroll") {
    assertSettlementPaymentStatusWrite(
      await tx
        .update(payrollStatements)
        .set({
          paidAt: now,
          paymentReference: input.paymentReference,
          status: input.final ? "paid" : "partial",
        })
        .where(
          and(
            eq(payrollStatements.id, input.settlementId),
            eq(
              payrollStatements.status,
              input.expectedStatus as typeof payrollStatements.$inferSelect.status
            )
          )
        )
    );
  } else if (input.settlementType === "daily_wage") {
    assertSettlementPaymentStatusWrite(
      await tx
        .update(temporaryDailyWageSettlements)
        .set({
          paidAt: now,
          paymentReference: input.paymentReference,
          paidBy: input.paidBy,
          status: input.final ? "paid" : "partial",
        })
        .where(
          and(
            eq(temporaryDailyWageSettlements.id, input.settlementId),
            eq(
              temporaryDailyWageSettlements.status,
              input.expectedStatus as typeof temporaryDailyWageSettlements.$inferSelect.status
            )
          )
        )
    );
  } else {
    assertSettlementPaymentStatusWrite(
      await tx
        .update(subcontractPaymentSettlements)
        .set({ ...common, status: input.final ? "paid" : "partial" })
        .where(
          and(
            eq(subcontractPaymentSettlements.id, input.settlementId),
            eq(
              subcontractPaymentSettlements.status,
              input.expectedStatus as typeof subcontractPaymentSettlements.$inferSelect.status
            )
          )
        )
    );
    if (input.final) {
      const [settlement] = await tx
        .select({ packageId: subcontractPaymentSettlements.packageId })
        .from(subcontractPaymentSettlements)
        .where(eq(subcontractPaymentSettlements.id, input.settlementId))
        .limit(1);
      if (settlement)
        await tx
          .update(subcontractPackages)
          .set({ status: "settled", settledAt: now })
          .where(
            and(
              eq(subcontractPackages.id, settlement.packageId),
              eq(subcontractPackages.status, "confirmed")
            )
          );
    }
  }
}

function getMonthBoundaries(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
function normalizeKeyword(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("zh-CN");
}
function buildPaymentTotals(
  records: Array<{
    settlementType: SettlementType;
    settlementId: number;
    amount: unknown;
    status: string;
  }>
) {
  const totals = new Map<string, number>();
  for (const record of records) {
    if (record.status !== "active") continue;
    const key = `${record.settlementType}:${record.settlementId}`;
    totals.set(key, roundMoney((totals.get(key) ?? 0) + Number(record.amount)));
  }
  return totals;
}
function lifecycleFor(
  status: string,
  remainingAmount: number,
  originalAmount: number
) {
  if (status === "void") return "void" as const;
  if (["draft", "submitted", "reviewing"].includes(status))
    return "approval_pending" as const;
  if (
    remainingAmount <= 0 &&
    (status === "paid" || status === "offset" || originalAmount === 0)
  )
    return "completed" as const;
  if (remainingAmount < originalAmount || status === "partial")
    return "partial" as const;
  return "ready" as const;
}
function safeBoardRow(row: Record<string, unknown>) {
  return {
    sourceType: row.sourceType,
    sourceLabel: settlementTypeLabel[row.sourceType as SettlementType],
    settlementId: row.settlementId,
    settlementNo: row.settlementNo,
    direction: row.direction,
    lifecycle: row.lifecycle,
    businessStatus: row.businessStatus,
    originalAmount: row.originalAmount,
    paidOrRecoveredAmount: row.paidOrRecoveredAmount,
    offsetAmount: row.offsetAmount,
    remainingAmount: row.remainingAmount,
    counterpartyDisplay: row.counterpartyDisplay,
    periodLabel: row.periodLabel,
    canRegisterSettlementPayment: row.canRegisterSettlementPayment,
    legacyFinalized: row.legacyFinalized,
  };
}

/** 保留原根路径以运行原 protectedProcedure 的角色/operation中间件，不能用短路径 caller 绕过守卫。 */
const financeApprovalOriginalRouter = router({
  labor: laborRouter,
  machinery: machineryRouter,
  transport: transportRouter,
  subcontract: subcontractRouter,
});
export const settlementPaymentRouter = router({
  /** 财务独立项目范围上的真实待审数；缺省项目仅返回全授权范围计数，不返回业务内容。 */
  approvalSummary: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive().optional() }))
    .query(({ ctx, input }) => readFinanceApprovalSummary(ctx, input.projectId)),
  /** 只读最小审核DTO：工资/日结 reviewing，其余 submitted，草稿与已审单不入队。 */
  approvalQueue: protectedProcedure
    .input(financeApprovalQueueInput)
    .query(async ({ ctx, input }) => {
      await assertFinanceApprovalRead(ctx, input.projectId);
      const db = await financeApprovalDb();
      const rows = await readFinanceApprovalRows(ctx, db, input.projectId, input.sourceTypes);
      const keyword = input.keyword.toLocaleLowerCase();
      return {
        projectId: input.projectId,
        rows: rows.filter(row => !keyword || [row.settlementNo, row.sourceLabel, row.counterpartyDisplay, row.periodLabel, row.itemsSummary].some(value => value.toLocaleLowerCase().includes(keyword))),
      };
    }),
  /** 仅财务入口适配：不写状态、不自动提交、不登记付款，原业务权限/状态机/闭环/CAS完整运行。 */
  approve: protectedProcedure
    .input(financeApproveInput)
    .mutation(async ({ ctx, input }) => {
      await assertFinanceApprovalRead(ctx, input.projectId);
      const db = await financeApprovalDb();
      const rows = await readFinanceApprovalRows(ctx, db, input.projectId, [input.settlementType]);
      const row = rows.find(item => item.settlementId === input.settlementId);
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "结算单不是当前项目已提交的待审单，请刷新审核队列" });
      if (!row.canApprove) throw new TRPCError({ code: "FORBIDDEN", message: row.approvalUnavailableReason || "当前账号无权审核该结算单" });
      if (row.fingerprint !== input.expectedFingerprint) throw new TRPCError({ code: "CONFLICT", message: "结算状态、金额或依据已变更，请刷新核对后再审核" });
      // 不透传 FINANCE departmentModule，原路由必须自行建立其部门和项目范围。
      const caller = financeApprovalOriginalRouter.createCaller({ user: ctx.user, req: ctx.req, res: ctx.res });
      const originalInput = { id: input.settlementId, projectId: input.projectId };
      if (input.settlementType === "transport_vehicle") await caller.transport.transitionVehicleSettlement({ ...originalInput, action: "approve" });
      else if (input.settlementType === "machine") await caller.machinery.transitionPaymentSettlement({ ...originalInput, action: "approve" });
      else if (input.settlementType === "payroll") await caller.labor.payroll.approve({ id: input.settlementId, decision: "approved" });
      else if (input.settlementType === "daily_wage") await caller.labor.dailyWage.review({ id: input.settlementId, decision: "approved" });
      else await caller.subcontract.transitionPaymentSettlement({ ...originalInput, targetStatus: "approved" });
      return { success: true as const };
    }),
  /** 新付款凭证先入受控证据库；仅能被同一项目、同一结算单实际付款动作引用。 */
  uploadProof: protectedProcedure
    .input(paymentProofUploadInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertPaymentAccess(ctx, input.settlementType);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      await getSettlementForPayment(db, input);
      const bytes = decodeProofBase64(input.base64Data, input.mimeType);
      const uploadedAt = new Date();
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      const fileName = safeFileName(input.fileName, "payment-proof.pdf");
      const stored = await storagePut(
        `settlement-proofs/${input.projectId}/${input.settlementType}/${input.settlementId}/${uploadedAt.toISOString().slice(0, 10)}/${user.id}-${fileName}`,
        bytes,
        input.mimeType
      );
      let evidenceId = 0;
      await db.transaction(async tx => {
        const result = await tx.insert(evidenceRecords).values({
          projectId: input.projectId,
          sourceType: "settlement_payment_proof",
          sourceId: proofSourceId(input.settlementType, input.settlementId),
          fileKey: stored.key,
          fileName,
          mimeType: input.mimeType,
          contentSha256,
          contentBytes: bytes.length,
          watermarkJson: JSON.stringify({
            description: input.description,
            captureMode: "settlement_payment_proof",
            uploadedAt: uploadedAt.toISOString(),
            version: 1,
          }),
          longitude: null,
          latitude: null,
          capturedAt: uploadedAt,
          retentionUntil: null,
          status: "active",
          uploadedBy: user.id,
        });
        evidenceId = Number(
          (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
        );
        await appendIntegrityProtectedAudit(tx, {
          userId: user.id,
          module: "finance",
          action: "upload_settlement_payment_proof",
          targetType: "evidence",
          targetId: String(evidenceId || stored.key),
          summary: `归档结算付款凭证：${input.settlementType} · ${input.description.slice(0, 80)}`,
          afterJson: JSON.stringify({
            projectId: input.projectId,
            settlementType: input.settlementType,
            settlementId: input.settlementId,
            contentSha256,
            contentBytes: bytes.length,
            mimeType: input.mimeType,
          }),
        });
      });
      if (!evidenceId)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "付款凭证归档失败，请稍后重试",
        });
      return { success: true, evidenceId, fileName, mimeType: input.mimeType };
    }),

  /** 列出结算单付款明细及受控短时预览地址；不返回工资银行卡等敏感资料。 */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        settlementType: settlementTypeSchema,
        settlementId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertPaymentAccess(ctx, input.settlementType);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          dueAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          direction: "expense" as const,
          records: [],
        };
      const settlement = await getSettlementForPayment(db, input);
      const records = await db
        .select()
        .from(settlementPaymentRecords)
        .where(
          and(
            eq(settlementPaymentRecords.projectId, input.projectId),
            eq(settlementPaymentRecords.settlementType, input.settlementType),
            eq(settlementPaymentRecords.settlementId, input.settlementId)
          )
        )
        .orderBy(
          desc(settlementPaymentRecords.paymentDate),
          desc(settlementPaymentRecords.id)
        );
      const active = records.filter(item => item.status === "active");
      const paidAmount = roundMoney(
        active.reduce((sum, item) => sum + Number(item.amount), 0)
      );
      const remainingAmount = roundMoney(
        Math.max(0, settlement.amount - paidAmount - settlement.offsetAmount)
      );
      const evidenceIds = active
        .map(item => item.evidenceId)
        .filter((id): id is number => typeof id === "number" && id > 0);
      const evidences = evidenceIds.length
        ? await db
            .select({
              id: evidenceRecords.id,
              fileKey: evidenceRecords.fileKey,
              fileName: evidenceRecords.fileName,
              mimeType: evidenceRecords.mimeType,
              sourceType: evidenceRecords.sourceType,
              sourceId: evidenceRecords.sourceId,
              status: evidenceRecords.status,
            })
            .from(evidenceRecords)
            .where(
              and(
                eq(evidenceRecords.projectId, input.projectId),
                inArray(evidenceRecords.id, evidenceIds)
              )
            )
        : [];
      const evidenceById = new Map(
        await Promise.all(
          evidences
            .filter(
              item =>
                item.status === "active" &&
                item.sourceType === "settlement_payment_proof" &&
                item.sourceId ===
                  proofSourceId(input.settlementType, input.settlementId)
            )
            .map(
              async item =>
                [
                  item.id,
                  {
                    fileName: item.fileName,
                    mimeType: item.mimeType,
                    url: await storageGetSignedUrl(item.fileKey),
                  },
                ] as const
            )
        )
      );
      return {
        dueAmount: settlement.amount,
        paidAmount,
        offsetAmount: settlement.offsetAmount,
        remainingAmount,
        direction: settlement.direction,
        defaultPayee: {
          name: settlement.payeeName,
          account: settlement.payeeAccount,
        },
        status: settlement.row.status,
        records: records.map(item => ({
          ...item,
          evidence: item.evidenceId
            ? (evidenceById.get(item.evidenceId) ?? null)
            : null,
        })),
      };
    }),

  /** 登记一笔真实收付。金额不得超过服务端计算的未结余额；每笔同步生成真实财务流水。 */
  record: protectedProcedure
    .input(paymentRecordInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertPaymentAccess(ctx, input.settlementType, "settle");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const paymentDate = toBusinessDate(input.paymentDate);
      const amount = roundMoney(input.amount);
      if (amount <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "本次金额至少为 0.01 元，请核对实际收付金额",
        });
      const outcome = await db
        .transaction(async tx => {
          await lockSettlementPaymentScope(tx, input);
          // 等待跨路由项目锁后重新鉴权，不能沿用排队前的角色/部门/项目授权。
          requireAuthenticatedUser(ctx);
          const roleCodes = await assertPaymentAccess(
            ctx,
            input.settlementType,
            "settle"
          );
          await assertProjectInCurrentScope(ctx, input.projectId);
          await lockSettlementPaymentResource(tx, input);
          const settlement = await getSettlementForPayment(tx, input, true);
          if (!settlement.statuses.includes(String(settlement.row.status)))
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "当前结算单不是待付款、部分付款或待收补款状态，不能继续登记资金",
            });
          if (
            input.settlementType === "subcontract" &&
            "approvedBy" in settlement.row &&
            settlement.row.approvedBy === user.id &&
            !roleCodes.includes("ALL")
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "分包会计审核人与实际付款人必须职责分离",
            });
          }
          const [closure] = await tx
            .select({ status: dailyAccountingClosures.status })
            .from(dailyAccountingClosures)
            .where(
              and(
                eq(dailyAccountingClosures.projectId, input.projectId),
                eq(dailyAccountingClosures.closingDate, paymentDate)
              )
            )
            .limit(1)
            .for("update");
          if (closure && ["closed", "archived"].includes(closure.status))
            throw new TRPCError({
              code: "CONFLICT",
              message: "付款日期已封存，须由财务负责人先授权反结账后再登记付款",
            });
          const [proof] = await tx
            .select({
              id: evidenceRecords.id,
              projectId: evidenceRecords.projectId,
              sourceType: evidenceRecords.sourceType,
              sourceId: evidenceRecords.sourceId,
              status: evidenceRecords.status,
            })
            .from(evidenceRecords)
            .where(eq(evidenceRecords.id, input.evidenceId))
            .limit(1)
            .for("update");
          if (
            !proof ||
            proof.projectId !== input.projectId ||
            proof.status !== "active" ||
            proof.sourceType !== "settlement_payment_proof" ||
            proof.sourceId !==
              proofSourceId(input.settlementType, input.settlementId)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "请上传并关联当前结算单的有效付款凭证",
            });
          }
          const existing = await tx
            .select({ amount: settlementPaymentRecords.amount })
            .from(settlementPaymentRecords)
            .where(
              and(
                eq(settlementPaymentRecords.projectId, input.projectId),
                eq(
                  settlementPaymentRecords.settlementType,
                  input.settlementType
                ),
                eq(settlementPaymentRecords.settlementId, input.settlementId),
                eq(settlementPaymentRecords.status, "active")
              )
            )
            .for("update");
          const paidAmount = roundMoney(
            existing.reduce((sum, item) => sum + Number(item.amount), 0)
          );
          const remainingAmount = roundMoney(
            Math.max(
              0,
              settlement.amount - paidAmount - settlement.offsetAmount
            )
          );
          if (amount > remainingAmount)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `本次金额不能超过待结余额 ¥${remainingAmount.toFixed(2)}`,
            });
          const final = roundMoney(remainingAmount - amount) === 0;
          const result = await tx.insert(settlementPaymentRecords).values({
            projectId: input.projectId,
            settlementType: input.settlementType,
            settlementId: input.settlementId,
            direction: settlement.direction,
            amount: String(amount),
            paymentDate,
            paymentMethod: input.paymentMethod,
            payeeNameSnapshot: input.payeeName.trim(),
            payeeAccountSnapshot: input.payeeAccount?.trim() || null,
            paymentReference: input.paymentReference?.trim() || null,
            evidenceId: input.evidenceId,
            remarks: input.remarks?.trim() || null,
            status: "active",
            paidBy: user.id,
            paidAt: new Date(),
            reversedBy: null,
            reversedAt: null,
            reversalReason: null,
          });
          const paymentId = Number(
            (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
          );
          if (!paymentId)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "本次资金登记未完成，请稍后重试",
            });
          await tx.insert(financialRecords).values({
            recordNo: `F-SPAY-${input.settlementType}-${paymentId || Date.now()}`,
            projectId: input.projectId,
            direction: settlement.direction,
            category: settlement.category,
            amount: String(amount),
            occurredAt: paymentDate,
            settlementStatus: "paid",
            sourceType: "settlement_payment",
            sourceId: String(paymentId),
            evidenceId: input.evidenceId,
            remarks: `${settlement.label}：${paymentMethodLabel[input.paymentMethod]}${input.paymentReference?.trim() ? `；付款参考号 ${input.paymentReference.trim()}` : ""}`,
          });
          await updateSettlementPaymentStatus(tx, {
            settlementType: input.settlementType,
            settlementId: input.settlementId,
            expectedStatus: settlement.row.status,
            final,
            direction: settlement.direction,
            paymentDate,
            paymentReference: input.paymentReference?.trim() || null,
            paidBy: user.id,
          });
          await appendIntegrityProtectedAudit(tx, {
            userId: user.id,
            module: "finance",
            action:
              settlement.direction === "expense"
                ? "record_settlement_payment"
                : "record_vehicle_recovery",
            targetType: "settlement_payment_record",
            targetId: String(
              paymentId || `${input.settlementType}-${input.settlementId}`
            ),
            summary: `${settlement.label}已登记${settlement.direction === "expense" ? "实际付款" : "实际补款"}；${final ? "本单已结清" : "保留待结余额"}`,
            afterJson: JSON.stringify({
              projectId: input.projectId,
              settlementType: input.settlementType,
              settlementId: input.settlementId,
              direction: settlement.direction,
              amount,
              evidenceId: input.evidenceId,
            }),
          });
          return { paymentId, settlement, final, paidAmount, remainingAmount };
        })
        .catch((error: unknown) => {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "本次资金登记未完成，款项、流水和审计已一并回滚，请稍后重试",
          });
        });
      const { paymentId, settlement, final, paidAmount, remainingAmount } =
        outcome;
      const status = final
        ? settlement.direction === "income"
          ? "offset"
          : "paid"
        : "partial";
      if (
        input.settlementType === "payroll" ||
        input.settlementType === "daily_wage"
      ) {
        const eventCode =
          input.settlementType === "payroll"
            ? final
              ? "payroll_paid"
              : "payroll_partial"
            : final
              ? "daily_wage_paid"
              : "daily_wage_partial";
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          projectId: input.projectId,
          module: "labor",
          eventCode,
          targetType: input.settlementType,
          targetId: String(input.settlementId),
          title: final ? "工资付款已登记" : "工资部分发放已登记",
          content: final
            ? "本次实际付款已登记并已上传凭证，请进入系统核对。"
            : "本次实际付款已登记并已上传凭证，尚有余额待结。",
          deepLink: "/mobile/labor",
        }).catch(() => undefined);
      }
      return {
        success: true,
        paymentId,
        dueAmount: settlement.amount,
        paidAmount: roundMoney(paidAmount + amount),
        remainingAmount: roundMoney(Math.max(0, remainingAmount - amount)),
        status,
      };
    }),

  /**
   * 财务看板只返回经脱敏的结算存量，不返回账户、支付流水号、证据链接或文件键。
   * 待付款/待收补款均由主单应收付额减 active 付款明细（车辆再减 active 后期抵扣）重算。
   */
  board: protectedProcedure.input(boardInput).query(async ({ ctx, input }) => {
    const roleCodes = await assertPaymentBoardAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    const sourceTypes = input.sourceTypes?.length
      ? input.sourceTypes
      : settlementTypeSchema.options;
    const asOfDate = input.asOfDate
      ? toBusinessDate(input.asOfDate)
      : new Date();
    const asOfEnd = new Date(asOfDate);
    asOfEnd.setUTCHours(23, 59, 59, 999);
    if (!db)
      return {
        asOfDate: input.asOfDate ?? asOfDate.toISOString().slice(0, 10),
        rows: [],
        summary: {
          payable: { count: 0, amount: 0 },
          receivable: { count: 0, amount: 0 },
          partial: { count: 0, amount: 0 },
          approvalPending: { count: 0, amount: 0 },
          byType: [] as any[],
        },
      };
    const [
      payments,
      offsets,
      vehicles,
      machines,
      payrolls,
      dailyWages,
      subcontracts,
    ] = await Promise.all([
      db
        .select({
          settlementType: settlementPaymentRecords.settlementType,
          settlementId: settlementPaymentRecords.settlementId,
          amount: settlementPaymentRecords.amount,
          status: settlementPaymentRecords.status,
        })
        .from(settlementPaymentRecords)
        .where(
          and(
            eq(settlementPaymentRecords.projectId, input.projectId),
            lte(settlementPaymentRecords.paymentDate, asOfDate)
          )
        ),
      db
        .select({
          sourceSettlementId:
            transportVehicleCarryForwardOffsets.sourceSettlementId,
          targetSettlementId:
            transportVehicleCarryForwardOffsets.targetSettlementId,
          vehicleId: transportVehicleCarryForwardOffsets.vehicleId,
          amount: transportVehicleCarryForwardOffsets.amount,
          status: transportVehicleCarryForwardOffsets.status,
          createdAt: transportVehicleCarryForwardOffsets.createdAt,
        })
        .from(transportVehicleCarryForwardOffsets)
        .where(
          and(
            eq(transportVehicleCarryForwardOffsets.projectId, input.projectId),
            lte(transportVehicleCarryForwardOffsets.createdAt, asOfEnd)
          )
        ),
      db
        .select()
        .from(transportVehicleSettlements)
        .where(eq(transportVehicleSettlements.projectId, input.projectId)),
      db
        .select()
        .from(machinePaymentSettlements)
        .where(eq(machinePaymentSettlements.projectId, input.projectId)),
      db
        .select({
          id: payrollStatements.id,
          status: payrollStatements.status,
          actualAmount: payrollStatements.actualAmount,
          period: payrollStatements.period,
          workerName: laborWorkers.realName,
        })
        .from(payrollStatements)
        .innerJoin(
          laborWorkers,
          eq(payrollStatements.workerId, laborWorkers.id)
        )
        .where(eq(payrollStatements.projectId, input.projectId)),
      db
        .select({
          id: temporaryDailyWageSettlements.id,
          status: temporaryDailyWageSettlements.status,
          actualAmount: temporaryDailyWageSettlements.actualAmount,
          settlementDate: temporaryDailyWageSettlements.settlementDate,
          workerName: laborWorkers.realName,
        })
        .from(temporaryDailyWageSettlements)
        .innerJoin(
          laborWorkers,
          eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)
        )
        .where(eq(temporaryDailyWageSettlements.projectId, input.projectId)),
      db
        .select()
        .from(subcontractPaymentSettlements)
        .where(eq(subcontractPaymentSettlements.projectId, input.projectId)),
    ]);
    const paidBySettlement = buildPaymentTotals(
      payments as Array<{
        settlementType: SettlementType;
        settlementId: number;
        amount: unknown;
        status: string;
      }>
    );
    const offsetBySettlement = sumConfirmedCarryForwardOffsets(
      offsets,
      vehicles
    );
    const canRegister = canExecuteSettlementPayment(roleCodes);
    const rows: Array<Record<string, unknown>> = [];
    if (sourceTypes.includes("transport_vehicle"))
      for (const row of vehicles) {
        const signedAmount = roundMoney(Number(row.netPayableAmount));
        const originalAmount = Math.abs(signedAmount);
        const direction: PaymentDirection =
          signedAmount >= 0 ? "expense" : "income";
        const paidOrRecoveredAmount =
          paidBySettlement.get(`transport_vehicle:${row.id}`) ?? 0;
        const offsetAmount =
          direction === "income"
            ? (offsetBySettlement.get(Number(row.id)) ?? 0)
            : 0;
        const remainingAmount = roundMoney(
          Math.max(0, originalAmount - paidOrRecoveredAmount - offsetAmount)
        );
        const lifecycle = lifecycleFor(
          row.status,
          remainingAmount,
          originalAmount
        );
        rows.push(
          safeBoardRow({
            sourceType: "transport_vehicle",
            settlementId: row.id,
            settlementNo: row.settlementNo,
            direction,
            lifecycle,
            businessStatus: row.status,
            originalAmount,
            paidOrRecoveredAmount,
            offsetAmount,
            remainingAmount,
            counterpartyDisplay: row.payeeName || "车辆收款人",
            periodLabel: `${String(row.periodStart).slice(0, 10)} 至 ${String(row.periodEnd).slice(0, 10)}`,
            canRegisterSettlementPayment:
              canRegister &&
              ["approved", "partial", "receivable"].includes(row.status),
            legacyFinalized: false,
          })
        );
      }
    if (sourceTypes.includes("machine"))
      for (const row of machines) {
        const originalAmount = roundMoney(
          Math.max(0, Number(row.netPayableAmount))
        );
        const paidOrRecoveredAmount =
          paidBySettlement.get(`machine:${row.id}`) ?? 0;
        const remainingAmount =
          row.status === "paid" && paidOrRecoveredAmount === 0
            ? 0
            : roundMoney(Math.max(0, originalAmount - paidOrRecoveredAmount));
        const lifecycle = lifecycleFor(
          row.status,
          remainingAmount,
          originalAmount
        );
        rows.push(
          safeBoardRow({
            sourceType: "machine",
            settlementId: row.id,
            settlementNo: row.settlementNo,
            direction: "expense",
            lifecycle,
            businessStatus: row.status,
            originalAmount,
            paidOrRecoveredAmount,
            offsetAmount: 0,
            remainingAmount,
            counterpartyDisplay: row.payeeName || "机械收款人",
            periodLabel: row.period,
            canRegisterSettlementPayment:
              canRegister && ["approved", "partial"].includes(row.status),
            legacyFinalized:
              row.status === "paid" && paidOrRecoveredAmount === 0,
          })
        );
      }
    if (sourceTypes.includes("payroll"))
      for (const row of payrolls) {
        const originalAmount = roundMoney(Number(row.actualAmount));
        const paidOrRecoveredAmount =
          paidBySettlement.get(`payroll:${row.id}`) ?? 0;
        const remainingAmount =
          row.status === "paid" && paidOrRecoveredAmount === 0
            ? 0
            : roundMoney(Math.max(0, originalAmount - paidOrRecoveredAmount));
        const lifecycle = lifecycleFor(
          row.status,
          remainingAmount,
          originalAmount
        );
        rows.push(
          safeBoardRow({
            sourceType: "payroll",
            settlementId: row.id,
            settlementNo: `工资-${row.period}-${row.id}`,
            direction: "expense",
            lifecycle,
            businessStatus: row.status,
            originalAmount,
            paidOrRecoveredAmount,
            offsetAmount: 0,
            remainingAmount,
            counterpartyDisplay: row.workerName || "员工",
            periodLabel: row.period,
            canRegisterSettlementPayment:
              canRegister && ["approved", "partial"].includes(row.status),
            legacyFinalized:
              row.status === "paid" && paidOrRecoveredAmount === 0,
          })
        );
      }
    if (sourceTypes.includes("daily_wage"))
      for (const row of dailyWages) {
        const originalAmount = roundMoney(Number(row.actualAmount));
        const paidOrRecoveredAmount =
          paidBySettlement.get(`daily_wage:${row.id}`) ?? 0;
        const remainingAmount =
          row.status === "paid" && paidOrRecoveredAmount === 0
            ? 0
            : roundMoney(Math.max(0, originalAmount - paidOrRecoveredAmount));
        const lifecycle = lifecycleFor(
          row.status,
          remainingAmount,
          originalAmount
        );
        rows.push(
          safeBoardRow({
            sourceType: "daily_wage",
            settlementId: row.id,
            settlementNo: `日结-${String(row.settlementDate).slice(0, 10)}-${row.id}`,
            direction: "expense",
            lifecycle,
            businessStatus: row.status,
            originalAmount,
            paidOrRecoveredAmount,
            offsetAmount: 0,
            remainingAmount,
            counterpartyDisplay: row.workerName || "临时工",
            periodLabel: String(row.settlementDate).slice(0, 10),
            canRegisterSettlementPayment:
              canRegister && ["approved", "partial"].includes(row.status),
            legacyFinalized:
              row.status === "paid" && paidOrRecoveredAmount === 0,
          })
        );
      }
    if (sourceTypes.includes("subcontract"))
      for (const row of subcontracts) {
        const originalAmount = roundMoney(
          Math.max(0, Number(row.netPayableAmount))
        );
        const paidOrRecoveredAmount =
          paidBySettlement.get(`subcontract:${row.id}`) ?? 0;
        const remainingAmount =
          row.status === "paid" && paidOrRecoveredAmount === 0
            ? 0
            : roundMoney(Math.max(0, originalAmount - paidOrRecoveredAmount));
        const lifecycle = lifecycleFor(
          row.status,
          remainingAmount,
          originalAmount
        );
        rows.push(
          safeBoardRow({
            sourceType: "subcontract",
            settlementId: row.id,
            settlementNo: row.settlementNo,
            direction: "expense",
            lifecycle,
            businessStatus: row.status,
            originalAmount,
            paidOrRecoveredAmount,
            offsetAmount: 0,
            remainingAmount,
            counterpartyDisplay: row.payeeName || "分包施工队",
            periodLabel: row.packageNoSnapshot,
            canRegisterSettlementPayment:
              canExecuteSettlementPayment(roleCodes, "subcontract") &&
              ["approved", "partial"].includes(row.status),
            legacyFinalized:
              row.status === "paid" && paidOrRecoveredAmount === 0,
          })
        );
      }
    const keyword = normalizeKeyword(input.keyword);
    const filteredRows = rows
      .filter(row => {
        if (input.direction !== "all" && row.direction !== input.direction)
          return false;
        if (input.lifecycle !== "all" && row.lifecycle !== input.lifecycle)
          return false;
        return (
          !keyword ||
          [
            row.settlementNo,
            row.counterpartyDisplay,
            row.periodLabel,
            row.sourceLabel,
          ].some(value => normalizeKeyword(value).includes(keyword))
        );
      })
      .sort(
        (a, b) =>
          Number(b.remainingAmount) - Number(a.remainingAmount) ||
          String(a.settlementNo).localeCompare(String(b.settlementNo), "zh-CN")
      );
    const sum = (
      items: typeof filteredRows,
      predicate: (row: any) => boolean
    ) =>
      roundMoney(
        items
          .filter(predicate)
          .reduce((total, row) => total + Number(row.remainingAmount ?? 0), 0)
      );
    const byType = settlementTypeSchema.options.map(sourceType => {
      const items = filteredRows.filter(item => item.sourceType === sourceType);
      return {
        sourceType,
        label: settlementTypeLabel[sourceType],
        payableCount: items.filter(
          item =>
            item.direction === "expense" &&
            ["ready", "partial"].includes(String(item.lifecycle))
        ).length,
        payableAmount: sum(
          items,
          item =>
            item.direction === "expense" &&
            ["ready", "partial"].includes(String(item.lifecycle))
        ),
        receivableCount: items.filter(
          item =>
            item.direction === "income" &&
            ["ready", "partial"].includes(String(item.lifecycle))
        ).length,
        receivableAmount: sum(
          items,
          item =>
            item.direction === "income" &&
            ["ready", "partial"].includes(String(item.lifecycle))
        ),
      };
    });
    return {
      asOfDate: input.asOfDate ?? asOfDate.toISOString().slice(0, 10),
      rows: filteredRows,
      summary: {
        payable: {
          count: filteredRows.filter(
            item =>
              item.direction === "expense" &&
              ["ready", "partial"].includes(String(item.lifecycle))
          ).length,
          amount: sum(
            filteredRows,
            item =>
              item.direction === "expense" &&
              ["ready", "partial"].includes(String(item.lifecycle))
          ),
        },
        receivable: {
          count: filteredRows.filter(
            item =>
              item.direction === "income" &&
              ["ready", "partial"].includes(String(item.lifecycle))
          ).length,
          amount: sum(
            filteredRows,
            item =>
              item.direction === "income" &&
              ["ready", "partial"].includes(String(item.lifecycle))
          ),
        },
        partial: {
          count: filteredRows.filter(item => item.lifecycle === "partial")
            .length,
          amount: sum(filteredRows, item => item.lifecycle === "partial"),
        },
        approvalPending: {
          count: filteredRows.filter(
            item => item.lifecycle === "approval_pending"
          ).length,
          amount: sum(
            filteredRows,
            item => item.lifecycle === "approval_pending"
          ),
        },
        byType,
      },
    };
  }),

  /**
   * 付款台账月度内部对账：仅以实际 paymentDate 落月；不是银行流水自动对账。
   * 默认不返回完整账户、支付参考号、证据 URL 或存储路径。
   */
  monthlyReconciliation: protectedProcedure
    .input(reconciliationInput)
    .query(async ({ ctx, input }) => {
      await assertPaymentBoardAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      const types = input.sourceTypes?.length
        ? input.sourceTypes
        : settlementTypeSchema.options;
      const { start, end } = getMonthBoundaries(input.period);
      if (!db)
        return {
          meta: {
            projectId: input.projectId,
            period: input.period,
            generatedAt: new Date().toISOString(),
            sourceTypes: types,
            direction: input.direction,
            status: input.status,
            paymentMethod: input.paymentMethod,
            keyword: input.keyword,
          },
          records: [],
          summary: {
            activeExpenseAmount: 0,
            activeIncomeAmount: 0,
            reversedAmount: 0,
            matching: { matched: 0, missing: 0, inconsistent: 0 },
            byType: [] as any[],
          },
        };
      const candidatePayments = await db
        .select()
        .from(settlementPaymentRecords)
        .where(
          and(
            eq(settlementPaymentRecords.projectId, input.projectId),
            gte(settlementPaymentRecords.paymentDate, start),
            lt(settlementPaymentRecords.paymentDate, end)
          )
        );
      const paymentRows = candidatePayments.filter(
        payment =>
          types.includes(payment.settlementType as SettlementType) &&
          (input.status === "all" || payment.status === input.status) &&
          (input.direction === "all" ||
            payment.direction === input.direction) &&
          (input.paymentMethod === "all" ||
            payment.paymentMethod === input.paymentMethod)
      );
      const idsByType = new Map<SettlementType, number[]>();
      for (const payment of paymentRows) {
        const type = payment.settlementType as SettlementType;
        idsByType.set(type, [
          ...(idsByType.get(type) ?? []),
          Number(payment.settlementId),
        ]);
      }
      const [
        vehicles,
        machines,
        payrolls,
        dailyWages,
        subcontracts,
        operatorRows,
        evidenceRows,
        financialRows,
      ] = await Promise.all([
        idsByType.get("transport_vehicle")?.length
          ? db
              .select({
                id: transportVehicleSettlements.id,
                settlementNo: transportVehicleSettlements.settlementNo,
                periodStart: transportVehicleSettlements.periodStart,
                periodEnd: transportVehicleSettlements.periodEnd,
              })
              .from(transportVehicleSettlements)
              .where(
                inArray(
                  transportVehicleSettlements.id,
                  idsByType.get("transport_vehicle")!
                )
              )
          : [],
        idsByType.get("machine")?.length
          ? db
              .select({
                id: machinePaymentSettlements.id,
                settlementNo: machinePaymentSettlements.settlementNo,
                period: machinePaymentSettlements.period,
              })
              .from(machinePaymentSettlements)
              .where(
                inArray(machinePaymentSettlements.id, idsByType.get("machine")!)
              )
          : [],
        idsByType.get("payroll")?.length
          ? db
              .select({
                id: payrollStatements.id,
                period: payrollStatements.period,
              })
              .from(payrollStatements)
              .where(inArray(payrollStatements.id, idsByType.get("payroll")!))
          : [],
        idsByType.get("daily_wage")?.length
          ? db
              .select({
                id: temporaryDailyWageSettlements.id,
                settlementDate: temporaryDailyWageSettlements.settlementDate,
              })
              .from(temporaryDailyWageSettlements)
              .where(
                inArray(
                  temporaryDailyWageSettlements.id,
                  idsByType.get("daily_wage")!
                )
              )
          : [],
        idsByType.get("subcontract")?.length
          ? db
              .select({
                id: subcontractPaymentSettlements.id,
                settlementNo: subcontractPaymentSettlements.settlementNo,
                packageNoSnapshot:
                  subcontractPaymentSettlements.packageNoSnapshot,
              })
              .from(subcontractPaymentSettlements)
              .where(
                inArray(
                  subcontractPaymentSettlements.id,
                  idsByType.get("subcontract")!
                )
              )
          : [],
        paymentRows.length
          ? db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(
                inArray(
                  users.id,
                  Array.from(new Set(paymentRows.map(item => item.paidBy)))
                )
              )
          : [],
        paymentRows.filter(item => item.evidenceId).length
          ? db
              .select({
                id: evidenceRecords.id,
                fileName: evidenceRecords.fileName,
                mimeType: evidenceRecords.mimeType,
                contentSha256: evidenceRecords.contentSha256,
              })
              .from(evidenceRecords)
              .where(
                inArray(
                  evidenceRecords.id,
                  paymentRows
                    .map(item => item.evidenceId)
                    .filter((id): id is number => Boolean(id))
                )
              )
          : [],
        paymentRows.length
          ? db
              .select({
                sourceId: financialRecords.sourceId,
                amount: financialRecords.amount,
                direction: financialRecords.direction,
              })
              .from(financialRecords)
              .where(
                and(
                  eq(financialRecords.projectId, input.projectId),
                  eq(financialRecords.sourceType, "settlement_payment"),
                  inArray(
                    financialRecords.sourceId,
                    paymentRows.map(item => String(item.id))
                  )
                )
              )
          : [],
      ]);
      const settlementByKey = new Map<
        string,
        { settlementNo: string; periodLabel: string }
      >();
      vehicles.forEach(item =>
        settlementByKey.set(`transport_vehicle:${item.id}`, {
          settlementNo: item.settlementNo,
          periodLabel: `${String(item.periodStart).slice(0, 10)} 至 ${String(item.periodEnd).slice(0, 10)}`,
        })
      );
      machines.forEach(item =>
        settlementByKey.set(`machine:${item.id}`, {
          settlementNo: item.settlementNo,
          periodLabel: item.period,
        })
      );
      payrolls.forEach(item =>
        settlementByKey.set(`payroll:${item.id}`, {
          settlementNo: `工资-${item.period}-${item.id}`,
          periodLabel: item.period,
        })
      );
      dailyWages.forEach(item =>
        settlementByKey.set(`daily_wage:${item.id}`, {
          settlementNo: `日结-${String(item.settlementDate).slice(0, 10)}-${item.id}`,
          periodLabel: String(item.settlementDate).slice(0, 10),
        })
      );
      subcontracts.forEach(item =>
        settlementByKey.set(`subcontract:${item.id}`, {
          settlementNo: item.settlementNo,
          periodLabel: item.packageNoSnapshot,
        })
      );
      const operatorById = new Map(
        operatorRows.map(item => [item.id, item.name || "经办人"])
      );
      const evidenceById = new Map(
        evidenceRows.map(item => [
          item.id,
          {
            evidenceId: item.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            sha256Prefix: String(item.contentSha256 ?? "").slice(0, 12),
          },
        ])
      );
      const financialBySourceId = new Map(
        financialRows.map(item => [String(item.sourceId), item])
      );
      const keyword = normalizeKeyword(input.keyword);
      const records = paymentRows
        .map(payment => {
          const settlement = settlementByKey.get(
            `${payment.settlementType}:${payment.settlementId}`
          ) ?? {
            settlementNo: `${settlementTypeLabel[payment.settlementType as SettlementType]}-${payment.settlementId}`,
            periodLabel: "—",
          };
          const financial = financialBySourceId.get(String(payment.id));
          const reconciliationStatus = !financial
            ? ("missing" as const)
            : Number(financial.amount) !== Number(payment.amount) ||
                financial.direction !== payment.direction
              ? ("inconsistent" as const)
              : ("matched" as const);
          return {
            id: payment.id,
            voucherNo: `SPV-${input.projectId}-${payment.id}`,
            settlementType: payment.settlementType as SettlementType,
            settlementTypeLabel:
              settlementTypeLabel[payment.settlementType as SettlementType],
            settlementId: payment.settlementId,
            settlementNo: settlement.settlementNo,
            periodLabel: settlement.periodLabel,
            direction: payment.direction,
            status: payment.status,
            amount: Number(payment.amount),
            paymentDate: String(payment.paymentDate).slice(0, 10),
            paymentMethod: payment.paymentMethod,
            paymentMethodLabel: paymentMethodLabel[payment.paymentMethod],
            payeeName: payment.payeeNameSnapshot,
            operatorName: operatorById.get(payment.paidBy) ?? "经办人",
            paidAt: payment.paidAt,
            proof: payment.evidenceId
              ? (evidenceById.get(payment.evidenceId) ?? null)
              : null,
            reconciliationStatus,
          };
        })
        .filter(
          record =>
            !keyword ||
            [
              record.voucherNo,
              record.settlementNo,
              record.settlementTypeLabel,
              record.payeeName,
              record.operatorName,
              record.periodLabel,
            ].some(value => normalizeKeyword(value).includes(keyword))
        );
      const aggregate = (sourceType: SettlementType) => {
        const items = records.filter(
          item => item.settlementType === sourceType
        );
        return {
          sourceType,
          label: settlementTypeLabel[sourceType],
          count: items.length,
          activeExpenseAmount: roundMoney(
            items
              .filter(
                item => item.status === "active" && item.direction === "expense"
              )
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          activeIncomeAmount: roundMoney(
            items
              .filter(
                item => item.status === "active" && item.direction === "income"
              )
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          reversedAmount: roundMoney(
            items
              .filter(item => item.status === "reversed")
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          matched: items.filter(item => item.reconciliationStatus === "matched")
            .length,
          missing: items.filter(item => item.reconciliationStatus === "missing")
            .length,
          inconsistent: items.filter(
            item => item.reconciliationStatus === "inconsistent"
          ).length,
        };
      };
      return {
        meta: {
          projectId: input.projectId,
          period: input.period,
          generatedAt: new Date().toISOString(),
          sourceTypes: types,
          direction: input.direction,
          status: input.status,
          paymentMethod: input.paymentMethod,
          keyword: input.keyword,
        },
        records,
        summary: {
          activeExpenseAmount: roundMoney(
            records
              .filter(
                item => item.status === "active" && item.direction === "expense"
              )
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          activeIncomeAmount: roundMoney(
            records
              .filter(
                item => item.status === "active" && item.direction === "income"
              )
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          reversedAmount: roundMoney(
            records
              .filter(item => item.status === "reversed")
              .reduce((sum, item) => sum + item.amount, 0)
          ),
          matching: {
            matched: records.filter(
              item => item.reconciliationStatus === "matched"
            ).length,
            missing: records.filter(
              item => item.reconciliationStatus === "missing"
            ).length,
            inconsistent: records.filter(
              item => item.reconciliationStatus === "inconsistent"
            ).length,
          },
          byType: types.map(aggregate),
        },
      };
    }),

  /** 保险附件仅经现有财务授权RPC读取，不下发存储签名或永久公开URL。 */
  getInsuranceEvidence: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        policyId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertPaymentAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return null;
      const [policy] = await db
        .select({
          id: employeeInsurancePolicies.id,
          evidenceId: employeeInsurancePolicies.evidenceId,
          employeeProfileId: employeeInsurancePolicies.employeeProfileId,
        })
        .from(employeeInsurancePolicies)
        .where(eq(employeeInsurancePolicies.id, input.policyId))
        .limit(1);
      if (!policy) return null;
      const [profile] = await db.select({ id: employeeProfiles.id, projectId: employeeProfiles.projectId }).from(employeeProfiles).where(eq(employeeProfiles.id, policy.employeeProfileId)).limit(1);
      if (!profile || profile.projectId !== input.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "保单真实员工项目不在当前授权项目" });
      await assertProjectInCurrentScope(ctx, profile.projectId);
      if (!policy.evidenceId) return null;
      const [evidence] = await db
        .select({
          id: evidenceRecords.id,
          fileKey: evidenceRecords.fileKey,
          fileName: evidenceRecords.fileName,
          mimeType: evidenceRecords.mimeType,
          status: evidenceRecords.status,
          sourceType: evidenceRecords.sourceType,
          sourceId: evidenceRecords.sourceId,
          projectId: evidenceRecords.projectId,
          contentBytes: evidenceRecords.contentBytes,
          contentSha256: evidenceRecords.contentSha256,
        })
        .from(evidenceRecords)
        .where(eq(evidenceRecords.id, policy.evidenceId))
        .limit(1);
      if (!evidence || evidence.status !== "active" || evidence.sourceType !== "employee_insurance_policy" || evidence.sourceId !== String(profile.id) || evidence.projectId !== profile.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件来源、员工主体或项目不一致" });
      if (!evidence.fileKey || !["image/jpeg", "image/png", "application/pdf"].includes(evidence.mimeType ?? "") || !evidence.contentBytes || evidence.contentBytes > MAX_PROOF_BYTES || !/^[a-f0-9]{64}$/.test(evidence.contentSha256 ?? "")) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件缺少完整性信息" });
      let bytes: Buffer;
      if (ENV.selfHostStorageDir && !isAliyunOssPhotoStorageKey(evidence.fileKey)) {
        const root = path.resolve(ENV.selfHostStorageDir); const file = path.resolve(root, evidence.fileKey);
        if (!file.startsWith(root + path.sep)) throw new TRPCError({ code: "FORBIDDEN", message: "无效保单存储键" });
        const stat = await fs.stat(file);
        if (stat.size > MAX_PROOF_BYTES) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件过大" });
        bytes = await fs.readFile(file);
      } else {
        const signed = await storageGetSignedUrl(evidence.fileKey);
        if (!/^https:\/\//.test(signed)) throw new TRPCError({ code: "FORBIDDEN", message: "保单存储不可受控读取" });
        const response = await fetch(signed, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok || !response.body) throw new TRPCError({ code: "NOT_FOUND", message: "保单附件不可读取" });
        const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_PROOF_BYTES) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件过大" }); chunks.push(Buffer.from(value)); } }
        finally { await reader.cancel(); }
        bytes = Buffer.concat(chunks, size);
      }
      if (bytes.length !== evidence.contentBytes || createHash("sha256").update(bytes).digest("hex") !== evidence.contentSha256) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件完整性校验失败" });
      try { assertCertificateFileSignature(bytes, evidence.mimeType as "image/jpeg" | "image/png" | "application/pdf"); } catch { throw new TRPCError({ code: "FORBIDDEN", message: "保单附件格式无效" }); }
      return {
        id: evidence.id,
        fileName: evidence.fileName,
        mimeType: evidence.mimeType,
        url: `data:${evidence.mimeType};base64,${bytes.toString("base64")}`,
      };
    }),
});
