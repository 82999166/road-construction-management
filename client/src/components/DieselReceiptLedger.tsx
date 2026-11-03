import React, { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import {
  FinancialLedgerPrintPreviewDialogs,
  type FinancialPrintBook,
  type FinancialPrintBookId,
} from "@/components/FinancialLedgerPrintPreviewDialogs";
import { downloadCurrentFilteredCsv } from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";

/** 仅接受现有 admin.diesel.listRefuelRecords 的非敏感显示字段，不接收全项目发票列表。 */
export type DieselReceiptRecord = {
  id: number;
  projectId: number;
  recordNo: string;
  assetType: "vehicle" | "machine";
  assetName?: string | null;
  supplyMethod: "project_supply" | "external_station";
  stationOrSupplierName: string | null;
  refueledAt: Date | string;
  liters: string | number;
  amount: string | number;
  appliedUnitPrice: string | number;
  status: "draft" | "approved" | "settled" | "void";
  receiptNo: string | null;
  evidenceId?: number | null;
  receiptEvidence?: {
    id?: number;
    fileName: string | null;
    mimeType: string | null;
    url: string | null;
  } | null;
};

export type DieselReceiptLedgerProps = {
  records: DieselReceiptRecord[];
  loading?: boolean;
  error?: boolean;
  projectName: string;
  filterLabel: string;
  /** 不自行发请求；未启用时也不展示旧记录或允许导出。 */
  enabled?: boolean;
};

const statusLabels: Record<DieselReceiptRecord["status"], string> = {
  draft: "草稿",
  approved: "已记账",
  settled: "已结算",
  void: "已作废",
};
export const DIESEL_NO_INVOICE_LINKAGE = "未建立正式发票关联";
const columns = [
  "加油单号",
  "加油时间（北京时间）",
  "资源",
  "资源类型",
  "供油方式",
  "供应商 / 供油点",
  "升数（L）",
  "单价（元/L）",
  "金额（元）",
  "记录状态",
  "小票 / 凭证号",
  "影像凭证",
  "正式发票关联",
].map(label => ({ label }));

function finiteNumber(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** 显式投影：不把小票号码当发票号码，也不按供应商、金额、备注或类别匹配发票。 */
export function projectDieselReceipt(record: DieselReceiptRecord) {
  const receiptNo = record.receiptNo?.trim() || null;
  const evidence = record.receiptEvidence?.url ? record.receiptEvidence : null;
  return {
    id: record.id,
    recordNo: record.recordNo,
    refueledAt: formatChinaDateTime(record.refueledAt),
    assetName: record.assetName || "未关联资源",
    assetType: record.assetType === "vehicle" ? "车辆" : "机械",
    supplyMethod:
      record.supplyMethod === "project_supply" ? "项目部供油" : "加油站加油",
    supplierName: record.stationOrSupplierName || "未登记供应商 / 供油点",
    liters: finiteNumber(record.liters),
    unitPrice: finiteNumber(record.appliedUnitPrice),
    amount: finiteNumber(record.amount),
    status: statusLabels[record.status],
    isVoid: record.status === "void",
    receiptNo,
    hasReceipt: Boolean(receiptNo || evidence),
    receiptEvidence: evidence
      ? {
          id: evidence.id ?? record.evidenceId ?? null,
          url: evidence.url!,
          fileName: evidence.fileName,
          mimeType: evidence.mimeType,
        }
      : null,
    // 现有柴油接口未提供可核验的发票实体关联；不能用自由文本财务来源伪造关联。
    formalInvoice: null,
    invoiceLinkage: "no_linkage" as const,
  };
}

/** 导出与打印均基于全部当前筛选记录，而非分页切片；作废项保留但不计入有效金额。 */
export function buildDieselReceiptBook(
  records: DieselReceiptRecord[],
  filterLabel: string
): FinancialPrintBook {
  const projected = records.map(projectDieselReceipt);
  const active = projected.filter(record => !record.isVoid);
  const liters = active.reduce((sum, record) => sum + record.liters, 0);
  const amount = active.reduce((sum, record) => sum + record.amount, 0);
  const receiptCount = projected.filter(record => record.hasReceipt).length;
  const previewCount = projected.filter(
    record => record.receiptEvidence
  ).length;
  return {
    id: "invoices",
    title: "柴油票据与凭证台账（非正式发票台账）",
    filterLabel,
    columns,
    rows: projected.map(record => ({
      id: record.id,
      cells: [
        record.recordNo,
        record.refueledAt,
        record.assetName,
        record.assetType,
        record.supplyMethod,
        record.supplierName,
        record.liters.toFixed(3),
        record.unitPrice.toFixed(2),
        record.amount.toFixed(2),
        record.status,
        record.receiptNo || "未登记小票 / 凭证号",
        record.receiptEvidence ? "已关联可预览影像" : "未关联可预览影像",
        DIESEL_NO_INVOICE_LINKAGE,
      ],
    })),
    summaryLabel: `合计 ${projected.length} 条；有小票号或影像 ${receiptCount} 条；可预览影像 ${previewCount} 条；有效升数 ${liters.toFixed(3)} L；有效金额 ¥${amount.toFixed(2)}（不含作废 ${projected.length - active.length} 条）。小票 / 加油表影像不等于正式发票；当前记录未提供可核验的正式发票关联。`,
  };
}

export function paginateDieselReceipts<T>(
  rows: T[],
  requestedPage: number,
  pageSize: number
) {
  const size = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : 20;
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  return { page, pageCount, rows: rows.slice((page - 1) * size, page * size) };
}

/** 第四柴油栏目只读已授权、已筛选领用记录，不加载全项目财务或创建任何票据。 */
export function DieselReceiptLedger({
  records,
  loading = false,
  error = false,
  projectName,
  filterLabel,
  enabled = true,
}: DieselReceiptLedgerProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activeBook, setActiveBook] = useState<FinancialPrintBookId | null>(
    null
  );
  const available = enabled && !loading && !error;
  const book = useMemo(
    () => buildDieselReceiptBook(available ? records : [], filterLabel),
    [records, filterLabel, available]
  );
  const projected = useMemo(
    () => (available ? records.map(projectDieselReceipt) : []),
    [records, available]
  );
  const pagination = paginateDieselReceipts(projected, page, pageSize);
  useEffect(() => {
    setPage(1);
    setActiveBook(null);
  }, [filterLabel, projectName, pageSize, enabled]);
  useEffect(() => {
    if (!available) setActiveBook(null);
  }, [available]);
  const exportAll = () => {
    if (!available || !book.rows.length) return;
    downloadCurrentFilteredCsv(
      `柴油票据-${projectName.replace(/[\\/:*?"<>|]/g, "_")}-当前筛选.csv`,
      book.columns.map(column => column.label),
      [...book.rows.map(row => row.cells), [book.summaryLabel]]
    );
  };

  return (
    <Card className="border-[#d8e3e0]">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">柴油票据 / 加油凭证</CardTitle>
            <CardDescription>
              仅展示当前筛选范围内柴油记录的真实小票号和已关联加油表影像；只读核验，不提供登记、修改或开票操作。
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!available || !book.rows.length}
              onClick={exportAll}
            >
              <Download className="mr-1.5 h-4 w-4" />
              导出全部当前筛选
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!available || !book.rows.length}
              onClick={() => setActiveBook("invoices")}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              打印全部当前筛选
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          项目：{projectName} · 筛选：{filterLabel} ·
          分页只影响浏览，导出与打印包含全部当前筛选记录。
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          小票 / 加油表影像不等于正式发票。{DIESEL_NO_INVOICE_LINKAGE}
          表示当前柴油记录未提供可核验的发票关联，不代表已开票或未开票；不根据供应商、备注、金额或类别猜测发票。
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enabled ? (
          <p role="status" className="py-8 text-center text-sm text-slate-500">
            请先选择已授权项目并启用柴油票据栏目。
          </p>
        ) : loading ? (
          <p role="status" className="py-8 text-center text-sm text-slate-500">
            正在加载柴油票据与凭证…
          </p>
        ) : error ? (
          <p role="alert" className="py-8 text-center text-sm text-red-700">
            柴油票据加载失败，请刷新当前筛选台账后重试；未将失败视为无票据。
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "加油单号 / 时间",
                      "资源 / 供油方式",
                      "供应商 / 供油点",
                      "升数 / 金额",
                      "记录状态",
                      "小票 / 凭证号",
                      "影像凭证",
                      "正式发票关联",
                    ].map(label => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.rows.length ? (
                    pagination.rows.map(record => (
                      <TableRow key={record.id}>
                        <TableCell className="min-w-[170px]">
                          <span className="font-medium">{record.recordNo}</span>
                          <p className="mt-1 text-xs text-slate-500">
                            {record.refueledAt}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-[130px]">
                          {record.assetName}
                          <p className="mt-1 text-xs text-slate-500">
                            {record.assetType} · {record.supplyMethod}
                          </p>
                        </TableCell>
                        <TableCell>{record.supplierName}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {record.liters.toFixed(3)} L
                          <p className="mt-1 font-medium">
                            ¥{record.amount.toFixed(2)}
                          </p>
                        </TableCell>
                        <TableCell
                          className={
                            record.isVoid
                              ? "text-slate-500"
                              : "text-emerald-700"
                          }
                        >
                          {record.status}
                        </TableCell>
                        <TableCell>
                          {record.receiptNo || (
                            <span className="text-slate-500">
                              未登记小票 / 凭证号
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {record.receiptEvidence ? (
                            <ProtectedImagePreview
                              file={record.receiptEvidence}
                              title="柴油加油凭证预览"
                              description="原有柴油记录关联的受控影像，仅在授权项目内预览；不作为正式发票认定。"
                              className="text-xs text-[#29483e]"
                            >
                              <span>查看加油凭证</span>
                            </ProtectedImagePreview>
                          ) : (
                            <span className="text-xs text-slate-500">
                              未关联可预览影像
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[145px] text-xs text-amber-800">
                          {DIESEL_NO_INVOICE_LINKAGE}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-sm text-slate-500"
                      >
                        当前筛选范围内暂无柴油记录；不加载全项目或其他业务的发票填充。
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
              {book.summaryLabel}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                每页条数
                <select
                  aria-label="柴油票据每页条数"
                  value={pageSize}
                  onChange={event => setPageSize(Number(event.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5"
                >
                  {[20, 50, 100].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <nav
                aria-label="柴油票据分页"
                className="flex items-center gap-3 text-xs text-slate-600"
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
                >
                  上一页
                </Button>
                <span>
                  第 {pagination.page} / {pagination.pageCount} 页 · 共{" "}
                  {projected.length} 条
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page >= pagination.pageCount}
                  onClick={() => setPage(pagination.page + 1)}
                >
                  下一页
                </Button>
              </nav>
            </div>
          </>
        )}
        <FinancialLedgerPrintPreviewDialogs
          activeBook={available ? activeBook : null}
          onActiveBookChange={setActiveBook}
          projectName={projectName}
          period="当前柴油筛选范围"
          books={[book]}
        />
      </CardContent>
    </Card>
  );
}
