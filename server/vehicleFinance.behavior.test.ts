import { describe, expect, it } from "vitest";
import {
  emptyVehicleFinanceSources,
  projectVehicleFinance,
  vehicleFinanceDate,
  type FinanceFuel,
  type FinanceLeaseRule,
  type FinancePurchase,
  type FinanceSettlement,
  type FinanceTrip,
  type VehicleFinanceSources,
} from "./services/vehicleFinance";
import { buildTransportSettlementBasis } from "./services/transportSettlementBasis";
import { buildValidVehicleCarryForwardTotals, sumConfirmedCarryForwardOffsets } from "./services/settlementPayments";

// Local, deterministic inputs only: no routers, getDb(), network, or production fixtures.
const vehicle = { id: 7, projectId: 11, ownership: "trip_settlement" };
const trip = (overrides: Partial<FinanceTrip> = {}): FinanceTrip => ({
  id: 1, vehicleId: 7, projectId: 11, status: "verified", startAt: "2026-11-04T01:00:00Z",
  tripNo: "T-1", calculatedAmount: "1000", netSettlementAmount: null, actualDistanceKm: "20", ...overrides,
});
const fuel = (overrides: Partial<FinanceFuel> = {}): FinanceFuel => ({
  id: 2, vehicleId: 7, projectId: 11, assetType: "vehicle", status: "settled",
  refueledAt: "2026-11-04T01:00:00Z", amount: "200", liters: "25", deductFromFreight: true, ...overrides,
});
const purchase = (overrides: Partial<FinancePurchase> = {}): FinancePurchase => ({
  id: 3, assetId: 7, projectId: 11, assetType: "vehicle", status: "received",
  orderedAt: "2026-11-04T01:00:00Z", amount: "100", assetDeductionReference: "S-1", ...overrides,
});
const settlement = (overrides: Partial<FinanceSettlement> = {}): FinanceSettlement => ({
  id: 4, settlementNo: "S-1", vehicleId: 7, projectId: 11, status: "approved", settlementKind: "trip",
  periodStart: "2026-11-01", periodEnd: "2026-11-04", grossFreightAmount: "1000",
  netPayableAmount: "700", fuelDeductionAmount: "200", assetDeductionAmount: "100", ...overrides,
});
const rule = (overrides: Partial<FinanceLeaseRule> = {}): FinanceLeaseRule => ({
  id: 5, vehicleId: 7, projectId: 11, status: "active", billingType: "monthly", rate: "3000",
  effectiveFrom: "2026-11-01", effectiveTo: "2026-11-30", updatedAt: "2026-11-01T00:00:00Z", ...overrides,
});
const sources = (overrides: Partial<VehicleFinanceSources> = {}): VehicleFinanceSources => ({ ...emptyVehicleFinanceSources(), ...overrides });
const project = (overrides: Partial<VehicleFinanceSources> = {}, ownership = "trip_settlement", period = "2026-11") =>
  projectVehicleFinance({ ...vehicle, ownership }, 11, period, sources(overrides));
const basisTrip = (id: number, gross: number, status = "verified") => ({
  id, status, startAt: new Date("2026-11-03T17:00:00Z"), calculatedAmount: gross,
  fuelDeductionAmount: 0, netSettlementAmount: null, volumeCubicMeters: 10,
});

