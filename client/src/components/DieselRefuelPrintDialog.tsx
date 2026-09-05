import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_SCROLL_CLASS,
} from "@/components/PrintPreviewDialogLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";
import { summarizeDieselLedgerRecords } from "@/lib/dieselLedgerSummary";
import { Printer } from "lucide-react";

export type DieselPrintRecord = {
  id: number;
  recordNo: string;
  assetName: string;
  assetType: "vehicle" | "machine";
  supplyMethod: "project_supply" | "external_station";
  stationOrSupplierName: string | null;
  liters: number | string;
  appliedUnitPrice: number | string;
  amount: number | string;
  meterReading: string | number | null;
  deductFromFreight: boolean;
  refueledAt: Date | string;
  status: string;
};

type PrintMode = "current" | "daily" | "vehicle" | "machine";
const money = (value: number | string) => `¥${Number(value || 0).toFixed(2)}`;
const dateTime = (value: Date | string) => formatChinaDateTime(value);
const statusLabel = (status: string) => ({ draft: "草稿", approved: "已记账", settled: "已结算", void: "已作废" } as Record<string, string>)[status] ?? "待处理";
/** 柴油明细列较多，预览在大屏上按业务工作区尺寸展示，避免缩为居中的小纸张。 */
const DIESEL_PRINT_PREVIEW_DIALOG_CONTENT_CLASS = [
  "w-[calc(100vw-3rem)]",
  "max-w-[1680px]",
  "sm:max-w-[1680px]",
  "h-[min(82vh,820px)]",
  "max-h-[calc(100vh-4rem)]",
  "lg:left-[calc(50%+5rem)]",
  "grid-rows-[auto_minmax(0,1fr)_auto]",
  "gap-0",
  "overflow-hidden",
  "p-0",
].join(" ");

/** 后台柴油打印只接收已由服务端项目范围过滤后的真实记录，打印逻辑不再读取页面 DOM。 */
export default function DieselRefuelPrintDialog({ open, onOpenChange, mode, projectName, dateLabel, records }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PrintMode;
  projectName: string;
  dateLabel: string;
  records: DieselPrintRecord[];
}) {
  const modeTitle = mode === "daily" ? "柴油当日加油明细及汇总表" : mode === "vehicle" ? "车辆加油统计明细表" : mode === "machine" ? "机械加油明细及汇总表" : "柴油加油明细及汇总表";
  const summary = summarizeDieselLedgerRecords(records);
  const totalLiters = summary.totalLiters;
  const totalAmount = summary.totalAmount;
  const uniqueAssets = new Set(records.map(item => item.assetName)).size;
  const print = () => {
    const rows = records.map((item, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(dateTime(item.refueledAt))}</td><td>${escapePrintHtml(item.assetName)}</td><td>${item.assetType === "vehicle" ? "车辆" : "机械"}</td><td>${item.supplyMethod === "project_supply" ? "项目部供油" : escapePrintHtml(item.stationOrSupplierName || "加油站")}</td><td class="right">${Number(item.liters).toFixed(2)}</td><td class="right">${money(item.appliedUnitPrice)}</td><td class="right">${money(item.amount)}</td><td>${escapePrintHtml(item.meterReading ?? "未记录")}</td><td>${item.deductFromFreight ? "扣运费" : "不扣"}</td><td>${escapePrintHtml(statusLabel(item.status))}</td></tr>`).join("");
    openA4LandscapePrintDocument({ title: modeTitle, bodyHtml: `<h1>${modeTitle}</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　统计条件：${escapePrintHtml(dateLabel)}　|　生成时间：${escapePrintHtml(dateTime(new Date()))}</p><hr class="rule"/><table><thead><tr><th style="width:4%">序号</th><th style="width:12%">加油时间</th><th style="width:13%">车辆 / 机械</th><th style="width:6%">类型</th><th style="width:13%">供油点 / 方式</th><th style="width:8%">油量(L)</th><th style="width:9%">单价</th><th style="width:9%">金额</th><th style="width:10%">加油机表数</th><th style="width:8%">运输扣油</th><th style="width:8%">状态</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="center">当前筛选范围暂无柴油记录</td></tr>'}<tr class="summary"><td colspan="5">合计：有效记录 ${summary.effectiveRecordCount} 笔 / 当前筛选 ${summary.displayedRecordCount} 笔，车辆/机械 ${uniqueAssets} 个</td><td class="right">${totalLiters.toFixed(2)}</td><td>—</td><td class="right">${money(totalAmount)}</td><td colspan="3">作废记录不计入汇总</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={DIESEL_PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
      <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
        <DialogHeader>
          <DialogTitle>{modeTitle}</DialogTitle>
          <DialogDescription>预览与保存均使用当前真实筛选记录；作废记录仅展示追溯，不计入汇总。点击后直接打开系统打印窗口，不依赖浏览器弹窗。</DialogDescription>
        </DialogHeader>
      </div>
      <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
        <div className="min-w-[1180px] rounded-xl border border-slate-200 bg-white p-5 text-sm text-[#15110e]">
          <div className="mb-4 text-center"><p className="text-xl font-bold">{modeTitle}</p><p className="mt-1 text-sm text-slate-600">{projectName} · {dateLabel}</p></div>
          <div className={PRINT_PREVIEW_TABLE_SCROLL_CLASS}>
            <table className="min-w-[1320px] w-full border-collapse">
              <thead><tr className="bg-slate-100"><th>时间</th><th>对象</th><th>类型</th><th>供油方式</th><th>油量</th><th>单价</th><th>金额</th><th>表数</th><th>扣油</th></tr></thead>
              <tbody>
                {records.map(item => <tr key={item.id} className="border-t"><td>{dateTime(item.refueledAt)}</td><td>{item.assetName}</td><td>{item.assetType === "vehicle" ? "车辆" : "机械"}</td><td>{item.supplyMethod === "project_supply" ? "项目部供油" : item.stationOrSupplierName || "加油站"}</td><td>{Number(item.liters).toFixed(2)} L</td><td>{money(item.appliedUnitPrice)}</td><td>{money(item.amount)}</td><td>{item.meterReading ?? "未记录"}</td><td>{item.deductFromFreight ? "扣运费" : "不扣"}</td></tr>)}
                <tr className="border-t bg-amber-50 font-semibold"><td colSpan={4}>合计：有效 {summary.effectiveRecordCount} 笔 / 当前 {summary.displayedRecordCount} 笔 / {uniqueAssets} 个对象</td><td>{totalLiters.toFixed(2)} L</td><td>—</td><td>{money(totalAmount)}</td><td colSpan={2}>作废不计入汇总</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <DialogFooter className={PRINT_PREVIEW_DIALOG_FOOTER_CLASS}>
        <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        <Button onClick={print}><Printer className="mr-2 h-4 w-4" />打印 / 保存 PDF</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
