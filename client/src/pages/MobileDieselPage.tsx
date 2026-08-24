import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Fuel, ReceiptText, RefreshCw, Tractor, Truck, WalletCards } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

const MOBILE_DIESEL_BACK_PATH = "/mobile";

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return ({ draft: "草稿", approved: "已记账", settled: "已结算", void: "已作废" } as Record<string, string>)[status] ?? status;
}

/** 移动柴油管理仅显示服务端按柴油查看权限与项目范围返回的真实台账，不回传影像、银行卡或完整人员信息。 */
export default function MobileDieselPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [projectId, setProjectId] = useState<number>();
  const overview = trpc.diesel.mobileOverview.useQuery(projectId ? { projectId } : undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => {
    if (!projectId && overview.data?.selectedProjectId) setProjectId(overview.data.selectedProjectId);
  }, [overview.data?.selectedProjectId, projectId]);

  if (loading || !isAuthenticated || overview.isLoading) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && overview.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载柴油管理权限…" title="柴油管理" description="系统只显示当前账号已获柴油查看权限和项目范围内的真实台账。" Icon={Fuel} onRetry={() => { void refresh(); void overview.refetch(); }} />;
  }
  if (overview.error) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f1e7] p-6 text-center text-[#5b3b2e]"><div className="max-w-xs"><Fuel className="mx-auto h-9 w-9 text-[#b96932]" /><h1 className="mt-4 text-lg font-semibold">柴油台账暂不可用</h1><p className="mt-2 text-sm leading-6 text-[#8f7566]">{overview.error.message}</p><Button className="mt-5" variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />重新加载</Button><Button className="mt-2" variant="ghost" onClick={() => navigate(MOBILE_DIESEL_BACK_PATH)}>返回工作台</Button></div></div>;
  }
  const data = overview.data;
  const selectedProjectName = data?.projects.find(project => project.id === projectId)?.name ?? "—";
  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-10 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea]"><div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#d99855]/20 blur-2xl" /><div className="relative flex items-center justify-between"><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate(MOBILE_DIESEL_BACK_PATH)}><ArrowLeft className="h-5 w-5" /></Button><div className="text-center"><p className="text-sm font-semibold">柴油管理</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">供油台账 · 扣油核对</p></div><Fuel className="h-5 w-5 text-[#f0bd7d]" /></div><p className="relative mt-5 text-xs leading-5 text-[#e8cfb2]">仅展示具备柴油台账查看权限且归属当前项目范围的真实记录；领用登记、指导价和作废仍按已授予的细分权限办理。</p></header>
    <main className="space-y-4 px-5 py-5">
      {!data?.projects.length ? <Card className="border-dashed border-[#e4cdb6] bg-[#fffaf4]"><CardContent className="p-7 text-center"><Fuel className="mx-auto h-8 w-8 text-[#b96932]" /><h2 className="mt-3 font-semibold">暂无可查看项目</h2><p className="mt-2 text-xs leading-5 text-[#8f7566]">请联系管理员为当前账号配置项目范围；柴油权限不会自动扩大项目数据范围。</p></CardContent></Card> : <>
        <Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{data.projects.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select>
        <section className="grid grid-cols-2 gap-3"><Metric icon={Fuel} label="有效供油量" value={`${Number(data.summary?.totalLiters ?? 0).toFixed(2)} L`} /><Metric icon={WalletCards} label="有效柴油金额" value={money(data.summary?.totalAmount)} /><Metric icon={Truck} label="运费扣油" value={money(data.summary?.deductibleAmount)} /><Metric icon={ReceiptText} label="项目部 / 加油站" value={`${Number(data.summary?.projectSupplyLiters ?? 0).toFixed(1)} / ${Number(data.summary?.stationLiters ?? 0).toFixed(1)} L`} /></section>
        <section className="rounded-2xl border border-[#ead9c8] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">最近柴油记录</h2><p className="mt-1 text-xs text-[#8f7566]">项目：{selectedProjectName} · 已作废记录保留审计状态</p></div><Button size="sm" variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" />刷新</Button></div>{data.records.length ? <div className="mt-3 space-y-2">{data.records.map(record => <div key={record.id} className="flex items-center gap-3 rounded-xl border border-[#f0e1d2] bg-[#fffaf4] p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f5e5d0] text-[#a65e2d]">{record.assetType === "machine" ? <Tractor className="h-4 w-4" /> : <Truck className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{record.recordNo} · {record.supplyMethod === "project_supply" ? "项目部供油" : record.stationOrSupplierName || "加油站加油"}</p><p className="mt-1 text-[11px] text-[#8f7566]">{new Date(record.refueledAt).toLocaleString("zh-CN")} · {record.liters.toFixed(3)}L · ¥{record.appliedUnitPrice.toFixed(2)}/L{record.deductFromFreight ? " · 运费扣油" : ""}</p></div><div className="shrink-0 text-right"><p className="font-semibold text-[#6d3421]">{money(record.amount)}</p><p className={`mt-1 text-[11px] ${record.status === "void" ? "text-rose-600" : record.status === "settled" ? "text-emerald-700" : "text-[#8f7566]"}`}>{statusLabel(record.status)}</p></div></div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-[#e4cdb6] px-4 py-6 text-center text-xs text-[#8f7566]">当前项目暂无柴油领用记录。</p>}</section>
      </>}
    </main>
  </div></div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Fuel; label: string; value: string }) {
  return <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><Icon className="h-4 w-4 text-[#a65e2d]" /><p className="mt-2 text-sm font-semibold text-[#5b3b2e]">{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>;
}
