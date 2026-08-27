import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { MobileBottomNavigation } from "@/components/MobileBottomNavigation";
import { useAuth } from "@/_core/hooks/useAuth";
import { getAuthorizedManagementModules, getManagementModulePath } from "@/lib/managementPortal";
import { trpc } from "@/lib/trpc";
import {
  Bell,
  Camera,
  ContactRound,
  FileText,
  Fuel,
  HardHat,
  LayoutDashboard,
  MapPin,
  PackageSearch,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Tractor,
  Truck,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "wouter";

/** 图标仅用于视觉呈现；业务模块及其可见性始终来自服务端 workbench 投影。 */
const MANAGEMENT_MODULE_ICONS: Record<string, LucideIcon> = {
  CONSTRUCTION: HardHat,
  LABOR: ContactRound,
  MACHINERY: Tractor,
  TRANSPORT: Truck,
  PURCHASING: PackageSearch,
  MEASUREMENT: Ruler,
  CONTRACT: FileText,
  FINANCE: WalletCards,
  DIESEL: Fuel,
  EVIDENCE: Camera,
};

/**
 * 普通管理人员的统一后台落地页。
 * 该页面不读取任何全局治理数据，仅消费 mobile.workbench 已按角色、部门和项目范围过滤的菜单投影。
 */
export default function ManagementPortal() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh, logout } = useAuth();
  const [, navigate] = useLocation();
  const workbench = trpc.mobile.workbench.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return <MobileAccessGate
      isAuthenticated={isAuthenticated}
      isLoading={loading}
      authLoadingTimedOut={authLoadingTimedOut}
      loadingText="正在核验您的管理权限…"
      title="统一管理入口"
      description="请先完成统一身份认证，系统会按岗位、部门与项目范围加载可管理的功能版块。"
      Icon={ShieldCheck}
      onRetry={() => {
        void refresh();
        void workbench.refetch();
      }}
    />;
  }

  if (workbench.isLoading) {
    return <div className="grid min-h-screen place-items-center bg-[#f7f1e8] p-6 text-[#5b3b2e]"><div className="flex items-center gap-2 rounded-2xl bg-white px-5 py-4 shadow-[0_12px_34px_rgba(71,42,30,.08)]"><RefreshCw className="h-4 w-4 animate-spin text-[#a86532]" /><span className="text-sm">正在加载您的管理功能版块…</span></div></div>;
  }

  if (workbench.error || !workbench.data) {
    return <div className="grid min-h-screen place-items-center bg-[#f7f1e8] p-6 text-center text-[#3b2118]"><div className="max-w-sm rounded-[28px] bg-white p-7 shadow-[0_18px_48px_rgba(71,42,30,.11)]"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fbebd9] text-[#a85a28]"><ShieldCheck className="h-6 w-6" /></div><h1 className="mt-5 text-xl font-semibold">管理权限暂时无法同步</h1><p className="mt-3 text-sm leading-6 text-[#816658]">系统未显示任何默认全局功能。请重新同步；若问题持续，请联系超级管理员核验角色、部门和项目授权。</p><Button className="mt-6 bg-[#203c48] hover:bg-[#17313b]" onClick={() => void workbench.refetch()}><RefreshCw className="mr-2 h-4 w-4" />重新同步</Button></div></div>;
  }

  const modules = getAuthorizedManagementModules(workbench.data.menus);
  const departmentNames = workbench.data.user.departments.map(department => department.name);
  const roleCodes = workbench.data.user.roleCodes.filter(code => code !== "ALL");
  const projectScopeLabel = workbench.data.dataScope.hasAllProjects
    ? "全项目范围"
    : workbench.data.dataScope.projectIds.length
      ? `已授权 ${workbench.data.dataScope.projectIds.length} 个项目`
      : "暂未授予项目范围";

  return <main className="min-h-screen pb-24 bg-[radial-gradient(circle_at_top_right,rgba(204,143,83,.2),transparent_28%),#f7f1e8] text-[#3b2118] lg:pb-0">
    <header className="border-b border-[#e7d6c4] bg-[#342018] text-[#fff7ed]">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#c9854a] shadow-[0_8px_18px_rgba(0,0,0,.22)]"><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate text-base font-semibold">悦信云智管 · 统一管理入口</p><p className="mt-0.5 truncate text-xs text-[#e9cfaf]">登录后仅呈现已授权的业务管理版块</p></div></div>
        <div className="flex items-center gap-2"><span className="hidden max-w-44 truncate text-sm text-[#eed9bf] sm:inline">{user?.name || "已登录管理人员"}</span><Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={logout}>退出登录</Button></div>
      </div>
    </header>

    <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:px-8">
      <section className="min-w-0">
        <div className="rounded-[28px] bg-[#fffaf4] p-6 shadow-[0_14px_40px_rgba(71,42,30,.08)] sm:p-8">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#f7e6d2] px-3 py-1.5 text-xs font-semibold text-[#8b4f29]"><ShieldCheck className="h-3.5 w-3.5" />实时授权投影</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#342018]">我的管理功能版块</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#795e4f]">菜单由服务端根据您的角色、部门可办理业务、组织归属和项目范围实时计算。权限变化后重新进入本页即可刷新；前端展示不会替代任何服务端鉴权。</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map(module => {
              const Icon = MANAGEMENT_MODULE_ICONS[module.code] ?? LayoutDashboard;
              const path = getManagementModulePath(module.code);
              return <button key={module.code} className="group flex min-h-36 flex-col items-start rounded-2xl border border-[#ead8c5] bg-white p-5 text-left shadow-[0_8px_24px_rgba(71,42,30,.05)] transition-all hover:-translate-y-0.5 hover:border-[#c98d5a] hover:shadow-[0_14px_30px_rgba(71,42,30,.11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a96032]" onClick={() => path && navigate(path)}><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fbecdc] text-[#a55d2d] transition-colors group-hover:bg-[#f4d5b2]"><Icon className="h-5 w-5" /></span><span className="mt-4 text-base font-semibold text-[#482b20]">{module.title}</span><span className="mt-1 text-xs leading-5 text-[#927565]">进入已授权的业务管理页面</span></button>;
            })}
            {!modules.length ? (
              <div className="sm:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-[#dcc5ae] bg-[#fffaf5] px-5 py-9 text-center">
                <UserRound className="mx-auto h-6 w-6 text-[#b7825c]" />
                <p className="mt-3 text-sm font-semibold text-[#624233]">当前尚未分配业务管理版块</p>
                <p className="mt-1 text-xs leading-5 text-[#8c7060]">请由超级管理员为该账号分配角色、部门可办理业务与项目范围后重新登录。</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <Card className="border-[#e5d2bd] bg-[#fffaf4] shadow-[0_10px_28px_rgba(71,42,30,.06)]"><CardContent className="p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[#4b2d21]"><MapPin className="h-4 w-4 text-[#a66031]" />数据与组织范围</div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-[#9a7c6a]">项目范围</dt><dd className="mt-1 font-medium">{projectScopeLabel}</dd></div><div><dt className="text-xs text-[#9a7c6a]">所属部门</dt><dd className="mt-1 font-medium">{departmentNames.length ? departmentNames.join("、") : "暂未配置"}</dd></div><div><dt className="text-xs text-[#9a7c6a]">有效角色</dt><dd className="mt-1 font-medium">{roleCodes.length ? roleCodes.join("、") : "暂未配置"}</dd></div></dl></CardContent></Card>
        <Card className="border-[#e5d2bd] bg-[#fffaf4] shadow-[0_10px_28px_rgba(71,42,30,.06)]"><CardContent className="p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[#4b2d21]"><Bell className="h-4 w-4 text-[#a66031]" />消息与待办</div><p className="mt-3 text-sm leading-6 text-[#806353]">您有 <strong className="text-[#4b2d21]">{workbench.data.statistics.unreadMessages}</strong> 条未读消息。业务审批、待办和状态提醒均仅显示在授权范围内。</p><Button variant="outline" className="mt-4 w-full border-[#d7bda4] bg-white text-[#6a3f2b] hover:bg-[#f9eee1]" onClick={() => navigate("/mobile/messages")}>查看消息中心</Button></CardContent></Card>
      </aside>
    </div>
    <MobileBottomNavigation forceVisible />
  </main>;
}
