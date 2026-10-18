import React, { useState, lazy, Suspense } from "react";
import {
  BookOpenCheck,
  Calculator,
  ChevronRight,
  Compass,
  HardHat,
  Scale,
  Wrench,
} from "lucide-react";
import ConstructionToolbox from "@/components/ConstructionToolbox";
import EngineeringCalculatorDirectory from "@/components/EngineeringCalculatorDirectory";
import EngineeringKnowledgeLibrary, {
  ENGINEERING_KNOWLEDGE_ITEMS,
  ENGINEERING_KNOWLEDGE_TOTAL,
} from "@/components/EngineeringKnowledgeLibrary";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ENGINEERING_CALCULATOR_GROUPS,
  ENGINEERING_CALCULATOR_SPECS,
} from "@/lib/engineering-calculators";

const SettlementTemplateCalculator = lazy(
  () => import("@/components/SettlementTemplateCalculator")
);

type ToolKnowledgeWorkspaceProps = {
  /** 超级管理后台需要保留其原有的结算模板参考，其余入口只展示常用测算。 */
  includeSettlementTemplate?: boolean;
};

type WorkspaceTab =
  | (typeof ENGINEERING_CALCULATOR_GROUPS)[number]["id"]
  | "common";

const TAB_ICONS: Record<WorkspaceTab, typeof Calculator> = {
  building: HardHat,
  material: Scale,
  geotech: Compass,
  highway: Compass,
  railway: Compass,
  survey: Compass,
  machinery: Wrench,
  settlement: Calculator,
  common: Calculator,
};

export default function ToolKnowledgeWorkspace({
  includeSettlementTemplate = false,
}: ToolKnowledgeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("building");
  const ActiveIcon = TAB_ICONS[activeTab];

  return (
    <section data-testid="tool-knowledge-workspace" className="space-y-4">
      <Card className="overflow-hidden border-[#d8c1aa] bg-[linear-gradient(135deg,#fffaf5,#f8eee2)] shadow-[0_12px_30px_rgba(71,42,30,.06)]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#8b4e2d] text-white shadow-sm">
                <HardHat className="h-5 w-5" />
              </span>
              <div>
                <p className="flex items-center gap-2 text-base font-semibold text-[#533628]">
                  分类工具工作台{" "}
                  <Badge
                    variant="outline"
                    className="border-[#d9b998] bg-white/70 text-[#825233]"
                  >
                    按专业查找
                  </Badge>
                </p>
                <p className="mt-1 text-xs leading-5 text-[#80624f]">
                  已汇总 {ENGINEERING_KNOWLEDGE_TOTAL} 项知识资料与{" "}
                  {ENGINEERING_CALCULATOR_SPECS.length}{" "}
                  个自动计算器。选择专业后，只显示本类工具、公式说明与标准边界。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#d8c1aa] bg-white/75 px-3 py-1.5 text-[#73513f]">
                先选专业
              </span>
              <ChevronRight className="mt-1 h-4 w-4 text-[#ab7a5d]" />
              <span className="rounded-full border border-[#c7ddd2] bg-[#f4faf7] px-3 py-1.5 text-[#356a55]">
                再计算或查标准
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as WorkspaceTab)}
        className="gap-4"
      >
        <div
          className="overflow-x-auto pb-1"
          data-testid="tool-knowledge-category-tabs"
        >
          <TabsList
            aria-label="工具知识分类"
            className="h-auto min-w-max justify-start gap-1 rounded-xl border border-[#ded7cd] bg-[#f8f6f1] p-1.5"
          >
            {ENGINEERING_CALCULATOR_GROUPS.map(group => {
              const Icon = TAB_ICONS[group.id];
              return (
                <TabsTrigger
                  key={group.id}
                  data-testid={`tool-knowledge-tab-${group.id}`}
                  value={group.id}
                  className="h-9 shrink-0 px-3 text-xs data-[state=active]:bg-[#6a3c28] data-[state=active]:text-white"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {group.label}
                  <span className="ml-0.5 opacity-70">
                    {group.specs.length}/
                    {
                      ENGINEERING_KNOWLEDGE_ITEMS.filter(
                        item => item.tab === group.knowledgeTab
                      ).length
                    }
                  </span>
                </TabsTrigger>
              );
            })}
            <TabsTrigger
              data-testid="tool-knowledge-tab-common"
              value="common"
              className="h-9 shrink-0 px-3 text-xs data-[state=active]:bg-[#6a3c28] data-[state=active]:text-white"
            >
              <Calculator className="h-3.5 w-3.5" />
              常用测算
            </TabsTrigger>
          </TabsList>
        </div>

        {ENGINEERING_CALCULATOR_GROUPS.map(group => (
          <TabsContent
            key={group.id}
            value={group.id}
            className="mt-0 space-y-4"
          >
            <Card className="border-[#d9e6df] bg-[#f6fbf8]">
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm text-[#416958]">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e1f1e9] text-[#216548]">
                  <BookOpenCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold">{group.label}专业区</p>
                  <p className="mt-0.5 text-xs text-[#678475]">
                    {group.short} · {group.specs.length} 个自动计算器 ·{" "}
                    {
                      ENGINEERING_KNOWLEDGE_ITEMS.filter(
                        item => item.tab === group.knowledgeTab
                      ).length
                    }{" "}
                    项知识资料
                  </p>
                </div>
              </CardContent>
            </Card>
            <EngineeringCalculatorDirectory
              specs={group.specs}
              categoryLabel={group.label}
              categoryDescription={group.short}
              testId={`calculator-category-${group.id}`}
            />
            <EngineeringKnowledgeLibrary
              tab={group.knowledgeTab}
              hideTabNavigation
              showCalculatorPanels={false}
              testId={`knowledge-category-${group.id}`}
            />
          </TabsContent>
        ))}

        <TabsContent value="common" className="mt-0 space-y-4">
          <Card className="border-[#e4d2bc] bg-[#fffaf5]">
            <CardContent className="flex items-center gap-3 p-3 text-sm text-[#79553e]">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f8e6d2] text-[#9b542b]">
                <ActiveIcon className="h-4 w-4" />
              </span>
              <div>
                <p className="font-semibold">常用现场与商务测算</p>
                <p className="mt-0.5 text-xs">
                  混凝土材料、采购含税利润、机械成本、运输运价和结算模板均只处理当前输入，不写入任何业务台账。
                </p>
              </div>
            </CardContent>
          </Card>
          <div data-testid="common-calculators-panel">
            <ConstructionToolbox includeKnowledge={false} />
          </div>
          {includeSettlementTemplate ? (
            <Suspense
              fallback={
                <Card className="border-[#d8e3e0] bg-[#f8fcfb]">
                  <CardContent className="p-5 text-sm text-slate-600">
                    正在加载结算模板参考…
                  </CardContent>
                </Card>
              }
            >
              <SettlementTemplateCalculator />
            </Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
