import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MachineCostDuplicateConfirmation } from "./MachineCostDuplicateConfirmation";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { formatChinaDateTime, toDeviceDateTimeInput } from "@/lib/businessTime";
import { createEngineeringWatermarkedImage } from "@/lib/engineeringWatermark";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE } from "@shared/watermarkTemplate";
import type { MachineCostEditDraft, MachineCostDuplicateCheck } from "@shared/machineCostDuplicate";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type PendingEdit = { input: MachineCostEditDraft; check: MachineCostDuplicateCheck; identity: string };
/** 不借用创建 requestId；同步 busy 和身份序列隔离取消、换对象、迟到预检/保存。 */
export function useGuardedMachineCostEdit({ identity, onSuccess, onSaved }: { identity: string; onSuccess: () => void | Promise<void>; onSaved?: () => void | Promise<void> }) {
  const preflight = trpc.machinery.checkCostEditDuplicate.useMutation();
  const mutation = trpc.machinery.updateCostDraft.useMutation();
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0), current = useRef(identity);
  current.current = identity;
  const prepared = useRef<{ identity: string; input: MachineCostEditDraft } | null>(null);
  const pendingRef = useRef<PendingEdit | null>(null);
  const [pending, setPending] = useState<PendingEdit | null>(null), [isPending, setBusy] = useState(false);
  const reset = () => { generation.current++; prepared.current = null; pendingRef.current = null; if (mounted.current) setPending(null); };
  useEffect(() => { reset(); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const valid = (origin: string, ticket: number) => mounted.current && current.current === origin && generation.current === ticket;
  function setConfirmation(value: PendingEdit | null) { pendingRef.current = value; setPending(value); }
  async function save(input: MachineCostEditDraft, origin: string, ticket: number, duplicateConfirmation?: { token: string; reason: string }) {
    if (!valid(origin, ticket)) return;
    const result = await mutation.mutateAsync({ ...input, duplicateConfirmation });
    if (result.success) await onSaved?.();
    if (!valid(origin, ticket)) { if (mounted.current && result.success) toast.success("上次草稿修改已完成，请核对台账；当前输入未提交"); return; }
    if (!result.success) { setConfirmation({ input, check: result.duplicateCheck, identity: origin }); return; }
    setConfirmation(null); prepared.current = null; await onSuccess();
  }
  async function prepare(getInput: (assertCurrent: () => void) => Promise<MachineCostEditDraft> | MachineCostEditDraft) {
    if (!mounted.current || busy.current || pendingRef.current) return;
    busy.current = true; setBusy(true);
    const origin = current.current, ticket = generation.current;
    const assertCurrent = () => { if (!valid(origin, ticket)) throw Error("费用输入已变化，本次准备已取消"); };
    try {
      const input = prepared.current?.identity === origin ? prepared.current.input : await getInput(assertCurrent);
      if (!valid(origin, ticket)) return;
      prepared.current = { identity: origin, input };
      const check = await preflight.mutateAsync(input);
      if (!valid(origin, ticket)) return;
      if (check.candidates.length) { setConfirmation({ input, check, identity: origin }); return; }
      await save(input, origin, ticket);
    } catch (error) { if (valid(origin, ticket)) toast.error(getUserFacingErrorMessage(error, "修改未完成，输入已保留，请核对台账后重试")); }
    finally { busy.current = false; if (mounted.current) setBusy(false); }
  }
  async function confirm(reason: string) {
    const p = pendingRef.current;
    if (busy.current || !p || p.identity !== current.current || p.check.hardConflict || !p.check.confirmationToken || !p.check.expiresAt || Date.now() >= p.check.expiresAt || reason.trim().length < 10 || reason.trim().length > 300) return;
    busy.current = true; setBusy(true); const ticket = generation.current;
    try { await save(p.input, p.identity, ticket, { token: p.check.confirmationToken, reason: reason.trim() }); }
    catch (error) { if (valid(p.identity, ticket)) toast.error(getUserFacingErrorMessage(error, "修改未完成，输入已保留")); }
    finally { busy.current = false; if (mounted.current) setBusy(false); }
  }
  return { isPending, prepare, cancel: reset, confirmationDialog: <MachineCostDuplicateConfirmation check={pending?.identity === identity ? pending.check : null} busy={isPending} onCancel={reset} onConfirm={reason => void confirm(reason)} /> };
}

export type MachineCostEditTarget = { id: number; projectId: number; machineId: number };
export default function MachineCostEditDialog({ target, onClose }: { target: MachineCostEditTarget; onClose: () => void }) {
  const query = trpc.machinery.getCostForEdit.useQuery(target, { retry: false });
  const closeAction = useRef<(() => void) | null>(null);
  return <Dialog open onOpenChange={open => { if (!open) { if (closeAction.current) closeAction.current(); else onClose(); } }}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>修改机械费用草稿 #{target.id}</DialogTitle><DialogDescription>项目与机械身份固定；只能修改未审核且未被月结/付款占用的草稿，燃油同时同步原柴油镜像。</DialogDescription></DialogHeader>
    {query.data ? <MachineCostEditForm key={`${target.projectId}:${target.machineId}:${target.id}`} cost={query.data} onClose={onClose} closeAction={closeAction} /> : query.isLoading ? <p>正在核对原费用和编辑权限…</p> : query.error ? <p role="alert">{getUserFacingErrorMessage(query.error, "费用不可修改")}</p> : <p>费用不存在。</p>}
  </DialogContent></Dialog>;
}

type EditableCost = inferRouterOutputs<AppRouter>["machinery"]["getCostForEdit"];
function MachineCostEditForm({ cost: fetchedCost, onClose, closeAction }: { cost: EditableCost; onClose: () => void; closeAction: { current: (() => void) | null } }) {
  const [cost] = useState(fetchedCost);
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const capture = trpc.evidence.captureConfig.useQuery(undefined, { retry: false });
  const upload = trpc.evidence.upload.useMutation();
  const [draft, setDraft] = useState({ costType: cost.costType, costName: cost.costName ?? "", quantity: String(cost.quantity), unitPrice: String(cost.unitPrice), occurredAt: toDeviceDateTimeInput(cost.occurredAt), remarks: cost.remarks ?? "" });
  const [photo, setPhoto] = useState<File | null>(null), [dirty, setDirty] = useState(false);
  const originalTime = useRef(new Date(cost.occurredAt).toISOString());
  const originalDisplay = useRef(toDeviceDateTimeInput(cost.occurredAt));
  const candidateTime = new Date(draft.occurredAt);
  const validTime = Number.isFinite(candidateTime.getTime());
  const occurredAt = draft.occurredAt === originalDisplay.current ? originalTime.current : validTime ? candidateTime.toISOString() : originalTime.current;
  const price = trpc.machinery.fuelCostDefault.useQuery({ projectId: cost.projectId, occurredAt }, { enabled: draft.costType === "fuel", retry: false });
  const identity = JSON.stringify([cost.projectId, cost.machineId, cost.id, cost.version, draft, photo?.name, photo?.size, photo?.lastModified]);
  const guard = useGuardedMachineCostEdit({ identity, onSaved: async () => {
    await Promise.all([utils.machinery.invalidate(), utils.admin.diesel.invalidate(), utils.diesel.invalidate(), utils.finance.invalidate()]);
  }, onSuccess: () => {
    toast.success("机械费用草稿已修改，原凭证和修改审计已保留");
    onClose();
  } });
  function close() { if (guard.isPending || (dirty && !window.confirm("放弃本次尚未保存的费用修改？"))) return; guard.cancel(); onClose(); }
  closeAction.current = close;
  useEffect(() => () => { closeAction.current = null; }, [closeAction]);
  function change<K extends keyof typeof draft>(key: K, value: typeof draft[K]) { setDirty(true); setDraft(current => ({ ...current, [key]: value })); }
  async function submit() {
    if (!draft.costName.trim() || !validTime || !draft.quantity || !draft.unitPrice || !Number.isFinite(Number(draft.quantity)) || !Number.isFinite(Number(draft.unitPrice))) return toast.error("请填写有效费用名称、数量、单价和时间");
    await guard.prepare(async assertCurrent => {
      let evidenceId = cost.evidenceId;
      if (photo) {
        if (!capture.data) throw Error("照片水印与定位配置尚未就绪，请稍后重试");
        const location = await new Promise<GeolocationPosition | null>(resolve => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 10_000, maximumAge: 0, enableHighAccuracy: true });
        });
        assertCurrent();
        if (capture.data.location.required && !location) throw Error("该项目要求现场定位，照片未归档");
        const capturedAt = new Date(), template = capture.data.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
        const values: Record<string, string> = { capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`, principal: `费用修改人：${user?.name ?? "当前管理员"}`,
          weather: `费用草稿：${draft.costName}`, location: "详细地点：机械费用补证", coordinates: location ? `定位：${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}` : "定位：未取得",
          organization: `施工单位：${template.organizationLabel}`, project: `项目编号：${cost.projectId}`, antiCounterfeit: `防伪编号：${cost.projectId}-${cost.machineId}-${capturedAt.getTime()}` };
        const file = await createEngineeringWatermarkedImage(photo, template.fields.map(field => values[field]).filter(Boolean), template);
        assertCurrent();
        const base64Data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(Error("照片读取失败")); reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, "")); reader.readAsDataURL(file); });
        assertCurrent();
        const result = await upload.mutateAsync({ projectId: cost.projectId, sourceType: "other", sourceId: `machine-cost-pending-${cost.machineId}-${capturedAt.getTime()}`,
          description: `费用草稿 #${cost.id} 修改补证：${draft.costName}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.coords.longitude ?? null, latitude: location?.coords.latitude ?? null,
          fileName: file.name, mimeType: "image/jpeg", base64Data });
        assertCurrent(); evidenceId = result.id;
      }
      return { id: cost.id, projectId: cost.projectId, machineId: cost.machineId, version: cost.version, ...draft, quantity: Number(draft.quantity), unitPrice: Number(draft.unitPrice), occurredAt, evidenceId };
    });
  }
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">原登记人 #{cost.creatorId} · 原发生时间 {formatChinaDateTime(cost.occurredAt)}。不改变时间时保留原秒及毫秒。</p>
    <fieldset disabled={guard.isPending} className="space-y-3">
      <label className="block">费用类别<select aria-label="编辑费用类别" className="w-full rounded border bg-background p-2" value={draft.costType} onChange={e => change("costType", e.target.value as typeof draft.costType)} disabled={cost.costType === "fuel"}>{(cost.costType === "fuel" ? ["fuel"] : ["repair", "overtime", "mobilization", "other"]).map(type => <option key={type} value={type}>{{ fuel: "油料", repair: "维修", overtime: "加班", mobilization: "进退场", other: "其他" }[type]}</option>)}</select></label>
      <label className="block">费用名称<input aria-label="编辑费用名称" className="w-full rounded border bg-background p-2" maxLength={128} value={draft.costName} onChange={e => change("costName", e.target.value)} /></label>
      <label className="block">数量<input aria-label="编辑费用数量" type="number" min="0" step="0.001" className="w-full rounded border bg-background p-2" value={draft.quantity} onChange={e => change("quantity", e.target.value)} /></label>
      <label className="block">单价<input aria-label="编辑费用单价" type="number" min="0" step="0.01" className="w-full rounded border bg-background p-2" disabled={draft.costType === "fuel"} value={draft.costType === "fuel" ? price.data?.guidelinePrice ?? draft.unitPrice : draft.unitPrice} onChange={e => change("unitPrice", e.target.value)} /></label>
      <p className="text-xs">{draft.costType === "fuel" ? "燃油由服务端重新匹配发生日有效柴油指导价；" : ""}金额由系统按数量 × 单价计算，不可直接修改。</p>
      <label className="block">发生时间（设备时区）<input aria-label="编辑费用时间" type="datetime-local" className="w-full rounded border bg-background p-2" value={draft.occurredAt} onChange={e => change("occurredAt", e.target.value)} /></label>
      <label className="block">备注<textarea aria-label="编辑费用备注" className="w-full rounded border bg-background p-2" maxLength={500} value={draft.remarks} onChange={e => change("remarks", e.target.value)} /></label>
      <p className="text-xs">{cost.evidenceId ? `保留原水印照片 #${cost.evidenceId}；` : "原费用未关联照片；"}不选新照片不清空凭证。新照片自动水印归档，旧照片引用保留审计。</p>
      <label className="block">替换/补充照片<input aria-label="编辑费用照片" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setPhoto(e.target.files?.[0] ?? null); setDirty(true); }} /></label>
    </fieldset>
    <DialogFooter><Button type="button" variant="outline" disabled={guard.isPending} onClick={close}>取消</Button><Button type="button" disabled={guard.isPending || (draft.costType === "fuel" && !price.data?.guidelinePrice)} onClick={() => void submit()}>{guard.isPending ? "核验并保存修改…" : "保存草稿修改"}</Button></DialogFooter>
    {guard.confirmationDialog}
  </div>;
}
