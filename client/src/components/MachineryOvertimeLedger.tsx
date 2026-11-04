import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { toDeviceDateInput } from "@/lib/businessTime";
import {
  downloadMachineryCsv,
  filterMachineryOvertime,
  machineryMoney,
  machineryStatus,
  overtimeNextActions,
  overtimeTotals,
} from "@/lib/machineryWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";

export default function MachineryOvertimeLedger({
  projectId,
  period,
  machineId,
  active = true,
  onCreate,
}: {
  projectId: number;
  period: string;
  machineId?: number;
  active?: boolean;
  onCreate?: () => void;
}) {
  const [date, setDate] = useState(toDeviceDateInput);
  const [status, setStatus] = useState("all");
  const enabled =
    active && Boolean(projectId) && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const query = trpc.machinery.listDailyOperations.useQuery(
    { projectId, period, machineId },
    { enabled }
  );
  const capabilities = trpc.machinery.workspaceCapabilities.useQuery(
    { projectId },
    { enabled: active && Boolean(projectId) }
  );
  const utils = trpc.useUtils();
  const transition = trpc.machinery.transitionDailyOperation.useMutation({
    onSuccess: async () => {
      toast.success("加班记录状态已更新");
      await Promise.all([
        utils.machinery.listDailyOperations.invalidate(),
        utils.machinery.getMachineAnalysis.invalidate(),
      ]);
    },
    onError: error =>
      toast.error(getUserFacingErrorMessage(error, "加班状态操作未完成")),
  });
  const effectiveDate = date.startsWith(period) ? date : "";
  const filteredRows = useMemo(
    () =>
      filterMachineryOvertime(query.data ?? [], {
        date: effectiveDate,
        status,
        machineId,
      }),
    [query.data, effectiveDate, status, machineId]
  );
  const totals = overtimeTotals(filteredRows);
  const pagination = useFinancePagination(
    filteredRows,
    JSON.stringify([projectId, period, machineId, effectiveDate, status])
  );
  const headers = [
    "日期",
    "机械",
    "编号",
    "司机",
    "加班小时",
    "小时单价",
    "加班金额",
    "状态",
    "备注",
  ];
  const exportRows = filteredRows.map(row => [
    row.date,
    row.machineName,
    row.machineCode,
    row.driverName || "未登记",
    row.overtimeHours,
    row.overtimeHourlyRate,
    row.overtimeAmount,
    machineryStatus(row.status),
    row.remarks || "",
  ]);
  function print() {
    openA4LandscapePrintDocument({
      title: "司机加班筛选明细",
      bodyHtml: `<h1>司机加班筛选明细</h1><p class="sub">项目 #${projectId} · ${escapePrintHtml(period)} · ${escapePrintHtml(effectiveDate || "全部当期日期")} · 状态 ${escapePrintHtml(status === "all" ? "全部（作废仅审计）" : machineryStatus(status))}</p><table><thead><tr>${headers.map(value => `<th>${escapePrintHtml(value)}</th>`).join("")}</tr></thead><tbody>${exportRows.map(row => `<tr>${row.map(value => `<td>${escapePrintHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><p>共 ${totals.count} 条；有效加班 ${totals.hours} 小时；有效加班金额 ${escapePrintHtml(machineryMoney(totals.amount))}。作废金额不计入合计；历史合同记录只读留存，未新增台班录入。</p>`,
    });
  }
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">司机加班</h2>
          <p className="text-xs text-muted-foreground">
            日登记 · 月核对 ·
            原状态机。确认结算不等同于实际发薪，不重复建立工资流水。
          </p>
        </div>
        {onCreate && capabilities.data?.canCreate ? (
          <Button onClick={onCreate}>登记加班</Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm">
          加班日期
          <Input
            aria-label="加班日期"
            type="date"
            value={effectiveDate}
            onChange={event => setDate(event.target.value)}
          />
        </label>
        <Button variant="outline" onClick={() => setDate("")}>
          全部当期日期
        </Button>
        <label className="text-sm">
          加班状态
          <select
            aria-label="加班状态"
            className="ml-2 min-h-10 rounded border bg-background p-2"
            value={status}
            onChange={event => setStatus(event.target.value)}
          >
            {["all", "draft", "submitted", "approved", "settled", "void"].map(
              value => (
                <option key={value} value={value}>
                  {value === "all" ? "全部状态" : machineryStatus(value)}
                </option>
              )
            )}
          </select>
        </label>
        <CurrentFilterPrintActions
          disabled={
            !filteredRows.length || query.isFetching || Boolean(query.error)
          }
          onPrint={print}
          onExport={() =>
            downloadMachineryCsv(`司机加班-${period}.csv`, headers, exportRows)
          }
        />
      </div>
      <p className="text-sm" role="status">
        当前筛选 {totals.count} 条 · 有效加班 {totals.hours} 小时 · 有效金额{" "}
        {machineryMoney(totals.amount)}（作废不计合计）
      </p>
      {query.error ? (
        <p role="alert">
          {getUserFacingErrorMessage(query.error, "加班明细加载失败")}
        </p>
      ) : query.isLoading ? (
        <p>正在读取司机加班…</p>
      ) : !filteredRows.length ? (
        <p>当前筛选暂无司机加班记录。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-sm">
            <thead>
              <tr>
                {[
                  "日期 / 机械",
                  "司机",
                  "加班小时 / 单价",
                  "加班金额",
                  "状态",
                  "操作",
                ].map(label => (
                  <th key={label} className="p-2 text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagination.pageRows.map(row => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">
                    {row.date}
                    <p className="text-xs text-muted-foreground">
                      {row.machineName} · {row.machineCode}
                    </p>
                    {row.legacyShiftCount > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        含历史合同作业记录（只读）
                      </p>
                    ) : null}
                    {row.remarks ? (
                      <p className="text-xs">{row.remarks}</p>
                    ) : null}
                  </td>
                  <td className="p-2">{row.driverName || "未登记"}</td>
                  <td className="p-2">
                    {row.overtimeHours} 小时 ×{" "}
                    {machineryMoney(row.overtimeHourlyRate)}
                  </td>
                  <td className="p-2">{machineryMoney(row.overtimeAmount)}</td>
                  <td className="p-2">{machineryStatus(row.status)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {overtimeNextActions(row.status, capabilities.data).map(
                        action => (
                          <Button
                            key={action.nextStatus}
                            size="sm"
                            variant="outline"
                            disabled={transition.isPending}
                            onClick={() => {
                              if (
                                action.nextStatus === "void" &&
                                !window.confirm(
                                  "确认作废该加班记录？作废后不可恢复。"
                                )
                              )
                                return;
                              transition.mutate({
                                id: row.id,
                                projectId,
                                nextStatus: action.nextStatus,
                              });
                            }}
                          >
                            {action.label}
                          </Button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FinancePagination
        {...pagination}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        label="司机加班"
      />
    </section>
  );
}
