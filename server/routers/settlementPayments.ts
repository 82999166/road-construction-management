import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  dailyAccountingClosures,
  employeeInsurancePolicies,
  evidenceRecords,
  financialRecords,
  laborWorkers,
  machinePaymentSettlements,
  payrollStatements,
  settlementPaymentRecords,
  temporaryDailyWageSettlements,
  transportVehicleSettlements,
} from "../../drizzle/schema";
import { assertCertificateFileSignature } from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";
import { appendIntegrityProtectedAudit } from "../services/auditIntegrity";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";

const settlementTypeSchema = z.enum(["transport_vehicle", "machine", "payroll", "daily_wage"]);
const paymentMethodSchema = z.enum(["bank_transfer", "corporate_account", "cash", "wechat", "alipay", "other"]);
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
  /** 收款户名可在车辆/机械收款资料中自动带入，工资默认取人员实名。 */
  payeeName: z.string().trim().min(1, "请填写收款人/补款人").max(128),
  payeeAccount: z.string().trim().max(160).nullable().optional(),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  evidenceId: z.number().int().positive("请先上传本次付款凭证"),
  remarks: z.string().trim().max(500).nullable().optional(),
});

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function safeFileName(value: string, fallback: string) {
  return value.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_").slice(-160) || fallback;
}
function canExecuteSettlementPayment(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT") || roleCodes.includes("FINANCE_MANAGER");
}
async function assertPaymentAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "FINANCE");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  if (!canExecuteSettlementPayment(roleCodes)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "实际付款、补款与付款凭证登记仅限会计、财务负责人或系统管理员" });
  }
  return roleCodes;
}
function proofSourceId(settlementType: z.infer<typeof settlementTypeSchema>, settlementId: number) {
  return `${settlementType}:${settlementId}`;
}
function decodeProofBase64(value: string, mimeType: "image/jpeg" | "image/png" | "application/pdf") {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(normalized)) throw new TRPCError({ code: "BAD_REQUEST", message: "付款凭证编码无效" });
  const bytes = Buffer.from(normalized.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: mimeType === "application/pdf" ? "付款凭证 PDF 不能超过 15MB" : "付款凭证图片不能超过 15MB" });
  }
  try {
    assertCertificateFileSignature(bytes, mimeType);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "付款凭证文件内容与声明格式不一致" });
  }
  return bytes;
}

/** 读取结算主单；同时给出金额方向，负的车辆净额必须登记为“司机/车主补款收入”。 */
async function getSettlementForPayment(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: { projectId: number; settlementType: z.infer<typeof settlementTypeSchema>; settlementId: number }) {
  if (input.settlementType === "transport_vehicle") {
    const [row] = await db.select().from(transportVehicleSettlements).where(eq(transportVehicleSettlements.id, input.settlementId)).limit(1);
    if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "车辆结算单不存在或不属于当前项目" });
    const signedAmount = roundMoney(Number(row.netPayableAmount));
    return { row, amount: Math.abs(signedAmount), direction: signedAmount >= 0 ? "expense" as const : "income" as const, category: signedAmount >= 0 ? "车辆结算实际付款" : "车辆扣款补收", label: row.settlementNo, payeeName: row.payeeName, payeeAccount: row.payeeAccount, statuses: ["approved", "partial", "receivable"] };
  }
  if (input.settlementType === "machine") {
    const [row] = await db.select().from(machinePaymentSettlements).where(eq(machinePaymentSettlements.id, input.settlementId)).limit(1);
    if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械付款结算单不存在或不属于当前项目" });
    return { row, amount: roundMoney(Math.max(0, Number(row.netPayableAmount))), direction: "expense" as const, category: "机械结算实际付款", label: row.settlementNo, payeeName: row.payeeName, payeeAccount: row.payeeAccount, statuses: ["approved", "partial"] };
  }
  if (input.settlementType === "payroll") {
    const [row] = await db.select({ id: payrollStatements.id, projectId: payrollStatements.projectId, status: payrollStatements.status, actualAmount: payrollStatements.actualAmount, period: payrollStatements.period, workerName: laborWorkers.realName }).from(payrollStatements).innerJoin(laborWorkers, eq(payrollStatements.workerId, laborWorkers.id)).where(eq(payrollStatements.id, input.settlementId)).limit(1);
    if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "工资条不存在或不属于当前项目" });
    return { row, amount: roundMoney(Number(row.actualAmount)), direction: "expense" as const, category: "工资实际发放", label: `${row.period} 工资条`, payeeName: row.workerName || "员工", payeeAccount: null, statuses: ["approved", "partial"] };
  }
  const [row] = await db.select({ id: temporaryDailyWageSettlements.id, projectId: temporaryDailyWageSettlements.projectId, status: temporaryDailyWageSettlements.status, actualAmount: temporaryDailyWageSettlements.actualAmount, settlementDate: temporaryDailyWageSettlements.settlementDate, workerName: laborWorkers.realName }).from(temporaryDailyWageSettlements).innerJoin(laborWorkers, eq(temporaryDailyWageSettlements.workerId, laborWorkers.id)).where(eq(temporaryDailyWageSettlements.id, input.settlementId)).limit(1);
  if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "临时日结不存在或不属于当前项目" });
  return { row, amount: roundMoney(Number(row.actualAmount)), direction: "expense" as const, category: "临时日结实际发放", label: "临时日结", payeeName: row.workerName || "员工", payeeAccount: null, statuses: ["approved", "partial"] };
}

