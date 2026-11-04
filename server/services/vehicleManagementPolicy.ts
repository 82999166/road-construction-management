import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../drizzle/schema";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { getDb } from "../db";
import {
  assertDepartmentBusinessAccess,
  getDepartmentModuleDataScope,
  getEffectiveRoleCodes,
  getSuperAdminAccess,
  requireAuthenticatedUser,
  type BusinessOperationAction,
} from "../access";
import type { TrpcContext } from "../_core/context";

export type FleetDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type FleetTx = Parameters<Parameters<FleetDb["transaction"]>[0]>[0];
export type FleetReadDb = Pick<
  FleetDb,
  "select" | "insert" | "update" | "delete"
>;
export const id = z.number().int().positive();
export const text = z.string().trim().min(1).max(1000);
export const mileage = z
  .number()
  .finite()
  .min(0)
  .max(999999999999.99)
  .nullable()
  .optional();
export const businessDay = z.string().date();
export const timestampInput = z.number().int().min(0).max(8640000000000000);
export const mutationBase = z.object({
  vehicleId: id,
  projectId: id,
  version: z.number().int().min(0),
});
export function fail(
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" = "BAD_REQUEST"
): never {
  throw new TRPCError({ code, message });
}
export async function requireFleetDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  return db;
}
/** 司机/车主身份没有任何隐式运输办理权；只读账单走独立授权投影。 */
export async function fleetAccess(
  ctx: TrpcContext,
  action: BusinessOperationAction,
  projectId?: number
) {
  const actor = requireAuthenticatedUser(ctx);
  const superAdmin = (await getSuperAdminAccess(ctx)).canAccess;
  if (!superAdmin) {
    if (actor.loginMethod === "local_driver")
      fail("司机手机号账号仅可读取专属车辆账单", "FORBIDDEN");
    const roles = await getEffectiveRoleCodes(ctx);
    if (
      roles.length > 0 &&
      roles.every(role => ["DRIVER", "VEHICLE_OWNER"].includes(role))
    )
      fail("司机或车主身份不能办理车辆管理", "FORBIDDEN");
  }
  await assertDepartmentBusinessAccess(ctx, "TRANSPORT", action);
  const scope = await getDepartmentModuleDataScope(ctx, "TRANSPORT");
  if (
    projectId &&
    !scope.hasAllProjects &&
    !scope.projectIds.includes(projectId)
  )
    fail("车辆项目不在当前运输授权范围", "FORBIDDEN");
  return { actor, scope };
}
/** 与财务日结使用相同项目互斥锁，避免封账与车辆事实补录并发穿透。 */
export async function assertFleetDayWritable(
  db: FleetReadDb,
  projectId: number,
  occurredAt = new Date()
) {
  const [project] = await db
    .select()
    .from(s.projects)
    .where(eq(s.projects.id, projectId))
    .limit(1)
    .for("update");
  if (!project || project.status === "archived") fail("所选项目不存在或已归档");
  const closingDate = new Date(`${chinaBusinessDate(occurredAt)}T00:00:00Z`);
  const closures = await db
    .select()
    .from(s.dailyAccountingClosures)
    .where(
      and(
        eq(s.dailyAccountingClosures.projectId, projectId),
        eq(s.dailyAccountingClosures.closingDate, closingDate)
      )
    )
    .for("update");
  if (closures.some(row => ["closed", "archived"].includes(row.status)))
    fail("业务日期已封账，请由财务负责人授权反结账后操作", "CONFLICT");
}
export function safeVehicle(v: typeof s.transportVehicles.$inferSelect) {
  return {
    id: v.id,
    projectId: v.projectId,
    organizationId: v.organizationId,
    plateNo: v.plateNo,
    vehicleType: v.vehicleType,
    ownership: v.ownership,
    ownerName: v.ownerName,
    driverPersonId: v.driverPersonId,
    driverUserId: v.driverUserId,
    driverName: v.driverName,
    driverPhoneMasked: v.driverPhoneMasked,
    boxLengthMeters: v.boxLengthMeters,
    boxWidthMeters: v.boxWidthMeters,
    boxHeightMeters: v.boxHeightMeters,
    loadFactor: v.loadFactor,
    payloadTons: v.payloadTons,
    fuelTankCapacityLiters: v.fuelTankCapacityLiters,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
export function safeDocument(d: typeof s.vehicleDocuments.$inferSelect) {
  return {
    id: d.id,
    documentId: d.id,
    vehicleId: d.vehicleId,
    projectId: d.projectId,
    kind: d.kind,
    title: d.title,
    applicable: d.applicable,
    validFrom: d.validFrom,
    validTo: d.validTo,
    verificationStatus: d.verificationStatus,
    verifiedBy: d.verifiedBy,
    verifiedAt: d.verifiedAt,
    verificationNote: d.verificationNote,
    originalName: d.originalName,
    mimeType: d.mimeType,
    contentBytes: d.contentBytes,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
  };
}
export function maintenanceDue(
  plan: {
    dueOn: string | null;
    dueMileage: string | number | null;
    lastMileage: string | number | null;
    completedAt: Date | null;
  },
  today: string
) {
  return {
    dateStatus: plan.completedAt
      ? "completed"
      : !plan.dueOn
        ? "not_configured"
        : plan.dueOn <= today
          ? "due"
          : "not_due",
    mileageStatus: plan.completedAt
      ? "completed"
      : plan.dueMileage === null
        ? "not_configured"
        : plan.lastMileage === null
          ? "unknown"
          : Number(plan.lastMileage) >= Number(plan.dueMileage)
            ? "due"
            : "not_due",
  };
}
export function workOrderTransition(
  status: typeof s.vehicleWorkOrders.$inferSelect.status,
  action: "start" | "submit_acceptance" | "reject" | "accept" | "release"
) {
  const transitions = {
    start: ["reported", "repairing"],
    submit_acceptance: ["repairing", "awaiting_acceptance"],
    reject: ["awaiting_acceptance", "repairing"],
    accept: ["awaiting_acceptance", "accepted"],
    release: ["accepted", "released"],
  } as const;
  const [from, to] = transitions[action];
  if (status !== from)
    fail("工单状态已变化或不能跳过修复、验收、放行步骤", "CONFLICT");
  return to;
}
export function assertContractNoOverlap(
  rows: {
    effectiveFrom: Date | string;
    effectiveTo: Date | string | null;
    status: string;
  }[],
  from: string,
  to?: string
) {
  const day = (value: Date | string) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  if (to && to < from) fail("合同结束日期不能早于生效日期");
  if (
    rows.some(
      row =>
        row.status === "active" &&
        day(row.effectiveFrom) <= (to ?? "9999-12-31") &&
        (row.effectiveTo ? day(row.effectiveTo) : "9999-12-31") >= from
    )
  )
    fail(
      "新合同与已有生效区间重叠；历史合同不能覆盖，请先按原合同范围核实",
      "CONFLICT"
    );
}
export function assertMaintenanceImmutable(
  existing: typeof s.assetMaintenanceRecords.$inferSelect,
  next: {
    assetType: string;
    assetId: number;
    projectId: number;
    costCategory: string;
    amount: number;
    occurredAt: string;
    status: string;
  }
) {
  if (
    existing.assetType !== next.assetType ||
    existing.assetId !== next.assetId ||
    existing.projectId !== next.projectId
  )
    fail("维修记录资源及历史项目不能替换", "CONFLICT");
  if (["approved", "settled"].includes(existing.status)) {
    if (
      Number(existing.amount) !== next.amount ||
      existing.costCategory !== next.costCategory ||
      existing.occurredAt.getTime() !== new Date(next.occurredAt).getTime() ||
      existing.status !== next.status
    )
      fail(
        "已确认或已结算维修费用不能直接改金额、日期、状态；请走受控更正流程",
        "CONFLICT"
      );
  }
  if (next.status === "settled" && existing.status !== "settled")
    fail("不能通过维修编辑直接标记已结算");
}
/** 运输出车入口应复用；不改变方量/运价校验，也不允许已退场车辆继续调度。 */
export async function assertVehicleDispatchable(
  db: FleetReadDb,
  vehicleId: number,
  projectId: number
) {
  const [profile] = await db
    .select()
    .from(s.vehicleFleetProfiles)
    .where(eq(s.vehicleFleetProfiles.vehicleId, vehicleId))
    .limit(1);
  if (
    profile &&
    (profile.purpose === "trailer" ||
      profile.archived ||
      profile.projectId !== projectId ||
      profile.projectStatus !== "on_site" ||
      profile.technicalStatus !== "normal" ||
      profile.dispatchStatus === "paused")
  )
    fail("车辆维修、安全禁用、暂停调度或已退场，不能新出车", "CONFLICT");
}
/** 枚举全部直接/间接业务引用：任一历史只允许归档。profile本身不是历史，changes/授权是。 */
export async function vehicleDependencies(db: FleetReadDb, vehicleId: number) {
  const refs = await Promise.all([
    db
      .select({ id: s.transportTrips.id })
      .from(s.transportTrips)
      .where(eq(s.transportTrips.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehicleRfidCards.id })
      .from(s.transportVehicleRfidCards)
      .where(eq(s.transportVehicleRfidCards.vehicleId, vehicleId)),
    db
      .select({ id: s.transportCardEvents.id })
      .from(s.transportCardEvents)
      .where(eq(s.transportCardEvents.vehicleId, vehicleId)),
    db
      .select({ id: s.assetMaintenanceRecords.id })
      .from(s.assetMaintenanceRecords)
      .where(
        and(
          eq(s.assetMaintenanceRecords.assetType, "vehicle"),
          eq(s.assetMaintenanceRecords.assetId, vehicleId)
        )
      ),
    db
      .select({ id: s.purchaseOrders.id })
      .from(s.purchaseOrders)
      .where(
        and(
          eq(s.purchaseOrders.assetType, "vehicle"),
          eq(s.purchaseOrders.assetId, vehicleId)
        )
      ),
    db
      .select({ id: s.dieselRefuelRecords.id })
      .from(s.dieselRefuelRecords)
      .where(eq(s.dieselRefuelRecords.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehicleLeaseRules.id })
      .from(s.transportVehicleLeaseRules)
      .where(eq(s.transportVehicleLeaseRules.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehiclePayeeAccounts.id })
      .from(s.transportVehiclePayeeAccounts)
      .where(eq(s.transportVehiclePayeeAccounts.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehicleUsageRecords.id })
      .from(s.transportVehicleUsageRecords)
      .where(eq(s.transportVehicleUsageRecords.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehicleSettlements.id })
      .from(s.transportVehicleSettlements)
      .where(eq(s.transportVehicleSettlements.vehicleId, vehicleId)),
    db
      .select({ id: s.transportVehicleCarryForwardOffsets.id })
      .from(s.transportVehicleCarryForwardOffsets)
      .where(eq(s.transportVehicleCarryForwardOffsets.vehicleId, vehicleId)),
    db
      .select({ id: s.officialAccountDriverBindings.id })
      .from(s.officialAccountDriverBindings)
      .where(eq(s.officialAccountDriverBindings.vehicleId, vehicleId)),
    db
      .select({ id: s.officialAccountDriverNotificationRecords.id })
      .from(s.officialAccountDriverNotificationRecords)
      .where(
        eq(s.officialAccountDriverNotificationRecords.vehicleId, vehicleId)
      ),
    db
      .select({ id: s.personnelResourceBindings.id })
      .from(s.personnelResourceBindings)
      .where(
        and(
          eq(s.personnelResourceBindings.assetType, "vehicle"),
          eq(s.personnelResourceBindings.assetId, vehicleId)
        )
      ),
    db
      .select({ id: s.vehicleAssignments.id })
      .from(s.vehicleAssignments)
      .where(eq(s.vehicleAssignments.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleAccessGrants.id })
      .from(s.vehicleAccessGrants)
      .where(eq(s.vehicleAccessGrants.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleDocuments.id })
      .from(s.vehicleDocuments)
      .where(eq(s.vehicleDocuments.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleInspections.id })
      .from(s.vehicleInspections)
      .where(eq(s.vehicleInspections.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleWorkOrders.id })
      .from(s.vehicleWorkOrders)
      .where(eq(s.vehicleWorkOrders.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleMaintenancePlans.id })
      .from(s.vehicleMaintenancePlans)
      .where(eq(s.vehicleMaintenancePlans.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleSpecialRecords.id })
      .from(s.vehicleSpecialRecords)
      .where(eq(s.vehicleSpecialRecords.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleChanges.id })
      .from(s.vehicleChanges)
      .where(eq(s.vehicleChanges.vehicleId, vehicleId)),
    db
      .select({ id: s.vehicleFleetProfiles.vehicleId })
      .from(s.vehicleFleetProfiles)
      .where(eq(s.vehicleFleetProfiles.trailerVehicleId, vehicleId)),
  ]);
  const names = [
    "trips",
    "cards",
    "cardEvents",
    "maintenance",
    "purchases",
    "diesel",
    "contracts",
    "payees",
    "usage",
    "settlements",
    "offsets",
    "driverBindings",
    "notifications",
    "personnelBindings",
    "assignments",
    "grants",
    "documents",
    "inspections",
    "workOrders",
    "maintenancePlans",
    "specialRecords",
    "changes",
    "trailerCombinations",
  ];
  return Object.fromEntries(names.map((name, i) => [name, refs[i]!.length]));
}
export async function vehicleProjectHistory(
  db: FleetReadDb,
  vehicleId: number,
  currentProjectId: number
) {
  const [
    trips,
    maintenance,
    purchases,
    contracts,
    diesel,
    settlements,
    assignments,
    grants,
    usages,
    payees,
    offsets,
    cards,
    personnel,
  ] = await Promise.all([
    db
      .select({ projectId: s.transportTrips.projectId })
      .from(s.transportTrips)
      .where(eq(s.transportTrips.vehicleId, vehicleId)),
    db
      .select({ projectId: s.assetMaintenanceRecords.projectId })
      .from(s.assetMaintenanceRecords)
      .where(
        and(
          eq(s.assetMaintenanceRecords.assetType, "vehicle"),
          eq(s.assetMaintenanceRecords.assetId, vehicleId)
        )
      ),
    db
      .select({ projectId: s.purchaseOrders.projectId })
      .from(s.purchaseOrders)
      .where(
        and(
          eq(s.purchaseOrders.assetType, "vehicle"),
          eq(s.purchaseOrders.assetId, vehicleId)
        )
      ),
    db
      .select({ projectId: s.transportVehicleLeaseRules.projectId })
      .from(s.transportVehicleLeaseRules)
      .where(eq(s.transportVehicleLeaseRules.vehicleId, vehicleId)),
    db
      .select({ projectId: s.dieselRefuelRecords.projectId })
      .from(s.dieselRefuelRecords)
      .where(eq(s.dieselRefuelRecords.vehicleId, vehicleId)),
    db
      .select({ projectId: s.transportVehicleSettlements.projectId })
      .from(s.transportVehicleSettlements)
      .where(eq(s.transportVehicleSettlements.vehicleId, vehicleId)),
    db
      .select({ projectId: s.vehicleAssignments.projectId })
      .from(s.vehicleAssignments)
      .where(eq(s.vehicleAssignments.vehicleId, vehicleId)),
    db
      .select({ projectId: s.vehicleAccessGrants.projectId })
      .from(s.vehicleAccessGrants)
      .where(eq(s.vehicleAccessGrants.vehicleId, vehicleId)),
    db
      .select({ projectId: s.transportVehicleUsageRecords.projectId })
      .from(s.transportVehicleUsageRecords)
      .where(eq(s.transportVehicleUsageRecords.vehicleId, vehicleId)),
    db
      .select({ projectId: s.transportVehiclePayeeAccounts.projectId })
      .from(s.transportVehiclePayeeAccounts)
      .where(eq(s.transportVehiclePayeeAccounts.vehicleId, vehicleId)),
    db
      .select({ projectId: s.transportVehicleCarryForwardOffsets.projectId })
      .from(s.transportVehicleCarryForwardOffsets)
      .where(eq(s.transportVehicleCarryForwardOffsets.vehicleId, vehicleId)),
    db
      .select({ projectId: s.transportVehicleRfidCards.projectId })
      .from(s.transportVehicleRfidCards)
      .where(eq(s.transportVehicleRfidCards.vehicleId, vehicleId)),
    db
      .select({ projectId: s.personnelResourceBindings.projectId })
      .from(s.personnelResourceBindings)
      .where(
        and(
          eq(s.personnelResourceBindings.assetType, "vehicle"),
          eq(s.personnelResourceBindings.assetId, vehicleId)
        )
      ),
  ]);
  return Array.from(
    new Set([
      currentProjectId,
      ...[
        trips,
        maintenance,
        purchases,
        contracts,
        diesel,
        settlements,
        assignments,
        grants,
        usages,
        payees,
        offsets,
        cards,
        personnel,
      ]
        .flat()
        .map(row => row.projectId)
        .filter((id): id is number => id !== null),
    ])
  );
}
