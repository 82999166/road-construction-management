import { useMemo, useState } from "react";
import { Calculator, CircleDollarSign, Coins, Route, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { calculateMaterialProcurement, type MaterialProcurementInput, type MaterialProfitMode, type MaterialSettlementTemplate } from "@/lib/toolKnowledgeCalculations";

const initialValues: Record<keyof MaterialProcurementInput, string | boolean> = {
  materialName: "机制砂",
  unit: "吨",
  quantity: "1000",
  purchaseUnitPrice: "30",
  purchasePriceIncludesVat: true,
  purchaseVatRatePercent: "13",
  lossRatePercent: "0",
  loadingFeePerUnit: "0",
  storageFeePerUnitDay: "0",
  storageDays: "0",
  otherDirectCostPerUnit: "0",
  freightUnitPricePerUnitKm: "0.5",
  distanceKm: "30",
  freightQuantity: "1000",
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
  profitMode: "direct",
  targetProfitMarginPercent: "15",
  markupPerUnit: "8",
  saleGrossUnitPrice: "55",
  settlementTemplate: "inquiry",
  customFirstPaymentPercent: "60",
  customSecondPaymentPercent: "35",
  customFinalPaymentDelayMonths: "12",
  supplyMonths: "3",
  fundingRatePercentPerYear: "6",
};

function numberValue(value: string | boolean) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toCalculationInput(values: Record<keyof MaterialProcurementInput, string | boolean>): MaterialProcurementInput {
  return {
    materialName: String(values.materialName),
    unit: String(values.unit),
    quantity: numberValue(values.quantity),
    purchaseUnitPrice: numberValue(values.purchaseUnitPrice),
    purchasePriceIncludesVat: Boolean(values.purchasePriceIncludesVat),
    purchaseVatRatePercent: numberValue(values.purchaseVatRatePercent),
    lossRatePercent: numberValue(values.lossRatePercent),
    loadingFeePerUnit: numberValue(values.loadingFeePerUnit),
    storageFeePerUnitDay: numberValue(values.storageFeePerUnitDay),
    storageDays: numberValue(values.storageDays),
    otherDirectCostPerUnit: numberValue(values.otherDirectCostPerUnit),
    freightUnitPricePerUnitKm: numberValue(values.freightUnitPricePerUnitKm),
    distanceKm: numberValue(values.distanceKm),
    freightQuantity: numberValue(values.freightQuantity),
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
  };
}

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Field({ label, value, onChange, suffix, step = "0.01" }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; step?: string }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><div className="mt-1 flex items-center gap-2"><Input aria-label={label} type="number" min="0" step={step} value={value} onChange={event => onChange(event.target.value)} className="border-[#e6d5c2] bg-white" />{suffix ? <span className="w-16 shrink-0 text-right text-xs font-normal text-[#927565]">{suffix}</span> : null}</div></label>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><Input aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 border-[#e6d5c2] bg-white" /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#e6d5c2] bg-white px-3 text-sm text-[#4d3023] outline-none focus:ring-2 focus:ring-[#b86735]">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

export default function MaterialProcurementCalculator() {
  const [values, setValues] = useState(initialValues);
  const input = useMemo(() => toCalculationInput(values), [values]);
  const result = useMemo(() => calculateMaterialProcurement(input), [input]);
  const setValue = <K extends keyof MaterialProcurementInput>(key: K, value: string | boolean) => setValues(current => ({ ...current, [key]: value }));
  const reset = () => setValues(initialValues);
  const unit = input.unit || "单位";

  return <Card className="overflow-hidden border-[#d9e3df] shadow-[0_10px_28px_rgba(45,84,67,.06)]"><CardHeader className="border-b border-[#deebe4] bg-[#f2faf6]"><CardTitle className="flex items-center gap-2 text-base text-[#285b46]"><CircleDollarSign className="h-5 w-5 text-[#31835d]" />材料采购 · 含税单位利润多维度测算</CardTitle><p className="text-xs leading-5 text-[#557365]">输入材料、运费、税率、利润和结算参数后自动计算。所有结果只基于当前输入，不读取、不写入项目采购或财务台账。</p></CardHeader><CardContent className="space-y-5 p-5">
    <section className="rounded-2xl border border-[#ead7c3] bg-[#fffaf4] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#58382a]"><Coins className="h-4 w-4 text-[#b35e2b]" />一、材料成本</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><TextField label="材料名称" value={String(values.materialName)} onChange={value => setValue("materialName", value)} /><SelectField label="计量单位" value={String(values.unit)} onChange={value => setValue("unit", value)} options={[["吨", "吨"], ["立方米", "立方米"], ["平方米", "平方米"], ["件", "件"], ["套", "套"]]} /><Field label="采购数量" value={String(values.quantity)} onChange={value => setValue("quantity", value)} suffix={unit} step="0.01" /><Field label="采购单价" value={String(values.purchaseUnitPrice)} onChange={value => setValue("purchaseUnitPrice", value)} suffix="元/单位" /><SelectField label="采购单价口径" value={values.purchasePriceIncludesVat ? "gross" : "net"} onChange={value => setValue("purchasePriceIncludesVat", value === "gross")} options={[["gross", "含税单价"], ["net", "未税单价"]]} /><Field label="采购进项税率" value={String(values.purchaseVatRatePercent)} onChange={value => setValue("purchaseVatRatePercent", value)} suffix="%" /><Field label="损耗率" value={String(values.lossRatePercent)} onChange={value => setValue("lossRatePercent", value)} suffix="%" /><Field label="装卸费" value={String(values.loadingFeePerUnit)} onChange={value => setValue("loadingFeePerUnit", value)} suffix="元/单位" /><Field label="仓储费" value={String(values.storageFeePerUnitDay)} onChange={value => setValue("storageFeePerUnitDay", value)} suffix="元/日" /><Field label="存储天数" value={String(values.storageDays)} onChange={value => setValue("storageDays", value)} suffix="天" step="1" /><Field label="其他直接费" value={String(values.otherDirectCostPerUnit)} onChange={value => setValue("otherDirectCostPerUnit", value)} suffix="元/单位" /></div></section>

    <section className="rounded-2xl border border-[#d9e3df] bg-[#f7fbf9] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#285b46]"><Route className="h-4 w-4 text-[#31835d]" />二、运费与运输附加费</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="运费单价" value={String(values.freightUnitPricePerUnitKm)} onChange={value => setValue("freightUnitPricePerUnitKm", value)} suffix="元/单位·km" /><Field label="运距" value={String(values.distanceKm)} onChange={value => setValue("distanceKm", value)} suffix="km" /><Field label="运输数量" value={String(values.freightQuantity)} onChange={value => setValue("freightQuantity", value)} suffix={unit} /><Field label="车辆载重" value={String(values.vehicleLoad)} onChange={value => setValue("vehicleLoad", value)} suffix={`${unit}/车`} /><Field label="起步价" value={String(values.startPricePerVehicle)} onChange={value => setValue("startPricePerVehicle", value)} suffix="元/车" /><Field label="装货费" value={String(values.loadingFeePerFreightUnit)} onChange={value => setValue("loadingFeePerFreightUnit", value)} suffix="元/单位" /><Field label="卸货费" value={String(values.unloadingFeePerFreightUnit)} onChange={value => setValue("unloadingFeePerFreightUnit", value)} suffix="元/单位" /><Field label="过路费" value={String(values.tollFeePerVehicle)} onChange={value => setValue("tollFeePerVehicle", value)} suffix="元/车" /><Field label="燃油附加费" value={String(values.fuelSurchargePerUnitKm)} onChange={value => setValue("fuelSurchargePerUnitKm", value)} suffix="元/单位·km" /><SelectField label="运费价格口径" value={values.freightPriceIncludesVat ? "gross" : "net"} onChange={value => setValue("freightPriceIncludesVat", value === "gross")} options={[["gross", "含税运费"], ["net", "未税运费"]]} /><Field label="运费进项税率" value={String(values.freightVatRatePercent)} onChange={value => setValue("freightVatRatePercent", value)} suffix="%" /></div><p className="mt-3 text-xs leading-5 text-[#527060]">运输车次自动按“运输数量 ÷ 车辆载重”向上取整；起步价、过路费、装卸费和燃油附加费自动计入运费。</p></section>

    <section className="rounded-2xl border border-[#e5d8c8] bg-[#fffdf9] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#58382a]"><Calculator className="h-4 w-4 text-[#b35e2b]" />三、税率与利润模式</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="销项税率" value={String(values.outputVatRatePercent)} onChange={value => setValue("outputVatRatePercent", value)} suffix="%" /><Field label="附加税综合税率" value={String(values.surchargeRatePercent)} onChange={value => setValue("surchargeRatePercent", value)} suffix="%" /><Field label="所得税率" value={String(values.incomeTaxRatePercent)} onChange={value => setValue("incomeTaxRatePercent", value)} suffix="%" /><Field label="印花税率" value={String(values.stampTaxRatePercent)} onChange={value => setValue("stampTaxRatePercent", value)} suffix="%" /><SelectField label="利润设置方式" value={String(values.profitMode)} onChange={value => setValue("profitMode", value)} options={[["direct", "直接设售价"], ["margin", "按目标利润率反推"], ["markup", "按固定加价反推"]]} />{values.profitMode === "margin" ? <Field label="目标利润率" value={String(values.targetProfitMarginPercent)} onChange={value => setValue("targetProfitMarginPercent", value)} suffix="%" /> : null}{values.profitMode === "markup" ? <Field label="每单位固定加价" value={String(values.markupPerUnit)} onChange={value => setValue("markupPerUnit", value)} suffix="元/单位" /> : null}<Field label="项目部含税售价" value={String(values.saleGrossUnitPrice)} onChange={value => setValue("saleGrossUnitPrice", value)} suffix="元/单位" /></div></section>

    <section className="rounded-2xl border border-[#d8e4ec] bg-[#f7fbff] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#24516b]"><WalletCards className="h-4 w-4 text-[#3181a5]" />四、结算与垫资测算</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SelectField label="结算方式" value={String(values.settlementTemplate)} onChange={value => setValue("settlementTemplate", value)} options={[["cash", "一次性付款"], ["inquiry", "问价函模式：65%+15%+15%+5%"], ["monthly", "按月进度付款"], ["custom", "自定义结算比例"]]} /><Field label="供货周期" value={String(values.supplyMonths)} onChange={value => setValue("supplyMonths", value)} suffix="月" step="1" /><Field label="资金年化成本" value={String(values.fundingRatePercentPerYear)} onChange={value => setValue("fundingRatePercentPerYear", value)} suffix="%" />{values.settlementTemplate === "custom" ? <><Field label="首期比例" value={String(values.customFirstPaymentPercent)} onChange={value => setValue("customFirstPaymentPercent", value)} suffix="%" /><Field label="第二期比例" value={String(values.customSecondPaymentPercent)} onChange={value => setValue("customSecondPaymentPercent", value)} suffix="%" /><Field label="尾款延后" value={String(values.customFinalPaymentDelayMonths)} onChange={value => setValue("customFinalPaymentDelayMonths", value)} suffix="月" step="1" /></> : null}</div><p className="mt-3 text-xs leading-5 text-[#52718a]">回款计划按销售含税总额自动生成；垫资峰值按供货期内均匀发生的未税成本与回款节点估算。</p></section>

    <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><Card className="border-[#cae1d6] bg-[#f4faf7]"><CardHeader className="pb-2"><CardTitle className="text-base text-[#285b46]">自动计算结果</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#547163]">单位总成本（未税）</p><p className="mt-1 text-xl font-semibold text-[#284f40]">{formatMoney(result.totalCostPerUnit)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#547163]">销售含税单价</p><p className="mt-1 text-xl font-semibold text-[#284f40]">{formatMoney(result.saleGrossUnitPrice)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#547163]">单位净利润</p><p className="mt-1 text-xl font-semibold text-[#21724d]">{formatMoney(result.quantity > 0 ? result.netProfit / result.quantity : 0)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#547163]">净利率</p><p className="mt-1 text-xl font-semibold text-[#21724d]">{result.netProfitMarginPercent.toFixed(2)}%</p></div><dl className="sm:col-span-2 space-y-2 border-t border-[#cce0d5] pt-3 text-sm"><div className="flex justify-between gap-3 text-[#547163]"><dt>材料采购未税总成本</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.purchaseNetTotal)}</dd></div><div className="flex justify-between gap-3 text-[#547163]"><dt>损耗/装卸/仓储/其他</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.lossCost + result.loadingCost + result.storageCost + result.otherDirectCost)}</dd></div><div className="flex justify-between gap-3 text-[#547163]"><dt>运费未税总额 / 车次</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.freightNetTotal)} / {result.vehicleTrips} 车</dd></div><div className="flex justify-between gap-3 text-[#547163]"><dt>销项税 / 可抵扣进项税</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.outputVat)} / {formatMoney(result.deductibleInputVat)}</dd></div><div className="flex justify-between gap-3 text-[#547163]"><dt>应纳增值税 / 留抵进项税</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.vatPayable)} / {formatMoney(result.vatCredit)}</dd></div><div className="flex justify-between gap-3 text-[#547163]"><dt>附加税 / 印花税 / 所得税</dt><dd className="font-medium text-[#284f40]">{formatMoney(result.surchargeTax)} / {formatMoney(result.stampTax)} / {formatMoney(result.incomeTax)}</dd></div></dl></CardContent></Card><Card className="border-[#d8e4ec] bg-[#f7fbff]"><CardHeader className="pb-2"><CardTitle className="text-base text-[#24516b]">回款计划与资金占用</CardTitle></CardHeader><CardContent><div className="space-y-2 text-sm">{result.settlementSchedule.map(line => <div key={`${line.label}-${line.delayMonths}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><span className="text-[#52718a]">{line.label}<small className="ml-1 text-xs">（{line.delayMonths}个月）</small></span><span className="font-medium text-[#24516b]">{formatMoney(line.amount)}</span></div>)}</div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#52718a]">预计垫资峰值</p><p className="mt-1 text-lg font-semibold text-[#24516b]">{formatMoney(result.fundingPeak)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-xs text-[#52718a]">预计资金成本</p><p className="mt-1 text-lg font-semibold text-[#24516b]">{formatMoney(result.estimatedFundingCost)}</p></div></div><p className="mt-3 text-xs leading-5 text-[#52718a]">预计回本月份：{result.paybackMonth === null ? "在当前结算计划范围内尚未覆盖" : `第 ${result.paybackMonth} 个月`}</p></CardContent></Card></section>
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs leading-5 text-amber-900">口径提示：不含税金额＝含税金额 ÷（1＋税率）；结果不自动判断简易计税、发票合规、税收优惠或真实合同付款条件，正式报价和纳税申报前请由财税人员复核。</p><Button type="button" variant="outline" className="shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-100" onClick={reset}>恢复示例</Button></div>
  </CardContent></Card>;
}
