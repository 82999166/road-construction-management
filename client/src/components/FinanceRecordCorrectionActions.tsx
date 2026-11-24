import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { formatChinaDateTime } from "@/lib/businessTime";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { getBusinessStatusLabel } from "./BusinessStatusBadge";

export type FinanceCorrectionRow = { id: number | string; projectId: number; recordNo: string; category: string; direction: string; amount: string | number; occurredAt: Date | string; settlementStatus: string; sourceType?: string | null; sourceId?: string | null; remarks?: string | null };
export function permittedFinanceCorrection(record: Pick<FinanceCorrectionRow, "id" | "sourceType" | "sourceId" | "settlementStatus">, roles: readonly string[]) {
  if (typeof record.id !== "number" || record.id <= 0 || record.sourceType || record.sourceId) return null;
  if (record.settlementStatus === "unpaid" && roles.some(role => ["ALL", "ACCOUNTANT", "FINANCE_MANAGER"].includes(role))) return "void" as const;
  if (record.settlementStatus === "paid" && roles.some(role => ["ALL", "FINANCE_MANAGER"].includes(role))) return "reverse" as const;
  return null;
}
/** 原单零覆盖：partial 只读；系统来源返原业务；人工已付才冲销，并保持失败原因与请求日期。 */
export function FinanceRecordCorrectionActions({ record, roleCodes, projectId, onChanged, onOpenSource }: { record: FinanceCorrectionRow; roleCodes: readonly string[]; projectId: number; onChanged?: () => void | Promise<void>; onOpenSource?: (record: FinanceCorrectionRow) => void }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const [openedKey, setOpenedKey] = useState("");
  const targetKey = JSON.stringify([projectId, record.id, record.projectId, record.settlementStatus, record.amount, record.sourceType, record.sourceId, roleCodes]);
  const action = record.projectId === projectId ? permittedFinanceCorrection(record, roleCodes) : null;
  const done = async () => {
    inFlight.current = false; setOpen(false); setReason(""); setConfirmed(false); setError("");
    toast.success(action === "reverse" ? "已取得原流水冲销回执" : "流水已作废");
    await Promise.all([utils.finance.summary.invalidate(), utils.finance.listRecords.invalidate(), utils.finance.businessSummary.invalidate()]);
    await onChanged?.();
  };
  const failed = (e: unknown) => { inFlight.current = false; const message = getUserFacingErrorMessage(e, "处理未完成，请核对后重试"); setError(message); toast.error(message); };
  const voidRecord = trpc.finance.voidRecord.useMutation({ onSuccess: done, onError: failed });
  const reverse = trpc.finance.reverseRecord.useMutation({ onSuccess: done, onError: failed });
  const pending = voidRecord.isPending || reverse.isPending;
  const confirm = () => {
    if (pending || inFlight.current || openedKey !== targetKey || !action || typeof record.id !== "number") return;
    if (!reason.trim() || !confirmed || (action === "reverse" && !/^\d{4}-\d{2}-\d{2}$/.test(date))) { setError("请核对原单、填写原因并确认资金事实及开放业务日"); return; }
    inFlight.current = true; setError("");
    if (action === "void") voidRecord.mutate({ id: record.id, projectId, reason: reason.trim() });
    // 沿用服务器现有 UTC 业务日，不偷偷更改封账归属口径；北京时间展示单独转换。
    else reverse.mutate({ id: record.id, projectId, reason: reason.trim(), reversedAt: `${date}T00:00:00.000Z` });
  };
  if (record.sourceType || record.sourceId) return onOpenSource ? <Button size="sm" variant="outline" onClick={() => onOpenSource(record)}>回来源业务</Button> : <span className="text-xs text-slate-500">来源流水须回原业务调整</span>;
  if (!action) return record.settlementStatus === "partial" ? <span className="text-xs text-slate-500">部分结清只读，请财务核查来源后受控调整</span> : null;
  return <><Button size="sm" variant="outline" onClick={() => { setOpenedKey(targetKey); setOpen(true); setError(""); setReason(""); setConfirmed(false); setDate(new Date().toISOString().slice(0, 10)); }}>{action === "reverse" ? "冲销人工流水" : "作废未付流水"}</Button><Dialog open={open} onOpenChange={next => { if (!pending && !inFlight.current) { setOpen(next); if (!next) { setReason(""); setConfirmed(false); setError(""); } } }}><DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{action === "reverse" ? "冲销已付人工流水" : "作废未付人工流水"}</DialogTitle><DialogDescription>{action === "reverse" ? "财务负责人核实原单和实际资金事实后，按开放业务日追加相反方向等额冲销。原单、原金额与凭证不变；不会发起银行退款或自动付款。" : "会计或财务负责人仅可作废完全未付的人工流水。工资、结算付款与其他来源业务不在此直接改删。"}</DialogDescription></DialogHeader><div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p>原单：{record.recordNo}</p><p>资金细项：{record.category}</p><p>状态：{getBusinessStatusLabel(record.settlementStatus)}</p><p>原金额：¥{Number(record.amount).toFixed(2)}</p><p>方向：{record.direction === "income" ? "收入" : "支出"}{action === "reverse" && ` → ${record.direction === "income" ? "支出" : "收入"}`}</p><p>北京时间：{formatChinaDateTime(record.occurredAt)}</p><p className="sm:col-span-2 break-words">说明：{record.remarks || "—"}</p></div>{action === "reverse" && <div className="space-y-2"><Label htmlFor={`reverse-day-${record.id}`}>冲销记账业务日（现有 UTC 日结口径）</Label><Input id={`reverse-day-${record.id}`} type="date" value={date} disabled={pending} onChange={e => { setDate(e.target.value); setConfirmed(false); }} /><p className="text-xs text-slate-500">服务器在项目锁内重新检查封账；封存日将拒绝，原因和输入保留。原已封账单不被解封或覆盖。</p></div>}<div className="space-y-2"><Label htmlFor={`finance-reason-${record.id}`}>处理原因（必填）</Label><Textarea id={`finance-reason-${record.id}`} value={reason} disabled={pending} maxLength={500} onChange={e => { setReason(e.target.value); setConfirmed(false); }} placeholder="说明原因、原资金事实和核查依据" /></div><label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} disabled={pending} onCheckedChange={value => setConfirmed(value === true)} />我已核对原单、金额及资金事实；本操作只追加调整，不代表银行退款或付款。</label>{openedKey !== targetKey && open && <p role="alert" className="text-sm text-red-700">项目、原单状态或权限已变化，请关闭后重新核对，旧确认不可提交。</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{pending && <p role="status" className="text-sm text-slate-600">请求已发出，等待服务器回执；请勿重复点击或关闭窗口。</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => { setOpen(false); setReason(""); setConfirmed(false); setError(""); }}>取消</Button><Button disabled={pending || openedKey !== targetKey || !confirmed || !reason.trim() || !action} onClick={confirm}>{pending ? "处理中…" : "确认办理"}</Button></DialogFooter></DialogContent></Dialog></>;
}
