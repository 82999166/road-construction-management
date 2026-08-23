import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { Banknote, Fuel, Loader2, RefreshCw, Route, Truck, WalletCards, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

function getTokenFromSearch() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function formatMoney(value: unknown) {
  const numeric = Number(value ?? 0);
  return `¥${(Number.isFinite(numeric) ? numeric : 0).toFixed(2)}`;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function settlementStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "待审核", approved: "待付款", paid: "已付款", void: "已作废" };
  return labels[status] ?? status;
}

function tripStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "已提交", verified: "已核验待结算", settled: "已结算", void: "已作废" };
  return labels[status] ?? status;
}

function dieselStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", approved: "待结算扣款", settled: "已结算扣款", void: "已作废" };
  return labels[status] ?? status;
}

export default function DriverPortalPage() {
  const [token] = useState(() => getTokenFromSearch());
  const portal = trpc.officialAccount.driverPortalSummary.useQuery({ token }, { enabled: token.length >= 16, retry: false });
  const status = portal.data?.status ?? (portal.isLoading ? "loading" : "invalid");
  const summary = portal.data?.status === "ready" ? portal.data.summary : null;
  const cards = useMemo(() => summary ? [
    { label: "已付费用", value: formatMoney(summary.totals.paidAmount), icon: Banknote, tone: "bg-emerald-50 text-emerald-800" },
    { label: "未付费用", value: formatMoney(summary.totals.unpaidAmount), icon: WalletCards, tone: "bg-amber-50 text-amber-900" },
    { label: "待结算运费", value: formatMoney(summary.totals.pendingTripAmount), icon: Route, tone: "bg-sky-50 text-sky-900" },
    { label: "待扣柴油", value: formatMoney(summary.totals.pendingFuelDeductionAmount), icon: Fuel, tone: "bg-rose-50 text-rose-900" },
  ] : [], [summary]);

  return (
    <main className="min-h-screen bg-[#f6f2ea] px-4 py-5 text-[#203c48]">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#203c48] text-white"><Truck className="h-5 w-5" /></div><div><CardTitle>司机运费账单</CardTitle><CardDescription>仅展示当前微信已绑定车辆的真实趟次、柴油扣款、已付与未付费用。</CardDescription></div></div>
              <Button variant="outline" size="sm" onClick={() => portal.refetch()} disabled={portal.isFetching}><RefreshCw className="mr-1 h-3.5 w-3.5" />刷新</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === "loading" ? <div className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />正在读取司机账单…</div> : null}
            {["invalid", "expired", "unbound", "unavailable"].includes(status) ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><XCircle className="mb-2 h-5 w-5" />账单链接无效、已过期，或当前微信尚未绑定车辆。请从服务号菜单或绑定成功页重新进入。</div> : null}
            {summary ? <>
              <div className="rounded-2xl bg-[#203c48] p-4 text-white"><p className="text-xs opacity-80">当前车辆</p><p className="mt-1 text-2xl font-semibold">{summary.vehicle.plateNo}</p><p className="mt-1 text-sm opacity-85">{summary.vehicle.projectName ?? "未关联项目"}{summary.vehicle.driverName ? ` · ${summary.vehicle.driverName}` : ""}</p></div>
              <div className="grid grid-cols-2 gap-3">{cards.map(card => <div key={card.label} className={`rounded-2xl p-3 ${card.tone}`}><card.icon className="mb-2 h-4 w-4" /><p className="text-xs opacity-75">{card.label}</p><p className="mt-1 text-lg font-semibold">{card.value}</p></div>)}</div>
              <div className="grid gap-3 rounded-2xl border bg-white p-3 text-sm sm:grid-cols-3"><div><p className="text-slate-500">总趟数</p><p className="font-semibold">{summary.totals.tripCount} 趟</p></div><div><p className="text-slate-500">运输总额</p><p className="font-semibold">{formatMoney(summary.totals.grossFreightAmount)}</p></div><div><p className="text-slate-500">已结算扣油</p><p className="font-semibold">{formatMoney(summary.totals.settledFuelDeductionAmount)}</p></div></div>
            </> : null}
          </CardContent>
        </Card>

        {summary ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader><CardTitle className="text-base">费用结算单</CardTitle><CardDescription>已付、未付和待审核状态以后台渣土车费用结算单为准。</CardDescription></CardHeader><CardContent className="space-y-3">{summary.settlements.length ? summary.settlements.map(item => <div key={item.settlementNo} className="rounded-xl border bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.settlementNo}</p><p className="mt-1 text-xs text-slate-500">{item.periodStart} 至 {item.periodEnd} · {item.tripCount} 趟</p></div><Badge variant={item.status === "paid" ? "default" : "outline"}>{settlementStatusLabel(item.status)}</Badge></div><Separator className="my-3" /><div className="grid grid-cols-3 gap-2 text-xs"><span>运费 {formatMoney(item.grossFreightAmount)}</span><span>扣油 {formatMoney(item.fuelDeductionAmount)}</span><span>应付 {formatMoney(item.netPayableAmount)}</span></div>{item.paymentDate ? <p className="mt-2 text-xs text-emerald-700">付款日期：{item.paymentDate}</p> : null}</div>) : <p className="rounded-xl border border-dashed bg-white p-4 text-center text-sm text-slate-500">暂无结算单。</p>}</CardContent></Card> : null}

        {summary ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader><CardTitle className="text-base">柴油扣款明细</CardTitle><CardDescription>项目部供油或外站加油如果勾选“结算扣油”，会进入待扣或已扣口径。</CardDescription></CardHeader><CardContent className="space-y-3">{summary.dieselRecords.length ? summary.dieselRecords.map(item => <div key={item.recordNo} className="rounded-xl border bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.recordNo}</p><p className="mt-1 text-xs text-slate-500">{formatDate(item.refueledAt)} · {item.liters.toFixed(3)}L</p></div><Badge variant="outline">{dieselStatusLabel(item.status)}</Badge></div><p className="mt-2 text-sm">金额 {formatMoney(item.amount)}{item.deductFromFreight ? " · 运费扣油" : ""}</p></div>) : <p className="rounded-xl border border-dashed bg-white p-4 text-center text-sm text-slate-500">暂无柴油扣款记录。</p>}</CardContent></Card> : null}

        {summary ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader><CardTitle className="text-base">最近运输趟次</CardTitle></CardHeader><CardContent className="space-y-3">{summary.recentTrips.length ? summary.recentTrips.map(item => <div key={item.tripNo} className="rounded-xl border bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.tripNo}</p><p className="mt-1 text-xs text-slate-500">{formatDate(item.startAt)}</p></div><Badge variant="outline">{tripStatusLabel(item.status)}</Badge></div><p className="mt-2 text-xs text-slate-600">运费 {formatMoney(item.grossFreightAmount)} · 扣油 {formatMoney(item.fuelDeductionAmount)} · 净额 {formatMoney(item.netSettlementAmount ?? item.grossFreightAmount - item.fuelDeductionAmount)}</p></div>) : <p className="rounded-xl border border-dashed bg-white p-4 text-center text-sm text-slate-500">暂无运输趟次。</p>}</CardContent></Card> : null}
      </div>
    </main>
  );
}
