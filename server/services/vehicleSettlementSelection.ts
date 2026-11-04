import { chinaBusinessDate } from "./chinaBusinessTime";
import { getTransportReviewEligibility } from "./transportWorkspace";

export type VehicleSettlementSelectionMode = "day" | "period" | "trip_count";
export type VehicleSettlementSelectionInput = {
  projectId: number;
  vehicleId: number;
  periodStart: string;
  periodEnd: string;
  selectionMode?: VehicleSettlementSelectionMode;
  tripCount?: number;
};
type Trip = {
  id: number;
  projectId: number;
  vehicleId: number;
  tripNo: string;
  status: string;
  startAt: Date | string;
  calculatedAmount: string | number | null;
  calculatedUnitPrice?: string | number | null;
  volumeCubicMeters?: string | number | null;
  weightTons?: string | number | null;
  evidenceId?: number | null;
  routeSnapshot?: unknown;
  [key: string]: unknown;
};
type Fact = Record<string, any>;

/** Shared API and pure-helper validation; undefined mode preserves the old period API. */
export function vehicleSettlementSelectionValidationReason(
  input: VehicleSettlementSelectionInput
): string | null {
  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(new Date(`${date}T00:00:00Z`).getTime()) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate(input.periodStart) || !validDate(input.periodEnd))
    return "日期格式应为有效 YYYY-MM-DD";
  if (input.periodEnd < input.periodStart) return "结束日期不能早于开始日期";
  if (
    input.selectionMode &&
    !["day", "period", "trip_count"].includes(input.selectionMode)
  )
    return "结算选择模式无效";
  if (input.selectionMode === "day" && input.periodStart !== input.periodEnd)
    return "按天结算的开始和结束日期必须是同一天";
  if (input.selectionMode === "trip_count") {
    if (
      !Number.isInteger(input.tripCount) ||
      input.tripCount! < 1 ||
      input.tripCount! > 1000
    )
      return "按趟数结算必须填写 1–1000 的整数趟数";
  } else if (input.tripCount !== undefined)
    return "只有按趟数结算可以填写 tripCount";
  return null;
}

export function vehicleSettlementEvidenceIds(trips: readonly Trip[]): number[] {
  return Array.from(
    new Set(
      trips
        .flatMap(trip => {
          const snapshot = trip.routeSnapshot as Fact | null;
          return [trip.evidenceId, Number(snapshot?.unloadPhotoEvidenceId)];
        })
        .filter(
          (id): id is number =>
            typeof id === "number" && Number.isSafeInteger(id) && id > 0
        )
    )
  );
}

/** Only persisted, verified, closed and unoccupied facts enter the candidate set. No deductions/payment estimates. */
export function selectVehicleSettlementTrips<T extends Trip>(
  input: VehicleSettlementSelectionInput,
  trips: readonly T[],
  facts: {
    occupiedTripIds: readonly number[];
    events: readonly Fact[];
    evidence: readonly Fact[];
  }
) {
  const selectionMode = input.selectionMode ?? "period";
  const invalidReason = vehicleSettlementSelectionValidationReason(input);
  const occupied = new Set(facts.occupiedTripIds);
  const eventsByTrip = new Map<number, Fact[]>();
  for (const event of facts.events) {
    if (event.projectId !== input.projectId) continue;
    const group = eventsByTrip.get(event.tripId) ?? [];
    group.push(event);
    eventsByTrip.set(event.tripId, group);
  }
  const imageIds = new Set(
    facts.evidence
      .filter(
        row =>
          row.projectId === input.projectId &&
          row.sourceType === "transport" &&
          row.status === "active" &&
          row.mimeType?.startsWith("image/")
      )
      .map(row => row.id)
  );
  const available = invalidReason
    ? []
    : trips
        .filter(trip => {
          if (
            trip.projectId !== input.projectId ||
            trip.vehicleId !== input.vehicleId ||
            trip.status !== "verified" ||
            occupied.has(trip.id)
          )
            return false;
          const date = chinaBusinessDate(trip.startAt);
          if (!date || date < input.periodStart || date > input.periodEnd)
            return false;
          const snapshot = trip.routeSnapshot as Fact | null;
          const review = getTransportReviewEligibility(
            trip,
            eventsByTrip.get(trip.id) ?? [],
            {
              load: imageIds.has(trip.evidenceId),
              unload: imageIds.has(Number(snapshot?.unloadPhotoEvidenceId)),
            }
          );
          return review.eligible && !review.requiresExceptionReview;
        })
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime() ||
            a.id - b.id
        );
  const selectedTrips =
    selectionMode === "trip_count"
      ? available.slice(0, input.tripCount ?? 0)
      : available;
  const money = (amount: number) => Math.round(amount * 100) / 100;
  const nullableNumber = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);
  const rows = selectedTrips.map(trip => {
    const unit = (trip.routeSnapshot as Fact | null)?.settlementUnit;
    return {
      id: trip.id,
      tripNo: trip.tripNo,
      startAt: trip.startAt,
      quantity:
        unit === "ton"
          ? nullableNumber(trip.weightTons)
          : unit === "cubic_meter"
            ? nullableNumber(trip.volumeCubicMeters)
            : 1,
      unitPrice: nullableNumber(trip.calculatedUnitPrice),
      grossAmount: Number(trip.calculatedAmount ?? 0),
    };
  });
  const groups = new Map<
    string,
    { date: string; tripCount: number; grossFreightAmount: number }
  >();
  for (const row of rows) {
    const date = chinaBusinessDate(row.startAt);
    const group = groups.get(date) ?? {
      date,
      tripCount: 0,
      grossFreightAmount: 0,
    };
    group.tripCount++;
    group.grossFreightAmount += row.grossAmount;
    groups.set(date, group);
  }
  const reason =
    invalidReason ??
    (selectionMode === "trip_count" && available.length < input.tripCount!
      ? `所选期间仅有 ${available.length} 趟可结算运单，不足要求的 ${input.tripCount} 趟，请刷新或调整条件`
      : selectedTrips.length === 0
        ? "所选期间没有可结算的已核验运输趟次"
        : selectedTrips.length > 1000
          ? "所选期间超过 1000 趟，请缩小日期范围后重新预览"
          : null);
  return {
    selectedTrips,
    preview: {
      tripIds: rows.map(row => row.id),
      rows,
      availableCount: available.length,
      selectedCount: rows.length,
      grossFreightAmount: money(
        rows.reduce((sum, row) => sum + row.grossAmount, 0)
      ),
      eligible: reason === null,
      reason,
      dailyGroups: Array.from(groups.values()).map(group => ({
        ...group,
        grossFreightAmount: money(group.grossFreightAmount),
      })),
      selectionMode,
    },
  };
}

/** Match sets, never silently deduplicate or discard explicit IDs (order is supplied by the server). */
export function vehicleSettlementTripIdsMatch(
  actual: readonly number[],
  requested: readonly number[]
) {
  return (
    new Set(requested).size === requested.length &&
    new Set(actual).size === actual.length &&
    actual.length === requested.length &&
    actual.every(id => requested.includes(id))
  );
}
