import { inArray, desc } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import {
  fleetAccess,
  requireFleetDb,
  safeDocument,
} from "./vehicleManagementPolicy";
export async function listFleetRecords(
  ctx: TrpcContext,
  input: {
    vehicleIds: number[];
    projectId?: number;
    category: "assignments" | "maintenance" | "compliance";
  }
) {
  const { scope } = await fleetAccess(ctx, "read", input.projectId);
  const db = await requireFleetDb();
  const candidates = input.vehicleIds.length
    ? await db
        .select({
          id: s.transportVehicles.id,
          projectId: s.transportVehicles.projectId,
        })
        .from(s.transportVehicles)
        .where(inArray(s.transportVehicles.id, input.vehicleIds))
    : await db
        .select({
          id: s.transportVehicles.id,
          projectId: s.transportVehicles.projectId,
        })
        .from(s.transportVehicles);
  const ids = candidates
    .filter(
      v =>
        (scope.hasAllProjects || scope.projectIds.includes(v.projectId)) &&
        (!input.projectId || v.projectId === input.projectId)
    )
    .map(v => v.id);
  const visible = <T extends { projectId: number }>(rows: T[]) =>
    rows.filter(
      r =>
        (scope.hasAllProjects || scope.projectIds.includes(r.projectId)) &&
        (!input.projectId || r.projectId === input.projectId)
    );
  if (!ids.length)
    return {
      assignments: [],
      workOrders: [],
      maintenancePlans: [],
      documents: [],
      inspections: [],
      specialRecords: [],
    };
  const assignments =
    input.category === "assignments"
      ? visible(
          await db
            .select()
            .from(s.vehicleAssignments)
            .where(inArray(s.vehicleAssignments.vehicleId, ids))
            .orderBy(desc(s.vehicleAssignments.effectiveFrom))
        )
      : [];
  const workOrders =
    input.category === "maintenance"
      ? visible(
          await db
            .select()
            .from(s.vehicleWorkOrders)
            .where(inArray(s.vehicleWorkOrders.vehicleId, ids))
            .orderBy(desc(s.vehicleWorkOrders.createdAt))
        )
      : [];
  const maintenancePlans =
    input.category === "maintenance"
      ? visible(
          await db
            .select()
            .from(s.vehicleMaintenancePlans)
            .where(inArray(s.vehicleMaintenancePlans.vehicleId, ids))
            .orderBy(desc(s.vehicleMaintenancePlans.createdAt))
        )
      : [];
  const documents =
    input.category === "compliance"
      ? visible(
          await db
            .select()
            .from(s.vehicleDocuments)
            .where(inArray(s.vehicleDocuments.vehicleId, ids))
            .orderBy(desc(s.vehicleDocuments.createdAt))
        ).map(safeDocument)
      : [];
  const inspections =
    input.category === "compliance"
      ? visible(
          await db
            .select()
            .from(s.vehicleInspections)
            .where(inArray(s.vehicleInspections.vehicleId, ids))
            .orderBy(desc(s.vehicleInspections.occurredAt))
        )
      : [];
  const specialRecords =
    input.category === "compliance"
      ? visible(
          await db
            .select()
            .from(s.vehicleSpecialRecords)
            .where(inArray(s.vehicleSpecialRecords.vehicleId, ids))
            .orderBy(desc(s.vehicleSpecialRecords.recordedAt))
        )
      : [];
  return {
    assignments,
    workOrders,
    maintenancePlans,
    documents,
    inspections,
    specialRecords,
  };
}