describe("vehicle finance: confirmed transport versus unresolved business facts", () => {
  it("submitted stays pending; void disappears; project, vehicle, and asset scopes remain isolated", () => {
    const result = project({
      trips: [trip(), trip({ id: 2, status: "submitted", calculatedAmount: "80" }), trip({ id: 3, status: "void" }), trip({ id: 4, projectId: 99 }), trip({ id: 5, vehicleId: 99 })],
      refuels: [fuel({ deductFromFreight: false }), fuel({ id: 9, assetType: "machine" }), fuel({ id: 10, projectId: 99 })],
      purchases: [purchase({ assetId: 99 }), purchase({ projectId: 99 })],
    });
    expect(result.summary).toMatchObject({ tripCount: 2, confirmedTripCount: 1, pendingTripCount: 1, confirmedTransportAmount: 1000, pendingTransportAmount: 80, fuelAmount: 200, partsAmount: 0 });
  });

  it("a persisted verified label must not confirm an unresolved exception", () => {
    const unresolved = { ...trip(), exceptionStatus: "open" };
    const result = project({ trips: [unresolved] });
    expect(result.summary).toMatchObject({ confirmedTripCount: 0, confirmedTransportAmount: 0, pendingTripCount: 1, pendingTransportAmount: 1000 });
  });

  it("settlement basis rejects non-verified/non-settled candidates instead of allocating pooled fuel to them", () => {
    expect(() => buildTransportSettlementBasis(
      [basisTrip(1, 100, "submitted"), basisTrip(2, 50)],
      [{ id: 6, transportTripId: null, amount: 100 }],
    )).toThrow();
  });

  it("normal verified fuel pooling conserves all money, including negative owner payable", () => {
    const result = buildTransportSettlementBasis([basisTrip(1, 100), basisTrip(2, 50)], [
      { id: 5, transportTripId: 1, amount: 20 }, { id: 6, transportTripId: null, amount: 160 }, { id: 7, transportTripId: 99, amount: 999 },
    ]);
    expect(result.consumedFuelIds).toEqual([5, 6]);
    expect(result.details.map(row => row.netPayableAmount)).toEqual([0, -30]);
    expect(result.details.reduce((sum, row) => sum + row.fuelDeductionAmount, 0)).toBe(180);
    expect(result.details[0].tripDate).toBe("2026-11-04");
  });

  it("historical settled snapshots retain fuel and net, and consume no new pooled fuel", () => {
    const result = buildTransportSettlementBasis([{ ...basisTrip(1, 100, "settled"), fuelDeductionAmount: 45, netSettlementAmount: 55 }], [{ id: 6, transportTripId: null, amount: 88 }]);
    expect(result.details[0]).toMatchObject({ grossFreightAmount: 100, fuelDeductionAmount: 45, netPayableAmount: 55 });
    expect(result.consumedFuelIds).toEqual([]);
  });
});

describe("vehicle finance: owner advances are not duplicate company costs", () => {
  it("1000 gross minus 200 fuel and 100 parts yields 700 owner payable but 1000 outsourced cost, not 1300", () => {
    const result = project({ trips: [trip({ status: "settled", netSettlementAmount: "800" })], refuels: [fuel()], purchases: [purchase()], settlements: [settlement()] });
    expect(result.summary).toMatchObject({ confirmedTransportAmount: 1000, fuelAdvanceAmount: 200, assetAdvanceAmount: 100, confirmedOwnerPayableAmount: 700, remainingPayableAmount: 700, outsourcedTransportCostAmount: 1000 });
    expect(result.summary.operatingContributionAmount).toBeNull();
  });

  it.each(["draft", "submitted"] as const)("%s reservation cannot become a confirmed fuel/parts recovery", status => {
    const result = project({ trips: [trip()], refuels: [fuel()], purchases: [purchase()], settlements: [settlement({ status })] });
    expect(result.summary).toMatchObject({ fuelAdvanceAmount: 0, assetAdvanceAmount: 0, confirmedOwnerPayableAmount: 0, outsourcedTransportCostAmount: 1300 });
  });

  it("non-deductible fuel and an unrelated purchase reference remain extra company costs", () => {
    const result = project({ trips: [trip()], refuels: [fuel({ deductFromFreight: false })], purchases: [purchase({ assetDeductionReference: "UNKNOWN" })], settlements: [settlement()] });
    expect(result.summary).toMatchObject({ fuelAdvanceAmount: 0, assetAdvanceAmount: 0, outsourcedTransportCostAmount: 1300 });
  });
});

