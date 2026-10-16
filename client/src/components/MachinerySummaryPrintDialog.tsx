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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";

const money = (value: unknown) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const costTypeLabel: Record<string, string> = { fuel: "油料", repair: "维修", overtime: "加班", mobilization: "进退场", other: "其他" };
const statusLabel: Record<string, string> = { draft: "待审核", approved: "已审核", settled: "已结算", void: "已作废" };
const getCostTypeLabel = (costType: string) => costTypeLabel[costType] ?? (/[\u0000-\u007f]/.test(costType) ? "其他费用" : costType);

/** 按当前授权项目与自然月输出机械成本明细；浏览器系统打印负责保存 A4 横向 PDF。 */
export function MachinerySummaryPrintDialog({ open, onOpenChange, projectId, projectName, period }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: number; projectName: string; period: string }) {
  const [machineId, setMachineId] = useState("all");
  const [status, setStatus] = useState<"all" | "draft" | "approved" | "settled" | "void">("all");
  const machines = trpc.machinery.listMachines.useQuery({ projectId }, { enabled: open && Boolean(projectId), retry: false });
  const input = useMemo(() => ({ projectId, period, machineId: machineId === "all" ? null : Number(machineId), status }), [machineId, period, projectId, status]);
  const query = trpc.machinery.printSummary.useQuery(input, { enabled: open && Boolean(projectId) && /^\d{4}-(0[1-9]|1[0-2])$/.test(period), retry: false });
  const machineText = machineId === "all" ? "全部机械" : machines.data?.find(machine => String(machine.id) === machineId)?.name ?? "已选机械";
  function printSummary() {
    const result = query.data;
    if (!result?.records.length) return;
    const rows = result.records.map((record, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(formatChinaDateTime(record.occurredAt))}</td><td>${escapePrintHtml(record.machineLabel)}</td><td>${escapePrintHtml(record.costName || "未命名费用")}<br><small>类别：${escapePrintHtml(getCostTypeLabel(record.costType))}</small></td><td class="right">${record.quantity.toFixed(3)}</td><td class="right">${escapePrintHtml(money(record.unitPrice))}</td><td class="right">${escapePrintHtml(money(record.amount))}</td><td class="center">${escapePrintHtml(statusLabel[record.status] ?? getBusinessStatusLabel(record.status))}</td><td>${escapePrintHtml(record.remarks || "—")}</td></tr>`).join("");
    try { openA4LandscapePrintDocument({ title: "机械成本汇总表", bodyHtml: `<h1>机械成本汇总表</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　期间：${escapePrintHtml(period)}　|　机械：${escapePrintHtml(machineText)}　|　状态：${escapePrintHtml(status === "all" ? "全部（不含作废）" : statusLabel[status])}</p><p class="sub">生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr><th style="width:4%">序号</th><th style="width:12%">发生时间</th><th style="width:14%">机械</th><th style="width:10%">费用名称 / 类别</th><th style="width:10%">数量</th><th style="width:10%">单价</th><th style="width:11%">金额</th><th style="width:10%">状态</th><th style="width:19%">说明</th></tr></thead><tbody>${rows}<tr class="summary"><td colspan="4">合计：记录 ${result.summary.recordCount} 笔，机械 ${result.summary.machineCount} 台</td><td class="right">${result.summary.quantity.toFixed(3)}</td><td>—</td><td class="right">${escapePrintHtml(money(result.summary.amount))}</td><td colspan="2">—</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` }); } catch (error) { alert(getUserFacingErrorMessage(error, "无法打开机械成本打印页，请稍后重试")); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
      <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
        <style>{`@media print { @page { size:A4 landscape; margin:8mm; } body * { visibility:hidden !important; } #machinery-summary-print,#machinery-summary-print * { visibility:visible !important; } #machinery-summary-print { position:absolute; inset:0; width:100%; color:#111 !important; background:#fff !important; } .machinery-print-hidden { display:none !important; } .machinery-summary-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; } .machinery-summary-table th,.machinery-summary-table td { border:1px solid #222; padding:4px; vertical-align:middle; word-break:break-word; } .machinery-summary-table thead { display:table-header-group; } .machinery-summary-table tr { break-inside:avoid; } }`}</style>
        <div className="machinery-print-hidden"><DialogHeader><DialogTitle>机械汇总 PDF</DialogTitle><DialogDescription>按当前项目、自然月、机械和状态筛选真实成本台账，点击后在系统打印窗口“另存为 PDF”。</DialogDescription></DialogHeader></div>
      </div>
      <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
        <div className="machinery-print-hidden grid gap-3 sm:grid-cols-3"><div><Label>机械</Label><Select value={machineId} onValueChange={setMachineId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部机械</SelectItem>{machines.data?.map(machine => <SelectItem key={machine.id} value={String(machine.id)}>{machine.name} · {machine.code}</SelectItem>)}</SelectContent></Select></div><div><Label>期间</Label><div className="mt-1 h-10 rounded-md border border-input bg-muted px-3 py-2 text-sm">{period}</div></div><div><Label>状态</Label><Select value={status} onValueChange={value => setStatus(value as typeof status)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部（不含作废）</SelectItem><SelectItem value="draft">待审核</SelectItem><SelectItem value="approved">已审核</SelectItem><SelectItem value="settled">已结算</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select></div></div>
        <section id="machinery-summary-print" className="mt-4 min-w-0 bg-white p-3 text-[#15110e] print:mt-0 print:p-0"><header className="border-b-2 border-[#7a4728] pb-3 text-center"><h1 className="text-xl font-bold">机械成本汇总表</h1><p className="mt-1 text-xs">项目：{projectName}　|　期间：{period}　|　机械：{machineText}　|　状态：{status === "all" ? "全部（不含作废）" : statusLabel[status]}</p><p className="mt-1 text-xs">生成时间：{formatChinaDateTime(new Date())}</p></header><div className={PRINT_PREVIEW_TABLE_FRAME_CLASS}><table className={`machinery-summary-table ${PRINT_PREVIEW_TABLE_FIT_CLASS} text-[10px]`}><thead className="bg-[#f0dfc7]"><tr><th className="w-[4%]">序号</th><th className="w-[12%]">发生时间</th><th className="w-[14%]">机械</th><th className="w-[10%]">费用名称 / 类别</th><th className="w-[10%]">数量</th><th className="w-[10%]">单价</th><th className="w-[11%]">金额</th><th className="w-[10%]">状态</th><th className="w-[19%]">说明</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={9} className="py-8 text-center">正在读取真实机械成本台账…</td></tr> : query.data?.records.length ? <>{query.data.records.map((record, index) => <tr key={record.id}><td className="text-center">{index + 1}</td><td>{formatChinaDateTime(record.occurredAt)}</td><td>{record.machineLabel}</td><td><p className="font-medium">{record.costName || "未命名费用"}</p><p className="mt-0.5 text-[10px] text-slate-500">类别：{getCostTypeLabel(record.costType)}</p></td><td className="text-right">{record.quantity.toFixed(3)}</td><td className="text-right">{money(record.unitPrice)}</td><td className="text-right">{money(record.amount)}</td><td className="text-center">{statusLabel[record.status] ?? getBusinessStatusLabel(record.status)}</td><td>{record.remarks || "—"}</td></tr>)}<tr className="bg-[#f0dfc7] font-bold"><td colSpan={4}>合计：记录 {query.data.summary.recordCount} 笔，机械 {query.data.summary.machineCount} 台</td><td className="text-right">{query.data.summary.quantity.toFixed(3)}</td><td>—</td><td className="text-right">{money(query.data.summary.amount)}</td><td colSpan={2}>—</td></tr></> : <tr><td colSpan={9} className="py-8 text-center">当前筛选暂无机械成本记录。</td></tr>}</tbody></table></div><footer className="mt-4 grid grid-cols-2 gap-8 text-[10px]"><span>制表人：________________</span><span>审核人：________________</span></footer></section>
      </div>
      <DialogFooter className={`${PRINT_PREVIEW_DIALOG_FOOTER_CLASS} machinery-print-hidden`}><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={!query.data?.records.length} className="bg-[#7a4728] hover:bg-[#623618]" onClick={printSummary}><Printer className="mr-1.5 h-4 w-4" />打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
