import { and, desc, eq, isNull } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { saveResourceBindingHistory } from "./personnelLegacyBridge";
import {
  assertContractNoOverlap,
  assertFleetDayWritable,
  fail,
  fleetAccess,
  maintenanceDue,
  requireFleetDb,
  safeDocument,
  safeVehicle,
  vehicleDependencies,
  vehicleProjectHistory,
  type FleetTx,
  type FleetReadDb,
} from "./vehicleManagementPolicy";

export type FleetBase = {
  vehicleId: number;
  projectId: number;
  version: number;
};
export async function findFleetVehicle(db: FleetReadDb, vehicleId: number) {
  const [vehicle] = await db
    .select()
    .from(s.transportVehicles)
    .where(eq(s.transportVehicles.id, vehicleId))
    .limit(1);
  if (!vehicle) fail("车辆不存在", "NOT_FOUND");
  return vehicle;
}
export function initialFleetProfile(
  vehicle: typeof s.transportVehicles.$inferSelect,
  actorId: number
): typeof s.vehicleFleetProfiles.$inferInsert {
  return {
    vehicleId: vehicle.id,
    projectId: vehicle.projectId,
    version: 0,
    propertyType:
      vehicle.ownership === "owned"
        ? "company_owned"
        : vehicle.ownership === "leased"
          ? "rented"
          : "partner",
    settlementMode:
      vehicle.ownership === "leased"
        ? "monthly"
        : vehicle.ownership === "trip_settlement"
          ? "trip"
          : "none",
    dispatchStatus: vehicle.status === "active" ? "standby" : "paused",
    createdBy: actorId,
    updatedBy: actorId,
  };
}
/** 项目锁先于车辆锁，所有新版写操作串行并检查profile CAS。 */
export async function mutateFleet<T extends Record<string, unknown>>(
  ctx: TrpcContext,
  input: FleetBase,
  action: string,
  work: (
    tx: FleetTx,
    vehicle: typeof s.transportVehicles.$inferSelect,
    profile: typeof s.vehicleFleetProfiles.$inferSelect,
    actorId: number
  ) => Promise<T>,
  occurredAt = new Date(),
  targetProjectId?: number
) {
  const { actor } = await fleetAccess(ctx, "edit", input.projectId);
  if (targetProjectId) await fleetAccess(ctx, "edit", targetProjectId);
  const db = await requireFleetDb();
  return db.transaction(async tx => {
    return mutateFleetTransaction(tx, input, action, actor.id, work, occurredAt, targetProjectId);
  });
}
/** Shared transaction core; callers retain their own authorization. Project lock precedes asset/profile CAS. */
export async function mutateFleetTransaction<T extends Record<string, unknown>>(
  tx: FleetTx, input: FleetBase, action: string, actorId: number,
  work: (tx: FleetTx, vehicle: typeof s.transportVehicles.$inferSelect, profile: typeof s.vehicleFleetProfiles.$inferSelect, actorId: number) => Promise<T>,
  occurredAt = new Date(), targetProjectId?: number
) {
    for (const projectId of Array.from(
      new Set([input.projectId, ...(targetProjectId ? [targetProjectId] : [])])
    ).sort((a, b) => a - b))
      await assertFleetDayWritable(tx, projectId, occurredAt);
    const [vehicle] = await tx
      .select()
      .from(s.transportVehicles)
      .where(eq(s.transportVehicles.id, input.vehicleId))
      .limit(1)
      .for("update");
    if (!vehicle || vehicle.projectId !== input.projectId)
      fail("车辆不存在或项目已变更，请刷新", "CONFLICT");
    let [profile] = await tx
      .select()
      .from(s.vehicleFleetProfiles)
      .where(eq(s.vehicleFleetProfiles.vehicleId, input.vehicleId))
      .limit(1)
      .for("update");
    if ((profile?.version ?? 0) !== input.version)
      fail("车辆版本冲突，请刷新后重试", "CONFLICT");
    if (!profile) {
      await tx
        .insert(s.vehicleFleetProfiles)
        .values(initialFleetProfile(vehicle, actorId));
      [profile] = await tx
        .select()
        .from(s.vehicleFleetProfiles)
        .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id))
        .limit(1);
    }
    if (!profile) fail("档案版本无法初始化", "CONFLICT");
    if (
      profile.archived &&
      !["grantAccess", "revokeAccess", "retire", "remove"].includes(action)
    )
      fail("车辆已归档，只保留受控账务与历史读取", "CONFLICT");
    const result = await work(tx, vehicle, profile, actorId);
    const version = input.version + 1;
    const [versionWrite] = await tx
      .update(s.vehicleFleetProfiles)
      .set({ version, updatedBy: actorId })
      .where(
        and(
          eq(s.vehicleFleetProfiles.vehicleId, vehicle.id),
          eq(s.vehicleFleetProfiles.version, input.version)
        )
      );
    if (versionWrite.affectedRows !== 1)
      fail("车辆版本已变化，本次修改未保存，请刷新后重试", "CONFLICT");
    await tx
      .insert(s.vehicleChanges)
      .values({
        vehicleId: vehicle.id,
        projectId: input.projectId,
        version,
        action,
        changes: result,
        createdBy: actorId,
      });
    await tx
      .insert(s.auditLogs)
      .values({
        userId: actorId,
        module: "transport",
        action: `vehicle_${action}`,
        targetType: "transport_vehicle",
        targetId: String(vehicle.id),
        summary: `车辆${vehicle.plateNo}全周期操作：${action}，版本${version}`,
      });
    return {
      success: true as const,
      vehicleId: vehicle.id,
      version,
      ...result,
    };
}

