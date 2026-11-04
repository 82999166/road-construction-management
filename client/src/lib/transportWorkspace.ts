export type TransportReviewView = "all" | "pending" | "exceptions";
export const TRANSPORT_WORKSPACE_TABS = [
  { value: "ledger", label: "运单台账" },
  { value: "review", label: "核验与异常" },
  { value: "settlements", label: "运费结算" },
  { value: "rates", label: "合同运价" },
  { value: "terminals", label: "场站路线与终端" },
] as const;
export type TransportWorkspaceTab =
  (typeof TRANSPORT_WORKSPACE_TABS)[number]["value"];
export const transportNetAmount = (row: any) =>
  Number(
    row.netSettlementAmount ??
      Number(row.calculatedAmount ?? 0) - Number(row.fuelDeductionAmount ?? 0)
  );
export function transportVisibleTrips<T extends { status: string }>(
  rows: readonly T[],
  status: string
): T[] {
  return rows.filter(row =>
    status === "void"
      ? row.status === "void"
      : status === "all"
        ? row.status !== "void"
        : row.status === status
  );
}
export function transportSettlementLabel(row: any) {
  if (row.legacyUnlinkedSettled) return "历史已结算 · 未关联结算单，付款未确认";
  if (row.settlementNo)
    return `${row.settlementNo} · ${row.paymentConfirmed ? "已付清" : "未付清"}`;
  return row.status === "settled"
    ? "已核定结算 · 付款未确认"
    : row.status === "verified"
      ? "已核验 · 待生成结算单"
      : "未生成结算单";
}
export function filterTransportSettlements<T extends Record<string, any>>(
  rows: readonly T[],
  filter: { month: string; vehicleId: string; status: string }
) {
  const businessMonth = (value: unknown) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(new Date(value as string))
      .reduce<Record<string, string>>(
        (parts, part) => ({ ...parts, [part.type]: part.value }),
        {}
      );
  return rows.filter(row => {
    const month = businessMonth(row.periodEnd);
    return (
      (!filter.month || `${month.year}-${month.month}` === filter.month) &&
      (filter.vehicleId === "all" ||
        row.vehicleId === Number(filter.vehicleId)) &&
      (filter.status === "all"
        ? row.status !== "void"
        : row.status === filter.status)
    );
  });
}
