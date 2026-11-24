import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  auditLogs,
  dieselRefuelRecords,
  machineCostRecords,
  machineMonthlyStatements,
  machinePaymentSettlements,
  projects,
  transportTrips,
  transportVehicles,
  transportVehicleSettlements,
} from "../../drizzle/schema";
import {
  assertMachineFuelWriteApplied,
  lockMachineFuelLedger,
  type MachineFuelLedgerDb,
  type MachineFuelLedgerTx,
} from "./machineFuelLedger";
import { chinaBusinessMonth } from "./chinaBusinessTime";

type Refuel = typeof dieselRefuelRecords.$inferSelect;
type Cost = typeof machineCostRecords.$inferSelect;
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "柴油记录或关联成本已变化，未覆盖写入，请刷新后重试",
  });

/** 原 schema 的 timestamp 精度为秒；显式推进版本，避免同秒编辑使旧版本继续命中。 */
export function nextDieselUpdatedAt(existing: Refuel) {
  return new Date(
    Math.max(
      Math.floor(Date.now() / 1000) * 1000,
      new Date(existing.updatedAt).getTime() + 1000
    )
  );
}

export function dieselCorrectionWhere(existing: Refuel) {
  return and(
    eq(dieselRefuelRecords.id, existing.id),
    eq(dieselRefuelRecords.projectId, existing.projectId),
    eq(dieselRefuelRecords.status, existing.status),
    eq(dieselRefuelRecords.updatedAt, existing.updatedAt)
  );
}

export function dieselCostCorrectionWhere(cost: Cost, recordId: number) {
  return and(
    eq(machineCostRecords.id, cost.id),
    eq(machineCostRecords.projectId, cost.projectId),
    eq(machineCostRecords.machineId, cost.machineId),
    eq(machineCostRecords.costType, "fuel"),
    eq(machineCostRecords.dieselRefuelRecordId, recordId),
    eq(machineCostRecords.status, cost.status)
  );
}

/**
 * 无锁 hint 仅定位原资源；当前读重新校验。固定锁序：项目 -> 原机器 ledger
 * -> 关联成本 -> 柴油；车辆与结算相同：项目 -> 车辆 -> 原趟次 -> 成本 -> 柴油。
 * 项目锁同时串行化机械付款结算/车辆结算来源占用，不做有效项目或资源状态校验。
 */
