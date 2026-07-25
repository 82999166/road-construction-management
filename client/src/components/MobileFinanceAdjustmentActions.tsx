import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Ban, RotateCcw } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

/** 客户端仅隐藏明显无权操作，项目范围、角色与终态限制始终在服务端再次校验。 */
export function canAdjustFinancialRecord(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER") || roleCodes.includes("ACCOUNTANT");
}

/** 自动来源流水必须返回原业务模块调整；人工未支付流水作废，已支付流水生成相反方向冲销。 */
export function getFinancialRecordAdjustmentAction(record: { sourceType?: string | null; settlementStatus: string }) {
  if (record.sourceType || record.settlementStatus === "void") return null;
  if (record.settlementStatus === "paid") return "reverse" as const;
  if (["unpaid", "partial"].includes(record.settlementStatus)) return "void" as const;
  return null;
}

type FinancialRecordForAdjustment = {
  id: number;
  recordNo: string;
  category: string;
  sourceType?: string | null;
  settlementStatus: string;
};

type MobileFinanceAdjustmentActionsProps = {
  projectId: number;
  roleCodes: readonly string[];
  record: FinancialRecordForAdjustment;
};

/** 仅为人工财务流水提供原因必填的作废或冲销入口，成功后刷新同项目财务列表和汇总。 */
export function MobileFinanceAdjustmentActions({ projectId, roleCodes, record }: MobileFinanceAdjustmentActionsProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = canAdjustFinancialRecord(roleCodes) ? getFinancialRecordAdjustmentAction(record) : null;
  const refreshFinancialData = async () => {
    await Promise.all([utils.finance.listRecords.invalidate(), utils.finance.summary.invalidate()]);
  };
  const voidRecord = trpc.finance.voidRecord.useMutation({
    onSuccess: async () => {
      toast.success("财务流水已作废");
      setOpen(false);
      setReason("");
      await refreshFinancialData();
    },
    onError: error => toast.error(error.message),
  });
  const reverseRecord = trpc.finance.reverseRecord.useMutation({
    onSuccess: async () => {
      toast.success("已生成相反方向的冲销流水");
      setOpen(false);
      setReason("");
      await refreshFinancialData();
    },
    onError: error => toast.error(error.message),
  });

  if (!action) return null;
  const isPending = voidRecord.isPending || reverseRecord.isPending;
  const title = action === "reverse" ? "冲销已支付流水" : "作废未支付流水";
  const description = action === "reverse"
    ? "系统将新增一条相反方向的已结清流水，原始台账不会被删除或改写。"
    : "作废仅适用于尚未支付的人工流水；来源业务流水需回原业务模块调整。";

  function submit() {
    const normalizedReason = reason.trim();
    if (!normalizedReason) return toast.error("请填写处理原因，以便审计追溯");
    if (action === "void") {
      voidRecord.mutate({ id: record.id, projectId, reason: normalizedReason });
      return;
    }
    reverseRecord.mutate({ id: record.id, projectId, reversedAt: new Date().toISOString(), reason: normalizedReason });
  }

  return <><Button size="sm" variant="outline" className={action === "reverse" ? "h-8 border-amber-200 text-amber-800 hover:bg-amber-50" : "h-8 border-rose-200 text-rose-700 hover:bg-rose-50"} onClick={() => setOpen(true)}>{action === "reverse" ? <><RotateCcw className="mr-1 h-3.5 w-3.5" />冲销</> : <><Ban className="mr-1 h-3.5 w-3.5" />作废</>}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-3"><div className="rounded-xl bg-[#fff7ed] px-3 py-2 text-sm text-[#765542]"><p className="font-medium">{record.category}</p><p className="mt-1 text-xs">单据号：{record.recordNo}</p></div><div><Label htmlFor={`financial-adjustment-reason-${record.id}`}>处理原因</Label><Textarea id={`financial-adjustment-reason-${record.id}`} className="mt-1" value={reason} onChange={event => setReason(event.target.value)} placeholder="请填写作废或冲销的业务原因" /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button className={action === "reverse" ? "bg-amber-700 hover:bg-amber-800" : "bg-rose-700 hover:bg-rose-800"} disabled={isPending} onClick={submit}>{action === "reverse" ? "确认冲销" : "确认作废"}</Button></DialogFooter></DialogContent></Dialog></>;
}
