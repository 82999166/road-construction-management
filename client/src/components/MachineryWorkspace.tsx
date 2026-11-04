import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { BusinessWorkspaceNavigation } from "@/components/BusinessWorkspaceNavigation";
import {
  FinancePagination,
  FinanceRetainedPanel,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import MachinePaymentSettlementManager from "@/components/MachinePaymentSettlementManager";
import MachineryOvertimeLedger from "@/components/MachineryOvertimeLedger";
import MachineryCostWorkspace from "@/components/MachineryCostWorkspace";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDate, formatChinaDateTime } from "@/lib/businessTime";
import {
  downloadMachineryCsv,
  filterMachineSettlements,
  machineryMoney,
  machineryStatus,
  MACHINERY_WORKSPACE_TABS,
  MACHINERY_DETAIL_TABS,
  MACHINERY_COST_SCOPE_NOTE,
  type MachineryWorkspaceTab,
  type MachineryDetailTab,
} from "@/lib/machineryWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Machine =
  inferRouterOutputs<AppRouter>["machinery"]["listMachines"][number];
export interface MachineryWorkspaceProps {
  projectId: number;
  active?: boolean;
  period: string;
  onPeriodChange: (value: string) => void;
  selectedMachineId: string;
  onSelectMachine: (value: string) => void;
  formOpen?: boolean;
  onPaymentFormOpenChange?: (open: boolean) => void;
  onCreate: () => void;
  onEdit: (machine: Machine) => void;
  onOvertime: (machine: Machine) => void;
  onCost: (machine: Machine) => void;
  onMonthly: (machine: Machine) => void;
  onMaintenance: (machine: Machine) => void;
}
const leaseLabel = (machine: Machine) =>
  machine.leaseTerms
    ? `${({ monthly: "月租", daily: "日租", hourly: "小时租", shift: "历史台班合同" } as Record<string, string>)[machine.leaseTerms.billingType]} ${machineryMoney(machine.leaseTerms.rate)}`
    : "未配置计价规则";
const machineStatus = (value: string) =>
  (
    ({
      idle: "待命",
      working: "作业中",
      repairing: "维修中",
      offsite: "场外",
      retired: "已退场",
    }) as Record<string, string>
  )[value] ?? "未登记";

