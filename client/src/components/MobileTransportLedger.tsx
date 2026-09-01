import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CalendarDays, ChevronRight, CircleAlert, ExternalLink, FileText, Fuel, LoaderCircle, Truck } from "lucide-react";
import { useMemo, useState } from "react";

type MobileTransportLedgerProps = {
  projectId: number;
  workDate: string;
  vehicles: Array<{ id: number; plateNo: string }>;
  onConfirmPlatePhotoUnload?: (tripId: number) => void;
};

function formatMoney(value: string | number | null | undefined) { return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatDateTime(value: Date | string | null | undefined) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未记录"; }
function tripProgress(trip: { status: "draft" | "submitted" | "verified" | "settled" | "void"; loadConfirmedAt?: Date | string | null; unloadConfirmedAt?: Date | string | null }) {
  if (trip.status === "void") return { label: "已作废", tone: "bg-[#eee8e2] text-[#77685e]", action: "可重新开票" };
  if (trip.status === "settled") return { label: "已结算", tone: "bg-[#e2f0ed] text-[#39736a]", action: "结算已归档" };
  if (trip.status === "verified") return { label: "已核验", tone: "bg-[#e7f1e5] text-[#47754d]", action: "可进入结算" };
  if (trip.unloadConfirmedAt) return { label: "已卸土 · 待核验", tone: "bg-[#eaf2f7] text-[#2e6681]", action: "等待核验" };
  if (trip.loadConfirmedAt) return { label: "已发票 · 运输中", tone: "bg-[#fff1d8] text-[#a25e21]", action: "到卸土点确认卸土" };
  return { label: "已发票 · 待装土", tone: "bg-[#f8ead8] text-[#94603a]", action: "等待装土确认" };
}

function canConfirmPhotoUnload(trip: any) {
  return trip.invoiceMode === "plate_photo"
    && Boolean(trip.loadConfirmedAt)
    && !trip.unloadConfirmedAt
    && !["void", "settled"].includes(trip.status);
}

export function MobileTransportLedger({ projectId, workDate, vehicles, onConfirmPlatePhotoUnload }: MobileTransportLedgerProps) {
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [vehicleId, setVehicleId] = useState("all");
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [fuelDetailOpen, setFuelDetailOpen] = useState(false);
  const [inTransitOnly, setInTransitOnly] = useState(false);
  const month = workDate.slice(0, 7);
  const input = useMemo(() => ({ projectId, ...(period === "day" ? { date: workDate } : { month }), ...(vehicleId !== "all" ? { vehicleId: Number(vehicleId) } : {}) }), [month, period, projectId, vehicleId, workDate]);
  const ledger = trpc.transport.listTrips.useQuery(input, { enabled: Boolean(projectId), retry: false });
  const dailySettlement = trpc.transport.dailyVehicleSettlementSummary.useQuery({ projectId, date: workDate }, { enabled: Boolean(projectId) && period === "day", retry: false });
  const fuelDeductionDetails = trpc.transport.driverFuelDeductionDetails.useQuery({ projectId, date: workDate }, { enabled: Boolean(projectId) && period === "day", retry: false });
  const trips = ledger.data ?? [];
  const metrics = useMemo(() => {
    const valid = trips.filter(trip => trip.status !== "void");
    const inTransit = valid.filter(trip => Boolean(trip.loadConfirmedAt) && !trip.unloadConfirmedAt).length;
    const unloaded = valid.filter(trip => Boolean(trip.unloadConfirmedAt)).length;
    const pendingReview = valid.filter(trip => trip.status === "submitted" || trip.status === "draft").length;
    const amount = valid.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0);
    const volume = valid.reduce((sum, trip) => sum + Number(trip.volumeCubicMeters ?? 0), 0);
    const diesel = valid.reduce((sum, trip) => sum + Number(trip.fuelDeductionAmount ?? 0), 0);
    return { count: valid.length, inTransit, unloaded, pendingReview, amount, volume, diesel, net: amount - diesel };
  }, [trips]);
  const displayTrips = useMemo(() => inTransitOnly ? trips.filter(trip => trip.status !== "void" && Boolean(trip.loadConfirmedAt) && !trip.unloadConfirmedAt) : trips, [inTransitOnly, trips]);
  const selectedTrip = trips.find(trip => trip.id === selectedTripId) ?? null;
  const openPhotoUnload = (tripId: number) => {
    setSelectedTripId(null);
    onConfirmPlatePhotoUnload?.(tripId);
  };

  return <section className="space-y-3 print:hidden">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">司机运输台账</h2><p className="mt-0.5 text-xs text-[#8f7566]">真实趟次、运输费用、柴油扣款和现场进度。</p></div><FileText className="h-5 w-5 text-[#9a5128]" /></div>
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#f0e5d7] p-2"><Button size="sm" variant={period === "day" ? "default" : "ghost"} className={period === "day" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "text-[#765a49]"} onClick={() => { setPeriod("day"); setInTransitOnly(false); }}>当日台账</Button><Button size="sm" variant={period === "month" ? "default" : "ghost"} className={period === "month" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "text-[#765a49]"} onClick={() => { setPeriod("month"); setInTransitOnly(false); }}>当月汇总</Button></div>
    <Select value={vehicleId} onValueChange={value => { setVehicleId(value); setInTransitOnly(false); }}><SelectTrigger className="border-[#ead9c8] bg-white"><SelectValue placeholder="全部车辆" /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆</SelectItem>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select>
    <div className="grid grid-cols-3 gap-2"><LedgerMetric label={period === "day" ? "当日趟次" : "当月趟次"} value={metrics.count} /><LedgerMetric label="运输总费用" value={formatMoney(metrics.amount)} success /><LedgerMetric label={period === "day" ? "加油扣款" : "柴油扣款"} value={period === "day" ? formatMoney(fuelDeductionDetails.data?.totalAmount) : formatMoney(metrics.diesel)} warning onClick={period === "day" ? () => setFuelDetailOpen(true) : undefined} /><LedgerMetric label="运输中" value={metrics.inTransit} warning onClick={() => setInTransitOnly(current => !current)} active={inTransitOnly} /><LedgerMetric label="已卸土" value={metrics.unloaded} success /><LedgerMetric label="净结算" value={formatMoney(metrics.net)} success /></div>
    {inTransitOnly ? <div className="flex items-center justify-between rounded-xl border border-[#e7bd84] bg-[#fff8ef] px-3 py-2 text-xs text-[#8f5826]"><span>当前仅显示运输中运单</span><Button variant="ghost" size="sm" className="h-6 px-2 text-[#8f5826]" onClick={() => setInTransitOnly(false)}>查看全部</Button></div> : null}
    <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="grid grid-cols-3 gap-2 text-center text-[11px] text-[#765a49]"><span>应付 {formatMoney(metrics.amount)}</span><span>已结算扣油 {formatMoney(metrics.diesel)}</span><span>{period === "day" ? workDate : month}</span></div></CardContent></Card>
    {period === "day" ? <button type="button" onClick={() => setFuelDetailOpen(true)} className="w-full rounded-2xl bg-[#fff8ef] p-3 text-left shadow-[0_6px_18px_rgba(71,42,30,.06)] active:scale-[.99]"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f5dfb9] text-[#9a5128]"><Fuel className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-[#43291e]">柴油扣款明细</p><p className="mt-0.5 text-[11px] text-[#8f7566]">查看加油时间、油量、金额与加油机表数</p></div></div><span className="flex items-center gap-1 text-xs font-semibold text-[#9a5128]">查看 <ChevronRight className="h-4 w-4" /></span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white/80 p-2 text-center text-[11px] text-[#765a49]"><span>{fuelDeductionDetails.isLoading ? "汇总中" : `${fuelDeductionDetails.data?.recordCount ?? 0} 笔扣款`}</span><span>{fuelDeductionDetails.isLoading ? "—" : `${Number(fuelDeductionDetails.data?.totalLiters ?? 0).toFixed(2)} L`}</span><span className="font-semibold text-[#9a5128]">{formatMoney(fuelDeductionDetails.data?.totalAmount)}</span></div></button> : null}
    {period === "day" && !inTransitOnly ? <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-[#43291e]">按车牌日结汇总</p><span className="text-[10px] text-[#8f7566]">{workDate}</span></div>{dailySettlement.isLoading ? <p className="py-2 text-center text-xs text-[#8f7566]">正在汇总真实运单…</p> : dailySettlement.data?.vehicleSummaries.length ? <div className="space-y-2">{dailySettlement.data.vehicleSummaries.filter(item => vehicleId === "all" || String(item.vehicleId) === vehicleId).map(item => <div key={item.vehicleId} className="rounded-xl bg-[#faf5ed] p-2 text-xs"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-[#43291e]">{item.plateNo}</p><span className="text-[#8f7566]">{item.tripCount} 趟 · {Number(item.totalVolumeCubicMeters).toFixed(2)} m³</span></div><div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-[#765a49]"><span>运费 {formatMoney(item.grossFreightAmount)}</span><span>扣油 {formatMoney(item.fuelDeductionAmount)}</span><span className="font-semibold text-[#47754d]">净额 {formatMoney(item.netPayableAmount)}</span></div></div>)}</div> : <p className="py-2 text-center text-xs text-[#8f7566]">当日暂无可汇总运单。</p>}</CardContent></Card> : null}
    {ledger.isLoading ? <Card className="border-0 bg-white"><CardContent className="flex items-center justify-center gap-2 p-6 text-sm text-[#8f7566]"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载真实运单…</CardContent></Card> : ledger.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">台账加载失败：{ledger.error.message}</CardContent></Card> : !displayTrips.length ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">{inTransitOnly ? "当前没有运输中的运单。" : "当前筛选条件下暂无运单。"}</CardContent></Card> : <div className="space-y-2">{displayTrips.map(trip => {
      const progress = tripProgress(trip);
      const showUnload = Boolean(onConfirmPlatePhotoUnload) && canConfirmPhotoUnload(trip);
      return <div key={trip.id} className="w-full rounded-2xl bg-white p-3 text-left shadow-[0_6px_18px_rgba(71,42,30,.06)]">
        <button type="button" onClick={() => setSelectedTripId(trip.id)} className="w-full text-left active:scale-[.99]">
          <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#43291e]">{trip.vehiclePlateNo}</p><p className="mt-1 text-[11px] text-[#8f7566]">{trip.tripNo} · {trip.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${progress.tone}`}>{progress.label}</span></div>
          <p className="mt-2 text-xs text-[#765a49]">{trip.loadLocation.name} → {trip.unloadLocation.name}</p>
        </button>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#8f7566]">
          <span>{Number(trip.volumeCubicMeters ?? 0).toFixed(2)} m³ · {formatMoney(trip.calculatedAmount)}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {showUnload ? <Button type="button" size="sm" className="h-8 bg-[#47754d] px-3 text-xs font-semibold text-white hover:bg-[#39623e]" onClick={() => openPhotoUnload(trip.id)}>确认卸土</Button> : null}
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-[#8f7566]" onClick={() => setSelectedTripId(trip.id)}>详情 <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </div>;
    })}</div>}
    <Dialog open={Boolean(selectedTrip)} onOpenChange={open => { if (!open) setSelectedTripId(null); }}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>运输运单详情</DialogTitle></DialogHeader>{selectedTrip ? <TripDetail trip={selectedTrip} onConfirmPlatePhotoUnload={onConfirmPlatePhotoUnload ? openPhotoUnload : undefined} /> : null}</DialogContent></Dialog>
    <Dialog open={fuelDetailOpen} onOpenChange={setFuelDetailOpen}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>柴油扣款详情</DialogTitle></DialogHeader><p className="text-xs leading-5 text-[#8f7566]">仅显示 {workDate} 当前可见车辆的有效运输扣油记录；“未记录”表示当次加油未填写加油机表数。</p>{fuelDeductionDetails.isLoading ? <p className="py-6 text-center text-sm text-[#8f7566]">正在加载真实柴油扣款记录…</p> : fuelDeductionDetails.error ? <p className="rounded-xl bg-[#fff5ed] p-3 text-sm text-[#9c4d27]">柴油明细加载失败：{fuelDeductionDetails.error.message}</p> : !fuelDeductionDetails.data?.records.length ? <p className="py-6 text-center text-sm text-[#8f7566]">当日暂无运输扣油记录。</p> : <div className="space-y-3">{fuelDeductionDetails.data.records.map(record => <FuelDeductionDetail key={record.id} record={record} />)}</div>}</DialogContent></Dialog>
  </section>;
}

function LedgerMetric({ label, value, warning, success, onClick, active }: { label: string; value: string | number; warning?: boolean; success?: boolean; onClick?: () => void; active?: boolean }) {
  const className = `border-0 ${warning ? "bg-[#fff4e7]" : success ? "bg-[#edf7ed]" : "bg-white"} ${onClick ? "cursor-pointer active:scale-[.98]" : ""} ${active ? "ring-2 ring-[#c17735]" : ""}`;
  return <Card className={className} onClick={onClick}><CardContent className="p-2 text-center"><p className={`text-sm font-bold ${warning ? "text-[#a55f25]" : success ? "text-[#3f7549]" : "text-[#43291e]"}`}>{value}</p><p className="mt-1 text-[10px] text-[#8f7566]">{label}</p></CardContent></Card>;
}

function TripDetail({ trip, onConfirmPlatePhotoUnload }: { trip: any; onConfirmPlatePhotoUnload?: (tripId: number) => void }) {
  const progress = tripProgress(trip);
  return <div className="space-y-3 text-sm"><div className="rounded-xl bg-[#f8ead8] p-3"><p className="font-bold">{trip.tripNo}</p><p className="mt-1 text-xs text-[#765a49]">{trip.vehiclePlateNo} · 司机 {trip.vehicle?.driverName || "未录入"}</p><p className="mt-1 text-xs text-[#765a49]">发票类型：{trip.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票"}</p><p className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-semibold ${progress.tone}`}>{progress.label} · {progress.action}</p></div><DetailBlock title="装卸地点与责任人" rows={[["装土点", `${trip.loadLocation.name} · ${trip.loadLocation.address}`], ["装土发票管理员", trip.loadConfirmation?.administratorName ?? "未确认"], ["装土确认时间", formatDateTime(trip.loadConfirmation?.confirmedAt ?? trip.loadConfirmedAt)], ["卸土点", `${trip.unloadLocation.name} · ${trip.unloadLocation.address}`], ["卸土确认管理员", trip.unloadConfirmation?.administratorName ?? "未确认"], ["卸土确认时间", formatDateTime(trip.unloadConfirmation?.confirmedAt ?? trip.unloadConfirmedAt)]]} /><DetailBlock title="运输与结算" rows={[["开票时间", formatDateTime(trip.startAt)], ["里程 / 方量", `${trip.actualDistanceKm ?? "—"} km / ${trip.volumeCubicMeters ?? "—"} m³`], ["应付运费", formatMoney(trip.calculatedAmount)], ["柴油扣款 / 净额", `${formatMoney(trip.fuelDeductionAmount)} / ${formatMoney(Number(trip.calculatedAmount ?? 0) - Number(trip.fuelDeductionAmount ?? 0))}`]]} /><DetailBlock title="现场刷卡与异常" rows={trip.cardEvents?.length ? trip.cardEvents.map((event: any) => [event.eventType === "load" ? "装土刷卡" : "卸土刷卡", `${formatDateTime(event.occurredAt)} · ${event.siteName} · ${event.operatorName} · ${event.validationStatus}${event.validationReason ? ` · ${event.validationReason}` : ""}`]) : [["刷卡记录", "暂无刷卡记录"]]} />{trip.anomalies?.length ? <div className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3"><p className="flex items-center gap-1 font-semibold text-[#9c4d27]"><CircleAlert className="h-4 w-4" />待核验提示</p><div className="mt-2 space-y-1 text-xs text-[#80543d]">{trip.anomalies.map((item: any, index: number) => <p key={`${String(item)}-${index}`}>{typeof item === "string" ? item : item.label || item.message || "需人工核验"}</p>)}</div></div> : null}{onConfirmPlatePhotoUnload && canConfirmPhotoUnload(trip) ? <Button type="button" className="w-full bg-[#47754d] text-white hover:bg-[#39623e]" onClick={() => onConfirmPlatePhotoUnload(trip.id)}>拍摄卸土现场并确认卸土</Button> : null}</div>;
}

function FuelDeductionDetail({ record }: { record: any }) {
  return <div className="rounded-xl border border-[#ead9c8] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#5d3828]">{record.vehiclePlateNo}</p><p className="mt-1 text-[11px] text-[#8f7566]">{record.recordNo}</p></div><span className="rounded-full bg-[#fff2de] px-2 py-1 text-xs font-semibold text-[#9a5128]">{formatMoney(record.amount)}</span></div><div className="mt-3"><DetailBlock title="加油与扣款信息" rows={[["加油时间", formatDateTime(record.refueledAt)], ["油量", `${Number(record.liters).toFixed(2)} L`], ["加油金额", formatMoney(record.amount)], ["扣款单价", `${formatMoney(record.appliedUnitPrice)} / L`], ["加油机表数", record.meterReading === null || record.meterReading === undefined ? "未记录" : String(record.meterReading)], ["供油方式", record.supplyMethod === "external_station" ? "外部加油站" : "项目部供油"], ["加油站/供油方", record.stationOrSupplierName || "未记录"], ["票据编号", record.receiptNo || "未记录"], ["备注", record.remarks || "未记录"]]} /></div>{record.evidence ? <a href={record.evidence.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between rounded-lg bg-[#f8ead8] px-3 py-2 text-xs font-semibold text-[#80543d]"><span>查看受控加油凭证</span><ExternalLink className="h-3.5 w-3.5" /></a> : null}</div>;
}

function DetailBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) { return <div className="rounded-xl border border-[#ead9c8] p-3"><p className="font-semibold text-[#5d3828]">{title}</p><dl className="mt-2 space-y-2 text-xs">{rows.map(([label, value]) => <div className="grid grid-cols-[88px_1fr] gap-2" key={`${label}-${value}`}><dt className="text-[#8f7566]">{label}</dt><dd className="break-words text-[#4e3024]">{value || "未记录"}</dd></div>)}</dl></div>; }
