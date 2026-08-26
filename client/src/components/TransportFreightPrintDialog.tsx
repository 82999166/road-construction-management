import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { FileDown, LoaderCircle, Printer } from "lucide-react";
import { useMemo, useState } from "react";

type TransportFreightPrintDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
  initialDate: string;
  vehicles: Array<{ id: number; plateNo: string }>;
};

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function tripStatusLabel(status: "draft" | "submitted" | "verified" | "settled" | "void") {
  return { draft: "草稿", submitted: "待核验", verified: "已核验", settled: "已结算", void: "已作废" }[status];
}

/** A4 横向打印明细只复用运输路由的受控投影；纯司机查询仍由服务端收敛为本人绑定车辆。 */
export function TransportFreightPrintDialog({ open, onOpenChange, projectId, projectName, initialDate, vehicles }: TransportFreightPrintDialogProps) {
  const [vehicleId, setVehicleId] = useState("all");
  const [dateFrom, setDateFrom] = useState(initialDate);
  const [dateTo, setDateTo] = useState(initialDate);
  const [includeVoid, setIncludeVoid] = useState(false);
  const queryInput = useMemo(() => ({
    projectId,
    dateFrom,
    dateTo,
    ...(vehicleId !== "all" ? { vehicleId: Number(vehicleId) } : {}),
  }), [dateFrom, dateTo, projectId, vehicleId]);
  const tripsQuery = trpc.transport.listTrips.useQuery(queryInput, { enabled: open && Boolean(projectId) && Boolean(dateFrom) && Boolean(dateTo), retry: false });
  const trips = useMemo(() => (tripsQuery.data ?? []).filter(trip => includeVoid || trip.status !== "void"), [includeVoid, tripsQuery.data]);
  const totals = useMemo(() => trips.reduce((current, trip) => {
    const gross = Number(trip.calculatedAmount ?? 0);
    const fuel = Number(trip.fuelDeductionAmount ?? 0);
    const net = Number(trip.netSettlementAmount ?? gross - fuel);
    current.gross += gross;
    current.fuel += fuel;
    current.net += net;
    current.volume += Number(trip.volumeCubicMeters ?? 0);
    current.vehicleIds.add(trip.vehicleId);
    return current;
  }, { gross: 0, fuel: 0, net: 0, volume: 0, vehicleIds: new Set<number>() }), [trips]);
  const canPrint = Boolean(trips.length) && !tripsQuery.isLoading && !tripsQuery.error;

  function printFreightStatement() {
    if (!canPrint) return;
    window.print();
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto print:max-h-none print:max-w-none print:overflow-visible">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          #transport-freight-print-sheet, #transport-freight-print-sheet * { visibility: visible !important; }
          #transport-freight-print-sheet { position: absolute; inset: 0; width: 100%; color: #111 !important; background: #fff !important; }
          .freight-print-hidden { display: none !important; }
          .freight-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
          .freight-print-table th, .freight-print-table td { border: 1px solid #222; padding: 4px; vertical-align: middle; word-break: break-word; }
          .freight-print-table thead { display: table-header-group; }
          .freight-print-table tr { break-inside: avoid; }
        }
      `}</style>
      <div className="freight-print-hidden"><DialogHeader><DialogTitle>运输运费明细打印</DialogTitle></DialogHeader>
        <p className="mt-1 text-xs leading-5 text-[#765544]">按车牌与日期查询真实运单。默认不含作废单；点击“打印 / 保存 PDF”后请在系统打印窗口选择“另存为 PDF”。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div><Label>车牌号</Label><Select value={vehicleId} onValueChange={setVehicleId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆</SelectItem>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>开始日期</Label><Input className="mt-1" type="date" value={dateFrom} max={dateTo || undefined} onChange={event => setDateFrom(event.target.value)} /></div>
          <div><Label>结束日期</Label><Input className="mt-1" type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)} /></div>
          <label className="mt-6 flex h-10 items-center gap-2 rounded-md border border-[#ead9c8] bg-[#fffaf5] px-3 text-sm text-[#5d3828]"><input type="checkbox" checked={includeVoid} onChange={event => setIncludeVoid(event.target.checked)} />包含作废单</label>
        </div>
        {dateFrom && dateTo && dateFrom > dateTo ? <p className="mt-3 text-sm text-[#a74328]">结束日期不能早于开始日期。</p> : null}
        {tripsQuery.isLoading ? <p className="mt-4 flex items-center gap-2 text-sm text-[#765544]"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取真实运输运单…</p> : null}
        {tripsQuery.error ? <p className="mt-4 rounded-lg bg-[#fff2eb] p-3 text-sm text-[#a74328]">运费明细读取失败：{tripsQuery.error.message}</p> : null}
      </div>

      <section id="transport-freight-print-sheet" className="mt-5 bg-white p-4 text-[#1f1712] print:mt-0 print:p-0">
        <header className="border-b-2 border-[#3a2117] pb-3 text-center"><h1 className="text-xl font-bold">运输运费明细表</h1><p className="mt-1 text-xs">项目：{projectName}　|　车牌：{vehicleId === "all" ? "全部车辆" : vehicles.find(item => String(item.id) === vehicleId)?.plateNo ?? "已选车辆"}　|　期间：{dateFrom || "—"} 至 {dateTo || "—"}</p><p className="mt-1 text-[10px] text-[#5e5147]">生成时间：{new Date().toLocaleString("zh-CN", { hour12: false })}　|　数据范围：当前账号已授权项目与车辆</p></header>
        <table className="freight-print-table mt-3 w-full table-fixed border-collapse text-[10px]"><thead className="bg-[#eee2d2]"><tr><th className="w-[3%]">序号</th><th className="w-[10%]">业务时间</th><th className="w-[7%]">车牌</th><th className="w-[10%]">运单号</th><th className="w-[19%]">运输路线</th><th className="w-[6%]">方量</th><th className="w-[6%]">里程</th><th className="w-[8%]">运价</th><th className="w-[8%]">应付运费</th><th className="w-[8%]">柴油扣款</th><th className="w-[8%]">净额</th><th className="w-[7%]">状态</th></tr></thead><tbody>
          {trips.map((trip, index) => { const gross = Number(trip.calculatedAmount ?? 0); const fuel = Number(trip.fuelDeductionAmount ?? 0); const net = Number(trip.netSettlementAmount ?? gross - fuel); return <tr key={trip.id}><td className="text-center">{index + 1}</td><td>{formatDateTime(trip.startAt)}</td><td>{trip.vehiclePlateNo}</td><td>{trip.tripNo}</td><td>{trip.loadLocation.name} → {trip.unloadLocation.name}</td><td className="text-right">{Number(trip.volumeCubicMeters ?? 0).toFixed(2)}</td><td className="text-right">{trip.actualDistanceKm ?? "—"} km</td><td className="text-right">{formatMoney(trip.calculatedUnitPrice)}</td><td className="text-right">{formatMoney(gross)}</td><td className="text-right">{formatMoney(fuel)}</td><td className="text-right">{formatMoney(net)}</td><td className="text-center">{tripStatusLabel(trip.status)}</td></tr>; })}
          {!trips.length && !tripsQuery.isLoading ? <tr><td colSpan={12} className="py-8 text-center text-[#765544]">当前筛选条件下暂无可打印运费记录。</td></tr> : null}
          {trips.length ? <tr className="bg-[#f3e7d7] font-bold"><td colSpan={5}>合计：运单趟数 {trips.length} 趟，去重车辆数 {totals.vehicleIds.size} 辆</td><td className="text-right">{totals.volume.toFixed(2)}</td><td>—</td><td>—</td><td className="text-right">{formatMoney(totals.gross)}</td><td className="text-right">{formatMoney(totals.fuel)}</td><td className="text-right">{formatMoney(totals.net)}</td><td>—</td></tr> : null}
        </tbody></table>
        <footer className="mt-4 grid grid-cols-2 gap-8 text-[10px]"><span>制表人：________________</span><span>审核人：________________</span></footer>
      </section>
      <DialogFooter className="freight-print-hidden"><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" disabled={!canPrint || Boolean(dateFrom && dateTo && dateFrom > dateTo)} onClick={printFreightStatement}><FileDown className="mr-1 h-4 w-4" />打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