async function updateSettlementPaymentStatus(tx: any, input: { settlementType: z.infer<typeof settlementTypeSchema>; settlementId: number; final: boolean; direction: "expense" | "income"; paymentDate: Date; paymentReference: string | null; paidBy: number }) {
  const common = { paymentDate: input.paymentDate, paymentReference: input.paymentReference, paidBy: input.paidBy, paidAt: new Date() };
  if (input.settlementType === "transport_vehicle") {
    await tx.update(transportVehicleSettlements).set({ ...common, status: input.final ? (input.direction === "income" ? "offset" : "paid") : "partial" }).where(eq(transportVehicleSettlements.id, input.settlementId));
  } else if (input.settlementType === "machine") {
    await tx.update(machinePaymentSettlements).set({ ...common, status: input.final ? "paid" : "partial" }).where(eq(machinePaymentSettlements.id, input.settlementId));
  } else if (input.settlementType === "payroll") {
    await tx.update(payrollStatements).set({ paidAt: new Date(), paymentReference: input.paymentReference, status: input.final ? "paid" : "partial" }).where(eq(payrollStatements.id, input.settlementId));
  } else {
    await tx.update(temporaryDailyWageSettlements).set({ paidAt: new Date(), paymentReference: input.paymentReference, paidBy: input.paidBy, status: input.final ? "paid" : "partial" }).where(eq(temporaryDailyWageSettlements.id, input.settlementId));
  }
}

