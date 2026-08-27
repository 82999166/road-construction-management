import { describe, expect, it } from "vitest";
import { summarizeDieselLedgerRecords } from "./dieselLedgerSummary";

describe("柴油当前筛选汇总", () => {
  it("仅汇总当前筛选内的有效明细，作废记录仍可展示但不计入金额、油量和扣款", () => {
    const summary = summarizeDieselLedgerRecords([
      { id: 1, assetType: "vehicle", supplyMethod: "project_supply", liters: "40.5", amount: "324.00", deductFromFreight: true, status: "approved" },
      { id: 2, assetType: "machine", supplyMethod: "external_station", liters: 30, amount: 255, deductFromFreight: false, status: "approved" },
      { id: 3, assetType: "vehicle", supplyMethod: "project_supply", liters: 99, amount: 792, deductFromFreight: true, status: "void" },
    ]);

    expect(summary).toMatchObject({
      displayedRecordCount: 3,
      effectiveRecordCount: 2,
      totalLiters: 70.5,
      totalAmount: 579,
      projectSupplyLiters: 40.5,
      stationLiters: 30,
      vehicleLiters: 40.5,
      machineLiters: 30,
      deductibleAmount: 324,
    });
  });
});
