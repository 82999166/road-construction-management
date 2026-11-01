import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import { formatChinaDate, toDeviceDateInput } from "@/lib/businessTime";
import { SettlementPaymentDialog } from "@/components/SettlementPaymentDialog";
import { VehicleSettlementProfileDialog } from "@/components/VehicleSettlementProfileDialog";
import { Bell, ReceiptText, Send, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Vehicle = { id: number; plateNo: string; ownership?: string | null; ownerName?: string | null; driverName?: string | null };
type PaymentMethod = "bank_transfer" | "corporate_account" | "cash" | "wechat" | "alipay" | "other";

const paymentMethodLabel: Record<string, string> = {
  bank_transfer: "银行卡转账",
  corporate_account: "对公账户",
  cash: "现金",
  wechat: "微信收款",
  alipay: "支付宝收款",
  other: "其他方式",
};
const settlementStatusLabel: Record<string, string> = { draft: "草稿", submitted: "待会计审核", approved: "待付款", partial: "部分付款", paid: "已付款", receivable: "待收补款", offset: "已抵扣", void: "已作废" };
const money = (value: unknown) => Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paymentMethodDisplay = (method: string | null | undefined) => paymentMethodLabel[method ?? ""] ?? "其他方式";
const settlementStatusDisplay = (status: string | null | undefined) => status ? settlementStatusLabel[status] ?? getBusinessStatusLabel(status) : "待处理";
/** 结算业务日期以操作设备系统日期为默认值，避免 UTC 零点附近误带出前一天。 */
const today = () => toDeviceDateInput();

/**
 * 渣土车按趟费用结算。只生成真实已核验运单的结算草稿，付款完成后由服务端锁定为不可作废。
 * 日结通知采用服务号安全投递；模板尚未发布时仅保留投递审计而不影响业务数据。
 */
export default function TransportVehicleSettlementManager({ projectId, vehicles, focusVehicle }: { projectId: number; vehicles: Vehicle[]; focusVehicle?: { id: number; requestId: number } | null }) {
  const [date, setDate] = useState(today);
  const [settlementVehicleId, setSettlementVehicleId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [vehicleProfileOpen, setVehicleProfileOpen] = useState(false);
  const [vehicleProfileId, setVehicleProfileId] = useState<number | null>(null);
  const [selectedSettlement, setSelectedSettlement] = useState<any | null>(null);
  const [form, setForm] = useState<{ periodStart: string; periodEnd: string; payeeName: string; payeeAccount: string; paymentMethod: PaymentMethod; remarks: string }>({ periodStart: today(), periodEnd: today(), payeeName: "", payeeAccount: "", paymentMethod: "bank_transfer", remarks: "" });
  const daily = trpc.transport.dailyVehicleSettlementSummary.useQuery({ projectId, date }, { enabled: Boolean(projectId) });
  const settlements = trpc.transport.listVehicleSettlements.useQuery({ projectId }, { enabled: Boolean(projectId) });
  const utils = trpc.useUtils();
  const refresh = () => Promise.all([utils.transport.dailyVehicleSettlementSummary.invalidate(), utils.transport.listVehicleSettlements.invalidate(), utils.transport.listTrips.invalidate()]);
  const create = trpc.transport.createVehicleSettlement.useMutation({ onSuccess: async data => { toast.success(`已生成结算草稿 ${data.settlementNo}`); setCreateOpen(false); await refresh(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")) });
  const transition = trpc.transport.transitionVehicleSettlement.useMutation({ onSuccess: async data => { toast.success(`结算状态已更新为：${settlementStatusLabel[data.status] ?? getBusinessStatusLabel(data.status)}`); setPayOpen(false); await refresh(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")) });
  const notify = trpc.transport.sendDailyVehicleSettlementSummary.useMutation({ onSuccess: data => toast.success(`已发起 ${data.tripCount} 趟运输日结的服务号通知`), onError: error => toast.error(getUserFacingErrorMessage(error, "车辆运输结算未完成，请稍后重试")) });
  const eligibleVehicles = useMemo(() => vehicles.filter(item => item.ownership === "trip_settlement"), [vehicles]);
  useEffect(() => {
    if (!focusVehicle || !vehicles.some(item => item.id === focusVehicle.id)) return;
    setVehicleProfileId(focusVehicle.id);
    setVehicleProfileOpen(true);
  }, [focusVehicle, vehicles]);
  const dailyRows = daily.data?.vehicleSummaries ?? [];
  const openCreate = (vehicleId?: number) => {
    const vehicle = eligibleVehicles.find(item => item.id === vehicleId) ?? eligibleVehicles[0];
    if (!vehicle) { toast.error("当前项目还没有“渣土车（按趟结算）”，请先在车辆管理中录入车辆"); return; }
    setSettlementVehicleId(String(vehicle.id));
    setForm({ periodStart: date, periodEnd: date, payeeName: vehicle.ownerName || vehicle.driverName || "", payeeAccount: "", paymentMethod: "bank_transfer", remarks: "" });
    setCreateOpen(true);
  };

  return <>
    <Card className="border-[#d8e3e0] shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">车辆管理 · 费用结算</p><CardTitle className="mt-1 text-base">渣土车日运单汇总与按趟付款</CardTitle><CardDescription className="mt-1">按车牌和业务日统计真实趟次、应付运费、柴油扣款和净应付。收款方式属于本次结算付款，不固定绑定在车辆档案；付款完成后不能作废。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => notify.mutate({ projectId, date })} disabled={notify.isPending}><Send className="mr-1.5 h-4 w-4" />{notify.isPending ? "发送中…" : "发送微信日结"}</Button><Button size="sm" variant="outline" onClick={() => { setVehicleProfileId(null); setVehicleProfileOpen(true); }}><WalletCards className="mr-1.5 h-4 w-4" />单车结算 / 收款资料</Button><Button size="sm" onClick={() => openCreate()}><WalletCards className="mr-1.5 h-4 w-4" />生成按趟结算</Button></div></div>
        <div className="max-w-[220px]"><Label>统计日期</Label><Input className="mt-1" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1080px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>车牌 / 资源性质</TableHead><TableHead>日期</TableHead><TableHead>趟数</TableHead><TableHead>方量</TableHead><TableHead>总运费</TableHead><TableHead>柴油扣款</TableHead><TableHead>净应付金额</TableHead><TableHead>核验/付款</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{daily.isLoading ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">正在汇总真实运单…</TableCell></TableRow> : dailyRows.length ? dailyRows.map((row: any) => <TableRow key={row.vehicleId}><TableCell><p className="font-semibold text-[#203c48]">{row.plateNo}</p><p className="mt-1 text-slate-500">{row.ownership === "trip_settlement" ? "渣土车 · 按趟结算" : row.ownership === "leased" ? "外租车辆" : "公司自有"}</p></TableCell><TableCell>{date}</TableCell><TableCell>{row.tripCount}</TableCell><TableCell>{Number(row.totalVolumeCubicMeters ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 })} m³</TableCell><TableCell>¥{money(row.grossFreightAmount)}</TableCell><TableCell>¥{money(row.fuelDeductionAmount)}</TableCell><TableCell className="font-semibold">¥{money(row.netPayableAmount)}</TableCell><TableCell><Badge variant="outline">已核验 {row.verifiedTripCount} / 已结算 {row.settledTripCount}</Badge><p className="mt-1 text-slate-500">{settlementStatusLabel[row.paymentStatus] ?? getBusinessStatusLabel(row.paymentStatus)}</p></TableCell><TableCell className="text-right">{row.ownership === "trip_settlement" ? <Button size="sm" onClick={() => openCreate(row.vehicleId)}>结算</Button> : <span className="text-slate-400">非按趟结算</span>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">该日期暂无真实运输运单。</TableCell></TableRow>}</TableBody></Table></div>
        <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[#203c48]">渣土车费用结算与付款台账</p><p className="mt-1 text-xs text-slate-500">流程：按趟、外租合同或有依据调整结算 → 提交会计审核 → 上传凭证并分笔登记实际收付。柴油倒挂自动进入待收补款，后期可受控抵扣；已产生实际收付的结算单不可作废。</p></div><Badge variant="outline">{settlements.data?.length ?? 0} 单</Badge></div><div className="overflow-x-auto"><Table className="min-w-[1180px] text-xs"><TableHeader><TableRow><TableHead>结算单 / 车辆</TableHead><TableHead>结算期间 / 趟数</TableHead><TableHead>应付 / 柴油 / 资产 / 前期抵扣 / 净额</TableHead><TableHead>收款人 / 方式</TableHead><TableHead>账户</TableHead><TableHead>状态</TableHead><TableHead>付款日期</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{settlements.isLoading ? <TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-500">正在读取结算台账…</TableCell></TableRow> : settlements.data?.length ? settlements.data.map((item: any) => <TableRow key={item.id}><TableCell><p className="font-semibold">{item.settlementNo}</p><p className="mt-1 text-slate-500">{item.vehicle?.plateNo || `车辆 #${item.vehicleId}`}</p></TableCell><TableCell>{formatChinaDate(item.periodStart)} 至 {formatChinaDate(item.periodEnd)}<p className="mt-1 text-slate-500">{item.tripCount} 趟</p></TableCell><TableCell>¥{money(item.grossFreightAmount)} / ¥{money(item.fuelDeductionAmount)} / ¥{money(item.assetDeductionAmount)} / ¥{money(item.carryForwardDeductionAmount)} / <b>¥{money(item.netPayableAmount)}</b></TableCell><TableCell>{item.payeeName}<p className="mt-1 text-slate-500">{paymentMethodDisplay(item.paymentMethod)}</p></TableCell><TableCell>{item.payeeAccount || "未填写"}{item.accountMasked ? <p className="mt-1 text-amber-700">仅财务可查看完整账户</p> : null}</TableCell><TableCell><Badge className={item.status === "paid" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : item.status === "void" ? "bg-slate-100 text-slate-600 hover:bg-slate-100" : "bg-amber-50 text-amber-700 hover:bg-amber-50"}>{settlementStatusDisplay(item.status)}</Badge></TableCell><TableCell>{item.paymentDate ? formatChinaDate(item.paymentDate) : "待付款"}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1">{item.status === "draft" ? <Button size="sm" onClick={() => transition.mutate({ id: item.id, projectId, action: "submit" })} disabled={transition.isPending}>提交审核</Button> : null}{item.status === "submitted" ? <Button size="sm" onClick={() => transition.mutate({ id: item.id, projectId, action: "approve" })} disabled={transition.isPending}>会计审核</Button> : null}{["approved", "partial", "receivable"].includes(item.status) ? <Button size="sm" onClick={() => { setSelectedSettlement(item); setPayOpen(true); }} disabled={transition.isPending}>{Number(item.netPayableAmount) < 0 ? "登记补款" : "登记付款"}</Button> : null}{["draft", "submitted", "approved"].includes(item.status) ? <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: item.id, projectId, action: "void" })} disabled={transition.isPending}>作废</Button> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-500">尚未生成真实渣土车结算单。</TableCell></TableRow>}</TableBody></Table></div></div>
      </CardContent>
    </Card>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl xl:max-w-4xl"><DialogHeader><DialogTitle>生成渣土车按趟费用结算</DialogTitle><DialogDescription>只汇总结算期间内已核验且尚未进入其他结算单的真实运单；金额由服务端重新计算。</DialogDescription></DialogHeader><div className="grid gap-3 py-2 sm:grid-cols-2"><div><Label>渣土车</Label><Select value={settlementVehicleId} onValueChange={value => { setSettlementVehicleId(value); const vehicle = eligibleVehicles.find(item => String(item.id) === value); if (vehicle) setForm(current => ({ ...current, payeeName: current.payeeName || vehicle.ownerName || vehicle.driverName || "" })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="选择按趟结算车辆" /></SelectTrigger><SelectContent>{eligibleVehicles.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.plateNo} · {item.ownerName || item.driverName || "收款人待填"}</SelectItem>)}</SelectContent></Select></div><div><Label>收款方式</Label><Select value={form.paymentMethod} onValueChange={value => setForm(current => ({ ...current, paymentMethod: value as PaymentMethod }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentMethodLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>结算开始日期</Label><Input className="mt-1" type="date" value={form.periodStart} onChange={event => setForm(current => ({ ...current, periodStart: event.target.value }))} /></div><div><Label>结算结束日期</Label><Input className="mt-1" type="date" value={form.periodEnd} onChange={event => setForm(current => ({ ...current, periodEnd: event.target.value }))} /></div><div><Label>收款人</Label><Input className="mt-1" value={form.payeeName} placeholder="司机、车主或收款单位" onChange={event => setForm(current => ({ ...current, payeeName: event.target.value }))} /></div><div><Label>收款账户</Label><Input className="mt-1" value={form.payeeAccount} placeholder="银行卡/对公账号/收款账号" onChange={event => setForm(current => ({ ...current, payeeAccount: event.target.value }))} /></div><div className="sm:col-span-2"><Label>备注（可选）</Label><Input className="mt-1" value={form.remarks} placeholder="结算说明、付款用途等" onChange={event => setForm(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={!settlementVehicleId || !form.payeeName.trim() || create.isPending} onClick={() => create.mutate({ projectId, vehicleId: Number(settlementVehicleId), ...form, payeeAccount: form.payeeAccount || null, remarks: form.remarks || null })}><ReceiptText className="mr-1.5 h-4 w-4" />{create.isPending ? "生成中…" : "生成结算草稿"}</Button></DialogFooter></DialogContent></Dialog>
    <SettlementPaymentDialog open={payOpen} onOpenChange={setPayOpen} projectId={projectId} settlementType="transport_vehicle" target={selectedSettlement ? { id: selectedSettlement.id, label: `${selectedSettlement.settlementNo} · ${selectedSettlement.vehicle?.plateNo || `车辆 #${selectedSettlement.vehicleId}`}`, payeeName: selectedSettlement.payeeName, payeeAccount: selectedSettlement.payeeAccount } : null} onCompleted={refresh} />
    <VehicleSettlementProfileDialog open={vehicleProfileOpen} onOpenChange={setVehicleProfileOpen} projectId={projectId} vehicles={vehicles} initialVehicleId={vehicleProfileId} onRefresh={refresh} />
  </>;
}
