import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CalendarDays, ChevronRight, CircleAlert, FileText, LoaderCircle, Truck } from "lucide-react";
import { useMemo, useState } from "react";

type MobileTransportLedgerProps = {
  projectId: number;
  workDate: string;
  vehicles: Array<{ id: number; plateNo: string }>;
};

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function tripProgress(trip: { status: "draft" | "submitted" | "verified" | "settled" | "void"; loadConfirmedAt?: Date | string | null; unloadConfirmedAt?: Date | string | null }) {
  if (trip.status === "void") return { label: "已作废", tone: "bg-[#eee8e2] text-[#77685e]", action: "可重新开票" };
  if (trip.status === "settled") return { label: "已结算", tone: "bg-[#e2f0ed] text-[#39736a]", action: "结算已归档" };
  if (trip.status === "verified") return { label: "已核验", tone: "bg-[#e7f1e5] text-[#47754d]", action: "可进入结算" };
  if (trip.unloadConfirmedAt) return { label: "已卸土 · 待核验", tone: "bg-[#eaf2f7] text-[#2e6681]", action: "等待核验" };
  if (trip.loadConfirmedAt) return { label: "已发票 · 运输中", tone: "bg-[#fff1d8] text-[#a25e21]", action: "到卸土点确认卸土" };
  return { label: "已发票 · 待装土", tone: "bg-[#f8ead8] text-[#94603a]", action: "等待装土确认" };
}