export async function listFleet(
  ctx: TrpcContext,
  input: {
    projectId?: number;
    search?: string;
    page: number;
    pageSize: number;
    all: boolean;
  }
) {
  const { scope } = await fleetAccess(
    ctx,
    input.all ? "export" : "read",
    input.projectId
  );
  const db = await requireFleetDb();
  const [vehicles, profiles] = await Promise.all([
    db
      .select()
      .from(s.transportVehicles)
      .orderBy(desc(s.transportVehicles.updatedAt)),
    db.select().from(s.vehicleFleetProfiles),
  ]);
  const items = vehicles
    .filter(
      v =>
        (!input.projectId || v.projectId === input.projectId) &&
        (scope.hasAllProjects || scope.projectIds.includes(v.projectId)) &&
        (!input.search ||
          `${v.plateNo} ${v.ownerName ?? ""} ${v.driverName ?? ""}`
            .toLowerCase()
            .includes(input.search.toLowerCase()))
    )
    .map(v => ({
      ...safeVehicle(v),
      profile: profiles.find(p => p.vehicleId === v.id) ?? null,
    }));
  const summary = {
    total: items.length,
    available: items.filter(
      v =>
        v.status === "active" &&
        (!v.profile ||
          (!v.profile.archived &&
            v.profile.technicalStatus === "normal" &&
            v.profile.dispatchStatus !== "paused" &&
            v.profile.projectStatus === "on_site"))
    ).length,
    repairing: items.filter(v => v.profile?.technicalStatus === "repair")
      .length,
    safetyHold: items.filter(v => v.profile?.technicalStatus === "safety_hold")
      .length,
    archived: items.filter(v => v.profile?.archived).length,
  };
  return {
    items: input.all
      ? items
      : items.slice(
          (input.page - 1) * input.pageSize,
          input.page * input.pageSize
        ),
    total: items.length,
    summary,
  };
}
export async function fleetExitChecks(
  db: FleetReadDb,
  vehicleId: number,
  projectId?: number
) {
  const [trips, maintenance, purchase, settlements, cards, workOrders, usage] =
    await Promise.all([
      db
        .select()
        .from(s.transportTrips)
        .where(eq(s.transportTrips.vehicleId, vehicleId)),
      db
        .select()
        .from(s.assetMaintenanceRecords)
        .where(
          and(
            eq(s.assetMaintenanceRecords.assetType, "vehicle"),
            eq(s.assetMaintenanceRecords.assetId, vehicleId)
          )
        ),
      db
        .select()
        .from(s.purchaseOrders)
        .where(
          and(
            eq(s.purchaseOrders.assetType, "vehicle"),
            eq(s.purchaseOrders.assetId, vehicleId)
          )
        ),
      db
        .select()
        .from(s.transportVehicleSettlements)
        .where(eq(s.transportVehicleSettlements.vehicleId, vehicleId)),
      db
        .select()
        .from(s.transportVehicleRfidCards)
        .where(eq(s.transportVehicleRfidCards.vehicleId, vehicleId)),
      db
        .select()
        .from(s.vehicleWorkOrders)
        .where(eq(s.vehicleWorkOrders.vehicleId, vehicleId)),
      db
        .select()
        .from(s.transportVehicleUsageRecords)
        .where(eq(s.transportVehicleUsageRecords.vehicleId, vehicleId)),
    ]);
  const scope = <T extends { projectId: number }>(rows: T[]) =>
    rows.filter(r => !projectId || r.projectId === projectId);
  return {
    openTrips: scope(trips).filter(r =>
      ["draft", "submitted", "verified"].includes(r.status)
    ).length,
    pendingMaintenance: scope(maintenance).filter(r => r.status === "draft")
      .length,
    pendingPurchases: scope(purchase).filter(r => r.status === "draft").length,
    unsettledStatements: scope(settlements).filter(
      r => !["paid", "void"].includes(r.status)
    ).length,
    activeCards: scope(cards).filter(r => r.status === "active").length,
    openWorkOrders: scope(workOrders).filter(r => r.status !== "released")
      .length,
    unsettledUsage: scope(usage).filter(
      r => r.status === "confirmed" && !r.settlementId
    ).length,
    settlementStatus: "see_financial_ledger" as const,
    note: "退场不代表结清；付款、抵扣和补款继续走原事实台账。监控设备关系请核对人工档案。",
  };
}
export async function detailFleet(
  ctx: TrpcContext,
  input: { vehicleId: number; projectId?: number }
) {
  const { scope } = await fleetAccess(ctx, "read", input.projectId);
  const db = await requireFleetDb();
  const vehicle = await findFleetVehicle(db, input.vehicleId);
  const historyIds = await vehicleProjectHistory(
    db,
    vehicle.id,
    vehicle.projectId
  );
  const allowedIds = historyIds.filter(
    id => scope.hasAllProjects || scope.projectIds.includes(id)
  );
  const requestedId = input.projectId ?? vehicle.projectId;
  if (!allowedIds.includes(requestedId))
    fail("该车辆项目历史不在当前授权范围", "FORBIDDEN");
  const read = <T extends { projectId: number }>(rows: T[]) =>
    rows.filter(
      r =>
        allowedIds.includes(r.projectId) &&
        (!input.projectId || r.projectId === input.projectId)
    );
  const [
    profile,
    assignments,
    grants,
    documents,
    inspections,
    workOrders,
    maintenancePlans,
    specialRecords,
    changes,
    contracts,
  ] = await Promise.all([
    db
      .select()
      .from(s.vehicleFleetProfiles)
      .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleAssignments)
      .where(eq(s.vehicleAssignments.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleAccessGrants)
      .where(eq(s.vehicleAccessGrants.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleDocuments)
      .where(eq(s.vehicleDocuments.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleInspections)
      .where(eq(s.vehicleInspections.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleWorkOrders)
      .where(eq(s.vehicleWorkOrders.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleMaintenancePlans)
      .where(eq(s.vehicleMaintenancePlans.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleSpecialRecords)
      .where(eq(s.vehicleSpecialRecords.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.vehicleChanges)
      .where(eq(s.vehicleChanges.vehicleId, vehicle.id)),
    db
      .select()
      .from(s.transportVehicleLeaseRules)
      .where(eq(s.transportVehicleLeaseRules.vehicleId, vehicle.id)),
  ]);
  const canCurrent = allowedIds.includes(vehicle.projectId);
  return {
    vehicle: canCurrent
      ? safeVehicle(vehicle)
      : {
          ...safeVehicle(vehicle),
          projectId: requestedId,
          driverPersonId: null,
          driverUserId: null,
          driverName: null,
          driverPhoneMasked: null,
        },
    profile: canCurrent ? (profile[0] ?? null) : null,
    version: profile[0]?.version ?? 0,
    contracts: read(contracts),
    assignments: read(assignments),
    grants: read(grants),
    documents: read(documents).map(safeDocument),
    inspections: read(inspections),
    workOrders: read(workOrders),
    maintenancePlans: read(maintenancePlans).map(p => ({
      ...p,
      ...maintenanceDue(p, chinaBusinessDate(new Date())),
    })),
    specialRecords: read(specialRecords),
    changes: read(changes),
    historyProjectIds: allowedIds,
    exitChecks: await fleetExitChecks(db, vehicle.id, requestedId),
  };
}
export async function closeFleetResponsibility(
  tx: FleetTx, vehicle: typeof s.transportVehicles.$inferSelect,
  profile: typeof s.vehicleFleetProfiles.$inferSelect, at: Date,
  action: "enter" | "transfer" | "exit" | "handover"
) {
  if (action === "enter" && profile.projectStatus === "on_site") fail("车辆已在场", "CONFLICT");
  if (["transfer", "exit", "handover"].includes(action) && profile.projectStatus !== "on_site") fail("仅在场车辆可调配、交接或退场", "CONFLICT");
  const checks = await fleetExitChecks(tx, vehicle.id, vehicle.projectId);
  if (["transfer", "exit", "handover"].includes(action) && checks.openTrips > 0) fail("车辆仍有在途票据，请先完成卸土或作废后再交接、调配或退场", "CONFLICT");
  const histories = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.vehicleId, vehicle.id)).for("update");
  if (histories.some(h => h.effectiveFrom > at)) fail("交接时间早于已有责任历史", "CONFLICT");
  return histories;
}
export async function endFleetResponsibility(tx: FleetTx, vehicleId: number, at: Date) {
  await tx.update(s.vehicleAssignments).set({ effectiveTo: at }).where(and(eq(s.vehicleAssignments.vehicleId, vehicleId), isNull(s.vehicleAssignments.effectiveTo)));
}

export async function assignFleet(
  ctx: TrpcContext,
  input: FleetBase & {
    action: "enter" | "transfer" | "exit" | "handover";
    targetProjectId?: number;
    driverPersonId?: number | null;
    driverUserId?: number | null;
    driverBindingId?: number | null;
    occurredAt: number;
    meterReading?: number | null;
    condition: string;
    reason: string;
  }
) {
  const now = new Date();
  const at = new Date(input.occurredAt);
  if (
    chinaBusinessDate(at) !== chinaBusinessDate(now) ||
    at.getTime() > now.getTime()
  )
    fail("进退场与交接仅支持今天已发生的即时登记，不回填过去或提前激活未来");
  if (
    input.action === "transfer" &&
    (!input.targetProjectId || input.targetProjectId === input.projectId)
  )
    fail("调配必须选择不同目标项目");
  if (input.action !== "transfer" && input.targetProjectId)
    fail("非调配操作不能改变项目");
  return mutateFleet(
    ctx,
    input,
    "assign",
    async (tx, vehicle, profile, actorId) => {
      const histories = await closeFleetResponsibility(tx, vehicle, profile, at, input.action);
      if (profile.trailerVehicleId && input.action === "transfer")
        fail("调配前请先解除挂车组合，分别调配并重新关联", "CONFLICT");
      const target = input.targetProjectId ?? input.projectId;
      const personId =
        input.action === "exit"
          ? null
          : input.driverPersonId === undefined
            ? target === input.projectId
              ? vehicle.driverPersonId
              : null
            : input.driverPersonId;
      const userId =
        input.action === "exit"
          ? null
          : input.driverUserId === undefined
            ? target === input.projectId
              ? vehicle.driverUserId
              : null
            : input.driverUserId;
      const identityChanged =
        personId !== vehicle.driverPersonId || userId !== vehicle.driverUserId;
      const activeBindings = await tx
        .select()
        .from(s.officialAccountDriverBindings)
        .where(
          and(
            eq(s.officialAccountDriverBindings.vehicleId, vehicle.id),
            eq(s.officialAccountDriverBindings.status, "active")
          )
        )
        .for("update");
      if (input.driverBindingId) {
        const chosen = activeBindings.find(
          b => b.id === input.driverBindingId && b.projectId === target
        );
        if (!chosen) fail("司机服务号绑定不属于该车辆目标项目");
        const [owner] = await tx
          .select({ userId: s.officialAccountBindings.userId })
          .from(s.officialAccountBindings)
          .where(
            and(
              eq(
                s.officialAccountBindings.openIdFingerprint,
                chosen.openIdFingerprint
              ),
              eq(s.officialAccountBindings.status, "active")
            )
          )
          .limit(1);
        if (!owner || !userId || owner.userId !== userId)
          fail(
            "服务号绑定与本次司机账号不一致，请先完成新司机本人绑定",
            "CONFLICT"
          );
      }
      if (!histories.length)
        await tx
          .insert(s.vehicleAssignments)
          .values({
            vehicleId: vehicle.id,
            projectId: vehicle.projectId,
            action: "baseline",
            driverPersonId: vehicle.driverPersonId,
            driverUserId: vehicle.driverUserId,
            driverBindingId: activeBindings[0]?.id ?? null,
            effectiveFrom: at,
            effectiveTo: at,
            condition: "原当前绑定历史基线，任职起点未知，不作为授权依据",
            reason: input.reason,
            createdBy: actorId,
          });
      await endFleetResponsibility(tx, vehicle.id, at);
      if (
        target !== input.projectId ||
        input.action === "exit" ||
        identityChanged
      ) {
        // 先关闭原项目人员关系，避免相同人员调拨时旧范围保持开放。
        await saveResourceBindingHistory(tx, {
          personId: null,
          assetType: "vehicle",
          assetId: vehicle.id,
          projectId: input.projectId,
          actorUserId: actorId,
          effectiveFrom: chinaBusinessDate(now),
          requestedUserId: null,
        });
        for (const binding of activeBindings.filter(
          b =>
            b.id !== input.driverBindingId ||
            input.action === "exit" ||
            target !== input.projectId
        ))
          await tx
            .update(s.officialAccountDriverBindings)
            .set({ status: "revoked" })
            .where(eq(s.officialAccountDriverBindings.id, binding.id));
      }
      if (target !== input.projectId)
        await tx
          .update(s.transportVehicles)
          .set({ projectId: target })
          .where(eq(s.transportVehicles.id, vehicle.id));
      if (personId || vehicle.driverPersonId || input.action === "exit")
        await saveResourceBindingHistory(tx, {
          personId,
          assetType: "vehicle",
          assetId: vehicle.id,
          projectId: target,
          actorUserId: actorId,
          effectiveFrom: chinaBusinessDate(now),
          requestedUserId: userId,
        });
      else if (userId) {
        const [user] = await tx
          .select({ id: s.users.id })
          .from(s.users)
          .where(eq(s.users.id, userId))
          .limit(1);
        if (!user) fail("司机账号不存在");
        await tx
          .update(s.transportVehicles)
          .set({ driverUserId: userId })
          .where(eq(s.transportVehicles.id, vehicle.id));
      }
      const checks = await fleetExitChecks(tx, vehicle.id, input.projectId);
      await tx
        .insert(s.vehicleAssignments)
        .values({
          vehicleId: vehicle.id,
          projectId: target,
          fromProjectId: vehicle.projectId,
          action: input.action,
          driverPersonId: personId,
          driverUserId: userId,
          driverBindingId:
            input.action === "exit"
              ? null
              : (input.driverBindingId ??
                (input.action === "transfer" || identityChanged
                  ? null
                  : (activeBindings[0]?.id ?? null))),
          effectiveFrom: at,
          effectiveTo: input.action === "exit" ? at : null,
          meterReading:
            input.meterReading == null ? null : String(input.meterReading),
          condition: input.condition,
          reason: input.reason,
          createdBy: actorId,
        });
      await tx
        .update(s.vehicleFleetProfiles)
        .set({
          projectId: target,
          projectStatus: input.action === "exit" ? "exited" : "on_site",
          dispatchStatus: "paused",
        })
        .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
      return {
        action: input.action,
        targetProjectId: target,
        reason: input.reason,
        exitChecks: checks,
      };
    },
    at,
    input.targetProjectId
  );
}
export async function saveFleetContract(
  ctx: TrpcContext,
  input: FleetBase & {
    billingType: "monthly" | "daily" | "hourly" | "shift";
    rate: number;
    effectiveFrom: string;
    effectiveTo?: string;
    supersedesContractId?: number;
    reason: string;
  }
) {
  if (input.effectiveFrom < chinaBusinessDate(new Date()))
    fail("不能回溯新增租赁版本覆盖历史，请走原受控更正流程");
  return mutateFleet(
    ctx,
    input,
    "saveContract",
    async (tx, vehicle) => {
      const [profile] = await tx
        .select()
        .from(s.vehicleFleetProfiles)
        .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id))
        .limit(1);
      if (profile?.propertyType !== "rented" && vehicle.ownership !== "leased")
        fail("租赁合同仅适用于已明确租入分类的车辆");
      const rows = await tx
        .select()
        .from(s.transportVehicleLeaseRules)
        .where(
          and(
            eq(s.transportVehicleLeaseRules.vehicleId, vehicle.id),
            eq(s.transportVehicleLeaseRules.projectId, input.projectId)
          )
        )
        .for("update");
      if (input.supersedesContractId) {
        const old = rows.find(
          r => r.id === input.supersedesContractId && r.status === "active"
        );
        if (
          !old ||
          old.effectiveFrom.toISOString().slice(0, 10) >= input.effectiveFrom
        )
          fail("请选择开始日期早于新版本的同项目有效旧合同", "CONFLICT");
        const previousDay = new Date(`${input.effectiveFrom}T00:00:00Z`);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        const futureSettlements = await tx
          .select()
          .from(s.transportVehicleSettlements)
          .where(eq(s.transportVehicleSettlements.vehicleId, vehicle.id))
          .for("update");
        if (
          futureSettlements.some(
            r =>
              r.projectId === input.projectId &&
              r.settlementKind === "lease" &&
              r.status !== "void" &&
              r.periodEnd >= new Date(`${input.effectiveFrom}T00:00:00Z`)
          )
        )
          fail(
            "新生效期间已有租赁结算，不能截断旧合同，请先处理原结算",
            "CONFLICT"
          );
        if (old.effectiveTo === null || old.effectiveTo > previousDay) {
          await tx
            .update(s.transportVehicleLeaseRules)
            .set({ effectiveTo: previousDay })
            .where(eq(s.transportVehicleLeaseRules.id, old.id));
          old.effectiveTo = previousDay;
        }
      }
      assertContractNoOverlap(rows, input.effectiveFrom, input.effectiveTo);
      const [result] = await tx
        .insert(s.transportVehicleLeaseRules)
        .values({
          vehicleId: vehicle.id,
          projectId: input.projectId,
          billingType: input.billingType,
          rate: String(input.rate),
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`),
          effectiveTo: input.effectiveTo
            ? new Date(`${input.effectiveTo}T00:00:00Z`)
            : null,
          status: "active",
        });
      return { contractId: Number(result.insertId), reason: input.reason };
    },
    new Date(`${input.effectiveFrom}T00:00:00Z`)
  );
}
export async function grantFleetAccess(
  ctx: TrpcContext,
  input: FleetBase & {
    userId?: number;
    driverBindingId?: number;
    role: "owner" | "driver";
    scope: "service_period" | "all_history";
    effectiveFrom: number;
    effectiveTo?: number;
    validTo?: number;
    reason: string;
  }
) {
  await fleetAccess(ctx, "manage", input.projectId);
  if (Boolean(input.userId) === Boolean(input.driverBindingId))
    fail("必须且只能选择一个真实账号或司机绑定ID");
  if (
    input.effectiveTo !== undefined &&
    input.effectiveTo <= input.effectiveFrom
  )
    fail("业务授权区间结束必须晚于开始");
  if (input.validTo !== undefined && input.validTo <= Date.now())
    fail("授权有效期必须晚于当前时间");
  return mutateFleet(
    ctx,
    input,
    "grantAccess",
    async (tx, vehicle, _profile, actorId) => {
      if (input.userId) {
        const [user] = await tx
          .select({ id: s.users.id })
          .from(s.users)
          .where(eq(s.users.id, input.userId))
          .limit(1);
        if (!user) fail("被授权账号不存在");
      }
      if (input.driverBindingId) {
        const [binding] = await tx
          .select()
          .from(s.officialAccountDriverBindings)
          .where(eq(s.officialAccountDriverBindings.id, input.driverBindingId))
          .limit(1);
        if (
          !binding ||
          binding.vehicleId !== vehicle.id ||
          binding.projectId !== input.projectId
        )
          fail("司机绑定不属于该车辆项目");
      }
      if (input.scope === "service_period" && !input.effectiveTo)
        fail("本人服务期间授权必须明确起止，不能无限开放前任或后任业务");
      const [result] = await tx
        .insert(s.vehicleAccessGrants)
        .values({
          vehicleId: vehicle.id,
          projectId: input.projectId,
          userId: input.userId,
          driverBindingId: input.driverBindingId,
          role: input.role,
          scope: input.scope,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          validFrom: new Date(),
          validTo: input.validTo ? new Date(input.validTo) : null,
          reason: input.reason,
          createdBy: actorId,
        });
      return { grantId: Number(result.insertId), reason: input.reason };
    }
  );
}
export async function retireFleet(
  ctx: TrpcContext,
  input: FleetBase & { reason: string },
  remove = false
) {
  return mutateFleet(
    ctx,
    input,
    remove ? "remove" : "retire",
    async (tx, vehicle) => {
      const checks = await fleetExitChecks(tx, vehicle.id);
      if (checks.openTrips)
        fail("车辆仍有在途票据，请完成卸土或作废后归档", "CONFLICT");
      const dependencies = await vehicleDependencies(tx, vehicle.id);
      // 安全默认：创建profile/档案历史后不能物理删除，所有新版remove均归档；旧admin无历史才删除。
      await tx
        .update(s.vehicleFleetProfiles)
        .set({
          archived: true,
          projectStatus: "exited",
          dispatchStatus: "paused",
        })
        .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
      await tx
        .update(s.transportVehicles)
        .set({ status: "disabled" })
        .where(eq(s.transportVehicles.id, vehicle.id));
      return {
        operation: "archived" as const,
        dependencies,
        reason: input.reason,
      };
    }
  );
}
