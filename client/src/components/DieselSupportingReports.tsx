import { useEffect, useMemo, useState } from "react";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import {
  FinancialLedgerPrintPreviewDialog,
  type FinancialPrintColumn,
  type FinancialPrintRow,
} from "@/components/FinancialLedgerPrintPreviewDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCurrentFilteredCsv } from "@/lib/a4Print";
import { formatChinaDate, formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount, formatQuantity } from "../../../shared/numberFormat";
import { Download, Printer } from "lucide-react";

export interface DieselSupplierReportRow {
  supplierName: string;
  liters: number;
  amount: number;
  averageUnitPrice: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  priceSpread: number;
  recordCount: number;
  receiptCount: number;
  alertCount: number;
}

export interface DieselSupplierReportProps {
  rows: readonly DieselSupplierReportRow[];
  loading: boolean;
  error?: boolean;
  projectName: string;
  /** 供应商汇总查询月份，不继承加油台账的日期筛选。 */
  period: string;
  enabled?: boolean;
}

export interface DieselPriceHistoryRow {
  id: number;
  pricePerLiter: string;
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
  status: string;
  remarks: string | null;
}

export interface DieselPriceHistoryProps {
  rows: readonly DieselPriceHistoryRow[];
  loading: boolean;
  error?: boolean;
  projectName: string;
  enabled?: boolean;
}

type AlertFilter = "all" | "alert" | "normal";
const alertLabels: Record<AlertFilter, string> = {
  all: "全部",
  alert: "有价格异常",
  normal: "无价格异常",
};
const priceStatusLabels: Record<string, string> = {
  active: "启用",
  draft: "草稿",
  disabled: "停用",
};
const supplierColumns: FinancialPrintColumn[] = [
  { label: "供应商" },
  { label: "升数（L）" },
  { label: "金额（元）" },
  { label: "加权均价（元/L）" },
  { label: "最低价（元/L）" },
  { label: "最高价（元/L）" },
  { label: "价差（元/L）" },
  { label: "加油笔数" },
  { label: "凭证笔数" },
  { label: "价格异常笔数" },
];
const priceColumns: FinancialPrintColumn[] = [
  { label: "记录编号" },
  { label: "指导价（元/L）" },
  { label: "生效开始日期" },
  { label: "生效结束日期" },
  { label: "状态" },
  { label: "备注" },
];
const selectClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const number = (value: number) => formatAmount(value);
const priceStatus = (status: string) => priceStatusLabels[status] ?? status;

function supplierCells(row: DieselSupplierReportRow): Array<string | number> {
  return [
    row.supplierName,
    formatQuantity(row.liters),
    formatAmount(row.amount),
    formatAmount(row.averageUnitPrice),
    formatAmount(row.minUnitPrice),
    formatAmount(row.maxUnitPrice),
    formatAmount(row.priceSpread),
    row.recordCount,
    row.receiptCount,
    row.alertCount,
  ];
}
function priceCells(row: DieselPriceHistoryRow): Array<string | number> {
  return [
    row.id,
    row.pricePerLiter,
    formatChinaDate(row.effectiveFrom),
    row.effectiveTo === null
      ? "未设置结束日期"
      : formatChinaDate(row.effectiveTo),
    priceStatus(row.status),
    row.remarks ?? "—",
  ];
}

/** 仍由公共工具执行 BOM、引号转义和公式防护；额外覆盖前导空格/控制字符绕过。 */
function exportReportCsv(
  fileName: string,
  title: string,
  projectName: string,
  period: string,
  filterLabel: string,
  columns: FinancialPrintColumn[],
  rows: FinancialPrintRow[],
  summaryLabel: string
) {
  const data: Array<Array<string | number>> = [
    ["项目", projectName],
    ["范围口径", period],
    ["本地筛选", filterLabel],
    ["导出记录数", rows.length],
    ["生成时间", formatChinaDateTime(new Date())],
    [],
    columns.map(column => column.label),
    ...rows.map(row => row.cells),
    [],
    ["汇总", summaryLabel],
  ];
  const safeText = (value: string | number) =>
    typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(value)
      ? value.replace(/^[\s\u0000-\u001f]+/, "")
      : value;
  downloadCurrentFilteredCsv(
    fileName,
    ["导出模块", title],
    data.map(row => row.map(safeText))
  );
}

