import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Coins,
  Layers3,
  Link2,
  ReceiptText,
  Route,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  calculateMaterialProcurement,
  MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS,
  type MaterialProcurementInput,
  type MaterialProfitMode,
  type MaterialSettlementTemplate,
  type RollingFinalPayoffMode,
  type SupplyQuantityBasis,
} from "@/lib/toolKnowledgeCalculations";

const MATERIAL_PRESETS = [
  ["mechanism_sand", "砂石料 · 机制砂（2 区中砂）", "机制砂", "2 区中砂", "吨"],
  ["crushed_stone", "砂石料 · 碎石（5-10 mm）", "碎石", "5-10 mm", "吨"],
  ["river_sand", "砂石料 · 河沙（中粗砂）", "河沙", "中粗砂", "吨"],
  ["slag", "砂石料 · 开山石碴（混合料）", "开山石碴", "混合料", "吨"],
  ["cement", "水泥 · 普通硅酸盐水泥（P.O42.5）", "普通硅酸盐水泥", "P.O42.5", "吨"],
  ["rebar", "钢材 · 螺纹钢（HRB400 Φ12-25）", "螺纹钢", "HRB400 Φ12-25", "吨"],
  ["wire_rod", "钢材 · 盘螺（HRB400 Φ6-10）", "盘螺", "HRB400 Φ6-10", "吨"],
  ["fly_ash", "掺合料 · 粉煤灰（I 级）", "粉煤灰", "I 级", "吨"],
  ["mineral_powder", "掺合料 · 矿粉（S95）", "矿粉", "S95", "吨"],
  ["water_reducer", "外加剂 · 减水剂（聚羧酸）", "减水剂", "聚羧酸", "吨"],
  ["cement_stabilized", "水稳材料 · 水泥稳定碎石（3%—5% 水泥）", "水泥稳定碎石", "3%—5% 水泥", "吨"],
] as const;

type FormValues = Record<keyof MaterialProcurementInput, string | boolean>;

export const materialProcurementInitialValues: FormValues = {
  materialName: "机制砂",
  materialSpecification: "2 区中砂",
  unit: "吨",
  quantity: "1000",
  supplyQuantityBasis: "project_total",
  purchaseUnitPrice: "30",
  purchasePriceIncludesVat: true,
  purchaseVatRatePercent: "13",
  lossRatePercent: "0",
  loadingFeePerUnit: "0",
  storageFeePerUnitDay: "0",
  storageDays: "0",
  otherDirectCostPerUnit: "0",
  transportMode: "road",
  freightUnitPricePerUnitKm: "0.5",
  distanceKm: "30",
  freightQuantity: "1000",
  freightQuantityFollowsMaterial: true,
  vehicleLoad: "30",
  startPricePerVehicle: "0",
  loadingFeePerFreightUnit: "0",
  unloadingFeePerFreightUnit: "0",
  tollFeePerVehicle: "0",
  fuelSurchargePerUnitKm: "0",
  freightPriceIncludesVat: true,
  freightVatRatePercent: "9",
  outputVatRatePercent: "13",
  surchargeRatePercent: "0",
  incomeTaxRatePercent: "0",
  stampTaxRatePercent: "0.03",
  resourceTaxRatePercent: "0",
  environmentalTaxPerUnit: "0",
  profitMode: "direct",
  targetProfitMarginPercent: "15",
  markupPerUnit: "8",
  saleGrossUnitPrice: "55",
  settlementTemplate: "inquiry",
  customFirstPaymentPercent: "60",
  customSecondPaymentPercent: "35",
  customFinalPaymentDelayMonths: "12",
  supplyMonths: "12",
  fundingRatePercentPerYear: "8",
  rollingMonthlyPayRatioPercent: "80",
  rollingFinalPayoffMode: "installment",
  rollingFinalPayoffMonths: "3",
  billPaymentPercent: "30",
  billTermMonths: "6",
  backToBackDelayMonths: "0",
};

