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

/** 仅作材料计划估算参考，混凝土生产必须以项目试验室配合比通知单为准。 */
export const CONCRETE_MIX_REFERENCES: Record<ConcreteStrengthGrade, ConcreteMixReference> = {
  C20: { grade: "C20", cementKg: 343, mineralAdmixtureKg: 0, sandKg: 621, stoneKg: 1261, waterKg: 175, chemicalAdmixtureKg: 0, note: "公开常用等级参考；粗砂、卵石、31.5 mm、坍落度 35—50 mm 条件下的示例。" },
  C30: { grade: "C30", cementKg: 461, mineralAdmixtureKg: 0, sandKg: 512, stoneKg: 1252, waterKg: 175, chemicalAdmixtureKg: 0, note: "公开常用等级参考；需按实际水泥、砂石与坍落度重新试配。" },
  C35: { grade: "C35", cementKg: 470, mineralAdmixtureKg: 0, sandKg: 500, stoneKg: 1230, waterKg: 170, chemicalAdmixtureKg: 5, note: "高强计划估算起点；必须以项目试验室配合比通知单为准。" },
  C40: { grade: "C40", cementKg: 520, mineralAdmixtureKg: 0, sandKg: 525, stoneKg: 1220, waterKg: 178, chemicalAdmixtureKg: 6, note: "高强计划估算起点；必须以项目试验室配合比通知单为准。" },
  C50: { grade: "C50", cementKg: 540, mineralAdmixtureKg: 20, sandKg: 510, stoneKg: 1180, waterKg: 165, chemicalAdmixtureKg: 8, note: "高强计划估算起点；需复核骨料级配、减水剂和耐久性要求。" },
  C60: { grade: "C60", cementKg: 520, mineralAdmixtureKg: 80, sandKg: 680, stoneKg: 1050, waterKg: 160, chemicalAdmixtureKg: 12, note: "高强混凝土；规程要求经试验确定，不得直接用于生产。" },
};

export type ConcreteMaterialTotals = ConcreteMixReference & { volumeM3: number; totalMassKg: number };

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

export function grossToNet(gross: number, ratePercent: number) {
  return nonNegative(gross) / (1 + nonNegative(ratePercent) / 100);
}

export type MaterialProfitMode = "margin" | "markup" | "direct";
/** 文档中的 9 种业务模板，加“自定义分期付款”共 10 种可选方式。 */
export type MaterialSettlementTemplate = "cash" | "inquiry" | "monthly_progress" | "monthly_installment" | "standard_four_stage" | "back_to_back" | "bill_heavy" | "completion_installment" | "rolling_monthly" | "custom";
export type RollingFinalPayoffMode = "lump_sum" | "installment";

export type MaterialProcurementInput = {
  materialName: string;
  materialSpecification: string;
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
  transportMode: "road" | "rail" | "water" | "multimodal";
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
  resourceTaxRatePercent: number;
  environmentalTaxPerUnit: number;
  profitMode: MaterialProfitMode;
  targetProfitMarginPercent: number;
  markupPerUnit: number;
  saleGrossUnitPrice: number;
  settlementTemplate: MaterialSettlementTemplate;
  customFirstPaymentPercent: number;
  customSecondPaymentPercent: number;
  customFinalPaymentDelayMonths: number;
  supplyMonths: number;
  fundingRatePercentPerYear: number;
  rollingMonthlyPayRatioPercent: number;
  rollingFinalPayoffMode: RollingFinalPayoffMode;
  rollingFinalPayoffMonths: number;
  billPaymentPercent: number;
  billTermMonths: number;
  backToBackDelayMonths: number;
};

export type MaterialSettlementLine = {
  label: string;
  percent: number;
  delayMonths: number;
  amount: number;
  cumulativeAmount: number;
  note: string;
};

export type MonthlySettlementLine = {
  month: number;
  monthlySettlement: number;
  previousOutstanding: number;
  paymentBase: number;
  currentPayment: number;
  unpaidCarryOver: number;
  cumulativeReceipts: number;
  accountsReceivable: number;
  costOutflow: number;
  monthlyCashFlow: number;
  cumulativeCashFlow: number;
};

export type MaterialCostBreakdown = {
  purchaseNetTotal: number;
  purchaseGrossTotal: number;
  purchaseInputVat: number;
  lossCost: number;
  loadingCost: number;
  storageCost: number;
  otherDirectCost: number;
  materialSubtotalNet: number;
  materialUnitCostNet: number;
};

