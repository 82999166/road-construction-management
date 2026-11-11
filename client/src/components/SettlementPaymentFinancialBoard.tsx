import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { SettlementPaymentVoucherBatchDialog } from "@/components/SettlementPaymentVoucherBatchDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatChinaDateTime,
  toChinaDateInput,
  toChinaMonthInput,
} from "@/lib/businessTime";
import { downloadSettlementPaymentWorkbook } from "@/lib/settlementPaymentExport";
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  BarChart3,
  CircleDollarSign,
  FileSpreadsheet,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildSettlementPaymentWorkbook,
  directionLabel,
  lifecycleLabel,
  money,
  paymentMethodLabel,
  paymentRecordNavigationRow,
  reconciliationLabel,
  settlementPaymentBoardRows,
  outstandingSettlementRows,
  settlementPaymentQueryPlan,
  sourceTypeLabel,
  validPeriod,
  type SettlementPaymentNavigationRow,
  type SettlementPaymentSourceType,
  type SettlementPaymentView,
} from "./SettlementPaymentFinancialBoard.helpers";

export type {
  SettlementPaymentNavigationRow,
  SettlementPaymentView,
} from "./SettlementPaymentFinancialBoard.helpers";
export interface SettlementPaymentFinancialBoardProps {
  projectId: number;
  projectLabel?: string;
  view?: SettlementPaymentView;
  enabled?: boolean;
  period?: string;
  onPeriodChange?: (period: string) => void;
  /** 父级按原模块权限导航；此组件绝不登记付款、修改凭证或替父级扩大权限。 */
  onNavigateToSettlement?: (row: SettlementPaymentNavigationRow) => void;
}

/**
 * 只消费服务端按财务权限、项目范围重算后的余额；浏览器不累计主单或资金流水。
 * 月度对账是内部付款台账对账，不声称已与银行账单自动核对。
 * all 保留原独立入口；受控 view 切换不卸载共享筛选。
 */
