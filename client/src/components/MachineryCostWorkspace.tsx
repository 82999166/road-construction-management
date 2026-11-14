import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";
import {
  downloadMachineryCsv,
  machineryCostType,
  machineryMoney,
  machineryQuantity,
  machineryStatus,
  MACHINERY_COST_SCOPE_NOTE,
} from "@/lib/machineryWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";

export default function MachineryCostWorkspace({
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
  const [status, setStatus] = useState<
    "all" | "draft" | "approved" | "settled" | "void"
  >("all");
  const enabled =
    active && Boolean(projectId) && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const query = trpc.machinery.printSummary.useQuery(
    { projectId, period, machineId, status },
    { enabled }
  );
  const capabilities = trpc.machinery.workspaceCapabilities.useQuery(
    { projectId },
    { enabled: active && Boolean(projectId) }
  );
  const utils = trpc.useUtils();
  const transition = trpc.machinery.transitionCost.useMutation({
    onSuccess: async () => {
      toast.success("成本状态已更新");
      await Promise.all([
        utils.machinery.printSummary.invalidate(),
        utils.machinery.listCosts.invalidate(),
        utils.machinery.listCostSummaries.invalidate(),
        utils.machinery.getMachineAnalysis.invalidate(),
      ]);
    },
    onError: error =>
      toast.error(getUserFacingErrorMessage(error, "成本操作未完成")),
  });
  const filteredRows = query.data?.records ?? [];
  const pagination = useFinancePagination(
    filteredRows,
    JSON.stringify([projectId, period, machineId, status])
  );
  const headers = [
    "日期",
    "机械",
    "来源",
    "费用名称",
    "数量",
    "单价",
    "金额",
    "状态",
    "备注",
  ];
  const exportRows = filteredRows.map(row => [
    formatChinaDateTime(row.occurredAt),
    row.machineLabel,
    machineryCostType(row.costType),
    row.costName,
    machineryQuantity(row.quantity),
    machineryMoney(row.unitPrice),
    machineryMoney(row.amount),
    machineryStatus(row.status),
    row.remarks || "",
  ]);
  function print() {
    openA4LandscapePrintDocument({
      title: "机械费用筛选明细与汇总",
      bodyHtml: `<h1>机械费用筛选明细与汇总</h1><p class="sub">项目 #${projectId} · 月 ${escapePrintHtml(period)} · ${machineId ? `机械 #${machineId}` : "全部机械"} · ${escapePrintHtml(status === "all" ? "有效费用（不含作废）" : machineryStatus(status))}</p><table><thead><tr>${headers.map(label => `<th>${escapePrintHtml(label)}</th>`).join("")}</tr></thead><tbody>${exportRows.map(row => `<tr>${row.map(value => `<td>${escapePrintHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><p>当前筛选 ${filteredRows.length} 笔 · ${status === "void" ? "作废审计金额（不计有效成本）" : "成本金额"} ${escapePrintHtml(machineryMoney(query.data?.summary.amount))}</p><p class="sub">${escapePrintHtml(MACHINERY_COST_SCOPE_NOTE)}</p>`,
    });
  }
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">费用统计</h2>
          <p className="text-xs text-muted-foreground">
            月 · {period} · 机械成本台账来源；不等同于付款或租金应付。
          </p>
        </div>
        {onCreate && capabilities.data?.canCreate ? (
          <Button onClick={onCreate}>费用录入</Button>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {MACHINERY_COST_SCOPE_NOTE}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm">
          费用状态
          <select
            aria-label="机械费用状态"
            className="ml-2 min-h-10 rounded border bg-background p-2"
            value={status}
            onChange={event => setStatus(event.target.value as typeof status)}
          >
            {["all", "draft", "approved", "settled", "void"].map(value => (
              <option key={value} value={value}>
                {value === "all"
                  ? "有效费用（不含作废）"
                  : machineryStatus(value)}
              </option>
            ))}
          </select>
        </label>
        <CurrentFilterPrintActions
          disabled={
            !filteredRows.length || query.isFetching || Boolean(query.error)
          }
          onPrint={print}
          onExport={() =>
            downloadMachineryCsv(`机械费用-${period}.csv`, headers, exportRows)
          }
        />
      </div>
      <p role="status" className="text-sm">
        当前筛选 {filteredRows.length} 笔 ·{" "}
        {status === "void" ? "作废审计金额（不计有效成本）" : "成本金额"}{" "}
        {machineryMoney(query.data?.summary.amount)}
      </p>
      {query.error ? (
        <p role="alert">
          {getUserFacingErrorMessage(query.error, "机械费用加载失败")}
        </p>
      ) : query.isLoading ? (
        <p>正在读取机械费用…</p>
      ) : !filteredRows.length ? (
        <p>当前筛选暂无费用记录。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                {[
                  "日期 / 机械",
                  "费用 / 来源",
                  "数量 / 单价",
                  "金额",
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
                    {formatChinaDateTime(row.occurredAt)}
                    <p className="text-xs">{row.machineLabel}</p>
                  </td>
                  <td className="p-2">
                    {row.costName}
                    <p className="text-xs text-muted-foreground">
                      {machineryCostType(row.costType)}
                      {row.remarks ? ` · ${row.remarks}` : ""}
                    </p>
                  </td>
                  <td className="p-2">
                    {machineryQuantity(row.quantity)} × {machineryMoney(row.unitPrice)}
                  </td>
                  <td className="p-2">{machineryMoney(row.amount)}</td>
                  <td className="p-2">{machineryStatus(row.status)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === "draft" &&
                      capabilities.data?.canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={transition.isPending}
                          onClick={() =>
                            transition.mutate({
                              id: row.id,
                              projectId,
                              nextStatus: "approved",
                            })
                          }
                        >
                          审核
                        </Button>
                      ) : null}
                      {row.status === "approved" &&
                      capabilities.data?.canSettle ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={transition.isPending}
                          onClick={() =>
                            transition.mutate({
                              id: row.id,
                              projectId,
                              nextStatus: "settled",
                            })
                          }
                        >
                          确认结算
                        </Button>
                      ) : null}
                      {["draft", "approved"].includes(row.status) &&
                      capabilities.data?.canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={transition.isPending}
                          onClick={() => {
                            if (window.confirm("确认作废此费用记录？"))
                              transition.mutate({
                                id: row.id,
                                projectId,
                                nextStatus: "void",
                              });
                          }}
                        >
                          作废
                        </Button>
                      ) : null}
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
        label="机械费用"
      />
    </section>
  );
}