export const settlementPaymentRouter = router({
  /** 新付款凭证先入受控证据库；仅能被同一项目、同一结算单实际付款动作引用。 */
  uploadProof: protectedProcedure.input(paymentProofUploadInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPaymentAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await getSettlementForPayment(db, input);
    const bytes = decodeProofBase64(input.base64Data, input.mimeType);
    const uploadedAt = new Date();
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = safeFileName(input.fileName, "payment-proof.pdf");
    const stored = await storagePut(`settlement-proofs/${input.projectId}/${input.settlementType}/${input.settlementId}/${uploadedAt.toISOString().slice(0, 10)}/${user.id}-${fileName}`, bytes, input.mimeType);
    let evidenceId = 0;
    await db.transaction(async tx => {
      const result = await tx.insert(evidenceRecords).values({ projectId: input.projectId, sourceType: "settlement_payment_proof", sourceId: proofSourceId(input.settlementType, input.settlementId), fileKey: stored.key, fileName, mimeType: input.mimeType, contentSha256, contentBytes: bytes.length, watermarkJson: JSON.stringify({ description: input.description, captureMode: "settlement_payment_proof", uploadedAt: uploadedAt.toISOString(), version: 1 }), longitude: null, latitude: null, capturedAt: uploadedAt, retentionUntil: null, status: "active", uploadedBy: user.id });
      evidenceId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "finance", action: "upload_settlement_payment_proof", targetType: "evidence", targetId: String(evidenceId || stored.key), summary: `归档结算付款凭证：${input.settlementType} · ${input.description.slice(0, 80)}`, afterJson: JSON.stringify({ projectId: input.projectId, settlementType: input.settlementType, settlementId: input.settlementId, contentSha256, contentBytes: bytes.length, mimeType: input.mimeType }) });
    });
    if (!evidenceId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "付款凭证归档失败，请稍后重试" });
    return { success: true, evidenceId, fileName, mimeType: input.mimeType };
  }),

  /** 列出结算单付款明细及受控短时预览地址；不返回银行卡等薪资敏感资料。 */
  list: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), settlementType: settlementTypeSchema, settlementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPaymentAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { dueAmount: 0, paidAmount: 0, remainingAmount: 0, direction: "expense" as const, records: [] };
    const settlement = await getSettlementForPayment(db, input);
    const records = await db.select().from(settlementPaymentRecords).where(and(eq(settlementPaymentRecords.projectId, input.projectId), eq(settlementPaymentRecords.settlementType, input.settlementType), eq(settlementPaymentRecords.settlementId, input.settlementId))).orderBy(desc(settlementPaymentRecords.paymentDate), desc(settlementPaymentRecords.id));
    const active = records.filter(item => item.status === "active");
    const paidAmount = roundMoney(active.reduce((sum, item) => sum + Number(item.amount), 0));
    const remainingAmount = roundMoney(Math.max(0, settlement.amount - paidAmount));
    const evidenceIds = active.map(item => item.evidenceId).filter((id): id is number => typeof id === "number" && id > 0);
    const evidences = evidenceIds.length ? await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType, sourceType: evidenceRecords.sourceType, sourceId: evidenceRecords.sourceId, status: evidenceRecords.status }).from(evidenceRecords).where(inArray(evidenceRecords.id, evidenceIds)) : [];
    const evidenceById = new Map(await Promise.all(evidences.filter(item => item.status === "active" && item.sourceType === "settlement_payment_proof" && item.sourceId === proofSourceId(input.settlementType, input.settlementId)).map(async item => [item.id, { fileName: item.fileName, mimeType: item.mimeType, url: await storageGetSignedUrl(item.fileKey) }] as const)));
    return { dueAmount: settlement.amount, paidAmount, remainingAmount, direction: settlement.direction, defaultPayee: { name: settlement.payeeName, account: settlement.payeeAccount }, status: settlement.row.status, records: records.map(item => ({ ...item, evidence: item.evidenceId ? evidenceById.get(item.evidenceId) ?? null : null })) };
  }),

  /** 登记一笔真实收付。金额不得超过服务端计算的未结余额；每一笔同步生成一条真实财务流水。 */
  record: protectedProcedure.input(paymentRecordInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPaymentAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const settlement = await getSettlementForPayment(db, input);
    if (!settlement.statuses.includes(String(settlement.row.status))) throw new TRPCError({ code: "CONFLICT", message: "当前结算单不是待付款、部分付款或待收补款状态，不能继续登记资金" });
    const paymentDate = toBusinessDate(input.paymentDate);
    const [closure] = await db.select({ status: dailyAccountingClosures.status }).from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, paymentDate))).limit(1);
    if (closure && ["closed", "archived"].includes(closure.status)) throw new TRPCError({ code: "CONFLICT", message: "付款日期已封存，须由财务负责人先授权反结账后再登记付款" });
    const [proof] = await db.select({ id: evidenceRecords.id, projectId: evidenceRecords.projectId, sourceType: evidenceRecords.sourceType, sourceId: evidenceRecords.sourceId, status: evidenceRecords.status }).from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1);
    if (!proof || proof.projectId !== input.projectId || proof.status !== "active" || proof.sourceType !== "settlement_payment_proof" || proof.sourceId !== proofSourceId(input.settlementType, input.settlementId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "请上传并关联当前结算单的有效付款凭证" });
    }
    const existing = await db.select({ amount: settlementPaymentRecords.amount }).from(settlementPaymentRecords).where(and(eq(settlementPaymentRecords.projectId, input.projectId), eq(settlementPaymentRecords.settlementType, input.settlementType), eq(settlementPaymentRecords.settlementId, input.settlementId), eq(settlementPaymentRecords.status, "active")));
    const paidAmount = roundMoney(existing.reduce((sum, item) => sum + Number(item.amount), 0));
    const remainingAmount = roundMoney(Math.max(0, settlement.amount - paidAmount));
    const amount = roundMoney(input.amount);
    if (amount > remainingAmount) throw new TRPCError({ code: "BAD_REQUEST", message: `本次金额不能超过待结余额 ¥${remainingAmount.toFixed(2)}` });
    const final = roundMoney(remainingAmount - amount) === 0;
    let paymentId = 0;
    await db.transaction(async tx => {
      const result = await tx.insert(settlementPaymentRecords).values({ projectId: input.projectId, settlementType: input.settlementType, settlementId: input.settlementId, direction: settlement.direction, amount: String(amount), paymentDate, paymentMethod: input.paymentMethod, payeeNameSnapshot: input.payeeName.trim(), payeeAccountSnapshot: input.payeeAccount?.trim() || null, paymentReference: input.paymentReference?.trim() || null, evidenceId: input.evidenceId, remarks: input.remarks?.trim() || null, status: "active", paidBy: user.id, paidAt: new Date(), reversedBy: null, reversedAt: null, reversalReason: null });
      paymentId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      await tx.insert(financialRecords).values({ recordNo: `F-SPAY-${input.settlementType}-${paymentId || Date.now()}`, projectId: input.projectId, direction: settlement.direction, category: settlement.category, amount: String(amount), occurredAt: paymentDate, settlementStatus: "paid", sourceType: "settlement_payment", sourceId: String(paymentId), evidenceId: input.evidenceId, remarks: `${settlement.label}：${input.paymentMethod}${input.paymentReference?.trim() ? `；付款参考号 ${input.paymentReference.trim()}` : ""}` });
      await updateSettlementPaymentStatus(tx, { settlementType: input.settlementType, settlementId: input.settlementId, final, direction: settlement.direction, paymentDate, paymentReference: input.paymentReference?.trim() || null, paidBy: user.id });
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "finance", action: settlement.direction === "expense" ? "record_settlement_payment" : "record_vehicle_recovery", targetType: "settlement_payment_record", targetId: String(paymentId || `${input.settlementType}-${input.settlementId}`), summary: `${settlement.label}已登记${settlement.direction === "expense" ? "实际付款" : "实际补款"}；${final ? "本单已结清" : "保留待结余额"}`, afterJson: JSON.stringify({ projectId: input.projectId, settlementType: input.settlementType, settlementId: input.settlementId, direction: settlement.direction, amount, evidenceId: input.evidenceId }) });
    });
    const status = final ? (settlement.direction === "income" ? "offset" : "paid") : "partial";
    if (input.settlementType === "payroll" || input.settlementType === "daily_wage") {
      const eventCode = input.settlementType === "payroll" ? (final ? "payroll_paid" : "payroll_partial") : (final ? "daily_wage_paid" : "daily_wage_partial");
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "labor", eventCode, targetType: input.settlementType, targetId: String(input.settlementId), title: final ? "工资付款已登记" : "工资部分发放已登记", content: final ? "本次实际付款已登记并已上传凭证，请进入系统核对。" : "本次实际付款已登记并已上传凭证，尚有余额待结。", deepLink: "/mobile/labor" }).catch(() => undefined);
    }
    return { success: true, paymentId, dueAmount: settlement.amount, paidAmount: roundMoney(paidAmount + amount), remainingAmount: roundMoney(Math.max(0, remainingAmount - amount)), status };
  }),

  /** 仅用于保险台账附件读取，仍复用同一受控证据库与短时签名 URL。 */
  getInsuranceEvidence: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), policyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPaymentAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return null;
    const [policy] = await db.select({ id: employeeInsurancePolicies.id, evidenceId: employeeInsurancePolicies.evidenceId }).from(employeeInsurancePolicies).where(eq(employeeInsurancePolicies.id, input.policyId)).limit(1);
    if (!policy?.evidenceId) return null;
    const [evidence] = await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType, status: evidenceRecords.status }).from(evidenceRecords).where(eq(evidenceRecords.id, policy.evidenceId)).limit(1);
    if (!evidence || evidence.status !== "active") return null;
    return { id: evidence.id, fileName: evidence.fileName, mimeType: evidence.mimeType, url: await storageGetSignedUrl(evidence.fileKey) };
  }),
});