export type FreightCostBreakdown = {
  baseFreight: number;
  startPriceTotal: number;
  freightCore: number;
  vehicleTrips: number;
  tollTotal: number;
  loadingUnloadingTotal: number;
  fuelSurchargeTotal: number;
  freightGrossTotal: number;
  freightNetTotal: number;
  freightInputVat: number;
  freightTotalPerUnit: number;
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
  totalCostCash: number;
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
  resourceTax: number;
  environmentalTax: number;
  taxableProfit: number;
  incomeTax: number;
  profitAfterSurcharge: number;
  netProfit: number;
  grossMarginPercent: number;
  netProfitMarginPercent: number;
  materialCostBreakdown: MaterialCostBreakdown;
  freightCostBreakdown: FreightCostBreakdown;
  settlementSchedule: MaterialSettlementLine[];
  monthlySettlementSchedule: MonthlySettlementLine[];
  fundingPeak: number;
  averageFunding: number;
  estimatedFundingCost: number;
  paybackMonth: number | null;
  fullCollectionMonth: number | null;
  monthlySettlementAmount: number;
};

type SettlementPhase = { label: string; percent: number; delayMonths: number; scope: "monthly" | "project"; note: string };

export const MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS: Array<{ value: MaterialSettlementTemplate; label: string; description: string }> = [
  { value: "cash", label: "一次性付款", description: "每月结算金额 100% 当期支付。" },
  { value: "inquiry", label: "问价函模式（节点分期）", description: "65% 当期＋15%/6月＋15%/24月＋5%质保/36月。" },
  { value: "monthly_progress", label: "按月进度付款", description: "预付款 10%＋月进度累计付至 80%＋结算 17%＋质保 3%。" },
  { value: "monthly_installment", label: "按月结算分期", description: "60% 当期＋20%/6月＋17%履约完成＋3%质保。" },
  { value: "standard_four_stage", label: "标准四阶段", description: "预付款 10%＋进度款累计 80%＋结算 17%＋质保 3%。" },
  { value: "back_to_back", label: "背靠背支付", description: "按上游业主付款节点同步，默认每月结算后当期全额。" },
  { value: "bill_heavy", label: "高比例票据支付", description: "当期 60%（其中票据比例可设）＋20%/6月＋15%竣工＋5%质保。" },
  { value: "completion_installment", label: "竣工后分期付清", description: "供货期内无进度款，履约完成后按五年等额付清。" },
  { value: "rolling_monthly", label: "滚动累计月结", description: "付款基数＝当月结算＋上月结余；默认按付款基数 80% 支付。" },
  { value: "custom", label: "自定义分期付款", description: "自定义首期、第二期及尾款延后月数；各期合计自动校验为 100%。" },
];

function safePercent(value: number, upper = 100) {
  return Math.min(upper, nonNegative(value));
}