/** 同步 scope/data 校验先阻断旧 portal，effect 再清除状态，防止切回范围复活旧预览。 */
function useReportPrintScope<T>(
  scope: string,
  rows: readonly T[],
  ready: boolean
) {
  const [selection, setSelection] = useState<{
    scope: string;
    rows: readonly T[];
  } | null>(null);
  useEffect(() => {
    setSelection(null);
  }, [scope, rows, ready]);
  const open = ready && selection?.scope === scope && selection.rows === rows;
  return {
    open,
    onOpenChange: (next: boolean) =>
      setSelection(next && ready ? { scope, rows } : null),
  };
}

function ReportTable({
  label,
  columns,
  rows,
  message,
}: {
  label: string;
  columns: FinancialPrintColumn[];
  rows: FinancialPrintRow[];
  message?: string;
}) {
  return (
    <div
      className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border border-border"
      tabIndex={0}
      role="region"
      aria-label={`${label}表格，可横向滚动`}
    >
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map(column => (
              <th
                key={column.label}
                scope="col"
                className="whitespace-nowrap px-3 py-3 text-left font-medium"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {message ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-muted-foreground"
                role="status"
              >
                {message}
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr key={row.id} className="border-t border-border">
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className={
                      index === 0 || index === columns.length - 1
                        ? "max-w-[260px] break-words px-3 py-3 [overflow-wrap:anywhere]"
                        : "whitespace-nowrap px-3 py-3 tabular-nums"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DieselSupplierReport({
  rows,
  loading,
  error = false,
  projectName,
  period,
  enabled = true,
}: DieselSupplierReportProps) {
  const [supplier, setSupplier] = useState("");
  const [alert, setAlert] = useState<AlertFilter>("all");
  const ready = enabled && !loading && !error;
  const filteredRows = useMemo(
    () =>
      ready
        ? rows.filter(
            row =>
              row.supplierName
                .toLowerCase()
                .includes(supplier.trim().toLowerCase()) &&
              (alert === "all" ||
                (alert === "alert" ? row.alertCount > 0 : row.alertCount === 0))
          )
        : [],
    [rows, ready, supplier, alert]
  );
  const scope = JSON.stringify([projectName, period, supplier, alert]);
  const pagination = useFinancePagination(filteredRows, scope);
  const print = useReportPrintScope(scope, rows, ready);
  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (total, row) => ({
          liters: total.liters + row.liters,
          amount: total.amount + row.amount,
          records: total.records + row.recordCount,
          receipts: total.receipts + row.receiptCount,
          alerts: total.alerts + row.alertCount,
        }),
        { liters: 0, amount: 0, records: 0, receipts: 0, alerts: 0 }
      ),
    [filteredRows]
  );
  // 不平均行均价，不推测缺失凭证或价格异常，零升数时加权价不可计算。
  const weightedPrice =
      totals.liters > 0 ? formatAmount(totals.amount / totals.liters) : "—";
  const summaryLabel = `当前筛选全部 ${filteredRows.length} 家供应商 · ${totals.records} 笔加油 · 合计 ${formatQuantity(totals.liters)} L · 金额 ¥${formatAmount(totals.amount)} · 加权价 ${weightedPrice === "—" ? "—" : `¥${weightedPrice}/L`} · 凭证 ${totals.receipts} 笔 · 价格异常 ${totals.alerts} 笔`;
  const filterLabel = `供应商：${supplier.trim() || "全部"}；价格异常：${alertLabels[alert]}`;
  const outputPeriod = `供应商汇总月份 ${period}（非加油台账日期筛选）`;
  const allPrintRows = useMemo(
    () =>
      filteredRows.map((row, index) => ({
        id: index,
        cells: supplierCells(row),
      })),
    [filteredRows]
  );
  const canOutput = ready && filteredRows.length > 0;
  const message = error
    ? "供应商汇总读取失败，已隐藏旧数据，请重试。"
    : loading
      ? "正在读取供应商汇总，旧范围数据暂不展示…"
      : !filteredRows.length
        ? "当前筛选范围暂无供应商汇总记录。"
        : undefined;
  if (!enabled) return null;
  return (
    <section
      className="w-full min-w-0 max-w-full space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      aria-label="柴油供应商汇总"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">柴油供应商汇总</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            项目：{projectName} · 供应商汇总月份：{period}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canOutput}
            onClick={() => {
              if (canOutput)
                exportReportCsv(
                  `柴油供应商汇总-${period}.csv`,
                  "柴油供应商汇总",
                  projectName,
                  outputPeriod,
                  filterLabel,
                  supplierColumns,
                  allPrintRows,
                  summaryLabel
                );
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            导出全部筛选 CSV
          </Button>
          <Button
            variant="outline"
            disabled={!canOutput}
            onClick={() => {
              if (canOutput) print.onOpenChange(true);
            }}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            汇总打印
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        按供应商汇总月份读取外部加油站现金加油数据，不继承加油台账日期筛选；本地筛选仅收敛已读取结果。价格异常以传入异常笔数为准。
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>供应商关键词</span>
          <Input
            value={supplier}
            onChange={event => setSupplier(event.target.value)}
            placeholder="搜索供应商名称"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>是否价格异常</span>
          <select
            className={selectClass}
            value={alert}
            onChange={event => setAlert(event.target.value as AlertFilter)}
          >
            {Object.entries(alertLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ready && (
        <p
          className="break-words rounded-md bg-muted p-3 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          role="status"
        >
          {summaryLabel}
          <span className="mt-1 block">
            加权价＝筛选后合计金额÷合计升数；列表分页不影响汇总、打印或导出。
          </span>
        </p>
      )}
      <ReportTable
        label="柴油供应商汇总"
        columns={supplierColumns}
        rows={pagination.pageRows.map((row, index) => ({
          id: index,
          cells: supplierCells(row),
        }))}
        message={message}
      />
      {ready && (
        <FinancePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          label="供应商汇总"
        />
      )}
      {print.open && canOutput && (
        <FinancialLedgerPrintPreviewDialog
          open
          onOpenChange={print.onOpenChange}
          title="柴油供应商汇总"
          projectName={projectName}
          period={outputPeriod}
          filterLabel={filterLabel}
          columns={supplierColumns}
          rows={allPrintRows}
          summaryLabel={summaryLabel}
        />
      )}
    </section>
  );
}

export function DieselPriceHistory({
  rows,
  loading,
  error = false,
  projectName,
  enabled = true,
}: DieselPriceHistoryProps) {
  const [status, setStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const ready = enabled && !loading && !error;
  const filteredRows = useMemo(
    () =>
      ready
        ? rows.filter(row => {
            const date = formatChinaDate(row.effectiveFrom, "");
            return (
              (status === "all" || row.status === status) &&
              (!dateFrom || (!!date && date >= dateFrom)) &&
              (!dateTo || (!!date && date <= dateTo)) &&
              priceCells(row)
                .join(" ")
                .toLowerCase()
                .includes(keyword.trim().toLowerCase())
            );
          })
        : [],
    [rows, ready, status, keyword, dateFrom, dateTo]
  );
  const scope = JSON.stringify([
    projectName,
    status,
    keyword,
    dateFrom,
    dateTo,
  ]);
  const pagination = useFinancePagination(filteredRows, scope);
  const print = useReportPrintScope(scope, rows, ready);
  const allPrintRows = useMemo(
    () => filteredRows.map(row => ({ id: row.id, cells: priceCells(row) })),
    [filteredRows]
  );
  const summaryLabel = `当前筛选全部 ${filteredRows.length} 条指导价记录 · 启用 ${filteredRows.filter(row => row.status === "active").length} 条 · 草稿 ${filteredRows.filter(row => row.status === "draft").length} 条 · 停用 ${filteredRows.filter(row => row.status === "disabled").length} 条；状态为维护状态，不代表当前日期必然生效；不合计或平均指导价。`;
  const outputPeriod = "不适用：指导价按生效日期/状态，不按会计月份";
  const filterLabel = `状态：${status === "all" ? "全部" : priceStatus(status)}；关键词：${keyword.trim() || "全部"}；生效开始日期：${dateFrom || "不限"} 至 ${dateTo || "不限"}`;
  const statuses = useMemo(
    () =>
      Array.from(
        new Set([
          "active",
          "draft",
          "disabled",
          ...(ready ? rows.map(row => row.status) : []),
        ])
      ),
    [rows, ready]
  );
  const canOutput = ready && filteredRows.length > 0;
  const message = error
    ? "指导价历史读取失败，已隐藏旧数据，请重试。"
    : loading
      ? "正在读取指导价历史，旧范围数据暂不展示…"
      : !filteredRows.length
        ? "当前筛选范围暂无指导价历史记录。"
        : undefined;
  if (!enabled) return null;
  return (
    <section
      className="w-full min-w-0 max-w-full space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      aria-label="柴油指导价历史"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">柴油指导价历史</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            项目：{projectName} · 按生效日期与状态查看
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canOutput}
            onClick={() => {
              if (canOutput)
                exportReportCsv(
                  "柴油指导价历史.csv",
                  "柴油指导价历史",
                  projectName,
                  outputPeriod,
                  filterLabel,
                  priceColumns,
                  allPrintRows,
                  summaryLabel
                );
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            导出全部筛选 CSV
          </Button>
          <Button
            variant="outline"
            disabled={!canOutput}
            onClick={() => {
              if (canOutput) print.onOpenChange(true);
            }}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            汇总打印
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        指导价按生效日期/状态管理，不按会计月份或加油台账日期筛选；启用不等于当前有效，实际加油取价由服务端按生效期匹配。
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>指导价状态</span>
          <select
            className={selectClass}
            value={status}
            onChange={event => setStatus(event.target.value)}
          >
            <option value="all">全部状态</option>
            {statuses.map(value => (
              <option key={value} value={value}>
                {priceStatus(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>指导价关键词</span>
          <Input
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="编号、价格、日期或备注"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>生效开始日期从</span>
          <Input
            className="min-w-0 max-w-full"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={event => setDateFrom(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>生效开始日期至</span>
          <Input
            className="min-w-0 max-w-full"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={event => setDateTo(event.target.value)}
          />
        </label>
      </div>
      {ready && (
        <p
          className="break-words rounded-md bg-muted p-3 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          role="status"
        >
          {summaryLabel}
          <span className="mt-1 block">
            汇总、打印、导出均使用全部筛选结果，不受列表分页影响。
          </span>
        </p>
      )}
      <ReportTable
        label="柴油指导价历史"
        columns={priceColumns}
        rows={pagination.pageRows.map(row => ({
          id: row.id,
          cells: priceCells(row),
        }))}
        message={message}
      />
      {ready && (
        <FinancePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          label="指导价历史"
        />
      )}
      {print.open && canOutput && (
        <FinancialLedgerPrintPreviewDialog
          open
          onOpenChange={print.onOpenChange}
          title="柴油指导价历史"
          projectName={projectName}
          period={outputPeriod}
          filterLabel={filterLabel}
          columns={priceColumns}
          rows={allPrintRows}
          summaryLabel={summaryLabel}
        />
      )}
    </section>
  );
}
