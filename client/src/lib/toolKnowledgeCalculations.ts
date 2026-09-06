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

function positiveOrZero(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function grossToNet(gross: number, ratePercent: number) {
  return nonNegative(gross) / (1 + nonNegative(ratePercent) / 100);
}

/**
 * 简化单位口径：其他成本要求输入未税且不可抵扣金额；不判断票据合规、留抵、
 * 简易计税或税收优惠。所有金额均为每吨（或用户选择的统一计量单位）。
 */
export function calculateVatProfit(input: VatProfitInput): VatProfitResult {
  const material = calculateMaterialProcurement({
    materialName: "材料",
    unit: "吨",
    quantity: 1,
    purchaseUnitPrice: input.materialGrossUnitPrice,
    purchasePriceIncludesVat: true,
    purchaseVatRatePercent: input.materialVatRatePercent,
    lossRatePercent: 0,
    loadingFeePerUnit: 0,
    storageFeePerUnitDay: 0,
    storageDays: 0,
    otherDirectCostPerUnit: input.otherNetUnitCost,
    freightUnitPricePerUnitKm: input.freightGrossUnitPrice,
    distanceKm: 1,
    freightQuantity: 1,
    vehicleLoad: 1,
    startPricePerVehicle: 0,
    loadingFeePerFreightUnit: 0,
    unloadingFeePerFreightUnit: 0,
    tollFeePerVehicle: 0,
    fuelSurchargePerUnitKm: 0,
    freightPriceIncludesVat: true,
    freightVatRatePercent: input.freightVatRatePercent,
    outputVatRatePercent: input.outputVatRatePercent,
    surchargeRatePercent: input.surchargeRatePercent,
    incomeTaxRatePercent: input.incomeTaxRatePercent,
    stampTaxRatePercent: 0,
    profitMode: "direct",
    targetProfitMarginPercent: 0,
    markupPerUnit: 0,
    saleGrossUnitPrice: input.saleGrossUnitPrice,
    settlementTemplate: "cash",
    supplyMonths: 1,
    fundingRatePercentPerYear: 0,
  });
  return {
    saleNetUnitPrice: material.saleNetUnitPrice,
    materialNetUnitCost: material.purchaseNetTotal,
    freightNetUnitCost: material.freightNetTotal,
    outputVat: material.outputVat,
    deductibleInputVat: material.deductibleInputVat,
    vatPayable: material.vatPayable,
    vatCredit: material.vatCredit,
    preTaxOperatingProfit: material.operatingProfitBeforeTax,
    surchargeTax: material.surchargeTax,
    incomeTax: material.incomeTax,
    profitAfterVatAndSurcharge: material.profitAfterSurcharge,
    profitAfterIncomeTax: material.netProfit,
    profitMarginPercent: material.netProfitMarginPercent,
  };
}

export type MaterialProfitMode = "margin" | "markup" | "direct";
export type MaterialSettlementTemplate = "cash" | "inquiry" | "monthly" | "custom";

export type MaterialProcurementInput = {
  materialName: string;
  unit: string;
  quantity: number;
  purchaseUnitPrice: number;
  purchasePriceIncludesVat: boolean;
  purchaseVatRatePercent: number;
  lossRatePercent: number;
  loadingFeePerUnit: number;
  storageFeePerUnitDay: number;
  storageDays: number;
  otherDirectCostPerUnit: number;
  freightUnitPricePerUnitKm: number;
  distanceKm: number;
  freightQuantity: number;
  vehicleLoad: number;
  startPricePerVehicle: number;
  loadingFeePerFreightUnit: number;
  unloadingFeePerFreightUnit: number;
  tollFeePerVehicle: number;
  fuelSurchargePerUnitKm: number;
  freightPriceIncludesVat: boolean;
  freightVatRatePercent: number;
  outputVatRatePercent: number;
  surchargeRatePercent: number;
  incomeTaxRatePercent: number;
  stampTaxRatePercent: number;
  profitMode: MaterialProfitMode;
  targetProfitMarginPercent: number;
  markupPerUnit: number;
  saleGrossUnitPrice: number;
  settlementTemplate: MaterialSettlementTemplate;
  customFirstPaymentPercent?: number;
  customSecondPaymentPercent?: number;
  customFinalPaymentDelayMonths?: number;
  supplyMonths: number;
  fundingRatePercentPerYear: number;
};

export type MaterialSettlementLine = {
  label: string;
  percent: number;
  delayMonths: number;
  amount: number;
  cumulativeAmount: number;
};

export type MaterialProcurementResult = {
  quantity: number;
  vehicleTrips: number;
  purchaseGrossTotal: number;
  purchaseNetTotal: number;
  purchaseInputVat: number;
  lossCost: number;
  loadingCost: number;
  storageCost: number;
  otherDirectCost: number;
  freightGrossTotal: number;
  freightNetTotal: number;
  freightInputVat: number;
  freightTotalPerUnit: number;
  totalCostNet: number;
  totalCostPerUnit: number;
  saleNetUnitPrice: number;
  saleGrossUnitPrice: number;
  totalSalesGross: number;
  totalSalesNet: number;
  outputVat: number;
  deductibleInputVat: number;
  vatPayable: number;
  vatCredit: number;
  operatingProfitBeforeTax: number;
  surchargeTax: number;
  stampTax: number;
  taxableProfit: number;
  incomeTax: number;
  profitAfterSurcharge: number;
  netProfit: number;
  grossMarginPercent: number;
  netProfitMarginPercent: number;
  settlementSchedule: MaterialSettlementLine[];
  fundingPeak: number;
  estimatedFundingCost: number;
  paybackMonth: number | null;
};

const SETTLEMENT_TEMPLATES: Record<MaterialSettlementTemplate, Array<{ label: string; percent: number; delayMonths: number }>> = {
  cash: [{ label: "现款结算", percent: 100, delayMonths: 0 }],
  inquiry: [
    { label: "当期结算 65%", percent: 65, delayMonths: 0 },
    { label: "结算后 6 个月", percent: 15, delayMonths: 6 },
    { label: "结算后 24 个月", percent: 15, delayMonths: 24 },
    { label: "质保金 36 个月", percent: 5, delayMonths: 36 },
  ],
  monthly: [
    { label: "预付款", percent: 10, delayMonths: 0 },
    { label: "月进度款", percent: 80, delayMonths: 1 },
    { label: "竣工结算", percent: 7, delayMonths: 3 },
    { label: "质保金", percent: 3, delayMonths: 36 },
  ],
  custom: [],
};

function buildSettlementTemplate(input: MaterialProcurementInput) {
  if (input.settlementTemplate !== "custom") return SETTLEMENT_TEMPLATES[input.settlementTemplate];
  const first = Math.min(100, nonNegative(input.customFirstPaymentPercent ?? 60));
  const second = Math.min(100 - first, nonNegative(input.customSecondPaymentPercent ?? 35));
  const finalPercent = Math.max(0, 100 - first - second);
  return [
    { label: "首期付款", percent: first, delayMonths: 0 },
    { label: "第二期付款", percent: second, delayMonths: 1 },
    { label: "尾款/质保金", percent: finalPercent, delayMonths: Math.max(0, Math.round(input.customFinalPaymentDelayMonths ?? 12)) },
  ].filter(line => line.percent > 0);
}

/**
 * 材料采购多维度测算：所有结果均由当前输入即时推导，不读写项目业务台账。
 * 采购和运费可选择含税/未税，销售价格支持目标利润率、固定加价、直接设售价三种模式。
 */
export function calculateMaterialProcurement(input: MaterialProcurementInput): MaterialProcurementResult {
  const quantity = nonNegative(input.quantity);
  const purchaseUnitPrice = nonNegative(input.purchaseUnitPrice);
  const purchaseNetUnitPrice = input.purchasePriceIncludesVat ? grossToNet(purchaseUnitPrice, input.purchaseVatRatePercent) : purchaseUnitPrice;
  const purchaseGrossUnitPrice = input.purchasePriceIncludesVat ? purchaseUnitPrice : purchaseUnitPrice * (1 + nonNegative(input.purchaseVatRatePercent) / 100);
  const purchaseNetTotal = purchaseNetUnitPrice * quantity;
  const purchaseGrossTotal = purchaseGrossUnitPrice * quantity;
  const purchaseInputVat = Math.max(0, purchaseGrossTotal - purchaseNetTotal);
  const lossCost = purchaseNetTotal * nonNegative(input.lossRatePercent) / 100;
  const loadingCost = nonNegative(input.loadingFeePerUnit) * quantity;
  const storageCost = nonNegative(input.storageFeePerUnitDay) * quantity * nonNegative(input.storageDays);
  const otherDirectCost = nonNegative(input.otherDirectCostPerUnit) * quantity;

  const freightQuantity = nonNegative(input.freightQuantity || quantity);
  const vehicleLoad = Math.max(0, input.vehicleLoad);
  const vehicleTrips = vehicleLoad > 0 && freightQuantity > 0 ? Math.ceil(freightQuantity / vehicleLoad) : 0;
  const baseFreight = nonNegative(input.freightUnitPricePerUnitKm) * nonNegative(input.distanceKm) * freightQuantity;
  const startPriceTotal = nonNegative(input.startPricePerVehicle) * vehicleTrips;
  const freightCore = Math.max(baseFreight, startPriceTotal);
  const freightGrossTotal = freightCore + nonNegative(input.tollFeePerVehicle) * vehicleTrips + (nonNegative(input.loadingFeePerFreightUnit) + nonNegative(input.unloadingFeePerFreightUnit)) * freightQuantity + nonNegative(input.fuelSurchargePerUnitKm) * nonNegative(input.distanceKm) * freightQuantity;
  const freightNetTotal = input.freightPriceIncludesVat ? grossToNet(freightGrossTotal, input.freightVatRatePercent) : freightGrossTotal;
  const freightInputVat = Math.max(0, freightGrossTotal - freightNetTotal);
  const freightTotalPerUnit = quantity > 0 ? freightNetTotal / quantity : 0;
  const totalCostNet = purchaseNetTotal + lossCost + loadingCost + storageCost + otherDirectCost + freightNetTotal;
  const totalCostPerUnit = quantity > 0 ? totalCostNet / quantity : 0;

  const outputRate = nonNegative(input.outputVatRatePercent);
  const targetMargin = Math.min(99.99, nonNegative(input.targetProfitMarginPercent));
  const saleNetUnitPrice = input.profitMode === "margin"
    ? totalCostPerUnit / Math.max(0.0001, 1 - targetMargin / 100)
    : input.profitMode === "markup"
      ? totalCostPerUnit + nonNegative(input.markupPerUnit)
      : grossToNet(input.saleGrossUnitPrice, outputRate);
  const saleGrossUnitPrice = input.profitMode === "direct" ? nonNegative(input.saleGrossUnitPrice) : saleNetUnitPrice * (1 + outputRate / 100);
  const totalSalesGross = saleGrossUnitPrice * quantity;
  const totalSalesNet = saleNetUnitPrice * quantity;
  const outputVat = Math.max(0, totalSalesGross - totalSalesNet);
  const deductibleInputVat = purchaseInputVat + freightInputVat;
  const vatPayable = Math.max(0, outputVat - deductibleInputVat);
  const vatCredit = Math.max(0, deductibleInputVat - outputVat);
  const operatingProfitBeforeTax = totalSalesNet - totalCostNet;
  const surchargeTax = vatPayable * nonNegative(input.surchargeRatePercent) / 100;
  const stampTax = totalSalesNet * nonNegative(input.stampTaxRatePercent) / 100;
  const taxableProfit = operatingProfitBeforeTax - surchargeTax - stampTax;
  const incomeTax = Math.max(0, taxableProfit) * nonNegative(input.incomeTaxRatePercent) / 100;
  const profitAfterSurcharge = operatingProfitBeforeTax - surchargeTax - stampTax;
  const netProfit = profitAfterSurcharge - incomeTax;
  const settlementSchedule = buildSettlementTemplate(input).map(line => ({ ...line, amount: totalSalesGross * line.percent / 100, cumulativeAmount: 0 }));
  let cumulativeAmount = 0;
  const schedule = settlementSchedule.map(line => ({ ...line, cumulativeAmount: cumulativeAmount += line.amount }));

  const supplyMonths = Math.max(1, Math.round(input.supplyMonths || 1));
  const maxDelay = schedule.reduce((max, line) => Math.max(max, line.delayMonths), 0);
  const monthlyCost = totalCostNet / supplyMonths;
  const monthlyRevenue = totalSalesGross / supplyMonths;
  let cashBalance = 0;
  let fundingPeak = 0;
  let paybackMonth: number | null = null;
  for (let month = 0; month <= supplyMonths + maxDelay; month += 1) {
    if (month < supplyMonths) cashBalance -= monthlyCost;
    schedule.filter(line => line.delayMonths === month).forEach(line => { cashBalance += line.amount; });
    if (month < supplyMonths && schedule.length === 0) cashBalance += monthlyRevenue;
    fundingPeak = Math.max(fundingPeak, -cashBalance);
    if (paybackMonth === null && month >= supplyMonths && cashBalance >= 0) paybackMonth = month;
  }
  const estimatedFundingCost = fundingPeak * nonNegative(input.fundingRatePercentPerYear) / 100 * (supplyMonths / 12);

  return {
    quantity,
    vehicleTrips,
    purchaseGrossTotal,
    purchaseNetTotal,
    purchaseInputVat,
    lossCost,
    loadingCost,
    storageCost,
    otherDirectCost,
    freightGrossTotal,
    freightNetTotal,
    freightInputVat,
    freightTotalPerUnit,
    totalCostNet,
    totalCostPerUnit,
    saleNetUnitPrice,
    saleGrossUnitPrice,
    totalSalesGross,
    totalSalesNet,
    outputVat,
    deductibleInputVat,
    vatPayable,
    vatCredit,
    operatingProfitBeforeTax,
    surchargeTax,
    stampTax,
    taxableProfit,
    incomeTax,
    profitAfterSurcharge,
    netProfit,
    grossMarginPercent: totalSalesNet > 0 ? operatingProfitBeforeTax / totalSalesNet * 100 : 0,
    netProfitMarginPercent: totalSalesNet > 0 ? netProfit / totalSalesNet * 100 : 0,
    settlementSchedule: schedule,
    fundingPeak,
    estimatedFundingCost,
    paybackMonth,
  };
}
