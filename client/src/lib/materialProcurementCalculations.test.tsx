import { describe, expect, it } from "vitest";
import { calculateMaterialProcurement, calculateVatProfit, MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS, type MaterialProcurementInput } from "./toolKnowledgeCalculations";

const baseInput: MaterialProcurementInput = {
  materialName: "机制砂",
  materialSpecification: "2 区中砂",
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
  transportMode: "road",
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
  resourceTaxRatePercent: 0,
  environmentalTaxPerUnit: 0,
  profitMode: "direct",
  targetProfitMarginPercent: 15,
  markupPerUnit: 8,
  saleGrossUnitPrice: 55,
  settlementTemplate: "inquiry",
  customFirstPaymentPercent: 60,
  customSecondPaymentPercent: 35,
  customFinalPaymentDelayMonths: 12,
  supplyMonths: 3,
  fundingRatePercentPerYear: 6,
  rollingMonthlyPayRatioPercent: 80,
  rollingFinalPayoffMode: "installment",
  rollingFinalPayoffMonths: 3,
  billPaymentPercent: 30,
  billTermMonths: 6,
  backToBackDelayMonths: 0,
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

  it("完整拆解材料和运费成本，并将每一项计入总成本", () => {
    const result = calculateMaterialProcurement({ ...baseInput, lossRatePercent: 2, loadingFeePerUnit: 1, storageFeePerUnitDay: 0.5, storageDays: 2, otherDirectCostPerUnit: 3, loadingFeePerFreightUnit: 1, unloadingFeePerFreightUnit: 2, tollFeePerVehicle: 50, fuelSurchargePerUnitKm: 0.1 });
    expect(result.materialCostBreakdown.lossCost).toBeCloseTo(result.purchaseNetTotal * 0.02, 6);
    expect(result.materialCostBreakdown.loadingCost).toBe(100);
    expect(result.materialCostBreakdown.storageCost).toBe(100);
    expect(result.materialCostBreakdown.otherDirectCost).toBe(300);
    expect(result.freightCostBreakdown.vehicleTrips).toBe(4);
    expect(result.freightCostBreakdown.tollTotal).toBe(200);
    expect(result.freightCostBreakdown.loadingUnloadingTotal).toBe(300);
    expect(result.freightCostBreakdown.fuelSurchargeTotal).toBeCloseTo(300, 6);
    expect(result.totalCostNet).toBeCloseTo(result.materialCostBreakdown.materialSubtotalNet + result.freightNetTotal, 6);
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
    expect(result.monthlySettlementSchedule).toHaveLength(39);
    expect(result.monthlySettlementSchedule[0]?.monthlySettlement).toBeCloseTo(result.totalSalesGross / 3, 6);
  });

  it("提供 9 种业务结算预设和自定义方式，并确保非滚动模板的回款总额等于含税报价总额", () => {
    expect(MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS).toHaveLength(10);
    for (const template of MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS) {
      const result = calculateMaterialProcurement({ ...baseInput, settlementTemplate: template.value });
      const collected = result.settlementSchedule.reduce((sum, line) => sum + line.amount, 0);
      expect(collected).toBeCloseTo(result.totalSalesGross, 6);
      expect(result.monthlySettlementSchedule.length).toBeGreaterThanOrEqual(baseInput.supplyMonths);
    }
  });

  it("按连续供货月数生成滚动累计月结、未结滚入和末次结余付款", () => {
    const result = calculateMaterialProcurement({ ...baseInput, quantity: 1200, supplyMonths: 12, settlementTemplate: "rolling_monthly", rollingMonthlyPayRatioPercent: 80, rollingFinalPayoffMode: "installment", rollingFinalPayoffMonths: 3 });
    const first = result.monthlySettlementSchedule[0];
    const second = result.monthlySettlementSchedule[1];
    expect(first?.currentPayment).toBeCloseTo(first!.paymentBase * 0.8, 6);
    expect(first?.unpaidCarryOver).toBeCloseTo(first!.paymentBase * 0.2, 6);
    expect(second?.previousOutstanding).toBeCloseTo(first!.unpaidCarryOver, 6);
    expect(result.monthlySettlementSchedule).toHaveLength(15);
    expect(result.monthlySettlementSchedule.at(-1)?.accountsReceivable).toBeCloseTo(0, 6);
    expect(result.settlementSchedule.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(result.totalSalesGross, 6);
  });

  it("保留原含税利润函数的兼容结果", () => {
    const result = calculateVatProfit({ materialGrossUnitPrice: 30, materialVatRatePercent: 13, freightGrossUnitPrice: 15, freightVatRatePercent: 9, otherNetUnitCost: 0, saleGrossUnitPrice: 55, outputVatRatePercent: 13, surchargeRatePercent: 0, incomeTaxRatePercent: 0 });
    expect(result.saleNetUnitPrice).toBeCloseTo(55 / 1.13, 6);
    expect(result.materialNetUnitCost).toBeCloseTo(30 / 1.13, 6);
    expect(result.freightNetUnitCost).toBeCloseTo(15 / 1.09, 6);
  });
});
