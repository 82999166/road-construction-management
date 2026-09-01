import ConstructionToolbox from "@/components/ConstructionToolbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, BookOpen, Calculator, HardHat, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";

const MANAGEMENT_ROLE_CODES = new Set([
  "SUPER_ADMIN", "PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER", "LABOR_MANAGER", "ACCOUNTANT", "FINANCE_MANAGER", "MACHINERY_MANAGER", "PURCHASER", "WAREHOUSE_MANAGER", "LOGISTICS_MANAGER", "MEASUREMENT_MANAGER", "CASHIER", "AUDIT_VIEWER",
]);

/** 工具无业务数据读写能力，但页面仍仅向已登录管理人员展示，防止司机端入口混淆。 */
export default function ToolKnowledgePage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const roleCodes = workbench.data?.user.roleCodes ?? [];
  const isManager = roleCodes.includes("ALL") || roleCodes.some(code => MANAGEMENT_ROLE_CODES.has(code));

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在核验工具知识权限…" title="工具知识中心" description="请先使用管理账号登录，工具不读取或变更任何业务数据。" Icon={Calculator} onRetry={() => { void refresh(); void workbench.refetch(); }} />;
  }
  if (workbench.isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f1e8] text-sm text-[#76523f]">正在加载工具知识中心…</main>;
  if (!isManager) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f1e8] p-6"><Card className="max-w-md"><CardContent className="p-7 text-center"><ShieldCheck className="mx-auto h-7 w-7 text-amber-700" /><h1 className="mt-4 text-lg font-semibold">工具知识仅向管理人员开放</h1><p className="mt-2 text-sm leading-6 text-slate-600">该页面不授予运输、财务、项目或系统配置权限。请使用已分配管理岗位的账号进入。</p><Button className="mt-5" onClick={() => navigate("/mobile")}>返回工作台</Button></CardContent></Card></main>;
  }

  return <main className="min-h-screen bg-[#f7f1e8] pb-12 text-[#3b2118]"><header className="border-b border-[#e7d6c4] bg-[#342018] text-[#fff7ed]"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><Button aria-label="返回管理入口" size="icon" variant="outline" className="shrink-0 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => navigate("/mobile")}><ArrowLeft className="h-4 w-4" /></Button><div><p className="flex items-center gap-2 text-base font-semibold"><Calculator className="h-4 w-4 text-[#f2bf7c]" />工具知识中心</p><p className="mt-0.5 text-xs text-[#e8cfb2]">工程材料估算与税费利润测算 · 不读取业务台账</p></div></div><Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => navigate("/help?guide=admin")}><BookOpen className="mr-1.5 h-4 w-4" />使用教程</Button></div></header><div className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><section className="mb-6 grid gap-3 lg:grid-cols-[1.25fr_.75fr]"><Card className="border-[#e6c9a8] bg-[linear-gradient(135deg,#fffaf4,#f6e7d1)]"><CardContent className="p-5"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#a85a2a] text-white"><HardHat className="h-5 w-5" /></span><div><h1 className="text-xl font-semibold">可编辑的工程测算工具</h1><p className="mt-2 text-sm leading-6 text-[#785c4a]">混凝土数值用于材料计划估算，必须以项目试验室配合比通知单和现场试配为准；税费结果仅按输入的含税单价和税率换算，不替代发票审核、税务申报或会计师复核。</p></div></div></CardContent></Card><Card className="border-[#d9e4df] bg-[#f4faf7]"><CardContent className="p-5"><p className="text-sm font-semibold text-[#315d4e]">知识依据与使用边界</p><p className="mt-2 text-xs leading-5 text-[#527060]">依据 JGJ 55-2011 的配合比设计、试配和调整原则设置工具边界。高强混凝土及特殊耐久性要求必须经试验确定。</p><a className="mt-3 inline-flex text-sm font-medium text-[#236447] underline underline-offset-4" href="https://www.codeofchina.com/standard/JGJ55-2011.html" target="_blank" rel="noreferrer">查看规程信息</a></CardContent></Card></section><ConstructionToolbox /></div></main>;
}
