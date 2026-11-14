import { TRPCError } from "@trpc/server";
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import {
  auditLogs,
  dieselRefuelRecords,
  machineCostRecords,
  machines,
} from "../../drizzle/schema";
import type { getDb } from "../db";

export type MachineFuelLedgerDb = NonNullable<
  Awaited<ReturnType<typeof getDb>>
>;
export type MachineFuelLedgerTx = Parameters<
  Parameters<MachineFuelLedgerDb["transaction"]>[0]
>[0];
export type MachineFuelCost = typeof machineCostRecords.$inferSelect;
export const MACHINE_FUEL_RECORD_PREFIX = "DS-MC-";
const DUPLICATE_WINDOW_MS = 5 * 60_000;
const LITERS_TOLERANCE = 0.001;

/** 无 schema 迁移的来源契约。唯一单号只由原成本 ID 派生，回填/重试不得生成新单号。 */
export function machineFuelRecordNo(costId: number) {
  if (!Number.isSafeInteger(costId) || costId <= 0)
    throw new Error("机械成本编号无效");
  return `${MACHINE_FUEL_RECORD_PREFIX}${costId}`;
}

export function isMachineFuelRecordNo(recordNo: string) {
  return recordNo.startsWith(MACHINE_FUEL_RECORD_PREFIX);
}

export function dieselRecordSourceLabel(recordNo: string) {
  return isMachineFuelRecordNo(recordNo) ? "机械录入" : "柴油登记";
}

/**
 * 所有机械柴油写入入口共用机器行锁（包括后台/移动柴油登记与直接 MySQL 回填）。
 * 固定顺序：machines(id, projectId) FOR UPDATE -> machine_cost_records -> diesel_refuel_records。
 * 不得在持有柴油/成本锁后再请求机械锁；外层事务持锁直至关联、状态 CAS、审计一起提交。
 * 先前无锁读只能定位 machineId，拿锁后必须重新读取并校验事实。
 */
export async function lockMachineFuelLedger(
  tx: MachineFuelLedgerTx,
  input: { machineId: number; projectId: number }
) {
  const [machine] = await tx
    .select()
    .from(machines)
    .where(
      and(
        eq(machines.id, input.machineId),
        eq(machines.projectId, input.projectId)
      )
    )
    .limit(1)
    .for("update");
  if (!machine || machine.projectId !== input.projectId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到指定项目下的机械台账",
    });
  }
  return machine;
}

/** 新机械 fuel 与柴油登记使用同一五分钟重复检测；锁定读避免等待机器锁后的旧快照漏读。 */
export async function assertNoDuplicateMachineFuel(
  tx: MachineFuelLedgerTx,
  input: {
    projectId: number;
    machineId: number;
    liters: number;
    refueledAt: Date;
  }
) {
  const nearby = await tx
    .select()
    .from(dieselRefuelRecords)
    .where(
      and(
        eq(dieselRefuelRecords.projectId, input.projectId),
        eq(dieselRefuelRecords.assetType, "machine"),
        eq(dieselRefuelRecords.machineId, input.machineId),
        ne(dieselRefuelRecords.status, "void"),
        gte(
          dieselRefuelRecords.refueledAt,
          new Date(input.refueledAt.getTime() - DUPLICATE_WINDOW_MS)
        ),
        lte(
          dieselRefuelRecords.refueledAt,
          new Date(input.refueledAt.getTime() + DUPLICATE_WINDOW_MS)
        )
      )
    )
    .for("update");
  const duplicate = nearby.find(
    row =>
      row.supplyMethod === "project_supply" &&
      Math.abs(Number(row.liters) - input.liters) <= LITERS_TOLERANCE
  );
  if (duplicate)
    throw new TRPCError({
      code: "CONFLICT",
      message: `检测到 5 分钟内同一机械相同加油量的记录（${duplicate.recordNo}），为避免重复入账，本次未保存`,
    });
}

/**
 * 历史回填契约：quantity/unitPrice/amount/status/occurredAt/createdAt 都按成本原值复制，
 * 不重新套用今日指导价、不改变原成本金额/状态/时间，不新增第二笔成本。
 * createdBy 必须为真实登记人（新录入传当前用户；旧账只用 create_cost 审计证据）。
 * 项目有效指导价产生的原机械 fuel 必为 project_supply；无现金站、票号、表数或照片证据不补造。
 * 历史 approved/settled 不猜 approvedBy/approvedAt；新审核通过机械 transitionCost 真实记录审核人。
 * 直接 MySQL 回填使用本契约的 DS-MC-{id} 唯一单号，只补成本 dieselRefuelRecordId，幂等校验后提交。
 */
