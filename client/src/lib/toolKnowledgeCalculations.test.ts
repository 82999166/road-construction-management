import { describe, expect, it } from "vitest";
import { calculateMaterialProcurement, calculateVatProfit, type MaterialProcurementInput } from "./toolKnowledgeCalculations";

const baseInput: MaterialProcurementInput = {
  materialName: "机制砂",
  unit: "吨",
  quantity: 100,
  purchaseUnitPrice: 30,
  purchasePriceIncludesVat: true,
  purchaseVatRatePercent: 13,
  lossRatePercent: 0,
  loadingFeePerUnit: 0,
  storageFeePerUnitDay: 0,
  storageDays: 0,
  otherDirectCostPerUnit: 0,
  freightUnitPricePerUnitKm: 0.5,
  distanceKm: 30,
  freightQuantity: 100,
  vehicleLoad: 30,
  startPricePerVehicle: 0,
  loadingFeePerFreightUnit: 0,
  unloadingFeePerFreightUnit: 0,
  tollFeePerVehicle: 0,
  fuelSurchargePerUnitKm: 0,
  freightPriceIncludesVat: true,
  freightVatRatePercent: 9,
  outputVatRatePercent: 13,
  surchargeRatePercent: 0,
  incomeTaxRatePercent: 0,
  stampTaxRatePercent: 0.03,
  profitMode: "direct",
  targetProfitMarginPercent: 15,
  markupPerUnit: 8,
  saleGrossUnitPrice: 55,
  settlementTemplate: "inquiry",
  supplyMonths: 3,
  fundingRatePercentPerYear: 6,
};

describe("材料采购多维度计算", () => {
  it("按材料、运费、税率和售价自动计算单位成本与净利润", () => {
    const result = calculateMaterialProcurement(baseInput);
    expect(result.vehicleTrips).toBe(4);
    expect(result.purchaseNetTotal).toBeCloseTo(30 / 1.13 * 100, 6);
    expect(result.freightGrossTotal).toBeCloseTo(0.5 * 30 * 100, 6);
    expect(result.freightNetTotal).toBeCloseTo(1500 / 1.09, 6);
    expect(result.saleGrossUnitPrice).toBe(55);
    expect(result.totalSalesGross).toBe(5500);
    expect(result.netProfit).toBeGreaterThan(0);
    expect(result.netProfitMarginPercent).toBeGreaterThan(0);
  });

  it("支持按利润率和固定加价反推销售含税单价", () => {
    const marginResult = calculateMaterialProcurement({ ...baseInput, profitMode: "margin", targetProfitMarginPercent: 20 });
    const markupResult = calculateMaterialProcurement({ ...baseInput, profitMode: "markup", markupPerUnit: 8 });
    expect(marginResult.saleGrossUnitPrice).toBeGreaterThan(marginResult.totalCostPerUnit);
    expect(markupResult.saleNetUnitPrice).toBeCloseTo(markupResult.totalCostPerUnit + 8, 6);
    expect(markupResult.saleGrossUnitPrice).toBeGreaterThan(markupResult.saleNetUnitPrice);
  });

  it("生成结算回款、垫资峰值和回本月份，不改变业务台账", () => {
    const result = calculateMaterialProcurement(baseInput);
    expect(result.settlementSchedule).toHaveLength(4);
    expect(result.settlementSchedule.reduce((sum, line) => sum + line.percent, 0)).toBeCloseTo(100, 6);
    expect(result.settlementSchedule.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(result.totalSalesGross, 6);
    expect(result.fundingPeak).toBeGreaterThanOrEqual(0);
    expect(result.estimatedFundingCost).toBeGreaterThanOrEqual(0);
  });

  it("保留原含税利润函数的兼容结果", () => {
    const result = calculateVatProfit({ materialGrossUnitPrice: 30, materialVatRatePercent: 13, freightGrossUnitPrice: 15, freightVatRatePercent: 9, otherNetUnitCost: 0, saleGrossUnitPrice: 55, outputVatRatePercent: 13, surchargeRatePercent: 0, incomeTaxRatePercent: 0 });
    expect(result.saleNetUnitPrice).toBeCloseTo(55 / 1.13, 6);
    expect(result.materialNetUnitCost).toBeCloseTo(30 / 1.13, 6);
    expect(result.freightNetUnitCost).toBeCloseTo(15 / 1.09, 6);
  });
});
