import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

import { transportTrips } from "../../drizzle/schema";
import { getDb } from "../db";
import { runProjectRiskScan } from "../routers/projectRisk";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** 所有开票方式共用的车辆在途锁；卡片会话键仅用于 NFC 卸土闭环匹配。 */
export function createActiveVehicleTransitKey(projectId: number, vehicleId: number) {
  return `vehicle:${projectId}:${vehicleId}`;
}

/** 以服务端记录限制同车连续 NFC 开票，避免客户端时间或页面状态绕过运输间隔。 */
export async function assertVehicleMinimumNfcInvoiceInterval(db: Database, input: { projectId: number; vehicleId: number; plateNo: string; occurredAt: Date; minimumTransitMinutes: number }) {
  const [latestTrip] = await db.select({ tripNo: transportTrips.tripNo, startAt: transportTrips.startAt }).from(transportTrips).where(and(
    eq(transportTrips.projectId, input.projectId),
    eq(transportTrips.vehicleId, input.vehicleId),
    ne(transportTrips.status, "void"),
  )).orderBy(desc(transportTrips.startAt)).limit(1);
  if (!latestTrip) return;
  const elapsedMinutes = Math.max(0, Math.floor((input.occurredAt.getTime() - new Date(latestTrip.startAt).getTime()) / 60_000));
  if (elapsedMinutes < input.minimumTransitMinutes) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `重复开票拦截：车辆 ${input.plateNo} 距上次装土/开票仅 ${elapsedMinutes} 分钟，未达到最小间隔 ${input.minimumTransitMinutes} 分钟` });
  }
}

/**
 * 装土点未刷卡的特殊卸土补刷卡场景不能伪造实际运输起点。
 * 因此仅以同一车辆上一笔已结束运输的结束时间约束连续补刷卡间隔，首笔不凭空计算时长。
 */
export async function assertVehicleMinimumUnloadOnlyScanInterval(db: Database, input: { projectId: number; vehicleId: number; plateNo: string; occurredAt: Date; minimumTransitMinutes: number }) {
  const [latestCompletedTrip] = await db.select({ tripNo: transportTrips.tripNo, endAt: transportTrips.endAt }).from(transportTrips).where(and(
    eq(transportTrips.projectId, input.projectId),
    eq(transportTrips.vehicleId, input.vehicleId),
    ne(transportTrips.status, "void"),
    isNull(transportTrips.activeVehicleTransitKey),
  )).orderBy(desc(transportTrips.endAt)).limit(1);
  if (!latestCompletedTrip?.endAt) return;
  const elapsedMinutes = Math.max(0, Math.floor((input.occurredAt.getTime() - new Date(latestCompletedTrip.endAt).getTime()) / 60_000));
  if (elapsedMinutes < input.minimumTransitMinutes) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `卸土点补刷卡间隔拦截：车辆 ${input.plateNo} 距上一笔已结束运输仅 ${elapsedMinutes} 分钟，未达到路线最小间隔 ${input.minimumTransitMinutes} 分钟` });
  }
}

/** 仅项目显式开启单次刷卡闭环时调用；条件更新避免和卸土事件产生并发覆盖。 */
export async function completeNfcTripBySingleScan(db: Database, input: { tripId: number; userId: number; occurredAt: Date; routeSnapshot: unknown }) {
  const routeSnapshot = { ...getRouteSnapshot(input.routeSnapshot), nfcSingleScanClosed: true, nfcSingleScanClosedAt: input.occurredAt.toISOString(), nfcSingleScanClosedBy: input.userId };
  const result = await db.update(transportTrips).set({ unloadConfirmedAt: input.occurredAt, unloadConfirmedBy: null, unloadEventId: null, endAt: input.occurredAt, status: "submitted", activeVehicleTransitKey: null, nfcTransitKey: null, routeSnapshot }).where(and(eq(transportTrips.id, input.tripId), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")));
  if (!didConditionalWriteApply(result)) throw new TRPCError({ code: "CONFLICT", message: "运输闭环状态已被其他操作更新，请刷新后查看" });
}

export function getChinaBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function triggerTransportRiskScan(projectId: number) {
  void runProjectRiskScan(projectId, getChinaBusinessDate()).catch(() => undefined);
}

export function calculateCoordinateDistanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function throwIfDuplicateActiveVehicleTransit(error: unknown, plateNo: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("transport_trips_project_active_vehicle_transit_unique") || message.includes("activeVehicleTransitKey")) {
    throw new TRPCError({ code: "CONFLICT", message: `车辆 ${plateNo} 还未卸土，请先完成当前运单后再开具新发票` });
  }
  throw error;
}

/** 历史票据可能尚未写入新锁字段，开票前仍按车辆状态查询一次作为兼容保护。 */
export async function assertNoOpenTransportTrip(db: Database, projectId: number, vehicleId: number, plateNo: string) {
  const rows = await db.select({ tripNo: transportTrips.tripNo, id: transportTrips.id }).from(transportTrips).where(and(
    eq(transportTrips.projectId, projectId),
    eq(transportTrips.vehicleId, vehicleId),
    isNull(transportTrips.unloadConfirmedAt),
    ne(transportTrips.status, "void"),
    ne(transportTrips.status, "settled"),
  ));
  const activeTrip = rows.sort((left, right) => Number(right.id) - Number(left.id))[0];
  if (activeTrip) throw new TRPCError({ code: "CONFLICT", message: `车辆 ${plateNo} 还未卸土，请先完成当前运单 ${activeTrip.tripNo} 后再开具新发票` });
}

export function getRouteSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function didConditionalWriteApply(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return !(header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0);
}
