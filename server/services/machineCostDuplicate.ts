import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import { auditLogs, machineCostRecords } from "../../drizzle/schema";
import type { MachineCostDraft, MachineCostSave, MachineCostDuplicateCandidate, MachineCostDuplicateCheck } from "../../shared/machineCostDuplicate";
import { ENV } from "../_core/env";
import { chinaBusinessDate } from "./chinaBusinessTime";
import type { MachineFuelLedgerDb, MachineFuelLedgerTx } from "./machineFuelLedger";

const CONFIRM_TTL_MS = 10 * 60_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: string | null | undefined) => value?.trim().normalize("NFKC").toLocaleLowerCase() || "";
export const money2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const cents = (value: unknown) => value === null || value === undefined ? null : Math.round(money2(Number(value)) * 100);
export function machineCostRequestHash(input: MachineCostDraft, appliedUnitPrice: number, userId: number) {
  return hash({ userId, projectId: input.projectId, machineId: input.machineId, costType: input.costType,
    costName: input.costName.trim(), quantity: input.quantity, unitPrice: input.unitPrice,
    appliedUnitPrice, occurredAt: new Date(input.occurredAt).toISOString(), evidenceId: input.evidenceId ?? null,
    remarks: input.remarks?.trim() || null, requestId: input.requestId ?? null });
}
export function machineCostReceiptKey(input: MachineCostDraft) {
  return hash(["machine-cost-request/v1", input.projectId, input.machineId, input.requestId]);
}

/** 两位数字比较，历史 NULL 名称/数量/单价不能使旧记录漏检；NULL 不改变原记录。 */
export function projectMachineCostCandidates(
  rows: Array<typeof machineCostRecords.$inferSelect>, input: MachineCostDraft, appliedUnitPrice: number
): MachineCostDuplicateCandidate[] {
  const occurredAt = new Date(input.occurredAt);
  const amount = cents(money2(input.quantity * appliedUnitPrice));
  return rows.filter(row => {
    if (row.projectId !== input.projectId || row.machineId !== input.machineId || row.status === "void") return false;
    if (input.evidenceId && row.evidenceId === input.evidenceId) return true;
    return chinaBusinessDate(row.occurredAt) === chinaBusinessDate(occurredAt)
      && row.costType === input.costType && (!text(row.costName) || text(row.costName) === text(input.costName))
      && (cents(row.quantity) === null || cents(row.quantity) === cents(input.quantity))
      && (cents(row.unitPrice) === null || cents(row.unitPrice) === cents(appliedUnitPrice))
      && cents(row.amount) === amount;
  }).map(row => ({
    id: row.id, occurredAt: new Date(row.occurredAt), costType: row.costType, costName: row.costName,
    quantity: row.quantity, unitPrice: row.unitPrice, amount: row.amount, status: row.status,
    sameSource: Boolean(input.evidenceId && row.evidenceId === input.evidenceId),
    sameInstant: Math.floor(new Date(row.occurredAt).getTime() / 1000) === Math.floor(occurredAt.getTime() / 1000),
  })).sort((a, b) => a.id - b.id);
}

