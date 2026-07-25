import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Bell,
  Camera,
  ChevronRight,
  ClipboardCheck,
  ContactRound,
  HardHat,
  LayoutDashboard,
  MapPin,
  PackageSearch,
  Ruler,
  ShieldCheck,
  Tractor,
  Truck,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "wouter";

/**
 * 业务菜单图标仅由前端视觉层维护，菜单本身及其岗位可见性始终以服务端 workbench 接口为准。
 * 这样既避免前端硬编码岗位权限，也便于后台变更授权后立即生效。
 */
const MENU_ICONS: Record<string, LucideIcon> = {
  WORKBENCH: LayoutDashboard,
  CONSTRUCTION: HardHat,
  LABOR: ContactRound,
  MACHINERY: Tractor,
  TRANSPORT: Truck,
  PURCHASING: PackageSearch,
  MEASUREMENT: Ruler,
  FINANCE: WalletCards,
  EVIDENCE: Camera,
  MESSAGES: Bell,
};

/** 移动端工作台只处理业务入口，不复用 PC 后台的侧栏布局。 */
export default function MobileWorkbench() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const workbench = trpc.mobile.workbench.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  // 登录态尚未确定时保留轻量加载态，避免瞬间出现未授权的错误提示。
  if (loading || (isAuthenticated && workbench.isLoading)) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] text-sm text-[#f8ead7]">正在同步您的岗位工作台…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-[#fff8ed]">
        <div className="max-w-xs"><div className="mx-auto grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a] shadow-[0_16px_35px_rgba(0,0,0,.28)]"><HardHat className="h-8 w-8" /></div><h1 className="mt-6 text-2xl font-semibold">工程云管移动工作台</h1><p className="mt-3 text-sm leading-6 text-[#e6cdb0]">请先通过企业统一身份登录，系统将按您的岗位展示可办理业务。</p><Button className="mt-6 bg-[#f4dfc3] text-[#3b2118] hover:bg-white" onClick={() => startLogin()}>企业身份登录</Button></div>
      </div>
    );
  }

  if (workbench.error) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-sm text-[#f8ead7]">工作台加载失败：{workbench.error.message}<Button variant="outline" className="mt-4 border-[#c9854a] text-[#fff8ed]" onClick={() => workbench.refetch()}>重新加载</Button></div>;
  }

  const menus = workbench.data?.menus.filter(menu => menu.code !== "WORKBENCH") ?? [];
  const statistics = workbench.data?.statistics;

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl overflow-hidden bg-[#fdf7ee] shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-9 pt-6 text-[#fff7ea]">
          <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#c9854a] shadow-[0_8px_18px_rgba(0,0,0,.24)]"><HardHat className="h-5 w-5" /></div><div><p className="text-sm font-semibold">工程云管</p><p className="mt-0.5 text-xs text-[#e8cfb2]">施工承包移动工作台</p></div></div>
            <button aria-label="进入消息中心" className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" />{(statistics?.unreadMessages ?? 0) > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#f3bf6b]" /> : null}</button>
          </div>
          <div className="relative mt-8"><p className="text-sm text-[#e8cfb2]">您好，{user?.name || "同事"}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">今天先完成最重要的事</h1><p className="mt-2 flex items-center gap-1 text-xs text-[#e8cfb2]"><MapPin className="h-3.5 w-3.5" />项目与数据范围已按岗位授权加载</p></div>
        </header>

        <main className="space-y-6 px-5 pb-24 pt-5">
          <section className="grid grid-cols-2 gap-3">
            {[{ label: "待处理审批", value: statistics?.pendingApprovals ?? 0, icon: ClipboardCheck, tone: "bg-[#fff1df] text-[#9b4f25]" }, { label: "今日运输趟次", value: statistics?.todayTrips ?? 0, icon: Truck, tone: "bg-[#f2eee8] text-[#72503c]" }, { label: "待确认工资", value: statistics?.pendingPayroll ?? 0, icon: WalletCards, tone: "bg-[#f7e9de] text-[#8a3e27]" }, { label: "未读消息", value: statistics?.unreadMessages ?? 0, icon: Bell, tone: "bg-[#efe9dd] text-[#655244]" }].map(item => {
              // 将图标提升为大写组件变量，符合 JSX 动态组件的语法约束。
              const StatisticIcon = item.icon;
              return <Card key={item.label} className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="flex items-center gap-3 p-4"><div className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><StatisticIcon className="h-5 w-5" /></div><div><p className="text-lg font-semibold leading-none">{item.value}</p><p className="mt-1 text-xs text-[#8f7566]">{item.label}</p></div></CardContent></Card>;
            })}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold">我的业务</h2><p className="mt-0.5 text-xs text-[#9b8170]">菜单随岗位、项目范围与授权有效期动态更新</p></div><ShieldCheck className="h-5 w-5 text-[#b87333]" /></div>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {menus.map(menu => {
                const Icon = MENU_ICONS[menu.code] ?? LayoutDashboard;
                return <button key={menu.code} className="group flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-white px-2 py-3 text-center shadow-[0_6px_18px_rgba(71,42,30,.06)] transition-transform active:scale-95" onClick={() => navigate(`/mobile/${menu.code.toLowerCase()}`)}><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fbefe0] text-[#9f582b] transition-colors group-hover:bg-[#f4dfc3]"><Icon className="h-5 w-5" /></span><span className="line-clamp-2 text-xs font-medium leading-4 text-[#5b3b2e]">{menu.title}</span></button>;
              })}
              {!menus.length ? <p className="col-span-4 rounded-xl bg-white p-4 text-center text-xs text-[#8f7566]">当前账号尚未获分配业务岗位，请联系超级管理员授权。</p> : null}
            </div>
          </section>

          <section className="rounded-2xl bg-[#f0dfc7] p-4"><div className="flex gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#c9854a] text-white"><Camera className="h-5 w-5" /></div><div><h2 className="text-sm font-semibold">现场取证已就绪</h2><p className="mt-1 text-xs leading-5 text-[#79533e]">拍照后将自动记录项目、时间和定位信息；照片可关联运输、考勤、采购与安全业务单据。</p><button className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#8b3f20]" onClick={() => navigate("/mobile/evidence")}>打开水印相机 <ChevronRight className="h-3.5 w-3.5" /></button></div></div></section>
        </main>

        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><LayoutDashboard className="h-5 w-5" /><span className="text-[10px] font-medium">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>
    </div>
  );
}
