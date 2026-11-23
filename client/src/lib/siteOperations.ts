import type { SiteRisk, SiteTransportEvent } from "@shared/siteOperations";

export function getChinaBusinessDate(now = new Date()): string {
  const d = new Date(now.getTime() + 8 * 3600000);
  return d.toISOString().slice(0, 10);
}
export function siteTime(
  value: string | Date | null | undefined,
  withDate = false
): string {
  if (!value) return "未记录";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(withDate ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
  }).format(d);
}
export type SiteDetailTarget = {
  target: "transport" | "diesel";
  projectId: number;
  vehicleId?: number;
  tripId?: number | null;
  refuelId?: number | null;
  eventId?: number | null;
  plate?: string;
  basis?: string;
  metric?: string;
};
export function siteDetailPath(
  target: SiteDetailTarget,
  businessDate: string
): string {
  const q = new URLSearchParams({
    onsite: "1",
    projectId: String(target.projectId),
    businessDate,
  });
  for (const k of [
    "vehicleId",
    "tripId",
    "refuelId",
    "eventId",
    "plate",
    "basis",
    "metric",
  ] as const)
    if (target[k] != null) q.set(k, String(target[k]));
  return `/admin/${target.target}?${q}`;
}
export function eventTarget(
  e: SiteTransportEvent,
  projectId: number
): SiteDetailTarget {
  return {
    target: "transport",
    projectId,
    vehicleId: e.vehicleId,
    tripId: e.tripId,
    eventId: e.eventId,
    plate: e.plate,
  };
}
export function riskTarget(r: SiteRisk): SiteDetailTarget {
  return { ...r.detail, plate: r.plate, basis: r.basis };
}
export type OnsiteFocus = SiteDetailTarget & { businessDate: string };
export function parseOnsiteFocus(search: string): OnsiteFocus | null {
  const q = new URLSearchParams(search);
  const projectId = Number(q.get("projectId"));
  const businessDate = q.get("businessDate") || "";
  if (
    q.get("onsite") !== "1" ||
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(new Date(`${businessDate}T00:00:00+08:00`).getTime()) ||
    getChinaBusinessDate(new Date(`${businessDate}T00:00:00+08:00`)) !==
      businessDate
  )
    return null;
  const positive = (k: string) => {
    const n = Number(q.get(k));
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  return {
    target: q.has("refuelId") ? "diesel" : "transport",
    projectId,
    businessDate,
    vehicleId: positive("vehicleId"),
    tripId: positive("tripId"),
    refuelId: positive("refuelId"),
    eventId: positive("eventId"),
    plate: q.get("plate") || undefined,
    basis: q.get("basis") || undefined,
    metric: q.get("metric") || undefined,
  };
}
// This is a new full ledger query, never the dashboard's eventLimit slice.
export function filterSiteTrips<T extends Record<string, any>>(
  rows: T[],
  metric: string,
  date: string
): T[] {
  const inDay = (v: any) => v && getChinaBusinessDate(new Date(v)) === date;
  return rows.filter(t => {
    if (["draft", "void"].includes(t.status)) return false;
    const es = t.cardEvents || [];
    const accepted = (kind: string) =>
      es.find(
        (e: any) =>
          e.eventType === kind &&
          ["accepted", "已通过", "有效", "已接受", "校验通过"].includes(
            e.validationStatus
          )
      );
    const load = accepted("load"),
      unload = accepted("unload");
    const review = es.some((e: any) =>
      ["needs_review", "待核验", "待复核", "待人工核验"].includes(
        e.validationStatus
      )
    );
    const eligible = t.reviewEligibility;
    const normal =
      eligible?.closureKind === "normal" &&
      eligible.eligible &&
      !eligible.requiresExceptionReview &&
      !review &&
      ["verified", "settled"].includes(t.status) &&
      unload &&
      new Date(unload.occurredAt) >
        new Date(load?.occurredAt || t.loadConfirmedAt);
    const transit =
      eligible?.closureKind === "normal" &&
      t.loadConfirmedAt &&
      t.loadConfirmedBy &&
      (load || t.loadInvoiceEvidence) &&
      !t.unloadConfirmedAt &&
      !t.endAt &&
      t.status !== "settled";
    if (metric === "departures") return inDay(t.startAt);
    if (metric === "normalCompletions")
      return normal && inDay(unload.occurredAt);
    if (metric === "currentInTransitVehicles") return Boolean(transit);
    const related =
      inDay(t.startAt) ||
      inDay(t.unloadConfirmedAt) ||
      es.some((e: any) => inDay(e.occurredAt));
    if (metric === "specialClosures")
      return eligible?.closureKind !== "normal" && inDay(t.endAt);
    const awaiting = transit && !review && t.exceptionStatus !== "open";
    if (metric === "pendingReview")
      return (
        related &&
        !awaiting &&
        (review ||
          t.exceptionStatus === "open" ||
          !eligible?.eligible ||
          (eligible.closureKind === "normal" && !normal))
      );
    return related;
  });
}
export function filterFocusedTrips<T extends Record<string, any>>(
  rows: T[],
  focus: OnsiteFocus | null
): T[] {
  if (!focus) return rows;
  const selected = rows.filter(
    t =>
      (!focus.tripId || t.id === focus.tripId) &&
      (!focus.vehicleId || t.vehicleId === focus.vehicleId)
  );
  // Exact IDs can cross midnight; do not discard their original evidence by departure date.
  return focus.tripId || focus.basis === "current_snapshot"
    ? selected
    : filterSiteTrips(selected, focus.metric || "related", focus.businessDate);
}
export function filterFocusedRefuels<T extends Record<string, any>>(
  rows: T[],
  focus: OnsiteFocus | null
): T[] {
  return !focus
    ? rows
    : rows.filter(
        r =>
          (!focus.refuelId || r.id === focus.refuelId) &&
          (!focus.vehicleId || r.vehicleId === focus.vehicleId)
      );
}