/** 数据在当前栏目或详情分区激活时加载；所有写入回调复用宿主原表单。 */
export default function MachineryWorkspace(props: MachineryWorkspaceProps) {
  const {
    projectId,
    active = true,
    period,
    onPeriodChange,
    selectedMachineId,
    onSelectMachine,
    formOpen,
  } = props;
  const [tab, setTab] = useState<MachineryWorkspaceTab>("archives");
  const [detailOpen, setDetailOpen] = useState(false);
  const [workspacePaymentOpen, setWorkspacePaymentOpen] = useState(false);
  const [detailPaymentOpen, setDetailPaymentOpen] = useState(false);
  const anyFormOpen = Boolean(
    formOpen || workspacePaymentOpen || detailPaymentOpen
  );
  useEffect(() => {
    props.onPaymentFormOpenChange?.(workspacePaymentOpen || detailPaymentOpen);
    return () => props.onPaymentFormOpenChange?.(false);
  }, [workspacePaymentOpen, detailPaymentOpen, props.onPaymentFormOpenChange]);
  const [detailTab, setDetailTab] = useState<MachineryDetailTab>("basic");
  const [search, setSearch] = useState("");
  const [ownership, setOwnership] = useState("all");
  const [status, setStatus] = useState("all");
  const [filterMachineId, setFilterMachineId] = useState("all");
  useEffect(() => {
    setDetailOpen(false);
    setFilterMachineId("all");
    setSearch("");
    setOwnership("all");
    setStatus("all");
  }, [projectId]);
  const machines = trpc.machinery.listMachines.useQuery(
    { projectId },
    { enabled: active && Boolean(projectId) }
  );
  const capabilities = trpc.machinery.workspaceCapabilities.useQuery(
    { projectId },
    { enabled: active && Boolean(projectId) }
  );
  const cumulative = trpc.machinery.listCostSummaries.useQuery(
    { projectId },
    {
      enabled:
        active &&
        Boolean(projectId) &&
        (tab === "archives" || (detailOpen && detailTab === "basic")),
    }
  );
  const analysis = trpc.machinery.getMachineAnalysis.useQuery(
    { projectId, machineId: Number(selectedMachineId || 0), period },
    {
      enabled:
        active &&
        Boolean(projectId) &&
        Boolean(selectedMachineId) &&
        detailOpen &&
        ["basic", "maintenance", "settlements"].includes(detailTab) &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
      retry: false,
    }
  );
  const statements = trpc.machinery.listMonthlyStatements.useQuery(
    { projectId, period },
    {
      enabled:
        active &&
        Boolean(projectId) &&
        tab === "settlements" &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
    }
  );
  const maintenance = trpc.admin.assetMaintenance.list.useQuery(undefined, {
    enabled: active && detailOpen && detailTab === "maintenance",
  });
  const utils = trpc.useUtils();
  const transition = trpc.machinery.transitionMonthlyStatement.useMutation({
    onSuccess: async () => {
      toast.success("机械月结状态已更新");
      await Promise.all([
        utils.machinery.listMonthlyStatements.invalidate(),
        utils.machinery.getMachineAnalysis.invalidate(),
      ]);
    },
    onError: error =>
      toast.error(getUserFacingErrorMessage(error, "机械月结操作未完成")),
  });
  const filteredMachines = useMemo(
    () =>
      (machines.data ?? []).filter(machine => {
        const keyword = search.trim().toLowerCase();
        return (
          (!keyword ||
            [
              machine.name,
              machine.code,
              machine.model,
              machine.supplierName,
              machine.plateOrAssetNo,
              machine.driverName,
            ]
              .join(" ")
              .toLowerCase()
              .includes(keyword)) &&
          (ownership === "all" || machine.ownership === ownership) &&
          (status === "all" || machine.status === status)
        );
      }),
    [machines.data, search, ownership, status]
  );
  const pagination = useFinancePagination(
    filteredMachines,
    JSON.stringify([projectId, search, ownership, status])
  );
  const selected = (machines.data ?? []).find(
    machine => String(machine.id) === selectedMachineId
  );
  const summaryById = useMemo(
    () => new Map((cumulative.data ?? []).map(row => [row.machineId, row])),
    [cumulative.data]
  );
  const filteredStatements = filterMachineSettlements(
    statements.data ?? [],
    period,
    filterMachineId
  );
  const statementPagination = useFinancePagination(
    filteredStatements,
    JSON.stringify([projectId, period, filterMachineId])
  );
  const monthlyHeaders = [
    "期间",
    "机械",
    "状态",
    "原产值",
    "工资核对",
    "维修",
    "油料",
    "月结应付",
    "签字",
  ];
  const monthlyExportRows = filteredStatements.map(row => [
    row.period,
    (machines.data ?? []).find(machine => machine.id === row.machineId)?.name ||
      `机械 #${row.machineId}`,
    machineryStatus(row.status),
    row.totalOutput,
    row.driverTotalWage,
    row.repairAmount,
    row.fuelAmount,
    row.machineShareAmount,
    row.signatureName || "",
  ]);
  function printMonthly() {
    openA4LandscapePrintDocument({
      title: "机械月结依据当前筛选",
      bodyHtml: `<h1>机械月结依据当前筛选</h1><p class="sub">项目 #${projectId} · 月 ${escapePrintHtml(period)} · ${filterMachineId === "all" ? "全部机械" : `机械 #${filterMachineId}`} · 共 ${filteredStatements.length} 单</p><table><thead><tr>${monthlyHeaders.map(label => `<th>${escapePrintHtml(label)}</th>`).join("")}</tr></thead><tbody>${monthlyExportRows.map(row => `<tr>${row.map(value => `<td>${escapePrintHtml(value ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table><p>有效月结应付 ${escapePrintHtml(machineryMoney(filteredStatements.filter(row => row.status !== "void").reduce((sum, row) => sum + Number(row.machineShareAmount), 0)))}（作废不计）。此表为原月结依据，不等同于实际付款，不另行建立工资流水。</p>`,
    });
  }

  const archiveHeaders = [
    "机械",
    "编号",
    "型号",
    "资产/车牌",
    "产权",
    "状态",
    "出租方",
    "操作员",
    "司机",
    "老板",
    "合同计价",
    "起租日期",
    "截止日期",
    "累计成本台账金额（不含作废）",
  ];
  const archiveRows = filteredMachines.map(machine => [
    machine.name,
    machine.code,
    machine.model,
    machine.plateOrAssetNo,
    machine.ownership === "leased" ? "外租" : "自有",
    machineStatus(machine.status),
    machine.supplierName,
    machine.operatorName,
    machine.driverName,
    machine.ownerName,
    leaseLabel(machine),
    machine.leaseTerms ? formatChinaDate(machine.leaseTerms.effectiveFrom) : "",
    machine.leaseTerms?.effectiveTo
      ? formatChinaDate(machine.leaseTerms.effectiveTo)
      : "",
    summaryById.get(machine.id)?.totalAmount ?? 0,
  ]);
  function printArchives() {
    openA4LandscapePrintDocument({
      title: "机械档案当前筛选",
      bodyHtml: `<h1>机械档案当前筛选</h1><p class="sub">项目 #${projectId} · 检索 ${escapePrintHtml(search || "全部")} · ${escapePrintHtml(ownership)} · ${escapePrintHtml(status)} · 共 ${filteredMachines.length} 台（不按档案创建日期过滤）</p><table><thead><tr>${archiveHeaders.map(label => `<th>${escapePrintHtml(label)}</th>`).join("")}</tr></thead><tbody>${archiveRows.map(row => `<tr>${row.map(value => `<td>${escapePrintHtml(value ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="sub">累计仅为机械成本台账历史有效费用，不包含租金应付与实际付款，不与维修采购重复合并。</p>`,
    });
  }
  const openDetail = (machine: Machine) => {
    onSelectMachine(String(machine.id));
    setDetailTab("basic");
    setDetailOpen(true);
  };
  const machineId =
    filterMachineId === "all" ? undefined : Number(filterMachineId);
  const maintenanceRows = (maintenance.data ?? []).filter(
    row =>
      row.projectId === projectId &&
      row.assetType === "machine" &&
      row.assetId === Number(selectedMachineId)
  );
  const dailyPagination = useFinancePagination(
    analysis.data?.daily ?? [],
    JSON.stringify([projectId, selectedMachineId, period])
  );
  const partsPagination = useFinancePagination(
    analysis.data?.partsPurchases ?? [],
    JSON.stringify([projectId, selectedMachineId, period])
  );
  const maintenancePagination = useFinancePagination(
    maintenanceRows,
    JSON.stringify([projectId, selectedMachineId])
  );
  const historyPagination = useFinancePagination(
    analysis.data?.monthly ?? [],
    JSON.stringify([projectId, selectedMachineId])
  );
  return (
    <div className="w-full min-w-0 space-y-4">
      <BusinessWorkspaceNavigation
        tabs={MACHINERY_WORKSPACE_TABS}
        value={tab}
        onValueChange={setTab}
        label="机械工作区栏目"
        disabled={!active || anyFormOpen}
      />
      {anyFormOpen ? (
        <p className="text-xs text-amber-700">
          请先保存或关闭当前机械表单；项目和栏目切换暂不可用，防止跨项目误写。
        </p>
      ) : null}
      {tab !== "archives" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-card-foreground">
          <label className="text-sm">
            期间（月）
            <Input
              aria-label="机械工作区期间"
              disabled={anyFormOpen}
              type="month"
              value={period}
              onChange={event => onPeriodChange(event.target.value)}
            />
          </label>
          <label className="min-w-0 flex-1 text-sm">
            机械
            <select
              aria-label="机械工作区筛选机械"
              disabled={anyFormOpen}
              className="mt-1 block min-h-10 w-full max-w-full rounded border bg-background p-2"
              value={filterMachineId}
              onChange={event => {
                setFilterMachineId(event.target.value);
                if (event.target.value !== "all")
                  onSelectMachine(event.target.value);
              }}
            >
              <option value="all">全部机械</option>
              {(machines.data ?? []).map(machine => (
                <option key={machine.id} value={machine.id}>
                  {machine.name} · {machine.code}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <FinanceRetainedPanel
        active={active && tab === "archives"}
        label="机械档案"
      >
        <section className="space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">机械档案</h2>
              <p className="text-xs text-muted-foreground">
                档案不按创建日期筛选；合同、责任人与历史资料完整保留。
              </p>
            </div>
            {capabilities.data?.canCreate ? (
              <Button onClick={props.onCreate}>新建机械档案</Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              aria-label="机械档案检索"
              className="max-w-sm"
              placeholder="名称、编号、型号、出租方或司机"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <select
              aria-label="机械产权筛选"
              className="min-h-10 rounded border bg-background p-2"
              value={ownership}
              onChange={event => setOwnership(event.target.value)}
            >
              <option value="all">全部产权</option>
              <option value="owned">公司自有</option>
              <option value="leased">外租</option>
            </select>
            <select
              aria-label="机械档案状态筛选"
              className="min-h-10 rounded border bg-background p-2"
              value={status}
              onChange={event => setStatus(event.target.value)}
            >
              {[
                "all",
                "idle",
                "working",
                "repairing",
                "offsite",
                "retired",
              ].map(value => (
                <option key={value} value={value}>
                  {value === "all" ? "全部状态" : machineStatus(value)}
                </option>
              ))}
            </select>
            <CurrentFilterPrintActions
              disabled={
                !filteredMachines.length ||
                machines.isFetching ||
                cumulative.isFetching ||
                Boolean(machines.error || cumulative.error)
              }
              onPrint={printArchives}
              onExport={() =>
                downloadMachineryCsv(
                  "机械档案当前筛选.csv",
                  archiveHeaders,
                  archiveRows
                )
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            当前筛选 {filteredMachines.length} 台 ·
            累计费用仅指历史有效机械成本台账，不含租金或付款。
          </p>
          {machines.error ? (
            <p role="alert">
              {getUserFacingErrorMessage(machines.error, "机械档案加载失败")}
            </p>
          ) : machines.isLoading ? (
            <p>正在读取机械档案…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr>
                    {[
                      "机械 / 编号",
                      "型号 / 资产",
                      "责任司机",
                      "产权 / 状态",
                      "合同依据",
                      "累计成本",
                      "操作",
                    ].map(label => (
                      <th key={label} className="p-2 text-left">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageRows.map(machine => (
                    <tr className="border-t" key={machine.id}>
                      <td className="p-2 font-medium">
                        {machine.name}
                        <p className="text-xs text-muted-foreground">
                          {machine.code}
                        </p>
                      </td>
                      <td className="p-2">
                        {machine.model || "未登记"}
                        <p className="text-xs">
                          {machine.plateOrAssetNo || "未登记"}
                        </p>
                      </td>
                      <td className="p-2">
                        {machine.driverName || machine.operatorName || "未绑定"}
                      </td>
                      <td className="p-2">
                        {machine.ownership === "leased" ? "外租" : "自有"}
                        <p className="text-xs">
                          {machineStatus(machine.status)}
                        </p>
                      </td>
                      <td className="p-2">
                        {leaseLabel(machine)}
                        <p className="text-xs text-muted-foreground">
                          {machine.supplierName || "公司自有"}
                        </p>
                      </td>
                      <td className="p-2">
                        {cumulative.isLoading
                          ? "读取中…"
                          : cumulative.error
                            ? "暂不可用"
                            : machineryMoney(
                                summaryById.get(machine.id)?.totalAmount
                              )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openDetail(machine)}
                          >
                            详情
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={`${machine.name}更多操作`}
                              >
                                更多
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {capabilities.data?.canEdit ? (
                                <DropdownMenuItem
                                  onSelect={() => props.onEdit(machine)}
                                >
                                  编辑档案
                                </DropdownMenuItem>
                              ) : null}
                              {capabilities.data?.canCreate ? (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => props.onOvertime(machine)}
                                  >
                                    登记加班
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => props.onCost(machine)}
                                  >
                                    费用录入
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => props.onMonthly(machine)}
                                  >
                                    月度明细
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      props.onMaintenance(machine)
                                    }
                                  >
                                    登记维修保养
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              <DropdownMenuItem
                                onSelect={() => {
                                  onSelectMachine(String(machine.id));
                                  setFilterMachineId(String(machine.id));
                                  setTab("settlements");
                                }}
                              >
                                租金结算
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredMachines.length ? (
                <p className="p-4">当前筛选暂无机械档案。</p>
              ) : null}
            </div>
          )}
          <FinancePagination
            {...pagination}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            label="机械档案"
          />
        </section>
      </FinanceRetainedPanel>
      <FinanceRetainedPanel
        active={active && tab === "overtime"}
        label="司机加班"
      >
        <MachineryOvertimeLedger
          projectId={projectId}
          period={period}
          machineId={machineId}
          active={active && tab === "overtime"}
          onCreate={selected ? () => props.onOvertime(selected) : undefined}
        />
      </FinanceRetainedPanel>
      <FinanceRetainedPanel active={active && tab === "costs"} label="费用统计">
        <MachineryCostWorkspace
          projectId={projectId}
          period={period}
          machineId={machineId}
          active={active && tab === "costs"}
          onCreate={selected ? () => props.onCost(selected) : undefined}
        />
      </FinanceRetainedPanel>
      <FinanceRetainedPanel
        active={active && tab === "settlements"}
        label="租金结算"
      >
        <section className="space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">月结依据与租金结算</h2>
            <CurrentFilterPrintActions
              disabled={
                !filteredStatements.length ||
                statements.isFetching ||
                Boolean(statements.error)
              }
              onPrint={printMonthly}
              onExport={() =>
                downloadMachineryCsv(
                  "机械月结依据当前筛选.csv",
                  monthlyHeaders,
                  monthlyExportRows
                )
              }
            />
            {selected && capabilities.data?.canCreate ? (
              <Button onClick={() => props.onMonthly(selected)}>
                生成月度明细
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            月 · {period} ·
            原会计快照。司机工资仅留作月结核对，不创建第二份工资流水；审核后生成付款结算并上传凭证分笔付款。
          </p>
          {statements.error ? (
            <p role="alert">
              {getUserFacingErrorMessage(statements.error, "月结依据加载失败")}
            </p>
          ) : statements.isLoading ? (
            <p>正在读取月结依据…</p>
          ) : (
            statementPagination.pageRows.map(row => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
              >
                <div>
                  <p>
                    {(machines.data ?? []).find(
                      machine => machine.id === row.machineId
                    )?.name || `机械 #${row.machineId}`}{" "}
                    · {row.period} · {machineryStatus(row.status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    月结应付 {machineryMoney(row.machineShareAmount)} · 原产值{" "}
                    {machineryMoney(row.totalOutput)} · 工资核对{" "}
                    {machineryMoney(row.driverTotalWage)} · 油料/维修{" "}
                    {machineryMoney(row.fuelAmount)} /{" "}
                    {machineryMoney(row.repairAmount)} · 签字{" "}
                    {row.signatureName || "未签"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {row.status === "draft" && capabilities.data?.canManage ? (
                    <Button
                      size="sm"
                      disabled={transition.isPending}
                      onClick={() =>
                        transition.mutate({
                          id: row.id,
                          projectId,
                          nextStatus: "submitted",
                        })
                      }
                    >
                      提交会计审核
                    </Button>
                  ) : null}
                  {row.status === "submitted" &&
                  capabilities.data?.canApprove ? (
                    <Button
                      size="sm"
                      disabled={transition.isPending}
                      onClick={() =>
                        transition.mutate({
                          id: row.id,
                          projectId,
                          nextStatus: "approved",
                        })
                      }
                    >
                      会计审核
                    </Button>
                  ) : null}
                  {["draft", "submitted", "approved"].includes(row.status) &&
                  capabilities.data?.canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={transition.isPending}
                      onClick={() => {
                        if (window.confirm("确认作废此月结依据？"))
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
              </div>
            ))
          )}
          {!statements.isLoading && !filteredStatements.length ? (
            <p>当前期间和机械筛选暂无月结依据。</p>
          ) : null}
          <FinancePagination
            {...statementPagination}
            onPageChange={statementPagination.setPage}
            onPageSizeChange={statementPagination.setPageSize}
            label="机械月结依据"
          />
        </section>
        <MachinePaymentSettlementManager
          projectId={projectId}
          active={active && tab === "settlements"}
          filter={{ period, machineId }}
          onFormOpenChange={setWorkspacePaymentOpen}
        />
      </FinanceRetainedPanel>
      <Dialog
        open={detailOpen}
        onOpenChange={open => {
          if (!open && anyFormOpen) {
            toast.warning("请先保存或关闭当前机械表单");
            return;
          }
          setDetailOpen(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{selected?.name || "机械"} · 机械业务详情</DialogTitle>
          </DialogHeader>
          <BusinessWorkspaceNavigation
            tabs={MACHINERY_DETAIL_TABS}
            value={detailTab}
            onValueChange={setDetailTab}
            label="机械详情分区"
            disabled={anyFormOpen}
          />
          {selected ? (
            <>
              <FinanceRetainedPanel
                active={detailTab === "basic"}
                label="机械基本资料"
              >
                <div className="grid gap-3 rounded-xl bg-muted p-3 text-sm sm:grid-cols-2">
                  <p>
                    编号：{selected.code} · 型号：{selected.model || "未登记"}
                  </p>
                  <p>资产/车牌：{selected.plateOrAssetNo || "未登记"}</p>
                  <p>
                    驾驶员：{selected.driverName || "未登记"} ·{" "}
                    {selected.driverPhone || "未登记手机"}
                  </p>
                  <p>
                    操作员：{selected.operatorName || "未绑定"} · 老板：
                    {selected.ownerName || "未绑定"}
                  </p>
                  <p>
                    产权/出租方：
                    {selected.ownership === "leased" ? "外租" : "自有"} ·{" "}
                    {selected.supplierName || "—"}
                  </p>
                  <p>
                    状态：{machineStatus(selected.status)} · 油箱：
                    {selected.fuelTankCapacityLiters || "未登记"} L
                  </p>
                  <p>合同：{leaseLabel(selected)}</p>
                  <p>
                    有效期：
                    {selected.leaseTerms
                      ? formatChinaDate(selected.leaseTerms.effectiveFrom)
                      : "—"}{" "}
                    至{" "}
                    {selected.leaseTerms?.effectiveTo
                      ? formatChinaDate(selected.leaseTerms.effectiveTo)
                      : "长期"}
                  </p>
                  <p>
                    累计机械成本台账：
                    {machineryMoney(summaryById.get(selected.id)?.totalAmount)}
                    （排除作废）
                  </p>
                  <p>
                    合同月租：
                    {analysis.data?.rental?.monthlyRate == null
                      ? "—"
                      : machineryMoney(analysis.data.rental.monthlyRate)}{" "}
                    · 日租费用：
                    {analysis.data?.rental?.dailyRate == null
                      ? "—"
                      : `${machineryMoney(analysis.data.rental.dailyRate)} / 天`}
                    （月租按自然日折算，仅供查看）
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {MACHINERY_COST_SCOPE_NOTE}
                </p>
                <label className="mt-3 block text-sm">
                  单机日费用凭证月份
                  <Input
                    aria-label="单机日费用凭证月份"
                    disabled={anyFormOpen}
                    type="month"
                    value={period}
                    onChange={event => onPeriodChange(event.target.value)}
                  />
                </label>
                {analysis.error ? (
                  <p role="alert">
                    {getUserFacingErrorMessage(
                      analysis.error,
                      "单机费用分析暂不可用"
                    )}
                  </p>
                ) : analysis.isLoading ? (
                  <p>正在读取历史日凭证…</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[950px] text-xs">
                      <thead>
                        <tr>
                          {[
                            "日期 / 历史记录",
                            "司机加班",
                            "历史产值/工资",
                            "油料",
                            "维修/保养",
                            "配件/其他",
                            "原日净额",
                            "状态 / 备注",
                          ].map(label => (
                            <th className="p-2 text-left" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dailyPagination.pageRows.map(row => (
                          <tr key={row.date} className="border-t">
                            <td className="p-2">
                              {row.date}
                              {row.shiftCount > 0 ? (
                                <p>
                                  历史合同作业 {row.shiftCount}（只读保留） ·
                                  历史单价 {machineryMoney(row.shiftRate)}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-2">
                              {row.overtimeHours} 小时 ·{" "}
                              {machineryMoney(row.overtimeAmount)}
                              <p>{row.driverName || "未登记"}</p>
                            </td>
                            <td className="p-2">
                              {machineryMoney(row.outputAmount)} /{" "}
                              {machineryMoney(row.driverWageAmount)}
                            </td>
                            <td className="p-2">
                              {row.fuelLiters} L ·{" "}
                              {machineryMoney(row.fuelAmount)}
                            </td>
                            <td className="p-2">
                              {machineryMoney(row.repairAmount)} /{" "}
                              {machineryMoney(row.maintenanceAmount)}
                            </td>
                            <td className="p-2">
                              {machineryMoney(row.partsAmount)} /{" "}
                              {machineryMoney(row.otherExpenseAmount)}
                            </td>
                            <td className="p-2">
                              {machineryMoney(row.netIncome)}
                            </td>
                            <td className="p-2">
                              {row.operationStatus
                                ? machineryStatus(row.operationStatus)
                                : "仅费用凭证"}
                              <p>{row.remarks || "—"}</p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <FinancePagination
                  {...dailyPagination}
                  onPageChange={dailyPagination.setPage}
                  onPageSizeChange={dailyPagination.setPageSize}
                  label="单机日费用凭证"
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={detailTab === "overtime"}
                label="单机加班"
              >
                <MachineryOvertimeLedger
                  projectId={projectId}
                  period={period}
                  machineId={selected.id}
                  active={active && detailOpen && detailTab === "overtime"}
                  onCreate={() => props.onOvertime(selected)}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={detailTab === "costs"}
                label="单机费用"
              >
                <MachineryCostWorkspace
                  projectId={projectId}
                  period={period}
                  machineId={selected.id}
                  active={active && detailOpen && detailTab === "costs"}
                  onCreate={() => props.onCost(selected)}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={detailTab === "maintenance"}
                label="单机维保采购"
              >
                <section className="space-y-3 text-sm">
                  <h3 className="font-semibold">维保采购 · 月 {period}</h3>
                  <p className="text-xs text-muted-foreground">
                    关联配件采购明细来自原订单；订单关闭不等于已付清。外租付款结算会扣除尚未扣款的已符合结算条件配件费用，禁止手工再加一次。
                  </p>
                  {analysis.isLoading || maintenance.isLoading ? (
                    <p>正在读取维保采购…</p>
                  ) : null}
                  {analysis.error || maintenance.error ? (
                    <p role="alert">暂无法读取维保采购，请重试。</p>
                  ) : null}
                  {partsPagination.pageRows.map(row => (
                    <div key={row.id} className="rounded border p-3">
                      <p>
                        {row.itemDescription} · {machineryMoney(row.amount)}
                      </p>
                      <p className="text-xs">
                        {row.orderNo} · {formatChinaDate(row.orderedAt)} ·{" "}
                        {row.hasInvoice ? "有发票" : "无发票"} ·
                        订单关闭（非付款证明）
                      </p>
                    </div>
                  ))}
                  <FinancePagination
                    {...partsPagination}
                    onPageChange={partsPagination.setPage}
                    onPageSizeChange={partsPagination.setPageSize}
                    label="单机配件采购"
                  />
                  <h3 className="font-semibold">
                    维修保养明细 · 累计档案（作废仅审计）
                  </h3>
                  {capabilities.data?.canCreate ? (
                    <Button
                      variant="outline"
                      onClick={() => props.onMaintenance(selected)}
                    >
                      登记维修保养
                    </Button>
                  ) : null}
                  {maintenancePagination.pageRows.map(row => (
                    <div className="rounded border p-3" key={row.id}>
                      {formatChinaDate(row.occurredAt)} ·{" "}
                      {row.costCategory === "repair" ? "维修" : "保养"} ·{" "}
                      {row.serviceProvider || "未登记服务单位"} ·{" "}
                      {machineryMoney(row.amount)} ·{" "}
                      {machineryStatus(row.status)}
                    </div>
                  ))}
                  <FinancePagination
                    {...maintenancePagination}
                    onPageChange={maintenancePagination.setPage}
                    onPageSizeChange={maintenancePagination.setPageSize}
                    label="单机维修保养"
                  />
                </section>
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={detailTab === "settlements"}
                label="单机结算"
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  月结历史快照（不重算）
                </p>
                {historyPagination.pageRows.map(row => (
                  <div key={row.id} className="mb-2 rounded border p-3 text-sm">
                    {row.period} · {machineryStatus(row.status)} · 月结应付{" "}
                    {machineryMoney(row.machineShareAmount)} · 签字{" "}
                    {row.signatureName || "未签"}
                  </div>
                ))}
                <FinancePagination
                  {...historyPagination}
                  onPageChange={historyPagination.setPage}
                  onPageSizeChange={historyPagination.setPageSize}
                  label="单机历史月结"
                />
                <label className="block text-sm">
                  单机付款期间
                  <Input
                    type="month"
                    aria-label="单机付款期间"
                    value={period}
                    disabled={anyFormOpen}
                    onChange={event => onPeriodChange(event.target.value)}
                  />
                </label>
                <MachinePaymentSettlementManager
                  projectId={projectId}
                  active={active && detailOpen && detailTab === "settlements"}
                  filter={{ machineId: selected.id, period }}
                  onFormOpenChange={setDetailPaymentOpen}
                />
              </FinanceRetainedPanel>
            </>
          ) : (
            <p>请先选择机械。</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {selected && capabilities.data?.canEdit ? (
              <Button variant="outline" onClick={() => props.onEdit(selected)}>
                编辑档案
              </Button>
            ) : null}
            <Button disabled={anyFormOpen} onClick={() => setDetailOpen(false)}>
              关闭详情
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