export function MobileTransportLedger({ projectId, workDate, vehicles }: MobileTransportLedgerProps) {
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [vehicleId, setVehicleId] = useState<string>("all");
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const month = workDate.slice(0, 7);
  const input = useMemo(() => ({ projectId, ...(period === "day" ? { date: workDate } : { month }), ...(vehicleId !== "all" ? { vehicleId: Number(vehicleId) } : {}) }), [month, period, projectId, vehicleId, workDate]);
  const ledger = trpc.transport.listTrips.useQuery(input, { enabled: Boolean(projectId), retry: false });
  const trips = ledger.data ?? [];
  const metrics = useMemo(() => {
    const validTrips = trips.filter(trip => trip.status !== "void");
    const inTransit = validTrips.filter(trip => Boolean(trip.loadConfirmedAt) && !trip.unloadConfirmedAt).length;
    const unloaded = validTrips.filter(trip => Boolean(trip.unloadConfirmedAt)).length;
    const pendingReview = validTrips.filter(trip => trip.status === "submitted" || trip.status === "draft").length;
    const amount = validTrips.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0);
    const volume = validTrips.reduce((sum, trip) => sum + Number(trip.volumeCubicMeters ?? 0), 0);
    const diesel = validTrips.reduce((sum, trip) => sum + Number(trip.fuelDeductionAmount ?? 0), 0);
    return { count: validTrips.length, inTransit, unloaded, pendingReview, amount, volume, diesel, net: amount - diesel };
  }, [trips]);
  const selectedTrip = trips.find(trip => trip.id === selectedTripId) ?? null;

  return <section className="space-y-3 print:hidden">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">运输运单台账</h2><p className="mt-0.5 text-xs text-[#8f7566]">真实运单、进度、方量、运费与异常明细。</p></div><FileText className="h-5 w-5 text-[#9a5128]" /></div>
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#f0e5d7] p-2"><Button size="sm" variant={period === "day" ? "default" : "ghost"} className={period === "day" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "text-[#765a49]"} onClick={() => setPeriod("day")}>当日台账</Button><Button size="sm" variant={period === "month" ? "default" : "ghost"} className={period === "month" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "text-[#765a49]"} onClick={() => setPeriod("month")}>当月汇总</Button></div>
    <Select value={vehicleId} onValueChange={setVehicleId}><SelectTrigger className="border-[#ead9c8] bg-white"><SelectValue placeholder="全部车辆" /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆</SelectItem>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select>
    <div className="grid grid-cols-3 gap-2"><LedgerMetric label={period === "day" ? "当日趟次" : "当月趟次"} value={metrics.count} /><LedgerMetric label="运输中" value={metrics.inTransit} warning /><LedgerMetric label="已卸土" value={metrics.unloaded} success /><LedgerMetric label="方量" value={`${metrics.volume.toFixed(2)} m³`} /><LedgerMetric label="待核验" value={metrics.pendingReview} warning /><LedgerMetric label="净结算" value={formatMoney(metrics.net)} success /></div>
    <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="grid grid-cols-3 gap-2 text-center text-[11px] text-[#765a49]"><span>应付 {formatMoney(metrics.amount)}</span><span>柴油扣款 {formatMoney(metrics.diesel)}</span><span>{period === "day" ? workDate : month}</span></div></CardContent></Card>
    {ledger.isLoading ? <Card className="border-0 bg-white"><CardContent className="flex items-center justify-center gap-2 p-6 text-sm text-[#8f7566]"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载真实运单…</CardContent></Card> : ledger.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">台账加载失败：{ledger.error.message}</CardContent></Card> : !trips.length ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前筛选条件下暂无运单。</CardContent></Card> : <div className="space-y-2">{trips.map(trip => { const progress = tripProgress(trip); return <button type="button" key={trip.id} onClick={() => setSelectedTripId(trip.id)} className="w-full rounded-2xl bg-white p-3 text-left shadow-[0_6px_18px_rgba(71,42,30,.06)] active:scale-[.99]"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#43291e]">{trip.vehiclePlateNo}</p><p className="mt-1 text-[11px] text-[#8f7566]">{trip.tripNo}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${progress.tone}`}>{progress.label}</span></div><p className="mt-2 text-xs text-[#765a49]">{trip.loadLocation.name} → {trip.unloadLocation.name}</p><div className="mt-2 flex items-center justify-between text-[11px] text-[#8f7566]"><span>{Number(trip.volumeCubicMeters ?? 0).toFixed(2)} m³ · {formatMoney(trip.calculatedAmount)}</span><span className="flex items-center gap-1">详情 <ChevronRight className="h-3.5 w-3.5" /></span></div></button>; })}</div>}
    <Dialog open={Boolean(selectedTrip)} onOpenChange={open => { if (!open) setSelectedTripId(null); }}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>运输运单详情</DialogTitle></DialogHeader>{selectedTrip ? <TripDetail trip={selectedTrip} /> : null}</DialogContent></Dialog>
  </section>;
}

function LedgerMetric({ label, value, warning, success }: { label: string; value: string | number; warning?: boolean; success?: boolean }) {
  return <Card className={`border-0 ${warning ? "bg-[#fff4e7]" : success ? "bg-[#edf7ed]" : "bg-white"}`}><CardContent className="p-2 text-center"><p className={`text-sm font-bold ${warning ? "text-[#a55f25]" : success ? "text-[#3f7549]" : "text-[#43291e]"}`}>{value}</p><p className="mt-1 text-[10px] text-[#8f7566]">{label}</p></CardContent></Card>;
}

function TripDetail({ trip }: { trip: any }) {
  const progress = tripProgress(trip);
  return <div className="space-y-3 text-sm"><div className="rounded-xl bg-[#f8ead8] p-3"><p className="font-bold">{trip.tripNo}</p><p className="mt-1 text-xs text-[#765a49]">{trip.vehiclePlateNo} · 司机 {trip.vehicle?.driverName || "未录入"}</p><p className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-semibold ${progress.tone}`}>{progress.label} · {progress.action}</p></div><DetailBlock title="装卸地点" rows={[["装土点", `${trip.loadLocation.name} · ${trip.loadLocation.address}`], ["装土管理员", trip.loadLocation.administratorName], ["卸土点", `${trip.unloadLocation.name} · ${trip.unloadLocation.address}`], ["卸土管理员", trip.unloadLocation.administratorName]]} /><DetailBlock title="运输与结算" rows={[["开票时间", formatDateTime(trip.startAt)], ["装土确认", formatDateTime(trip.loadConfirmedAt)], ["卸土确认", formatDateTime(trip.unloadConfirmedAt)], ["里程 / 方量", `${trip.actualDistanceKm ?? "—"} km / ${trip.volumeCubicMeters ?? "—"} m³`], ["应付运费", formatMoney(trip.calculatedAmount)], ["柴油扣款 / 净额", `${formatMoney(trip.fuelDeductionAmount)} / ${formatMoney(Number(trip.calculatedAmount ?? 0) - Number(trip.fuelDeductionAmount ?? 0))}`]]} /><DetailBlock title="现场刷卡与异常" rows={trip.cardEvents?.length ? trip.cardEvents.map((event: any) => [event.eventType === "load" ? "装土刷卡" : "卸土刷卡", `${formatDateTime(event.occurredAt)} · ${event.siteName} · ${event.operatorName} · ${event.validationStatus}${event.validationReason ? ` · ${event.validationReason}` : ""}`]) : [["刷卡记录", "暂无刷卡记录"]]} />{trip.anomalies?.length ? <div className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3"><p className="flex items-center gap-1 font-semibold text-[#9c4d27]"><CircleAlert className="h-4 w-4" />待核验提示</p><div className="mt-2 space-y-1 text-xs text-[#80543d]">{trip.anomalies.map((item: any, index: number) => <p key={`${String(item)}-${index}`}>{typeof item === "string" ? item : item.label || item.message || "需人工核验"}</p>)}</div></div> : null}</div>;
}

function DetailBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <div className="rounded-xl border border-[#ead9c8] p-3"><p className="font-semibold text-[#5d3828]">{title}</p><dl className="mt-2 space-y-2 text-xs">{rows.map(([label, value]) => <div className="grid grid-cols-[88px_1fr] gap-2" key={`${label}-${value}`}><dt className="text-[#8f7566]">{label}</dt><dd className="break-words text-[#4e3024]">{value || "未记录"}</dd></div>)}</dl></div>;
}