function buildSettlementPhases(input: MaterialProcurementInput): SettlementPhase[] {
  const fixed: Record<Exclude<MaterialSettlementTemplate, "custom" | "rolling_monthly" | "bill_heavy" | "back_to_back">, SettlementPhase[]> = {
    cash: [{ label: "当期一次性付款", percent: 100, delayMonths: 0, scope: "monthly", note: "当期结算" }],
    inquiry: [
      { label: "当期结算", percent: 65, delayMonths: 0, scope: "monthly", note: "结算并收票后" },
      { label: "第二期付款", percent: 15, delayMonths: 6, scope: "monthly", note: "每月结算后 6 个月" },
      { label: "第三期付款", percent: 15, delayMonths: 24, scope: "monthly", note: "每月结算后 24 个月" },
      { label: "质保金", percent: 5, delayMonths: 36, scope: "monthly", note: "每月结算后 36 个月" },
    ],
    monthly_progress: [
      { label: "预付款", percent: 10, delayMonths: 0, scope: "project", note: "供货开始前/首月" },
      { label: "月进度款", percent: 70, delayMonths: 0, scope: "monthly", note: "每月计量支付，累计含预付款付至 80%" },
      { label: "竣工结算款", percent: 17, delayMonths: 3, scope: "project", note: "履约完成及结算后" },
      { label: "质保金", percent: 3, delayMonths: 24, scope: "project", note: "缺陷责任期满" },
    ],
    monthly_installment: [
      { label: "当月结算款", percent: 60, delayMonths: 0, scope: "monthly", note: "当月结算并收票后" },
      { label: "第二期付款", percent: 20, delayMonths: 6, scope: "monthly", note: "每月结算后 6 个月" },
      { label: "履约结算款", percent: 17, delayMonths: 3, scope: "project", note: "合同履约完成及最终结算协议后" },
      { label: "质保金", percent: 3, delayMonths: 6, scope: "project", note: "竣工验收及最终结算协议后" },
    ],
    standard_four_stage: [
      { label: "预付款", percent: 10, delayMonths: 0, scope: "project", note: "合同签订后，通常需预付款保函" },
      { label: "进度款", percent: 70, delayMonths: 0, scope: "monthly", note: "按月/节点支付，累计含预付款付至 80%" },
      { label: "结算款", percent: 17, delayMonths: 3, scope: "project", note: "竣工结算审计完成后" },
      { label: "质保金", percent: 3, delayMonths: 24, scope: "project", note: "缺陷责任期满" },
    ],
    completion_installment: [
      { label: "第 1 年回款", percent: 20, delayMonths: 12, scope: "project", note: "履约完成后第 1 年" },
      { label: "第 2 年回款", percent: 20, delayMonths: 24, scope: "project", note: "履约完成后第 2 年" },
      { label: "第 3 年回款", percent: 20, delayMonths: 36, scope: "project", note: "履约完成后第 3 年" },
      { label: "第 4 年回款", percent: 20, delayMonths: 48, scope: "project", note: "履约完成后第 4 年" },
      { label: "第 5 年回款", percent: 20, delayMonths: 60, scope: "project", note: "履约完成后第 5 年" },
    ],
  };
  if (input.settlementTemplate === "custom") {
    const first = safePercent(input.customFirstPaymentPercent);
    const second = safePercent(input.customSecondPaymentPercent, 100 - first);
    return [
      { label: "首期付款", percent: first, delayMonths: 0, scope: "monthly" as const, note: "每月结算后当期" },
      { label: "第二期付款", percent: second, delayMonths: 1, scope: "monthly" as const, note: "每月结算后 1 个月" },
      { label: "尾款/质保金", percent: Math.max(0, 100 - first - second), delayMonths: Math.round(nonNegative(input.customFinalPaymentDelayMonths)), scope: "monthly" as const, note: "按尾款延后月数支付" },
    ].filter(item => item.percent > 0);
  }
  if (input.settlementTemplate === "back_to_back") return [{ label: "背靠背付款", percent: 100, delayMonths: Math.round(nonNegative(input.backToBackDelayMonths)), scope: "monthly" as const, note: "以建设单位向总包实际付款节点为准；此处为预计测算。" }];
  if (input.settlementTemplate === "bill_heavy") {
    const billPercent = safePercent(input.billPaymentPercent, 60);
    return [
      { label: "当期银行转账", percent: 60 - billPercent, delayMonths: 0, scope: "monthly" as const, note: "结算并收票后 90 天内，现金部分" },
      { label: "当期票据到期", percent: billPercent, delayMonths: Math.round(nonNegative(input.billTermMonths)), scope: "monthly" as const, note: "票据到期后回款，不计贴现" },
      { label: "第二期付款", percent: 20, delayMonths: 6, scope: "monthly" as const, note: "每月结算后 6 个月" },
      { label: "竣工结算款", percent: 15, delayMonths: 3, scope: "project" as const, note: "竣工验收后" },
      { label: "质保金", percent: 5, delayMonths: 24, scope: "project" as const, note: "质保期满后" },
    ].filter(item => item.percent > 0);
  }
  if (input.settlementTemplate === "rolling_monthly") return [];
  return fixed[input.settlementTemplate];
}

type ScheduledReceipt = { month: number; amount: number; label: string; percent: number; delayMonths: number; note: string };

function buildStandardReceipts(input: MaterialProcurementInput, totalSalesGross: number, supplyMonths: number) {
  const phases = buildSettlementPhases(input);
  const receipts: ScheduledReceipt[] = [];
  const monthlySettlement = totalSalesGross / supplyMonths;
  for (const phase of phases) {
    if (phase.scope === "monthly") {
      for (let supplyMonth = 1; supplyMonth <= supplyMonths; supplyMonth += 1) receipts.push({ month: supplyMonth + phase.delayMonths, amount: monthlySettlement * phase.percent / 100, label: phase.label, percent: phase.percent, delayMonths: phase.delayMonths, note: phase.note });
    } else {
      const receiptMonth = phase.label === "预付款" ? 1 : Math.max(1, supplyMonths + phase.delayMonths);
      receipts.push({ month: receiptMonth, amount: totalSalesGross * phase.percent / 100, label: phase.label, percent: phase.percent, delayMonths: phase.delayMonths, note: phase.note });
    }
  }
  return receipts;
}

