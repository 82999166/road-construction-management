import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toDeviceDateInput } from "@/lib/businessTime";
import { FileText, Landmark, Loader2, Upload, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type SettlementType = "transport_vehicle" | "machine" | "payroll" | "daily_wage";
type PaymentMethod = "bank_transfer" | "corporate_account" | "cash" | "wechat" | "alipay" | "other";

type SettlementTarget = { id: number; label: string; payeeName?: string | null; payeeAccount?: string | null };

const paymentMethodLabel: Record<PaymentMethod, string> = {
  bank_transfer: "银行卡转账",
  corporate_account: "对公账户",
  cash: "现金",
  wechat: "微信收款",
  alipay: "支付宝收款",
  other: "其他方式",
};
const money = (value: string | number | null | undefined) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typeLabel: Record<SettlementType, string> = { transport_vehicle: "车辆结算", machine: "机械结算", payroll: "工资发放", daily_wage: "临时日结" };

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("付款凭证读取失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * 实际资金只可通过此组件确认：必须上传当前结算单的凭证，金额由服务端以未结余额二次校验。
 * 本组件从不自行计算应付，也不缓存银行卡、微信或支付宝账号到浏览器。
 */
export function SettlementPaymentDialog({ open, onOpenChange, projectId, settlementType, target, onCompleted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  settlementType: SettlementType;
  target: SettlementTarget | null;
  onCompleted?: () => Promise<unknown> | void;
}) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(toDeviceDateInput);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAccount, setPayeeAccount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const input = useMemo(() => ({ projectId, settlementType, settlementId: target?.id ?? 0 }), [projectId, settlementType, target?.id]);
  const payments = trpc.settlementPayment.list.useQuery(input, { enabled: open && Boolean(projectId && target?.id), retry: false });
  const uploadProof = trpc.settlementPayment.uploadProof.useMutation();
  const record = trpc.settlementPayment.record.useMutation();
  const isBusy = uploadProof.isPending || record.isPending;

  useEffect(() => {
    if (!open || !target) return;
    setAmount("");
    setPaymentDate(toDeviceDateInput());
    setPaymentMethod("bank_transfer");
    setPayeeName(target.payeeName || "");
    setPayeeAccount(target.payeeAccount || "");
    setPaymentReference("");
    setRemarks("");
    setProofFile(null);
  }, [open, target?.id]);
  useEffect(() => {
    if (!payments.data || !target) return;
    setAmount(payments.data.remainingAmount > 0 ? String(payments.data.remainingAmount) : "");
    setPayeeName(current => current || payments.data.defaultPayee?.name || target.payeeName || "");
    setPayeeAccount(current => current || payments.data.defaultPayee?.account || target.payeeAccount || "");
  }, [payments.data, target]);

  const submit = async () => {
    if (!target || !proofFile) {
      toast.error("请先选择本次实际收付凭证（JPG、PNG 或 PDF）");
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("请填写大于 0 的本次实际金额");
      return;
    }
    if (!payeeName.trim()) {
      toast.error("请填写收款人或补款人");
      return;
    }
    try {
      const base64Data = await fileAsBase64(proofFile);
      const proof = await uploadProof.mutateAsync({ projectId, settlementType, settlementId: target.id, fileName: proofFile.name, mimeType: proofFile.type as "image/jpeg" | "image/png" | "application/pdf", base64Data, description: `${target.label}本次${payments.data?.direction === "income" ? "补款" : "付款"}凭证` });
      const result = await record.mutateAsync({ projectId, settlementType, settlementId: target.id, amount: numericAmount, paymentDate, paymentMethod, payeeName: payeeName.trim(), payeeAccount: payeeAccount.trim() || null, paymentReference: paymentReference.trim() || null, evidenceId: proof.evidenceId, remarks: remarks.trim() || null });
      toast.success(result.remainingAmount > 0 ? `已登记本次实际${payments.data?.direction === "income" ? "补款" : "付款"}，待结 ${money(result.remainingAmount)}` : "本单实际资金已登记并结清");
      await Promise.all([utils.settlementPayment.list.invalidate(), onCompleted?.()]);
      onOpenChange(false);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "实际收付登记未完成，请检查凭证和待结余额后重试"));
    }
  };

  const direction = payments.data?.direction === "income" ? "补款" : "付款";
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl xl:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{typeLabel[settlementType]} · 分笔{direction}登记</DialogTitle>
        <DialogDescription>先归档本次真实资金凭证，再登记金额。系统以服务端待结余额校验，不能超额；已产生付款明细的结算单不可作废。</DialogDescription>
      </DialogHeader>
      {payments.isLoading ? <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在核对结算金额和历史资金…</div> : payments.error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">无法读取可付款余额，请确认当前账号具有项目财务权限后重试。</div> : <div className="space-y-4 py-2">
        <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">结算应{direction}</p><p className="mt-1 text-lg font-semibold text-slate-900">{money(payments.data?.dueAmount)}</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">已登记实际{direction}</p><p className="mt-1 text-lg font-semibold text-emerald-800">{money(payments.data?.paidAmount)}</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">待结余额</p><p className="mt-1 text-lg font-semibold text-amber-800">{money(payments.data?.remainingAmount)}</p></div></div>
        {payments.data?.remainingAmount === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">该结算单已无待结余额，不能重复登记资金。</div> : <><div className="grid gap-3 sm:grid-cols-2"><div><Label>本次实际{direction}金额</Label><Input className="mt-1" inputMode="decimal" type="number" min="0.01" max={payments.data?.remainingAmount} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></div><div><Label>{direction}日期</Label><Input className="mt-1" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></div><div><Label>{direction}方式</Label><Select value={paymentMethod} onValueChange={value => setPaymentMethod(value as PaymentMethod)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentMethodLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>收款人 / 补款人</Label><Input className="mt-1" maxLength={128} value={payeeName} onChange={event => setPayeeName(event.target.value)} /></div><div><Label>收款账号（可选）</Label><Input className="mt-1" maxLength={160} value={payeeAccount} onChange={event => setPayeeAccount(event.target.value)} placeholder="银行卡、微信、支付宝或对公账号" /></div><div><Label>付款凭证号 / 流水号（可选）</Label><Input className="mt-1" maxLength={128} value={paymentReference} onChange={event => setPaymentReference(event.target.value)} /></div></div><div><Label>本次实际{direction}凭证 <span className="text-rose-600">*</span></Label><Input className="mt-1" type="file" accept="image/jpeg,image/png,application/pdf" onChange={event => setProofFile(event.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-slate-500">支持 JPG、PNG 或 PDF，最大 15MB；每笔实际收付均须单独上传，文件只在当前结算单受控保存。</p>{proofFile ? <Badge variant="outline" className="mt-2"><FileText className="mr-1 h-3.5 w-3.5" />{proofFile.name}</Badge> : null}</div><div><Label>备注（可选）</Label><Input className="mt-1" maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="例如：本期第一笔、银行回单说明" /></div></>}
        {payments.data?.records.length ? <div className="rounded-xl border border-slate-200"><div className="border-b bg-slate-50 px-3 py-2 text-sm font-medium">已登记资金明细</div><div className="divide-y">{payments.data.records.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><div><p className="font-medium text-slate-800">{money(item.amount)} · {paymentMethodLabel[item.paymentMethod as PaymentMethod] || "其他方式"} · {String(item.paymentDate).slice(0, 10)}</p><p className="mt-0.5 text-slate-500">{item.payeeNameSnapshot}{item.paymentReference ? ` · ${item.paymentReference}` : ""}{item.status === "reversed" ? " · 已冲正" : ""}</p></div>{item.evidence?.url ? <a href={item.evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#176b87] hover:underline"><FileText className="h-3.5 w-3.5" />查看凭证</a> : null}</div>)}</div></div> : null}
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>取消</Button><Button disabled={isBusy || payments.isLoading || Boolean(payments.error) || (payments.data?.remainingAmount ?? 0) <= 0} onClick={() => void submit()}><Landmark className="mr-1.5 h-4 w-4" />{isBusy ? "正在归档并登记…" : `确认登记实际${direction}`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
