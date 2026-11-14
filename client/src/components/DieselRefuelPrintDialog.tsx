import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_FIT_CLASS,
  PRINT_PREVIEW_TABLE_FRAME_CLASS,
} from "@/components/PrintPreviewDialogLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import {
  DIESEL_REFUEL_COLUMN_WIDTHS,
  printColumnGroup,
} from "@/lib/reportPrintLayout";
import { formatChinaDateTime } from "@/lib/businessTime";
import { summarizeDieselLedgerRecords } from "@/lib/dieselLedgerSummary";
import { getDieselRecordSourceLabel } from "@/lib/dieselLedgerSource";
import { Printer } from "lucide-react";

export type DieselPrintRecord = {
  id: number;
  recordNo: string;
  assetName: string;
  assetType: "vehicle" | "machine";
  supplyMethod: "project_supply" | "external_station";
  stationOrSupplierName: string | null;
  /** 加油记录的真实登记人姓名；历史账号缺失时安全回退为“未登记”。 */
  refuelerName: string | null;
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
const refuelerName = (value: string | null | undefined) =>
  value?.trim() || "未登记";
const statusLabel = (status: string) =>
  (
    ({
      draft: "草稿",
      approved: "已记账",
      settled: "已结算",
      void: "已作废",
    }) as Record<string, string>
  )[status] ?? "待处理";
/** 后台柴油打印只接收已由服务端项目范围过滤后的真实记录，打印逻辑不再读取页面 DOM。 */
export default function DieselRefuelPrintDialog({
  open,
  onOpenChange,
  mode,
  projectName,
  dateLabel,
  records,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PrintMode;
  projectName: string;
  dateLabel: string;
  records: DieselPrintRecord[];
}) {
  const modeTitle =
    mode === "daily"
      ? "柴油当日加油明细及汇总表"
      : mode === "vehicle"
        ? "车辆加油统计明细表"
        : mode === "machine"
          ? "机械加油明细及汇总表"
          : "柴油加油明细及汇总表";
  const summary = summarizeDieselLedgerRecords(records);
  const totalLiters = summary.totalLiters;
  const totalAmount = summary.totalAmount;
  const uniqueAssets = new Set(records.map(item => item.assetName)).size;
  const print = () => {
    const columnGroup = printColumnGroup(DIESEL_REFUEL_COLUMN_WIDTHS);
    const rows = records
      .map(
        (item, index) =>
          `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(dateTime(item.refueledAt))}</td><td>${escapePrintHtml(item.assetName)}</td><td class="center">${item.assetType === "vehicle" ? "车辆" : "机械"}<br/>${getDieselRecordSourceLabel(item.recordNo)}</td><td>${item.supplyMethod === "project_supply" ? "项目部供油" : escapePrintHtml(item.stationOrSupplierName || "加油站")}</td><td class="center">${escapePrintHtml(refuelerName(item.refuelerName))}</td><td class="right">${Number(item.liters).toFixed(2)}</td><td class="right">${money(item.appliedUnitPrice)}</td><td class="right">${money(item.amount)}</td><td class="right">${escapePrintHtml(item.meterReading ?? "未记录")}</td><td class="center">${item.deductFromFreight ? "扣运费" : "不扣"}</td><td class="center">${escapePrintHtml(statusLabel(item.status))}</td></tr>`
      )
      .join("");
    openA4LandscapePrintDocument({
      title: modeTitle,
      bodyHtml: `<h1>${modeTitle}</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　统计条件：${escapePrintHtml(dateLabel)}　|　生成时间：${escapePrintHtml(dateTime(new Date()))}</p><hr class="rule"/><table>${columnGroup}<thead><tr><th>序号</th><th>加油时间</th><th>车辆 / 机械</th><th>类型</th><th>供油点 / 方式</th><th>加油员</th><th>油量(L)</th><th>单价</th><th>金额</th><th>加油机表数</th><th>运输扣油</th><th>状态</th></tr></thead><tbody>${rows || '<tr><td colspan="12" class="center">当前筛选范围暂无柴油记录</td></tr>'}<tr class="summary"><td colspan="6">合计：有效记录 ${summary.effectiveRecordCount} 笔 / 当前筛选 ${summary.displayedRecordCount} 笔，车辆/机械 ${uniqueAssets} 个</td><td class="right">${totalLiters.toFixed(2)}</td><td>—</td><td class="right">${money(totalAmount)}</td><td colspan="3">作废记录不计入汇总</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={PRINT_PREVIEW_DIALOG_CONTENT_CLASS}>
        <div className={PRINT_PREVIEW_DIALOG_HEADER_CLASS}>
          <DialogHeader>
            <DialogTitle>{modeTitle}</DialogTitle>
            <DialogDescription>
              预览与保存均使用当前真实筛选记录，含对应加油员；作废记录仅展示追溯，不计入汇总。点击后直接打开系统打印窗口，不依赖浏览器弹窗。
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className={PRINT_PREVIEW_DIALOG_BODY_CLASS}>
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 text-sm text-[#15110e]">
            <div className="mb-4 text-center">
              <p className="text-xl font-bold">{modeTitle}</p>
              <p className="mt-1 text-sm text-slate-600">
                {projectName} · {dateLabel}
              </p>
            </div>
            <div className={PRINT_PREVIEW_TABLE_FRAME_CLASS}>
              <table
                className={`${PRINT_PREVIEW_TABLE_FIT_CLASS} text-[11px] tabular-nums`}
              >
                <colgroup>
                  {DIESEL_REFUEL_COLUMN_WIDTHS.map((width, index) => (
                    <col key={index} style={{ width: `${width}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-slate-100">
                    <th>序号</th>
                    <th>加油时间</th>
                    <th>车辆 / 机械</th>
                    <th>类型</th>
                    <th>供油点 / 方式</th>
                    <th>加油员</th>
                    <th>油量(L)</th>
                    <th>单价</th>
                    <th>金额</th>
                    <th>加油机表数</th>
                    <th>运输扣油</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((item, index) => (
                    <tr key={item.id}>
                      <td className="text-center">{index + 1}</td>
                      <td>{dateTime(item.refueledAt)}</td>
                      <td>{item.assetName}</td>
                      <td className="text-center">
                        {item.assetType === "vehicle" ? "车辆" : "机械"}
                        <br />
                        <span className="text-[9px]">
                          {getDieselRecordSourceLabel(item.recordNo)}
                        </span>
                      </td>
                      <td>
                        {item.supplyMethod === "project_supply"
                          ? "项目部供油"
                          : item.stationOrSupplierName || "加油站"}
                      </td>
                      <td className="text-center">
                        {refuelerName(item.refuelerName)}
                      </td>
                      <td className="text-right">
                        {Number(item.liters).toFixed(2)}
                      </td>
                      <td className="text-right">
                        {money(item.appliedUnitPrice)}
                      </td>
                      <td className="text-right">{money(item.amount)}</td>
                      <td className="text-right">
                        {item.meterReading ?? "未记录"}
                      </td>
                      <td className="text-center">
                        {item.deductFromFreight ? "扣运费" : "不扣"}
                      </td>
                      <td className="text-center">
                        {statusLabel(item.status)}
                      </td>
                    </tr>
                  ))}
                  {!records.length ? (
                    <tr>
                      <td colSpan={12} className="text-center">
                        当前筛选范围暂无柴油记录
                      </td>
                    </tr>
                  ) : null}
                  <tr className="bg-amber-50 font-semibold">
                    <td colSpan={6}>
                      合计：有效 {summary.effectiveRecordCount} 笔 / 当前{" "}
                      {summary.displayedRecordCount} 笔 / {uniqueAssets} 个对象
                    </td>
                    <td className="text-right">{totalLiters.toFixed(2)}</td>
                    <td className="text-center">—</td>
                    <td className="text-right">{money(totalAmount)}</td>
                    <td colSpan={3} className="text-center">
                      作废不计入汇总
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <DialogFooter className={PRINT_PREVIEW_DIALOG_FOOTER_CLASS}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={print}>
            <Printer className="mr-2 h-4 w-4" />
            打印 / 保存 PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