function sumByMonth(receipts: ScheduledReceipt[]) {
  return receipts.reduce<Map<number, number>>((map, receipt) => map.set(receipt.month, (map.get(receipt.month) ?? 0) + receipt.amount), new Map());
}

function summarizeReceipts(receipts: ScheduledReceipt[]) {
  const grouped = new Map<string, { amount: number; percent: number; delayMonths: number; note: string }>();
  for (const receipt of receipts) {
    const existing = grouped.get(receipt.label);
    grouped.set(receipt.label, existing ? { ...existing, amount: existing.amount + receipt.amount } : { amount: receipt.amount, percent: receipt.percent, delayMonths: receipt.delayMonths, note: receipt.note });
  }
  let cumulativeAmount = 0;
  return Array.from(grouped.entries()).map(([label, value]) => ({ label, ...value, cumulativeAmount: cumulativeAmount += value.amount }));
}

function buildCashFlowRows(input: MaterialProcurementInput, totalSalesGross: number, totalCostCash: number, supplyMonths: number, receipts: ScheduledReceipt[]) {
  const paymentsByMonth = sumByMonth(receipts);
  const lastReceiptMonth = Math.max(supplyMonths, ...receipts.map(item => item.month));
  const rows: MonthlySettlementLine[] = [];
  const monthlySettlement = totalSalesGross / supplyMonths;
  const monthlyCost = totalCostCash / supplyMonths;
  let previousOutstanding = 0;
  let cumulativeReceipts = 0;
  let cumulativeCashFlow = 0;
  for (let month = 1; month <= lastReceiptMonth; month += 1) {
    const settlement = month <= supplyMonths ? monthlySettlement : 0;
    const currentPayment = paymentsByMonth.get(month) ?? 0;
    const paymentBase = previousOutstanding + settlement;
    const unpaidCarryOver = Math.max(0, paymentBase - currentPayment);
    const costOutflow = month <= supplyMonths ? monthlyCost : 0;
    cumulativeReceipts += currentPayment;
    const monthlyCashFlow = currentPayment - costOutflow;
    cumulativeCashFlow += monthlyCashFlow;
    rows.push({ month, monthlySettlement: settlement, previousOutstanding, paymentBase, currentPayment, unpaidCarryOver, cumulativeReceipts, accountsReceivable: unpaidCarryOver, costOutflow, monthlyCashFlow, cumulativeCashFlow });
    previousOutstanding = unpaidCarryOver;
  }
  return rows;
}

function buildRollingCashFlowRows(input: MaterialProcurementInput, totalSalesGross: number, totalCostCash: number, supplyMonths: number) {
  const rows: MonthlySettlementLine[] = [];
  const monthlySettlement = totalSalesGross / supplyMonths;
  const monthlyCost = totalCostCash / supplyMonths;
  const paymentRatio = safePercent(input.rollingMonthlyPayRatioPercent || 80) / 100;
  let previousOutstanding = 0;
  let cumulativeReceipts = 0;
  let cumulativeCashFlow = 0;
  for (let month = 1; month <= supplyMonths; month += 1) {
    const paymentBase = monthlySettlement + previousOutstanding;
    const currentPayment = paymentBase * paymentRatio;
    const unpaidCarryOver = paymentBase - currentPayment;
    cumulativeReceipts += currentPayment;
    const monthlyCashFlow = currentPayment - monthlyCost;
    cumulativeCashFlow += monthlyCashFlow;
    rows.push({ month, monthlySettlement, previousOutstanding, paymentBase, currentPayment, unpaidCarryOver, cumulativeReceipts, accountsReceivable: unpaidCarryOver, costOutflow: monthlyCost, monthlyCashFlow, cumulativeCashFlow });
    previousOutstanding = unpaidCarryOver;
  }
  const finalMonths = input.rollingFinalPayoffMode === "lump_sum" ? 1 : Math.max(1, Math.round(nonNegative(input.rollingFinalPayoffMonths || 3)));
  for (let offset = 1; offset <= finalMonths; offset += 1) {
    const currentPayment = previousOutstanding / (finalMonths - offset + 1);
    const unpaidCarryOver = Math.max(0, previousOutstanding - currentPayment);
    cumulativeReceipts += currentPayment;
    cumulativeCashFlow += currentPayment;
    rows.push({ month: supplyMonths + offset, monthlySettlement: 0, previousOutstanding, paymentBase: previousOutstanding, currentPayment, unpaidCarryOver, cumulativeReceipts, accountsReceivable: unpaidCarryOver, costOutflow: 0, monthlyCashFlow: currentPayment, cumulativeCashFlow });
    previousOutstanding = unpaidCarryOver;
  }
  return rows;
}

