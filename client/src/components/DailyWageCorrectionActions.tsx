import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { formatChinaDate } from "@/lib/businessTime";

type DailyAction = "submit" | "approve" | "return";
const labels = { submit: "提交审核", approve: "审核通过", return: "退回草稿" };
export function permittedDailyWageActions(status: string, roles: readonly string[]): DailyAction[] {
  if (status === "draft" && roles.some(role => ["ALL", "LABOR_MANAGER", "PROJECT_MANAGER"].includes(role))) return ["submit"];
  if (status === "reviewing" && roles.some(role => ["ALL", "ACCOUNTANT", "FINANCE_MANAGER"].includes(role))) return ["approve", "return"];
  return [];
}
/** 日结没有安全作废/撤回RPC，不新增假入口，审核退回必须核对并填写原因。 */
export function DailyWageCorrectionActions({ row, roleCodes }: { row: { id: number; workerName: string; settlementDate: Date | string; actualAmount: string | number; status: string }; roleCodes: readonly string[] }) {
  const utils = trpc.useUtils();
  const [action, setAction] = useState<DailyAction | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [openedKey, setOpenedKey] = useState("");
  const inFlight = useRef(false);
  const targetKey = JSON.stringify([row.id, row.status, row.actualAmount, roleCodes]);
  const done = async () => {
    inFlight.current = false; setAction(null); setReason(""); setError(""); toast.success("日结流程已更新");
    await Promise.all([utils.labor.dailyWage.list.invalidate(), utils.labor.summary.invalidate(), utils.finance.summary.invalidate()]);
  };
  const failed = (e: unknown) => { inFlight.current = false; const message = getUserFacingErrorMessage(e, "日结处理未完成，请核对后重试"); setError(message); toast.error(message); };
  const submit = trpc.labor.dailyWage.submit.useMutation({ onSuccess: done, onError: failed });
  const review = trpc.labor.dailyWage.review.useMutation({ onSuccess: done, onError: failed });
  const pending = submit.isPending || review.isPending;
  const actions = permittedDailyWageActions(row.status, roleCodes);
  const confirm = () => {
    if (!action || pending || inFlight.current || targetKey !== openedKey || !actions.includes(action)) return;
    if (action === "return" && !reason.trim()) { setError("请填写退回原因"); return; }
    inFlight.current = true; setError("");
    if (action === "submit") submit.mutate({ id: row.id });
    else review.mutate({ id: row.id, decision: action === "approve" ? "approved" : "returned", ...(action === "return" ? { reason: reason.trim() } : {}) });
  };
  return <><div className="flex flex-wrap gap-2">{actions.map(item => <Button key={item} size="sm" variant="outline" onClick={() => { setOpenedKey(targetKey); setAction(item); setReason(""); setError(""); }}>{labels[item]}</Button>)}{["partial", "paid"].includes(row.status) && <span className="max-w-48 whitespace-normal text-xs text-slate-500">已有资金发生，只读核查；纠错须财务受控调整，不作废。</span>}</div><Dialog open={action !== null} onOpenChange={open => { if (!open && !pending && !inFlight.current) { setAction(null); setReason(""); setError(""); } }}><DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{action ? labels[action] : "日结流程"}</DialogTitle><DialogDescription>保持原日结与付款凭证。审核退回只适用于未付审核中记录，服务器在共同付款锁内检查有效资金；不发起退款或付款。</DialogDescription></DialogHeader><div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p>人员：{row.workerName}</p><p>日结日期：{formatChinaDate(row.settlementDate)}</p><p>实发：¥{Number(row.actualAmount).toFixed(2)}</p></div>{action === "return" && <div className="space-y-2"><Label htmlFor={`daily-reason-${row.id}`}>退回原因（必填）</Label><Textarea id={`daily-reason-${row.id}`} value={reason} disabled={pending} maxLength={500} onChange={e => setReason(e.target.value)} /></div>}{openedKey !== targetKey && action && <p role="alert">状态或权限已变化，请关闭重新核对。</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{pending && <p role="status">请求已发出，等待服务器回执，请勿重复操作。</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => { setAction(null); setReason(""); setError(""); }}>取消</Button><Button disabled={pending || openedKey !== targetKey || (action === "return" && !reason.trim())} onClick={confirm}>{pending ? "处理中…" : "确认办理"}</Button></DialogFooter></DialogContent></Dialog></>;
}
