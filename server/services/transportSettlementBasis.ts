type Trip = {
  id: number;
  startAt: Date;
  status: string;
  calculatedAmount: unknown;
  fuelDeductionAmount: unknown;
  netSettlementAmount: unknown;
  volumeCubicMeters: unknown;
};
type Fuel = { id: number; transportTripId: number | null; amount: unknown };
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const businessDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>(
      (result, part) => ({ ...result, [part.type]: part.value }),
      {}
    );
  return `${parts.year}-${parts.month}-${parts.day}`;
};
/** Historical settled snapshots are not repriced. All pooled fuel is assigned, including negative payable recovery. */
export function buildTransportSettlementBasis<T extends Trip>(
  trips: readonly T[],
  fuel: readonly Fuel[]
) {
  const verified = trips.filter(trip => trip.status === "verified");
  if (trips.some(trip => !["verified", "settled"].includes(trip.status))) {
    throw new Error("运输结算仅允许 verified/settled 运输单");
  }
  const consumedFuel = fuel.filter(
    record =>
      verified.length > 0 &&
      (record.transportTripId === null ||
        verified.some(trip => trip.id === record.transportTripId))
  );
  let pooled = round(
    consumedFuel
      .filter(record => record.transportTripId === null)
      .reduce((sum, record) => { const value = Number(record.amount); return Number.isFinite(value) && value > 0 ? sum + value : sum; }, 0)
  );
  const details = trips.map(trip => {
    const grossFreightAmount = Number(trip.calculatedAmount ?? 0);
    if (trip.status === "settled") {
      const fuelDeductionAmount = Number(trip.fuelDeductionAmount ?? 0);
      return {
        trip,
        tripDate: businessDate(new Date(trip.startAt)),
        volumeCubicMeters: Number(trip.volumeCubicMeters ?? 0),
        grossFreightAmount,
        fuelDeductionAmount,
        netPayableAmount: Number(
          trip.netSettlementAmount ?? grossFreightAmount - fuelDeductionAmount
        ),
      };
    }
    const linked = round(
      consumedFuel
        .filter(record => record.transportTripId === trip.id)
        .reduce((sum, record) => { const value = Number(record.amount); return Number.isFinite(value) && value > 0 ? sum + value : sum; }, 0)
    );
    const poolForTrip =
      trip.id === verified[verified.length - 1]?.id
        ? pooled
        : round(Math.min(Math.max(0, grossFreightAmount - linked), pooled));
    pooled = round(pooled - poolForTrip);
    const fuelDeductionAmount = round(linked + poolForTrip);
    return {
      trip,
      tripDate: businessDate(new Date(trip.startAt)),
      volumeCubicMeters: Number(trip.volumeCubicMeters ?? 0),
      grossFreightAmount: round(grossFreightAmount),
      fuelDeductionAmount,
      netPayableAmount: round(grossFreightAmount - fuelDeductionAmount),
    };
  });
  return { details, consumedFuelIds: consumedFuel.map(record => record.id) };
}