function buildFundingMetrics(rows: MonthlySettlementLine[], fundingRatePercentPerYear: number) {
  const funding = rows.map(row => Math.max(0, -row.cumulativeCashFlow));
  const fundingPeak = funding.length ? Math.max(...funding) : 0;
  const averageFunding = funding.length ? funding.reduce((sum, value) => sum + value, 0) / funding.length : 0;
  const estimatedFundingCost = averageFunding * nonNegative(fundingRatePercentPerYear) / 100 * rows.length / 12;
  const paybackMonth = rows.find(row => row.month > 1 && row.cumulativeCashFlow >= 0)?.month ?? null;
  const fullCollectionMonth = rows.find(row => row.accountsReceivable < 0.005)?.month ?? null;
  return { fundingPeak, averageFunding, estimatedFundingCost, paybackMonth, fullCollectionMonth };
}

/**
 * 材料采购多维度测算：所有结果均由当前输入即时推导，不读写项目业务台账。
 * 连续供货按总量在供货月数内均分；实际不均匀供货、合同付款条件、发票合规与税收优惠须以业务合同及财税复核为准。
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
  const materialSubtotalNet = purchaseNetTotal + lossCost + loadingCost + storageCost + otherDirectCost;

  const freightQuantity = nonNegative(input.freightQuantity || quantity);
  const vehicleLoad = nonNegative(input.vehicleLoad);
  const vehicleTrips = vehicleLoad > 0 && freightQuantity > 0 ? Math.ceil(freightQuantity / vehicleLoad) : 0;
  const baseFreight = nonNegative(input.freightUnitPricePerUnitKm) * nonNegative(input.distanceKm) * freightQuantity;
  const startPriceTotal = nonNegative(input.startPricePerVehicle) * vehicleTrips;
  const freightCore = Math.max(baseFreight, startPriceTotal);
  const tollTotal = nonNegative(input.tollFeePerVehicle) * vehicleTrips;
  const loadingUnloadingTotal = (nonNegative(input.loadingFeePerFreightUnit) + nonNegative(input.unloadingFeePerFreightUnit)) * freightQuantity;
  const fuelSurchargeTotal = nonNegative(input.fuelSurchargePerUnitKm) * nonNegative(input.distanceKm) * freightQuantity;
  const freightGrossTotal = freightCore + tollTotal + loadingUnloadingTotal + fuelSurchargeTotal;
  const freightNetTotal = input.freightPriceIncludesVat ? grossToNet(freightGrossTotal, input.freightVatRatePercent) : freightGrossTotal;
  const freightInputVat = Math.max(0, freightGrossTotal - freightNetTotal);
  const freightTotalPerUnit = quantity > 0 ? freightNetTotal / quantity : 0;
  const totalCostNet = materialSubtotalNet + freightNetTotal;
  const totalCostCash = purchaseGrossTotal + lossCost + loadingCost + storageCost + otherDirectCost + freightGrossTotal;
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
  const resourceTax = totalSalesNet * nonNegative(input.resourceTaxRatePercent) / 100;
  const environmentalTax = nonNegative(input.environmentalTaxPerUnit) * quantity;
  const taxableProfit = operatingProfitBeforeTax - surchargeTax - stampTax - resourceTax - environmentalTax;
  const incomeTax = Math.max(0, taxableProfit) * nonNegative(input.incomeTaxRatePercent) / 100;
  const profitAfterSurcharge = operatingProfitBeforeTax - surchargeTax - stampTax - resourceTax - environmentalTax;
  const netProfit = profitAfterSurcharge - incomeTax;
  const supplyMonths = Math.max(1, Math.min(120, Math.round(input.supplyMonths || 1)));

  const monthlySettlementSchedule = input.settlementTemplate === "rolling_monthly"
    ? buildRollingCashFlowRows(input, totalSalesGross, totalCostCash, supplyMonths)
    : buildCashFlowRows(input, totalSalesGross, totalCostCash, supplyMonths, buildStandardReceipts(input, totalSalesGross, supplyMonths));
  const receiptLines = input.settlementTemplate === "rolling_monthly"
    ? [{ label: "滚动累计月结", percent: safePercent(input.rollingMonthlyPayRatioPercent || 80), delayMonths: 0, amount: monthlySettlementSchedule.filter(row => row.month <= supplyMonths).reduce((sum, row) => sum + row.currentPayment, 0), cumulativeAmount: 0, note: "逐月按付款基数支付，末次余额按所选方式付清。" }, { label: "末次结余付清", percent: 100 - safePercent(input.rollingMonthlyPayRatioPercent || 80), delayMonths: input.rollingFinalPayoffMode === "lump_sum" ? 1 : Math.max(1, Math.round(nonNegative(input.rollingFinalPayoffMonths || 3))), amount: monthlySettlementSchedule.filter(row => row.month > supplyMonths).reduce((sum, row) => sum + row.currentPayment, 0), cumulativeAmount: totalSalesGross, note: input.rollingFinalPayoffMode === "lump_sum" ? "末次结算后一次性付清。" : "末次结算后等额分期付清。" }]
    : summarizeReceipts(buildStandardReceipts(input, totalSalesGross, supplyMonths));
  let runningScheduleTotal = 0;
  const settlementSchedule = receiptLines.map(line => ({ ...line, cumulativeAmount: runningScheduleTotal += line.amount }));
  const funding = buildFundingMetrics(monthlySettlementSchedule, input.fundingRatePercentPerYear);

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
    totalCostCash,
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
    resourceTax,
    environmentalTax,
    taxableProfit,
    incomeTax,
    profitAfterSurcharge,
    netProfit,
    grossMarginPercent: totalSalesNet > 0 ? operatingProfitBeforeTax / totalSalesNet * 100 : 0,
    netProfitMarginPercent: totalSalesNet > 0 ? netProfit / totalSalesNet * 100 : 0,
    materialCostBreakdown: { purchaseNetTotal, purchaseGrossTotal, purchaseInputVat, lossCost, loadingCost, storageCost, otherDirectCost, materialSubtotalNet, materialUnitCostNet: quantity > 0 ? materialSubtotalNet / quantity : 0 },
    freightCostBreakdown: { baseFreight, startPriceTotal, freightCore, vehicleTrips, tollTotal, loadingUnloadingTotal, fuelSurchargeTotal, freightGrossTotal, freightNetTotal, freightInputVat, freightTotalPerUnit },
    settlementSchedule,
    monthlySettlementSchedule,
    ...funding,
    monthlySettlementAmount: totalSalesGross / supplyMonths,
  };
}

/** 兼容原“含税单位利润”工具的单位测算接口。 */
export function calculateVatProfit(input: VatProfitInput): VatProfitResult {
  const material = calculateMaterialProcurement({
    materialName: "材料", materialSpecification: "", unit: "吨", quantity: 1,
    purchaseUnitPrice: input.materialGrossUnitPrice, purchasePriceIncludesVat: true, purchaseVatRatePercent: input.materialVatRatePercent,
    lossRatePercent: 0, loadingFeePerUnit: 0, storageFeePerUnitDay: 0, storageDays: 0, otherDirectCostPerUnit: input.otherNetUnitCost,
    transportMode: "road", freightUnitPricePerUnitKm: input.freightGrossUnitPrice, distanceKm: 1, freightQuantity: 1, vehicleLoad: 1, startPricePerVehicle: 0, loadingFeePerFreightUnit: 0, unloadingFeePerFreightUnit: 0, tollFeePerVehicle: 0, fuelSurchargePerUnitKm: 0, freightPriceIncludesVat: true, freightVatRatePercent: input.freightVatRatePercent,
    outputVatRatePercent: input.outputVatRatePercent, surchargeRatePercent: input.surchargeRatePercent, incomeTaxRatePercent: input.incomeTaxRatePercent, stampTaxRatePercent: 0, resourceTaxRatePercent: 0, environmentalTaxPerUnit: 0,
    profitMode: "direct", targetProfitMarginPercent: 0, markupPerUnit: 0, saleGrossUnitPrice: input.saleGrossUnitPrice,
    settlementTemplate: "cash", customFirstPaymentPercent: 100, customSecondPaymentPercent: 0, customFinalPaymentDelayMonths: 0, supplyMonths: 1, fundingRatePercentPerYear: 0, rollingMonthlyPayRatioPercent: 80, rollingFinalPayoffMode: "installment", rollingFinalPayoffMonths: 3, billPaymentPercent: 30, billTermMonths: 6, backToBackDelayMonths: 0,
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
