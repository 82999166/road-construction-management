import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";

type TemplateTab = "earthwork" | "auxiliary";
type EarthSurveyRow = { id: number; stakeNo: string; length: string; width: string; depth: string; soil: string; rock: string; materialType: string };
type Price = { subcontract: string; owner: string };
type AuxiliaryRow = { id: number; itemName: string; unit: string; subcontract: string; owner: string; quantity: string; remarks: string };

const toNumber = (value: string) => {
  const result = Number.parseFloat(value);
  return Number.isFinite(result) ? result : 0;
};
const money = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const makeEarthRow = (id: number): EarthSurveyRow => ({ id, stakeNo: "", length: "", width: "", depth: "", soil: "", rock: "", materialType: "土" });
const makeAuxiliaryRow = (id: number, itemName = "", unit = ""): AuxiliaryRow => ({ id, itemName, unit, subcontract: "", owner: "", quantity: "", remarks: "" });

const EARTH_PRICE_LINES = [
  { key: "soil", label: "挖土方", unit: "m³", note: "天然方" },
  { key: "rock", label: "挖石方", unit: "m³", note: "天然方" },
  { key: "wasteSoil", label: "土方外运", unit: "m³", note: "弃土" },
  { key: "wasteRock", label: "石方外运", unit: "m³", note: "弃渣" },
  { key: "borrow", label: "借方运输", unit: "m³", note: "天然方" },
  { key: "fill", label: "路基填方", unit: "m³", note: "压实方" },
  { key: "backfill", label: "台背回填", unit: "m³", note: "单独签证" },
] as const;

const AUXILIARY_ITEMS = [
  ["M7.5 浆砌片石边沟", "m³"], ["C20 混凝土边沟", "m³"], ["排水沟（Ⅰ型）", "m"], ["截水沟", "m"],
  ["急流槽", "道"], ["M7.5 浆砌片石护坡", "m³"], ["C20 混凝土护面墙", "m³"], ["片石混凝土挡墙", "m³"],
  ["挡墙钢筋（HRB400）", "t"], ["锚杆框架梁（砼）", "m³"], ["挂网喷播植草", "m²"], ["圆管涵（φ1.0m）", "m"],
  ["盖板涵（2×2m）", "m"], ["涵洞八字墙", "m³"], ["跌水井", "座"], ["路肩墙", "m³"],
] as const;

const EMPTY_PRICE: Record<string, Price> = Object.fromEntries(EARTH_PRICE_LINES.map(line => [line.key, { subcontract: "", owner: "" }]));
const EMPTY_DEDUCTIONS = { quality: "", safety: "", material: "", utilities: "", other: "" };

function AmountSummary({ ownerAmount, subcontractAmount, deductions, warrantyRate }: { ownerAmount: number; subcontractAmount: number; deductions: number; warrantyRate: number }) {
  const margin = ownerAmount - subcontractAmount;
  const warranty = subcontractAmount * warrantyRate / 100;
  const finalPayment = subcontractAmount - deductions - warranty;
  const marginRate = ownerAmount > 0 ? margin / ownerAmount * 100 : 0;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-slate-600">业主中标收入</p><p className="mt-1 text-lg font-bold text-amber-800">{money(ownerAmount)}</p></div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-600">分包成本</p><p className="mt-1 text-lg font-bold text-slate-800">{money(subcontractAmount)}</p></div>
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-slate-600">测算毛利 / 利润率</p><p className={`mt-1 text-lg font-bold ${margin >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(margin)} <span className="text-xs">({marginRate.toFixed(1)}%)</span></p></div>
    <div className="rounded-xl border border-[#b9d1c9] bg-[#edf7f2] p-3"><p className="text-xs text-slate-600">本期应付分包商</p><p className="mt-1 text-lg font-bold text-[#1f5b4c]">{money(finalPayment)}</p><p className="mt-1 text-xs text-slate-500">扣款 {money(deductions)} · 质保金 {money(warranty)}</p></div>
  </div>;
}

