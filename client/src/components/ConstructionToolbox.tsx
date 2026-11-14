import React, { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  FlaskConical,
  RotateCcw,
  Scale,
  Truck,
  Wrench,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import MaterialProcurementCalculator from "@/components/MaterialProcurementCalculator";
import {
  CONCRETE_MIX_REFERENCES,
  type ConcreteMixReference,
  type ConcreteStrengthGrade,
  calculateConcreteMaterialTotals,
} from "@/lib/toolKnowledgeCalculations";
import { formatAmount, formatQuantity } from "@shared/numberFormat";

type NumberFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  step?: string;
  hint?: string;
};

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = "0.01",
  hint,
}: NumberFieldProps) {
  return (
    <label className="block text-xs font-medium text-[#5d625e]">
      <span>{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <Input
          aria-label={label}
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={event => onChange(event.target.value)}
          className="h-10 border-[#cfddd5] bg-white text-[#284337] focus-visible:ring-[#27775c]"
        />
        <span className="w-16 shrink-0 text-right text-xs font-normal text-[#78877f]">
          {suffix}
        </span>
      </div>
      {hint ? (
        <span className="mt-1 block text-[11px] font-normal text-[#839188]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function ResultMetric({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: string;
  tone?: "green" | "amber";
}) {
  const styles =
    tone === "amber"
      ? "border-[#edd6b9] bg-[#fff9f0] text-[#87552e]"
      : "border-[#cfe2d7] bg-[#f3faf6] text-[#255d48]";
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <p className="text-xs text-[#687a70]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function ToolPanel({
  value,
  icon,
  title,
  description,
  inputs,
  summary,
  children,
}: {
  value: string;
  icon: ReactNode;
  title: string;
  description: string;
  inputs: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="overflow-hidden rounded-xl border border-[#d8e4de] bg-white px-0 shadow-[0_8px_20px_rgba(29,78,62,.045)]"
    >
      <AccordionTrigger className="min-h-16 px-4 py-3.5 text-left hover:no-underline sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e6f2eb] text-[#1f6a4e]">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-[#294438]">{title}</p>
              <Badge
                variant="outline"
                className="border-[#c8ddd2] bg-[#f7fbf9] text-[#367260]"
              >
                即时测算
              </Badge>
            </div>
            <p className="mt-1 line-clamp-1 text-xs font-normal leading-5 text-[#6c8176]">
              {description}
            </p>
            <p className="mt-1 text-xs text-[#87958d]">
              {inputs} · {summary}
            </p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#67917f]" />
      </AccordionTrigger>
      <AccordionContent className="data-[state=closed]:animate-none data-[state=open]:animate-none border-t border-[#e9f0ec] bg-[#fcfefd] px-4 pb-4 pt-4 sm:px-5">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatKg(value: number) {
  return `${formatQuantity(value, true)} kg`;
}

function SectionLabel({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-[#294438]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#71847a]">{note}</p>
      </div>
    </div>
  );
}

export default function ConstructionToolbox() {
  const [grade, setGrade] = useState<ConcreteStrengthGrade>("C30");
  const [volume, setVolume] = useState("1");
  const [mix, setMix] = useState<ConcreteMixReference>(
    CONCRETE_MIX_REFERENCES.C30
  );
  const [fuelLiters, setFuelLiters] = useState("0");
  const [fuelPrice, setFuelPrice] = useState("0");
  const [wage, setWage] = useState("0");
  const [other, setOther] = useState("0");
  const [distance, setDistance] = useState("0");
  const [quantity, setQuantity] = useState("0");
  const [basePrice, setBasePrice] = useState("0");
  const [extraRate, setExtraRate] = useState("0");

  const totals = useMemo(
    () => calculateConcreteMaterialTotals(mix, toNumber(volume)),
    [mix, volume]
  );
  const machineCost =
    toNumber(fuelLiters) * toNumber(fuelPrice) +
    toNumber(wage) +
    toNumber(other);
  const transportPrice =
    toNumber(quantity) *
    (toNumber(basePrice) +
      Math.max(0, toNumber(distance) - 1) * toNumber(extraRate));
  const updateMix = (key: keyof ConcreteMixReference, value: string) =>
    setMix(current => ({ ...current, [key]: toNumber(value) }));
  const changeGrade = (next: ConcreteStrengthGrade) => {
    setGrade(next);
    setMix(CONCRETE_MIX_REFERENCES[next]);
  };

  const concreteResults = [
    { label: "水泥", value: totals.cementKg },
    { label: "矿物掺合料", value: totals.mineralAdmixtureKg },
    { label: "砂", value: totals.sandKg },
    { label: "石", value: totals.stoneKg },
    { label: "水", value: totals.waterKg },
    { label: "外加剂", value: totals.chemicalAdmixtureKg },
  ];

  return (
    <section className="space-y-3" data-testid="common-calculation-workspace">
      <Card className="border-[#d7e4dd] bg-[#f7fbf9] shadow-none">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5">
          <div>
            <p className="text-sm font-semibold text-[#294438]">常用测算工具</p>
            <p className="mt-1 text-xs leading-5 text-[#6d8277]">
              默认折叠；展开一个工具后填写参数，结果仅保留在当前页面，不会写入项目、采购或财务台账。
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-[#c8ddd2] bg-white text-[#367260]"
          >
            4 类高频工具
          </Badge>
        </CardContent>
      </Card>

      <Accordion type="multiple" className="space-y-2">
        <ToolPanel
          value="concrete-materials"
          icon={<FlaskConical className="h-4 w-4" />}
          title="混凝土材料重量估算"
          description="选择强度等级与计划方量，可按现场试配调整每方基准后查看材料总量。"
          inputs="强度等级、计划方量、每方基准"
          summary={`当前参考总重 ${formatKg(totals.totalMassKg)}`}
        >
          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-xl border border-[#e5ddd1] bg-[#fffaf5] p-4">
              <SectionLabel
                title="基础参数"
                note="参考值可编辑，须以试验室通知单和现场试配为准。"
              />
              <div className="space-y-3">
                <label className="block text-xs font-medium text-[#5d625e]">
                  混凝土强度等级
                  <select
                    aria-label="混凝土强度等级"
                    className="mt-1 h-10 w-full rounded-md border border-[#cfddd5] bg-white px-3 text-sm text-[#284337] outline-none focus:ring-2 focus:ring-[#27775c]"
                    value={grade}
                    onChange={event =>
                      changeGrade(event.target.value as ConcreteStrengthGrade)
                    }
                  >
                    {(
                      Object.keys(
                        CONCRETE_MIX_REFERENCES
                      ) as ConcreteStrengthGrade[]
                    ).map(item => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="计划方量"
                  value={volume}
                  onChange={setVolume}
                  suffix="m³"
                  step="0.1"
                />
                <p className="rounded-lg border border-[#eadcc9] bg-white p-3 text-xs leading-5 text-[#755e4d]">
                  {mix.note}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-[#c9a980] bg-white text-[#85502e] hover:bg-[#f9eee0]"
                  onClick={() => setMix(CONCRETE_MIX_REFERENCES[grade])}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  恢复该等级参考值
                </Button>
              </div>
            </div>
            <div>
              <SectionLabel
                title="每 1 m³ 基准"
                note="可按实际配合比调整；下方总量将随计划方量即时更新。"
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <NumberField
                  label="水泥"
                  value={String(mix.cementKg)}
                  onChange={value => updateMix("cementKg", value)}
                  suffix="kg/m³"
                />
                <NumberField
                  label="矿物掺合料"
                  value={String(mix.mineralAdmixtureKg)}
                  onChange={value => updateMix("mineralAdmixtureKg", value)}
                  suffix="kg/m³"
                />
                <NumberField
                  label="砂"
                  value={String(mix.sandKg)}
                  onChange={value => updateMix("sandKg", value)}
                  suffix="kg/m³"
                />
                <NumberField
                  label="石"
                  value={String(mix.stoneKg)}
                  onChange={value => updateMix("stoneKg", value)}
                  suffix="kg/m³"
                />
                <NumberField
                  label="水"
                  value={String(mix.waterKg)}
                  onChange={value => updateMix("waterKg", value)}
                  suffix="kg/m³"
                />
                <NumberField
                  label="外加剂"
                  value={String(mix.chemicalAdmixtureKg)}
                  onChange={value => updateMix("chemicalAdmixtureKg", value)}
                  suffix="kg/m³"
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {concreteResults.map(item => (
                  <ResultMetric
                    key={item.label}
                    label={`${item.label}总量`}
                    value={formatKg(item.value)}
                  />
                ))}
              </div>
            </div>
          </div>
        </ToolPanel>

        <ToolPanel
          value="material-procurement"
          icon={<Scale className="h-4 w-4" />}
          title="材料采购与结算垫资测算"
          description="输入材料、运费、税费与结算参数，实时查看含税利润、回款与垫资结果。"
          inputs="成本、税率、结算方式"
          summary="商务复核后使用"
        >
          <MaterialProcurementCalculator />
        </ToolPanel>

        <ToolPanel
          value="machine-shift"
          icon={<Wrench className="h-4 w-4" />}
          title="机械成本测算"
          description="按油耗、油价、人工及维修费用快速估算单次作业或台班成本。"
          inputs="油耗、油价、人工、维修"
          summary={`当前成本 ¥${formatAmount(machineCost)}`}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="柴油消耗"
                value={fuelLiters}
                onChange={setFuelLiters}
                suffix="L"
              />
              <NumberField
                label="柴油单价"
                value={fuelPrice}
                onChange={setFuelPrice}
                suffix="元/L"
              />
              <NumberField
                label="人工费用"
                value={wage}
                onChange={setWage}
                suffix="元"
              />
              <NumberField
                label="维修及其他"
                value={other}
                onChange={setOther}
                suffix="元"
              />
            </div>
            <ResultMetric
              label="预计机械成本"
              value={`¥${formatAmount(machineCost)}`}
              tone="amber"
            />
          </div>
        </ToolPanel>

        <ToolPanel
          value="transport-pricing"
          icon={<Truck className="h-4 w-4" />}
          title="运输运距运价测算"
          description="按运输方量、首公里单价、运距与超距加价测算当前运输费用。"
          inputs="方量、运距、首公里单价、超距加价"
          summary={`当前运费 ¥${formatAmount(transportPrice)}`}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="预设运距"
                value={distance}
                onChange={setDistance}
                suffix="km"
              />
              <NumberField
                label="运输方量"
                value={quantity}
                onChange={setQuantity}
                suffix="m³"
              />
              <NumberField
                label="首公里单价"
                value={basePrice}
                onChange={setBasePrice}
                suffix="元/m³"
              />
              <NumberField
                label="超 1 km 加价"
                value={extraRate}
                onChange={setExtraRate}
                suffix="元/m³/km"
              />
            </div>
            <ResultMetric
              label="预计运输费用"
              value={`¥${formatAmount(transportPrice)}`}
              tone="amber"
            />
          </div>
        </ToolPanel>
      </Accordion>
    </section>
  );
}