export async function lockDieselRecordForCorrection(
  tx: MachineFuelLedgerTx,
  input: { id: number; projectId: number; expectedUpdatedAt?: string },
  operation: "edit" | "delete"
) {
  const [hint] = await tx
    .select()
    .from(dieselRefuelRecords)
    .where(eq(dieselRefuelRecords.id, input.id))
    .limit(1);
  if (!hint || hint.id !== input.id || hint.projectId !== input.projectId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "柴油记录不存在或不属于当前项目",
    });
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, hint.projectId))
    .for("update");
  if (hint.assetType === "machine") {
    if (!hint.machineId) throw conflict();
    await lockMachineFuelLedger(tx, {
      machineId: hint.machineId,
      projectId: hint.projectId,
    });
  } else if (hint.vehicleId) {
    await tx
      .select({ id: transportVehicles.id })
      .from(transportVehicles)
      .where(
        and(
          eq(transportVehicles.id, hint.vehicleId),
          eq(transportVehicles.projectId, hint.projectId)
        )
      )
      .for("update");
  }
  const [trip] = hint.transportTripId
    ? await tx
        .select()
        .from(transportTrips)
        .where(eq(transportTrips.id, hint.transportTripId))
        .limit(1)
        .for("update")
    : [];
  const costs = await tx
    .select()
    .from(machineCostRecords)
    .where(eq(machineCostRecords.dieselRefuelRecordId, hint.id))
    .for("update");
  const [existing] = await tx
    .select()
    .from(dieselRefuelRecords)
    .where(eq(dieselRefuelRecords.id, input.id))
    .limit(1)
    .for("update");
  if (
    !existing ||
    existing.id !== hint.id ||
    existing.projectId !== hint.projectId ||
    existing.assetType !== hint.assetType ||
    existing.machineId !== hint.machineId ||
    existing.vehicleId !== hint.vehicleId ||
    existing.transportTripId !== hint.transportTripId
  )
    throw conflict();
  if (existing.machineCostSourceId != null || existing.recordNo.startsWith("DS-MC-"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "该柴油记录由机械成本同步；请前往机械管理原成本记录办理修改或作废",
    });
  if (existing.status === "void") {
    if (operation === "delete")
      return { existing, existingCost: costs[0], alreadyVoid: true };
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "已作废柴油记录不得修改或恢复",
    });
  }
  if (
    input.expectedUpdatedAt &&
    new Date(existing.updatedAt).getTime() !==
      new Date(input.expectedUpdatedAt).getTime()
  )
    throw conflict();
  if (existing.status === "settled")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "已结算柴油记录不得修改或作废",
    });
  if (costs.length > 1) throw conflict();
  const existingCost = costs[0];
  if (
    existingCost &&
    (existingCost.dieselRefuelRecordId !== existing.id ||
      existingCost.projectId !== existing.projectId ||
      existing.assetType !== "machine" ||
      existingCost.machineId !== existing.machineId ||
      existingCost.costType !== "fuel")
  )
    throw conflict();
  if (existingCost?.status === "settled")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "关联机械成本已结算，请前往机械管理核对原结算",
    });
  if (existingCost?.status === "void") throw conflict();
  if (
    hint.transportTripId &&
    (!trip ||
      trip.id !== hint.transportTripId ||
      trip.projectId !== existing.projectId ||
      trip.vehicleId !== existing.vehicleId)
  )
    throw conflict();
  if (trip?.status === "settled")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "关联运输趟次已结算，不得修改或作废柴油记录",
    });

  if (existing.assetType === "machine" && existing.machineId) {
    const periods = Array.from(
      new Set([
        chinaBusinessMonth(existing.refueledAt),
        ...(existingCost ? [chinaBusinessMonth(existingCost.occurredAt)] : []),
      ])
    );
    const statements = await tx
      .select()
      .from(machineMonthlyStatements)
      .where(
        and(
          eq(machineMonthlyStatements.projectId, existing.projectId),
          eq(machineMonthlyStatements.machineId, existing.machineId),
          inArray(machineMonthlyStatements.period, periods),
          eq(machineMonthlyStatements.status, "settled")
        )
      )
      .for("update");
    const payments = await tx
      .select()
      .from(machinePaymentSettlements)
      .where(
        and(
          eq(machinePaymentSettlements.projectId, existing.projectId),
          eq(machinePaymentSettlements.machineId, existing.machineId),
          inArray(machinePaymentSettlements.period, periods),
          ne(machinePaymentSettlements.status, "void")
        )
      )
      .for("update");
    if (statements.length || payments.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "机械油料已纳入机械月结或付款结算，请前往机械管理核对原结算",
      });
  }
  if (existing.assetType === "vehicle" && existing.vehicleId) {
    const settlements = await tx
      .select()
      .from(transportVehicleSettlements)
      .where(
        and(
          eq(transportVehicleSettlements.projectId, existing.projectId),
          eq(transportVehicleSettlements.vehicleId, existing.vehicleId),
          ne(transportVehicleSettlements.status, "void")
        )
      )
      .for("update");
    if (settlements.length) {
      const sources = await tx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.module, "transport"),
            eq(auditLogs.action, "vehicle_settlement_basis_v1"),
            eq(auditLogs.targetType, "transport_vehicle_settlement"),
            inArray(
              auditLogs.targetId,
              settlements.map(row => row.settlementNo)
            )
          )
        )
        .for("update");
      for (const source of sources) {
        let basis: { fuelIds?: number[]; fuelSources?: Array<{ id: number }> };
        try {
          basis = JSON.parse(source.beforeJson || "{}");
        } catch {
          throw conflict();
        }
        if (!basis || !Array.isArray(basis.fuelIds)) throw conflict();
        if (
          basis.fuelSources !== undefined &&
          !Array.isArray(basis.fuelSources)
        )
          throw conflict();
        if (
          basis.fuelIds.includes(existing.id) ||
          basis.fuelSources?.some(row => row.id === existing.id)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "柴油来源已被有效车辆结算绑定，请前往运输管理核对原结算",
          });
      }
    }
  }
  return { existing, existingCost, alreadyVoid: false };
}

/** 受控删除只更新状态，完整保留价格、金额、证据及原登记/审核字段。 */
export async function deleteDieselRefuelRecord(
  db: MachineFuelLedgerDb,
  input: { id: number; projectId: number; expectedUpdatedAt: string },
  userId: number
) {
  return db.transaction(async tx => {
    const { existing, existingCost, alreadyVoid } =
      await lockDieselRecordForCorrection(tx, input, "delete");
    if (alreadyVoid)
      return {
        success: true as const,
        id: existing.id,
        status: "void" as const,
        alreadyVoid: true,
      };
    const values = {
      status: "void" as const,
      updatedAt: nextDieselUpdatedAt(existing),
    };
    assertMachineFuelWriteApplied(
      await tx
        .update(dieselRefuelRecords)
        .set(values)
        .where(dieselCorrectionWhere(existing)),
      "柴油记录"
    );
    if (existingCost) {
      assertMachineFuelWriteApplied(
        await tx
          .update(machineCostRecords)
          .set({ status: "void" })
          .where(dieselCostCorrectionWhere(existingCost, existing.id)),
        "关联机械油料成本"
      );
      await tx.insert(auditLogs).values({
        userId,
        module: "machinery",
        action: "void_diesel_cost",
        targetType: "machine_cost",
        targetId: String(existingCost.id),
        summary: `柴油台账 #${existing.id} 受控删除，同步作废机械油料成本，保留原金额和凭证`,
        beforeJson: JSON.stringify(existingCost),
        afterJson: JSON.stringify({ ...existingCost, status: "void" }),
      });
    }
    await tx.insert(auditLogs).values({
      userId,
      module: "diesel",
      action: "delete_refuel",
      targetType: "diesel_refuel",
      targetId: String(existing.id),
      summary:
        "录入纠错删除柴油记录（状态作废，非物理删除），后台保留原账及操作留痕",
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify({ ...existing, ...values }),
    });
    return {
      success: true as const,
      id: existing.id,
      status: "void" as const,
      alreadyVoid: false,
    };
  });
}
