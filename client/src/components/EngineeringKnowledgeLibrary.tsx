import React, { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Calculator, ChevronDown, CircleHelp, FileText, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import buildingSource from "../../../docs/proposals/工程工具知识全量清单/01_建筑结构房建市政_45项.md?raw";
import materialSource from "../../../docs/proposals/工程工具知识全量清单/02_材料标准配比试验_40项.md?raw";
import earthworkSource from "../../../docs/proposals/工程工具知识全量清单/03_土工路基边坡地基_45项.md?raw";
import roadSource from "../../../docs/proposals/工程工具知识全量清单/04_公路路线桥涵隧道_35项.md?raw";
import railwaySource from "../../../docs/proposals/工程工具知识全量清单/05_铁路路基轨道桥隧_56项.md?raw";
import surveySource from "../../../docs/proposals/工程工具知识全量清单/06_工程测量工程量计算_46项.md?raw";
import machinerySource from "../../../docs/proposals/工程工具知识全量清单/07_施工机械运输成本_48项.md?raw";
import settlementSource from "../../../docs/proposals/工程工具知识全量清单/08_计量结算合同专业术语_40项.md?raw";

type KnowledgeTab = "建筑市政" | "材料配比" | "土工路基" | "公路" | "铁路" | "测量工程量" | "机械运输" | "计量结算";
type KnowledgeForm = "自动计算器" | "查表/材料标准" | "步骤模板" | "术语词典";
type KnowledgeRisk = "绿色" | "黄色" | "红色";

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

const TAB_CONFIG: { id: KnowledgeTab; label: string; short: string; source: string; expected: number }[] = [
  { id: "建筑市政", label: "建筑市政", short: "房建、结构与市政", source: buildingSource, expected: 45 },
  { id: "材料配比", label: "材料配比试验", short: "材料、配比与试验", source: materialSource, expected: 40 },
  { id: "土工路基", label: "土工路基边坡", short: "土工、路基与地基", source: earthworkSource, expected: 40 },
  { id: "公路", label: "公路", short: "路线、桥涵与隧道", source: roadSource, expected: 35 },
  { id: "铁路", label: "铁路", short: "路基、轨道与站场", source: railwaySource, expected: 62 },
  { id: "测量工程量", label: "测量工程量", short: "测量、放样与工程量", source: surveySource, expected: 46 },
  { id: "机械运输", label: "机械运输成本", short: "机械、运输与成本", source: machinerySource, expected: 48 },
  { id: "计量结算", label: "计量结算术语", short: "计量、合同与术语", source: settlementSource, expected: 40 },
];

function compact(value: string | undefined) {
  return (value ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FIELD_NAMES = ["编号", "二级分类", "名称", "定义与适用场景", "公式或操作步骤", "全部变量与单位", "完整数值示例", "结果解释", "注意事项与禁用边界", "注意事项及禁用边界", "关联标准/规程", "建议页面控件", "是否适合自动计算"];

function field(block: string, label: string) {
  const current = `(?:-\\s*)?(?:\\*\\*)?${escaped(label)}(?:\\*\\*)?[:：]`;
  const following = `(?:-\\s*)?(?:\\*\\*)?(?:${FIELD_NAMES.map(escaped).join("|")})(?:\\*\\*)?[:：]`;
  const matcher = new RegExp(`(?:^|\\n)${current}\\s*([\\s\\S]*?)(?=\\n${following}|\\n#{2,3}\\s|$)`, "m");
  return compact(block.match(matcher)?.[1]);
}

function normaliseHeading(value: string) {
  return value.replace(/^\d+(?:\.\d+)?[.、\s]*/, "").replace(/^【.*?】\s*/, "").trim();
}

function inferForm(name: string, formula: string, automatable: string): KnowledgeForm {
  if (/^是|可自动|自动计算/.test(automatable)) return "自动计算器";
  if (/术语|定义|概念|简称|名词/.test(name)) return "术语词典";
  if (/标准|等级|指标|材料|配比|试验|规程/.test(name)) return "查表/材料标准";
  return formula ? "自动计算器" : "步骤模板";
}

function inferRisk(name: string, caution: string): KnowledgeRisk {
  const content = `${name} ${caution}`;
  if (/高风险|爆破|临电|吊装|边坡稳定|深基坑|结构安全|隧道监测|轨道几何|危大|承载力/.test(content)) return "红色";
  if (/设计|合同|试验|项目参数|现场|规范|复核|索赔|变更|结算/.test(content)) return "黄色";
  return "绿色";
}

function parseSource(source: string, config: (typeof TAB_CONFIG)[number]) {
  const blocks = source.split(/(?=^#{2,3}\s+)/m).filter(block => /(?:\*\*)?二级分类(?:\*\*)?[:：]/.test(block));
  return blocks.map((block, index): EngineeringKnowledgeItem => {
    const heading = normaliseHeading(block.match(/^#{2,3}\s+(.+)$/m)?.[1] ?? "");
    const definition = field(block, "定义与适用场景");
    const formula = field(block, "公式或操作步骤");
    const variables = field(block, "全部变量与单位");
    const example = field(block, "完整数值示例");
    const result = field(block, "结果解释");
    const caution = field(block, "注意事项与禁用边界") || field(block, "注意事项及禁用边界") || "系统仅提供资料查阅、记录或辅助计算；涉及设计参数、现场条件和现行规范要求时，必须由项目专业人员复核。";
    const standard = field(block, "关联标准/规程");
    const controls = field(block, "建议页面控件");
    const automatable = field(block, "是否适合自动计算");
    const name = field(block, "名称") || heading;
    const id = field(block, "编号") || `${config.id}-${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      tab: config.id,
      tabLabel: config.label,
      subcategory: field(block, "二级分类") || "综合",
      name,
      definition: definition || "本条目用于工程施工方案、学习或辅助复核，具体适用性需结合设计文件、合同约定和现场条件确认。",
      formula,
      variables,
      example,
      result,
      caution,
      standard: standard || "实施前复核适用的国家、行业、地方标准、设计文件及合同约定。",
      controls,
      automatable,
      form: inferForm(name, formula, automatable),
      risk: inferRisk(name, caution),
    };
  });
}

export const ENGINEERING_KNOWLEDGE_ITEMS = TAB_CONFIG.flatMap(config => parseSource(config.source, config));
export const ENGINEERING_KNOWLEDGE_TOTAL = ENGINEERING_KNOWLEDGE_ITEMS.length;

function RiskBadge({ risk }: { risk: KnowledgeRisk }) {
  const styles: Record<KnowledgeRisk, string> = {
    绿色: "border-[#bde0cd] bg-[#effaf3] text-[#206140]",
    黄色: "border-[#ead6a7] bg-[#fff8e8] text-[#92620c]",
    红色: "border-[#edc2bd] bg-[#fff1ef] text-[#a5392e]",
  };
  return <Badge variant="outline" className={styles[risk]}>{risk === "绿色" ? "可直接查阅" : risk === "黄色" ? "需项目参数" : "必须专业复核"}</Badge>;
}

function DetailSection({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "formula" | "warning" }) {
  if (!value) return null;
  const classes = tone === "formula" ? "border-[#c8ded6] bg-[#f3faf7] text-[#1e5848] font-mono" : tone === "warning" ? "border-[#efd2b9] bg-[#fff8ef] text-[#7d4d2d]" : "border-[#ebe1d6] bg-[#fffcf8] text-[#594d45]";
  return <section className={`rounded-xl border p-3 ${classes}`}><p className="mb-1 text-xs font-semibold tracking-wide">{label}</p><div className="whitespace-pre-wrap text-sm leading-6">{value}</div></section>;
}

/** 355项工程工具知识：从审校后的八个专业分卷直接解析，避免手工二次录入和内容脱节。 */
export default function EngineeringKnowledgeLibrary() {
  const [tab, setTab] = useState<"全部" | KnowledgeTab>("全部");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const [showHelp, setShowHelp] = useState(false);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return ENGINEERING_KNOWLEDGE_ITEMS.filter(item => {
      if (tab !== "全部" && item.tab !== tab) return false;
      if (!keyword) return true;
      return [item.id, item.name, item.subcategory, item.definition, item.formula, item.variables, item.example, item.standard].join(" ").toLocaleLowerCase().includes(keyword);
    });
  }, [query, tab]);
  const shown = filtered.slice(0, visibleCount);
  const groups = useMemo(() => Array.from(new Set(shown.map(item => item.subcategory))), [shown]);
  const currentTab = TAB_CONFIG.find(item => item.id === tab);
  useEffect(() => setVisibleCount(24), [query, tab]);

  return <section id="engineering-knowledge-library" className="scroll-mt-6 space-y-4">
    <Card className="overflow-hidden border-[#b8d4ca] shadow-[0_12px_30px_rgba(29,78,62,.08)]">
      <CardHeader className="border-b border-[#d9e7df] bg-[linear-gradient(135deg,#f4fbf7,#edf5f1)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2 text-lg text-[#234c3f]"><BookOpenCheck className="h-5 w-5 text-[#187157]" />工程工具知识库</CardTitle><CardDescription className="mt-1.5 max-w-3xl leading-6">已接入 {ENGINEERING_KNOWLEDGE_TOTAL} 项审校内容，按专业 Tab 分类查询。每条均保留公式或步骤、变量单位、示例、标准和风险边界；内容用于学习、方案测算及辅助复核。</CardDescription></div>
          <Button type="button" variant="outline" className="border-[#a8c8bb] bg-white text-[#245b49] hover:bg-[#f2faf6]" onClick={() => setShowHelp(current => !current)}><CircleHelp className="mr-1.5 h-4 w-4" />使用说明</Button>
        </div>
        {showHelp ? <div className="mt-4 grid gap-3 rounded-xl border border-[#c7ddd2] bg-white/80 p-4 text-sm leading-6 text-[#405b50] md:grid-cols-3"><p><strong className="text-[#1b5542]">第一步：</strong>选择专业 Tab 或输入关键词，例如“压实度”“盖梁”“K30”“钢筋”。</p><p><strong className="text-[#1b5542]">第二步：</strong>展开条目查看完整定义、公式、变量、示例和建议控件。</p><p><strong className="text-[#8a4c25]">安全边界：</strong>红色内容仅可辅助记录或计算，必须由设计、试验或专业人员复核。</p></div> : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <Tabs value={tab} onValueChange={value => setTab(value as "全部" | KnowledgeTab)}>
          <div className="overflow-x-auto pb-1"><TabsList className="h-auto min-w-max justify-start gap-1 rounded-xl bg-[#eaf4ef] p-1.5"><TabsTrigger value="全部">全部 {ENGINEERING_KNOWLEDGE_TOTAL}</TabsTrigger>{TAB_CONFIG.map(item => <TabsTrigger key={item.id} value={item.id}>{item.label} {ENGINEERING_KNOWLEDGE_ITEMS.filter(row => row.tab === item.id).length}</TabsTrigger>)}</TabsList></div>
        </Tabs>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#789187]" /><Input value={query} onChange={event => setQuery(event.target.value)} className="border-[#cadbd3] bg-white pl-9" placeholder="搜索编号、名称、公式、材料、构件或专业术语" /></div>
          <div className="rounded-lg border border-[#dbe8e2] bg-[#f7fbf9] px-3 py-2 text-sm text-[#386453]"><SlidersHorizontal className="mr-1.5 inline h-4 w-4" />{currentTab ? `${currentTab.short} · ` : "全部专业 · "}匹配 <strong>{filtered.length}</strong> 项</div>
        </div>
      </CardContent>
    </Card>

    {groups.length === 0 ? <Card className="border-dashed border-[#d5ddd8]"><CardContent className="p-8 text-center text-sm text-slate-500">没有匹配的知识条目，请尝试减少关键词或切换专业分类。</CardContent></Card> : groups.map(group => <section key={group} className="space-y-3"><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-[#1d8160]" /><h3 className="text-base font-semibold text-[#274b3e]">{group}</h3><Badge variant="secondary" className="bg-[#eaf4ef] text-[#356a55]">{shown.filter(item => item.subcategory === group).length} 项</Badge></div><Accordion type="multiple" className="space-y-2">{shown.filter(item => item.subcategory === group).map(item => <AccordionItem key={item.id} value={item.id} className="overflow-hidden rounded-xl border border-[#dce7e1] bg-white px-0 shadow-sm"><AccordionTrigger className="px-4 py-3.5 text-left hover:no-underline"><div className="min-w-0 pr-2"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#2b453b]">{item.name}</span><Badge variant="outline" className="border-[#c6ddd2] text-[#367260]">{item.form}</Badge><RiskBadge risk={item.risk} /></div><p className="mt-1 text-xs text-[#799087]"><span className="font-mono">{item.id}</span> · {item.tabLabel} · {item.automatable ? `自动计算：${item.automatable}` : "资料查阅"}</p></div><ChevronDown className="h-4 w-4 shrink-0 text-[#67917f]" /></AccordionTrigger><AccordionContent className="border-t border-[#edf2ef] px-4 pb-4 pt-4"><div className="grid gap-3 xl:grid-cols-2"><DetailSection label="定义与适用场景" value={item.definition} /><DetailSection label="公式或操作步骤" value={item.formula} tone="formula" /><DetailSection label="全部变量与单位" value={item.variables} /><DetailSection label="完整数值示例" value={item.example} /><DetailSection label="结果解释" value={item.result} /><DetailSection label="注意事项与禁用边界" value={item.caution} tone="warning" /><DetailSection label="关联标准/规程" value={item.standard} /><DetailSection label="建议页面控件" value={item.controls} /></div></AccordionContent></AccordionItem>)}</Accordion></section>)}
    {shown.length < filtered.length ? <div className="flex justify-center pt-1"><Button type="button" variant="outline" className="border-[#99c3b0] bg-white text-[#235d49] hover:bg-[#f1faf5]" onClick={() => setVisibleCount(current => Math.min(current + 24, filtered.length))}><FileText className="mr-1.5 h-4 w-4" />继续加载 24 项（已显示 {shown.length}/{filtered.length}）</Button></div> : null}
    <p className="rounded-xl border border-[#f0dcc3] bg-[#fff9f2] px-4 py-3 text-xs leading-5 text-[#74513a]"><ShieldAlert className="mr-1 inline h-4 w-4 align-text-bottom text-[#b66b2c]" /><strong>统一使用边界：</strong>材料配比仅作参考，不能替代试验室试配；结构安全、爆破、临电、吊装、边坡、隧道监测与轨道限值等高风险内容，系统只提供记录、查阅或辅助计算，不作无条件自动判定。</p>
  </section>;
}
