import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";

export function IdentityDeletionImpactPreview({ resource, id }: { resource: "project" | "organization"; id: number }) {
  const impact = trpc.admin.masterData.deletionImpact.useQuery({ resource, id }, { retry: false });
  return <section className="min-w-0 space-y-3 break-words text-sm" aria-label="只读引用影响预览">
    <p className="rounded-lg bg-amber-50 p-3 text-amber-900">硬删除已关闭。建议{resource === "project" ? "在项目状态中选择归档并保存" : "在组织状态中选择停用并保存"}，保留原身份和业务历史；请勿清理历史来满足删除条件。</p>
    <p className="text-xs text-slate-500">即时只读预览不是冻结快照；作废、冲销、撤销、停用及历史记录也计入引用。即使暂未发现引用，仍不能硬删除。</p>
    {impact.isLoading || impact.isFetching ? <p role="status">正在读取实际引用…</p> : impact.isError ? <div role="alert"><p>{getUserFacingErrorMessage(impact.error, "引用检查失败，不能视为空结果")}</p><Button variant="outline" onClick={() => void impact.refetch()}>重新读取引用</Button></div> : impact.data ? <>
      <p>当前对象：{impact.data.name} · 状态：{impact.data.status} · 硬删除：{impact.data.canHardDelete === false ? "不可用" : "不可用（前端保守关闭）"}</p>
      {impact.data.references.length ? <ul className="space-y-2">{impact.data.references.map(ref => <li key={`${ref.table}.${ref.field}`} className="min-w-0 rounded border p-2 [overflow-wrap:anywhere]">{ref.table}.{ref.field}：{ref.count} 条</li>)}</ul> : <p>暂未发现本次扫描覆盖的引用；这不是删除许可，请归档/停用。</p>}
    </> : <p>尚未取得引用检查结果，不能执行删除。</p>}
  </section>;
}

export type ScopeReactivationTarget = {
  scopeType: "project" | "organization";
  scopeId: number;
  module: "CONSTRUCTION" | "LABOR" | "MACHINERY" | "TRANSPORT" | "PURCHASING" | "MEASUREMENT" | "CONTRACT" | "FINANCE" | "DIESEL" | "EVIDENCE";
  label: string;
};
export type ScopeReactivationInput = Omit<ScopeReactivationTarget, "label"> & { status: "active"; expectedStatus: "disabled"; confirmReactivate: true; reason: string };
export function scopeReactivationInput(target: ScopeReactivationTarget, reason: string, confirmed: boolean): ScopeReactivationInput | null {
  const trimmed = reason.trim();
  if (!confirmed || trimmed.length < 4 || trimmed.length > 200) return null;
  const { label: _label, ...identity } = target;
  return { ...identity, status: "active", expectedStatus: "disabled", confirmReactivate: true, reason: trimmed };
}
/** 父页面用 key 隔离对象；请求完成前不能关闭，失败不丢确认原因。 */
export function ScopeReactivationDialog({ target, onClose, onConfirm }: { target: ScopeReactivationTarget; onClose: () => void; onConfirm: (input: ScopeReactivationInput) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const input = scopeReactivationInput(target, reason, confirmed);
  const submit = async () => {
    if (inFlight.current || !input) return;
    inFlight.current = true; setPending(true); setError("");
    try { await onConfirm(input); onClose(); }
    catch (e) { setError(getUserFacingErrorMessage(e, "重新启用未完成，请刷新核对后重试")); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}><DialogContent className="min-w-0 w-[calc(100vw-2rem)] max-w-3xl max-h-[90dvh] overflow-y-auto overflow-x-hidden break-words sm:max-w-3xl"><DialogHeader><DialogTitle>确认重新启用已收回模块</DialogTitle><DialogDescription>{target.label}。这将重新启用显式模块配置，但不会增加角色、项目数据范围或具体操作权限；不是恢复继承。</DialogDescription></DialogHeader><div className="min-w-0 space-y-2"><Label htmlFor="scope-reactivation-reason">重新启用原因（4–200 字）</Label><Textarea id="scope-reactivation-reason" value={reason} disabled={pending} maxLength={200} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></div><label className="flex min-w-0 items-start gap-2 text-sm"><Checkbox checked={confirmed} disabled={pending} onCheckedChange={value => setConfirmed(value === true)} /><span>我已核对对象及模块，明确确认重新启用当前 disabled 配置。</span></label>{error && <p role="alert" className="text-sm text-red-700 [overflow-wrap:anywhere]">{error}</p>}{pending && <p role="status">正在等待服务器回执，请勿重复提交或关闭。</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>取消</Button><Button disabled={pending || !input} onClick={() => void submit()}>{pending ? "处理中…" : "确认重新启用"}</Button></DialogFooter></DialogContent></Dialog>;
}
