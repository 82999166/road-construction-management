import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { getScopedPcAdminSection } from "@/lib/scopedManagementWorkspace";
import { getAuthorizedManagementModules } from "@/lib/managementPortal";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { lazy, Suspense } from "react";
import { useLocation } from "wouter";

const MobileConstructionPage = lazy(() => import("./MobileConstructionPage"));
const MobileLaborPage = lazy(() => import("./MobileLaborPage"));
const MobileMachineryPage = lazy(() => import("./MobileMachineryPage"));
const MobileTransportPage = lazy(() => import("./MobileTransportPage"));
const MobilePurchasingPage = lazy(() => import("./MobilePurchasingPage"));
const MobileMeasurementPage = lazy(() => import("./MobileMeasurementPage"));
const MobileContractPage = lazy(() => import("./MobileContractPage"));
const MobileFinancePage = lazy(() => import("./MobileFinancePage"));
const MobileDieselPage = lazy(() => import("./MobileDieselPage"));
const MobileEvidencePage = lazy(() => import("./MobileEvidencePage"));
const AdminPage = lazy(() => import("./AdminPage"));

const PC_SCOPED_MODULES = {
  construction: { code: "CONSTRUCTION", title: "施工管理", Page: MobileConstructionPage },
  labor: { code: "LABOR", title: "劳务工资", Page: MobileLaborPage },
  machinery: { code: "MACHINERY", title: "机械管理", Page: MobileMachineryPage },
  transport: { code: "TRANSPORT", title: "运输管理", Page: MobileTransportPage },
  purchasing: { code: "PURCHASING", title: "采购仓储", Page: MobilePurchasingPage },
  measurement: { code: "MEASUREMENT", title: "工程计量", Page: MobileMeasurementPage },
  subcontract: { code: "MEASUREMENT", title: "计量结算与分包", Page: MobileMeasurementPage },
  contract: { code: "CONTRACT", title: "合同管理", Page: MobileContractPage },
  contracts: { code: "CONTRACT", title: "合同管理", Page: MobileContractPage },
  finance: { code: "FINANCE", title: "财务管理", Page: MobileFinancePage },
  diesel: { code: "DIESEL", title: "柴油管理", Page: MobileDieselPage },
  evidence: { code: "EVIDENCE", title: "现场取证", Page: MobileEvidencePage },
} as const;

/**
 * 普通管理员 PC 业务页：与移动端复用同一真实业务组件，避免在两套 PC 页面中复制筛选、打印和详情逻辑。
 * 页面仅决定入口；数据和操作仍由各业务 tRPC 路由按项目范围、角色和模块权限二次裁决。
 */
export default function ScopedManagementModulePage({ section }: { section: string }) {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const module = PC_SCOPED_MODULES[section as keyof typeof PC_SCOPED_MODULES];
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在核验业务模块权限…" title="统一业务工作台" description="请先完成登录，系统会按岗位和项目范围加载允许办理的业务。" Icon={ShieldCheck} onRetry={() => { void refresh(); void workbench.refetch(); }} />;
  }

  if (!module) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f1e8] p-6"><Card className="max-w-md"><CardContent className="p-7 text-center"><ShieldCheck className="mx-auto h-7 w-7 text-[#a66031]" /><h1 className="mt-4 text-lg font-semibold">该后台功能不可用</h1><p className="mt-2 text-sm text-slate-600">请从已授权的业务工作台进入，系统不会提供未登记的后台功能路由。</p><Button className="mt-5" onClick={() => navigate("/admin")}>返回统一管理入口</Button></CardContent></Card></main>;
  }

  if (workbench.isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f1e8] text-sm text-[#76523f]">正在加载 {module.title} 权限…</main>;
  const isAuthorized = Boolean(workbench.data && getAuthorizedManagementModules(workbench.data.menus).some(item => item.code === module.code));
  if (!isAuthorized) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f1e8] p-6"><Card className="max-w-md"><CardContent className="p-7 text-center"><ShieldCheck className="mx-auto h-7 w-7 text-amber-700" /><h1 className="mt-4 text-lg font-semibold">暂无 {module.title} 权限</h1><p className="mt-2 text-sm text-slate-600">请由超级管理员分配对应业务模块和项目范围。即使访问该地址，服务端仍会拒绝未授权数据与操作。</p><Button className="mt-5" onClick={() => navigate("/admin")}>返回统一管理入口</Button></CardContent></Card></main>;
  }

  const scopedAdminSection = getScopedPcAdminSection(module.code);
  if (scopedAdminSection) {
    return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">正在加载 {module.title} PC 工作区…</main>}><AdminPage scopedSection={scopedAdminSection} /></Suspense>;
  }

  const Page = module.Page;
  return <main className="min-h-screen bg-[#f7f1e8]" data-pc-management-module={module.code}>
    <header className="sticky top-0 z-20 border-b border-[#e7d6c4] bg-[#fffaf4]/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 py-3 lg:px-8"><Button variant="outline" size="sm" onClick={() => navigate("/admin")}><ArrowLeft className="mr-1.5 h-4 w-4" />业务工作台</Button><div><p className="text-sm font-semibold text-[#342018]">{module.title}</p><p className="text-xs text-[#896b5b]">PC 统一业务页面 · 内容按已授权项目范围显示</p></div></div>
    </header>
    <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm text-[#76523f]">正在加载 {module.title}…</div>}><Page /></Suspense>
  </main>;
}
