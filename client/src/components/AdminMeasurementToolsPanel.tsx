import { lazy, Suspense } from "react";

const ToolKnowledgeWorkspace = lazy(
  () => import("@/components/ToolKnowledgeWorkspace")
);

/**
 * 独立承载仅在“工具知识”菜单访问时使用的测算和知识内容，
 * 避免其介绍文案及子组件加载声明进入超级管理后台的运营概览分包。
 */
export default function AdminMeasurementToolsPanel() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-6 text-sm text-slate-600">
          正在加载工程测算工具…
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">
            计量工具 · 独立测算工作区
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            工程计量与施工辅助工具
          </h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            按八个专业分类查询自动计算器、标准资料和常用测算；结算模板参考保留在“常用测算”页签。所有工具仅用于方案测算、学习和打印，不会自动写入项目部收方、施工队分包批次或财务结算台账。
          </p>
        </div>
        <ToolKnowledgeWorkspace includeSettlementTemplate />
      </div>
    </Suspense>
  );
}
