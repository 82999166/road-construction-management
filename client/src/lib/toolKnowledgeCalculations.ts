export type ConcreteStrengthGrade = "C20" | "C30" | "C35" | "C40" | "C50" | "C60";

export type ConcreteMixReference = {
  grade: ConcreteStrengthGrade;
  cementKg: number;
  mineralAdmixtureKg: number;
  sandKg: number;
  stoneKg: number;
  waterKg: number;
  chemicalAdmixtureKg: number;
  note: string;
};

/**
 * 默认值仅用于材料计划估算，所有数值均允许被项目试验室通知单覆盖。
 * C20/C30 采用公开常用等级每立方米参考用量；C35 及以上作为高强混凝土
 * 试配前的可编辑计划起点，绝不能用于直接下料或质量验收。
 */
export const CONCRETE_MIX_REFERENCES: Record<ConcreteStrengthGrade, ConcreteMixReference> = {
  C20: { grade: "C20", cementKg: 343, mineralAdmixtureKg: 0, sandKg: 621, stoneKg: 1261, waterKg: 175, chemicalAdmixtureKg: 0, note: "公开常用等级参考；粗砂、卵石、31.5 mm、坍落度 35—50 mm 条件下的示例。" },
  C30: { grade: "C30", cementKg: 461, mineralAdmixtureKg: 0, sandKg: 512, stoneKg: 1252, waterKg: 175, chemicalAdmixtureKg: 0, note: "公开常用等级参考；需按实际水泥、砂石与坍落度重新试配。" },
  C35: { grade: "C35", cementKg: 470, mineralAdmixtureKg: 0, sandKg: 500, stoneKg: 1230, waterKg: 170, chemicalAdmixtureKg: 5, note: "高强计划估算起点；必须以项目试验室配合比通知单为准。" },
  C40: { grade: "C40", cementKg: 520, mineralAdmixtureKg: 0, sandKg: 525, stoneKg: 1220, waterKg: 178, chemicalAdmixtureKg: 6, note: "高强计划估算起点；必须以项目试验室配合比通知单为准。" },
  C50: { grade: "C50", cementKg: 540, mineralAdmixtureKg: 20, sandKg: 510, stoneKg: 1180, waterKg: 165, chemicalAdmixtureKg: 8, note: "高强计划估算起点；需复核骨料级配、减水剂和耐久性要求。" },
  C60: { grade: "C60", cementKg: 520, mineralAdmixtureKg: 80, sandKg: 680, stoneKg: 1050, waterKg: 160, chemicalAdmixtureKg: 12, note: "高强混凝土；规程要求经试验确定，不得直接用于生产。" },
};

export type ConcreteMaterialTotals = ConcreteMixReference & {
  volumeM3: number;
  totalMassKg: number;
};

export function calculateConcreteMaterialTotals(reference: ConcreteMixReference, volumeM3: number): ConcreteMaterialTotals {
  const safeVolume = Number.isFinite(volumeM3) && volumeM3 > 0 ? volumeM3 : 0;
  return {
    ...reference,
    volumeM3: safeVolume,
    cementKg: reference.cementKg * safeVolume,
    mineralAdmixtureKg: reference.mineralAdmixtureKg * safeVolume,
    sandKg: reference.sandKg * safeVolume,
    stoneKg: reference.stoneKg * safeVolume,
    waterKg: reference.waterKg * safeVolume,
    chemicalAdmixtureKg: reference.chemicalAdmixtureKg * safeVolume,
    totalMassKg: (reference.cementKg + reference.mineralAdmixtureKg + reference.sandKg + reference.stoneKg + reference.waterKg + reference.chemicalAdmixtureKg) * safeVolume,
  };
}

export type VatProfitInput = {
  materialGrossUnitPrice: number;
  materialVatRatePercent: number;
  freightGrossUnitPrice: number;
  freightVatRatePercent: number;
  otherNetUnitCost: number;
  saleGrossUnitPrice: number;
  outputVatRatePercent: number;
  surchargeRatePercent: number;
  incomeTaxRatePercent: number;
};

export type VatProfitResult = {
  saleNetUnitPrice: number;
  materialNetUnitCost: number;
  freightNetUnitCost: number;
  outputVat: number;
  deductibleInputVat: number;
  vatPayable: number;
  vatCredit: number;
  preTaxOperatingProfit: number;
  surchargeTax: number;
  incomeTax: number;
  profitAfterVatAndSurcharge: number;
  profitAfterIncomeTax: number;
  profitMarginPercent: number;
};

function nonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function grossToNet(gross: number, ratePercent: number) {
  return nonNegative(gross) / (1 + nonNegative(ratePercent) / 100);
}

/**
 * 简化单位口径：其他成本要求输入未税且不可抵扣金额；不判断票据合规、留抵、
 * 简易计税或税收优惠。所有金额均为每吨（或用户选择的统一计量单位）。
 */
export function calculateVatProfit(input: VatProfitInput): VatProfitResult {
  const saleNetUnitPrice = grossToNet(input.saleGrossUnitPrice, input.outputVatRatePercent);
  const materialNetUnitCost = grossToNet(input.materialGrossUnitPrice, input.materialVatRatePercent);
  const freightNetUnitCost = grossToNet(input.freightGrossUnitPrice, input.freightVatRatePercent);
  const outputVat = nonNegative(input.saleGrossUnitPrice) - saleNetUnitPrice;
  const deductibleInputVat = (nonNegative(input.materialGrossUnitPrice) - materialNetUnitCost) + (nonNegative(input.freightGrossUnitPrice) - freightNetUnitCost);
  const vatPayable = Math.max(0, outputVat - deductibleInputVat);
  const vatCredit = Math.max(0, deductibleInputVat - outputVat);
  const preTaxOperatingProfit = saleNetUnitPrice - materialNetUnitCost - freightNetUnitCost - nonNegative(input.otherNetUnitCost);
  const surchargeTax = vatPayable * nonNegative(input.surchargeRatePercent) / 100;
  const profitAfterVatAndSurcharge = preTaxOperatingProfit - surchargeTax;
  const incomeTax = Math.max(0, profitAfterVatAndSurcharge) * nonNegative(input.incomeTaxRatePercent) / 100;
  const profitAfterIncomeTax = profitAfterVatAndSurcharge - incomeTax;
  return {
    saleNetUnitPrice,
    materialNetUnitCost,
    freightNetUnitCost,
    outputVat,
    deductibleInputVat,
    vatPayable,
    vatCredit,
    preTaxOperatingProfit,
    surchargeTax,
    incomeTax,
    profitAfterVatAndSurcharge,
    profitAfterIncomeTax,
    profitMarginPercent: saleNetUnitPrice > 0 ? profitAfterIncomeTax / saleNetUnitPrice * 100 : 0,
  };
}
