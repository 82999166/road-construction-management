import React, { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EngineeringCalculatorPanel } from "@/components/EngineeringCalculatorPanel";
import { ENGINEERING_CALCULATOR_SPECS } from "@/lib/engineering-calculators";

export default function EngineeringCalculatorDirectory() {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const matched = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return ENGINEERING_CALCULATOR_SPECS;
    return ENGINEERING_CALCULATOR_SPECS.filter(spec => [spec.id, spec.title, spec.formula, spec.exampleSummary, ...spec.inputs.map(input => `${input.label} ${input.unit}`), ...spec.outputs.map(output => `${output.label} ${output.unit}`)].join(" ").toLocaleLowerCase().includes(keyword));
  }, [query]);
  const shown = matched.slice(0, visibleCount);
  useEffect(() => { setVisibleCount(24); setOpenIds(query.trim() ? matched.slice(0, 12).map(spec => spec.id) : []); }, [query]);

  return <Card className="overflow-hidden border-[#9fcab7] shadow-[0_12px_30px_rgba(29,78,62,.08)]"><CardHeader className="border-b border-[#d9e7df] bg-[linear-gradient(135deg,#f1fbf6,#e8f5ee)]"><CardTitle className="flex items-center gap-2 text-lg text-[#1e5542]"><Calculator className="h-5 w-5 text-[#187157]" />自动计算工具目录</CardTitle><CardDescription className="mt-1.5 leading-6">共 {ENGINEERING_CALCULATOR_SPECS.length} 个已审校的可执行公式。搜索后下拉展开任一工具，即可输入数值、实时计算、查看公式代入与安全边界。</CardDescription></CardHeader><CardContent className="space-y-3 p-4 sm:p-5"><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px]"><div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-[#28735a]" /><Input value={query} onChange={event => setQuery(event.target.value)} className="h-11 border-[#9bc6b3] bg-white pl-9 pr-20 shadow-sm focus-visible:ring-[#27775c]" placeholder="搜索全部自动计算工具：如钢筋、土方、压实度、桥梁、测量、运费、资金现值" />{query ? <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1 h-9 text-xs text-[#356a55]" onClick={() => setQuery("")}>清空</Button> : null}</div><div className="rounded-lg border border-[#dbe8e2] bg-[#f7fbf9] px-3 py-2 text-sm text-[#386453]"><SlidersHorizontal className="mr-1.5 inline h-4 w-4" />匹配 <strong>{matched.length}</strong> 个工具</div></div><Accordion type="multiple" value={openIds} onValueChange={setOpenIds} className="space-y-2">{shown.map(spec => <AccordionItem key={spec.id} value={spec.id} className="overflow-hidden rounded-xl border border-[#dce7e1] bg-white px-0 shadow-sm"><AccordionTrigger className="px-4 py-3.5 text-left hover:no-underline"><div className="min-w-0 pr-2"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#2b453b]">{spec.title}</span>{spec.requiresProfessionalReview ? <Badge variant="outline" className="border-[#e7c9a8] bg-[#fff8ee] text-[#935b24]">必须专业复核</Badge> : <Badge variant="outline" className="border-[#bde0cd] bg-[#effaf3] text-[#206140]">实时计算</Badge>}</div><p className="mt-1 font-mono text-xs text-[#799087]">{spec.id} · {spec.formula}</p></div><ChevronDown className="h-4 w-4 shrink-0 text-[#67917f]" /></AccordionTrigger><AccordionContent className="border-t border-[#edf2ef] px-4 pb-4 pt-4"><EngineeringCalculatorPanel spec={spec} /></AccordionContent></AccordionItem>)}</Accordion>{shown.length < matched.length ? <div className="flex justify-center"><Button type="button" variant="outline" className="border-[#99c3b0] bg-white text-[#235d49] hover:bg-[#f1faf5]" onClick={() => setVisibleCount(current => Math.min(current + 24, matched.length))}>继续加载 24 个工具（已显示 {shown.length}/{matched.length}）</Button></div> : null}</CardContent></Card>;
}