describe("vehicle finance: lease estimates versus immutable approved statements", () => {
  it("month rent follows original rate × covered calendar days ÷ 30, including leap-day partial coverage", () => {
    const result = project({ leaseRules: [rule({ rate: "3000", effectiveFrom: "2024-02-10", effectiveTo: "2024-02-29" })] }, "leased", "2024-02");
    expect(result.summary).toMatchObject({ leaseEstimatedAmount: 2000, unconfirmedLeaseEstimateAmount: 2000, confirmedLeaseAmount: 0, leasedCostAmount: 2000 });
  });

  it("new 3000 contract estimate cannot reprice the old confirmed 900 lease snapshot", () => {
    const result = project({ leaseRules: [rule()], settlements: [settlement({ settlementKind: "lease", periodEnd: "2026-11-30", grossFreightAmount: "900", netPayableAmount: "900", fuelDeductionAmount: "0", assetDeductionAmount: "0" })] }, "leased");
    expect(result.summary).toMatchObject({ leaseEstimatedAmount: 3000, unconfirmedLeaseEstimateAmount: 0, confirmedLeaseAmount: 900, coveredCostAmount: 900, leasedCostAmount: 900 });
    expect(result.daily.reduce((sum, row) => sum + Math.round(row.confirmedLeaseAmount * 100), 0)).toBe(90000);
  });

  it("a draft lease cannot erase the unconfirmed contractual estimate before approval", () => {
    const result = project({ leaseRules: [rule()], settlements: [settlement({ status: "draft", settlementKind: "lease", periodEnd: "2026-11-30", grossFreightAmount: "900", netPayableAmount: "900" })] }, "leased");
    expect(result.summary).toMatchObject({ confirmedLeaseAmount: 0, pendingLeaseAmount: 900, unconfirmedLeaseEstimateAmount: 3000, leasedCostAmount: 3000 });
  });

  it("disabled open-ended contract does not generate future-month estimates, but confirmed history remains", () => {
    const disabled = rule({ status: "disabled", effectiveFrom: "2026-10-01", effectiveTo: null, updatedAt: "2026-10-31T04:00:00Z" });
    const oldStatement = settlement({ settlementKind: "lease", periodStart: "2026-10-01", periodEnd: "2026-10-30", grossFreightAmount: "600", netPayableAmount: "600" });
    const result = project({ leaseRules: [disabled], settlements: [oldStatement] }, "leased");
    expect(result.summary).toMatchObject({ leaseEstimatedAmount: 0, unconfirmedLeaseEstimateAmount: 0, confirmedLeaseAmount: 0 });
    expect(result.cumulative.confirmedLeaseAmount).toBe(600);
  });

  it("daily usage is counted once at quantity × rate and not again over the confirmed lease period", () => {
    const result = project({
      leaseRules: [rule({ billingType: "daily", rate: "300", effectiveFrom: "2026-11-04", effectiveTo: "2026-11-04" })],
      usage: [{ id: 6, vehicleId: 7, projectId: 11, status: "confirmed", usageDate: "2026-11-04", usageType: "daily", quantity: "2", settlementId: 4 }],
      settlements: [settlement({ settlementKind: "lease", periodStart: "2026-11-04", periodEnd: "2026-11-04", grossFreightAmount: "500", netPayableAmount: "500" })],
    }, "leased");
    expect(result.summary).toMatchObject({ leaseEstimatedAmount: 600, unconfirmedLeaseEstimateAmount: 0, confirmedLeaseAmount: 500, leasedCostAmount: 500 });
  });
});