function numberValue(value: string | boolean) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function toMaterialProcurementInput(values: FormValues): MaterialProcurementInput {
  return {
    materialName: String(values.materialName),
    materialSpecification: String(values.materialSpecification),
    unit: String(values.unit),
    quantity: numberValue(values.quantity),
    supplyQuantityBasis: String(values.supplyQuantityBasis) as SupplyQuantityBasis,
    purchaseUnitPrice: numberValue(values.purchaseUnitPrice),
    purchasePriceIncludesVat: Boolean(values.purchasePriceIncludesVat),
    purchaseVatRatePercent: numberValue(values.purchaseVatRatePercent),
    lossRatePercent: numberValue(values.lossRatePercent),
    loadingFeePerUnit: numberValue(values.loadingFeePerUnit),
    storageFeePerUnitDay: numberValue(values.storageFeePerUnitDay),
    storageDays: numberValue(values.storageDays),
    otherDirectCostPerUnit: numberValue(values.otherDirectCostPerUnit),
    transportMode: String(values.transportMode) as MaterialProcurementInput["transportMode"],
    freightUnitPricePerUnitKm: numberValue(values.freightUnitPricePerUnitKm),
    distanceKm: numberValue(values.distanceKm),
    freightQuantity: numberValue(values.freightQuantity),
    freightQuantityFollowsMaterial: Boolean(values.freightQuantityFollowsMaterial),
    vehicleLoad: numberValue(values.vehicleLoad),
    startPricePerVehicle: numberValue(values.startPricePerVehicle),
    loadingFeePerFreightUnit: numberValue(values.loadingFeePerFreightUnit),
    unloadingFeePerFreightUnit: numberValue(values.unloadingFeePerFreightUnit),
    tollFeePerVehicle: numberValue(values.tollFeePerVehicle),
    fuelSurchargePerUnitKm: numberValue(values.fuelSurchargePerUnitKm),
    freightPriceIncludesVat: Boolean(values.freightPriceIncludesVat),
    freightVatRatePercent: numberValue(values.freightVatRatePercent),
    outputVatRatePercent: numberValue(values.outputVatRatePercent),
    surchargeRatePercent: numberValue(values.surchargeRatePercent),
    incomeTaxRatePercent: numberValue(values.incomeTaxRatePercent),
    stampTaxRatePercent: numberValue(values.stampTaxRatePercent),
    resourceTaxRatePercent: numberValue(values.resourceTaxRatePercent),
    environmentalTaxPerUnit: numberValue(values.environmentalTaxPerUnit),
    profitMode: String(values.profitMode) as MaterialProfitMode,
    targetProfitMarginPercent: numberValue(values.targetProfitMarginPercent),
    markupPerUnit: numberValue(values.markupPerUnit),
    saleGrossUnitPrice: numberValue(values.saleGrossUnitPrice),
    settlementTemplate: String(values.settlementTemplate) as MaterialSettlementTemplate,
    customFirstPaymentPercent: numberValue(values.customFirstPaymentPercent),
    customSecondPaymentPercent: numberValue(values.customSecondPaymentPercent),
    customFinalPaymentDelayMonths: numberValue(values.customFinalPaymentDelayMonths),
    supplyMonths: numberValue(values.supplyMonths),
    fundingRatePercentPerYear: numberValue(values.fundingRatePercentPerYear),
    rollingMonthlyPayRatioPercent: numberValue(values.rollingMonthlyPayRatioPercent),
    rollingFinalPayoffMode: String(values.rollingFinalPayoffMode) as RollingFinalPayoffMode,
    rollingFinalPayoffMonths: numberValue(values.rollingFinalPayoffMonths),
    billPaymentPercent: numberValue(values.billPaymentPercent),
    billTermMonths: numberValue(values.billTermMonths),
    backToBackDelayMonths: numberValue(values.backToBackDelayMonths),
  };
}

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function Field({ label, value, onChange, suffix, step = "0.01", max, disabled = false, hint }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; step?: string; max?: number; disabled?: boolean; hint?: string }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><div className="mt-1 flex items-center gap-2"><Input aria-label={label} type="number" min="0" max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="border-[#e6d5c2] bg-white disabled:bg-[#f2f4f3] disabled:text-[#73847d]" />{suffix ? <span className="w-16 shrink-0 text-right text-xs font-normal text-[#927565]">{suffix}</span> : null}</div>{hint ? <span className="mt-1 block text-[11px] font-normal leading-4 text-[#8b776c]">{hint}</span> : null}</label>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><Input aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 border-[#e6d5c2] bg-white" /></label>;
}

