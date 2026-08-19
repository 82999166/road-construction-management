import React, { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Domain = "通用" | "公路" | "铁路" | "计量造价" | "试验检测";
type KnowledgeItem = { term: string; domain: Domain; category: string; definition: string; application: string; formula?: string };

const knowledge: KnowledgeItem[] = [
  { term: "线路等级", domain: "通用", category: "线路基础", definition: "公路按设计速度、车道数和路基宽度划分高速至四级；铁路按速度、轴重和运量划分高速、客专及普速等级。", application: "用于确定设计标准、荷载、技术规范和施工控制要求。" },
  { term: "平面线形", domain: "通用", category: "线路基础", definition: "由直线、圆曲线和缓和曲线组成，关键要素包括半径、转角、缓和曲线长、超高和加宽。", application: "用于路线放样、曲线测量、运输组织和超高施工。" },
  { term: "纵断面", domain: "通用", category: "线路基础", definition: "沿线路中心线展开的高程关系，包括纵坡、坡长、变坡点、竖曲线、填挖高度。", application: "用于控制标高、土石方、排水和竖曲线放样。" },
  { term: "挖方、填方、利用方、借方、弃方", domain: "通用", category: "土石方", definition: "挖方为开挖获得材料；填方为压实成型材料；利用方为挖填平衡使用材料；不足部分为借方，多余或不合格材料为弃方。", application: "用于土石方调配、弃土场、借土场及运距成本测算。" },
  { term: "天然方、松方、压实方", domain: "通用", category: "土石方", definition: "天然方为原状体积，松方为开挖后松散体积，压实方为填筑碾压成型体积；三者须按规范和试验确定换算系数。", application: "计量、运输方量、填料采购和分包结算必须先统一口径。" },
  { term: "平均断面法", domain: "通用", category: "土石方公式", definition: "用相邻断面面积平均值乘以断面间距估算区间体积。", application: "道路、铁路主线土石方收方的常用近似计算方法。", formula: "V = (A₁ + A₂) × L ÷ 2" },
  { term: "棱台公式", domain: "通用", category: "土石方公式", definition: "对面积变化明显的相邻断面，以两端面积几何平均项提高体积估算精度。", application: "高差大、断面变化快或需提高收方精度的区段。", formula: "V = L × (A₁ + A₂ + √(A₁A₂)) ÷ 3" },
  { term: "圆曲线要素", domain: "通用", category: "曲线公式", definition: "圆曲线常用切线长 T、曲线长 L、外距 E、切曲差 J 描述路线几何关系。", application: "用于测量放样、线路复核和变更工程量核算。", formula: "T = R·tan(α/2)；L = πRα/180；J = 2T − L" },
  { term: "超高", domain: "通用", category: "曲线控制", definition: "曲线外侧高于内侧形成横坡差，用以抵消车辆或列车通过曲线时的离心作用。", application: "用于曲线施工放样、路面横坡和铁路轨道整道控制。", formula: "参考：h = v²·B ÷ (127R)（单位与规范口径须统一）" },
  { term: "边坡与坡率", domain: "通用", category: "路基", definition: "边坡为路基侧面斜坡；坡率常表示为 1:m，含义是竖向 1 对应水平 m。", application: "用于断面面积、土石方、边沟和防护工程量计算。", formula: "简化填方断面：A = (B + mH) × H" },
  { term: "地质勘察与软基", domain: "通用", category: "地质", definition: "识别土分类、承载力、滑坡、岩溶、软弱地基等条件；常见处理包括换填、CFG 桩、排水板、强夯等。", application: "决定地基处理方案、变更、质量控制和风险预警。" },
  { term: "路肩、边沟、截水沟、盲沟", domain: "公路", category: "路基排水", definition: "路肩位于行车道外侧；边沟汇集路面或边坡水；截水沟拦截坡面来水；盲沟为地下排水构造。", application: "用于公路路基横断面、排水及附属工程清单计量。" },
  { term: "沥青路面", domain: "公路", category: "路面", definition: "通常由面层、基层和底基层组成，质量控制涉及压实度、马歇尔指标、油石比、空隙率和弯沉等。", application: "用于路面配合比、试验检测和质量验收。" },
  { term: "水泥混凝土路面", domain: "公路", category: "路面", definition: "以混凝土板为主要承载层，控制板厚、弯拉强度、切缝、胀缝和缩缝。", application: "用于刚性路面施工、材料估算和伸缩缝工程量。" },
  { term: "桥梁跨径", domain: "公路", category: "桥梁", definition: "净跨是支承之间净距离，计算跨径用于受力计算；桥梁还包括桩基、承台、墩台、盖梁、支座和伸缩缝。", application: "用于桥梁构件识别、清单计量和结构施工组织。" },
  { term: "涵洞", domain: "公路", category: "附属工程", definition: "穿越路基输送水流或通行的小型构造物，常见圆管涵、盖板涵和拱涵；重点参数为孔径、净高和流水能力。", application: "用于构件清单中按里程、孔数、孔径、长宽高计量。" },
  { term: "公路荷载等级", domain: "公路", category: "桥梁", definition: "公路桥梁常按公路—Ⅰ级、公路—Ⅱ级等荷载等级设计与验算。", application: "用于图纸复核、结构变更和技术交底，具体取值以设计文件为准。" },
  { term: "铁路基床", domain: "铁路", category: "路基", definition: "铁路路基上部直接承受轨道荷载的结构层，通常分表层和底层，对材料、压实和变形控制要求高。", application: "用于铁路路基分层施工、试验检测和验收。" },
  { term: "K30、Evd、Ev2", domain: "铁路", category: "路基检测", definition: "K30 为地基系数，Evd 为动态变形模量，Ev2 为静态变形模量，均用于铁路路基压实和变形质量评价。", application: "用于基床、过渡段及路基试验检测；限值应以对应设计和规范为准。" },
  { term: "过渡段", domain: "铁路", category: "路基", definition: "桥路、隧路等刚柔结构交界的渐变区，用以控制刚度突变及沉降差。", application: "用于铁路专项施工组织、填料级配和沉降观测。" },
  { term: "有砟轨道与无砟轨道", domain: "铁路", category: "轨道", definition: "有砟轨道由钢轨、轨枕、道砟等组成；无砟轨道以整体基础、轨道板等结构承载，常见 CRTS 系列。", application: "用于轨道工程清单、工序安排和质量控制。" },
  { term: "轨距、轨底坡、曲线加宽", domain: "铁路", category: "轨道", definition: "轨距为两钢轨工作边间距离；轨底坡用于钢轨受力姿态；曲线加宽为小半径曲线适应轮对通过的技术措施。", application: "用于轨道铺设、整道和曲线复核。", formula: "参考：ΔS = 1500 ÷ R（mm），以现行铁路规范为准" },
  { term: "ZK、ZKH、中—活载", domain: "铁路", category: "桥梁", definition: "铁路桥梁活载体系，分别用于不同速度等级和铁路类型的设计校核。", application: "用于铁路桥梁图纸识读和荷载说明，具体选用以设计文件为准。" },
  { term: "铁路隧道围岩与支护", domain: "铁路", category: "隧道", definition: "围岩常分Ⅰ—Ⅵ级；支护体系包括初期支护、二次衬砌、排水、接触网槽道等。", application: "用于隧道施工方法、资源配置、质量安全和清单计量。", formula: "浅埋隧道竖向围岩压力参考：q = γh" },
  { term: "站场、股道、道岔、有效长", domain: "铁路", category: "站场", definition: "股道为列车运行或停放线路；道岔实现线路转换；有效长是可停放列车的有效区段长度。", application: "用于站场工程识读、轨道工程量和施工组织。" },
  { term: "工程量清单与变更", domain: "计量造价", category: "计量规则", definition: "清单将工程按项目编码、特征、单位和计量规则拆分；变更是经批准后改变原合同工程内容、数量或方法的受控过程。", application: "用于公路、铁路计量支付、变更、索赔和分包价对照。" },
  { term: "平均运距与超运距", domain: "计量造价", category: "运输计价", definition: "平均运距为各分段工程量按运距加权平均；超过定额基本运距的部分为超运距。", application: "用于土石方调配、运输合同和运费测算。", formula: "Lavg = Σ(VᵢLᵢ) ÷ ΣVᵢ" },
  { term: "压实度", domain: "试验检测", category: "路基检测", definition: "现场干密度与最大干密度的比值，是填筑质量的关键指标。", application: "用于路基、路面基层和填料验收。", formula: "K = ρd ÷ ρdmax × 100%" },
  { term: "含水率", domain: "试验检测", category: "土工检测", definition: "土中水质量与干土质量之比，影响压实、强度和施工窗口。", application: "用于填料碾压、拌和和雨季施工控制。", formula: "w = mw ÷ ms × 100%" },
  { term: "CBR 承载比", domain: "试验检测", category: "路基检测", definition: "试样贯入压力与标准压力的比值，反映土基或粒料的承载能力。", application: "用于公路路基和基层材料评价。", formula: "CBR = Ps ÷ P × 100%（以试验规程符号为准）" },
  { term: "坐标正算与反算", domain: "通用", category: "施工测量", definition: "正算由已知点、边长和方位角求目标点坐标；反算由两点坐标求边长和方位角。", application: "用于公路铁路中线、构造物和控制点放样复核。", formula: "X₂ = X₁ + Lcosα；Y₂ = Y₁ + Lsinα；L = √(ΔX²+ΔY²)" },
  { term: "沉降观测", domain: "通用", category: "变形控制", definition: "通过分层、分期观测评价路基、桥台和软基的变形发展及稳定性。", application: "用于铁路高速线、软基、高填方及桥台过渡段控制。", formula: "分层总和法参考：s = Σ(σzi/Esi × Δhi)" },
];

export default function RoadRailKnowledgeBase() {
  const [domain, setDomain] = useState<"全部" | Domain>("全部");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => knowledge.filter(item => (domain === "全部" || item.domain === domain || (domain === "通用" && item.domain === "计量造价")) && [item.term, item.category, item.definition, item.application, item.formula ?? ""].join(" ").toLowerCase().includes(query.trim().toLowerCase())), [domain, query]);
  const categories = Array.from(new Set(rows.map(item => item.category)));
  return <section className="space-y-4"><Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-[#1f5956]" />公路铁路施工知识库</CardTitle><CardDescription>根据已提供的《公路、铁路工程项目专业知识 + 常用计算公式》整理。公式用于学习和辅助复核，正式施工、计量支付与安全质量控制应以设计文件、现行规范、试验报告和审批记录为准。</CardDescription></CardHeader><CardContent className="space-y-3"><Tabs value={domain} onValueChange={value => setDomain(value as "全部" | Domain)}><TabsList className="h-auto flex flex-wrap justify-start gap-1 bg-[#eef5f3] p-1"><TabsTrigger value="全部">全部</TabsTrigger><TabsTrigger value="通用">通用基础</TabsTrigger><TabsTrigger value="公路">公路专项</TabsTrigger><TabsTrigger value="铁路">铁路专项</TabsTrigger><TabsTrigger value="计量造价">计量造价</TabsTrigger><TabsTrigger value="试验检测">试验检测</TabsTrigger></TabsList></Tabs><div className="relative max-w-2xl"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="搜索术语、公式、构件或应用场景，如：涵洞、K30、压实度、运距" /></div><p className="text-xs text-slate-500">当前显示 {rows.length} 个术语；按公路、铁路分别归类，通用基础和计量造价另行保留。</p></CardContent></Card><div className="space-y-5">{categories.map(category => <section key={category}><h3 className="mb-2 text-sm font-semibold text-[#203c48]">{category}</h3><div className="grid gap-3 xl:grid-cols-2">{rows.filter(item => item.category === category).map(item => <Card key={item.term} className="border-[#e1e8e4]"><CardContent className="p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[#203c48]">{item.term}</p><Badge variant="outline">{item.domain}</Badge></div><p className="mt-3 text-sm leading-6 text-slate-600"><span className="font-medium text-slate-800">定义：</span>{item.definition}</p><p className="mt-2 text-sm leading-6 text-slate-600"><span className="font-medium text-slate-800">应用：</span>{item.application}</p>{item.formula ? <div className="mt-3 rounded-lg bg-[#f5f9f8] px-3 py-2 font-mono text-xs leading-5 text-[#1f5956]">{item.formula}</div> : null}</CardContent></Card>)}</div></section>)}</div></section>;
}
