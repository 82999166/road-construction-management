import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { auditLogs, dieselRefuelRecords, evidenceRecords, machineCostRecords, machineMonthlyStatements, machinePaymentSettlements, projects } from "../../drizzle/schema";
import { chinaBusinessMonth } from "./chinaBusinessTime";
import { assertMachineFuelWriteApplied, lockMachineFuelLedger, type MachineFuelCost, type MachineFuelLedgerTx, type MachineFuelLedgerDb } from "./machineFuelLedger";
import { lockActiveEvidenceForBinding } from "./evidenceIntegrity";

export const machineCostCorrectionConflict = () => new TRPCError({ code: "CONFLICT", message: "费用版本或来源已变化，未覆盖写入，请刷新台账后重新修改" });

/** 成本表没有 updatedAt；快照 + 追加审计 ID 构成强制版本，ABA/同秒修改也不能复用旧版本。 */
export async function machineCostVersion(tx: MachineFuelLedgerTx | MachineFuelLedgerDb, cost: MachineFuelCost, locked = false) {
  const query = tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
    eq(auditLogs.module, "machinery"), eq(auditLogs.action, "edit_cost_draft"),
    eq(auditLogs.targetType, "machine_cost"), eq(auditLogs.targetId, String(cost.id))
  )).orderBy(desc(auditLogs.id)).limit(1);
  const [edit] = await (locked ? query.for("update") : query);
  return createHash("sha256").update(JSON.stringify({ id: cost.id, projectId: cost.projectId, machineId: cost.machineId,
    costType: cost.costType, costName: cost.costName, quantity: Number(cost.quantity), unitPrice: Number(cost.unitPrice),
    amount: Number(cost.amount), occurredAt: new Date(cost.occurredAt).toISOString(), evidenceId: cost.evidenceId ?? null,
    remarks: cost.remarks ?? null, status: cost.status, dieselRefuelRecordId: cost.dieselRefuelRecordId ?? null,
    editId: edit?.id ?? null })).digest("hex");
}

export async function machineCostCreator(tx: MachineFuelLedgerTx | MachineFuelLedgerDb, cost: MachineFuelCost) {
  const logs = await tx.select({ userId: auditLogs.userId }).from(auditLogs).where(and(
    eq(auditLogs.module, "machinery"), eq(auditLogs.action, "create_cost"),
    eq(auditLogs.targetType, "machine_cost"), eq(auditLogs.targetId, String(cost.id))
  ));
  const creators = Array.from(new Set(logs.map(row => row.userId)));
  if (creators.length === 1 && creators[0]) return creators[0];
  // 由柴油登记生成的成本使用原柴油真实登记人，不猜当前操作者。
  if (!creators.length && cost.costType === "fuel" && cost.dieselRefuelRecordId) {
    const [diesel] = await tx.select().from(dieselRefuelRecords).where(eq(dieselRefuelRecords.id, cost.dieselRefuelRecordId)).limit(1);
    if (diesel?.projectId === cost.projectId && diesel.machineId === cost.machineId && diesel.createdBy) return diesel.createdBy;
  }
  throw new TRPCError({ code: "CONFLICT", message: "原费用真实登记人无法唯一确认，请先核对来源审计" });
}

/** 项目 -> 机械 -> 原成本；编辑和 fuel 作废共同锁序，与柴油纠错和实际付款一致。 */
export async function lockMachineCostForCorrection(tx: MachineFuelLedgerTx, input: { id: number; projectId: number; machineId: number }) {
  const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update");
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "费用项目不存在" });
  await lockMachineFuelLedger(tx, input);
  const [cost] = await tx.select().from(machineCostRecords).where(eq(machineCostRecords.id, input.id)).limit(1).for("update");
  if (!cost || cost.projectId !== input.projectId || cost.machineId !== input.machineId)
    throw new TRPCError({ code: "NOT_FOUND", message: "机械费用不存在或身份不属于当前项目/机械" });
  return cost;
}

/** 草稿不能改变已冻结月结/任何有效付款来源；同时检查修改前与修改后所属期间。 */
export async function assertMachineCostSourceUnoccupied(tx: MachineFuelLedgerTx, cost: MachineFuelCost, nextOccurredAt = cost.occurredAt) {
  const periods = Array.from(new Set([chinaBusinessMonth(cost.occurredAt), chinaBusinessMonth(nextOccurredAt)]));
  const statements = await tx.select().from(machineMonthlyStatements).where(and(
    eq(machineMonthlyStatements.projectId, cost.projectId), eq(machineMonthlyStatements.machineId, cost.machineId),
    inArray(machineMonthlyStatements.period, periods), ne(machineMonthlyStatements.status, "void")
  )).for("update");
  const payments = await tx.select().from(machinePaymentSettlements).where(and(
    eq(machinePaymentSettlements.projectId, cost.projectId), eq(machinePaymentSettlements.machineId, cost.machineId),
    inArray(machinePaymentSettlements.period, periods), ne(machinePaymentSettlements.status, "void")
  )).for("update");
  if (statements.length || payments.length) throw new TRPCError({ code: "BAD_REQUEST", message: "费用来源已纳入机械月结或付款结算，不得修改或作废，请先核对原结算" });
}

