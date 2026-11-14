import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { openA4PrintDocument, downloadCurrentFilteredCsv } from "@/lib/a4Print";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import {
  buildVehicleReport,
  type VehicleReport,
} from "@/lib/vehicleManagementWorkspace";
export function VehicleManagementReport({
  report,
  actions,
}: {
  report: VehicleReport;
  actions?: (index: number) => React.ReactNode;
}) {
  const paging = useFinancePagination(report.rows, report.scope);
  const [preview, setPreview] = useState(false);
  const displayRows = report.rows.map(row =>
    row.map((cell, index) => formatVehicleReportCell(report.headers[index] ?? "", cell))
  );
  const displayReport = { ...report, rows: displayRows };
  const html = buildVehicleReport(displayReport);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{report.title}</h3>
          <p className="text-xs text-muted-foreground">
            {report.scope} · 全部筛选 {report.rows.length} 条
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCurrentFilteredCsv(
                `${report.title}.csv`,
                report.headers,
                displayRows.map(row => row.map(cell => cell ?? ""))
              )
            }
          >
            导出全部筛选
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
            筛选打印预览
          </Button>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted">
            <tr>
              {report.headers.map((h, i) => (
                <th className="whitespace-nowrap p-2.5" key={i}>
                  {h}
                </th>
              ))}
              {actions && <th className="p-2.5">办理</th>}
            </tr>
          </thead>
          <tbody>
            {paging.pageRows.map((row, i) => (
              <tr
                key={(paging.page - 1) * paging.pageSize + i}
                className="border-t"
              >
                {row.map((_cell, j) => (
                  <td
                    key={j}
                    className="max-w-64 whitespace-normal break-words p-2.5"
                  >
                    {displayRows[(paging.page - 1) * paging.pageSize + i]?.[j] ?? "未登记"}
                  </td>
                ))}
                {actions && (
                  <td className="p-2.5">
                    {actions((paging.page - 1) * paging.pageSize + i)}
                  </td>
                )}
              </tr>
            ))}
            {!report.rows.length && (
              <tr>
                <td
                  colSpan={report.headers.length + (actions ? 1 : 0)}
                  className="p-5 text-center text-muted-foreground"
                >
                  暂无符合筛选的真实记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <FinancePagination
        page={paging.page}
        pageSize={paging.pageSize}
        total={paging.total}
        onPageChange={paging.setPage}
        onPageSizeChange={paging.setPageSize}
        label={report.title}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        {report.summary}
      </p>
      {preview && (
        <Dialog open onOpenChange={setPreview}>
          <DialogContent className="flex h-[90dvh] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[min(96vw,1400px)] flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>{report.title} · 全部筛选结果</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-2">
              <div
                className="min-w-[920px] bg-white p-5 text-black [&_h1]:text-center [&_h1]:text-lg [&_p]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:p-2 [&_td]:p-2 [&_table]:text-xs"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(false)}>
                关闭预览
              </Button>
              <Button
                onClick={() =>
                  openA4PrintDocument({
                    title: report.title,
                    bodyHtml: html,
                    orientation: "landscape",
                  })
                }
              >
                打印全部筛选
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function formatVehicleReportCell(header: string, value: string | number | null | undefined) {
  if (value == null || value === "") return value;
  if (header === "数量") return formatQuantity(value);
  if (["金额", "单价", "原合同单价", "运费基数", "已核定运费", "待核验运费", "油料", "维修", "保养", "配件", "已核定租赁", "未核定租赁估算", "实际付出", "实际收回"].includes(header)) {
    return formatAmount(value);
  }
  return value;
}
