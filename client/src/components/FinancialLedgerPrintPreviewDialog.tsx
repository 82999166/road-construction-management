import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_SCROLL_CLASS,
} from "@/components/PrintPreviewDialogLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";
import { Printer } from "lucide-react";

export type FinancialPrintColumn = { label: string; width?: string };
export type FinancialPrintRow = { id: string | number; cells: Array<string | number> };

/**
 * 财务账本打印只接收父页面已完成权限控制及当前筛选后的真实数据投影。
 * 本组件不请求、不缓存、不重算账务数据；它仅统一屏幕预览和独立 A4 横向文档的展示。
 */
export function FinancialLedgerPrintPreviewDialog({
  open,
  onOpenChange,
  title,
  projectName,
  period,
  filterLabel,
  columns,
  rows,
  summaryLabel,
  emptyText = "当前筛选范围暂无可打印账本记录。",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  projectName: string;
  period: string;
  filterLabel: string;
  columns: FinancialPrintColumn[];
  rows: FinancialPrintRow[];
  summaryLabel: string;
  emptyText?: string;
}) {
  const print = () => {
    if (!rows.length) return;
    const header = columns.map(column => `<th${column.width ? ` style="width:${escapePrintHtml(column.width)}"` : ""}>${escapePrintHtml(column.label)}</th>`).join("");
    const body = rows.map((row, index) => `<tr>${row.cells.map((cell, cellIndex) => `<td${cellIndex === 0 ? "" : " class=\"right\""}>${escapePrintHtml(cell)}</td>`).join("")}</tr>`).join("");
    openA4LandscapePrintDocument({
      title,
      bodyHtml: `<h1>${escapePrintHtml(title)}</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　会计期间：${escapePrintHtml(period)}　|　筛选：${escapePrintHtml(filterLabel)}</p><p class="sub">生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr>${header}</tr></thead><tbody>${body}<tr class="summary"><td colspan="${columns.length}">${escapePrintHtml(summaryLabel)}</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>复核人：________________</span></div>`,
    });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
      <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>预览仅展示当前页面已生效筛选和已授权项目范围内的真实账本记录；末行汇总与页面口径一致。</DialogDescription>
        </DialogHeader>
      </div>
      <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
        <section className="bg-white p-4 text-[#17120f]">
          <header className="border-b-2 border-[#29483e] pb-3 text-center">
            <h1 className="text-xl font-bold">{title}</h1>
            <p className="mt-1 text-xs">项目：{projectName}　|　会计期间：{period}</p>
            <p className="mt-1 text-[11px] text-slate-600">筛选：{filterLabel}　|　生成时间：{formatChinaDateTime(new Date())}</p>
          </header>
          <div className={`${PRINT_PREVIEW_TABLE_SCROLL_CLASS} mt-4`}>
            <table className="min-w-[1180px] w-full table-fixed border-collapse text-xs print:min-w-0">
              <thead className="bg-[#e8f1ed]"><tr>{columns.map(column => <th key={column.label} className="border-b border-slate-200 px-3 py-2 text-left font-semibold" style={column.width ? { width: column.width } : undefined}>{column.label}</th>)}</tr></thead>
              <tbody>{rows.length ? <>{rows.map(row => <tr key={row.id} className="border-b border-slate-100 align-top">{row.cells.map((cell, cellIndex) => <td key={`${row.id}-${cellIndex}`} className={cellIndex ? "px-3 py-2 text-right" : "px-3 py-2"}>{cell}</td>)}</tr>)}<tr className="bg-[#eff7f2] font-semibold"><td colSpan={columns.length} className="px-3 py-3">{summaryLabel}</td></tr></> : <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-slate-500">{emptyText}</td></tr>}</tbody>
            </table>
          </div>
          <footer className="mt-4 grid grid-cols-2 gap-8 text-[11px]"><span>制表人：________________</span><span>复核人：________________</span></footer>
        </section>
      </div>
      <DialogFooter className={PRINT_PREVIEW_DIALOG_FOOTER_CLASS}>
        <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        <Button disabled={!rows.length} className="bg-[#29483e] hover:bg-[#203c48]" onClick={print}><Printer className="mr-1.5 h-4 w-4" />打印 / 保存 PDF</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
