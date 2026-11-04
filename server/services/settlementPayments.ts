import { and, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  machinePaymentSettlements,
  machines,
  projects,
  settlementPaymentRecords,
  transportVehicleCarryForwardOffsets,
  transportVehicleSettlements,
  transportVehicles,
} from "../../drizzle/schema";
import type { getDb } from "../db";

export type SettlementPaymentDb = NonNullable<
  Awaited<ReturnType<typeof getDb>>
>;
export type SettlementPaymentQueryClient = Pick<SettlementPaymentDb, "select">;
export type SettlementPaymentWriteClient = Pick<
  SettlementPaymentDb,
  "select" | "insert" | "update"
>;
export type SettlementPaymentSource = Pick<
  typeof settlementPaymentRecords.$inferSelect,
  "projectId" | "settlementType" | "settlementId"
>;
type VehicleSettlementIdentity = Pick<
  typeof transportVehicleSettlements.$inferSelect,
  "id" | "projectId" | "vehicleId" | "status"
>;
type CarryForwardUsage = Pick<
  typeof transportVehicleCarryForwardOffsets.$inferSelect,
  | "sourceSettlementId"
  | "targetSettlementId"
  | "vehicleId"
  | "amount"
  | "status"
>;

/** 与运输创建/审核/作废及采购保持同一跨路由互斥锁；主结算锁必须在资源锁之后取得。 */
export async function lockSettlementPaymentScope(
  tx: SettlementPaymentQueryClient,
  input: SettlementPaymentSource
) {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .for("update");
  if (!project)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "当前项目不存在，请刷新后重试",
    });
}

/** 项目锁已持有，先定位资源，再锁资源；不能先锁主结算再反向等待车辆/机械。 */
export async function lockSettlementPaymentResource(
  tx: SettlementPaymentQueryClient,
  input: SettlementPaymentSource
) {
  if (input.settlementType === "transport_vehicle") {
    const [source] = await tx
      .select({ vehicleId: transportVehicleSettlements.vehicleId })
      .from(transportVehicleSettlements)
      .where(
        and(
          eq(transportVehicleSettlements.id, input.settlementId),
          eq(transportVehicleSettlements.projectId, input.projectId)
        )
      )
      .limit(1);
    if (!source)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "车辆结算单不存在或不属于当前项目",
      });
    const [vehicle] = await tx
      .select({ id: transportVehicles.id })
      .from(transportVehicles)
      .where(
        and(
          eq(transportVehicles.id, source.vehicleId),
          eq(transportVehicles.projectId, input.projectId)
        )
      )
      .for("update");
    if (!vehicle)
      throw new TRPCError({
        code: "CONFLICT",
        message: "结算车辆已变更或不属于当前项目，请刷新后核对",
      });
  } else if (input.settlementType === "machine") {
    const [source] = await tx
      .select({ machineId: machinePaymentSettlements.machineId })
      .from(machinePaymentSettlements)
      .where(
        and(
          eq(machinePaymentSettlements.id, input.settlementId),
          eq(machinePaymentSettlements.projectId, input.projectId)
        )
      )
      .limit(1);
    if (!source)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "机械付款结算单不存在或不属于当前项目",
      });
    const [machine] = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(
        and(
          eq(machines.id, source.machineId),
          eq(machines.projectId, input.projectId)
        )
      )
      .for("update");
    if (!machine)
      throw new TRPCError({
        code: "CONFLICT",
        message: "结算机械已变更或不属于当前项目，请刷新后核对",
      });
  }
}

/** 只使用明确存在的有效分配记录；不从主单标签、扣款合计或缺失历史审计猜测抵扣。 */
export function buildValidVehicleCarryForwardTotals(
  offsets: readonly CarryForwardUsage[],
  targets: readonly VehicleSettlementIdentity[]
) {
  const validTargets = new Map(
    targets.filter(row => row.status !== "void").map(row => [row.id, row])
  );
  const totals = new Map<number, number>();
  for (const offset of offsets) {
    const source = validTargets.get(offset.sourceSettlementId);
    const target = validTargets.get(offset.targetSettlementId);
    const amount = Number(offset.amount);
    if (
      offset.status !== "active" ||
      !source ||
      !target ||
      source.id === target.id ||
      source.projectId !== target.projectId ||
      source.vehicleId !== offset.vehicleId ||
      target.vehicleId !== offset.vehicleId ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      continue;
    totals.set(
      offset.sourceSettlementId,
      Math.round(
        ((totals.get(offset.sourceSettlementId) ?? 0) + amount) * 100
      ) / 100
    );
  }
  return totals;
}

/** Only approved/partially paid/paid/offset settlement targets represent actual recovery. */
export function sumConfirmedCarryForwardOffsets(
  offsets: readonly CarryForwardUsage[],
  targets: readonly VehicleSettlementIdentity[]
) {
  const confirmedStatuses = new Set(["approved", "partial", "paid", "offset"]);
  const confirmedTargetIds = new Set(
    targets.filter(row => confirmedStatuses.has(row.status)).map(row => row.id)
  );
  return buildValidVehicleCarryForwardTotals(
    offsets.filter(offset => confirmedTargetIds.has(offset.targetSettlementId)),
    targets
  );
}

export async function getActiveVehicleCarryForwardAmount(
  db: SettlementPaymentQueryClient,
  source: VehicleSettlementIdentity,
  lock = false
) {
  const query = db
    .select({
      sourceSettlementId:
        transportVehicleCarryForwardOffsets.sourceSettlementId,
      targetSettlementId:
        transportVehicleCarryForwardOffsets.targetSettlementId,
      vehicleId: transportVehicleCarryForwardOffsets.vehicleId,
      amount: transportVehicleCarryForwardOffsets.amount,
      status: transportVehicleCarryForwardOffsets.status,
    })
    .from(transportVehicleCarryForwardOffsets)
    .where(
      and(
        eq(transportVehicleCarryForwardOffsets.projectId, source.projectId),
        eq(transportVehicleCarryForwardOffsets.vehicleId, source.vehicleId),
        eq(transportVehicleCarryForwardOffsets.sourceSettlementId, source.id),
        eq(transportVehicleCarryForwardOffsets.status, "active")
      )
    );
  const offsets = await (lock ? query.for("update") : query);
  if (!offsets.length) return 0;
  const targetsQuery = db
    .select({
      id: transportVehicleSettlements.id,
      projectId: transportVehicleSettlements.projectId,
      vehicleId: transportVehicleSettlements.vehicleId,
      status: transportVehicleSettlements.status,
    })
    .from(transportVehicleSettlements)
    .where(
      and(
        inArray(
          transportVehicleSettlements.id,
          offsets.map(row => row.targetSettlementId).sort((a, b) => a - b)
        ),
        eq(transportVehicleSettlements.projectId, source.projectId),
        eq(transportVehicleSettlements.vehicleId, source.vehicleId),
        ne(transportVehicleSettlements.status, "void")
      )
    );
  const targets = await (lock ? targetsQuery.for("update") : targetsQuery);
  return (
    buildValidVehicleCarryForwardTotals(offsets, [source, ...targets]).get(
      source.id
    ) ?? 0
  );
}

export function assertSettlementPaymentStatusWrite(result: unknown) {
  const header: unknown = Array.isArray(result) ? result[0] : result;
  if (
    !header ||
    typeof header !== "object" ||
    !("affectedRows" in header) ||
    Number(header.affectedRows) !== 1
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "结算状态已变更，本次资金登记未生效，请刷新后重试",
    });
  }
}
