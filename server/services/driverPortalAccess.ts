import type {
  personnelChanges,
  personnelResourceBindings,
  settlementPaymentRecords,
  transportVehicleSettlements,
  vehicleAccessGrants,
  vehicleAssignments,
} from "../../drizzle/schema";

export type DriverReadRange = {
  vehicleId: number;
  projectId: number;
  from: number;
  to: number;
  source: "assignment" | "grant" | "personnel";
  allHistory: boolean;
};
export type DriverReadSubject = { userId?: number; bindingId?: number };
type Assignment = typeof vehicleAssignments.$inferSelect;
type Grant = typeof vehicleAccessGrants.$inferSelect;
type ResourceBinding = typeof personnelResourceBindings.$inferSelect;
type Change = typeof personnelChanges.$inferSelect;
const timestamp = (value: Date | null | undefined) =>
  value instanceof Date && Number.isFinite(value.getTime())
    ? value.getTime()
    : NaN;
export function driverBusinessDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
export function driverBusinessDayStart(value: string | Date) {
  const date =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00+08:00`).getTime()
    : NaN;
}
const subjectMatches = (
  row: {
    userId?: number | null;
    driverUserId?: number | null;
    driverBindingId: number | null;
  },
  subject: DriverReadSubject
) => {
  const accountId = row.userId ?? row.driverUserId;
  if (accountId != null)
    return subject.userId !== undefined && accountId === subject.userId;
  return (
    subject.bindingId !== undefined && row.driverBindingId === subject.bindingId
  );
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Existing date-only resource bindings have no account snapshot. Only actual resource_binding
 * audit events prove the login identity/start; synthesized asset-createdAt baselines prove neither.
 * New precise vehicle assignments supersede date-only bindings, including another driver's interval. */
export function buildDriverReadRanges(input: {
  subject: DriverReadSubject;
  assignments: readonly Assignment[];
  grants: readonly Grant[];
  personnelBindings?: readonly ResourceBinding[];
  personnelEvents?: readonly Change[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const ranges: DriverReadRange[] = [];
  for (const row of input.assignments) {
    if (
      !subjectMatches(row, input.subject) ||
      !["enter", "transfer", "handover"].includes(row.action)
    )
      continue;
    const from = timestamp(row.effectiveFrom),
      to = row.effectiveTo ? timestamp(row.effectiveTo) : Infinity;
    if (from <= now && to > from)
      ranges.push({
        vehicleId: row.vehicleId,
        projectId: row.projectId,
        from,
        to,
        source: "assignment",
        allHistory: false,
      });
  }
  for (const row of input.grants) {
    if (
      !subjectMatches(row, input.subject) ||
      row.revokedAt ||
      timestamp(row.validFrom) > now ||
      (row.validTo && timestamp(row.validTo) <= now)
    )
      continue;
    const from = timestamp(row.effectiveFrom),
      to = row.effectiveTo ? timestamp(row.effectiveTo) : Infinity;
    if (!(from <= now && to > from)) continue;
    // all_history explicitly authorizes earlier business records, but the grant must be live now.

    ranges.push({
      vehicleId: row.vehicleId,
      projectId: row.projectId,
      from: row.scope === "all_history" ? -Infinity : from,
      to: row.scope === "all_history" ? Infinity : to,
      source: "grant",
      allHistory: row.scope === "all_history",
    });
  }
  if (input.subject.userId !== undefined)
    for (const binding of input.personnelBindings ?? []) {
      if (binding.assetType !== "vehicle" || binding.projectId === null)
        continue;
      const events = (input.personnelEvents ?? [])
        .filter(event => event.action === "resource_binding")
        .flatMap(event => {
          const resource = object(event.changes.resourceBinding),
            after = object(resource?.after),
            before = object(resource?.before);
          return [{ at: timestamp(event.createdAt), after, before }];
        });
      const matchesResource = (row: Record<string, unknown> | null) =>
        row?.assetType === "vehicle" &&
        row.assetId === binding.assetId &&
        row.projectId === binding.projectId &&
        row.personId === binding.personId;
      const start = events
        .filter(
          event =>
            matchesResource(event.after) &&
            event.after?.userId === input.subject.userId &&
            driverBusinessDate(new Date(event.at)) === binding.effectiveFrom
        )
        .map(event => event.at)
        .sort((a, b) => a - b)[0];
      if (!Number.isFinite(start) || start > now) continue;
      const changedIdentity = events
        .filter(
          event =>
            event.at > start &&
            matchesResource(event.before) &&
            event.before?.userId === input.subject.userId &&
            (!matchesResource(event.after) ||
              event.after?.userId !== input.subject.userId)
        )
        .map(event => event.at);
      let to = Math.min(
        binding.effectiveTo
          ? driverBusinessDayStart(binding.effectiveTo)
          : Infinity,
        ...changedIdentity
      );
      if (!(to > start)) continue;
      let fragments = [{ from: start, to }];
      for (const assignment of input.assignments.filter(
        row =>
          row.vehicleId === binding.assetId &&
          row.projectId === binding.projectId
      )) {
        const a = timestamp(assignment.effectiveFrom),
          b = assignment.effectiveTo
            ? timestamp(assignment.effectiveTo)
            : Infinity;
        fragments = fragments.flatMap(range =>
          b <= range.from || a >= range.to
            ? [range]
            : [
                { from: range.from, to: Math.min(a, range.to) },
                { from: Math.max(b, range.from), to: range.to },
              ].filter(r => r.to > r.from)
        );
      }
      ranges.push(
        ...fragments.map(range => ({
          ...range,
          vehicleId: binding.assetId,
          projectId: binding.projectId!,
          source: "personnel" as const,
          allHistory: false,
        }))
      );
    }
  return ranges;
}

/** Whole settlement days must be covered continuously; never prorate a cross-driver statement. */
export function driverRangeCovers(
  ranges: readonly DriverReadRange[],
  vehicleId: number,
  projectId: number,
  from: number,
  to = from + 1
) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
    return false;
  let coveredTo = from;
  for (const range of ranges
    .filter(r => r.vehicleId === vehicleId && r.projectId === projectId)
    .sort((a, b) => a.from - b.from)) {
    if (range.from > coveredTo) break;
    coveredTo = Math.max(coveredTo, range.to);
    if (coveredTo >= to) return true;
  }
  return false;
}

export type DriverPaymentFact = Pick<
  typeof settlementPaymentRecords.$inferSelect,
  | "projectId"
  | "settlementType"
  | "settlementId"
  | "direction"
  | "amount"
  | "paymentDate"
  | "paidAt"
  | "status"
>;
export function driverSettlementPaymentFacts(
  settlement: Pick<
    typeof transportVehicleSettlements.$inferSelect,
    "id" | "projectId" | "status" | "netPayableAmount"
  >,
  records: readonly DriverPaymentFact[],
  recoveredOffsetAmount: number
) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const facts = records.filter(
    row =>
      row.projectId === settlement.projectId &&
      row.settlementType === "transport_vehicle" &&
      row.settlementId === settlement.id &&
      row.status === "active" &&
      Number.isFinite(Number(row.amount)) &&
      Number(row.amount) > 0 &&
      settlement.status !== "void"
  );
  const actualPaidAmount = round(
    facts
      .filter(row => row.direction === "expense")
      .reduce((sum, row) => sum + Number(row.amount), 0)
  );
  const actualReceivedAmount = round(
    facts
      .filter(row => row.direction === "income")
      .reduce((sum, row) => sum + Number(row.amount), 0)
  );
  const net = Number(settlement.netPayableAmount),
    confirmed = [
      "approved",
      "partial",
      "paid",
      "receivable",
      "offset",
    ].includes(settlement.status);
  const offset =
    confirmed && net < 0 ? round(Math.max(0, recoveredOffsetAmount)) : 0;
  const remainingPayableAmount =
    confirmed && net > 0 ? round(Math.max(0, net - actualPaidAmount)) : 0;
  const remainingReceivableAmount =
    confirmed && net < 0
      ? round(Math.max(0, -net - actualReceivedAmount - offset))
      : 0;
  const legacyPaymentUnconfirmed =
    settlement.status === "paid" &&
    !facts.some(row => row.direction === (net < 0 ? "income" : "expense"));
  const recovered = net < 0 ? actualReceivedAmount + offset : actualPaidAmount;
  const remainingAmount =
    net < 0 ? remainingReceivableAmount : remainingPayableAmount;
  const paymentStatus = !confirmed
    ? "pending_approval"
    : legacyPaymentUnconfirmed
      ? "unconfirmed"
      : net === 0
        ? "zero"
        : remainingAmount === 0
          ? net < 0
            ? "recovered"
            : "paid"
          : recovered > 0
            ? net < 0
              ? "partial_recovery"
              : "partial"
            : net < 0
              ? "receivable"
              : "unpaid";
  const dates = facts
    .filter(row => row.direction === (net < 0 ? "income" : "expense"))
    .map(row => ({ at: row.paidAt, date: row.paymentDate }))
    .sort((a, b) => timestamp(b.at) - timestamp(a.at));
  return {
    confirmed,
    actualPaidAmount,
    actualReceivedAmount,
    recoveredOffsetAmount: offset,
    remainingPayableAmount,
    remainingReceivableAmount,
    remainingAmount,
    legacyPaymentUnconfirmed,
    paymentStatus,
    paidAt: dates[0]?.at ?? null,
    paymentDate: dates[0]
      ? String(
          dates[0].date instanceof Date
            ? dates[0].date.toISOString().slice(0, 10)
            : dates[0].date
        )
      : null,
    paymentFacts: facts.map(row => ({
      direction: row.direction,
      amount: Number(row.amount),
      paymentDate:
        row.paymentDate instanceof Date
          ? row.paymentDate.toISOString().slice(0, 10)
          : String(row.paymentDate),
    })),
  };
}
