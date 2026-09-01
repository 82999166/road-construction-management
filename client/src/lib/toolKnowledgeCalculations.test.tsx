import { describe, expect, it } from "vitest";
import { CONCRETE_MIX_REFERENCES, calculateConcreteMaterialTotals, calculateVatProfit } from "./toolKnowledgeCalculations";

describe("工具知识计算口径", () => {
  it("按选定的 C20 可编辑基准计算方量材料总重量", () => {
    const result = calculateConcreteMaterialTotals(CONCRETE_MIX_REFERENCES.C20, 2.5);
    expect(result.cementKg).toBe(857.5);
    expect(result.sandKg).toBe(1552.5);
    expect(result.stoneKg).toBe(3152.5);
    expect(result.waterKg).toBe(437.5);
    expect(result.totalMassKg).toBe(6000);
  });

  it("将含税采购、运费和销售价拆分为未税经营利润与增值税", () => {
    const result = calculateVatProfit({
      materialGrossUnitPrice: 30,
      materialVatRatePercent: 13,
      freightGrossUnitPrice: 15,
      freightVatRatePercent: 9,
      otherNetUnitCost: 0,
      saleGrossUnitPrice: 55,
      outputVatRatePercent: 13,
      surchargeRatePercent: 0,
      incomeTaxRatePercent: 0,
    });
    expect(result.saleNetUnitPrice).toBeCloseTo(48.67256637, 7);
    expect(result.deductibleInputVat).toBeCloseTo(4.68986, 5);
    expect(result.vatPayable).toBeCloseTo(1.63757, 5);
    expect(result.preTaxOperatingProfit).toBeCloseTo(8.36243, 5);
    expect(result.profitAfterIncomeTax).toBeCloseTo(8.36243, 5);
  });
});
