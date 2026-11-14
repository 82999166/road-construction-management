import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatChinaDateTime } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import { useAuth } from "@/_core/hooks/useAuth";
import { Banknote, Bell, CalendarDays, ChevronRight, CircleHelp, Fuel, Loader2, RefreshCw, Route, Truck, WalletCards, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

function getTokenFromSearch() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function formatMoney(value: unknown) {
  return value == null || value === "" ? "¥—" : `¥${formatAmount(value as number | string)}`;
}

function formatDateTime(value: unknown) {
  return formatChinaDateTime(value as Date | string | number | null | undefined, "未记录");
}

function settlementStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "待审核", approved: "待付款", paid: "已付款", void: "已作废" };
  return labels[status] ?? status;
}

function tripStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "待核验", verified: "已核验", settled: "已结算", void: "已作废" };
  return labels[status] ?? status;
}

function dieselStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", approved: "待结算扣款", settled: "已结算扣款", void: "已作废" };
  return labels[status] ?? status;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[92px_1fr] gap-3 border-b border-[#f1e5d7] py-2.5 text-xs last:border-0"><span className="text-[#8f7566]">{label}</span><span className="break-words text-right font-medium text-[#513427]">{value || "未记录"}</span></div>;
}

export default function DriverPortalPage() {
  const { user, isAuthenticated } = useAuth();
  const [token] = useState(() => getTokenFromSearch());
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [selectedTripNo, setSelectedTripNo] = useState<string | null>(null);
  const [selectedDieselNo, setSelectedDieselNo] = useState<string | null>(null);
  const isLocalDriver = isAuthenticated && user?.loginMethod === "local_driver";
  const tokenPortal = trpc.officialAccount.driverPortalSummary.useQuery({ token }, { enabled: token.length >= 16, retry: false });
  const localPortal = trpc.officialAccount.localDriverPortalSummary.useQuery(undefined, { enabled: isLocalDriver, retry: false });
  const portal = isLocalDriver ? localPortal : tokenPortal;
  const status = portal.data?.status ?? (portal.isLoading ? "loading" : token.length >= 16 || isLocalDriver ? "unavailable" : "invalid");
  const summary = portal.data?.status === "ready" ? portal.data.summary : null;
  const selectedTrip = summary?.recentTrips.find(item => item.tripNo === selectedTripNo) ?? null;
  const selectedDiesel = summary?.dieselRecords.find(item => item.recordNo === selectedDieselNo) ?? null;
  const accountCards = useMemo(() => summary ? [
    { label: "已付费用", value: formatMoney(summary.totals.paidAmount), icon: Banknote, tone: "bg-[#edf7ed] text-[#3f7549]" },
    { label: "未付费用", value: formatMoney(summary.totals.unpaidAmount), icon: WalletCards, tone: "bg-[#fff6df] text-[#9a6725]" },
    { label: "待结算运费", value: formatMoney(summary.totals.pendingTripAmount), icon: Route, tone: "bg-[#eaf3fa] text-[#2e6681]" },
    { label: "待扣柴油", value: formatMoney(summary.totals.pendingFuelDeductionAmount), icon: Fuel, tone: "bg-[#fff0ee] text-[#a14c42]" },
  ] : [], [summary]);

  return <main className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
    <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-8 shadow-[0_0_50px_rgba(74,42,29,.12)]">
      <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-8 pt-6 text-[#fff7ea]">
        <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[#c9854a]/20 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#c9854a] shadow-[0_8px_18px_rgba(0,0,0,.24)]"><Truck className="h-5 w-5" /></span><div><p className="text-sm font-semibold">悦信云智管</p><p className="mt-0.5 text-xs text-[#e8cfb2]">微信司机运输工作台</p></div></div><button type="button" aria-label="查看账单使用说明" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium transition-colors hover:bg-white/20" onClick={() => setNoticeOpen(true)}><CircleHelp className="h-4 w-4" />使用说明</button></div>
        <div className="relative mt-7"><p className="text-sm text-[#e8cfb2]">当前绑定车辆</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{summary?.vehicle.plateNo ?? "司机运输账单"}</h1><p className="mt-2 text-xs leading-5 text-[#e8cfb2]">{summary?.vehicle.projectName ?? "正在核验微信绑定车辆…"}{summary?.vehicle.driverName ? ` · ${summary.vehicle.driverName}` : ""}</p></div>
      </header>

      <main className="space-y-5 px-5 py-5">
        {status === "loading" ? <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="flex items-center gap-2 p-4 text-sm text-[#765544]"><Loader2 className="h-4 w-4 animate-spin" />正在核验绑定车辆并读取真实账单…</CardContent></Card> : null}
        {["invalid", "expired", "unbound", "unavailable"].includes(status) ? <Card className="border-[#e9c99a] bg-[#fff5df]"><CardContent className="p-4 text-sm leading-6 text-[#885622]"><XCircle className="mb-2 h-5 w-5" />{isLocalDriver ? "当前手机号账号尚未绑定有效车辆，或车辆已停用。请联系管理员核验车辆与司机账号绑定。" : "账单入口已失效、当前微信尚未绑定车辆，或服务暂时不可用。请在服务号重新进入绑定入口后再查看。"}</CardContent></Card> : null}

        {summary ? <>
          <section className="rounded-2xl border border-[#ead9c8] bg-white p-4 shadow-[0_6px_18px_rgba(71,42,30,.06)]"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-[#43291e]">今日运输汇总</h2><p className="mt-1 text-xs text-[#8f7566]">{summary.today.businessDate} · 仅统计当前绑定车辆</p></div><CalendarDays className="h-5 w-5 text-[#9a5128]" /></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="今日趟次" value={`${summary.today.tripCount} 趟`} /><Metric label="今日运费" value={formatMoney(summary.today.grossFreightAmount)} accent="text-[#47754d]" /><Metric label="今日扣油" value={formatMoney(summary.today.fuelDeductionAmount)} accent="text-[#9a5128]" /></div></section>

          <section className="grid grid-cols-2 gap-3">{accountCards.map(card => <div key={card.label} className={`rounded-2xl p-3 shadow-[0_6px_18px_rgba(71,42,30,.05)] ${card.tone}`}><card.icon className="mb-2 h-4 w-4" /><p className="text-xs opacity-75">{card.label}</p><p className="mt-1 text-lg font-semibold">{card.value}</p></div>)}</section>

          <section className="rounded-2xl border border-[#ead9c8] bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><div className="flex items-center justify-between p-4"><div><h2 className="text-base font-semibold text-[#43291e]">最近运输趟次</h2><p className="mt-1 text-xs text-[#8f7566]">点击卡片查看路线、结算和进度详情</p></div><Route className="h-5 w-5 text-[#9a5128]" /></div><div className="space-y-2 border-t border-[#f1e5d7] p-3">{summary.recentTrips.length ? summary.recentTrips.map(item => <button type="button" key={item.tripNo} className="w-full rounded-xl bg-[#faf5ed] p-3 text-left transition-transform active:scale-[.99]" onClick={() => setSelectedTripNo(item.tripNo)}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-[#4d2e22]">{item.tripNo}</p><p className="mt-1 truncate text-xs text-[#765a49]">{item.routeLabel}</p></div><Badge variant="outline" className="shrink-0 border-[#dfc39f] bg-white text-[#7d552e]">{tripStatusLabel(item.status)}</Badge></div><div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#8f7566]"><span>{formatDateTime(item.startAt)} · 运费 {formatMoney(item.grossFreightAmount)}</span><span className="flex items-center font-semibold text-[#9a5128]">详情 <ChevronRight className="h-3.5 w-3.5" /></span></div></button>) : <Empty text="暂无当前绑定车辆的运输趟次。" />}</div></section>

          <section className="rounded-2xl border border-[#ead9c8] bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><div className="flex items-center justify-between p-4"><div><h2 className="text-base font-semibold text-[#43291e]">柴油扣款明细</h2><p className="mt-1 text-xs text-[#8f7566]">点击查看加油时间、油量、金额与加油机表数</p></div><Fuel className="h-5 w-5 text-[#9a5128]" /></div><div className="space-y-2 border-t border-[#f1e5d7] p-3">{summary.dieselRecords.length ? summary.dieselRecords.map(item => <button type="button" key={item.recordNo} className="w-full rounded-xl bg-[#fff8ef] p-3 text-left transition-transform active:scale-[.99]" onClick={() => setSelectedDieselNo(item.recordNo)}><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#4d2e22]">{item.recordNo}</p><p className="mt-1 text-xs text-[#765a49]">{formatDateTime(item.refueledAt)} · {formatQuantity(item.liters)} L</p></div><Badge variant="outline" className="shrink-0 border-[#e7c89d] bg-white text-[#9a5128]">{dieselStatusLabel(item.status)}</Badge></div><div className="mt-3 flex items-center justify-between text-[11px] text-[#8f7566]"><span>金额 {formatMoney(item.amount)}{item.deductFromFreight ? " · 运费扣油" : ""}</span><span className="flex items-center font-semibold text-[#9a5128]">查看表数 <ChevronRight className="h-3.5 w-3.5" /></span></div></button>) : <Empty text="暂无当前绑定车辆的柴油记录。" />}</div></section>

          <section className="rounded-2xl border border-[#ead9c8] bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><div className="flex items-center justify-between p-4"><div><h2 className="text-base font-semibold text-[#43291e]">费用结算单</h2><p className="mt-1 text-xs text-[#8f7566]">后台审核及付款状态以结算单为准</p></div><WalletCards className="h-5 w-5 text-[#9a5128]" /></div><div className="space-y-3 border-t border-[#f1e5d7] p-3">{summary.settlements.length ? summary.settlements.map(item => <div key={item.settlementNo} className="rounded-xl bg-[#faf5ed] p-3 text-sm"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#4d2e22]">{item.settlementNo}</p><p className="mt-1 text-[11px] text-[#8f7566]">{item.periodStart} 至 {item.periodEnd} · {item.tripCount} 趟</p></div><Badge variant="outline" className="border-[#dfc39f] bg-white text-[#7d552e]">{settlementStatusLabel(item.status)}</Badge></div><Separator className="my-3 bg-[#ead9c8]" /><div className="grid grid-cols-3 gap-2 text-[11px] text-[#765a49]"><span>运费 {formatMoney(item.grossFreightAmount)}</span><span>扣油 {formatMoney(item.fuelDeductionAmount)}</span><span className="font-semibold text-[#47754d]">应付 {formatMoney(item.netPayableAmount)}</span></div>{item.paymentDate ? <p className="mt-2 text-[11px] text-[#47754d]">付款日期：{item.paymentDate}</p> : null}</div>) : <Empty text="暂无当前绑定车辆的费用结算单。" />}</div></section>

          <Button variant="outline" className="w-full border-[#c9854a] bg-white text-[#7d421f]" onClick={() => portal.refetch()} disabled={portal.isFetching}><RefreshCw className={`mr-1.5 h-4 w-4 ${portal.isFetching ? "animate-spin" : ""}`} />{portal.isFetching ? "正在刷新…" : "刷新真实账单数据"}</Button>
        </> : null}
      </main>
    </div>

    <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><CircleHelp className="h-5 w-5 text-[#9a5128]" />账单使用说明</DialogTitle></DialogHeader><div className="space-y-3 text-sm leading-6 text-[#634737]"><p>{isLocalDriver ? "当前页面由司机手机号登录账号打开。系统按当前账号绑定车辆强制过滤，不能切换或查看其他车辆。" : "当前页面由微信绑定令牌直接打开，司机不需要也没有系统登录账号。"}</p><p>这里不是运输管理：本页只展示当前绑定车辆的真实运输、柴油和结算数据，不提供车辆、路线、运价、运单或结算的新增、修改、审核权限。</p><p>装土、卸土结果以现场刷卡回执为准；进入本页后可随时点击“刷新真实账单数据”查看最新记录。</p></div></DialogContent></Dialog>
    <Dialog open={Boolean(selectedTrip)} onOpenChange={open => { if (!open) setSelectedTripNo(null); }}><DialogContent className="max-h-[86vh] overflow-y-auto"><DialogHeader><DialogTitle>运输运单详情</DialogTitle></DialogHeader>{selectedTrip ? <div className="space-y-3"><div className="rounded-xl bg-[#f8ead8] p-3"><p className="font-semibold text-[#4d2e22]">{selectedTrip.tripNo}</p><p className="mt-1 text-xs text-[#765a49]">{selectedTrip.routeLabel}</p><p className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-xs text-[#7d552e]">{tripStatusLabel(selectedTrip.status)}</p></div><div className="rounded-xl border border-[#ead9c8] px-3"><DetailRow label="开票时间" value={formatDateTime(selectedTrip.startAt)} /><DetailRow label="结束时间" value={formatDateTime(selectedTrip.endAt)} /><DetailRow label="发票方式" value={selectedTrip.invoiceMode === "plate_photo" ? "拍照车牌发票" : "刷卡发票"} /><DetailRow label="运输距离" value={selectedTrip.actualDistanceKm === null ? "未记录" : `${formatQuantity(selectedTrip.actualDistanceKm)} km`} /><DetailRow label="运输方量" value={selectedTrip.volumeCubicMeters === null ? "未记录" : `${formatQuantity(selectedTrip.volumeCubicMeters)} m³`} /><DetailRow label="本趟运费" value={formatMoney(selectedTrip.grossFreightAmount)} /><DetailRow label="柴油扣款" value={formatMoney(selectedTrip.fuelDeductionAmount)} /><DetailRow label="本趟净额" value={formatMoney(selectedTrip.netSettlementAmount ?? selectedTrip.grossFreightAmount - selectedTrip.fuelDeductionAmount)} /></div></div> : null}</DialogContent></Dialog>
    <Dialog open={Boolean(selectedDiesel)} onOpenChange={open => { if (!open) setSelectedDieselNo(null); }}><DialogContent className="max-h-[86vh] overflow-y-auto"><DialogHeader><DialogTitle>柴油扣款详情</DialogTitle></DialogHeader>{selectedDiesel ? <div className="space-y-3"><div className="rounded-xl bg-[#fff4e7] p-3"><p className="font-semibold text-[#4d2e22]">{selectedDiesel.recordNo}</p><p className="mt-1 text-xs text-[#765a49]">{dieselStatusLabel(selectedDiesel.status)}{selectedDiesel.deductFromFreight ? " · 运费扣油" : ""}</p></div><div className="rounded-xl border border-[#ead9c8] px-3"><DetailRow label="加油时间" value={formatDateTime(selectedDiesel.refueledAt)} /><DetailRow label="加油油量" value={`${formatQuantity(selectedDiesel.liters)} L`} /><DetailRow label="加油金额" value={formatMoney(selectedDiesel.amount)} /><DetailRow label="加油机表数" value={selectedDiesel.meterReading === null ? "未记录" : formatQuantity(selectedDiesel.meterReading)} /><DetailRow label="供油方式" value={selectedDiesel.supplyMethod === "external_station" ? "外部加油站" : "项目部供油"} /><DetailRow label="加油站/供油方" value={selectedDiesel.stationOrSupplierName ?? "未记录"} /><DetailRow label="票据编号" value={selectedDiesel.receiptNo ?? "未记录"} /><DetailRow label="备注" value={selectedDiesel.remarks ?? "未记录"} /></div></div> : null}</DialogContent></Dialog>
  </main>;
}

function Metric({ label, value, accent = "text-[#43291e]" }: { label: string; value: string; accent?: string }) {
  return <div className="rounded-xl bg-[#faf5ed] p-2.5 text-center"><p className={`text-sm font-bold ${accent}`}>{value}</p><p className="mt-1 text-[10px] text-[#8f7566]">{label}</p></div>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-[#ead9c8] bg-[#fffaf3] p-4 text-center text-xs leading-5 text-[#8f7566]">{text}</p>;
}
