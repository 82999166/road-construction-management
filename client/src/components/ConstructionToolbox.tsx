import { useMemo, useState } from "react";
import { ChevronDown, FlaskConical, Scale, Truck, Wrench } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CONCRETE_MIX_REFERENCES, type ConcreteMixReference, type ConcreteStrengthGrade, calculateConcreteMaterialTotals } from "@/lib/toolKnowledgeCalculations";
import EngineeringKnowledgeLibrary from "@/components/EngineeringKnowledgeLibrary";
import EngineeringCalculatorDirectory from "@/components/EngineeringCalculatorDirectory";
import MaterialProcurementCalculator from "@/components/MaterialProcurementCalculator";

function NumberField({ label, value, onChange, suffix, step = "0.01" }: { label: string; value: string; onChange: (value: string) => void; suffix: string; step?: string }) {
  return <label className="block text-xs font-medium text-[#6d5749]"><span>{label}</span><div className="mt-1 flex items-center gap-2"><Input aria-label={label} type="number" min="0" step={step} value={value} onChange={event => onChange(event.target.value)} className="border-[#e6d5c2] bg-white" /><span className="w-16 shrink-0 text-right text-xs font-normal text-[#927565]">{suffix}</span></div></label>;
}

function ToolPanel({ value, icon, title, description, children }: { value: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <AccordionItem value={value} className="overflow-hidden rounded-2xl border border-[#e4d8c9] bg-white px-0 shadow-[0_8px_24px_rgba(71,42,30,.05)]">
    <AccordionTrigger className="px-4 py-4 text-left hover:no-underline sm:px-5"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 text-[#b35e2b]">{icon}</span><div className="min-w-0"><p className="font-semibold text-[#58382a]">{title}</p><p className="mt-1 text-xs font-normal leading-5 text-[#876858]">{description}</p></div></div><ChevronDown className="h-4 w-4 shrink-0 text-[#8d705d]" /></AccordionTrigger>
    <AccordionContent className="border-t border-[#f0e0cf] bg-[#fffcf8] px-4 pb-4 pt-4 sm:px-5">{children}</AccordionContent>
  </AccordionItem>;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatKg(value: number) {
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} kg`;
}

export default function ConstructionToolbox({ includeKnowledge = true }: { includeKnowledge?: boolean }) {
  const [grade, setGrade] = useState<ConcreteStrengthGrade>("C30");
  const [volume, setVolume] = useState("1");
  const [mix, setMix] = useState<ConcreteMixReference>(CONCRETE_MIX_REFERENCES.C30);
  const [fuelLiters, setFuelLiters] = useState("0");
  const [fuelPrice, setFuelPrice] = useState("0");
  const [wage, setWage] = useState("0");
  const [other, setOther] = useState("0");
  const [distance, setDistance] = useState("0");
  const [quantity, setQuantity] = useState("0");
  const [basePrice, setBasePrice] = useState("0");
  const [extraRate, setExtraRate] = useState("0");
  const totals = useMemo(() => calculateConcreteMaterialTotals(mix, toNumber(volume)), [mix, volume]);
  const machineCost = toNumber(fuelLiters) * toNumber(fuelPrice) + toNumber(wage) + toNumber(other);
  const transportPrice = toNumber(quantity) * (toNumber(basePrice) + Math.max(0, toNumber(distance) - 1) * toNumber(extraRate));
  const updateMix = (key: keyof ConcreteMixReference, value: string) => setMix(current => ({ ...current, [key]: toNumber(value) }));
  const changeGrade = (next: ConcreteStrengthGrade) => { setGrade(next); setMix(CONCRETE_MIX_REFERENCES[next]); };

  return <section className="space-y-5">
    {includeKnowledge ? <><EngineeringCalculatorDirectory /><EngineeringKnowledgeLibrary /></> : null}
    <Accordion type="multiple" className="space-y-3">
      <ToolPanel value="concrete-materials" icon={<FlaskConical className="h-5 w-5" />} title="混凝土材料重量估算" description="默认折叠。选择强度等级并输入方量后，可编辑每方基准并实时查看材料总量。">
        <div className="grid gap-5 xl:grid-cols-[250px_1fr]"><div className="grid content-start gap-3 rounded-2xl bg-[#fcf3e8] p-4"><label className="text-xs font-medium text-[#6d5749]">混凝土强度等级<select aria-label="混凝土强度等级" className="mt-1.5 h-10 w-full rounded-md border border-[#e6d5c2] bg-white px-3 text-sm text-[#4d3023] outline-none focus:ring-2 focus:ring-[#b86735]" value={grade} onChange={event => changeGrade(event.target.value as ConcreteStrengthGrade)}>{(Object.keys(CONCRETE_MIX_REFERENCES) as ConcreteStrengthGrade[]).map(item => <option key={item} value={item}>{item}</option>)}</select></label><NumberField label="计划方量" value={volume} onChange={setVolume} suffix="m³" step="0.1" /><p className="rounded-xl border border-[#ead1b5] bg-white p-3 text-xs leading-5 text-[#785d4b]">{mix.note}</p><Button type="button" variant="outline" className="border-[#c9834f] bg-white text-[#8b4724] hover:bg-[#f9e5cf]" onClick={() => setMix(CONCRETE_MIX_REFERENCES[grade])}>恢复该等级参考值</Button></div><div><p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#58382a]"><Scale className="h-4 w-4 text-[#b35e2b]" />每 1 m³ 基准（可编辑）与总计划量</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><NumberField label="水泥" value={String(mix.cementKg)} onChange={value => updateMix("cementKg", value)} suffix="kg/m³" /><NumberField label="矿物掺合料" value={String(mix.mineralAdmixtureKg)} onChange={value => updateMix("mineralAdmixtureKg", value)} suffix="kg/m³" /><NumberField label="砂" value={String(mix.sandKg)} onChange={value => updateMix("sandKg", value)} suffix="kg/m³" /><NumberField label="石" value={String(mix.stoneKg)} onChange={value => updateMix("stoneKg", value)} suffix="kg/m³" /><NumberField label="水" value={String(mix.waterKg)} onChange={value => updateMix("waterKg", value)} suffix="kg/m³" /><NumberField label="外加剂" value={String(mix.chemicalAdmixtureKg)} onChange={value => updateMix("chemicalAdmixtureKg", value)} suffix="kg/m³" /></div><div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[{ label: "水泥", value: totals.cementKg }, { label: "矿物掺合料", value: totals.mineralAdmixtureKg }, { label: "砂", value: totals.sandKg }, { label: "石", value: totals.stoneKg }, { label: "水", value: totals.waterKg }, { label: "外加剂", value: totals.chemicalAdmixtureKg }].map(item => <div key={item.label} className="rounded-xl border border-[#dce8e1] bg-[#f4faf7] p-3"><p className="text-xs text-[#628071]">{item.label}总量</p><p className="mt-1 text-base font-semibold text-[#295c47]">{formatKg(item.value)}</p></div>)}</div><p className="mt-3 text-right text-xs text-[#886a59]">材料合计参考重量：<strong className="text-[#59392b]">{formatKg(totals.totalMassKg)}</strong></p></div></div>
      </ToolPanel>
      <ToolPanel value="material-procurement" icon={<Scale className="h-5 w-5" />} title="材料采购与结算垫资测算" description="默认折叠。展开后输入材料、运费、税费和结算参数，查看实时利润、回款与垫资结果。"><MaterialProcurementCalculator /></ToolPanel>
      <ToolPanel value="machine-shift" icon={<Wrench className="h-5 w-5" />} title="机械台班成本测算" description="默认折叠。输入油耗、油价、人工和维修费用后实时计算台班成本。"><div className="grid gap-3 sm:grid-cols-2"><NumberField label="柴油消耗" value={fuelLiters} onChange={setFuelLiters} suffix="L" /><NumberField label="柴油单价" value={fuelPrice} onChange={setFuelPrice} suffix="元/L" /><NumberField label="人工费用" value={wage} onChange={setWage} suffix="元" /><NumberField label="维修/其他" value={other} onChange={setOther} suffix="元" /><p className="sm:col-span-2 rounded-lg bg-[#f5f9f8] p-3 text-sm text-[#203c48]">本台班预计成本 <b>¥{machineCost.toFixed(2)}</b></p></div></ToolPanel>
      <ToolPanel value="transport-pricing" icon={<Truck className="h-5 w-5" />} title="运输运距运价测算" description="默认折叠。输入运输数量、首公里运价、运距与超距加价后实时测算运费。"><div className="grid gap-3 sm:grid-cols-2"><NumberField label="预设运距" value={distance} onChange={setDistance} suffix="km" /><NumberField label="运输方量" value={quantity} onChange={setQuantity} suffix="m³" /><NumberField label="首公里单价" value={basePrice} onChange={setBasePrice} suffix="元/m³" /><NumberField label="超 1km 加价" value={extraRate} onChange={setExtraRate} suffix="元/m³/km" /><p className="sm:col-span-2 rounded-lg bg-[#f5f9f8] p-3 text-sm text-[#203c48]">预计运费 <b>¥{transportPrice.toFixed(2)}</b></p></div></ToolPanel>
    </Accordion>
  </section>;
}
