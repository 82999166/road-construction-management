import { useAuth } from "@/_core/hooks/useAuth";
import OperatingCommandCenter, { type OperatingDashboardData } from "@/components/OperatingCommandCenter";
import { Button } from "@/components/ui/button";
import { createAdminLoginPath, createLoginPath } from "@/lib/authNavigation";
import { trpc } from "@/lib/trpc";
import { ArrowRight, BookOpenCheck, Calculator, HardHat, LockKeyhole, Smartphone } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";

/** 网站首页即交通施工指挥大屏；真实经营指标仍仅在超级管理员身份与服务端权限校验通过后展示。 */
export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const canReadOperatingDashboard = isAuthenticated && user?.role === "admin";
  const operatingDashboard = trpc.admin.business.operatingDashboard.useQuery({ projectId: undefined, period: undefined }, { enabled: canReadOperatingDashboard, retry: false });

  const openAdminLogin = () => setLocation(createAdminLoginPath("/"));
  const openBusinessLogin = () => setLocation(createLoginPath("/mobile"));
  const openHelpCenter = () => setLocation("/help?guide=mobile");

  return <main className="min-h-screen bg-[#030d24] p-0 text-white lg:p-3">
    {canReadOperatingDashboard && operatingDashboard.data ? <OperatingCommandCenter data={operatingDashboard.data as OperatingDashboardData} scopeLabel="全部项目 · 全部期间" isRefreshing={operatingDashboard.isFetching} onRefresh={() => void operatingDashboard.refetch()} onNavigate={setLocation} /> : <section className="relative grid min-h-screen place-items-center overflow-hidden border border-[#1b5ba8] bg-[#040e27] px-5 py-10 lg:min-h-[calc(100vh-24px)]"><div className="pointer-events-none absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(29,103,190,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(29,103,190,.14)_1px,transparent_1px),radial-gradient(circle_at_50%_0%,rgba(27,103,255,.42),transparent_42%)] [background-size:34px_34px,34px_34px,auto]" /><div className="relative w-full max-w-3xl border border-cyan-300/30 bg-[#071832]/88 p-6 shadow-[0_20px_80px_rgba(0,16,61,.6)] sm:p-10"><button type="button" className="absolute right-4 top-4 inline-flex items-center gap-1 text-xs text-cyan-100/75 hover:text-white" onClick={openHelpCenter}><BookOpenCheck className="h-4 w-4" />使用教程</button><div className="mx-auto grid h-14 w-14 place-items-center border border-cyan-300/70 bg-cyan-400/10 text-cyan-200"><HardHat className="h-7 w-7" /></div><p className="mt-6 text-center text-xs tracking-[0.28em] text-cyan-300">悦信 · 交通工程管理</p><h1 className="mt-3 text-center text-2xl font-bold tracking-[0.16em] text-white sm:text-4xl">悦信云智管 · 交通施工指挥中心</h1><p className="mx-auto mt-5 max-w-xl text-center text-sm leading-7 text-cyan-50/70">首页为道路与铁路施工经营数据大屏。资金、计量、进度、运输与劳务指标仅从当前授权范围内的真实服务端台账聚合，不向未授权身份展示。</p><div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">{loading ? <div className="col-span-full rounded border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-center text-sm text-cyan-100/70">正在核验登录状态…</div> : <><Button className="h-11 bg-cyan-500 text-[#03112c] hover:bg-cyan-300" onClick={openAdminLogin}><LockKeyhole className="mr-2 h-4 w-4" />超级管理员查看数据大屏</Button><Button variant="outline" className="h-11 border-cyan-300/45 bg-transparent text-cyan-100 hover:bg-cyan-300/10 hover:text-white" onClick={openBusinessLogin}><Smartphone className="mr-2 h-4 w-4" />进入我的业务工作台</Button></>}</div><button type="button" className="mx-auto mt-5 inline-flex items-center gap-2 text-sm text-cyan-200/80 underline underline-offset-4 hover:text-white" onClick={() => setLocation("/public-tools")}><Calculator className="h-4 w-4" />无需登录，直接使用工程工具知识与材料利润计算器</button>{isAuthenticated && !canReadOperatingDashboard ? <div className="mt-6 flex items-center justify-between gap-3 border-t border-cyan-300/15 pt-5 text-sm text-cyan-100/65"><span>当前账号无全局经营数据权限。</span><button type="button" className="inline-flex items-center text-cyan-300 hover:text-white" onClick={() => setLocation("/mobile")}>进入已授权业务 <ArrowRight className="ml-1 h-4 w-4" /></button></div> : null}</div></section>}
  </main>;
}
