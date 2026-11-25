import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TakeoffFields, TakeoffSection } from "@/components/TakeoffFields";
import { TAKEOFF_DIALOG_LAYOUT, TakeoffPhotoGallery, readTakeoffPhoto, takeoffCoordinates } from "@/components/TakeoffPhotos";
import { useMobileFormProtection } from "@/contexts/MobileFormProtectionContext";
import { clearMobileDraft, hasMobileDraftContent, readMobileDraft, saveMobileDraft } from "@/lib/mobileDraftStorage";
import { draftFromDetail, emptyTakeoffDraft, ordinaryTakeoffDraft, restoreOrdinaryTakeoffDraft, takeoffSaveInput, takeoffCreateAttempt, type TakeoffCreateAttempt, type TakeoffDraft, type TakeoffDetail, type TakeoffSaveInput } from "@/lib/takeoffEditorModel";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type UploadedPhoto = { evidenceId: number; fileName: string; mimeType: "image/jpeg" | "image/png"; previewUrl: string };
export function TakeoffEditor({ projectId, projectName, id, mobile = false, sessionIdentity, save, onClose, onSaved, onBusyChange, onDirtyChange, claims }: {
  projectId: number; projectName: string; id?: number; mobile?: boolean; sessionIdentity: unknown;
  save: (input: TakeoffSaveInput) => Promise<unknown>; onClose: () => void; onSaved: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void; claims?: { id: number; claimNo: string }[];
}) {
  const utils = trpc.useUtils();
  const upload = trpc.measurement.uploadTakeoffAttachment.useMutation();
  const config = trpc.measurement.captureConfig.useQuery(undefined, { retry: false, staleTime: 0 });
  const [draft, setDraft] = useState<TakeoffDraft>(emptyTakeoffDraft);
  const [initial, setInitial] = useState<TakeoffDraft>(emptyTakeoffDraft);
  const [detail, setDetail] = useState<TakeoffDetail | null>(null);
  const [uploaded, setUploaded] = useState<UploadedPhoto[]>([]);
  const uploadedRef = useRef<UploadedPhoto[]>([]);
  const [reading, setReading] = useState(Boolean(id));
  const [busy, setBusy] = useState<"" | "upload" | "save">("");
  const [error, setError] = useState("");
  const busyRef = useRef<"" | "upload" | "save">("");
  const generation = useRef(0);
  const createAttempt = useRef<TakeoffCreateAttempt | null>(null);
  const mounted = useRef(true);
  const live = useRef({ projectId, id, sessionIdentity });
  live.current = { projectId, id, sessionIdentity };
  const photoAlbum = useRef<HTMLInputElement>(null);
  const photoCamera = useRef<HTMLInputElement>(null);
  const deviceKey = `measurement-takeoff:${projectId}:${id || "new"}`;
  const scope = useRef({ projectId, id, sessionIdentity });
  const current = (token: number, identity = scope.current) => mounted.current && generation.current === token && live.current.projectId === identity.projectId && live.current.id === identity.id && live.current.sessionIdentity === identity.sessionIdentity;
  const visible = scope.current.projectId === projectId && scope.current.id === id && scope.current.sessionIdentity === sessionIdentity;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || uploaded.length > 0;
  function setOperation(value: "" | "upload" | "save") { busyRef.current = value; setBusy(value); onBusyChange?.(Boolean(value)); }
  function dropPreviews() { uploadedRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); uploadedRef.current = []; setUploaded([]); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; uploadedRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); onBusyChange?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty || Boolean(busy)); return () => onDirtyChange?.(false); }, [dirty, busy, onDirtyChange]);
  async function load() {
    const token = ++generation.current;
    const identity = { projectId, id, sessionIdentity }; scope.current = identity;
    createAttempt.current = null;
    dropPreviews(); setError(""); setDetail(null); setOperation(""); setReading(Boolean(id));
    let next = emptyTakeoffDraft();
    setDraft(next); setInitial(next);
    try {
      if (id) {
        const result = await utils.measurement.getTakeoffDetail.fetch({ projectId, id }, { staleTime: 0 });
        if (!current(token, identity)) return;
        if (!["draft", "rejected"].includes(result.record.status)) throw new Error("仅草稿或已退回收方可以编辑，请重新读取台账");
        if (!result.record.version) throw new Error("记录版本缺失，暂不可编辑");
        setDetail(result); next = draftFromDetail(result);
      }
      if (mobile) {
        const local = readMobileDraft<Record<string, unknown>>(deviceKey);
        if (local && hasMobileDraftContent(local.value)) { next = { ...next, ...restoreOrdinaryTakeoffDraft(local.value) }; toast.info("已恢复本机普通字段草稿；照片与关联申报不从本机恢复。"); }
      }
      if (current(token, identity)) { setDraft(next); setInitial(next); }
    } catch (e) { if (current(token, identity)) setError(getUserFacingErrorMessage(e)); }
    finally { if (current(token, identity)) setReading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [projectId, id, sessionIdentity]);
  function persistLocal() {
    if (busyRef.current) throw new Error("正在上传或保存，请完成后再退出");
    if (!saveMobileDraft(deviceKey, ordinaryTakeoffDraft(draft))) throw new Error("本机草稿保存失败，请检查设备存储权限");
    setInitial(draft); toast.success("普通字段已保存本机；照片不会存入本机草稿，退出后需重新选择");
  }
  function closeNow() { if (busyRef.current) return; generation.current++; dropPreviews(); onClose(); }
  const protection = useMobileFormProtection({ id: "mobile-measurement-takeoff-form", label: "项目部收方", isDirty: mobile && (dirty || Boolean(busy)),
    saveDraft: persistLocal, discard: () => { if (busyRef.current) return; clearMobileDraft(deviceKey); closeNow(); } });
  function requestClose() {
    if (busyRef.current) return;
    if (mobile) protection.requestClose(closeNow);
    else if (!dirty || window.confirm("关闭将放弃尚未保存的收方内容和本次照片选择，确定关闭？")) closeNow();
  }
  async function choosePhotos(files: File[]) {
    if (busyRef.current || reading || !visible) return;
    if (config.isLoading || !config.data || config.isError) { setError("无法读取现场图片配置，请重试后上传"); return; }
    if (!config.data.camera.enabled) { setError("当前现场图片配置已禁用，不可上传"); return; }
    if (files.length + uploadedRef.current.length > 20) { setError("每次保存最多新增 20 张现场图片；全部历史图片保留"); return; }
    if (!files.length) return;
    setOperation("upload"); setError("");
    const token = generation.current; const identity = scope.current;
    try {
      const coordinates = await takeoffCoordinates(config.data.location.required);
      for (const file of files) {
        if (!current(token, identity)) return;
        const contents = await readTakeoffPhoto(file);
        if (!current(token, identity)) return;
        const result = await upload.mutateAsync({ projectId, ...(id ? { takeoffId: id } : {}), fileName: file.name, ...contents,
          ...(coordinates ?? {}), capturedAt: new Date().toISOString() });
        if (!current(token, identity)) return;
        const photo: UploadedPhoto = { ...result, previewUrl: URL.createObjectURL(file) };
        uploadedRef.current = [...uploadedRef.current, photo]; setUploaded(uploadedRef.current);
      }
    } catch (e) { if (current(token, identity)) setError(`${getUserFacingErrorMessage(e)}；已完成图片保留，失败图片请重新选择。`); }
    finally { if (current(token, identity)) setOperation(""); }
  }
  async function submit() {
    if (busyRef.current || reading || !visible || id && !detail) return;
    let input: TakeoffSaveInput;
    try { input = takeoffSaveInput(draft, projectId, id, detail?.record.version, uploadedRef.current.map(photo => photo.evidenceId)); }
    catch (e) { setError(getUserFacingErrorMessage(e)); return; }
    createAttempt.current = takeoffCreateAttempt(input, createAttempt.current, () => crypto.randomUUID());
    if (createAttempt.current) input.documentRequestKey = createAttempt.current.key;
    setOperation("save"); setError("");
    const token = generation.current; const identity = scope.current;
    try {
      await save(input);
      if (!current(token, identity)) return;
      clearMobileDraft(deviceKey); setOperation(""); generation.current++; dropPreviews(); onClose();
      toast.success("项目部收方草稿已同步保存，申报金额由服务端复算"); await onSaved();
    } catch (e) { if (current(token, identity)) setError(`${getUserFacingErrorMessage(e)}；输入和已上传图片保留，可重试。`); }
    finally { if (current(token, identity)) setOperation(""); }
  }
  return <Dialog open onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className={TAKEOFF_DIALOG_LAYOUT} showCloseButton={!busy} onEscapeKeyDown={e => { if (busyRef.current) e.preventDefault(); }} onInteractOutside={e => { if (busyRef.current) e.preventDefault(); }}>
    <DialogHeader><DialogTitle>{mobile ? id ? "维护项目收方" : "新建项目收方" : "项目部工程量收方录入"}</DialogTitle><DialogDescription className="text-xs">工程量 × 业主单价由服务端复算。照片随草稿同步；仅草稿 / 退回记录可以编辑。</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {reading || !visible ? <p role="status">正在读取收方详情与真实版本…</p> : <>
        {detail ? <p className="break-all text-xs">正式单号：{detail.record.takeoffNo}</p> : null}
        {id && !detail ? <Button type="button" variant="outline" onClick={() => void load()}>重新读取</Button> : <>
          <TakeoffFields draft={draft} onChange={setDraft} projectName={projectName} claims={claims} disabled={Boolean(busy)} />
          <TakeoffSection title="现场图片">
            <p className="text-xs leading-5 text-muted-foreground">JPEG / PNG，单张不超过 8MB，每次保存最多新增 20 张。全部已有照片保留，不提供删除或下载。相册时间仅为本次归档记录时刻。</p>
            {detail?.evidences.length ? <TakeoffPhotoGallery photos={detail.evidences} /> : null}
            {uploaded.length ? <><p className="text-xs">本次新上传 {uploaded.length} 张，保存时仅发送这些新增附件 ID</p><TakeoffPhotoGallery photos={uploaded.map(photo => ({ ...photo, url: photo.previewUrl, description: null }))} /></> : null}
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => photoAlbum.current?.click()}>选择相册照片</Button><Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => photoCamera.current?.click()}>现场拍照</Button></div>
            <input ref={photoAlbum} aria-label="相册照片文件" className="hidden" type="file" accept="image/jpeg,image/png" multiple onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void choosePhotos(files); }} />
            <input ref={photoCamera} aria-label="拍照文件" className="hidden" type="file" accept="image/jpeg,image/png" capture="environment" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void choosePhotos(files); }} />
            {config.data?.location.required ? <p className="text-xs text-amber-700">上传要求真实定位，请授权设备定位权限。</p> : null}
          </TakeoffSection>
        </>}
      </>}
      {error && visible ? <p role="alert" className="whitespace-pre-wrap break-all rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
    </div>
    <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 border-t pt-3 sm:flex"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={requestClose}>取消</Button>{mobile ? <Button type="button" variant="secondary" disabled={Boolean(busy) || reading || !visible || Boolean(id && !detail)} onClick={() => { try { persistLocal(); } catch (e) { setError(getUserFacingErrorMessage(e)); } }}>保存本机草稿</Button> : null}<Button type="button" className={mobile ? "col-span-2 sm:col-span-1" : ""} disabled={Boolean(busy) || reading || !visible || Boolean(id && !detail)} onClick={() => void submit()}>{busy === "upload" ? "正在上传…" : busy === "save" ? "正在保存…" : mobile ? "保存草稿" : "保存收方草稿"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
