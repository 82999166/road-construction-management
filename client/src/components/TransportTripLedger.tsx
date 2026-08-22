import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download, MapPinned, ReceiptText, Truck } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

export type TransportLedgerFilter = {
  periodMode: string;
  date: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  vehicleId: string;
  status: string;
  routePresetId: string;
};

type Props = {
  filter: TransportLedgerFilter;
  onFilterChange: (next: TransportLedgerFilter) => void;
  trips: any[];
  vehicles: any[];
  routePresets: any[];
  loading: boolean;
  projectName: string;
  onTransition: (id: number, nextStatus: "submitted" | "verified" | "settled" | "void") => void;
  transitionPending: boolean;
  onExport: (headers: string[], rows: Array<Array<string | number | null | undefined>>) => void;
};

const statusLabel: Record<string, string> = { draft: "草稿", submitted: "待核验", verified: "已核验", settled: "已结算", void: "已作废" };
const ownershipLabel: Record<string, string> = { owned: "公司自有", leased: "外租车辆", trip_settlement: "渣土车按趟结算" };
const dateTime = (value: unknown) => value ? new Date(value as string | Date).toLocaleString("zh-CN", { hour12: false }) : "未记录";
const money = (value: unknown) => Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal = (value: unknown) => Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const progressLabel = (trip: any) => {
  if (trip.status === "void") return "已作废";
  if (trip.status === "settled") return "已结算";
  if (trip.status === "verified") return "已核验 · 待结算";
  if (trip.unloadConfirmedAt) return "已卸土 · 待核验";
  if (trip.loadConfirmedAt || trip.startAt) return "已发票 · 运输中";
  return "待开票";
};

