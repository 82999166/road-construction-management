import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { formatChinaDateTime } from "@/lib/businessTime";
import { machineryCostType, machineryStatus } from "@/lib/machineryWorkspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MachineCostDraft, MachineCostDuplicateCheck } from "@shared/machineCostDuplicate";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Saved = Extract<inferRouterOutputs<AppRouter>["machinery"]["saveCost"], { success: true }>;
export function MachineCostDuplicateConfirmation({ check, busy, onCancel, onConfirm }: {
  check: MachineCostDuplicateCheck | null; busy: boolean; onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setReason(""); setAcknowledged(false); setExpired(false);
    if (!check?.expiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, check.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [check]);
  const canConfirm = !busy && !expired && acknowledged && reason.trim().length >= 10
    && Boolean(check?.confirmationToken) && !check?.hardConflict
    && Boolean(check?.expiresAt && Date.now() < check.expiresAt);
  return <Dialog open={Boolean(check)} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>发现已存在的疑似费用，请勿重复录入</DialogTitle>
        <DialogDescription>按当前授权项目、同机械、北京时间同日、费用类别/名称和两位数量、单价及金额检查。以下是已保存的真实记录，不代表已认定重复业务。</DialogDescription></DialogHeader>
      <div className="space-y-2" aria-label="已存在费用记录">
        {check?.candidates.map(row => <div key={row.id} className="rounded border p-3 text-sm">
          <p className="font-semibold">记录 #{row.id} · {row.costName || "历史记录（未填写费用名称）"}</p>
          <p>{formatChinaDateTime(row.occurredAt)}（北京时间） · {machineryCostType(row.costType)}</p>
          <p>数量 {row.quantity == null ? "未记录" : Number(row.quantity).toFixed(2)} × 单价 {row.unitPrice == null ? "未记录" : Number(row.unitPrice).toFixed(2)} · 金额 ¥{Number(row.amount).toFixed(2)}</p>
          <p>状态：{row.status ? machineryStatus(row.status) : "历史有效记录（未填写状态）"}</p>
        </div>)}
      </div>
      {check?.hardConflict ? <p role="alert" className="text-sm text-destructive">同一发生时间或同一照片凭证已有费用，本次不能重复入账。请取消并核对台账；如确实另笔业务，请填写真实发生时间和独立凭证。</p>
        : check?.candidates.length ? <div className="space-y-3 text-sm">
          <p>确属同日不同实际业务时，必须核对记录并填写可核查依据；提交时服务端会再次检查。新增冲突、状态变化、改动表单或超时均需重新确认。</p>
          <label className="block">不同业务依据（至少10字）<textarea aria-label="不同业务依据" className="mt-1 w-full rounded border bg-background p-2" maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="例如：第二次独立维修，发生时间、供应商或票据编号不同" /></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />我已逐笔核对，确认这是不同实际业务，不是重试或重复登记。</label>
          {expired && <p role="alert">确认已超时，请取消后重新检查。</p>}
        </div> : <p role="alert">检查结果已变化，请取消后重新检查再保存。</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { if (!busy) onCancel(); }}>取消并检查已有记录</Button>
        {!check?.hardConflict && Boolean(check?.candidates.length) && <Button type="button" disabled={!canConfirm} onClick={() => { if (canConfirm && check?.expiresAt && Date.now() < check.expiresAt) onConfirm(reason.trim()); }}>{busy ? "重新核验并保存…" : "确认为不同实际业务，二次确认保存"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

type PreparationGuard = { assertCurrent: () => void };
type Confirmation = { check: MachineCostDuplicateCheck; input: MachineCostDraft; identity: string };
/** 同步 ref 防止双击；同一输入网络失败保留请求 ID；预检/照片处理的迟到结果不可保存。 */
export function useGuardedMachineCost({ identity, onSuccess, onError }: {
  identity: string; onSuccess: (data: Saved) => void | Promise<void>; onError?: (error: unknown) => void;
}) {
  const checkMutation = trpc.machinery.checkCostDuplicate.useMutation();
  const saveMutation = trpc.machinery.saveCost.useMutation();
  const [isPending, setPending] = useState(false);
  const [pending, setConfirmationState] = useState<Confirmation | null>(null);
  const pendingRef = useRef<Confirmation | null>(null);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(true);
  const busy = useRef(false);
  const sequence = useRef(0);
  const request = useRef<{ identity: string; id: string; input?: MachineCostDraft; attempted?: boolean; confirmation?: { token: string; reason: string } } | null>(null);
  function setConfirmation(value: Confirmation | null) {
    pendingRef.current = value;
    if (mounted.current) setConfirmationState(value);
  }
  function cancel() {
    sequence.current++;
    request.current = null; // 取消不是网络重试：不能复用过期输入、凭证或确认授权。
    setConfirmation(null);
  }
  useEffect(() => { cancel(); }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; request.current = null; pendingRef.current = null; };
  }, []);
  function isCurrent(origin: string, ticket: number) {
    return mounted.current && origin === currentIdentity.current && ticket === sequence.current;
  }
  function errorHandler(error: unknown) {
    if (onError) onError(error);
    else toast.error(getUserFacingErrorMessage(error, "费用核验或保存未完成，请检查台账后重试"));
  }
  async function save(input: MachineCostDraft, origin: string, ticket: number, confirmation?: { token: string; reason: string }) {
    if (!isCurrent(origin, ticket)) return;
    if (request.current) { request.current.attempted = true; request.current.confirmation = confirmation; }
    const result = await saveMutation.mutateAsync({ ...input, duplicateConfirmation: confirmation });
    if (!isCurrent(origin, ticket)) {
      if (mounted.current && result.success) toast.success("上次费用请求已保存，请检查台账；当前新输入未提交");
      return;
    }
    if (!result.success) {
      if (request.current) { request.current.attempted = false; request.current.confirmation = undefined; }
      setConfirmation({ check: result.duplicateCheck, input, identity: origin }); return;
    }
    setConfirmation(null);
    request.current = null;
    await onSuccess(result);
  }
  async function prepare(getInput: (guard: PreparationGuard) => Promise<MachineCostDraft> | MachineCostDraft) {
    if (!mounted.current || busy.current || pendingRef.current) return;
    busy.current = true; setPending(true);
    const origin = currentIdentity.current;
    const ticket = sequence.current;
    const guard = { assertCurrent: () => { if (!isCurrent(origin, ticket)) throw new Error("费用输入已变化，本次准备已取消"); } };
    if (request.current?.identity !== origin) request.current = { identity: origin, id: crypto.randomUUID() };
    const activeRequest = request.current;
    try {
      // 已上传照片在同输入网络重试中复用，不生成第二个来源凭证。
      const input = activeRequest.input ?? { ...await getInput(guard), requestId: activeRequest.id };
      if (!isCurrent(origin, ticket)) return;
      activeRequest.input = input;
      if (activeRequest.attempted) { await save(input, origin, ticket, activeRequest.confirmation); return; }
      const check = await checkMutation.mutateAsync(input);
      if (!isCurrent(origin, ticket)) return;
      if (check.candidates.length) { setConfirmation({ check, input, identity: origin }); return; }
      await save(input, origin, ticket);
    } catch (error) { if (isCurrent(origin, ticket)) errorHandler(error); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function confirm(reason: string) {
    const confirmation = pendingRef.current;
    if (!mounted.current || busy.current || !confirmation || !confirmation.check.confirmationToken || confirmation.check.hardConflict || reason.trim().length < 10 || reason.trim().length > 300) return;
    if (confirmation.identity !== currentIdentity.current || !confirmation.check.expiresAt || Date.now() >= confirmation.check.expiresAt) {
      cancel(); return;
    }
    busy.current = true; setPending(true);
    const ticket = sequence.current;
    try { await save(confirmation.input, confirmation.identity, ticket, { token: confirmation.check.confirmationToken, reason: reason.trim() }); }
    catch (error) { if (isCurrent(confirmation.identity, ticket)) errorHandler(error); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return {
    isPending, prepare,
    mutate: (input: MachineCostDraft) => { void prepare(() => input); },
    confirmationDialog: <MachineCostDuplicateConfirmation check={pending?.identity === identity ? pending.check : null} busy={isPending} onCancel={cancel} onConfirm={reason => { void confirm(reason); }} />,
  };
}
