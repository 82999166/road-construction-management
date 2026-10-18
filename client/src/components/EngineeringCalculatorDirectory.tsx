import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Calculator,
  ChevronDown,
  ListFilter,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EngineeringCalculatorPanel } from "@/components/EngineeringCalculatorPanel";
import {
  ENGINEERING_CALCULATOR_SPECS,
  type EngineeringCalculatorSpec,
} from "@/lib/engineering-calculators";

type CalculatorFilter = "all" | "ready" | "review";

type EngineeringCalculatorDirectoryProps = {
  /** 未传入时保持原有的全量目录能力；分类工作台传入本专业计算器。 */
  specs?: readonly EngineeringCalculatorSpec[];
  categoryLabel?: string;
  categoryDescription?: string;
  /** 嵌入分类工作台时压缩重复标题，仅保留业务区级层次。 */
  compact?: boolean;
  testId?: string;
};

const FILTERS: { id: CalculatorFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "ready", label: "可实时计算" },
  { id: "review", label: "需专业复核" },
];

function statusFor(spec: EngineeringCalculatorSpec) {
  return spec.requiresProfessionalReview ? "review" : "ready";
}

export default function EngineeringCalculatorDirectory({
  specs,
  categoryLabel,
  categoryDescription,
  compact = false,
  testId,
}: EngineeringCalculatorDirectoryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CalculatorFilter>("all");
  const [visibleCount, setVisibleCount] = useState(compact ? 12 : 24);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const activeSpecs = specs ?? ENGINEERING_CALCULATOR_SPECS;
  const initialVisibleCount = compact ? 12 : 24;

  const matched = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return activeSpecs.filter(spec => {
      if (filter !== "all" && statusFor(spec) !== filter) return false;
      if (!keyword) return true;
      return [
        spec.id,
        spec.title,
        spec.formula,
        spec.exampleSummary,
        ...spec.inputs.map(input => `${input.label} ${input.unit}`),
        ...spec.outputs.map(output => `${output.label} ${output.unit}`),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [activeSpecs, filter, query]);
  const shown = matched.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(initialVisibleCount);
    // 搜索和筛选只改变结果，不自动展开大批表单，避免移动端页面被撑长。
    setOpenIds([]);
  }, [activeSpecs, filter, initialVisibleCount, query]);

  const title = categoryLabel
    ? `${categoryLabel} · 自动计算`
    : "自动计算工具目录";
  const description = categoryDescription
    ? `${categoryDescription} · ${activeSpecs.length} 个已审校公式。选择条目后输入参数并实时查看结果。`
    : `共 ${ENGINEERING_CALCULATOR_SPECS.length} 个已审校公式。搜索、筛选后展开单个工具，即可输入数值、查看公式代入与安全边界。`;
  const hasFilters = Boolean(query.trim()) || filter !== "all";

  return (
    <Card
      data-testid={testId}
      className="overflow-hidden border-[#9fcab7] bg-white shadow-[0_10px_24px_rgba(29,78,62,.06)]"
    >
      <CardHeader
        className={`border-b border-[#d9e7df] bg-[linear-gradient(135deg,#f4fbf7,#eaf6ef)] ${
          compact ? "space-y-1.5 px-4 py-3.5 sm:px-5" : "space-y-2 p-4 sm:p-5"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base text-[#1e5542] sm:text-lg">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e0f1e8] text-[#187157]">
                <Calculator className="h-4 w-4" />
              </span>
              {title}
            </CardTitle>
            <CardDescription className="mt-1.5 max-w-3xl leading-5">
              {description}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#cbe1d6] bg-white/85 px-2.5 py-2 text-xs text-[#396956]">
            <BadgeCheck className="h-4 w-4 text-[#187157]" />
            <span>
              本专业 <strong>{activeSpecs.length}</strong> 个
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-[#28735a]" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-11 border-[#9bc6b3] bg-white pl-9 pr-20 shadow-sm focus-visible:ring-[#27775c]"
              placeholder={
                categoryLabel
                  ? `搜索${categoryLabel}工具、公式、变量或结果`
                  : "搜索全部自动计算工具：如钢筋、土方、压实度、桥梁、测量、运费"
              }
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-9 text-xs text-[#356a55]"
                onClick={() => setQuery("")}
              >
                清空
              </Button>
            ) : null}
          </div>
          <div className="flex items-center rounded-lg border border-[#dbe8e2] bg-[#f7fbf9] px-3 py-2 text-sm text-[#386453]">
            <ListFilter className="mr-1.5 h-4 w-4" />
            匹配 <strong className="mx-1">{matched.length}</strong> 个
          </div>
        </div>

        <div
          aria-label="自动计算工具筛选"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e0ebe5] bg-[#fbfdfc] p-2"
        >
          <span className="px-1 text-xs font-medium text-[#557466]">
            工具状态
          </span>
          {FILTERS.map(item => (
            <Button
              key={item.id}
              type="button"
              variant={filter === item.id ? "default" : "outline"}
              size="sm"
              aria-pressed={filter === item.id}
              className={
                filter === item.id
                  ? "h-8 bg-[#236447] text-white hover:bg-[#1b543b]"
                  : "h-8 border-[#c8ddd2] bg-white text-[#386453] hover:bg-[#f1faf5]"
              }
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </Button>
          ))}
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-8 text-xs text-[#356a55]"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </div>

        {shown.length ? (
          <Accordion
            type="multiple"
            value={openIds}
            onValueChange={setOpenIds}
            className="space-y-2"
          >
            {shown.map(spec => {
              const needsReview = spec.requiresProfessionalReview;
              return (
                <AccordionItem
                  key={spec.id}
                  value={spec.id}
                  className="overflow-hidden rounded-xl border border-[#dce7e1] bg-white px-0 shadow-sm transition-colors hover:border-[#b8d7c6]"
                >
                  <AccordionTrigger className="min-h-14 px-4 py-3 text-left hover:no-underline sm:px-5">
                    <div className="min-w-0 pr-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#2b453b]">
                          {spec.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            needsReview
                              ? "border-[#e7c9a8] bg-[#fff8ee] text-[#935b24]"
                              : "border-[#bde0cd] bg-[#effaf3] text-[#206140]"
                          }
                        >
                          {needsReview ? "必须专业复核" : "实时计算"}
                        </Badge>
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-[#617b70]">
                        {spec.exampleSummary}
                      </p>
                      <p className="mt-1 text-xs text-[#799087]">
                        <span className="font-mono">{spec.id}</span>
                        <span className="mx-1.5 text-[#bdc9c3]">·</span>
                        {spec.inputs.length} 个输入项 · {spec.outputs.length}{" "}
                        个结果项
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-[#67917f]" />
                  </AccordionTrigger>
                  <AccordionContent className="data-[state=closed]:animate-none data-[state=open]:animate-none border-t border-[#edf2ef] bg-[#fcfefd] px-4 pb-4 pt-4 sm:px-5">
                    <div className="mb-3 grid gap-2 rounded-lg border border-[#dbe9e1] bg-[#f5fbf7] p-3 text-xs leading-5 text-[#426556] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <p>
                        <strong className="text-[#245a47]">计算依据：</strong>
                        <span className="font-mono">{spec.formula}</span>
                      </p>
                      <p>
                        <strong className="text-[#245a47]">使用边界：</strong>
                        {spec.riskNotice}
                      </p>
                    </div>
                    <EngineeringCalculatorPanel spec={spec} />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          <div className="rounded-xl border border-dashed border-[#cdded6] bg-[#f8fbf9] px-4 py-8 text-center text-sm text-[#597468]">
            未找到匹配的计算工具。可清除筛选或更换关键词后重试。
          </div>
        )}

        {shown.length < matched.length ? (
          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant="outline"
              className="border-[#99c3b0] bg-white text-[#235d49] hover:bg-[#f1faf5]"
              onClick={() =>
                setVisibleCount(current =>
                  Math.min(current + initialVisibleCount, matched.length)
                )
              }
            >
              继续加载 {initialVisibleCount} 个工具（已显示 {shown.length}/
              {matched.length}）
            </Button>
          </div>
        ) : null}

        <p className="flex items-start gap-2 rounded-lg border border-[#f0dcc3] bg-[#fff9f2] px-3 py-2.5 text-xs leading-5 text-[#74513a]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b66b2c]" />
          计算结果用于方案比较和辅助复核；涉及设计参数、现场条件、现行规范或安全边界时，须由专业人员确认。
        </p>
      </CardContent>
    </Card>
  );
}
