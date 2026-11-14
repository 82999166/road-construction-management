import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_FIT_CLASS,
  PRINT_PREVIEW_TABLE_FRAME_CLASS,
} from "@/components/PrintPreviewDialogLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS, printColumnGroup } from "@/lib/reportPrintLayout";
import { formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import { FileDown, LoaderCircle } from "lucide-react";
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
  return `¥${formatAmount(value)}`;
}

function formatDateTime(value: Date | string | null | undefined) {
  return formatChinaDateTime(value);
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
  const queryInput = useMemo(() => ({ projectId, dateFrom, dateTo, ...(vehicleId !== "all" ? { vehicleId: Number(vehicleId) } : {}) }), [dateFrom, dateTo, projectId, vehicleId]);
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
    const selectedPlate = vehicleId === "all" ? "全部车辆" : vehicles.find(item => String(item.id) === vehicleId)?.plateNo ?? "已选车辆";
    const rows = trips.map((trip, index) => {
      const gross = Number(trip.calculatedAmount ?? 0);
      const fuel = Number(trip.fuelDeductionAmount ?? 0);
      const net = Number(trip.netSettlementAmount ?? gross - fuel);
      return `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(formatDateTime(trip.startAt))}</td><td>${escapePrintHtml(trip.vehiclePlateNo)}</td><td>${escapePrintHtml(trip.tripNo)}</td><td>${escapePrintHtml(`${trip.loadLocation.name} → ${trip.unloadLocation.name}`)}</td><td class="right">${formatQuantity(trip.volumeCubicMeters)}</td><td class="right">${escapePrintHtml(trip.actualDistanceKm == null ? "—" : formatQuantity(trip.actualDistanceKm))} km</td><td class="right">${escapePrintHtml(formatMoney(trip.calculatedUnitPrice))}</td><td class="right">${escapePrintHtml(formatMoney(gross))}</td><td class="right">${escapePrintHtml(formatMoney(fuel))}</td><td class="right">${escapePrintHtml(formatMoney(net))}</td><td class="center">${escapePrintHtml(tripStatusLabel(trip.status))}</td></tr>`;
    }).join("");
    try {
      openA4LandscapePrintDocument({
        title: "运输运费明细表",
        bodyHtml: `<h1>运输运费明细表</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　车牌：${escapePrintHtml(selectedPlate)}　|　期间：${escapePrintHtml(dateFrom)} 至 ${escapePrintHtml(dateTo)}</p><p class="sub">生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}　|　数据范围：当前账号已授权项目与车辆</p><hr class="rule"><table>${printColumnGroup(TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS)}<thead><tr><th>序号</th><th>业务时间</th><th>车牌</th><th>运单号</th><th>运输路线</th><th>方量</th><th>里程</th><th>运价</th><th>应付运费</th><th>柴油扣款</th><th>净额</th><th>状态</th></tr></thead><tbody>${rows}<tr class="summary"><td colspan="5">合计：运单趟数 ${trips.length} 趟，去重车辆数 ${totals.vehicleIds.size} 辆</td><td class="right">${formatQuantity(totals.volume)}</td><td>—</td><td>—</td><td class="right">${escapePrintHtml(formatMoney(totals.gross))}</td><td class="right">${escapePrintHtml(formatMoney(totals.fuel))}</td><td class="right">${escapePrintHtml(formatMoney(totals.net))}</td><td>—</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>`,
      });
    } catch (error) { alert(getUserFacingErrorMessage(error, "无法打开运费明细打印页，请稍后重试")); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
      <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
        <style>{`.freight-preview-table { width: 100%; table-layout: fixed; border-collapse: collapse; } .freight-preview-table th, .freight-preview-table td { overflow-wrap: anywhere; } @media print { @page { size: A4 landscape; margin: 8mm; } body * { visibility: hidden !important; } #transport-freight-print-sheet, #transport-freight-print-sheet * { visibility: visible !important; } #transport-freight-print-sheet { position: absolute; inset: 0; width: 100%; color: #111 !important; background: #fff !important; } .freight-print-hidden { display: none !important; } .freight-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; } .freight-print-table th, .freight-print-table td { border: 1px solid #222; padding: 4px; vertical-align: middle; word-break: break-word; } .freight-print-table thead { display: table-header-group; } .freight-print-table tr { break-inside: avoid; } }`}</style>
        <div className="freight-print-hidden"><DialogHeader><DialogTitle>运输运费明细打印</DialogTitle></DialogHeader><p className="mt-1 text-xs leading-5 text-[#765544]">按车牌与日期查询真实运单。默认不含作废单；点击“打印 / 保存 PDF”后请在系统打印窗口选择“另存为 PDF”。</p></div>
      </div>
      <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
        <div className="freight-print-hidden grid gap-3 sm:grid-cols-4"><div><Label>车牌号</Label><Select value={vehicleId} onValueChange={setVehicleId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆</SelectItem>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select></div><div><Label>开始日期</Label><Input className="mt-1" type="date" value={dateFrom} max={dateTo || undefined} onChange={event => setDateFrom(event.target.value)} /></div><div><Label>结束日期</Label><Input className="mt-1" type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)} /></div><label className="mt-6 flex h-10 items-center gap-2 rounded-md border border-[#ead9c8] bg-[#fffaf5] px-3 text-sm text-[#5d3828]"><input type="checkbox" checked={includeVoid} onChange={event => setIncludeVoid(event.target.checked)} />包含作废单</label></div>
        {dateFrom && dateTo && dateFrom > dateTo ? <p className="mt-3 text-sm text-[#a74328]">结束日期不能早于开始日期。</p> : null}
        {tripsQuery.isLoading ? <p className="mt-4 flex items-center gap-2 text-sm text-[#765544]"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取真实运输运单…</p> : null}
        {tripsQuery.error ? <p className="mt-4 rounded-lg bg-[#fff2eb] p-3 text-sm text-[#a74328]">运费明细读取失败：{getUserFacingErrorMessage(tripsQuery.error, "暂无法读取运费明细，请稍后重试")}</p> : null}
        <section id="transport-freight-print-sheet" className="mt-5 min-w-0 bg-white p-5 text-[#1f1712] print:mt-0 print:p-0"><header className="border-b-2 border-[#3a2117] pb-3 text-center"><h1 className="text-xl font-bold">运输运费明细表</h1><p className="mt-1 text-sm">项目：{projectName}　|　车牌：{vehicleId === "all" ? "全部车辆" : vehicles.find(item => String(item.id) === vehicleId)?.plateNo ?? "已选车辆"}　|　期间：{dateFrom || "—"} 至 {dateTo || "—"}</p><p className="mt-1 text-xs text-[#5e5147]">生成时间：{formatChinaDateTime(new Date())}　|　数据范围：当前账号已授权项目与车辆</p></header><div className={PRINT_PREVIEW_TABLE_FRAME_CLASS}><table className={`freight-preview-table freight-print-table ${PRINT_PREVIEW_TABLE_FIT_CLASS} text-[11px] print:text-[10px]`}><colgroup>{TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="bg-[#eee2d2]"><tr><th>序号</th><th>业务时间</th><th>车牌</th><th>运单号</th><th>运输路线</th><th>方量</th><th>里程</th><th>运价</th><th>应付运费</th><th>柴油扣款</th><th>净额</th><th>状态</th></tr></thead><tbody>{trips.map((trip, index) => { const gross = Number(trip.calculatedAmount ?? 0); const fuel = Number(trip.fuelDeductionAmount ?? 0); const net = Number(trip.netSettlementAmount ?? gross - fuel); return <tr key={trip.id}><td className="text-center">{index + 1}</td><td>{formatDateTime(trip.startAt)}</td><td>{trip.vehiclePlateNo}</td><td>{trip.tripNo}</td><td>{trip.loadLocation.name} → {trip.unloadLocation.name}</td><td className="text-right">{formatQuantity(trip.volumeCubicMeters)}</td><td className="text-right">{trip.actualDistanceKm ?? "—"} km</td><td className="text-right">{formatMoney(trip.calculatedUnitPrice)}</td><td className="text-right">{formatMoney(gross)}</td><td className="text-right">{formatMoney(fuel)}</td><td className="text-right">{formatMoney(net)}</td><td className="text-center">{tripStatusLabel(trip.status)}</td></tr>; })}{!trips.length && !tripsQuery.isLoading ? <tr><td colSpan={12} className="py-8 text-center text-[#765544]">当前筛选条件下暂无可打印运费记录。</td></tr> : null}{trips.length ? <tr className="bg-[#f3e7d7] font-bold"><td colSpan={5}>合计：运单趟数 {trips.length} 趟，去重车辆数 {totals.vehicleIds.size} 辆</td><td className="text-right">{formatQuantity(totals.volume)}</td><td>—</td><td>—</td><td className="text-right">{formatMoney(totals.gross)}</td><td className="text-right">{formatMoney(totals.fuel)}</td><td className="text-right">{formatMoney(totals.net)}</td><td>—</td></tr> : null}</tbody></table></div><footer className="mt-4 grid grid-cols-2 gap-8 text-xs"><span>制表人：________________</span><span>审核人：________________</span></footer></section>
      </div>
      <DialogFooter className={`${PRINT_PREVIEW_DIALOG_FOOTER_CLASS} freight-print-hidden`}><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" disabled={!canPrint || Boolean(dateFrom && dateTo && dateFrom > dateTo)} onClick={printFreightStatement}><FileDown className="mr-1 h-4 w-4" />打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