export default function SettlementPaymentFinancialBoard({
  projectId,
  projectLabel,
  view = "all",
  enabled = true,
  period: controlledPeriod,
  onPeriodChange,
  onNavigateToSettlement,
}: SettlementPaymentFinancialBoardProps) {
  const [sourceType, setSourceType] = useState<
    "all" | SettlementPaymentSourceType
  >("all");
  const [direction, setDirection] = useState<"all" | "expense" | "income">(
    "all"
  );
  const [lifecycle, setLifecycle] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => toChinaDateInput());
  const [localPeriod, setLocalPeriod] = useState(() => toChinaMonthInput());
  const period = controlledPeriod ?? localPeriod;
  const setPeriod = (nextPeriod: string) => {
    if (controlledPeriod === undefined) setLocalPeriod(nextPeriod);
    onPeriodChange?.(nextPeriod);
  };
  const [paymentStatus, setPaymentStatus] = useState<
    "active" | "reversed" | "all"
  >("active");
  const [paymentMethod, setPaymentMethod] =
    useState<keyof typeof paymentMethodLabel>("all");
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const outstandingView = view === "payable" || view === "receivable";
  const effectiveDirection = outstandingView
    ? view === "payable"
      ? "expense"
      : "income"
    : direction;
  const showBoard = view === "all" || view === "board" || outstandingView;
  const showMonthly = ["all", "records", "reconciliation"].includes(view);
  const showRecords = view === "all" || view === "records";
  const queryPlan = settlementPaymentQueryPlan(
    view,
    enabled,
    projectId,
    period,
    asOfDate
  );
  const boardInput = useMemo(
    () => ({
      projectId,
      asOfDate,
      sourceTypes: sourceType === "all" ? undefined : [sourceType],
      direction: effectiveDirection,
      lifecycle: (outstandingView ? "all" : lifecycle) as
        | "all"
        | "approval_pending"
        | "ready"
        | "partial"
        | "completed"
        | "void",
      keyword,
    }),
    [
      projectId,
      asOfDate,
      sourceType,
      effectiveDirection,
      lifecycle,
      keyword,
      outstandingView,
    ]
  );
  const reconciliationInput = useMemo(
    () => ({
      projectId,
      period,
      sourceTypes: sourceType === "all" ? undefined : [sourceType],
      direction,
      status: paymentStatus,
      paymentMethod,
      keyword,
    }),
    [
      projectId,
      period,
      sourceType,
      direction,
      paymentStatus,
      paymentMethod,
      keyword,
    ]
  );
  const board = trpc.settlementPayment.board.useQuery(boardInput, {
    enabled: queryPlan.board,
    retry: false,
  });
  const reconciliation = trpc.settlementPayment.monthlyReconciliation.useQuery(
    reconciliationInput,
    { enabled: queryPlan.monthly, retry: false }
  );
  const boardData = queryPlan.board && !board.isError ? board.data : undefined;
  const monthlyData =
    queryPlan.monthly && !reconciliation.isError
      ? reconciliation.data
      : undefined;
  const boardRows = useMemo(
    () =>
      outstandingSettlementRows(
        settlementPaymentBoardRows(boardData?.rows ?? []),
        view
      ),
    [boardData?.rows, view]
  );
  const paymentRecords = useMemo(
    () => monthlyData?.records ?? [],
    [monthlyData?.records]
  );
  const voucherRecords = useMemo(
    () =>
      paymentRecords.map(record => ({
        ...record,
        proof: record.proof
          ? {
              ...record.proof,
              fileName: record.proof.fileName ?? "未命名凭证",
              mimeType: record.proof.mimeType ?? "",
            }
          : null,
      })),
    [paymentRecords]
  );
  const boardPagination = useFinancePagination(
    boardRows,
    JSON.stringify(boardInput)
  );
  const recordsPagination = useFinancePagination(
    paymentRecords,
    JSON.stringify(reconciliationInput)
  );
  const projectText = projectLabel || `项目 #${projectId}`;
  const sharedScope = `${sourceTypeLabel[sourceType]} · ${directionLabel(effectiveDirection)} · ${keyword.trim() || "全部关键词"}`;
  const canUseMonthlyActions =
    queryPlan.monthly &&
    !reconciliation.isFetching &&
    !reconciliation.isError &&
    Boolean(monthlyData);
  const validVoucherCount = paymentRecords.filter(
    record => record.status === "active"
  ).length;

  // 项目、月份、共享筛选或当前视图变更后不保留旧范围打印弹窗。
  useEffect(() => {
    setVoucherOpen(false);
  }, [
    projectId,
    period,
    sourceType,
    direction,
    keyword,
    paymentStatus,
    paymentMethod,
    view,
    enabled,
  ]);

  const exportWorkbook = async () => {
    if (!canUseMonthlyActions || !monthlyData || exporting) return;
    setExporting(true);
    try {
      await downloadSettlementPaymentWorkbook(
        buildSettlementPaymentWorkbook(monthlyData, projectText)
      );
      toast.success("月度内部对账单已导出，未包含完整账户和支付参考号");
    } catch {
      toast.error("月度对账单导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  };
  const boardMoney = (value: unknown) => (boardData ? money(value) : "—");
  const monthlyMoney = (value: unknown) => (monthlyData ? money(value) : "—");

  return (
    <div className="space-y-4">
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">当前筛选范围</CardTitle>
          <CardDescription>
            {projectText} · {sharedScope}
            。审核、付款与补款分开办理；待收付只展示已审核且尚有余额的单据。结算类型和关键词在资金视图间保留，实际付款日期与业务期间分别核对。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>结算类型</Label>
              <Select
                value={sourceType}
                onValueChange={value =>
                  setSourceType(value as typeof sourceType)
                }
              >
                <SelectTrigger className="mt-1 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(sourceTypeLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>收付方向</Label>
              <Select
                disabled={outstandingView}
                value={effectiveDirection}
                onValueChange={value => setDirection(value as typeof direction)}
              >
                <SelectTrigger className="mt-1 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部收付</SelectItem>
                  <SelectItem value="expense">支出付款</SelectItem>
                  <SelectItem value="income">收入补款</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>结算单号 / 对方 / 业务归属 / 凭证编号</Label>
              <Input
                className="mt-1 bg-white"
                value={keyword}
                maxLength={128}
                onChange={event => setKeyword(event.target.value)}
                placeholder="按结算单、人员、车辆/包件等查询"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {showBoard && (
        <Card className="border-[#cfddd8] shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-[#467067]">
                  <CircleDollarSign className="h-4 w-4" />
                  资金结算工作台
                </p>
                <CardTitle className="mt-1 text-base">
                  {view === "payable"
                    ? "待付款办理"
                    : view === "receivable"
                      ? "待收补款办理"
                      : "待付款 / 待收补款财务看板"}
                </CardTitle>
                <CardDescription className="mt-1">
                  余额由服务端按有效实际收付与抵扣重算。待审请到“审核中心”办理；登记付款仅记录已发生的真实转账，不自动扣款。
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="border-[#9fc9b5] bg-[#f4fbf7] text-[#236848]"
              >
                截至 {boardData?.asOfDate ?? asOfDate}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className={`grid gap-3 md:grid-cols-2 ${outstandingView ? "" : "xl:grid-cols-4"}`}
            >
              {view !== "receivable" && (
                <Metric
                  icon={<WalletCards className="h-4 w-4" />}
                  label="待付款"
                  value={boardMoney(boardData?.summary.payable.amount)}
                  sub={`${boardData?.summary.payable.count ?? "—"} 笔已审核待付/部分付款`}
                  tone="amber"
                />
              )}
              {view !== "payable" && (
                <Metric
                  icon={<ReceiptText className="h-4 w-4" />}
                  label="待收补款"
                  value={boardMoney(boardData?.summary.receivable.amount)}
                  sub={`${boardData?.summary.receivable.count ?? "—"} 笔车辆扣款待收`}
                  tone="blue"
                />
              )}
              <Metric
                icon={<BarChart3 className="h-4 w-4" />}
                label="部分结清"
                value={boardMoney(boardData?.summary.partial.amount)}
                sub={`${boardData?.summary.partial.count ?? "—"} 笔仍有余额`}
                tone="teal"
              />
              {!outstandingView && (
                <Metric
                  icon={<ReceiptText className="h-4 w-4" />}
                  label="待审核"
                  value={boardMoney(boardData?.summary.approvalPending.amount)}
                  sub={`${boardData?.summary.approvalPending.count ?? "—"} 笔不纳入待付款`}
                  tone="slate"
                />
              )}
            </div>
            <div className="grid gap-3 rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3 md:grid-cols-2 xl:grid-cols-[200px_200px_minmax(0,1fr)]">
              <div>
                <Label>余额截至日（北京时间）</Label>
                <Input
                  className="mt-1 bg-white"
                  type="date"
                  value={asOfDate}
                  onChange={event => setAsOfDate(event.target.value)}
                />
              </div>
              <div>
                <Label>结算状态（仅看板）</Label>
                <Select
                  disabled={outstandingView}
                  value={outstandingView ? "ready" : lifecycle}
                  onValueChange={setLifecycle}
                >
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(lifecycleLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs leading-6 text-slate-600 md:col-span-2 xl:col-span-1">
                当前看板：截至 {asOfDate || "未选择"} ·{" "}
                {outstandingView
                  ? "已审核未结清（含部分收付）"
                  : lifecycleLabel[lifecycle]}{" "}
                · {sharedScope}
                。截至日只影响实际收付与抵扣口径，结算单业务状态仍为当前状态；不按付款月份筛选。
              </p>
            </div>
            {board.isError && queryPlan.board && (
              <QueryError
                message={board.error?.message ?? "结算余额读取失败"}
                onRetry={() => void board.refetch()}
              />
            )}
            <div className="overflow-x-auto rounded-xl border border-[#dbe4e1]">
              <Table className="min-w-[1120px] text-xs">
                <TableHeader className="bg-[#edf4f1]">
                  <TableRow>
                    <TableHead>结算类型 / 单号</TableHead>
                    <TableHead>业务对象 / 归属</TableHead>
                    <TableHead>方向 / 业务状态</TableHead>
                    <TableHead className="text-right">应收付</TableHead>
                    <TableHead className="text-right">已收付</TableHead>
                    <TableHead className="text-right">抵扣</TableHead>
                    <TableHead className="text-right">待结余额</TableHead>
                    <TableHead>处理提示 / 结算入口</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.isLoading && queryPlan.board ? (
                    <EmptyRow columns={8}>正在按项目范围计算结算余额…</EmptyRow>
                  ) : boardPagination.pageRows.length ? (
                    boardPagination.pageRows.map(row => (
                      <TableRow key={`${row.sourceType}-${row.settlementId}`}>
                        <TableCell>
                          <b>{row.sourceLabel}</b>
                          <p className="mt-1 text-slate-500">
                            {row.settlementNo}
                          </p>
                        </TableCell>
                        <TableCell>
                          {row.counterpartyDisplay}
                          <p className="mt-1 text-slate-500">
                            {row.periodLabel}
                          </p>
                        </TableCell>
                        <TableCell>
                          <DirectionBadge direction={row.direction} />
                          <p className="mt-1 text-slate-500">
                            {lifecycleLabel[row.lifecycle] ?? row.lifecycle}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.originalAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {money(row.paidOrRecoveredAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sky-700">
                          {money(row.offsetAmount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-amber-800">
                          {money(row.remainingAmount)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            {row.legacyFinalized ? (
                              <p className="text-slate-500">
                                历史已结清（无新凭证明细）
                              </p>
                            ) : row.canRegisterSettlementPayment ? (
                              <p className="text-[#236848]">
                                请在对应结算台账登记分笔付款凭证
                              </p>
                            ) : (
                              <p className="text-slate-500">
                                按原结算单状态与权限办理
                              </p>
                            )}
                            {onNavigateToSettlement && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!enabled || board.isFetching}
                                onClick={() =>
                                  onNavigateToSettlement({
                                    projectId,
                                    sourceType: row.sourceType,
                                    settlementId: row.settlementId,
                                    settlementNo: row.settlementNo,
                                    periodLabel: row.periodLabel,
                                    direction: row.direction,
                                    canRegisterSettlementPayment:
                                      row.canRegisterSettlementPayment,
                                  })
                                }
                              >
                                {row.canRegisterSettlementPayment
                                  ? outstandingView
                                    ? row.direction === "income"
                                      ? "登记补款"
                                      : "登记付款"
                                    : "进入结算台账"
                                  : "只读查看结算"}
                                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <EmptyRow columns={8}>
                      {!queryPlan.board
                        ? "请启用当前视图并选择有效截至日。"
                        : board.isError
                          ? "读取失败，未显示旧范围记录。"
                          : "当前筛选无结算记录。"}
                    </EmptyRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <FinancePagination
              page={boardPagination.page}
              pageSize={boardPagination.pageSize}
              total={boardPagination.total}
              onPageChange={boardPagination.setPage}
              onPageSizeChange={boardPagination.setPageSize}
              label="结算记录"
            />
            <p className="text-xs text-slate-500">
              摘要覆盖当前筛选全部结算记录，不受表格分页影响；进入结算台账仅导航，不会登记或修改实际付款。
            </p>
          </CardContent>
        </Card>
      )}

      {showMonthly && (
        <Card className="border-[#d6dfe9] shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-[#48657f]">
                  <FileSpreadsheet className="h-4 w-4" />
                  月度付款台账
                </p>
                <CardTitle className="mt-1 text-base">
                  {view === "records"
                    ? "真实付款记录与凭证"
                    : "付款凭证批打与月度内部对账"}
                </CardTitle>
                <CardDescription className="mt-1">
                  以实际付款日期归属会计月份；有效记录与资金流水逐笔校验。该报表是系统内部付款台账对账，不替代银行流水导入与银行对账。
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#b9cedf] bg-white text-[#284d6a]"
                  disabled={!canUseMonthlyActions || !validVoucherCount}
                  onClick={() => setVoucherOpen(true)}
                >
                  <ReceiptText className="mr-1.5 h-4 w-4" />
                  批量打印凭证
                </Button>
                <Button
                  size="sm"
                  className="bg-[#284d6a] text-white hover:bg-[#1d3e58]"
                  disabled={
                    !canUseMonthlyActions || !paymentRecords.length || exporting
                  }
                  onClick={() => void exportWorkbook()}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  {exporting ? "正在导出…" : "导出月度对账单"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 rounded-xl border border-[#d6dfe9] bg-[#f7fafc] p-3 md:grid-cols-3">
              <div>
                <Label>付款月份（北京时间）</Label>
                <Input
                  className="mt-1 bg-white"
                  type="month"
                  value={period}
                  onChange={event => setPeriod(event.target.value)}
                />
              </div>
              <div>
                <Label>付款状态（仅月度记录）</Label>
                <Select
                  value={paymentStatus}
                  onValueChange={value =>
                    setPaymentStatus(value as typeof paymentStatus)
                  }
                >
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">有效</SelectItem>
                    <SelectItem value="reversed">已冲正</SelectItem>
                    <SelectItem value="all">全部</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>付款方式（仅月度记录）</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={value =>
                    setPaymentMethod(value as typeof paymentMethod)
                  }
                >
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(paymentMethodLabel).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs leading-6 text-slate-600 md:col-span-3">
                当前月度范围：实际付款日期落在 {period || "未选择月份"} ·{" "}
                {paymentStatus === "active"
                  ? "有效"
                  : paymentStatus === "reversed"
                    ? "已冲正"
                    : "全部状态"}{" "}
                · {paymentMethodLabel[paymentMethod]} · {sharedScope}
                。不按业务结算期间替代付款月份；不受看板截至日及结算状态影响。
              </p>
            </div>
            {!validPeriod(period) && (
              <p role="alert" className="text-sm text-amber-700">
                请选择有效付款月份（YYYY-MM）。
              </p>
            )}
            {reconciliation.isError && queryPlan.monthly && (
              <QueryError
                message={
                  reconciliation.error?.message ?? "月度付款记录读取失败"
                }
                onRetry={() => void reconciliation.refetch()}
              />
            )}
            {reconciliation.isLoading && queryPlan.monthly && (
              <p role="status" className="py-2 text-sm text-slate-500">
                正在读取本月真实付款记录与内部对账摘要…
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={<WalletCards className="h-4 w-4" />}
                label="有效支出"
                value={monthlyMoney(monthlyData?.summary.activeExpenseAmount)}
                sub="按实际付款日落月"
                tone="amber"
              />
              <Metric
                icon={<CircleDollarSign className="h-4 w-4" />}
                label="有效补款收入"
                value={monthlyMoney(monthlyData?.summary.activeIncomeAmount)}
                sub="不与支出相抵"
                tone="blue"
              />
              <Metric
                icon={<ReceiptText className="h-4 w-4" />}
                label="已冲正金额"
                value={monthlyMoney(monthlyData?.summary.reversedAmount)}
                sub="不计入有效实收付"
                tone="slate"
              />
              <Metric
                icon={<BarChart3 className="h-4 w-4" />}
                label="待核对记录"
                value={
                  monthlyData
                    ? String(
                        monthlyData.summary.matching.missing +
                          monthlyData.summary.matching.inconsistent
                      )
                    : "—"
                }
                sub={`已匹配 ${monthlyData?.summary.matching.matched ?? "—"} 笔`}
                tone="teal"
              />
            </div>
            <p className="text-xs text-slate-500">
              完整下载：付款台账月度内部对账单（非银行账单自动对账），含汇总说明、月度汇总及付款明细。
            </p>
            <p className="text-xs text-slate-500">
              当前筛选共 {paymentRecords.length} 笔真实付款记录，可批打{" "}
              {validVoucherCount} 笔有效凭证。摘要、Excel
              完整下载及有效凭证批打均覆盖当前筛选全部记录，不受分页影响。
              {monthlyData &&
                `数据生成：${formatChinaDateTime(monthlyData.meta.generatedAt)}`}
            </p>
            {showRecords && (
              <>
                <div className="overflow-x-auto rounded-xl border border-[#d6dfe9]">
                  <Table className="min-w-[1240px] text-xs">
                    <TableHeader className="bg-[#edf3f8]">
                      <TableRow>
                        <TableHead>凭证 / 结算单号</TableHead>
                        <TableHead>结算类型 / 业务归属</TableHead>
                        <TableHead>付款日期 / 方式</TableHead>
                        <TableHead>方向 / 状态</TableHead>
                        <TableHead className="text-right">本次金额</TableHead>
                        <TableHead>收款人 / 经办人</TableHead>
                        <TableHead>原始凭证 / 摘要</TableHead>
                        <TableHead>资金流水核对</TableHead>
                        {onNavigateToSettlement && (
                          <TableHead>结算入口</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciliation.isLoading && queryPlan.monthly ? (
                        <EmptyRow columns={onNavigateToSettlement ? 9 : 8}>
                          正在读取真实付款记录…
                        </EmptyRow>
                      ) : recordsPagination.pageRows.length ? (
                        recordsPagination.pageRows.map(record => (
                          <TableRow key={record.id}>
                            <TableCell>
                              <b>{record.voucherNo}</b>
                              <p className="mt-1 text-slate-500">
                                {record.settlementNo}
                              </p>
                            </TableCell>
                            <TableCell>
                              {record.settlementTypeLabel}
                              <p className="mt-1 text-slate-500">
                                {record.periodLabel}
                              </p>
                            </TableCell>
                            <TableCell>
                              {record.paymentDate}
                              <p className="mt-1 text-slate-500">
                                {record.paymentMethodLabel}
                              </p>
                            </TableCell>
                            <TableCell>
                              <DirectionBadge direction={record.direction} />
                              <p
                                className={`mt-1 ${record.status === "active" ? "text-emerald-700" : "text-slate-500"}`}
                              >
                                {record.status === "active" ? "有效" : "已冲正"}
                              </p>
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {money(record.amount)}
                            </TableCell>
                            <TableCell>
                              {record.payeeName}
                              <p className="mt-1 text-slate-500">
                                经办：{record.operatorName}
                              </p>
                            </TableCell>
                            <TableCell>
                              {record.proof?.fileName ?? "未关联"}
                              <p className="mt-1 text-slate-500">
                                {record.proof?.sha256Prefix ?? "—"}
                              </p>
                            </TableCell>
                            <TableCell>
                              {reconciliationLabel[record.reconciliationStatus]}
                            </TableCell>
                            {onNavigateToSettlement && (
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !enabled || reconciliation.isFetching
                                  }
                                  onClick={() =>
                                    onNavigateToSettlement(
                                      paymentRecordNavigationRow(
                                        projectId,
                                        record
                                      )
                                    )
                                  }
                                >
                                  查看结算台账
                                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                                </Button>
                                <p className="mt-1 text-slate-500">
                                  仅导航，按原权限办理
                                </p>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      ) : (
                        <EmptyRow columns={onNavigateToSettlement ? 9 : 8}>
                          {reconciliation.isError
                            ? "读取失败，未显示旧范围记录。"
                            : "当前付款月份与筛选无真实付款记录。"}
                        </EmptyRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <FinancePagination
                  page={recordsPagination.page}
                  pageSize={recordsPagination.pageSize}
                  total={recordsPagination.total}
                  onPageChange={recordsPagination.setPage}
                  onPageSizeChange={recordsPagination.setPageSize}
                  label="真实付款记录"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <SettlementPaymentVoucherBatchDialog
        open={voucherOpen && canUseMonthlyActions}
        onOpenChange={setVoucherOpen}
        records={voucherRecords}
        projectLabel={projectText}
        period={monthlyData?.meta.period ?? period}
      />
    </div>
  );
}

function DirectionBadge({ direction }: { direction: "expense" | "income" }) {
  return (
    <Badge
      variant="outline"
      className={
        direction === "income"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }
    >
      {directionLabel(direction)}
    </Badge>
  );
}
function EmptyRow({
  columns,
  children,
}: {
  columns: number;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="py-8 text-center text-slate-500">
        {children}
      </TableCell>
    </TableRow>
  );
}
function QueryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重新读取
      </Button>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "amber" | "blue" | "teal" | "slate";
}) {
  const palette = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    teal: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-slate-50 text-slate-900",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${palette}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs opacity-70">{sub}</p>
    </div>
  );
}