export default function SettlementTemplateCalculator() {
  const [tab, setTab] = useState<TemplateTab>("earthwork");
  const [projectName, setProjectName] = useState("");
  const [period, setPeriod] = useState("");
  const [warrantyRate, setWarrantyRate] = useState("3");
  const [soilCoefficient, setSoilCoefficient] = useState("1.13");
  const [rockCoefficient, setRockCoefficient] = useState("1.13");
  const [earthRows, setEarthRows] = useState<EarthSurveyRow[]>([makeEarthRow(1)]);
  const [earthPrices, setEarthPrices] = useState<Record<string, Price>>(EMPTY_PRICE);
  const [earthAdjustments, setEarthAdjustments] = useState({ utilSoil: "", utilRock: "", borrowSoil: "", borrowRock: "", backfill: "" });
  const [earthDeductions, setEarthDeductions] = useState(EMPTY_DEDUCTIONS);
  const [auxiliaryRows, setAuxiliaryRows] = useState<AuxiliaryRow[]>(() => AUXILIARY_ITEMS.map(([itemName, unit], index) => makeAuxiliaryRow(index + 1, itemName, unit)));
  const [auxiliaryDeductions, setAuxiliaryDeductions] = useState(EMPTY_DEDUCTIONS);

  const earthCalculation = useMemo(() => {
    const totalSoil = earthRows.reduce((sum, row) => sum + toNumber(row.soil), 0);
    const totalRock = earthRows.reduce((sum, row) => sum + toNumber(row.rock), 0);
    const utilSoil = toNumber(earthAdjustments.utilSoil);
    const utilRock = toNumber(earthAdjustments.utilRock);
    const borrowSoil = toNumber(earthAdjustments.borrowSoil);
    const borrowRock = toNumber(earthAdjustments.borrowRock);
    const backfill = toNumber(earthAdjustments.backfill);
    const soilK = Math.max(toNumber(soilCoefficient), 0.0001);
    const rockK = Math.max(toNumber(rockCoefficient), 0.0001);
    const quantities: Record<string, number> = {
      soil: totalSoil,
      rock: totalRock,
      wasteSoil: Math.max(totalSoil - utilSoil, 0),
      wasteRock: Math.max(totalRock - utilRock, 0),
      borrow: borrowSoil + borrowRock,
      fill: Math.max(utilSoil / soilK + utilRock / rockK + borrowSoil / soilK + borrowRock / rockK, 0),
      backfill,
    };
    const lines = EARTH_PRICE_LINES.map(line => {
      const price = earthPrices[line.key];
      const currentQuantity = quantities[line.key];
      const subcontractAmount = currentQuantity * toNumber(price.subcontract);
      const ownerAmount = currentQuantity * toNumber(price.owner);
      return { ...line, quantity: currentQuantity, subcontractAmount, ownerAmount, margin: ownerAmount - subcontractAmount };
    });
    return { lines, ownerAmount: lines.reduce((sum, line) => sum + line.ownerAmount, 0), subcontractAmount: lines.reduce((sum, line) => sum + line.subcontractAmount, 0) };
  }, [earthAdjustments, earthPrices, earthRows, rockCoefficient, soilCoefficient]);

  const auxiliaryCalculation = useMemo(() => {
    const lines = auxiliaryRows.map(row => {
      const currentQuantity = toNumber(row.quantity);
      const subcontractAmount = currentQuantity * toNumber(row.subcontract);
      const ownerAmount = currentQuantity * toNumber(row.owner);
      return { ...row, currentQuantity, subcontractAmount, ownerAmount, margin: ownerAmount - subcontractAmount };
    });
    return { lines, ownerAmount: lines.reduce((sum, line) => sum + line.ownerAmount, 0), subcontractAmount: lines.reduce((sum, line) => sum + line.subcontractAmount, 0) };
  }, [auxiliaryRows]);

  const updateEarthRow = (id: number, field: keyof EarthSurveyRow, value: string) => setEarthRows(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  const updateAuxiliaryRow = (id: number, field: keyof AuxiliaryRow, value: string) => setAuxiliaryRows(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  const earthDeductionAmount = Object.values(earthDeductions).reduce((sum, value) => sum + toNumber(value), 0);
  const auxiliaryDeductionAmount = Object.values(auxiliaryDeductions).reduce((sum, value) => sum + toNumber(value), 0);

  const resetEarthwork = () => { setProjectName(""); setPeriod(""); setWarrantyRate("3"); setSoilCoefficient("1.13"); setRockCoefficient("1.13"); setEarthRows([makeEarthRow(1)]); setEarthPrices(EMPTY_PRICE); setEarthAdjustments({ utilSoil: "", utilRock: "", borrowSoil: "", borrowRock: "", backfill: "" }); setEarthDeductions(EMPTY_DEDUCTIONS); };
  const resetAuxiliary = () => { setProjectName(""); setPeriod(""); setWarrantyRate("3"); setAuxiliaryRows(AUXILIARY_ITEMS.map(([itemName, unit], index) => makeAuxiliaryRow(index + 1, itemName, unit))); setAuxiliaryDeductions(EMPTY_DEDUCTIONS); };
  const activeCalculation = tab === "earthwork" ? earthCalculation : auxiliaryCalculation;
  const activeDeductions = tab === "earthwork" ? earthDeductionAmount : auxiliaryDeductionAmount;

  return <Card className="border-[#d8e3e0] print:border-0 print:shadow-none">
    <CardHeader className="space-y-3"><div><CardTitle className="text-base">计量结算模板参考</CardTitle><CardDescription>已转换为本系统原生计算组件。模板仅供测算和打印参考，不会自动写入施工队、收方、分包批次或财务结算数据。</CardDescription></div>
      <div className="flex flex-wrap gap-2 rounded-xl bg-[#edf4f1] p-2 print:hidden"><Button size="sm" variant={tab === "earthwork" ? "default" : "outline"} className={tab === "earthwork" ? "bg-[#285b53] hover:bg-[#1f4841]" : "bg-white"} onClick={() => setTab("earthwork")}>土石方结算模板</Button><Button size="sm" variant={tab === "auxiliary" ? "default" : "outline"} className={tab === "auxiliary" ? "bg-[#285b53] hover:bg-[#1f4841]" : "bg-white"} onClick={() => setTab("auxiliary")}>附属工程结算模板</Button></div>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-[#dae6e1] bg-[#f8fbfa] p-3 sm:grid-cols-2 xl:grid-cols-5"><div className="space-y-1 xl:col-span-2"><Label>项目名称</Label><Input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="输入项目名称" /></div><div className="space-y-1"><Label>结算期次</Label><Input value={period} onChange={event => setPeriod(event.target.value)} placeholder="例如 2026.08" /></div><div className="space-y-1"><Label>质保金比例（%）</Label><Input type="number" min="0" value={warrantyRate} onChange={event => setWarrantyRate(event.target.value)} /></div>{tab === "earthwork" ? <><div className="space-y-1"><Label>土 K 系数</Label><Input type="number" min="0" step="0.01" value={soilCoefficient} onChange={event => setSoilCoefficient(event.target.value)} /></div><div className="space-y-1"><Label>石 K 系数</Label><Input type="number" min="0" step="0.01" value={rockCoefficient} onChange={event => setRockCoefficient(event.target.value)} /></div></> : <div className="space-y-1"><Label>结算依据</Label><Input placeholder="设计、签证或合同依据" /></div>}</div>
      <AmountSummary ownerAmount={activeCalculation.ownerAmount} subcontractAmount={activeCalculation.subcontractAmount} deductions={activeDeductions} warrantyRate={toNumber(warrantyRate)} />
      {tab === "earthwork" ? <div className="space-y-5"><section><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-[#203c48]">一、收方台账（天然方）</h3><p className="text-xs text-slate-500">填写桩号及土石方收方量；长度、宽度、深度仅作为现场辅助记录。</p></div><Button size="sm" variant="outline" className="print:hidden" onClick={() => setEarthRows(rows => [...rows, makeEarthRow(Math.max(0, ...rows.map(row => row.id)) + 1)])}><Plus className="mr-1 h-4 w-4" />增加收方行</Button></div><div className="overflow-x-auto rounded-xl border"><Table className="min-w-[1040px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>#</TableHead><TableHead>桩号</TableHead><TableHead>长（m）</TableHead><TableHead>宽（m）</TableHead><TableHead>深（m）</TableHead><TableHead>挖土方（m³）</TableHead><TableHead>挖石方（m³）</TableHead><TableHead>类型</TableHead><TableHead className="print:hidden">操作</TableHead></TableRow></TableHeader><TableBody>{earthRows.map((row, index) => <TableRow key={row.id}><TableCell>{index + 1}</TableCell>{(["stakeNo", "length", "width", "depth", "soil", "rock", "materialType"] as (keyof EarthSurveyRow)[]).map(field => <TableCell key={field}><Input className="h-8 min-w-[76px]" type={["length", "width", "depth", "soil", "rock"].includes(field) ? "number" : "text"} value={row[field]} onChange={event => updateEarthRow(row.id, field, event.target.value)} /></TableCell>)}<TableCell className="print:hidden"><Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" disabled={earthRows.length === 1} onClick={() => setEarthRows(rows => rows.filter(item => item.id !== row.id))}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div></section>
        <section className="grid gap-3 rounded-xl border border-[#dae6e1] bg-[#f8fbfa] p-3 sm:grid-cols-2 xl:grid-cols-5">{([ ["utilSoil", "本桩利用土（天然）"], ["utilRock", "本桩利用石（天然）"], ["borrowSoil", "借方土（天然）"], ["borrowRock", "借方石（天然）"], ["backfill", "台背回填（压实）"] ] as const).map(([field, label]) => <div key={field} className="space-y-1"><Label>{label}</Label><Input type="number" min="0" value={earthAdjustments[field]} onChange={event => setEarthAdjustments(values => ({ ...values, [field]: event.target.value }))} /></div>)}</section>
        <PriceTable lines={earthCalculation.lines} prices={earthPrices} onPriceChange={(key, field, value) => setEarthPrices(values => ({ ...values, [key]: { ...values[key], [field]: value } }))} />
      </div> : <AuxiliaryTable rows={auxiliaryCalculation.lines} onChange={updateAuxiliaryRow} onAdd={() => setAuxiliaryRows(rows => [...rows, makeAuxiliaryRow(Math.max(0, ...rows.map(row => row.id)) + 1)])} onDelete={id => setAuxiliaryRows(rows => rows.length === 1 ? rows : rows.filter(row => row.id !== id))} />}
      <DeductionPanel value={tab === "earthwork" ? earthDeductions : auxiliaryDeductions} onChange={tab === "earthwork" ? setEarthDeductions : setAuxiliaryDeductions} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4 print:hidden"><Button variant="outline" onClick={() => tab === "earthwork" ? resetEarthwork() : resetAuxiliary()}><RotateCcw className="mr-1 h-4 w-4" />重置模板</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />打印当前模板</Button><Button className="bg-[#285b53] hover:bg-[#1f4841]" onClick={() => document.getElementById("settlement-template-summary")?.scrollIntoView({ behavior: "smooth" })}><Calculator className="mr-1 h-4 w-4" />更新测算</Button></div>
      <div id="settlement-template-summary" className="rounded-xl bg-[#203c48] p-4 text-white"><p className="text-sm text-slate-200">{tab === "earthwork" ? "土石方结算" : "附属工程结算"} · {projectName || "未填写项目"} · {period || "未填写期次"}</p><p className="mt-2 text-xl font-bold">本期应付分包商：{money(activeCalculation.subcontractAmount - activeDeductions - activeCalculation.subcontractAmount * toNumber(warrantyRate) / 100)}</p><p className="mt-1 text-xs text-slate-300">请以系统中已审核的项目收方、分包批次和财务结算为正式业务依据。本模板不会自动写入业务台账。</p></div>
    </CardContent>
  </Card>;
}

function PriceTable({ lines, prices, onPriceChange }: { lines: { key: string; label: string; unit: string; note: string; quantity: number; subcontractAmount: number; ownerAmount: number; margin: number }[]; prices: Record<string, Price>; onPriceChange: (key: string, field: keyof Price, value: string) => void }) {
  return <section><h3 className="mb-2 font-semibold text-[#203c48]">二、分包计价与中标收入</h3><div className="overflow-x-auto rounded-xl border"><Table className="min-w-[960px] text-xs"><TableHeader className="bg-[#203c48]"><TableRow><TableHead className="text-white">项目</TableHead><TableHead className="text-white">单位</TableHead><TableHead className="text-white">分包单价</TableHead><TableHead className="text-white">业主中标价</TableHead><TableHead className="text-white">结算量</TableHead><TableHead className="text-white">分包合价</TableHead><TableHead className="text-white">中标合价</TableHead><TableHead className="text-white">利润</TableHead><TableHead className="text-white">备注</TableHead></TableRow></TableHeader><TableBody>{lines.map(line => <TableRow key={line.key}><TableCell className="font-medium">{line.label}</TableCell><TableCell>{line.unit}</TableCell><TableCell><Input className="h-8 w-24" type="number" min="0" value={prices[line.key].subcontract} onChange={event => onPriceChange(line.key, "subcontract", event.target.value)} /></TableCell><TableCell><Input className="h-8 w-24" type="number" min="0" value={prices[line.key].owner} onChange={event => onPriceChange(line.key, "owner", event.target.value)} /></TableCell><TableCell>{quantity(line.quantity)}</TableCell><TableCell>{money(line.subcontractAmount)}</TableCell><TableCell>{money(line.ownerAmount)}</TableCell><TableCell className={line.margin >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{money(line.margin)}</TableCell><TableCell>{line.note}</TableCell></TableRow>)}</TableBody></Table></div></section>;
}

function AuxiliaryTable({ rows, onChange, onAdd, onDelete }: { rows: (AuxiliaryRow & { currentQuantity: number; subcontractAmount: number; ownerAmount: number; margin: number })[]; onChange: (id: number, field: keyof AuxiliaryRow, value: string) => void; onAdd: () => void; onDelete: (id: number) => void }) {
  return <section><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-[#203c48]">一、附属工程清单计价</h3><p className="text-xs text-slate-500">填写分包价、业主中标价和完成量，系统即时计算双价金额与测算差额。</p></div><Button size="sm" variant="outline" className="print:hidden" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />增加清单行</Button></div><div className="overflow-x-auto rounded-xl border"><Table className="min-w-[1120px] text-xs"><TableHeader className="bg-[#203c48]"><TableRow><TableHead className="text-white">项目名称</TableHead><TableHead className="text-white">单位</TableHead><TableHead className="text-white">分包单价</TableHead><TableHead className="text-white">业主中标价</TableHead><TableHead className="text-white">完成量</TableHead><TableHead className="text-white">分包合价</TableHead><TableHead className="text-white">中标合价</TableHead><TableHead className="text-white">利润</TableHead><TableHead className="text-white">备注</TableHead><TableHead className="print:hidden text-white">操作</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}>{(["itemName", "unit", "subcontract", "owner", "quantity"] as (keyof AuxiliaryRow)[]).map(field => <TableCell key={field}><Input className="h-8 min-w-[76px]" type={["subcontract", "owner", "quantity"].includes(field) ? "number" : "text"} value={row[field]} onChange={event => onChange(row.id, field, event.target.value)} /></TableCell>)}<TableCell>{money(row.subcontractAmount)}</TableCell><TableCell>{money(row.ownerAmount)}</TableCell><TableCell className={row.margin >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{money(row.margin)}</TableCell><TableCell><Input className="h-8 min-w-[110px]" value={row.remarks} onChange={event => onChange(row.id, "remarks", event.target.value)} /></TableCell><TableCell className="print:hidden"><Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => onDelete(row.id)}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div></section>;
}

function DeductionPanel({ value, onChange }: { value: typeof EMPTY_DEDUCTIONS; onChange: (value: typeof EMPTY_DEDUCTIONS) => void }) {
  const fields = [["quality", "质量返工/隐蔽未签"], ["safety", "安全环保罚款"], ["material", "材料超耗"], ["utilities", "水电摊销"], ["other", "其他扣款"]] as const;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-3"><h3 className="font-semibold text-[#203c48]">三、扣款与最终付款</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{fields.map(([field, label]) => <div key={field} className="space-y-1"><Label>{label}</Label><Input type="number" min="0" value={value[field]} onChange={event => onChange({ ...value, [field]: event.target.value })} /></div>)}</div></section>;
}
