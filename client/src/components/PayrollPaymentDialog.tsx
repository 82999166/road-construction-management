import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PayrollPaymentTarget = { id: number; workerName: string } | null;

export function PayrollPaymentDialog({
  target,
  paymentReference,
  pending,
  onClose,
  onPaymentReferenceChange,
  onConfirm,
}: {
  target: PayrollPaymentTarget;
  paymentReference: string;
  pending: boolean;
  onClose: () => void;
  onPaymentReferenceChange: (value: string) => void;
  onConfirm: () => void;
}) {
  return <Dialog open={Boolean(target)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>确认工资发放</DialogTitle><DialogDescription>系统不会发起银行转账。请在外部资金流程完成后，填写付款凭证号或资金流水号，服务端会复核财务岗位、项目范围和工资条状态。</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="payment-reference">付款凭证号 / 资金流水号</Label><Input id="payment-reference" value={paymentReference} placeholder="至少 4 个字符" onChange={event => onPaymentReferenceChange(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={onClose} disabled={pending}>取消</Button><Button disabled={!target || paymentReference.trim().length < 4 || pending} onClick={onConfirm}>{pending ? "正在确认…" : `确认 ${target?.workerName ?? "工资条"} 发放`}</Button></DialogFooter></DialogContent></Dialog>;
}
