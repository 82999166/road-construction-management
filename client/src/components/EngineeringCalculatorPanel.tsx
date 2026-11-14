import { formatQuantity } from "@shared/numberFormat";
import React, { useMemo, useState } from "react";
import { Calculator, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EngineeringCalculatorSpec } from "@/lib/engineering-calculators";

function initialValues(spec: EngineeringCalculatorSpec) {
  return Object.fromEntries(spec.inputs.map(input => [input.key, String(input.defaultValue)]));
}

export function displayEngineeringResult(value: number, precision: number, unit: string) {
  const nonQuantity = /^(?:%|‰|°|rad|个|人|台|块|根|条|次|站|组|车|辆|遍|道|布尔|无量纲|小数|K)$/.test(unit);
  return nonQuantity ? new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: precision }).format(value) : formatQuantity(value, true);
}

export function EngineeringCalculatorPanel({ spec }: { spec: EngineeringCalculatorSpec }) {
  const [rawValues, setRawValues] = useState<Record<string, string>>(() => initialValues(spec));
  const validation = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: string[] = [];
    for (const input of spec.inputs) {
      const raw = rawValues[input.key]?.trim() ?? "";
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) {
        errors.push(`请填写“${input.label}”`);
        continue;
      }
      if (input.min !== undefined && value < input.min) errors.push(`${input.label}不得小于 ${input.min}${input.unit}`);
      if (input.max !== undefined && value > input.max) errors.push(`${input.label}不得大于 ${input.max}${input.unit}`);
      values[input.key] = value;
    }
    return { values, errors };
  }, [rawValues, spec.inputs]);

  const calculation = useMemo(() => {
    if (validation.errors.length) return { outputs: null as Record<string, number> | null, error: validation.errors[0] };
    try {
      const outputs = spec.calculate(validation.values);
      if (spec.outputs.some(output => !Number.isFinite(outputs[output.key]))) return { outputs: null, error: "当前参数无法生成有效数值，请检查单位、范围和分母是否为零。" };
      return { outputs, error: "" };
    } catch {
      return { outputs: null, error: "当前参数无法生成有效数值，请检查输入后重试。" };
    }
  }, [spec, validation]);

  const resetExample = () => setRawValues(initialValues(spec));
  const clearValues = () => setRawValues(Object.fromEntries(spec.inputs.map(input => [input.key, ""])));

  return <section className="rounded-xl border border-[#9fcab7] bg-[linear-gradient(135deg,#f5fcf8,#eef8f3)] p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 font-semibold text-[#1c5b44]"><Calculator className="h-4 w-4" />实时输入与自动计算 <Badge variant="outline" className="border-[#a7cfbb] bg-white text-[#257157]">已按审校公式接入</Badge>{spec.requiresProfessionalReview ? <Badge variant="outline" className="border-[#e7c9a8] bg-[#fff8ee] text-[#935b24]">辅助测算，必须专业复核</Badge> : null}</p><p className="mt-1 text-xs leading-5 text-[#4c7161]">{spec.exampleSummary}</p></div>
      <div className="flex gap-2"><Button type="button" size="sm" variant="outline" className="border-[#a4cdb8] bg-white text-[#27654f]" onClick={resetExample}><RotateCcw className="mr-1 h-3.5 w-3.5" />示例回填</Button><Button type="button" size="sm" variant="ghost" className="text-[#6d6f70]" onClick={clearValues}>清空</Button></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{spec.inputs.map(input => <label key={input.key} className="grid gap-1.5 rounded-lg border border-[#d5e7de] bg-white p-3"><span className="text-xs font-semibold text-[#315e4d]">{input.label}<span className="ml-1 font-normal text-[#799388]">{input.unit}</span></span><Input aria-label={`${spec.title}-${input.label}`} type="number" inputMode="decimal" min={input.min} max={input.max} step={input.step} value={rawValues[input.key] ?? ""} onChange={event => setRawValues(current => ({ ...current, [input.key]: event.target.value }))} className="border-[#bcd9ca] bg-white" /><span className="text-[11px] leading-4 text-[#71877c]">{input.description}</span></label>)}</div>
    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="rounded-lg border border-[#d6e8de] bg-white p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-[#315e4d]"><Sparkles className="h-3.5 w-3.5" />当前参数代入</p><p className="mt-2 break-words text-sm leading-6 text-[#44685a]">{spec.inputs.map(input => `${input.label}=${rawValues[input.key] || "—"}${input.unit}`).join("；")}</p><p className="mt-2 rounded-md bg-[#f4faf7] px-2.5 py-2 font-mono text-xs leading-5 text-[#285b48]">{spec.formula}</p></div><div className="rounded-lg border border-[#b6d9c7] bg-[#f9fffb] p-3"><p className="text-xs font-semibold text-[#25634c]">自动计算结果</p><p className="mt-1 text-[11px] text-[#6b897c]">金额与数量显示两位小数，内部计算保留原精度。</p>{calculation.outputs ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{spec.outputs.map(output => <div key={output.key} className="rounded-md border border-[#d7ecdf] bg-white px-3 py-2"><p className="text-xs text-[#6b897c]">{output.label}</p><p className="mt-1 text-base font-semibold tabular-nums text-[#207151]">{displayEngineeringResult(calculation.outputs?.[output.key] ?? 0, output.precision, output.unit)} <span className="text-xs font-normal">{output.unit}</span></p></div>)}</div> : <p className="mt-2 text-sm leading-6 text-[#a04f37]">{calculation.error}</p>}</div></div>
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#efd5b9] bg-[#fff9f2] px-3 py-2 text-xs leading-5 text-[#78513a]"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b66b2c]" />{spec.riskNotice}</div>
  </section>;
}
