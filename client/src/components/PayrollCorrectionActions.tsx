import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { getBusinessStatusLabel } from "./BusinessStatusBadge";

type PayrollCorrectionRow = { id: number; workerName: string; period: string; status: string; actualAmount: string | number };
type PayrollAction = "submit" | "approve" | "return" | "void";

export function permittedPayrollActions(status: string, roles: readonly string[]): PayrollAction[] {
  const actions: PayrollAction[] = [];
  // 提交延用既有 LABOR 访问边界；父级还须传真实访问岗位，服务器再次鉴权。
  if (status === "draft" && roles.some(role => ["ALL", "LABOR_MANAGER", "PROJECT_MANAGER", "ACCOUNTANT", "FINANCE_MANAGER"].includes(role))) actions.push("submit");
  if (status === "reviewing" && (roles.includes("ALL") || roles.includes("ACCOUNTANT"))) actions.push("approve", "return");
  if (["draft", "reviewing", "approved"].includes(status) && roles.some(role => ["ALL", "ACCOUNTANT", "FINANCE_MANAGER"].includes(role))) actions.push("void");
  return actions;
}
const labels: Record<PayrollAction, string> = { submit: "提交审核", approve: "审核通过", return: "退回草稿", void: "作废工资条" };

/** 不伪造撤回/退款接口：审核中会计退回、未付财务作废；partial/paid 仅受控调整建议。 */
export function PayrollCorrectionActions({ row, roleCodes, onChanged }: { row: PayrollCorrectionRow; roleCodes: readonly string[]; onChanged?: () => void | Promise<void> }) {
  const utils = trpc.useUtils();
  const [action, setAction] = useState<PayrollAction | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const [openedKey, setOpenedKey] = useState("");
  const targetKey = JSON.stringify([row.id, row.period, row.status, row.actualAmount, roleCodes]);
  const done = async () => {
    inFlight.current = false; setAction(null); setReason(""); setError("");
    toast.success("工资流程已更新");
    await Promise.all([utils.labor.payroll.list.invalidate(), utils.labor.summary.invalidate(), utils.finance.summary.invalidate()]);
    await onChanged?.();
  };
  const failed = (e: unknown) => { inFlight.current = false; const message = getUserFacingErrorMessage(e, "处理未完成，请核对状态后重试"); setError(message); toast.error(message); };
  const submit = trpc.labor.payroll.submit.useMutation({ onSuccess: done, onError: failed });
  const approve = trpc.labor.payroll.approve.useMutation({ onSuccess: done, onError: failed });
  const voidPayroll = trpc.labor.payroll.void.useMutation({ onSuccess: done, onError: failed });
  const pending = submit.isPending || approve.isPending || voidPayroll.isPending;
  const actions = permittedPayrollActions(row.status, roleCodes);
  const needsReason = action === "void" || action === "return";
  const confirm = () => {
    if (!action || pending || inFlight.current || openedKey !== targetKey || !actions.includes(action)) return;
    if (needsReason && !reason.trim()) { setError("请填写可核查的处理原因"); return; }
    setError(""); inFlight.current = true;
    if (action === "submit") submit.mutate({ id: row.id });
    else if (action === "void") voidPayroll.mutate({ id: row.id, reason: reason.trim() });
    else approve.mutate({ id: row.id, decision: action === "approve" ? "approved" : "returned", ...(action === "return" ? { reason: reason.trim() } : {}) });
  };
  return <><div className="flex flex-wrap justify-end gap-2">{actions.map(item => <Button key={item} size="sm" variant="outline" onClick={() => { setOpenedKey(targetKey); setAction(item); setReason(""); setError(""); }}>{labels[item]}</Button>)}{["partial", "paid"].includes(row.status) && <span className="max-w-48 whitespace-normal text-xs text-slate-500">已有付款，仅允许核查明细；纠错请由财务回原工资业务受控调整，不能作废。</span>}</div><Dialog open={action !== null} onOpenChange={open => { if (!open && !pending && !inFlight.current) { setAction(null); setReason(""); setError(""); } }}><DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{action ? labels[action] : "工资流程"}</DialogTitle><DialogDescription>保留原工资条、依据、凭证和审计。已存在有效资金发生时，服务器会拒绝退回或作废；此处不会退款或自动付款。</DialogDescription></DialogHeader><div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p>人员：{row.workerName}</p><p>工资期间：{row.period}</p><p>状态：{getBusinessStatusLabel(row.status)}</p><p>实发：¥{Number(row.actualAmount).toFixed(2)}</p></div>{needsReason && <div className="space-y-2"><Label htmlFor={`payroll-reason-${row.id}`}>处理原因（必填）</Label><Textarea id={`payroll-reason-${row.id}`} value={reason} disabled={pending} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="说明误录原因及核查依据" /></div>}{openedKey !== targetKey && action && <p role="alert" className="text-sm text-red-700">原单状态或权限已变化，请关闭后刷新核查，旧确认不可提交。</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{pending && <p role="status" className="text-sm text-slate-600">请求已发出，等待服务器回执；请勿重复操作或关闭窗口。</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => { setAction(null); setReason(""); setError(""); }}>取消</Button><Button disabled={pending || openedKey !== targetKey || (needsReason && !reason.trim()) || (action !== null && !actions.includes(action))} onClick={confirm}>{pending ? "处理中…" : "确认办理"}</Button></DialogFooter></DialogContent></Dialog></>;
}