describe("vehicle finance: only explicit, valid cash and confirmed offsets recover debt", () => {
  it("a legacy paid label is not an actual payment; cash belongs to its actual business month", () => {
    const oldStatement = settlement({ status: "paid", periodStart: "2026-10-01", periodEnd: "2026-10-31", netPayableAmount: "700" });
    const noFacts = project({ settlements: [oldStatement] });
    expect(noFacts.cumulative).toMatchObject({ actualPaidAmount: 0, remainingPayableAmount: 700 });
    const result = project({ settlements: [oldStatement], payments: [{ settlementId: 4, projectId: 11, settlementType: "transport_vehicle", status: "active", direction: "expense", amount: "200", paymentDate: "2026-11-04" }] });
    expect(result.summary.actualPaidAmount).toBe(200);
    expect(result.monthly.find(row => row.date === "2026-10")!.actualPaidAmount).toBe(0);
    expect(result.cumulative.remainingPayableAmount).toBe(500);
  });

  it("negative, non-finite, reversed, other-project and other-settlement-type records cannot distort actual cash", () => {
    const valid = { settlementId: 4, projectId: 11, settlementType: "transport_vehicle", status: "active", direction: "expense", amount: "50", paymentDate: "2026-11-04" };
    const result = project({ settlements: [settlement()], payments: [valid, { ...valid, amount: "-25" }, { ...valid, amount: "NaN" }, { ...valid, status: "reversed", amount: "999" }, { ...valid, projectId: 99, amount: "999" }, { ...valid, settlementType: "machine", amount: "999" }] });
    expect(result.summary).toMatchObject({ actualPaidAmount: 50, remainingPayableAmount: 650 });
  });

  it("active confirmed carry-forward records require the same vehicle/project, non-void ends and positive money", () => {
    const source = settlement({ id: 1, status: "receivable", netPayableAmount: "-300" });
    const target = settlement({ id: 2 });
    const offset = { sourceSettlementId: 1, targetSettlementId: 2, vehicleId: 7, amount: "120", status: "active" as const };
    expect(buildValidVehicleCarryForwardTotals([offset], [source, target]).get(1)).toBe(120);
    for (const invalidTarget of [{ ...target, status: "void" as const }, { ...target, projectId: 99 }, { ...target, vehicleId: 99 }]) {
      expect(buildValidVehicleCarryForwardTotals([offset], [source, invalidTarget]).size).toBe(0);
    }
    expect(buildValidVehicleCarryForwardTotals([{ ...offset, status: "reversed" }], [source, target]).size).toBe(0);
  });

  it.each(["draft", "submitted"] as const)("an active reservation into a %s target is not recovered debt", status => {
    const source = settlement({ id: 1, status: "receivable", netPayableAmount: "-300" });
    const target = settlement({ id: 2, status });
    const offsets = [{ sourceSettlementId: 1, targetSettlementId: 2, vehicleId: 7, amount: "120", status: "active" as const }];
    expect(sumConfirmedCarryForwardOffsets(offsets, [source, target]).get(1) ?? 0).toBe(0);
  });

  it("timestamps use China dates without converting SQL DATE calendar values", () => {
    expect(vehicleFinanceDate("2026-11-03T17:00:00Z")).toBe("2026-11-04");
    expect(vehicleFinanceDate("2026-11-03")).toBe("2026-11-03");
  });
});

describe("vehicle finance: cash attribution and exact historical snapshot cents", () => {
  it("actual cash cannot disappear merely because an approved settlement period ends after the reporting cutoff", () => {
    const laterPeriod = settlement({ periodStart: "2026-10-01", periodEnd: "2026-11-30", netPayableAmount: "700" });
    const result = project({ settlements: [laterPeriod], payments: [{ settlementId: 4, projectId: 11, settlementType: "transport_vehicle", status: "active", direction: "expense", amount: "200", paymentDate: "2026-10-31" }] }, "trip_settlement", "2026-10");
    expect(result.summary.actualPaidAmount).toBe(200);
  });

  it("a 1000.01 approved lease snapshot split over three days and two months preserves every cent", () => {
    const confirmed = settlement({ settlementKind: "lease", periodStart: "2026-10-31", periodEnd: "2026-11-02", grossFreightAmount: "1000.01", netPayableAmount: "1000.01" });
    const result = project({ leaseRules: [rule({ rate: "9999", effectiveFrom: "2026-10-31", effectiveTo: "2026-11-02" })], settlements: [confirmed] }, "leased");
    expect(result.cumulative.confirmedLeaseAmount).toBe(1000.01);
    expect(result.monthly.find(row => row.date === "2026-10")!.confirmedLeaseAmount).toBe(333.34);
    expect(result.summary.confirmedLeaseAmount).toBe(666.67);
    expect(result.daily.map(row => row.confirmedLeaseAmount).sort()).toEqual([333.33, 333.34]);
    expect(result.cumulative.unconfirmedLeaseEstimateAmount).toBe(0);
  });
});
