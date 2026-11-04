import { chinaBusinessDate } from "./chinaBusinessTime";
import { sumConfirmedCarryForwardOffsets } from "./settlementPayments";

export type VehicleFinancialNature = "owned" | "leased" | "outsourced";
type Amount = string | number | null;
type BusinessTime = Date | string;
export type FinanceVehicle = {
  id: number;
  projectId: number;
  ownership: string;
};
export type FinanceProfile = {
  vehicleId: number;
  propertyType: string;
  settlementMode: string;
};
export type FinanceTrip = {
  id: number;
  vehicleId: number;
  projectId: number;
  status: string;
  startAt: BusinessTime;
  tripNo: string;
  calculatedAmount: Amount;
  netSettlementAmount: Amount;
  actualDistanceKm?: Amount;
  driverUserId?: number | null;
  exceptionStatus?: string | null;
  reviewEligible?: boolean;
};
export type FinanceFuel = {
  id: number;
  vehicleId: number | null;
  projectId: number;
  assetType: string;
  status: string;
  refueledAt: BusinessTime;
  amount: Amount;
  liters: Amount;
  deductFromFreight?: boolean;
};
export type FinanceMaintenance = {
  id: number;
  assetId: number;
  projectId: number;
  assetType: string;
  status: string;
  occurredAt: BusinessTime;
  amount: Amount;
  costCategory: string;
};
export type FinancePurchase = {
  id: number;
  assetId: number | null;
  projectId: number;
  assetType: string | null;
  status: string;
  orderedAt: BusinessTime;
  amount: Amount;
  assetDeductionReference?: string | null;
};
export type FinanceLeaseRule = {
  id: number;
  vehicleId: number;
  projectId: number;
  billingType: string;
  rate: Amount;
  effectiveFrom: BusinessTime;
  effectiveTo: BusinessTime | null;
  status: string;
  updatedAt?: BusinessTime;
};
export type FinanceUsage = {
  id: number;
  vehicleId: number;
  projectId: number;
  status: string;
  usageDate: BusinessTime;
  usageType: string;
  quantity: Amount;
  settlementId: number | null;
};
export type FinanceSettlement = {
  id: number;
  settlementNo: string;
  vehicleId: number;
  projectId: number;
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "partial"
    | "paid"
    | "receivable"
    | "offset"
    | "void";
  settlementKind: string;
  periodStart: BusinessTime;
  periodEnd: BusinessTime;
  grossFreightAmount: Amount;
  netPayableAmount: Amount;
  fuelDeductionAmount?: Amount;
  assetDeductionAmount?: Amount;
};
export type FinancePayment = {
  settlementId: number;
  projectId: number;
  settlementType: string;
  status: string;
  direction: string;
  amount: Amount;
  paymentDate: BusinessTime;
};
export type FinanceOffset = {
  projectId: number;
  vehicleId: number;
  sourceSettlementId: number;
  targetSettlementId: number;
  amount: Amount;
  status: "active" | "reversed";
  createdAt: BusinessTime;
};
export type VehicleFinanceSources = {
  trips: FinanceTrip[];
  refuels: FinanceFuel[];
  maintenance: FinanceMaintenance[];
  purchases: FinancePurchase[];
  leaseRules: FinanceLeaseRule[];
  usage: FinanceUsage[];
  settlements: FinanceSettlement[];
  payments: FinancePayment[];
  offsets: FinanceOffset[];
};
export const emptyVehicleFinanceSources = (): VehicleFinanceSources => ({
  trips: [],
  refuels: [],
  maintenance: [],
  purchases: [],
  leaseRules: [],
  usage: [],
  settlements: [],
  payments: [],
  offsets: [],
});
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const amount = (value: Amount | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** DATE columns are calendar dates; timestamps are projected into China business time. */
export const vehicleFinanceDate = (value: BusinessTime) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : chinaBusinessDate(value);
export function nextVehicleFinanceDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function vehicleFinancePeriodEnd(period: string) {
  const date = new Date(`${period}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}
export function vehicleFinancialNature(
  vehicle: FinanceVehicle,
  profile?: FinanceProfile | null
): VehicleFinancialNature {
  if (profile?.propertyType === "company_owned") return "owned";
  if (profile?.propertyType === "rented") return "leased";
  if (profile?.propertyType === "partner") return "outsourced";
  return vehicle.ownership === "leased"
    ? "leased"
    : vehicle.ownership === "trip_settlement"
      ? "outsourced"
      : "owned";
}
/** New classifications permit new settlement creation, but never reprice old trip/settlement snapshots. */
export function canUseVehicleTripSettlement(
  vehicle: FinanceVehicle,
  profile?: FinanceProfile | null
) {
  return profile
    ? ["trip", "ton", "volume"].includes(profile.settlementMode)
    : vehicle.ownership === "trip_settlement";
}
const confirmedSettlement = (row: FinanceSettlement) =>
  ["approved", "partial", "paid", "receivable", "offset"].includes(row.status);
export function vehicleFinanceHasProject(
  vehicle: FinanceVehicle,
  projectId: number,
  sources: VehicleFinanceSources
) {
  return (
    vehicle.projectId === projectId ||
    sources.trips.some(
      r => r.vehicleId === vehicle.id && r.projectId === projectId
    ) ||
    sources.refuels.some(
      r =>
        r.assetType === "vehicle" &&
        r.vehicleId === vehicle.id &&
        r.projectId === projectId
    ) ||
    sources.maintenance.some(
      r =>
        r.assetType === "vehicle" &&
        r.assetId === vehicle.id &&
        r.projectId === projectId
    ) ||
    sources.purchases.some(
      r =>
        r.assetType === "vehicle" &&
        r.assetId === vehicle.id &&
        r.projectId === projectId
    ) ||
    sources.leaseRules.some(
      r => r.vehicleId === vehicle.id && r.projectId === projectId
    ) ||
    sources.usage.some(
      r => r.vehicleId === vehicle.id && r.projectId === projectId
    ) ||
    sources.settlements.some(
      r => r.vehicleId === vehicle.id && r.projectId === projectId
    )
  );
}
function emptyAggregate(date: string) {
  return {
    date,
    tripCount: 0,
    confirmedTripCount: 0,
    pendingTripCount: 0,
    tripNos: [] as string[],
    distanceKm: 0,
    confirmedTransportAmount: 0,
    pendingTransportAmount: 0,
    settlementIncome: 0,
    fuelLiters: 0,
    fuelAmount: 0,
    repairAmount: 0,
    maintenanceAmount: 0,
    partsAmount: 0,
    pendingCostAmount: 0,
    leaseEstimatedAmount: 0,
    unconfirmedLeaseEstimateAmount: 0,
    confirmedLeaseAmount: 0,
    pendingLeaseAmount: 0,
    fuelAdvanceAmount: 0,
    assetAdvanceAmount: 0,
    confirmedOwnerPayableAmount: 0,
    actualPaidAmount: 0,
    actualReceivedAmount: 0,
    recoveredOffsetAmount: 0,
    remainingPayableAmount: 0,
    remainingReceivableAmount: 0,
    sourceCounts: {
      trips: 0,
      refuels: 0,
      maintenance: 0,
      partsPurchase: 0,
      leaseUsage: 0,
    },
  };
}
type Aggregate = ReturnType<typeof emptyAggregate>;
const numericKeys = [
  "tripCount",
  "confirmedTripCount",
  "pendingTripCount",
  "distanceKm",
  "confirmedTransportAmount",
  "pendingTransportAmount",
  "settlementIncome",
  "fuelLiters",
  "fuelAmount",
  "repairAmount",
  "maintenanceAmount",
  "partsAmount",
  "pendingCostAmount",
  "leaseEstimatedAmount",
  "unconfirmedLeaseEstimateAmount",
  "confirmedLeaseAmount",
  "pendingLeaseAmount",
  "fuelAdvanceAmount",
  "assetAdvanceAmount",
  "confirmedOwnerPayableAmount",
  "actualPaidAmount",
  "actualReceivedAmount",
  "recoveredOffsetAmount",
  "remainingPayableAmount",
  "remainingReceivableAmount",
] as const;
function combine(rows: Aggregate[], date: string) {
  const total = emptyAggregate(date);
  for (const row of rows) {
    for (const key of numericKeys) total[key] += row[key];
    total.tripNos.push(...row.tripNos);
    for (const key of Object.keys(
      total.sourceCounts
    ) as (keyof Aggregate["sourceCounts"])[])
      total.sourceCounts[key] += row.sourceCounts[key];
  }
  return total;
}
function decorate(
  row: Aggregate,
  nature: VehicleFinancialNature,
  estimatePending: boolean
) {
  const result = { ...row };
  for (const key of numericKeys) result[key] = round(result[key]);
  const coveredCostAmount = round(
    row.fuelAmount +
      row.repairAmount +
      row.maintenanceAmount +
      row.partsAmount +
      row.confirmedLeaseAmount +
      row.unconfirmedLeaseEstimateAmount
  );
  const externalExtraCost = round(
    coveredCostAmount - row.fuelAdvanceAmount - row.assetAdvanceAmount
  );
  const operatingContributionAmount =
    nature === "owned"
      ? round(row.confirmedTransportAmount - coveredCostAmount)
      : null;
  return {
    ...result,
    financialNature: nature,
    confirmedTransportAmount: round(row.confirmedTransportAmount),
    grossIncome: round(row.confirmedTransportAmount),
    totalExpense: coveredCostAmount,
    coveredCostAmount,
    // Deprecated arithmetic alias, not company net profit; new consumers use the explicit nullable projections.
    netIncome: round(row.confirmedTransportAmount - coveredCostAmount),
    operatingContributionAmount,
    outsourcedTransportCostAmount:
      nature === "outsourced"
        ? round(row.confirmedTransportAmount + externalExtraCost)
        : null,
    leasedCostAmount: nature === "leased" ? externalExtraCost : null,
    amountLabel:
      nature === "owned"
        ? "已覆盖成本差额（经营参考）"
        : nature === "leased"
          ? "租入车辆已覆盖成本"
          : "外协运输成本 / 车主应付",
    costCoverageComplete: false as const,
    costCoverageNote:
      "仅覆盖已登记油料、维修、保养、配件与租赁依据；工资、保险、折旧等完整成本未知，不代表公司净利润。代付/抵扣仅按明确业务事实剔除，不推定费用承担方。",
    leaseEstimatePending: estimatePending,
    fuelCostRatio:
      row.confirmedTransportAmount > 0
        ? round((row.fuelAmount / row.confirmedTransportAmount) * 100)
        : null,
    fuelCostPerTrip:
      row.confirmedTripCount > 0
        ? round(row.fuelAmount / row.confirmedTripCount)
        : null,
    fuelLitersPerTrip:
      row.confirmedTripCount > 0
        ? round(row.fuelLiters / row.confirmedTripCount)
        : null,
    fuelCostPerKm:
      row.distanceKm > 0 ? round(row.fuelAmount / row.distanceKm) : null,
    fuelLitersPerKm:
      row.distanceKm > 0 ? round(row.fuelLiters / row.distanceKm) : null,
    grossIncomePerTrip:
      row.confirmedTripCount > 0
        ? round(row.confirmedTransportAmount / row.confirmedTripCount)
        : null,
    grossIncomePerKm:
      row.distanceKm > 0
        ? round(row.confirmedTransportAmount / row.distanceKm)
        : null,
    fuelMetricNote: "加油量和运输距离比值仅为登记指标，不代表实际百公里耗油。",
  };
}
/** One projection for list/detail/daily/monthly. No writes, no current-ownership gating of historical lease facts. */
export function projectVehicleFinance(
  vehicle: FinanceVehicle,
  projectId: number,
  period: string,
  sources: VehicleFinanceSources,
  profile?: FinanceProfile | null
) {
  const cutoff = vehicleFinancePeriodEnd(period);
  // A current profile is not a historical accounting classification: historical project facts retain their nature.
  const scoped = <T extends { projectId: number }>(rows: T[]) =>
    rows.filter(r => r.projectId === projectId);
  const trips = scoped(sources.trips).filter(
    r => r.vehicleId === vehicle.id && r.status !== "void"
  );
  const fuels = scoped(sources.refuels).filter(
    r =>
      r.assetType === "vehicle" &&
      r.vehicleId === vehicle.id &&
      r.status !== "void"
  );
  const repairs = scoped(sources.maintenance).filter(
    r =>
      r.assetType === "vehicle" &&
      r.assetId === vehicle.id &&
      r.status !== "void"
  );
  const purchases = scoped(sources.purchases).filter(
    r =>
      r.assetType === "vehicle" &&
      r.assetId === vehicle.id &&
      r.status !== "void"
  );
  const rules = scoped(sources.leaseRules)
    .filter(r => r.vehicleId === vehicle.id)
    .sort(
      (a, b) =>
        vehicleFinanceDate(b.effectiveFrom).localeCompare(
          vehicleFinanceDate(a.effectiveFrom)
        ) || b.id - a.id
    );
  const usage = scoped(sources.usage).filter(
    r => r.vehicleId === vehicle.id && r.status === "confirmed"
  );
  const settlements = scoped(sources.settlements).filter(
    r => r.vehicleId === vehicle.id && r.status !== "void"
  );
  const historicalNature = settlements.some(r => r.settlementKind === "trip")
    ? "outsourced"
    : rules.length || settlements.some(r => r.settlementKind === "lease")
      ? "leased"
      : vehicleFinancialNature(vehicle);
  const nature =
    vehicle.projectId === projectId
      ? vehicleFinancialNature(vehicle, profile)
      : historicalNature;
  const dailyMap = new Map<string, Aggregate>();
  const ensure = (date: string) => {
    const old = dailyMap.get(date);
    if (old) return old;
    const row = emptyAggregate(date);
    dailyMap.set(date, row);
    return row;
  };
  const inTime = (date: string) => Boolean(date && date < cutoff);
  for (const trip of trips) {
    const date = vehicleFinanceDate(trip.startAt);
    if (!inTime(date)) continue;
    const row = ensure(date);
    row.tripCount++;
    row.tripNos.push(trip.tripNo);
    row.sourceCounts.trips++;
    const reviewConfirmed =
      trip.status === "settled" ||
      (trip.status === "verified" &&
        trip.exceptionStatus !== "open" &&
        trip.reviewEligible !== false);
    if (reviewConfirmed) {
      row.confirmedTripCount++;
      row.confirmedTransportAmount += amount(trip.calculatedAmount);
      row.settlementIncome += amount(
        trip.netSettlementAmount ?? trip.calculatedAmount
      );
      row.distanceKm += amount(trip.actualDistanceKm);
    } else {
      row.pendingTripCount++;
      row.pendingTransportAmount += amount(trip.calculatedAmount);
    }
  }
  for (const fuel of fuels) {
    const date = vehicleFinanceDate(fuel.refueledAt);
    if (!inTime(date)) continue;
    const row = ensure(date);
    if (["approved", "settled"].includes(fuel.status)) {
      row.fuelAmount += amount(fuel.amount);
      row.fuelLiters += amount(fuel.liters);
      row.sourceCounts.refuels++;
      if (
        fuel.deductFromFreight &&
        settlements.some(s => confirmedSettlement(s))
      )
        row.fuelAdvanceAmount += amount(fuel.amount);
    } else row.pendingCostAmount += amount(fuel.amount);
  }
  for (const repair of repairs) {
    const date = vehicleFinanceDate(repair.occurredAt);
    if (!inTime(date)) continue;
    const row = ensure(date);
    if (["approved", "settled"].includes(repair.status)) {
      if (repair.costCategory === "repair")
        row.repairAmount += amount(repair.amount);
      else row.maintenanceAmount += amount(repair.amount);
      row.sourceCounts.maintenance++;
    } else row.pendingCostAmount += amount(repair.amount);
  }
  for (const purchase of purchases) {
    const date = vehicleFinanceDate(purchase.orderedAt);
    if (!inTime(date)) continue;
    const row = ensure(date);
    if (["confirmed", "received", "closed"].includes(purchase.status)) {
      row.partsAmount += amount(purchase.amount);
      row.sourceCounts.partsPurchase++;
      if (
        purchase.assetDeductionReference &&
        settlements.some(
          s =>
            s.settlementNo === purchase.assetDeductionReference &&
            confirmedSettlement(s)
        )
      )
        row.assetAdvanceAmount += amount(purchase.amount);
    } else row.pendingCostAmount += amount(purchase.amount);
  }
  const ruleCovers = (rule: FinanceLeaseRule, date: string) =>
    vehicleFinanceDate(rule.effectiveFrom) <= date &&
    (!rule.effectiveTo || vehicleFinanceDate(rule.effectiveTo) >= date);
  const leaseSettlements = settlements.filter(
    s => s.settlementKind === "lease"
  );
  const coveringSettlement = (date: string) =>
    leaseSettlements.find(
      s =>
        confirmedSettlement(s) &&
        vehicleFinanceDate(s.periodStart) <= date &&
        vehicleFinanceDate(s.periodEnd) >= date
    );
  const ruleFor = (date: string) =>
    rules.find(
      r =>
        ruleCovers(r, date) &&
        (r.status === "active" ||
          Boolean(r.status === "disabled" && r.effectiveTo))
    );
  let estimatePending = rules.some(
    r =>
      r.status === "disabled" &&
      !r.effectiveTo &&
      vehicleFinanceDate(r.effectiveFrom) < cutoff
  );
  // DATE-only iteration makes partial month coverage, leap days and server TZ irrelevant.
  const first = rules
    .map(r => vehicleFinanceDate(r.effectiveFrom))
    .filter(d => d && d < cutoff)
    .sort()[0];
  if (first)
    for (let date = first; date < cutoff; date = nextVehicleFinanceDate(date)) {
      const rule = ruleFor(date);
      if (!rule || rule.status !== "active") continue;
      if (rule.billingType === "monthly") {
        const row = ensure(date);
        row.leaseEstimatedAmount += amount(rule.rate) / 30;
        if (!coveringSettlement(date))
          row.unconfirmedLeaseEstimateAmount += amount(rule.rate) / 30;
      } else if (
        date.startsWith(period) &&
        !usage.some(
          u =>
            vehicleFinanceDate(u.usageDate) === date &&
            u.usageType === rule.billingType
        ) &&
        !coveringSettlement(date)
      )
        estimatePending = true;
    }
  for (const u of usage) {
    const date = vehicleFinanceDate(u.usageDate);
    if (!inTime(date)) continue;
    const rule = ruleFor(date);
    if (!rule || rule.billingType !== u.usageType) {
      if (date.startsWith(period)) estimatePending = true;
      continue;
    }
    const row = ensure(date);
    row.sourceCounts.leaseUsage++;
    row.leaseEstimatedAmount += amount(u.quantity) * amount(rule.rate);
    if (
      !coveringSettlement(date) &&
      !settlements.some(s => s.id === u.settlementId && confirmedSettlement(s))
    )
      row.unconfirmedLeaseEstimateAmount +=
        amount(u.quantity) * amount(rule.rate);
  }
  // Distribute immutable lease snapshot cents across its actual period. Month/daily totals sum exactly; never reprice historical settlements.
  for (const s of leaseSettlements) {
    const start = vehicleFinanceDate(s.periodStart),
      end = vehicleFinanceDate(s.periodEnd);
    if (!start || !end || end < start) continue;
    const count =
      Math.floor(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86400000
      ) + 1;
    const cents = Math.round(amount(s.grossFreightAmount) * 100),
      base = Math.trunc(cents / count),
      remainder = cents - base * count;
    let i = 0;
    for (
      let date = start;
      date <= end && date < cutoff;
      date = nextVehicleFinanceDate(date), i++
    ) {
      const allocated =
        (base + (i < Math.abs(remainder) ? Math.sign(remainder) : 0)) / 100;
      const row = ensure(date);
      if (confirmedSettlement(s)) row.confirmedLeaseAmount += allocated;
      else row.pendingLeaseAmount += allocated;
    }
  }
  const effectiveSettlements = settlements.filter(
    s => vehicleFinanceDate(s.periodEnd) < cutoff
  );
  const paymentSettlements = settlements.filter(
    s => s.vehicleId === vehicle.id
  );
  const payments = scoped(sources.payments).filter(
    p =>
      p.settlementType === "transport_vehicle" &&
      p.status === "active" &&
      ["expense", "income"].includes(p.direction) &&
      amount(p.amount) > 0 &&
      paymentSettlements.some(s => s.id === p.settlementId) &&
      vehicleFinanceDate(p.paymentDate) < cutoff
  );
  const offsets = scoped(sources.offsets).filter(
    o => o.vehicleId === vehicle.id && inTime(vehicleFinanceDate(o.createdAt))
  );
  const validOffsets = sumConfirmedCarryForwardOffsets(
    offsets.map(o => ({ ...o, amount: String(o.amount ?? 0) })),
    effectiveSettlements.map(s => ({
      ...s,
      netPayableAmount: String(s.netPayableAmount ?? 0),
    }))
  );
  for (const s of effectiveSettlements) {
    if (!confirmedSettlement(s)) continue;
    // Liability belongs to settlement period end; cash belongs to actual payment business date.
    const row = ensure(vehicleFinanceDate(s.periodEnd));
    const net = amount(s.netPayableAmount);
    row.confirmedOwnerPayableAmount += net;
    const paid = payments
      .filter(p => p.settlementId === s.id && p.direction === "expense")
      .reduce((n, p) => n + amount(p.amount), 0);
    const received = payments
      .filter(p => p.settlementId === s.id && p.direction === "income")
      .reduce((n, p) => n + amount(p.amount), 0);
    const recovered = validOffsets.get(s.id) ?? 0;
    row.recoveredOffsetAmount += recovered;
    if (net >= 0) row.remainingPayableAmount += Math.max(0, net - paid);
    else
      row.remainingReceivableAmount += Math.max(0, -net - received - recovered);
  }
  for (const p of payments) {
    const row = ensure(vehicleFinanceDate(p.paymentDate));
    if (p.direction === "expense") row.actualPaidAmount += amount(p.amount);
    else row.actualReceivedAmount += amount(p.amount);
  }
  const aggregates = Array.from(dailyMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const currentRows = aggregates.filter(r => r.date.startsWith(`${period}-`));
  const monthlyKeys = Array.from(
    new Set(aggregates.map(r => r.date.slice(0, 7)))
  )
    .sort()
    .reverse();
  const leaseRule = rules.find(
    r =>
      vehicleFinanceDate(r.effectiveFrom) < cutoff &&
      (!r.effectiveTo || vehicleFinanceDate(r.effectiveTo) >= `${period}-01`)
  );
  return {
    summary: decorate(combine(currentRows, period), nature, estimatePending),
    cumulative: decorate(combine(aggregates, "累计"), nature, estimatePending),
    daily: currentRows.map(r => decorate(r, nature, estimatePending)),
    monthly: monthlyKeys.map(m =>
      decorate(
        combine(
          aggregates.filter(r => r.date.startsWith(`${m}-`)),
          m
        ),
        nature,
        estimatePending
      )
    ),
    leaseRule: leaseRule
      ? {
          billingType: leaseRule.billingType,
          rate: amount(leaseRule.rate),
          effectiveFrom: leaseRule.effectiveFrom,
          effectiveTo: leaseRule.effectiveTo,
          estimatePending,
          status: leaseRule.status,
        }
      : null,
  };
}
