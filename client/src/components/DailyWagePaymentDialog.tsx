import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DailyWagePaymentTarget = { id: number; workerName: string } | null;

export function DailyWagePaymentDialog({
  target,
  paidAt,
  paymentReference,
  pending,
  onClose,
  onPaidAtChange,
  onPaymentReferenceChange,
  onConfirm,
}: {
  target: DailyWagePaymentTarget;
  paidAt: string;
  paymentReference: string;
  pending: boolean;
  onClose: () => void;
  onPaidAtChange: (value: string) => void;
  onPaymentReferenceChange: (value: string) => void;
  onConfirm: () => void;
}) {
  return <Dialog open={Boolean(target)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>登记临时日结实际付款</DialogTitle><DialogDescription>付款日期为必填，付款参考说明可选；系统不发起转账。登记后该日结进入最终已付款状态，不能作废或回写。</DialogDescription></DialogHeader><div className="grid gap-3"><div className="grid gap-2"><Label htmlFor="daily-wage-paid-at">实际付款日期</Label><Input id="daily-wage-paid-at" type="date" value={paidAt} onChange={event => onPaidAtChange(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="daily-wage-payment-reference">付款参考说明（可选）</Label><Input id="daily-wage-payment-reference" value={paymentReference} maxLength={64} placeholder="如银行流水号或付款批次" onChange={event => onPaymentReferenceChange(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={onClose} disabled={pending}>取消</Button><Button disabled={!target || !paidAt || pending} onClick={onConfirm}>{pending ? "正在登记…" : `确认 ${target?.workerName ?? "日结"} 已付款`}</Button></DialogFooter></DialogContent></Dialog>;
}
