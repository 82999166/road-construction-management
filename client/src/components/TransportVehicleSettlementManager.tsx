import {
  discardTransportDraft,
  useTransportDirty,
  type TransportDirtyChange,
} from "@/lib/transportDraft";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import { formatChinaDate, toChinaDateInput } from "@/lib/businessTime";
import VehicleSettlementSelection from "@/components/VehicleSettlementSelection";
import { SettlementPaymentDialog } from "@/components/SettlementPaymentDialog";
import { VehicleSettlementProfileDialog } from "@/components/VehicleSettlementProfileDialog";
import { Bell, ReceiptText, Send, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import {
  downloadCurrentFilteredCsv,
  escapePrintHtml,
  openA4LandscapePrintDocument,
} from "@/lib/a4Print";
import { filterTransportSettlements } from "@/lib/transportWorkspace";
export type TransportSettlementFocusTrip = {
  id: number;
  vehicleId: number;
  date: string;
  legacyUnlinkedSettled?: boolean;
  requestId: number;
};

type Vehicle = {
  id: number;
  plateNo: string;
  ownership?: string | null;
  profile?: { settlementMode?: string } | null;
  ownerName?: string | null;
  driverName?: string | null;
};
type PaymentMethod =
  | "bank_transfer"
  | "corporate_account"
  | "cash"
  | "wechat"
  | "alipay"
  | "other";

const paymentMethodLabel: Record<string, string> = {
  bank_transfer: "银行卡转账",
  corporate_account: "对公账户",
  cash: "现金",
  wechat: "微信收款",
  alipay: "支付宝收款",
  other: "其他方式",
};
const settlementStatusLabel: Record<string, string> = {
  draft: "草稿",
  submitted: "待会计审核",
  approved: "待付款",
  partial: "部分付款",
  paid: "已付款",
  receivable: "待收补款",
  offset: "已抵扣",
  void: "已作废",
};
const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const paymentMethodDisplay = (method: string | null | undefined) =>
  paymentMethodLabel[method ?? ""] ?? "其他方式";
const settlementStatusDisplay = (status: string | null | undefined) =>
  status
    ? (settlementStatusLabel[status] ?? getBusinessStatusLabel(status))
    : "待处理";
/** 结算按北京时间业务日期归集，每趟计价不等于每趟单独结算付款。 */
const today = () => toChinaDateInput();

/**
 * 渣土车按趟费用结算。只生成真实已核验运单的结算草稿，付款完成后由服务端锁定为不可作废。
 * 日结通知采用服务号安全投递；模板尚未发布时仅保留投递审计而不影响业务数据。
 */
export default function TransportVehicleSettlementManager({
  projectId,
  vehicles,
  focusVehicle,
  scopeVehicleId,
  active = true,
  canCreate = true,
  canApprove = true,
  focusTrip,
  onDirtyChange,
}: {
  projectId: number;
  vehicles: Vehicle[];
  scopeVehicleId?: number;
  focusVehicle?: { id: number; requestId: number } | null;
  active?: boolean;
  canCreate?: boolean;
  canApprove?: boolean;
  focusTrip?: TransportSettlementFocusTrip | null;
  onDirtyChange?: TransportDirtyChange;
}) {
  const consumedFocusRequest = useRef<number | null>(null);
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [vehicleFilter, setVehicleFilter] = useState(
    scopeVehicleId ? String(scopeVehicleId) : "all"
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTripIds, setSelectedTripIds] = useState<
    number[] | undefined
  >();
  const [selectionMode, setSelectionMode] = useState<
    "day" | "period" | "trip_count"
  >("day");
  const [tripCount, setTripCount] = useState("10");
  const [legacyTripIds, setLegacyTripIds] = useState<number[]>([]);
  const [legacyConfirmation, setLegacyConfirmation] = useState("");
  const [legacyAcknowledged, setLegacyAcknowledged] = useState(false);
  const [settlementVehicleId, setSettlementVehicleId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [vehicleProfileOpen, setVehicleProfileOpen] = useState(false);
  useTransportDirty(createOpen || payOpen || vehicleProfileOpen, onDirtyChange);
  const closeCreate = () => {
    if (create.isPending) return;
    return discardTransportDraft(createOpen, () => {
      setCreateOpen(false);
      setSelectedTripIds(undefined);
      setLegacyTripIds([]);
      setLegacyConfirmation("");
      setLegacyAcknowledged(false);
    });
  };
  const closePay = (open: boolean) => {
    if (open) setPayOpen(true);
    else discardTransportDraft(payOpen, () => setPayOpen(false));
  };
  const closeProfile = (open: boolean) => {
    if (open) setVehicleProfileOpen(true);
    else
      discardTransportDraft(vehicleProfileOpen, () =>
        setVehicleProfileOpen(false)
      );
  };
  const [vehicleProfileId, setVehicleProfileId] = useState<number | null>(null);
  const [selectedSettlement, setSelectedSettlement] = useState<any | null>(
    null
  );
  const [form, setForm] = useState<{
    periodStart: string;
    periodEnd: string;
    payeeName: string;
    payeeAccount: string;
    paymentMethod: PaymentMethod;
    remarks: string;
  }>({
    periodStart: today(),
    periodEnd: today(),
    payeeName: "",
    payeeAccount: "",
    paymentMethod: "bank_transfer",
    remarks: "",
  });
  const daily = trpc.transport.dailyVehicleSettlementSummary.useQuery(
    { projectId, date },
    { enabled: Boolean(projectId) && active }
  );
  const settlements = trpc.transport.listVehicleSettlements.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && active }
  );
  const selectionDatesValid =
    /^\d{4}-\d{2}-\d{2}$/.test(form.periodStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.periodEnd) &&
    form.periodStart <= form.periodEnd;
  const selectionCountValid =
    selectionMode !== "trip_count" ||
    (/^\d+$/.test(tripCount) &&
      Number(tripCount) >= 1 &&
      Number(tripCount) <= 1000);
  const selectionPreview =
    trpc.transport.previewVehicleSettlementSelection.useQuery(
      {
        projectId,
        vehicleId: Number(settlementVehicleId) || 1,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        selectionMode,
        tripCount:
          selectionMode === "trip_count" && selectionCountValid
            ? Number(tripCount)
            : undefined,
      },
      {
        enabled:
          active &&
          canCreate &&
          createOpen &&
          !legacyTripIds.length &&
          Boolean(settlementVehicleId) &&
          selectionDatesValid &&
          selectionCountValid,
        retry: false,
      }
    );
  const utils = trpc.useUtils();
  const settlementRows = useMemo(
    () =>
      filterTransportSettlements(settlements.data ?? [], {
        month,
        vehicleId: scopeVehicleId ? String(scopeVehicleId) : vehicleFilter,
        status: statusFilter,
      }),
    [settlements.data, month, vehicleFilter, statusFilter, scopeVehicleId]
  );
  const pagination = useFinancePagination(
    settlementRows,
    JSON.stringify([
      projectId,
      month,
      vehicleFilter,
      statusFilter,
      scopeVehicleId,
    ])
  );
  const scopedDailyRows = (daily.data?.vehicleSummaries ?? []).filter(
    row => !scopeVehicleId || row.vehicleId === scopeVehicleId
  );
  const dailyPagination = useFinancePagination(
    scopedDailyRows,
    JSON.stringify([projectId, date, scopeVehicleId])
  );
  const settlementTotals = settlementRows.reduce(
    (total, row) => ({
      gross: total.gross + Number(row.grossFreightAmount),
      net: total.net + Number(row.netPayableAmount),
      paid: total.paid + Number(row.actualPaidAmount ?? 0),
      received: total.received + Number(row.actualReceivedAmount ?? 0),
      remaining: total.remaining + Number(row.remainingAmount ?? 0),
    }),
    { gross: 0, net: 0, paid: 0, received: 0, remaining: 0 }
  );
  const exportHeaders = [
    "结算单",
    "车辆",
    "开始日期",
    "结束日期",
    "趟数",
    "运费基数",
    "柴油扣款",
    "资产扣款",
    "前期抵扣",
    "净应付（负数待收）",
    "实际付款",
    "实际补款",
    "待收付余额",
    "状态",
  ];
  const outputRows = settlementRows.map(row => [
    row.settlementNo,
    row.vehicle?.plateNo ?? `车辆#${row.vehicleId}`,
    formatChinaDate(row.periodStart),
    formatChinaDate(row.periodEnd),
    row.tripCount,
    row.grossFreightAmount,
    row.fuelDeductionAmount,
    row.assetDeductionAmount,
    row.carryForwardDeductionAmount,
    row.netPayableAmount,
    row.actualPaidAmount ?? 0,
    row.actualReceivedAmount ?? 0,
    row.remainingAmount ?? "待核对",
    settlementStatusDisplay(row.status),
  ]);
  const printCurrent = () => {
    try {
      openA4LandscapePrintDocument({
        title: "车辆运输结算台账",
        bodyHtml: `<h1>车辆运输结算台账</h1><p>项目 #${projectId} · 期间 ${escapePrintHtml(month || "全部期间")} · 当前授权车辆/状态筛选（${statusFilter === "void" ? "作废追溯不计应付" : "不含作废"}）</p><table><thead><tr>${exportHeaders.map(value => `<th>${escapePrintHtml(value)}</th>`).join("")}</tr></thead><tbody>${outputRows.map(row => `<tr>${row.map(value => `<td>${escapePrintHtml(String(value ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table><p>共 ${settlementRows.length} 单 · 运费基数 ¥${money(settlementTotals.gross)} · 净应付 ¥${money(settlementTotals.net)} · 实付 ¥${money(settlementTotals.paid)} · 实收补款 ¥${money(settlementTotals.received)} · 待收付余额 ¥${money(settlementTotals.remaining)}</p><p>净应付非付款金额，账户与影像链接不纳入输出。</p>`,
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "打印失败"));
    }
  };
  const refresh = () =>
    Promise.all([
      utils.transport.dailyVehicleSettlementSummary.invalidate(),
      utils.transport.listVehicleSettlements.invalidate(),
      utils.transport.listTrips.invalidate(),
      utils.transport.previewVehicleSettlementSelection.invalidate(),
    ]);
  const create = trpc.transport.createVehicleSettlement.useMutation({
    onSuccess: async data => {
      toast.success(`已生成结算草稿 ${data.settlementNo}`);
      setCreateOpen(false);
      await refresh();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")
      ),
  });
  const transition = trpc.transport.transitionVehicleSettlement.useMutation({
    onSuccess: async data => {
      toast.success(
        `结算状态已更新为：${settlementStatusLabel[data.status] ?? getBusinessStatusLabel(data.status)}`
      );
      setPayOpen(false);
      await refresh();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")
      ),
  });
  const notify = trpc.transport.sendDailyVehicleSettlementSummary.useMutation({
    onSuccess: data =>
      toast.success(`已发起 ${data.tripCount} 趟运输日结的服务号通知`),
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")
      ),
  });
  const eligibleVehicles = useMemo(
    () =>
      vehicles.filter(item =>
        item.profile
          ? ["trip", "ton", "volume"].includes(
              item.profile.settlementMode ?? ""
            )
          : item.ownership === "trip_settlement"
      ),
    [vehicles]
  );
  useEffect(() => {
    if (!focusVehicle || !vehicles.some(item => item.id === focusVehicle.id))
      return;
    setVehicleProfileId(focusVehicle.id);
    setVehicleProfileOpen(true);
  }, [focusVehicle, vehicles]);
  const dailyRows = scopedDailyRows;
  const openCreate = (vehicleId?: number) => {
    if (createOpen && !discardTransportDraft(true, () => {})) return;
    const vehicle =
      eligibleVehicles.find(
        item => item.id === (scopeVehicleId ?? vehicleId)
      ) ?? (!scopeVehicleId ? eligibleVehicles[0] : undefined);
    if (!vehicle) {
      toast.error("当前项目还没有可按运单计费的车辆，请先在车辆管理中录入车辆");
      return;
    }
    setSelectedTripIds(undefined);
    setSelectionMode("day");
    setTripCount("10");
    setLegacyTripIds([]);
    setLegacyConfirmation("");
    setLegacyAcknowledged(false);
    setSettlementVehicleId(String(vehicle.id));
    setForm({
      periodStart: date,
      periodEnd: date,
      payeeName: vehicle.ownerName || vehicle.driverName || "",
      payeeAccount: "",
      paymentMethod: "bank_transfer",
      remarks: "",
    });
    setCreateOpen(true);
  };

  useEffect(() => {
    if (
      !focusTrip ||
      !active ||
      consumedFocusRequest.current === focusTrip.requestId
    )
      return;
    const vehicle = eligibleVehicles.find(
      item => item.id === focusTrip.vehicleId
    );
    if (!vehicle) return;
    if (createOpen && !discardTransportDraft(true, () => {})) return;
    consumedFocusRequest.current = focusTrip.requestId;
    setDate(focusTrip.date);
    setMonth(focusTrip.date.slice(0, 7));
    setSettlementVehicleId(String(vehicle.id));
    // 普通运单入口只是预填同车当天，默认合并当天全部可结算运单；历史补单仍逐单核对。
    setSelectedTripIds(
      focusTrip.legacyUnlinkedSettled ? [focusTrip.id] : undefined
    );
    setSelectionMode("day");
    setTripCount("10");
    setLegacyTripIds(focusTrip.legacyUnlinkedSettled ? [focusTrip.id] : []);
    setLegacyConfirmation("");
    setLegacyAcknowledged(false);
    setForm({
      periodStart: focusTrip.date,
      periodEnd: focusTrip.date,
      payeeName: vehicle.ownerName || vehicle.driverName || "",
      payeeAccount: "",
      paymentMethod: "bank_transfer",
      remarks: "",
    });
    setCreateOpen(true);
  }, [focusTrip?.requestId, active, eligibleVehicles]);

  return (
    <>
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                车辆管理 · 费用结算
              </p>
              <CardTitle className="mt-1 text-base">
                渣土车运费汇总与合并结算
              </CardTitle>
              <CardDescription className="mt-1">
                每趟记录运费，按一天、日期范围或指定趟数合并生成一张结算单；按北京时间业务日归集。收款方式属于本次结算付款，不固定绑定在车辆档案；付款完成后不能作废。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => notify.mutate({ projectId, date })}
                disabled={notify.isPending || Boolean(scopeVehicleId)}
                title={
                  scopeVehicleId
                    ? "项目日结通知请返回运输管理发送；当前详情只显示本车"
                    : undefined
                }
              >
                <Send className="mr-1.5 h-4 w-4" />
                {notify.isPending ? "发送中…" : "发送微信日结"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setVehicleProfileId(null);
                  setVehicleProfileOpen(true);
                }}
              >
                <WalletCards className="mr-1.5 h-4 w-4" />
                单车结算 / 收款资料
              </Button>
              <Button
                size="sm"
                disabled={!canCreate}
                onClick={() => openCreate()}
              >
                <WalletCards className="mr-1.5 h-4 w-4" />
                生成合并结算
              </Button>
            </div>
          </div>
          <div className="max-w-[220px]">
            <Label>统计日期</Label>
            <Input
              className="mt-1"
              type="date"
              value={date}
              onChange={event => setDate(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
            <Table className="min-w-[1080px] text-xs">
              <TableHeader className="bg-[#edf1ed]">
                <TableRow>
                  <TableHead>车牌 / 资源性质</TableHead>
                  <TableHead>日期</TableHead>
                  <TableHead>趟数</TableHead>
                  <TableHead>方量</TableHead>
                  <TableHead>总运费</TableHead>
                  <TableHead>柴油扣款</TableHead>
                  <TableHead>净应付金额</TableHead>
                  <TableHead>核验/付款</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-slate-500"
                    >
                      正在汇总真实运单…
                    </TableCell>
                  </TableRow>
                ) : dailyRows.length ? (
                  dailyPagination.pageRows.map((row: any) => (
                    <TableRow key={row.vehicleId}>
                      <TableCell>
                        <p className="font-semibold text-[#203c48]">
                          {row.plateNo}
                        </p>
                        <p className="mt-1 text-slate-500">
                          {row.ownership === "trip_settlement"
                            ? "渣土车 · 运单计费"
                            : row.ownership === "leased"
                              ? "外租车辆"
                              : "公司自有"}
                        </p>
                      </TableCell>
                      <TableCell>{date}</TableCell>
                      <TableCell>{row.tripCount}</TableCell>
                      <TableCell>
                        {Number(row.totalVolumeCubicMeters ?? 0).toLocaleString(
                          "zh-CN",
                          { maximumFractionDigits: 3 }
                        )}{" "}
                        m³
                      </TableCell>
                      <TableCell>¥{money(row.grossFreightAmount)}</TableCell>
                      <TableCell>¥{money(row.fuelDeductionAmount)}</TableCell>
                      <TableCell className="font-semibold">
                        ¥{money(row.netPayableAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          已核验 {row.verifiedTripCount} / 已结算{" "}
                          {row.settledTripCount}
                        </Badge>
                        <p className="mt-1 text-slate-500">
                          {settlementStatusLabel[row.paymentStatus] ??
                            getBusinessStatusLabel(row.paymentStatus)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.ownership === "trip_settlement" ? (
                          <Button
                            size="sm"
                            disabled={!canCreate}
                            onClick={() => openCreate(row.vehicleId)}
                          >
                            结算
                          </Button>
                        ) : (
                          <span className="text-slate-400">非运单计费</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-slate-500"
                    >
                      该日期暂无真实运输运单。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <FinancePagination
            label="日结车辆"
            page={dailyPagination.page}
            pageSize={dailyPagination.pageSize}
            total={dailyPagination.total}
            onPageChange={dailyPagination.setPage}
            onPageSizeChange={dailyPagination.setPageSize}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>结算月份（按期间结束月）</Label>
              <Input
                type="month"
                value={month}
                onChange={event => setMonth(event.target.value)}
              />
              <Button size="sm" variant="ghost" onClick={() => setMonth("")}>
                全部期间
              </Button>
            </div>
            <div>
              <Label>结算车辆</Label>
              <select
                className="min-h-10 w-full rounded border bg-background px-2"
                aria-label="结算车辆筛选"
                disabled={Boolean(scopeVehicleId)}
                value={vehicleFilter}
                onChange={event => setVehicleFilter(event.target.value)}
              >
                <option value="all">全部车辆</option>
                {vehicles.map(vehicle => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>结算状态</Label>
              <select
                className="min-h-10 w-full rounded border bg-background px-2"
                aria-label="结算状态筛选"
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
              >
                <option value="all">全部有效状态（不含作废）</option>
                {Object.entries(settlementStatusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <CurrentFilterPrintActions
            disabled={!settlementRows.length}
            printLabel="打印当前筛选结算"
            exportLabel="导出当前筛选结算"
            onPrint={printCurrent}
            onExport={() =>
              downloadCurrentFilteredCsv(
                `车辆运输结算-${month || "全部期间"}.csv`,
                exportHeaders,
                outputRows
              )
            }
          />
          <p className="rounded border bg-slate-50 p-3 text-sm">
            {statusFilter === "void"
              ? "作废追溯（不计应付） · "
              : "有效结算 · "}
            运费基数 ¥{money(settlementTotals.gross)} · 净应付 ¥
            {money(settlementTotals.net)} · 实际付款 ¥
            {money(settlementTotals.paid)} · 实收补款 ¥
            {money(settlementTotals.received)} · 待收付余额 ¥
            {money(settlementTotals.remaining)}
          </p>
          <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[#203c48]">
                  渣土车费用结算与付款台账
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  流程：按天 / 日期范围 / 指定趟数合并、外租合同或有依据调整结算
                  → 提交会计审核 →
                  上传凭证并分笔登记实际收付。柴油倒挂自动进入待收补款，后期可受控抵扣；已产生实际收付的结算单不可作废。
                </p>
              </div>
              <Badge variant="outline">{settlementRows.length} 单</Badge>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[1180px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>结算单 / 车辆</TableHead>
                    <TableHead>结算期间 / 趟数</TableHead>
                    <TableHead>应付 / 柴油 / 资产 / 前期抵扣 / 净额</TableHead>
                    <TableHead>收款人 / 方式</TableHead>
                    <TableHead>账户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>付款日期</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-6 text-center text-slate-500"
                      >
                        正在读取结算台账…
                      </TableCell>
                    </TableRow>
                  ) : settlementRows.length ? (
                    pagination.pageRows.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="font-semibold">{item.settlementNo}</p>
                          <p className="mt-1 text-slate-500">
                            {item.vehicle?.plateNo || `车辆 #${item.vehicleId}`}
                          </p>
                        </TableCell>
                        <TableCell>
                          {formatChinaDate(item.periodStart)} 至{" "}
                          {formatChinaDate(item.periodEnd)}
                          <p className="mt-1 text-slate-500">
                            {item.tripCount} 趟
                          </p>
                        </TableCell>
                        <TableCell>
                          ¥{money(item.grossFreightAmount)} / ¥
                          {money(item.fuelDeductionAmount)} / ¥
                          {money(item.assetDeductionAmount)} / ¥
                          {money(item.carryForwardDeductionAmount)} /{" "}
                          <b>¥{money(item.netPayableAmount)}</b>
                          <p className="mt-1 text-slate-500">
                            实付 ¥{money(item.actualPaidAmount)} · 实收补款 ¥
                            {money(item.actualReceivedAmount)} · 待收付 ¥
                            {money(item.remainingAmount)}
                          </p>
                        </TableCell>
                        <TableCell>
                          {item.payeeName}
                          <p className="mt-1 text-slate-500">
                            {paymentMethodDisplay(item.paymentMethod)}
                          </p>
                        </TableCell>
                        <TableCell>
                          {item.payeeAccount || "未填写"}
                          {item.accountMasked ? (
                            <p className="mt-1 text-amber-700">
                              仅财务可查看完整账户
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.status === "paid"
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                                : item.status === "void"
                                  ? "bg-slate-100 text-slate-600 hover:bg-slate-100"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-50"
                            }
                          >
                            {settlementStatusDisplay(item.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.paymentDate
                            ? formatChinaDate(item.paymentDate)
                            : "待付款"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canCreate && item.status === "draft" ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  transition.mutate({
                                    id: item.id,
                                    projectId,
                                    action: "submit",
                                  })
                                }
                                disabled={transition.isPending}
                              >
                                提交审核
                              </Button>
                            ) : null}
                            {canApprove && item.status === "submitted" ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  transition.mutate({
                                    id: item.id,
                                    projectId,
                                    action: "approve",
                                  })
                                }
                                disabled={transition.isPending}
                              >
                                会计审核
                              </Button>
                            ) : null}
                            {canApprove &&
                            ["approved", "partial", "receivable"].includes(
                              item.status
                            ) ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedSettlement(item);
                                  setPayOpen(true);
                                }}
                                disabled={transition.isPending}
                              >
                                {Number(item.netPayableAmount) < 0
                                  ? "登记补款"
                                  : "登记付款"}
                              </Button>
                            ) : null}
                            {canCreate &&
                            ["draft", "submitted", "approved"].includes(
                              item.status
                            ) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `确认作废结算单 ${item.settlementNo}？已有实际收付的单据不可作废。`
                                    )
                                  )
                                    transition.mutate({
                                      id: item.id,
                                      projectId,
                                      action: "void",
                                    });
                                }}
                                disabled={transition.isPending}
                              >
                                作废
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-6 text-center text-slate-500"
                      >
                        尚未生成真实渣土车结算单。
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <FinancePagination
            label="运输结算"
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </CardContent>
      </Card>
      <Dialog
        open={createOpen}
        onOpenChange={open => {
          if (open) setCreateOpen(true);
          else closeCreate();
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-5xl xl:max-w-6xl">
          <DialogHeader>
            <DialogTitle>生成渣土车运费合并结算</DialogTitle>
            <DialogDescription>
              只汇总结算期间内已核验且尚未进入其他结算单的真实运单；金额由服务端重新计算。
            </DialogDescription>
          </DialogHeader>
          {selectedTripIds ? (
            <p className="rounded border bg-sky-50 p-3 text-sm">
              本次仅补录历史运单 #{selectedTripIds.join("、")}{" "}
              的真实结算草稿，日期与车辆不可变更；普通运单支持按天、日期范围或指定趟数合并。
            </p>
          ) : null}
          {legacyTripIds.length ? (
            <section className="rounded border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold">
                历史未关联结算单：不得推定已付款
              </p>
              <p className="mt-1 text-xs">
                保持原历史结算
                状态与原金额快照，只由财务逐单核对后建立真实结算，不批量修改历史状态。
              </p>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={legacyAcknowledged}
                  onChange={event =>
                    setLegacyAcknowledged(event.target.checked)
                  }
                />
                我已核对本单原始结算与付款凭据，确认没有重复结算/付款
              </label>
              <Input
                className="mt-2"
                value={legacyConfirmation}
                onChange={event => setLegacyConfirmation(event.target.value)}
                placeholder="填写原始资料核对依据（至少4字）"
              />
            </section>
          ) : null}
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            <div>
              <Label>渣土车</Label>
              <Select
                disabled={
                  Boolean(legacyTripIds.length) ||
                  Boolean(scopeVehicleId) ||
                  create.isPending
                }
                value={settlementVehicleId}
                onValueChange={value => {
                  setSettlementVehicleId(value);
                  const vehicle = eligibleVehicles.find(
                    item => String(item.id) === value
                  );
                  if (vehicle)
                    setForm(current => ({
                      ...current,
                      payeeName: vehicle.ownerName || vehicle.driverName || "",
                      payeeAccount: "",
                    }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="选择运单计费车辆" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleVehicles
                    .filter(
                      item => !scopeVehicleId || item.id === scopeVehicleId
                    )
                    .map(item => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.plateNo} ·{" "}
                        {item.ownerName || item.driverName || "收款人待填"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>收款方式</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={value =>
                  setForm(current => ({
                    ...current,
                    paymentMethod: value as PaymentMethod,
                  }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(paymentMethodLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {legacyTripIds.length ? (
              <>
                <div>
                  <Label>结算开始日期</Label>
                  <Input
                    className="mt-1"
                    disabled={Boolean(selectedTripIds)}
                    type="date"
                    value={form.periodStart}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        periodStart: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>结算结束日期</Label>
                  <Input
                    className="mt-1"
                    disabled={Boolean(selectedTripIds)}
                    type="date"
                    value={form.periodEnd}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        periodEnd: event.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
            <div>
              <Label>收款人</Label>
              <Input
                className="mt-1"
                value={form.payeeName}
                placeholder="司机、车主或收款单位"
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    payeeName: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>收款账户</Label>
              <Input
                className="mt-1"
                value={form.payeeAccount}
                placeholder="银行卡/对公账号/收款账号"
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    payeeAccount: event.target.value,
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>备注（可选）</Label>
              <Input
                className="mt-1"
                value={form.remarks}
                placeholder="结算说明、付款用途等"
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    remarks: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          {!legacyTripIds.length ? (
            <VehicleSettlementSelection
              mode={selectionMode}
              tripCount={tripCount}
              periodStart={form.periodStart}
              periodEnd={form.periodEnd}
              onModeChange={mode => {
                setSelectionMode(mode);
                if (mode === "day")
                  setForm(current => ({
                    ...current,
                    periodEnd: current.periodStart,
                  }));
              }}
              onTripCountChange={setTripCount}
              onPeriodChange={(periodStart, periodEnd) =>
                setForm(current => ({ ...current, periodStart, periodEnd }))
              }
              preview={selectionPreview.data}
              loading={selectionPreview.isFetching}
              error={
                selectionPreview.error
                  ? getUserFacingErrorMessage(
                      selectionPreview.error,
                      "结算范围预览失败，请重试"
                    )
                  : undefined
              }
              onRefresh={() => {
                void selectionPreview.refetch();
              }}
              disabled={create.isPending}
              plateNo={
                eligibleVehicles.find(
                  item => String(item.id) === settlementVehicleId
                )?.plateNo ?? "未选车辆"
              }
            />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={closeCreate}
            >
              取消
            </Button>
            <Button
              disabled={
                !active ||
                !canCreate ||
                !settlementVehicleId ||
                (!legacyTripIds.length &&
                  (!selectionDatesValid ||
                    !selectionCountValid ||
                    !selectionPreview.data?.eligible ||
                    selectionPreview.isFetching ||
                    selectionPreview.isError)) ||
                form.payeeName.trim().length < 2 ||
                form.periodEnd < form.periodStart ||
                ([
                  "bank_transfer",
                  "corporate_account",
                  "wechat",
                  "alipay",
                ].includes(form.paymentMethod) &&
                  !form.payeeAccount.trim()) ||
                (legacyTripIds.length > 0 &&
                  (!canApprove ||
                    !legacyAcknowledged ||
                    legacyConfirmation.trim().length < 4)) ||
                create.isPending
              }
              onClick={() =>
                create.mutate({
                  projectId,
                  vehicleId: Number(settlementVehicleId),
                  ...form,
                  tripIds: legacyTripIds.length
                    ? selectedTripIds
                    : selectionPreview.data?.tripIds,
                  selectionMode: legacyTripIds.length
                    ? undefined
                    : selectionMode,
                  tripCount:
                    !legacyTripIds.length && selectionMode === "trip_count"
                      ? Number(tripCount)
                      : undefined,
                  legacyTripIds,
                  legacyConfirmation: legacyTripIds.length
                    ? legacyConfirmation
                    : undefined,
                  payeeAccount: form.payeeAccount || null,
                  remarks: form.remarks || null,
                })
              }
            >
              <ReceiptText className="mr-1.5 h-4 w-4" />
              {create.isPending ? "生成中…" : "生成结算草稿"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SettlementPaymentDialog
        open={payOpen}
        onOpenChange={closePay}
        projectId={projectId}
        settlementType="transport_vehicle"
        target={
          selectedSettlement
            ? {
                id: selectedSettlement.id,
                label: `${selectedSettlement.settlementNo} · ${selectedSettlement.vehicle?.plateNo || `车辆 #${selectedSettlement.vehicleId}`}`,
                payeeName: selectedSettlement.payeeName,
                payeeAccount: selectedSettlement.payeeAccount,
              }
            : null
        }
        onCompleted={refresh}
      />
      <VehicleSettlementProfileDialog
        open={vehicleProfileOpen}
        onOpenChange={closeProfile}
        projectId={projectId}
        vehicles={vehicles}
        initialVehicleId={vehicleProfileId}
        onRefresh={refresh}
      />
    </>
  );
}