function SelectField({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; hint?: string }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#e6d5c2] bg-white px-3 text-sm text-[#4d3023] outline-none focus:ring-2 focus:ring-[#b86735]">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>{hint ? <span className="mt-1 block text-[11px] font-normal leading-4 text-[#8b776c]">{hint}</span> : null}</label>;
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 py-2 text-sm ${emphasis ? "font-semibold text-[#285b46]" : "text-[#5b7166]"}`}><span>{label}</span><span className={emphasis ? "text-[#21724d]" : "font-medium text-[#284f40]"}>{value}</span></div>;
}

function MetricCard({ label, value, subtext, tone = "green" }: { label: string; value: string; subtext: string; tone?: "green" | "blue" | "amber" }) {
  const tones = { green: "border-[#cfe4d9] bg-[#f5fbf8] text-[#235d43]", blue: "border-[#d5e5ee] bg-[#f6fbfe] text-[#24516b]", amber: "border-[#ead8c1] bg-[#fffaf4] text-[#784b2f]" };
  return <div className={`rounded-2xl border p-3 ${tones[tone]}`}><p className="text-[11px] font-medium opacity-75">{label}</p><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] leading-4 opacity-70">{subtext}</p></div>;
}

export default function MaterialProcurementCalculator() {
  const [values, setValues] = useState(materialProcurementInitialValues);
  const [preset, setPreset] = useState("mechanism_sand");
  const [showGuide, setShowGuide] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const input = useMemo(() => toMaterialProcurementInput(values), [values]);
  const result = useMemo(() => calculateMaterialProcurement(input), [input]);
  const setValue = <K extends keyof MaterialProcurementInput>(key: K, value: string | boolean) => setValues(current => ({ ...current, [key]: value }));
  const reset = () => { setValues({ ...materialProcurementInitialValues }); setPreset("mechanism_sand"); setShowAllMonths(false); };
  const applyMaterialPreset = (presetCode: string) => {
    setPreset(presetCode);
    const next = MATERIAL_PRESETS.find(item => item[0] === presetCode);
    if (next) setValues(current => ({ ...current, materialName: next[2], materialSpecification: next[3], unit: next[4] }));
  };
  const unit = input.unit || "单位";
  const selectedSettlement = MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS.find(item => item.value === input.settlementTemplate) ?? MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS[0];
  const totalTax = result.vatPayable + result.surchargeTax + result.stampTax + result.resourceTax + result.environmentalTax + result.incomeTax;
  const totalCollected = result.monthlySettlementSchedule.at(-1)?.cumulativeReceipts ?? 0;
  const reconciled = Math.abs(result.settlementDifference) < 0.01 && Math.abs(result.cashFlowDifference) < 0.01;
  const calculationKey = JSON.stringify(input);
  const visibleRows = useMemo(() => {
    if (showAllMonths || result.monthlySettlementSchedule.length <= 16) return result.monthlySettlementSchedule;
    const rows = result.monthlySettlementSchedule;
    return rows.filter((row, index) => {
      const previous = rows[index - 1];
      const next = rows[index + 1];
      return row.month <= 6 || row.month === result.supplyMonths || row.month === result.paybackMonth || row.month === result.fullCollectionMonth || index === rows.length - 1 || Math.abs(row.currentPayment - (previous?.currentPayment ?? 0)) > 0.01 || Math.abs(row.currentPayment - (next?.currentPayment ?? 0)) > 0.01;
    });
  }, [result, showAllMonths]);

  return <Card className="overflow-hidden border-[#d9e3df] shadow-[0_16px_40px_rgba(45,84,67,.08)]">
    <CardHeader className="border-b border-[#deebe4] bg-[linear-gradient(135deg,#f1faf5_0%,#f6fbff_100%)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2 text-base text-[#285b46]"><CircleDollarSign className="h-5 w-5 text-[#31835d]" />材料采购 · 成本利润与资金计划</CardTitle><p className="mt-1 max-w-4xl text-xs leading-5 text-[#557365]">所有结果由当前页面输入实时生成。材料、运费、售价、数量口径、供货月数或结算方式变化后，成本、逐月回款和垫资会同步重算。</p></div>
        <Button type="button" variant="outline" size="sm" className="border-[#bcd8cb] bg-white text-[#285b46]" onClick={() => setShowGuide(current => !current)}><CircleHelp className="mr-1.5 h-4 w-4" />计算口径</Button>
      </div>
      {showGuide ? <div className="mt-3 grid gap-2 rounded-xl border border-[#cfe2d8] bg-white/80 p-3 text-xs leading-5 text-[#4f6b5f] md:grid-cols-3"><p><strong>项目总量：</strong>采购数量是整个合同总量，连续供货月数仅用于平均分配每月结算和成本。</p><p><strong>每月重复：</strong>采购数量是每月计划量，系统按供货月数扩展为合同总量。</p><p><strong>资金占用：</strong>按月内“预付款→成本支出→后付款”顺序测算，资金成本按每月需垫资金累计。</p></div> : null}
    </CardHeader>
    <CardContent className="space-y-5 p-4 sm:p-5">
      <section aria-label="实时测算总览" className="rounded-2xl border border-[#cfe1d8] bg-white p-4 shadow-[0_6px_18px_rgba(39,95,68,.05)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-semibold text-[#285b46]"><BarChart3 className="h-4 w-4" />实时测算总览</div><div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${reconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{reconciled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{reconciled ? "总额勾稽通过" : "请检查差额提示"}</div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="合同供货总量" value={`${formatQuantity(result.quantity)} ${unit}`} subtext={input.supplyQuantityBasis === "monthly_repeat" ? `每月 ${formatQuantity(result.monthlySupplyQuantity)} × ${result.supplyMonths} 月` : `项目总量，平均 ${formatQuantity(result.monthlySupplyQuantity)}/${unit === "单位" ? "月" : "月"}`} />
          <MetricCard label="含税报价总额" value={formatMoney(result.totalSalesGross)} subtext={`当前含税单价 ${formatMoney(result.saleGrossUnitPrice)}`} tone="amber" />
          <MetricCard label="预计现金支出总额" value={formatMoney(result.totalCashOutflow)} subtext={`含材料、运费与税费；每月约 ${formatMoney(result.monthlyCostOutflow)}`} />
          <MetricCard label="计划回款总额" value={formatMoney(totalCollected)} subtext={result.fullCollectionMonth ? `第 ${result.fullCollectionMonth} 月全部收回` : "当前计划尚未全部覆盖"} tone="blue" />
          <MetricCard label="自有资金峰值" value={formatMoney(result.fundingPeak)} subtext={result.stopFundingMonth ? `预计第 ${result.stopFundingMonth} 月起停止追加` : "供货期内仍需持续投入"} tone="blue" />
          <MetricCard label="扣资金成本后净利" value={formatMoney(result.netProfitAfterFunding)} subtext={`净利率 ${result.netProfitAfterFundingMarginPercent.toFixed(2)}%`} tone={result.netProfitAfterFunding >= 0 ? "green" : "amber"} />
        </div>
        {result.warnings.length ? <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{result.warnings.map(warning => <p key={warning} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}</div> : null}
      </section>

      <section className="rounded-2xl border border-[#ead7c3] bg-[#fffaf4] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-[#58382a]"><Coins className="h-4 w-4 text-[#b35e2b]" />一、材料与供货口径</div><div className="min-w-64"><SelectField label="常用材料下拉" value={preset} onChange={applyMaterialPreset} options={MATERIAL_PRESETS.map(item => [item[0], item[1]])} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><TextField label="材料名称" value={String(values.materialName)} onChange={value => setValue("materialName", value)} /><TextField label="规格型号" value={String(values.materialSpecification)} onChange={value => setValue("materialSpecification", value)} /><SelectField label="计量单位" value={String(values.unit)} onChange={value => setValue("unit", value)} options={[["吨", "吨"], ["立方米", "立方米"], ["平方米", "平方米"], ["米", "米"], ["件", "件"], ["套", "套"]]} /><SelectField label="采购数量口径" value={String(values.supplyQuantityBasis)} onChange={value => setValue("supplyQuantityBasis", value)} options={[["project_total", "整个合同总量"], ["monthly_repeat", "每月供货量（连续重复）"]]} hint="决定数量是否随连续供货月数倍增。" /><Field label={values.supplyQuantityBasis === "monthly_repeat" ? "每月采购数量" : "合同采购总量"} value={String(values.quantity)} onChange={value => setValue("quantity", value)} suffix={unit} /><Field label="采购单价" value={String(values.purchaseUnitPrice)} onChange={value => setValue("purchaseUnitPrice", value)} suffix="元/单位" /><SelectField label="采购单价口径" value={values.purchasePriceIncludesVat ? "gross" : "net"} onChange={value => setValue("purchasePriceIncludesVat", value === "gross")} options={[["gross", "含税单价"], ["net", "未税单价"]]} /><Field label="采购进项税率" value={String(values.purchaseVatRatePercent)} onChange={value => setValue("purchaseVatRatePercent", value)} suffix="%" max={100} /><Field label="损耗率" value={String(values.lossRatePercent)} onChange={value => setValue("lossRatePercent", value)} suffix="%" max={100} /><Field label="装卸费" value={String(values.loadingFeePerUnit)} onChange={value => setValue("loadingFeePerUnit", value)} suffix="元/单位" /><Field label="仓储费" value={String(values.storageFeePerUnitDay)} onChange={value => setValue("storageFeePerUnitDay", value)} suffix="元/日" /><Field label="存储天数" value={String(values.storageDays)} onChange={value => setValue("storageDays", value)} suffix="天" step="1" /><Field label="其他直接费" value={String(values.otherDirectCostPerUnit)} onChange={value => setValue("otherDirectCostPerUnit", value)} suffix="元/单位" /></div>
        <details className="mt-4 rounded-xl border border-[#ecd7bf] bg-white/80" open><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[#74462e]"><span className="flex items-center gap-2"><Layers3 className="h-4 w-4" />材料成本汇总</span><ChevronDown className="h-4 w-4" /></summary><div className="border-t border-[#f0e1d1] px-3"><SummaryRow label="采购未税金额" value={formatMoney(result.materialCostBreakdown.purchaseNetTotal)} /><SummaryRow label="采购进项税额" value={formatMoney(result.materialCostBreakdown.purchaseInputVat)} /><SummaryRow label="损耗成本" value={formatMoney(result.materialCostBreakdown.lossCost)} /><SummaryRow label="装卸成本" value={formatMoney(result.materialCostBreakdown.loadingCost)} /><SummaryRow label="仓储成本" value={formatMoney(result.materialCostBreakdown.storageCost)} /><SummaryRow label="其他直接成本" value={formatMoney(result.materialCostBreakdown.otherDirectCost)} /><SummaryRow label="材料未税小计" value={formatMoney(result.materialCostBreakdown.materialSubtotalNet)} emphasis /><SummaryRow label={`材料单位成本（未税/${unit}）`} value={formatMoney(result.materialCostBreakdown.materialUnitCostNet)} emphasis /></div></details>
      </section>

      <section className="rounded-2xl border border-[#d9e3df] bg-[#f7fbf9] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-[#285b46]"><Route className="h-4 w-4 text-[#31835d]" />二、运费与运输附加费</div><label className="flex cursor-pointer items-center gap-2 rounded-full border border-[#cfe0d8] bg-white px-3 py-1.5 text-xs text-[#285b46]"><input type="checkbox" checked={Boolean(values.freightQuantityFollowsMaterial)} onChange={event => setValue("freightQuantityFollowsMaterial", event.target.checked)} /><Link2 className="h-3.5 w-3.5" />运输数量跟随采购数量</label></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SelectField label="运输方式" value={String(values.transportMode)} onChange={value => setValue("transportMode", value)} options={[["road", "公路"], ["rail", "铁路"], ["water", "水路"], ["multimodal", "多式联运"]]} /><Field label="运费单价" value={String(values.freightUnitPricePerUnitKm)} onChange={value => setValue("freightUnitPricePerUnitKm", value)} suffix="元/单位·km" /><Field label="运距" value={String(values.distanceKm)} onChange={value => setValue("distanceKm", value)} suffix="km" /><Field label={values.supplyQuantityBasis === "monthly_repeat" ? "每月运输数量" : "合同运输总量"} value={values.freightQuantityFollowsMaterial ? String(values.quantity) : String(values.freightQuantity)} onChange={value => setValue("freightQuantity", value)} suffix={unit} disabled={Boolean(values.freightQuantityFollowsMaterial)} hint={values.freightQuantityFollowsMaterial ? "已与采购数量实时联动。" : "独立运量与采购量不同时会显示口径提醒。"} /><Field label="车辆载重" value={String(values.vehicleLoad)} onChange={value => setValue("vehicleLoad", value)} suffix={`${unit}/车`} /><Field label="起步价" value={String(values.startPricePerVehicle)} onChange={value => setValue("startPricePerVehicle", value)} suffix="元/车" /><Field label="装货费" value={String(values.loadingFeePerFreightUnit)} onChange={value => setValue("loadingFeePerFreightUnit", value)} suffix="元/单位" /><Field label="卸货费" value={String(values.unloadingFeePerFreightUnit)} onChange={value => setValue("unloadingFeePerFreightUnit", value)} suffix="元/单位" /><Field label="过路费" value={String(values.tollFeePerVehicle)} onChange={value => setValue("tollFeePerVehicle", value)} suffix="元/车" /><Field label="燃油附加费" value={String(values.fuelSurchargePerUnitKm)} onChange={value => setValue("fuelSurchargePerUnitKm", value)} suffix="元/单位·km" /><SelectField label="运费价格口径" value={values.freightPriceIncludesVat ? "gross" : "net"} onChange={value => setValue("freightPriceIncludesVat", value === "gross")} options={[["gross", "含税运费"], ["net", "未税运费"]]} /><Field label="运费进项税率" value={String(values.freightVatRatePercent)} onChange={value => setValue("freightVatRatePercent", value)} suffix="%" max={100} /></div>
        <details className="mt-4 rounded-xl border border-[#cfe0dc] bg-white/90" open><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[#285b46]"><span className="flex items-center gap-2"><ReceiptText className="h-4 w-4" />运费成本汇总</span><ChevronDown className="h-4 w-4" /></summary><div className="border-t border-[#dcece7] px-3"><SummaryRow label="基础运费（单价 × 运距 × 数量）" value={formatMoney(result.freightCostBreakdown.baseFreight)} /><SummaryRow label="起步价合计（与基础运费取高）" value={formatMoney(result.freightCostBreakdown.startPriceTotal)} /><SummaryRow label="计入运费基础金额" value={formatMoney(result.freightCostBreakdown.freightCore)} /><SummaryRow label="运输车次（向上取整）" value={`${formatQuantity(result.vehicleTrips)} 车`} /><SummaryRow label="过路费合计" value={formatMoney(result.freightCostBreakdown.tollTotal)} /><SummaryRow label="装卸费合计" value={formatMoney(result.freightCostBreakdown.loadingUnloadingTotal)} /><SummaryRow label="燃油附加费合计" value={formatMoney(result.freightCostBreakdown.fuelSurchargeTotal)} /><SummaryRow label="运费未税小计" value={formatMoney(result.freightCostBreakdown.freightNetTotal)} emphasis /><SummaryRow label={`运费单位成本（未税/${unit}）`} value={formatMoney(result.freightCostBreakdown.freightTotalPerUnit)} emphasis /></div></details>
      </section>

      <section className="rounded-2xl border border-[#e5d8c8] bg-[#fffdf9] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#58382a]"><Calculator className="h-4 w-4 text-[#b35e2b]" />三、税费、报价与利润</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="销项税率" value={String(values.outputVatRatePercent)} onChange={value => setValue("outputVatRatePercent", value)} suffix="%" max={100} /><Field label="附加税综合税率" value={String(values.surchargeRatePercent)} onChange={value => setValue("surchargeRatePercent", value)} suffix="%" max={100} /><Field label="所得税率" value={String(values.incomeTaxRatePercent)} onChange={value => setValue("incomeTaxRatePercent", value)} suffix="%" max={100} /><Field label="印花税率" value={String(values.stampTaxRatePercent)} onChange={value => setValue("stampTaxRatePercent", value)} suffix="%" max={100} /><Field label="资源税率（可选）" value={String(values.resourceTaxRatePercent)} onChange={value => setValue("resourceTaxRatePercent", value)} suffix="%" max={100} /><Field label="环保税（可选）" value={String(values.environmentalTaxPerUnit)} onChange={value => setValue("environmentalTaxPerUnit", value)} suffix="元/单位" /><SelectField label="利润设置方式" value={String(values.profitMode)} onChange={value => setValue("profitMode", value)} options={[["direct", "直接设售价"], ["margin", "按目标利润率反推"], ["markup", "按固定加价反推"]]} />{values.profitMode === "margin" ? <Field label="目标利润率" value={String(values.targetProfitMarginPercent)} onChange={value => setValue("targetProfitMarginPercent", value)} suffix="%" max={99.99} /> : null}{values.profitMode === "markup" ? <Field label="每单位固定加价" value={String(values.markupPerUnit)} onChange={value => setValue("markupPerUnit", value)} suffix="元/单位" /> : null}<Field label={values.profitMode === "direct" ? "项目部含税售价" : "反推含税售价（自动）"} value={values.profitMode === "direct" ? String(values.saleGrossUnitPrice) : result.saleGrossUnitPrice.toFixed(2)} onChange={value => setValue("saleGrossUnitPrice", value)} suffix="元/单位" disabled={values.profitMode !== "direct"} /></div></section>

      <section className="rounded-2xl border border-[#d8e4ec] bg-[#f7fbff] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#24516b]"><WalletCards className="h-4 w-4 text-[#3181a5]" />四、结算与垫资参数</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SelectField label="结算方式（9 种预设＋自定义）" value={String(values.settlementTemplate)} onChange={value => { setValue("settlementTemplate", value); setShowAllMonths(false); }} options={MATERIAL_SETTLEMENT_TEMPLATE_OPTIONS.map(item => [item.value, item.label])} /><Field label="连续供货月数" value={String(values.supplyMonths)} onChange={value => setValue("supplyMonths", value)} suffix="月" step="1" max={120} /><Field label="资金年化成本" value={String(values.fundingRatePercentPerYear)} onChange={value => setValue("fundingRatePercentPerYear", value)} suffix="%" max={100} /><div className="rounded-lg border border-[#d8e5ec] bg-white px-3 py-2 text-xs leading-5 text-[#52718a]"><span className="font-medium text-[#24516b]">当前方式：</span>{selectedSettlement.description}</div>{values.settlementTemplate === "custom" ? <><Field label="自定义首期比例" value={String(values.customFirstPaymentPercent)} onChange={value => setValue("customFirstPaymentPercent", value)} suffix="%" max={100} /><Field label="自定义第二期比例" value={String(values.customSecondPaymentPercent)} onChange={value => setValue("customSecondPaymentPercent", value)} suffix="%" max={100} /><Field label="自定义尾款延后" value={String(values.customFinalPaymentDelayMonths)} onChange={value => setValue("customFinalPaymentDelayMonths", value)} suffix="月" step="1" max={120} /></> : null}{values.settlementTemplate === "rolling_monthly" ? <><Field label="滚动月付款比例" value={String(values.rollingMonthlyPayRatioPercent)} onChange={value => setValue("rollingMonthlyPayRatioPercent", value)} suffix="%" max={100} /><SelectField label="末次结余付清方式" value={String(values.rollingFinalPayoffMode)} onChange={value => setValue("rollingFinalPayoffMode", value)} options={[["lump_sum", "一次性付清"], ["installment", "分期等额付清"]]} />{values.rollingFinalPayoffMode === "installment" ? <Field label="末次分期月数" value={String(values.rollingFinalPayoffMonths)} onChange={value => setValue("rollingFinalPayoffMonths", value)} suffix="月" step="1" max={120} /> : null}</> : null}{values.settlementTemplate === "bill_heavy" ? <><Field label="当期票据支付比例" value={String(values.billPaymentPercent)} onChange={value => setValue("billPaymentPercent", value)} suffix="%" max={60} /><Field label="票据期限" value={String(values.billTermMonths)} onChange={value => setValue("billTermMonths", value)} suffix="月" step="1" max={36} /></> : null}{values.settlementTemplate === "back_to_back" ? <Field label="预计上游付款滞后" value={String(values.backToBackDelayMonths)} onChange={value => setValue("backToBackDelayMonths", value)} suffix="月" step="1" max={120} /> : null}</div><div className="mt-3 grid gap-2 rounded-xl border border-[#d7e7ef] bg-white p-3 sm:grid-cols-4"><SummaryRow label="每月供货数量" value={`${formatQuantity(result.monthlySupplyQuantity)} ${unit}`} /><SummaryRow label="每月结算金额" value={formatMoney(result.monthlySettlementAmount)} emphasis /><SummaryRow label="每月现金支出（含税费）" value={formatMoney(result.monthlyCostOutflow)} /><SummaryRow label="资金成本口径" value={`${Number(values.fundingRatePercentPerYear)}%/年，按月累计`} /></div></section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]"><Card className="border-[#cae1d6] bg-[#f4faf7]"><CardHeader className="pb-2"><CardTitle className="text-base text-[#285b46]">综合成本、利润与勾稽</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><MetricCard label="单位总成本（未税）" value={formatMoney(result.totalCostPerUnit)} subtext={`材料＋运费，按 ${formatQuantity(result.quantity)} ${unit}`} /><MetricCard label="销售含税单价" value={formatMoney(result.saleGrossUnitPrice)} subtext={`未税单价 ${formatMoney(result.saleNetUnitPrice)}`} tone="amber" /><MetricCard label="税费前后净利润" value={`${formatMoney(result.netProfit)} → ${formatMoney(result.netProfitAfterFunding)}`} subtext="右侧为扣除预计资金成本后" /><MetricCard label="最终净利率" value={`${result.netProfitAfterFundingMarginPercent.toFixed(2)}%`} subtext={`资金成本 ${formatMoney(result.estimatedFundingCost)}`} /><dl className="sm:col-span-2 divide-y divide-[#dcebe5] border-t border-[#cce0d5] pt-1"><SummaryRow label="材料成本未税小计" value={formatMoney(result.materialCostBreakdown.materialSubtotalNet)} /><SummaryRow label="运费成本未税小计" value={formatMoney(result.freightNetTotal)} /><SummaryRow label="材料与运费总成本（现金口径）" value={formatMoney(result.totalCostCash)} /><SummaryRow label="含税报价总额 / 计划回款总额" value={`${formatMoney(result.totalSalesGross)} / ${formatMoney(totalCollected)}`} /><SummaryRow label="综合税费（不含留抵）" value={formatMoney(totalTax)} /><SummaryRow label="回款差额 / 现金流差额" value={`${formatMoney(result.settlementDifference)} / ${formatMoney(result.cashFlowDifference)}`} emphasis /></dl></CardContent></Card><Card className="border-[#d8e4ec] bg-[#f7fbff]"><CardHeader className="pb-2"><CardTitle className="text-base text-[#24516b]">回款节点与资金占用</CardTitle></CardHeader><CardContent><div className="space-y-2">{result.settlementSchedule.map(line => <div key={`${line.label}-${line.delayMonths}`} className="rounded-lg bg-white px-3 py-2"><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-[#24516b]">{line.label} <small className="font-normal text-xs text-[#52718a]">（{line.percent.toFixed(2)}%）</small></span><span className="font-medium text-[#24516b]">{formatMoney(line.amount)}</span></div><p className="mt-1 text-xs leading-5 text-[#668197]">{line.note}；预计延后 {line.delayMonths} 个月。</p></div>)}</div><div className="mt-4 grid gap-2 sm:grid-cols-2"><MetricCard label="应收账款峰值" value={formatMoney(result.accountsReceivablePeak)} subtext="已结算但尚未回款的最大余额" tone="blue" /><MetricCard label="自有资金占用峰值" value={formatMoney(result.fundingPeak)} subtext="按月内付款时点测算" tone="blue" /><MetricCard label="平均资金占用" value={formatMoney(result.averageFunding)} subtext={result.fundingRoiPercent === null ? "无资金占用" : `资金回报率 ${result.fundingRoiPercent.toFixed(2)}%`} /><MetricCard label="回本 / 全部回款" value={`${result.paybackMonth ? `第${result.paybackMonth}月` : "未回本"} / ${result.fullCollectionMonth ? `第${result.fullCollectionMonth}月` : "未收齐"}`} subtext={result.stopFundingMonth ? `预计第 ${result.stopFundingMonth} 月起停止追加资金` : "供货期内仍需追加资金"} /></div></CardContent></Card></section>

      <section className="rounded-2xl border border-[#d8e4ec] bg-[#fbfdff] p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-semibold text-[#24516b]"><CalendarClock className="h-4 w-4 text-[#3181a5]" />逐月结算、回款与垫资明细</div><p className="mt-1 text-xs text-[#607d8d]">当前输入：{formatQuantity(result.quantity)} {unit} · {result.supplyMonths} 个月 · {selectedSettlement.label}。修改上方任一参数，本表立即重算。</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs ${reconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{reconciled ? "回款与现金流已勾稽" : "存在差额"}</span>{result.monthlySettlementSchedule.length > 16 ? <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => setShowAllMonths(current => !current)}>{showAllMonths ? "只看关键月份" : `展开全部 ${result.monthlySettlementSchedule.length} 个月`}</Button> : null}</div></div><div className="overflow-x-auto rounded-xl border border-[#dce8ee]"><table className="min-w-[1320px] w-full text-left text-xs"><thead className="bg-[#edf6fa] text-[#315e78]"><tr>{["月份", "当月供货", "当月结算", "上月应收/预收", "付款基数", "当月回款", "月末应收/预收", "成本支出", "本月需垫", "累计回款", "累计现金流"].map(label => <th key={label} className="whitespace-nowrap px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead><tbody key={calculationKey}>{visibleRows.map(row => <tr key={row.month} className="border-t border-[#e5edf1] bg-white even:bg-[#fcfeff]"><td className="sticky left-0 whitespace-nowrap bg-inherit px-3 py-2.5 font-medium text-[#24516b]">第 {row.month} 月</td><td className="px-3 py-2.5">{row.month <= result.supplyMonths ? `${formatQuantity(result.monthlySupplyQuantity)} ${unit}` : "—"}</td><td className="px-3 py-2.5">{formatMoney(row.monthlySettlement)}</td><td className="px-3 py-2.5">{row.previousAdvance > 0 ? <span className="text-sky-700">预收 {formatMoney(row.previousAdvance)}</span> : formatMoney(row.previousOutstanding)}</td><td className="px-3 py-2.5">{formatMoney(row.paymentBase)}</td><td className="px-3 py-2.5 font-semibold text-[#1d6d56]">{formatMoney(row.currentPayment)}</td><td className="px-3 py-2.5">{row.advanceBalance > 0 ? <span className="text-sky-700">预收 {formatMoney(row.advanceBalance)}</span> : formatMoney(row.accountsReceivable)}</td><td className="px-3 py-2.5">{formatMoney(row.costOutflow)}</td><td className={`px-3 py-2.5 font-semibold ${row.fundingBeforeReceipt > 0 ? "text-[#a75036]" : "text-[#1d6d56]"}`}>{formatMoney(row.fundingBeforeReceipt)}</td><td className="px-3 py-2.5">{formatMoney(row.cumulativeReceipts)}</td><td className={`px-3 py-2.5 font-semibold ${row.cumulativeCashFlow >= 0 ? "text-[#1d6d56]" : "text-[#a75036]"}`}>{formatMoney(row.cumulativeCashFlow)}</td></tr>)}</tbody></table></div>{!showAllMonths && visibleRows.length < result.monthlySettlementSchedule.length ? <p className="mt-2 text-xs text-[#607d8d]">当前显示首期、供货结束、回款变化、回本及最终回款等关键月份；点击“展开全部”查看连续明细。</p> : null}</section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="max-w-5xl text-xs leading-5 text-amber-900"><strong>计算边界：</strong>总额按当前“项目总量/每月重复”口径生成；月度结算、材料运费现金成本和预计税费按供货月数均分，最后一月自动吸收分币差；资金占用按预付款、成本支出和后付款的月内顺序估算。实际不均匀供货、税款缴纳月份、预付款扣回、票据贴现、背靠背回款和质保返还仍须以合同及财税复核为准。</p><Button type="button" variant="outline" className="shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-100" onClick={reset}>恢复示例</Button></div>
    </CardContent>
  </Card>;
}