/** PC 端运输台账仅显示业务地址，绝不输出装卸坐标经纬度。 */
export default function TransportTripLedger({ filter, onFilterChange, trips, vehicles, routePresets, loading, projectName, onTransition, transitionPending, onExport }: Props) {
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const activeTrips = useMemo(() => trips.filter(item => item.status !== "void"), [trips]);
  const overview = useMemo(() => ({
    tripCount: activeTrips.length,
    volume: activeTrips.reduce((sum, item) => sum + Number(item.volumeCubicMeters ?? 0), 0),
    gross: activeTrips.reduce((sum, item) => sum + Number(item.calculatedAmount ?? 0), 0),
    fuel: activeTrips.reduce((sum, item) => sum + Number(item.fuelDeductionAmount ?? 0), 0),
    net: activeTrips.reduce((sum, item) => sum + Number(item.netSettlementAmount ?? item.calculatedAmount ?? 0), 0),
    pending: activeTrips.filter(item => ["draft", "submitted", "verified"].includes(item.status)).length,
  }), [activeTrips]);
  const vehicleSummaries = useMemo(() => {
    const rows = new Map<number, { vehicleId: number; plateNo: string; driverName: string; tripCount: number; volume: number; gross: number; fuel: number; net: number; settled: number; pending: number }>();
    activeTrips.forEach(item => {
      const current = rows.get(item.vehicleId) ?? { vehicleId: item.vehicleId, plateNo: item.vehiclePlateNo ?? `车辆 #${item.vehicleId}`, driverName: item.vehicle?.driverName ?? "未登记", tripCount: 0, volume: 0, gross: 0, fuel: 0, net: 0, settled: 0, pending: 0 };
      current.tripCount += 1;
      current.volume += Number(item.volumeCubicMeters ?? 0);
      current.gross += Number(item.calculatedAmount ?? 0);
      current.fuel += Number(item.fuelDeductionAmount ?? 0);
      current.net += Number(item.netSettlementAmount ?? item.calculatedAmount ?? 0);
      if (item.status === "settled") current.settled += 1; else current.pending += 1;
      rows.set(item.vehicleId, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.tripCount - a.tripCount || a.plateNo.localeCompare(b.plateNo, "zh-CN"));
  }, [activeTrips]);
  const periodDescription = filter.periodMode === "day" ? `日期 ${filter.date || "未选择"}` : filter.periodMode === "month" ? `月份 ${filter.month || "未选择"}` : filter.periodMode === "custom" ? `${filter.dateFrom || "开始"} 至 ${filter.dateTo || "结束"}` : "全部历史";
  const update = (patch: Partial<TransportLedgerFilter>) => onFilterChange({ ...filter, ...patch });
  const canTransition = (trip: any, next: string) => (next === "submitted" && trip.status === "draft") || (next === "verified" && trip.status === "submitted") || (next === "settled" && trip.status === "verified") || (next === "void" && ["draft", "submitted", "verified"].includes(trip.status));

  return <>
    <Card className="w-full border-[#d8e3e0] shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">运输调度 · 核验与结算全台账</p><CardTitle className="mt-1 text-base">车辆趟次、费用、核验与结算</CardTitle><CardDescription className="mt-1">当前显示 {projectName} 的真实业务数据。详情只显示装卸中文地址，不显示经纬度；金额、柴油扣款、状态和结算均以服务端快照为准。</CardDescription></div><Button size="sm" variant="outline" disabled={!trips.length} onClick={() => onExport(["运单号", "车辆", "司机", "装土点", "装土中文地址", "卸土点", "卸土中文地址", "开始时间", "装土确认", "卸土确认", "路线", "里程(km)", "方量(m³)", "单价", "总运费", "柴油扣款", "净结算", "状态", "异常"], trips.map(item => [item.tripNo, item.vehiclePlateNo, item.vehicle?.driverName ?? "", item.loadLocation?.name, item.loadLocation?.address, item.unloadLocation?.name, item.unloadLocation?.address, dateTime(item.startAt), dateTime(item.loadConfirmedAt), dateTime(item.unloadConfirmedAt), item.routeSnapshot?.routePresetId ? `路线 #${item.routeSnapshot.routePresetId}` : "未关联预设", item.actualDistanceKm, item.volumeCubicMeters, item.calculatedUnitPrice, item.calculatedAmount, item.fuelDeductionAmount, item.netSettlementAmount ?? item.calculatedAmount, statusLabel[item.status] ?? item.status, item.anomalies?.map((anomaly: { label?: string }) => anomaly.label ?? "未命名异常").join("；") ?? ""]))}><Download className="mr-1.5 h-4 w-4" />导出当前筛选</Button></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div><Label>汇总期间</Label><Select value={filter.periodMode} onValueChange={value => update({ periodMode: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">单日</SelectItem><SelectItem value="month">自然月</SelectItem><SelectItem value="custom">日期区间</SelectItem><SelectItem value="all">全部历史</SelectItem></SelectContent></Select></div>
          {filter.periodMode === "day" ? <div><Label>运输日期</Label><Input className="mt-1" type="date" value={filter.date} onChange={event => update({ date: event.target.value })} /></div> : null}
          {filter.periodMode === "month" ? <div><Label>运输月份</Label><Input className="mt-1" type="month" value={filter.month} onChange={event => update({ month: event.target.value })} /></div> : null}
          {filter.periodMode === "custom" ? <><div><Label>开始日期</Label><Input className="mt-1" type="date" value={filter.dateFrom} onChange={event => update({ dateFrom: event.target.value })} /></div><div><Label>结束日期</Label><Input className="mt-1" type="date" value={filter.dateTo} onChange={event => update({ dateTo: event.target.value })} /></div></> : null}
          <div><Label>车辆</Label><Select value={filter.vehicleId} onValueChange={value => update({ vehicleId: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆</SelectItem>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>运输路线</Label><Select value={filter.routePresetId} onValueChange={value => update({ routePresetId: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部路线</SelectItem>{routePresets.map(route => <SelectItem key={route.id} value={String(route.id)}>路线 #{route.id}{route.isDefault ? " · 默认" : ""}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>核验/结算状态</Label><Select value={filter.status} onValueChange={value => update({ status: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="submitted">待核验</SelectItem><SelectItem value="verified">已核验待结算</SelectItem><SelectItem value="settled">已结算</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Stat label="当前筛选" value={periodDescription} icon={<MapPinned className="h-4 w-4" />} /><Stat label="有效趟次" value={overview.tripCount} icon={<ReceiptText className="h-4 w-4" />} /><Stat label="结算方量" value={`${decimal(overview.volume)} m³`} icon={<Truck className="h-4 w-4" />} /><Stat label="总运费" value={`¥${money(overview.gross)}`} icon={<BarChart3 className="h-4 w-4" />} /><Stat label="柴油扣款" value={`¥${money(overview.fuel)}`} icon={<BarChart3 className="h-4 w-4" />} /><Stat label="净结算 / 待办" value={`¥${money(overview.net)} / ${overview.pending} 单`} icon={<BarChart3 className="h-4 w-4" />} /></div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d8e3e0] bg-[#f8fcfb] px-3 py-2 text-xs text-slate-600"><span className="font-semibold text-[#203c48]">发票类型：</span><Badge className="bg-[#ecf5ff] text-[#1d5f91] hover:bg-[#ecf5ff]">刷卡发票</Badge><span>车辆 NFC 卡开票</span><Badge className="ml-2 bg-[#edf8ef] text-[#2e7040] hover:bg-[#edf8ef]">拍照发票</Badge><span>车牌直拍开票；每单类型显示于运单号下方。</span></div>
        <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1320px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>运单号 / 开票</TableHead><TableHead>车辆 / 司机</TableHead><TableHead>装土 → 卸土</TableHead><TableHead>装卸时间</TableHead><TableHead>里程 / 方量</TableHead><TableHead>费用 / 扣款 / 净额</TableHead><TableHead>运输进度 / 核验结算</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-slate-500">正在读取运输台账…</TableCell></TableRow> : trips.length ? trips.map(item => <TableRow key={item.id} className="hover:bg-[#fbfaf1]"><TableCell><p className="font-semibold text-[#203c48]">{item.tripNo}</p><p className="mt-1 text-slate-500">{item.invoiceMode === "plate_photo" ? "车牌直拍" : "NFC 刷卡"}</p></TableCell><TableCell><p className="font-medium">{item.vehiclePlateNo}</p><p className="mt-1 text-slate-500">{item.vehicle?.driverName || "司机未登记"} · {ownershipLabel[item.vehicle?.ownership] ?? "—"}</p></TableCell><TableCell><p className="font-medium">{item.loadLocation?.name || "未设置"} → {item.unloadLocation?.name || "未设置"}</p><p className="mt-1 max-w-[220px] truncate text-slate-500">{item.loadLocation?.address || "未登记中文地址"} → {item.unloadLocation?.address || "未登记中文地址"}</p></TableCell><TableCell><p>开票 {dateTime(item.startAt)}</p><p className="mt-1 text-slate-500">装 {dateTime(item.loadConfirmedAt)} · 卸 {dateTime(item.unloadConfirmedAt)}</p></TableCell><TableCell><p>{decimal(item.actualDistanceKm)} km</p><p className="mt-1 text-slate-500">{decimal(item.volumeCubicMeters)} m³</p></TableCell><TableCell><p>总 ¥{money(item.calculatedAmount)}</p><p className="mt-1 text-slate-500">扣油 ¥{money(item.fuelDeductionAmount)} · 净 ¥{money(item.netSettlementAmount ?? item.calculatedAmount)}</p></TableCell><TableCell><div className="flex flex-wrap gap-1"><Badge className={item.status === "void" ? "bg-slate-100 text-slate-600 hover:bg-slate-100" : item.unloadConfirmedAt ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "bg-sky-50 text-sky-700 hover:bg-sky-50"}>{progressLabel(item)}</Badge><Badge variant="outline">{statusLabel[item.status] ?? item.status}</Badge>{item.anomalies?.slice(0, 2).map((anomaly: { code: string; label: string }) => <Badge key={anomaly.code} className="bg-amber-50 text-amber-700 hover:bg-amber-50">{anomaly.label}</Badge>)}</div></TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedTrip(item)}>详情</Button>{canTransition(item, "submitted") ? <Button size="sm" onClick={() => onTransition(item.id, "submitted")} disabled={transitionPending}>提交</Button> : null}{canTransition(item, "verified") ? <Button size="sm" onClick={() => onTransition(item.id, "verified")} disabled={transitionPending}>核验</Button> : null}{canTransition(item, "settled") ? <Button size="sm" onClick={() => onTransition(item.id, "settled")} disabled={transitionPending}>结算</Button> : null}{canTransition(item, "void") ? <Button size="sm" variant="outline" onClick={() => onTransition(item.id, "void")} disabled={transitionPending}>作废</Button> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-10 text-center text-slate-500">当前筛选下没有真实运输趟次。</TableCell></TableRow>}</TableBody></Table></div>
        <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold text-[#203c48]">按车辆汇总</p><p className="mt-1 text-xs text-slate-500">随当前日、月、全部历史或日期区间筛选同步汇总；按趟结算车辆只计算运费与柴油扣款，不计租金。</p></div><Badge variant="outline">{vehicleSummaries.length} 台车辆</Badge></div><div className="overflow-x-auto"><Table className="min-w-[920px] text-xs"><TableHeader><TableRow><TableHead>车辆 / 司机</TableHead><TableHead>趟次</TableHead><TableHead>方量</TableHead><TableHead>总运费</TableHead><TableHead>柴油扣款</TableHead><TableHead>净结算</TableHead><TableHead>已结算 / 待处理</TableHead></TableRow></TableHeader><TableBody>{vehicleSummaries.length ? vehicleSummaries.map(item => <TableRow key={item.vehicleId}><TableCell><p className="font-medium">{item.plateNo}</p><p className="mt-1 text-slate-500">{item.driverName}</p></TableCell><TableCell>{item.tripCount}</TableCell><TableCell>{decimal(item.volume)} m³</TableCell><TableCell>¥{money(item.gross)}</TableCell><TableCell>¥{money(item.fuel)}</TableCell><TableCell className="font-medium">¥{money(item.net)}</TableCell><TableCell>{item.settled} / {item.pending}</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-6 text-center text-slate-500">当前筛选下暂无可汇总车辆。</TableCell></TableRow>}</TableBody></Table></div></div>
      </CardContent>
    </Card>
    <Dialog open={Boolean(selectedTrip)} onOpenChange={open => { if (!open) setSelectedTrip(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{selectedTrip ? `完整运单详情 · ${selectedTrip.tripNo}` : "完整运单详情"}</DialogTitle><DialogDescription>展示真实运输、核验和结算快照。地点只显示中文名称与地址，不显示装卸经纬度。</DialogDescription></DialogHeader>{selectedTrip ? <div className="space-y-4"><div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><Detail label="车辆 / 司机" value={`${selectedTrip.vehiclePlateNo} · ${selectedTrip.vehicle?.driverName || "未登记"}`} /><Detail label="车辆性质 / 理论方量" value={`${ownershipLabel[selectedTrip.vehicle?.ownership] ?? "—"} · ${decimal(selectedTrip.vehicle?.theoreticalVolumeCubicMeters)} m³`} /><Detail label="状态" value={statusLabel[selectedTrip.status] ?? selectedTrip.status} /><Detail label="装土点 / 发票管理员" value={`${selectedTrip.loadLocation?.name || "未设置"} · ${selectedTrip.loadLocation?.administratorName || "未指定"}`} /><Detail label="卸土点 / 确认管理员" value={`${selectedTrip.unloadLocation?.name || "未设置"} · ${selectedTrip.unloadLocation?.administratorName || "未指定"}`} /><Detail label="装土点中文地址" value={`${selectedTrip.loadLocation?.address || "未登记"}`} /><Detail label="卸土点中文地址" value={`${selectedTrip.unloadLocation?.address || "未登记"}`} /><Detail label="运输路线 / 开票方式" value={`${selectedTrip.routeSnapshot?.routePresetId ? `路线 #${selectedTrip.routeSnapshot.routePresetId}` : "未关联预设"} · ${selectedTrip.invoiceMode === "plate_photo" ? "车牌直拍" : "NFC 刷卡"}`} /></div><div className="grid gap-3 rounded-xl border border-[#d8e3e0] p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Detail label="开票时间" value={dateTime(selectedTrip.startAt)} /><Detail label="装土确认时间" value={dateTime(selectedTrip.loadConfirmedAt)} /><Detail label="卸土确认时间" value={dateTime(selectedTrip.unloadConfirmedAt)} /><Detail label="结束时间" value={dateTime(selectedTrip.endAt)} /><Detail label="实际里程" value={`${decimal(selectedTrip.actualDistanceKm)} km`} /><Detail label="运输方量 / 吨位" value={`${decimal(selectedTrip.volumeCubicMeters)} m³ / ${selectedTrip.weightTons === null ? "未登记" : `${decimal(selectedTrip.weightTons)} t`}`} /><Detail label="单价 / 总运费" value={`¥${money(selectedTrip.calculatedUnitPrice)} / ¥${money(selectedTrip.calculatedAmount)}`} /><Detail label="柴油扣款 / 净结算" value={`¥${money(selectedTrip.fuelDeductionAmount)} / ¥${money(selectedTrip.netSettlementAmount ?? selectedTrip.calculatedAmount)}`} /></div><div className="rounded-xl border border-[#e1e8e4] p-3"><p className="text-sm font-semibold text-[#203c48]">装卸刷卡、核验与异常轨迹</p>{selectedTrip.cardEvents?.length ? <div className="mt-2 space-y-2">{selectedTrip.cardEvents.map((event: any, index: number) => <div key={`${event.eventType}-${index}`} className="rounded-lg bg-slate-50 p-2 text-xs"><p className="font-medium">{event.eventType === "load" ? "装土" : "卸土"}刷卡 · {dateTime(event.occurredAt)} · {event.validationStatus}</p><p className="mt-1 text-slate-500">地点 {event.siteName || "未登记"} · 确认管理员 {event.operatorName || "未登记"} · 设备 {event.deviceId || "未登记"}{event.validationReason ? ` · ${event.validationReason}` : ""}</p></div>)}</div> : <p className="mt-2 text-xs text-slate-500">暂无读卡事件；当前仍以运单状态和服务端核验为准。</p>}<p className="mt-3 text-xs text-slate-600">异常：{selectedTrip.anomalies?.length ? selectedTrip.anomalies.map((anomaly: { label?: string }) => anomaly.label ?? "未命名异常").join("；") : "无"}</p></div></div> : null}<DialogFooter><Button onClick={() => setSelectedTrip(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) { return <div className="rounded-xl border border-[#e1e8e4] bg-white p-3"><div className="flex items-center justify-between text-xs text-slate-500"><span>{label}</span>{icon}</div><p className="mt-2 text-base font-semibold text-[#203c48]">{value}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-medium text-slate-800">{value}</p></div>; }
