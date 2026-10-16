import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_FIT_CLASS,
  PRINT_PREVIEW_TABLE_FRAME_CLASS,
} from "@/components/PrintPreviewDialogLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime, toChinaDateInput } from "@/lib/businessTime";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";

const money = (value: unknown) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => toChinaDateInput();
const statusLabel: Record<string, string> = { approved: "已记账", settled: "已结算", void: "已作废" };
/** 仅显示已知中文业务状态，未知内部值统一降级为待处理。 */
const statusDisplay = (status: string | null | undefined) => statusLabel[status ?? ""] ?? "待处理";

/** 柴油汇总打印只读取服务端按项目范围过滤后的真实记录，并以浏览器系统打印保存 PDF。 */
export function DieselSummaryPrintDialog({ open, onOpenChange, projectId, projectName }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: number; projectName: string }) {
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [assetType, setAssetType] = useState<"all" | "vehicle" | "machine">("all");
  const [supplyMethod, setSupplyMethod] = useState<"all" | "project_supply" | "external_station">("all");
  const [status, setStatus] = useState<"all" | "approved" | "settled" | "void">("all");
  const input = useMemo(() => ({ projectId, dateFrom, dateTo, assetType, supplyMethod, status }), [assetType, dateFrom, dateTo, projectId, status, supplyMethod]);
  const query = trpc.diesel.printSummary.useQuery(input, { enabled: open && Boolean(projectId), retry: false });
  const filterText = `期间：${dateFrom} 至 ${dateTo}　|　资源：${assetType === "all" ? "全部" : assetType === "vehicle" ? "车辆" : "机械"}　|　供油：${supplyMethod === "all" ? "全部" : supplyMethod === "project_supply" ? "项目部供油" : "加油站加油"}　|　状态：${status === "all" ? "全部（不含作废）" : statusLabel[status]}`;
  function printSummary() {
    const result = query.data;
    if (!result?.records.length) return;
    const rows = result.records.map((record, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(formatChinaDateTime(record.refueledAt))}</td><td>${escapePrintHtml(record.recordNo)}</td><td>${escapePrintHtml(record.assetLabel)}</td><td>${record.supplyMethod === "project_supply" ? "项目部供油" : "加油站加油"}</td><td>${escapePrintHtml(record.stationOrSupplierName || "—")}</td><td class="right">${record.liters.toFixed(3)} L</td><td class="right">${escapePrintHtml(money(record.appliedUnitPrice))}</td><td class="right">${escapePrintHtml(money(record.amount))}</td><td class="right">${record.meterReading === null ? "未记录" : record.meterReading}</td><td class="center">${record.deductFromFreight ? "是" : "否"}</td><td class="center">${escapePrintHtml(statusDisplay(record.status))}</td></tr>`).join("");
    try {
      openA4LandscapePrintDocument({ title: "柴油领用汇总表", bodyHtml: `<h1>柴油领用汇总表</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　${escapePrintHtml(filterText)}</p><p class="sub">生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr><th style="width:3%">序号</th><th style="width:11%">加油时间</th><th style="width:10%">单据号</th><th style="width:9%">资源</th><th style="width:9%">供油方式</th><th style="width:12%">加油站/供应商</th><th style="width:7%">油量</th><th style="width:8%">单价</th><th style="width:9%">金额</th><th style="width:8%">表数</th><th style="width:8%">运费扣油</th><th style="width:6%">状态</th></tr></thead><tbody>${rows}<tr class="summary"><td colspan="6">合计：记录 ${result.summary.recordCount} 笔，车辆 ${result.summary.vehicleCount} 台，机械 ${result.summary.machineCount} 台</td><td class="right">${result.summary.liters.toFixed(3)} L</td><td>—</td><td class="right">${escapePrintHtml(money(result.summary.amount))}</td><td>—</td><td class="right">${escapePrintHtml(money(result.summary.deductibleAmount))}</td><td>—</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
    } catch (error) { alert(getUserFacingErrorMessage(error, "无法打开柴油汇总打印页，请稍后重试")); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
      <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
        <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } body * { visibility: hidden !important; } #diesel-summary-print, #diesel-summary-print * { visibility: visible !important; } #diesel-summary-print { position:absolute; inset:0; width:100%; color:#111 !important; background:#fff !important; } .diesel-print-hidden { display:none !important; } .diesel-summary-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; } .diesel-summary-table th,.diesel-summary-table td { border:1px solid #222; padding:4px; vertical-align:middle; word-break:break-word; } .diesel-summary-table thead { display:table-header-group; } .diesel-summary-table tr { break-inside:avoid; } }`}</style>
        <div className="diesel-print-hidden"><DialogHeader><DialogTitle>柴油汇总 PDF</DialogTitle><DialogDescription>按项目、日期、资源、供油方式和状态筛选真实柴油台账；系统打印窗口可直接“另存为 PDF”。</DialogDescription></DialogHeader></div>
      </div>
      <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
        <div className="diesel-print-hidden grid gap-3 sm:grid-cols-5"><div><Label>开始日期</Label><Input className="mt-1" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></div><div><Label>结束日期</Label><Input className="mt-1" type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></div><div><Label>资源</Label><Select value={assetType} onValueChange={value => setAssetType(value as typeof assetType)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部资源</SelectItem><SelectItem value="vehicle">车辆</SelectItem><SelectItem value="machine">机械</SelectItem></SelectContent></Select></div><div><Label>供油方式</Label><Select value={supplyMethod} onValueChange={value => setSupplyMethod(value as typeof supplyMethod)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部供油</SelectItem><SelectItem value="project_supply">项目部供油</SelectItem><SelectItem value="external_station">加油站加油</SelectItem></SelectContent></Select></div><div><Label>状态</Label><Select value={status} onValueChange={value => setStatus(value as typeof status)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部（不含作废）</SelectItem><SelectItem value="approved">已记账</SelectItem><SelectItem value="settled">已结算</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select></div></div>
        <section id="diesel-summary-print" className="mt-4 min-w-0 bg-white p-3 text-[#15110e] print:mt-0 print:p-0"><header className="border-b-2 border-[#6d3421] pb-3 text-center"><h1 className="text-xl font-bold">柴油领用汇总表</h1><p className="mt-1 text-xs">项目：{projectName}　|　{filterText}</p><p className="mt-1 text-xs">生成时间：{formatChinaDateTime(new Date())}</p></header><div className={PRINT_PREVIEW_TABLE_FRAME_CLASS}><table className={`diesel-summary-table ${PRINT_PREVIEW_TABLE_FIT_CLASS} text-[10px]`}><thead className="bg-[#f3e4d4]"><tr><th className="w-[3%]">序号</th><th className="w-[11%]">加油时间</th><th className="w-[10%]">单据号</th><th className="w-[9%]">资源</th><th className="w-[9%]">供油方式</th><th className="w-[12%]">加油站/供应商</th><th className="w-[7%]">油量</th><th className="w-[8%]">单价</th><th className="w-[9%]">金额</th><th className="w-[8%]">表数</th><th className="w-[8%]">运费扣油</th><th className="w-[6%]">状态</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={12} className="py-8 text-center">正在读取真实柴油台账…</td></tr> : query.data?.records.length ? <>{query.data.records.map((record, index) => <tr key={record.id}><td className="text-center">{index + 1}</td><td>{formatChinaDateTime(record.refueledAt)}</td><td>{record.recordNo}</td><td>{record.assetLabel}</td><td>{record.supplyMethod === "project_supply" ? "项目部供油" : "加油站加油"}</td><td>{record.stationOrSupplierName || "—"}</td><td className="text-right">{record.liters.toFixed(3)} L</td><td className="text-right">{money(record.appliedUnitPrice)}</td><td className="text-right">{money(record.amount)}</td><td className="text-right">{record.meterReading === null ? "未记录" : record.meterReading}</td><td className="text-center">{record.deductFromFreight ? "是" : "否"}</td><td className="text-center">{statusDisplay(record.status)}</td></tr>)}<tr className="bg-[#f3e4d4] font-bold"><td colSpan={6}>合计：记录 {query.data.summary.recordCount} 笔，车辆 {query.data.summary.vehicleCount} 台，机械 {query.data.summary.machineCount} 台</td><td className="text-right">{query.data.summary.liters.toFixed(3)} L</td><td>—</td><td className="text-right">{money(query.data.summary.amount)}</td><td>—</td><td className="text-right">{money(query.data.summary.deductibleAmount)}</td><td>—</td></tr></> : <tr><td colSpan={12} className="py-8 text-center">当前筛选暂无柴油记录。</td></tr>}</tbody></table></div><footer className="mt-4 grid grid-cols-2 gap-8 text-[10px]"><span>制表人：________________</span><span>审核人：________________</span></footer></section>
      </div>
      <DialogFooter className={`${PRINT_PREVIEW_DIALOG_FOOTER_CLASS} diesel-print-hidden`}><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={!query.data?.records.length} className="bg-[#6d3421] hover:bg-[#512316]" onClick={printSummary}><Printer className="mr-1.5 h-4 w-4" />打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