export function buildMachineFuelRefuelValues(
  cost: MachineFuelCost,
  createdBy: number
): typeof dieselRefuelRecords.$inferInsert {
  if (
    cost.costType !== "fuel" ||
    !Number.isSafeInteger(createdBy) ||
    createdBy <= 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "机械柴油来源或真实登记人无法确认",
    });
  }
  return {
    recordNo: machineFuelRecordNo(cost.id),
    projectId: cost.projectId,
    assetType: "machine",
    vehicleId: null,
    machineId: cost.machineId,
    transportTripId: null,
    supplyMethod: "project_supply",
    stationOrSupplierName: null,
    liters: cost.quantity,
    actualUnitPrice: null,
    appliedUnitPrice: cost.unitPrice,
    amount: cost.amount,
    deductFromFreight: false,
    refueledAt: cost.occurredAt,
    meterReading: null,
    receiptNo: null,
    evidenceId: cost.evidenceId ?? null,
    remarks: cost.remarks ?? null,
    status: cost.status,
    createdBy,
    approvedBy: null,
    approvedAt: null,
    createdAt: cost.createdAt,
  };
}

export function assertMachineFuelWriteApplied(result: unknown, label: string) {
  const header = Array.isArray(result) ? result[0] : result;
  if (
    !header ||
    typeof header !== "object" ||
    !("affectedRows" in header) ||
    Number((header as { affectedRows: unknown }).affectedRows) !== 1
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${label}已被其他用户更新，请刷新后重试`,
    });
  }
}

function assertLinkedSnapshot(
  cost: MachineFuelCost,
  record: typeof dieselRefuelRecords.$inferSelect
) {
  if (
    record.projectId !== cost.projectId ||
    record.assetType !== "machine" ||
    record.machineId !== cost.machineId ||
    record.status !== cost.status ||
    Number(record.liters) !== Number(cost.quantity) ||
    Number(record.appliedUnitPrice) !== Number(cost.unitPrice) ||
    Number(record.amount) !== Number(cost.amount) ||
    new Date(record.refueledAt).getTime() !==
      new Date(cost.occurredAt).getTime() ||
    (isMachineFuelRecordNo(record.recordNo) &&
      (record.recordNo !== machineFuelRecordNo(cost.id) ||
        record.supplyMethod !== "project_supply"))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "机械成本与柴油记录不一致，请先核对双账，禁止覆盖历史事实",
    });
  }
}

/** 调用方已持有机械和原成本锁；本函数只新增/确认柴油记录并关联原成本，绝不 insert 成本。 */
export async function ensureMachineFuelRefuelRecord(
  tx: MachineFuelLedgerTx,
  cost: MachineFuelCost,
  createdBy?: number
) {
  if (cost.costType !== "fuel") return null;
  const [existing] = await tx
    .select()
    .from(dieselRefuelRecords)
    .where(
      cost.dieselRefuelRecordId
        ? eq(dieselRefuelRecords.id, cost.dieselRefuelRecordId)
        : eq(dieselRefuelRecords.recordNo, machineFuelRecordNo(cost.id))
    )
    .limit(1)
    .for("update");
  if (cost.dieselRefuelRecordId && !existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "机械柴油关联记录不存在，请先核对双账",
    });
  }
  if (existing) assertLinkedSnapshot(cost, existing);
  let refuelId = existing?.id ?? 0;
  if (!existing) {
    if (createdBy === undefined) {
      const evidence = await tx
        .select({ userId: auditLogs.userId })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.module, "machinery"),
            eq(auditLogs.action, "create_cost"),
            eq(auditLogs.targetType, "machine_cost"),
            eq(auditLogs.targetId, String(cost.id))
          )
        );
      const creators = Array.from(new Set(evidence.map(row => row.userId)));
      if (creators.length !== 1 || !creators[0])
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "历史机械柴油缺少唯一真实登记人审计证据，请先完成柴油回填核对",
        });
      createdBy = creators[0];
    }
    const result = await tx
      .insert(dieselRefuelRecords)
      .values(buildMachineFuelRefuelValues(cost, createdBy!));
    refuelId = Number(
      (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
    );
    if (!Number.isSafeInteger(refuelId) || refuelId <= 0)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "柴油记录保存后无法确认编号",
      });
  }
  if (!cost.dieselRefuelRecordId) {
    const linked = await tx
      .update(machineCostRecords)
      .set({ dieselRefuelRecordId: refuelId })
      .where(
        and(
          eq(machineCostRecords.id, cost.id),
          eq(machineCostRecords.projectId, cost.projectId),
          eq(machineCostRecords.machineId, cost.machineId),
          eq(machineCostRecords.status, cost.status),
          isNull(machineCostRecords.dieselRefuelRecordId)
        )
      );
    assertMachineFuelWriteApplied(linked, "机械柴油关联");
  }
  return { id: refuelId, status: cost.status };
}

/** 状态 CAS 与外层成本 CAS、审计处在同一事务；审核人只在真实 draft -> approved 时落账。 */
export async function transitionMachineFuelRefuelRecord(
  tx: MachineFuelLedgerTx,
  record: { id: number; status: MachineFuelCost["status"] },
  nextStatus: "approved" | "settled" | "void",
  userId: number
) {
  const result = await tx
    .update(dieselRefuelRecords)
    .set({
      status: nextStatus,
      ...(nextStatus === "approved"
        ? { approvedBy: userId, approvedAt: new Date() }
        : {}),
    })
    .where(
      and(
        eq(dieselRefuelRecords.id, record.id),
        eq(dieselRefuelRecords.status, record.status)
      )
    );
  assertMachineFuelWriteApplied(result, "柴油记录状态");
}
