import { Card, CardContent } from "@/components/ui/card";
import { lazy, Suspense } from "react";

const SettlementTemplateCalculator = lazy(() => import("@/components/SettlementTemplateCalculator"));
const ConstructionToolbox = lazy(() => import("@/components/ConstructionToolbox"));
const RoadRailKnowledgeBase = lazy(() => import("@/components/RoadRailKnowledgeBase"));

/**
 * 独立承载仅在“工具知识”菜单访问时使用的测算和知识内容，
 * 避免其介绍文案及子组件加载声明进入超级管理后台的运营概览分包。
 */
export default function AdminMeasurementToolsPanel() {
  return <Suspense fallback={<Card className="border-[#d8e3e0] bg-[#f8fcfb]"><CardContent className="p-6 text-sm text-slate-600">正在加载工程测算工具…</CardContent></Card>}>
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#203c48]">计量工具 · 独立测算工作区</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">工程计量与施工辅助工具</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">集中提供土石方、附属工程、混凝土材料、机械台班、运输运价和公路铁路施工知识。所有工具仅用于方案测算、学习和打印，不会自动写入项目部收方、施工队分包批次或财务结算台账。</p>
      </div>
      <Card className="border-[#d8e3e0] bg-[#f8fbfa]">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div><p className="font-medium text-[#203c48]">一、土石方结算</p><p className="mt-1 text-xs leading-5 text-slate-500">按桩号录入天然方土石方，结合土石系数计算运输、填方和分包双价。</p></div>
          <div><p className="font-medium text-[#203c48]">二、附属工程结算</p><p className="mt-1 text-xs leading-5 text-slate-500">按里程、涵洞、边沟、挡墙等构件录入图纸参数并自动计算方量。</p></div>
          <div><p className="font-medium text-[#203c48]">三、施工辅助测算</p><p className="mt-1 text-xs leading-5 text-slate-500">混凝土材料、机械台班和运输运价按输入参数即时测算，结果须由现场和商务人员复核。</p></div>
          <div><p className="font-medium text-[#203c48]">四、公铁知识库</p><p className="mt-1 text-xs leading-5 text-slate-500">按通用、公路、铁路、计量造价和试验检测分类查询术语、应用及公式。</p></div>
        </CardContent>
      </Card>
      <ConstructionToolbox />
      <SettlementTemplateCalculator />
      <RoadRailKnowledgeBase />
    </div>
  </Suspense>;
}
