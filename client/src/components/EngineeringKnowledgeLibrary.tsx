import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Calculator,
  ChevronDown,
  CircleHelp,
  FileText,
  Search,
  ShieldAlert,
  ListFilter,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EngineeringCalculatorPanel } from "@/components/EngineeringCalculatorPanel";
import { getEngineeringCalculatorSpec } from "@/lib/engineering-calculators";
import buildingSource from "../../../docs/proposals/工程工具知识全量清单/01_建筑结构房建市政_45项.md?raw";
import materialSource from "../../../docs/proposals/工程工具知识全量清单/02_材料标准配比试验_40项.md?raw";
import earthworkSource from "../../../docs/proposals/工程工具知识全量清单/03_土工路基边坡地基_45项.md?raw";
import roadSource from "../../../docs/proposals/工程工具知识全量清单/04_公路路线桥涵隧道_35项.md?raw";
import railwaySource from "../../../docs/proposals/工程工具知识全量清单/05_铁路路基轨道桥隧_56项.md?raw";
import surveySource from "../../../docs/proposals/工程工具知识全量清单/06_工程测量工程量计算_46项.md?raw";
import machinerySource from "../../../docs/proposals/工程工具知识全量清单/07_施工机械运输成本_48项.md?raw";
import settlementSource from "../../../docs/proposals/工程工具知识全量清单/08_计量结算合同专业术语_40项.md?raw";

export type KnowledgeTab =
  | "建筑市政"
  | "材料配比"
  | "土工路基"
  | "公路"
  | "铁路"
  | "测量工程量"
  | "机械运输"
  | "计量结算";
type KnowledgeForm = "自动计算器" | "查表/材料标准" | "步骤模板" | "术语词典";
type KnowledgeRisk = "绿色" | "黄色" | "红色";
type KnowledgeLibraryProps = {
  /** 分类工作台传入固定专业；未传入时保留原来的全量知识库。 */
  tab?: "全部" | KnowledgeTab;
  hideTabNavigation?: boolean;
  showCalculatorPanels?: boolean;
  /** 嵌入分类工作台时压缩重复标题。 */
  compact?: boolean;
  testId?: string;
};

export type EngineeringKnowledgeItem = {
  id: string;
  tab: KnowledgeTab;
  tabLabel: string;
  subcategory: string;
  name: string;
  definition: string;
  formula: string;
  variables: string;
  example: string;
  result: string;
  caution: string;
  standard: string;
  controls: string;
  automatable: string;
  form: KnowledgeForm;
  risk: KnowledgeRisk;
};