export async function readMachineCostCandidates(
  db: MachineFuelLedgerDb | MachineFuelLedgerTx, input: MachineCostDraft, appliedUnitPrice: number, locked = false
) {
  const day = chinaBusinessDate(input.occurredAt);
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const dayPredicate = and(gte(machineCostRecords.occurredAt, start), lt(machineCostRecords.occurredAt, end));
  const query = db.select().from(machineCostRecords).where(and(
    eq(machineCostRecords.projectId, input.projectId), eq(machineCostRecords.machineId, input.machineId),
    or(ne(machineCostRecords.status, "void"), isNull(machineCostRecords.status)),
    input.evidenceId ? or(dayPredicate, eq(machineCostRecords.evidenceId, input.evidenceId)) : dayPredicate
  ));
  const rows = await (locked ? query.for("update") : query);
  return projectMachineCostCandidates(rows, input, appliedUnitPrice);
}
function sign(payload: string) {
  if (!ENV.cookieSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "费用防重确认服务未配置，暂不能确认另笔费用" });
  return createHmac("sha256", ENV.cookieSecret).update(`machine-cost-confirm/v1:${payload}`).digest("base64url");
}
export function buildMachineCostDuplicateCheck(
  candidates: MachineCostDuplicateCandidate[], requestHash: string
): MachineCostDuplicateCheck {
  const hardConflict = candidates.some(row => row.sameInstant || row.sameSource);
  if (!candidates.length || hardConflict) return { candidates, hardConflict, confirmationToken: null, expiresAt: null };
  const expiresAt = Date.now() + CONFIRM_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ requestHash, candidatesHash: hash(candidates), expiresAt })).toString("base64url");
  return { candidates, hardConflict, expiresAt, confirmationToken: `${payload}.${sign(payload)}` };
}
function validConfirmation(input: MachineCostSave, requestHash: string, candidates: MachineCostDuplicateCandidate[]) {
  if (!input.duplicateConfirmation || candidates.some(row => row.sameInstant || row.sameSource)) return false;
  try {
    const [payload, signature, extra] = input.duplicateConfirmation.token.split(".");
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.requestHash === requestHash && data.candidatesHash === hash(candidates)
      && Number.isFinite(data.expiresAt) && Date.now() < data.expiresAt;
  } catch { return false; }
}
export type MachineCostSavedResult = {
  success: true; id: number; dieselRefuelRecordId: number | null; amount: number; unitPrice: number;
  guidelinePriceId: number | null; duplicate?: boolean;
};
/** 调用者必须先持有 machines(project,id) 行锁；锁定读绕过等待前的 RR 快照。 */
export async function decideMachineCostWrite(tx: MachineFuelLedgerTx, input: MachineCostSave, appliedUnitPrice: number, userId: number) {
  const requestHash = machineCostRequestHash(input, appliedUnitPrice, userId);
  if (input.requestId) {
    const [receipt] = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.module, "machinery"), eq(auditLogs.action, "create_cost_request"),
      eq(auditLogs.targetType, "machine_cost_request"), eq(auditLogs.targetId, machineCostReceiptKey(input))
    )).limit(1).for("update");
    if (receipt) {
      let data: { requestHash: string; result: MachineCostSavedResult };
      try { data = JSON.parse(receipt.afterJson || ""); }
      catch { throw new TRPCError({ code: "CONFLICT", message: "原请求回执异常，请检查费用台账" }); }
      if (data.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "同一费用请求编号不可用于修改后的内容，请重新检查" });
      const [cost] = await tx.select().from(machineCostRecords).where(and(
        eq(machineCostRecords.id, data.result.id), eq(machineCostRecords.projectId, input.projectId),
        eq(machineCostRecords.machineId, input.machineId)
      )).limit(1).for("update");
      if (!cost || cost.status === "void") throw new TRPCError({ code: "CONFLICT", message: "原请求费用已作废或不存在，请检查台账，不可重试入账" });
      return { kind: "replay" as const, result: { ...data.result, duplicate: true } };
    }
  }
  const candidates = await readMachineCostCandidates(tx, input, appliedUnitPrice, true);
  if (candidates.length && !validConfirmation(input, requestHash, candidates)) {
    return { kind: "confirmation" as const, check: buildMachineCostDuplicateCheck(candidates, requestHash) };
  }
  // 输入携带旧确认但候选已经消失，同样要求重新检查，不能静默使用过期授权。
  if (!candidates.length && input.duplicateConfirmation) {
    return { kind: "confirmation" as const, check: buildMachineCostDuplicateCheck(candidates, requestHash) };
  }
  return { kind: "write" as const, requestHash };
}
export async function recordMachineCostReceipt(tx: MachineFuelLedgerTx, input: MachineCostSave, requestHash: string, userId: number, result: MachineCostSavedResult) {
  if (!input.requestId) return;
  await tx.insert(auditLogs).values({ userId, module: "machinery", action: "create_cost_request",
    targetType: "machine_cost_request", targetId: machineCostReceiptKey(input),
    summary: `机械费用请求回执 #${result.id}${input.duplicateConfirmation ? "，经不同实际业务二次确认" : ""}`,
    afterJson: JSON.stringify({ requestHash, projectId: input.projectId, machineId: input.machineId, result,
      confirmationReason: input.duplicateConfirmation?.reason ?? null }) });
}