/** 编辑排除唯一原镜像，五分钟防重仍是不可二次确认绕过的硬约束。 */
export async function assertNoDuplicateMachineFuelEdit(tx: MachineFuelLedgerTx, cost: MachineFuelCost, liters: number, refueledAt: Date, dieselId: number) {
  const nearby = await tx.select().from(dieselRefuelRecords).where(and(
    eq(dieselRefuelRecords.projectId, cost.projectId), eq(dieselRefuelRecords.assetType, "machine"),
    eq(dieselRefuelRecords.machineId, cost.machineId), ne(dieselRefuelRecords.id, dieselId), ne(dieselRefuelRecords.status, "void"),
    gte(dieselRefuelRecords.refueledAt, new Date(refueledAt.getTime() - 5 * 60_000)),
    lte(dieselRefuelRecords.refueledAt, new Date(refueledAt.getTime() + 5 * 60_000))
  )).for("update");
  if (nearby.some(row => row.supplyMethod === "project_supply" && Math.abs(Number(row.liters) - liters) <= 0.001))
    throw new TRPCError({ code: "CONFLICT", message: "检测到5分钟内同机械相同加油量，草稿修改未保存，请核对柴油台账" });
}

/** 旧新证据按 ID 顺序锁定；旧指针不解绑，替换审计永久保留引用。 */
export async function lockMachineCostEvidence(tx: MachineFuelLedgerTx, cost: Pick<MachineFuelCost, "id" | "projectId" | "machineId" | "evidenceId">, nextEvidenceId: number | null) {
  const ids = Array.from(new Set([cost.evidenceId, nextEvidenceId].filter((id): id is number => Boolean(id)))).sort((a, b) => a - b);
  if (!ids.length) return;
  const evidences = await lockActiveEvidenceForBinding(tx, { projectId: cost.projectId, evidenceIds: ids, allowedSourceTypes: ["other", "diesel_receipt"] });
  for (const evidence of evidences) {
    if (evidence.id === nextEvidenceId && evidence.id !== cost.evidenceId && evidence.sourceType !== "other")
      throw new TRPCError({ code: "BAD_REQUEST", message: "机械费用补证不能借用柴油专用凭证，请上传费用水印照片" });
    if (evidence.id === nextEvidenceId && evidence.id !== cost.evidenceId && evidence.sourceId && evidence.sourceId !== `machine-cost-${cost.id}`
      && !evidence.sourceId.startsWith(`machine-cost-pending-${cost.machineId}-`))
      throw new TRPCError({ code: "CONFLICT", message: "照片已绑定其他来源，不能改绑费用凭证" });
  }
}

export async function updateMachineFuelDraftMirror(tx: MachineFuelLedgerTx, cost: MachineFuelCost, dieselId: number, next: { quantity: string; unitPrice: string; amount: string; occurredAt: Date; evidenceId: number | null; remarks: string | null }, userId: number) {
  const [existing] = await tx.select().from(dieselRefuelRecords).where(eq(dieselRefuelRecords.id, dieselId)).limit(1).for("update");
  if (!existing || existing.status !== "draft" || existing.projectId !== cost.projectId || existing.machineId !== cost.machineId || existing.assetType !== "machine" || existing.supplyMethod !== "project_supply")
    throw new TRPCError({ code: "CONFLICT", message: "原柴油镜像非可编辑草稿或来源不一致，禁止覆盖" });
  if ((existing.evidenceId ?? null) !== (cost.evidenceId ?? null))
    throw new TRPCError({ code: "CONFLICT", message: "柴油镜像与原成本照片引用不同，请先核对原始凭证，禁止覆盖" });
  const values = { liters: next.quantity, appliedUnitPrice: next.unitPrice, amount: next.amount, refueledAt: next.occurredAt,
    evidenceId: next.evidenceId, remarks: next.remarks, updatedAt: new Date(Math.max(Math.floor(Date.now() / 1000) * 1000, new Date(existing.updatedAt ?? existing.createdAt).getTime() + 1000)) };
  assertMachineFuelWriteApplied(await tx.update(dieselRefuelRecords).set(values).where(and(
    eq(dieselRefuelRecords.id, dieselId), eq(dieselRefuelRecords.status, "draft")
  )), "柴油镜像草稿");
  await tx.insert(auditLogs).values({ userId, module: "diesel", action: "edit_machine_fuel_draft", targetType: "diesel_refuel", targetId: String(dieselId),
    summary: `机械费用 #${cost.id} 草稿修改同步柴油，未新增入账`, beforeJson: JSON.stringify(existing), afterJson: JSON.stringify({ ...existing, ...values }) });
}