const TAB_CONFIG: {
  id: KnowledgeTab;
  label: string;
  short: string;
  source: string;
}[] = [
  {
    id: "建筑市政",
    label: "建筑市政",
    short: "房建、结构与市政",
    source: buildingSource,
  },
  {
    id: "材料配比",
    label: "材料配比试验",
    short: "材料、配比与试验",
    source: materialSource,
  },
  {
    id: "土工路基",
    label: "土工路基边坡",
    short: "土工、路基与地基",
    source: earthworkSource,
  },
  { id: "公路", label: "公路", short: "路线、桥涵与隧道", source: roadSource },
  {
    id: "铁路",
    label: "铁路",
    short: "路基、轨道与站场",
    source: railwaySource,
  },
  {
    id: "测量工程量",
    label: "测量工程量",
    short: "测量、放样与工程量",
    source: surveySource,
  },
  {
    id: "机械运输",
    label: "机械运输成本",
    short: "机械、运输与成本",
    source: machinerySource,
  },
  {
    id: "计量结算",
    label: "计量结算术语",
    short: "计量、合同与术语",
    source: settlementSource,
  },
];
const FIELD_NAMES = [
  "编号",
  "二级分类",
  "名称",
  "定义与适用场景",
  "公式或操作步骤",
  "全部变量与单位",
  "完整数值示例",
  "结果解释",
  "注意事项与禁用边界",
  "注意事项及禁用边界",
  "关联标准/规程",
  "建议页面控件",
  "是否适合自动计算",
];
const compact = (value: string | undefined) =>
  (value ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function field(block: string, label: string) {
  const current = `(?:-\\s*)?(?:\\*\\*)?${escaped(label)}(?:\\*\\*)?[:：]`;
  const following = `(?:-\\s*)?(?:\\*\\*)?(?:${FIELD_NAMES.map(escaped).join("|")})(?:\\*\\*)?[:：]`;
  return compact(
    block.match(
      new RegExp(
        `(?:^|\\n)${current}\\s*([\\s\\S]*?)(?=\\n${following}|\\n#{2,3}\\s|$)`,
        "m"
      )
    )?.[1]
  );
}
const normaliseHeading = (value: string) =>
  value
    .replace(/^\d+(?:\.\d+)?[.、\s]*/, "")
    .replace(/^【.*?】\s*/, "")
    .trim();
function inferForm(
  name: string,
  formula: string,
  automatable: string
): KnowledgeForm {
  if (/^是|可自动|自动计算/.test(automatable)) return "自动计算器";
  if (/术语|定义|概念|简称|名词/.test(name)) return "术语词典";
  if (/标准|等级|指标|材料|配比|试验|规程/.test(name)) return "查表/材料标准";
  return formula ? "自动计算器" : "步骤模板";
}
function inferRisk(name: string, caution: string): KnowledgeRisk {
  const content = `${name} ${caution}`;
  if (
    /高风险|爆破|临电|吊装|边坡稳定|深基坑|结构安全|隧道监测|轨道几何|危大|承载力/.test(
      content
    )
  )
    return "红色";
  if (/设计|合同|试验|项目参数|现场|规范|复核|索赔|变更|结算/.test(content))
    return "黄色";
  return "绿色";
}
function parseSource(source: string, config: (typeof TAB_CONFIG)[number]) {
  const blocks = source
    .split(/(?=^#{2,3}\s+)/m)
    .filter(block => /(?:\*\*)?二级分类(?:\*\*)?[:：]/.test(block));
  return blocks.map((block, index): EngineeringKnowledgeItem => {
    const heading = normaliseHeading(
      block.match(/^#{2,3}\s+(.+)$/m)?.[1] ?? ""
    );
    const caution =
      field(block, "注意事项与禁用边界") ||
      field(block, "注意事项及禁用边界") ||
      "系统仅提供资料查阅、记录或辅助计算；涉及设计参数、现场条件和现行规范要求时，必须由项目专业人员复核。";
    const formula = field(block, "公式或操作步骤");
    const rawAutomatable = field(block, "是否适合自动计算");
    const name = field(block, "名称") || heading;
    const id =
      field(block, "编号") ||
      `${config.id}-${String(index + 1).padStart(3, "0")}`;
    const requestedForm = inferForm(name, formula, rawAutomatable);
    const hasExecutableCalculator = Boolean(
      getEngineeringCalculatorSpec(id, name)
    );
    const isIncompleteAutomatic =
      requestedForm === "自动计算器" && !hasExecutableCalculator;
    return {
      id,
      tab: config.id,
      tabLabel: config.label,
      subcategory: field(block, "二级分类") || "综合",
      name,
      definition:
        field(block, "定义与适用场景") ||
        "本条目用于工程施工方案、学习或辅助复核，具体适用性需结合设计文件、合同约定和现场条件确认。",
      formula,
      variables: field(block, "全部变量与单位"),
      example: field(block, "完整数值示例"),
      result: field(block, "结果解释"),
      caution,
      standard:
        field(block, "关联标准/规程") ||
        "实施前复核适用的国家、行业、地方标准、设计文件及合同约定。",
      controls: field(block, "建议页面控件"),
      automatable: isIncompleteAutomatic
        ? "仪器读数/专业参数记录"
        : hasExecutableCalculator
          ? "是（已接入实时计算）"
          : rawAutomatable,
      form: hasExecutableCalculator
        ? "自动计算器"
        : isIncompleteAutomatic
          ? "步骤模板"
          : requestedForm,
      risk: inferRisk(name, caution),
    };
  });
}

export const ENGINEERING_KNOWLEDGE_ITEMS = TAB_CONFIG.flatMap(config =>
  parseSource(config.source, config)
);
export const ENGINEERING_KNOWLEDGE_TOTAL = ENGINEERING_KNOWLEDGE_ITEMS.length;

function RiskBadge({ risk }: { risk: KnowledgeRisk }) {
  const styles: Record<KnowledgeRisk, string> = {
    绿色: "border-[#bde0cd] bg-[#effaf3] text-[#206140]",
    黄色: "border-[#ead6a7] bg-[#fff8e8] text-[#92620c]",
    红色: "border-[#edc2bd] bg-[#fff1ef] text-[#a5392e]",
  };
  const labels: Record<KnowledgeRisk, string> = {
    绿色: "可直接查阅",
    黄色: "需项目参数",
    红色: "必须专业复核",
  };
  return (
    <Badge variant="outline" className={styles[risk]}>
      {labels[risk]}
    </Badge>
  );
}

function DetailSection({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "formula" | "warning";
}) {
  if (!value) return null;
  const classes =
    tone === "formula"
      ? "border-[#c8ded6] bg-[#f3faf7] text-[#1e5848]"
      : tone === "warning"
        ? "border-[#efd2b9] bg-[#fff8ef] text-[#7d4d2d]"
        : "border-[#ebe1d6] bg-[#fffcf8] text-[#594d45]";
  return (
    <section className={`rounded-xl border p-3 ${classes}`}>
      <p className="mb-1.5 text-xs font-semibold tracking-wide">{label}</p>
      <div
        className={`whitespace-pre-wrap text-sm leading-6 ${tone === "formula" ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </section>
  );
}

function KnowledgeDetail({
  item,
  showCalculatorPanel,
}: {
  item: EngineeringKnowledgeItem;
  showCalculatorPanel: boolean;
}) {
  const calculator =
    item.form === "自动计算器"
      ? getEngineeringCalculatorSpec(item.id, item.name)
      : undefined;
  return (
    <div className="space-y-3">
      {showCalculatorPanel && calculator ? (
        <EngineeringCalculatorPanel key={calculator.id} spec={calculator} />
      ) : null}
      <DetailSection label="定义与适用场景" value={item.definition} />
      <div className="grid gap-3 xl:grid-cols-2">
        <DetailSection
          label="公式或操作步骤"
          value={item.formula}
          tone="formula"
        />
        <DetailSection label="全部变量与单位" value={item.variables} />
        <DetailSection label="完整数值示例" value={item.example} />
        <DetailSection label="结果解释" value={item.result} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DetailSection label="关联标准/规程" value={item.standard} />
        <DetailSection
          label="注意事项与禁用边界"
          value={item.caution}
          tone="warning"
        />
      </div>
    </div>
  );
}

const FORM_FILTERS: { id: "all" | KnowledgeForm; label: string }[] = [
  { id: "all", label: "全部类型" },
  { id: "自动计算器", label: "自动计算器" },
  { id: "查表/材料标准", label: "材料标准" },
  { id: "步骤模板", label: "步骤模板" },
  { id: "术语词典", label: "术语词典" },
];
const RISK_FILTERS: { id: "all" | KnowledgeRisk; label: string }[] = [
  { id: "all", label: "全部风险" },
  { id: "绿色", label: "可直接查阅" },
  { id: "黄色", label: "需项目参数" },
  { id: "红色", label: "必须专业复核" },
];

export default function EngineeringKnowledgeLibrary({
  tab: fixedTab,
  hideTabNavigation = false,
  showCalculatorPanels = true,
  compact = false,
  testId,
}: KnowledgeLibraryProps) {
  const [selectedTab, setSelectedTab] = useState<"全部" | KnowledgeTab>(
    fixedTab ?? "全部"
  );
  const [query, setQuery] = useState("");
  const [formFilter, setFormFilter] = useState<"all" | KnowledgeForm>("all");
  const [riskFilter, setRiskFilter] = useState<"all" | KnowledgeRisk>("all");
  const [showHelp, setShowHelp] = useState(false);
  const [openItemIds, setOpenItemIds] = useState<string[]>([]);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {}
  );
  const [visibleGroupCount, setVisibleGroupCount] = useState(compact ? 3 : 6);
  const activeTab = fixedTab ?? selectedTab;
  const groupPageSize = compact ? 8 : 12;
  const categoryPageSize = compact ? 3 : 6;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return ENGINEERING_KNOWLEDGE_ITEMS.filter(item => {
      if (activeTab !== "全部" && item.tab !== activeTab) return false;
      if (formFilter !== "all" && item.form !== formFilter) return false;
      if (riskFilter !== "all" && item.risk !== riskFilter) return false;
      if (!keyword) return true;
      return [
        item.id,
        item.name,
        item.subcategory,
        item.definition,
        item.formula,
        item.variables,
        item.example,
        item.standard,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [activeTab, formFilter, query, riskFilter]);

  const groups = useMemo(
    () => Array.from(new Set(filtered.map(item => item.subcategory))),
    [filtered]
  );
  const currentTab = TAB_CONFIG.find(item => item.id === activeTab);
  const hasFilters =
    Boolean(query.trim()) || formFilter !== "all" || riskFilter !== "all";
  const shownGroups = groups.slice(0, visibleGroupCount);

  useEffect(() => {
    setVisibleCounts({});
    setVisibleGroupCount(categoryPageSize);
    // 搜索、切换专业或条件时始终保持折叠，避免一次性展开几十个详情。
    setOpenItemIds([]);
  }, [activeTab, categoryPageSize, formFilter, query, riskFilter]);

  useEffect(() => {
    if (fixedTab) setSelectedTab(fixedTab);
  }, [fixedTab]);

  const title =
    currentTab && fixedTab
      ? `${currentTab.label} · 知识与标准`
      : "工程工具知识库";
  const description =
    currentTab && fixedTab
      ? `${currentTab.short}共 ${filtered.length} 项资料。此处保留标准、示例和边界；自动计算请在上方业务区完成。`
      : `已接入 ${ENGINEERING_KNOWLEDGE_TOTAL} 项审校内容。按专业、条目类型和风险级别筛选后展开查看依据、示例与适用边界。`;

  return (
    <section
      id="engineering-knowledge-library"
      data-testid={testId}
      className="scroll-mt-6 space-y-3"
    >
      <Card className="overflow-hidden border-[#b8d4ca] bg-white shadow-[0_10px_24px_rgba(29,78,62,.06)]">
        <CardHeader
          className={`border-b border-[#d9e7df] bg-[linear-gradient(135deg,#f4fbf7,#edf5f1)] ${compact ? "space-y-2 px-4 py-3.5 sm:px-5" : "space-y-3 p-4 sm:p-5"}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base text-[#234c3f] sm:text-lg">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e1f1e9] text-[#187157]">
                  <BookOpenCheck className="h-4 w-4" />
                </span>
                {title}
              </CardTitle>
              <CardDescription className="mt-1.5 max-w-3xl leading-5">
                {description}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[#a8c8bb] bg-white text-[#245b49] hover:bg-[#f2faf6]"
              onClick={() => setShowHelp(current => !current)}
            >
              <CircleHelp className="mr-1.5 h-4 w-4" />
              使用说明
            </Button>
          </div>
          {showHelp ? (
            <div className="grid gap-3 rounded-xl border border-[#c7ddd2] bg-white/80 p-3 text-sm leading-6 text-[#405b50] md:grid-cols-3">
              <p>
                <strong className="text-[#1b5542]">第一步：</strong>
                选择专业、条目类型或风险级别，并按名称、标准、公式、术语检索。
              </p>
              <p>
                <strong className="text-[#1b5542]">第二步：</strong>
                展开单个条目，依次查看适用范围、依据、示例与结果解释。
              </p>
              <p>
                <strong className="text-[#8a4c25]">安全边界：</strong>
                红色内容只作辅助资料，必须由设计、试验或专业人员复核。
              </p>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 p-4 sm:p-5">
          {!hideTabNavigation ? (
            <Tabs
              value={activeTab}
              onValueChange={value =>
                setSelectedTab(value as "全部" | KnowledgeTab)
              }
            >
              <div className="overflow-x-auto pb-1">
                <TabsList className="h-auto min-w-max justify-start gap-1 rounded-xl bg-[#eaf4ef] p-1.5">
                  <TabsTrigger value="全部">
                    全部 {ENGINEERING_KNOWLEDGE_TOTAL}
                  </TabsTrigger>
                  {TAB_CONFIG.map(item => (
                    <TabsTrigger key={item.id} value={item.id}>
                      {item.label}{" "}
                      {
                        ENGINEERING_KNOWLEDGE_ITEMS.filter(
                          row => row.tab === item.id
                        ).length
                      }
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-[#28735a]" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-11 border-[#9bc6b3] bg-white pl-9 pr-24 shadow-sm focus-visible:ring-[#27775c]"
                placeholder={
                  currentTab && fixedTab
                    ? `搜索${currentTab.label}知识、标准、术语或示例`
                    : "全局搜索：名称、公式、变量、示例、标准或术语"
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
              匹配 <strong className="mx-1">{filtered.length}</strong> 项
            </div>
          </div>

          <div
            aria-label="知识资料筛选"
            className="grid gap-2 rounded-xl border border-[#e0ebe5] bg-[#fbfdfc] p-2 sm:grid-cols-[auto_minmax(160px,1fr)_minmax(160px,1fr)_auto] sm:items-center"
          >
            <span className="px-1 text-xs font-medium text-[#557466]">
              筛选条件
            </span>
            <label className="sr-only" htmlFor="knowledge-form-filter">
              条目类型
            </label>
            <select
              id="knowledge-form-filter"
              value={formFilter}
              onChange={event =>
                setFormFilter(event.target.value as "all" | KnowledgeForm)
              }
              className="h-9 rounded-md border border-[#c8ddd2] bg-white px-2 text-sm text-[#386453] outline-none focus:ring-2 focus:ring-[#27775c]"
            >
              {FORM_FILTERS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="knowledge-risk-filter">
              复核要求
            </label>
            <select
              id="knowledge-risk-filter"
              value={riskFilter}
              onChange={event =>
                setRiskFilter(event.target.value as "all" | KnowledgeRisk)
              }
              className="h-9 rounded-md border border-[#c8ddd2] bg-white px-2 text-sm text-[#386453] outline-none focus:ring-2 focus:ring-[#27775c]"
            >
              {RISK_FILTERS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-[#356a55]"
                onClick={() => {
                  setQuery("");
                  setFormFilter("all");
                  setRiskFilter("all");
                }}
              >
                清除筛选
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <Card className="border-dashed border-[#d5ddd8]">
          <CardContent className="p-8 text-center text-sm text-slate-500">
            没有匹配的知识条目。可清除筛选或更换关键词后重试。
          </CardContent>
        </Card>
      ) : (
        shownGroups.map(group => {
          const groupItems = filtered.filter(
            item => item.subcategory === group
          );
          const limit = visibleCounts[group] ?? groupPageSize;
          const shownItems = groupItems.slice(0, limit);
          return (
            <section
              key={group}
              className="overflow-hidden rounded-xl border border-[#dfe9e4] bg-[#fbfdfc]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5eee9] bg-[#f4faf7] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-1 rounded-full bg-[#1d8160]" />
                  <h3 className="text-sm font-semibold text-[#274b3e]">
                    {group}
                  </h3>
                  <Badge
                    variant="secondary"
                    className="bg-[#e1f1e9] text-[#356a55]"
                  >
                    {groupItems.length} 项
                  </Badge>
                </div>
                <span className="text-xs text-[#6d887b]">
                  已显示 {shownItems.length}/{groupItems.length}
                </span>
              </div>
              <div className="space-y-2 p-3">
                <Accordion
                  type="multiple"
                  value={openItemIds.filter(id =>
                    shownItems.some(item => item.id === id)
                  )}
                  onValueChange={setOpenItemIds}
                  className="space-y-2"
                >
                  {shownItems.map(item => (
                    <AccordionItem
                      key={item.id}
                      value={item.id}
                      className="overflow-hidden rounded-xl border border-[#dce7e1] bg-white px-0 shadow-sm transition-colors hover:border-[#b8d7c6]"
                    >
                      <AccordionTrigger className="min-h-14 px-4 py-3 text-left hover:no-underline sm:px-5">
                        <div className="min-w-0 pr-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#2b453b]">
                              {item.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="border-[#c6ddd2] bg-[#f8fcfa] text-[#367260]"
                            >
                              {item.form}
                            </Badge>
                            <RiskBadge risk={item.risk} />
                          </div>
                          <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-[#617b70]">
                            {item.definition}
                          </p>
                          <p className="mt-1 text-xs text-[#799087]">
                            <span className="font-mono">{item.id}</span>
                            <span className="mx-1.5 text-[#bdc9c3]">·</span>
                            {item.tabLabel}
                          </p>
                        </div>
                        <ChevronDown className="h-4 w-4 shrink-0 text-[#67917f]" />
                      </AccordionTrigger>
                      <AccordionContent className="data-[state=closed]:animate-none data-[state=open]:animate-none border-t border-[#edf2ef] bg-[#fcfefd] px-4 pb-4 pt-4 sm:px-5">
                        <KnowledgeDetail
                          item={item}
                          showCalculatorPanel={showCalculatorPanels}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                {shownItems.length < groupItems.length ? (
                  <div className="flex justify-center pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-[#a8cdbb] bg-white text-[#235d49] hover:bg-[#f1faf5]"
                      onClick={() =>
                        setVisibleCounts(current => ({
                          ...current,
                          [group]: Math.min(
                            (current[group] ?? groupPageSize) + groupPageSize,
                            groupItems.length
                          ),
                        }))
                      }
                    >
                      <FileText className="mr-1.5 h-4 w-4" />
                      加载更多（已显示 {shownItems.length}/{groupItems.length}）
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>
          );
        })
      )}
      {shownGroups.length < groups.length ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="border-[#a8cdbb] bg-white text-[#235d49] hover:bg-[#f1faf5]"
            onClick={() =>
              setVisibleGroupCount(current =>
                Math.min(current + categoryPageSize, groups.length)
              )
            }
          >
            <ListFilter className="mr-1.5 h-4 w-4" />
            加载更多分类（已显示 {shownGroups.length}/{groups.length}）
          </Button>
        </div>
      ) : null}
      <p className="flex items-start gap-2 rounded-xl border border-[#f0dcc3] bg-[#fff9f2] px-4 py-3 text-xs leading-5 text-[#74513a]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b66b2c]" />
        <span>
          <strong>统一使用边界：</strong>
          材料配比仅作参考，不能替代试验室试配；结构安全、爆破、临电、吊装、边坡、隧道监测与轨道限值等高风险内容，系统只提供记录、查阅或辅助计算，不作无条件自动判定。
        </span>
      </p>
    </section>
  );
}
