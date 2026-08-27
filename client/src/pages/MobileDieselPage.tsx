import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { DieselSummaryPrintDialog } from "@/components/DieselSummaryPrintDialog";
import { formatChinaDateTime, toDeviceDateTimeInput } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Camera, Fuel, Plus, Printer, ReceiptText, RefreshCw, Tractor, Truck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "../../../shared/watermarkTemplate";

const MOBILE_DIESEL_BACK_PATH = "/mobile";
const DUPLICATE_REFUEL_WINDOW_MILLISECONDS = 5 * 60 * 1000;
const DUPLICATE_REFUEL_LITERS_TOLERANCE = 0.001;

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return ({ draft: "草稿", approved: "已记账", settled: "已结算", void: "已作废" } as Record<string, string>)[status] ?? "待处理";
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("加油表照片读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 浏览器端仅将带工程水印的副本归档，原始加油表照片不会直接进入柴油单据。 */
function createWatermarkedDieselImage(file: File, watermarkLines: string[], template: EvidenceWatermarkTemplate) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("加油表水印照片生成失败")); };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持水印绘制");
        context.drawImage(image, 0, 0);
        const fontSize = Math.max(15, Math.round(Math.min(canvas.width, canvas.height) / 34));
        const lineHeight = Math.round(fontSize * 1.46);
        const padding = Math.round(fontSize * 0.72);
        const lines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(canvas.width - padding * 2, Math.max(...lines.map(line => context.measureText(line).width), canvas.width * 0.42));
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight = headerHeight + lines.length * lineHeight + footerHeight + padding * 2;
        const boxY = canvas.height - boxHeight - padding;
        context.fillStyle = "rgba(255,255,255,.88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(166,94,45,.92)";
        context.fillRect(padding, boxY, textWidth + padding * 2, headerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(template.title, padding * 2, boxY + Math.round(padding * .55));
        context.fillStyle = "#3b2118";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        lines.forEach((line, index) => context.fillText(line, padding * 2, boxY + headerHeight + padding + index * lineHeight));
        context.fillStyle = "rgba(166,94,45,.92)";
        context.fillRect(padding, boxY + boxHeight - footerHeight - padding, textWidth + padding * 2, footerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `600 ${Math.round(fontSize * .78)}px sans-serif`;
        context.fillText(template.footerLabel, padding * 2, boxY + boxHeight - footerHeight - Math.round(padding * .1));
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("加油表水印照片生成失败"));
          resolve(new File([blob], `${file.name.replace(/\.(jpe?g|png)$/i, "") || "diesel-refuel"}-watermark.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", .9);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error("加油表水印照片生成失败"));
      }
    };
    image.src = objectUrl;
  });
}

function getCurrentLocation() {
  return new Promise<{ latitude: number; longitude: number } | null>(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });
}

/** 移动柴油管理展示真实台账；领用登记仅在柴油登记和现场取证权限均满足时开放。 */
export default function MobileDieselPage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number>();
  const [dieselPrintOpen, setDieselPrintOpen] = useState(false);
  const [refuelOpen, setRefuelOpen] = useState(false);
  const [draft, setDraft] = useState({ assetType: "vehicle" as "vehicle" | "machine", assetId: "", supplyMethod: "project_supply" as "project_supply" | "external_station", stationOrSupplierName: "", liters: "", actualUnitPrice: "", deductFromFreight: false, refueledAt: toDeviceDateTimeInput(), meterReading: "", receiptNo: "", remarks: "" });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const overview = trpc.diesel.mobileOverview.useQuery(projectId ? { projectId } : undefined, { enabled: isAuthenticated, retry: false });
  const selectedProjectId = projectId ?? 0;
  const refuelOptions = trpc.diesel.mobileRefuelOptions.useQuery({ projectId: selectedProjectId }, { enabled: isAuthenticated && refuelOpen && Boolean(selectedProjectId) && Boolean(overview.data?.capabilities?.canCreateRefuel), retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated && refuelOpen, retry: false });
  const evidenceUpload = trpc.evidence.upload.useMutation();
  const refuelCreate = trpc.diesel.mobileCreateRefuel.useMutation({
    onSuccess: async result => {
      toast.success(`柴油领用已记账：${result.recordNo} · ${money(result.amount)}`);
      closeRefuelDialog();
      await Promise.all([utils.diesel.mobileOverview.invalidate(), utils.diesel.mobileRefuelOptions.invalidate()]);
    },
  });
  const assets = draft.assetType === "vehicle" ? refuelOptions.data?.vehicles ?? [] : refuelOptions.data?.machines ?? [];
  const recentDuplicateRefuel = useMemo(() => {
    const assetId = Number(draft.assetId);
    const refueledAt = new Date(draft.refueledAt).getTime();
    const liters = Number(draft.liters);
    if (!Number.isInteger(assetId) || assetId <= 0 || !Number.isFinite(refueledAt) || !Number.isFinite(liters) || liters <= 0) return null;
    return overview.data?.records.find(record => record.status !== "void" && record.assetType === draft.assetType && record.assetId === assetId && record.supplyMethod === draft.supplyMethod && Math.abs(new Date(record.refueledAt).getTime() - refueledAt) <= DUPLICATE_REFUEL_WINDOW_MILLISECONDS && Math.abs(record.liters - liters) <= DUPLICATE_REFUEL_LITERS_TOLERANCE) ?? null;
  }, [draft.assetId, draft.assetType, draft.liters, draft.refueledAt, draft.supplyMethod, overview.data?.records]);

  useEffect(() => {
    if (!projectId && overview.data?.selectedProjectId) setProjectId(overview.data.selectedProjectId);
  }, [overview.data?.selectedProjectId, projectId]);
  useEffect(() => {
    if (!cameraOpen || !cameraVideoRef.current || !cameraStreamRef.current) return;
    cameraVideoRef.current.srcObject = cameraStreamRef.current;
    void cameraVideoRef.current.play().catch(() => toast.error("相机预览启动失败，请重新打开相机"));
  }, [cameraOpen]);
  useEffect(() => () => { cameraStreamRef.current?.getTracks().forEach(track => track.stop()); }, []);

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("当前浏览器不支持直接调用相机，请使用支持相机权限的手机浏览器");
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch {
      toast.error("无法打开后置相机。请在浏览器设置中允许相机权限后重试");
    }
  }

  function capturePhoto() {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return toast.error("相机仍在启动，请稍候再拍照");
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return toast.error("当前浏览器不支持相机照片处理");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return toast.error("加油表现场照片生成失败，请重新拍摄");
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      const file = new File([blob], `diesel-refuel-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      stopCamera();
    }, "image/jpeg", .92);
  }

  function closeRefuelDialog() {
    stopCamera();
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
    setRefuelOpen(false);
  }

  function openRefuelDialog() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    setDraft({ assetType: "vehicle", assetId: "", supplyMethod: "project_supply", stationOrSupplierName: "", liters: "", actualUnitPrice: "", deductFromFreight: false, refueledAt: toDeviceDateTimeInput(), meterReading: "", receiptNo: "", remarks: "" });
    setRefuelOpen(true);
  }

  async function submitRefuel() {
    if (!selectedProjectId || !draft.assetId || !draft.liters) return toast.error("请完整选择车辆或机械并填写加油升数");
    if (draft.supplyMethod === "external_station" && (!draft.stationOrSupplierName.trim() || !draft.actualUnitPrice)) return toast.error("加油站加油必须填写供应商和实际单价");
    if (recentDuplicateRefuel) return toast.error(`检测到最近 ${DUPLICATE_REFUEL_WINDOW_MILLISECONDS / 60_000} 分钟内同一资源相同加油量的记录（${recentDuplicateRefuel.recordNo}），请先核对，系统不会重复入账`);
    if (!photoFile) return toast.error("柴油领用必须使用后置相机直拍加油表照片");
    try {
      const location = await getCurrentLocation();
      if (captureConfig.data?.location.required && !location) throw new Error("当前项目要求加油表照片上传时读取现场定位");
      const capturedAt = new Date();
      const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
      const projectName = overview.data?.projects.find(project => project.id === selectedProjectId)?.name ?? `项目 #${selectedProjectId}`;
      const assetLabel = assets.find(asset => asset.id === Number(draft.assetId))?.label ?? `资源 #${draft.assetId}`;
      const antiCounterfeit = `${selectedProjectId}-${draft.assetId}-${capturedAt.getTime().toString(36).toUpperCase()}`;
      const values: Record<string, string> = {
        capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`,
        principal: `登记人：${user?.name || "当前管理员"}`,
        weather: `业务类型：柴油领用`,
        location: `详细地点：${location ? "已采集" : "未取得"}`,
        coordinates: `现场定位：${location ? "已采集" : "未取得"}`,
        organization: `施工单位：${template.organizationLabel}`,
        project: `项目名称：${projectName}`,
        antiCounterfeit: `防伪编号：${antiCounterfeit}`,
      };
      const watermarkedFile = await createWatermarkedDieselImage(photoFile, template.fields.map(field => values[field]).filter(Boolean), template);
      const upload = await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "diesel_receipt", sourceId: `diesel-refuel-pending-${draft.assetId}-${capturedAt.getTime()}`, description: `柴油领用加油表 · ${assetLabel}${draft.remarks.trim() ? ` · ${draft.remarks.trim()}` : ""}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.longitude ?? null, latitude: location?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
      if (!upload.id) throw new Error("加油表水印影像归档失败");
      await refuelCreate.mutateAsync({ projectId: selectedProjectId, assetType: draft.assetType, assetId: Number(draft.assetId), supplyMethod: draft.supplyMethod, stationOrSupplierName: draft.supplyMethod === "external_station" ? draft.stationOrSupplierName.trim() : null, liters: Number(draft.liters), actualUnitPrice: draft.supplyMethod === "external_station" ? Number(draft.actualUnitPrice) : null, deductFromFreight: draft.assetType === "vehicle" && draft.deductFromFreight, refueledAt: new Date(draft.refueledAt).toISOString(), meterReading: draft.meterReading ? Number(draft.meterReading) : null, receiptNo: draft.receiptNo.trim() || null, evidenceId: upload.id, remarks: draft.remarks.trim() || null });
    } catch {
      toast.error("柴油领用登记未完成，请检查现场照片、定位和填写内容后重试");
    }
  }

  if (loading || !isAuthenticated || overview.isLoading) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && overview.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载柴油管理权限…" title="柴油管理" description="系统只显示当前账号已获柴油台账查看权限和项目范围内的真实台账。" Icon={Fuel} onRetry={() => { void refresh(); void overview.refetch(); }} />;
  }
  if (overview.error) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f1e7] p-6 text-center text-[#5b3b2e]"><div className="max-w-xs"><Fuel className="mx-auto h-9 w-9 text-[#b96932]" /><h1 className="mt-4 text-lg font-semibold">柴油台账暂不可用</h1><p className="mt-2 text-sm leading-6 text-[#8f7566]">暂时无法加载当前项目柴油台账，请稍后重新加载。</p><Button className="mt-5" variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />重新加载</Button><Button className="mt-2" variant="ghost" onClick={() => navigate(MOBILE_DIESEL_BACK_PATH)}>返回工作台</Button></div></div>;
  }
  const data = overview.data;
  const selectedProjectName = data?.projects.find(project => project.id === projectId)?.name ?? "—";
  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-10 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea]"><div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#d99855]/20 blur-2xl" /><div className="relative flex items-center justify-between"><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate(MOBILE_DIESEL_BACK_PATH)}><ArrowLeft className="h-5 w-5" /></Button><div className="text-center"><p className="text-sm font-semibold">柴油管理</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">供油台账 · 扣油核对</p></div><Fuel className="h-5 w-5 text-[#f0bd7d]" /></div><p className="relative mt-5 text-xs leading-5 text-[#e8cfb2]">台账和领用登记均严格按项目范围、柴油细分权限与水印现场影像执行；金额由服务端按有效指导价或实际油价计算。</p></header>
    <main className="space-y-4 px-5 py-5">
      {!data?.projects.length ? <Card className="border-dashed border-[#e4cdb6] bg-[#fffaf4]"><CardContent className="p-7 text-center"><Fuel className="mx-auto h-8 w-8 text-[#b96932]" /><h2 className="mt-3 font-semibold">暂无可查看项目</h2><p className="mt-2 text-xs leading-5 text-[#8f7566]">请联系管理员为当前账号配置项目范围；柴油权限不会自动扩大项目数据范围。</p></CardContent></Card> : <>
        <section className="flex flex-wrap gap-2"><Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 min-w-[170px] flex-1 border-[#e9d8c6] bg-white"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{data.projects.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select><Button className="h-11" variant="outline" disabled={!selectedProjectId} onClick={() => setDieselPrintOpen(true)}><Printer className="mr-1 h-4 w-4" />汇总 PDF</Button>{data.capabilities?.canCreateRefuel ? <Button className="h-11 bg-[#a65e2d] text-white hover:bg-[#884a22]" onClick={openRefuelDialog}><Plus className="mr-1 h-4 w-4" />登记领用</Button> : null}</section>
        {data.capabilities?.canCreateRefuel && captureConfig.error ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">已授予柴油领用登记，但当前账号未获水印影像取证权限，无法完成必需的加油表凭证归档。请同时授予“影像证据上传”和项目范围。</p> : null}
        <section className="grid grid-cols-2 gap-3"><Metric icon={Fuel} label="有效供油量" value={`${Number(data.summary?.totalLiters ?? 0).toFixed(2)} L`} /><Metric icon={WalletCards} label="有效柴油金额" value={money(data.summary?.totalAmount)} /><Metric icon={Truck} label="运费扣油" value={money(data.summary?.deductibleAmount)} /><Metric icon={ReceiptText} label="项目部 / 加油站" value={`${Number(data.summary?.projectSupplyLiters ?? 0).toFixed(1)} / ${Number(data.summary?.stationLiters ?? 0).toFixed(1)} L`} /></section>
        <section className="rounded-2xl border border-[#ead9c8] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">最近柴油记录</h2><p className="mt-1 text-xs text-[#8f7566]">项目：{selectedProjectName} · 已作废记录保留审计状态</p></div><Button size="sm" variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" />刷新</Button></div>{data.records.length ? <div className="mt-3 space-y-2">{data.records.map(record => <div key={record.id} className="flex items-center gap-3 rounded-xl border border-[#f0e1d2] bg-[#fffaf4] p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f5e5d0] text-[#a65e2d]">{record.assetType === "machine" ? <Tractor className="h-4 w-4" /> : <Truck className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{record.recordNo} · {record.supplyMethod === "project_supply" ? "项目部供油" : record.stationOrSupplierName || "加油站加油"}</p><p className="mt-1 text-[11px] text-[#8f7566]">{formatChinaDateTime(record.refueledAt)} · {record.liters.toFixed(3)}L · ¥{record.appliedUnitPrice.toFixed(2)}/L{record.deductFromFreight ? " · 运费扣油" : ""}</p></div><div className="shrink-0 text-right"><p className="font-semibold text-[#6d3421]">{money(record.amount)}</p><p className={`mt-1 text-[11px] ${record.status === "void" ? "text-rose-600" : record.status === "settled" ? "text-emerald-700" : "text-[#8f7566]"}`}>{statusLabel(record.status)}</p></div></div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-[#e4cdb6] px-4 py-6 text-center text-xs text-[#8f7566]">当前项目暂无柴油领用记录。</p>}</section>
      </>}
    </main>
    <DieselSummaryPrintDialog open={dieselPrintOpen} onOpenChange={setDieselPrintOpen} projectId={selectedProjectId} projectName={selectedProjectName} />
    <Dialog open={refuelOpen} onOpenChange={open => { if (!open) closeRefuelDialog(); }}><DialogContent className="max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>登记柴油领用</DialogTitle><DialogDescription>加油表必须由后置相机现场直拍并生成工程水印；保存后直接记账，金额由服务端按有效指导价或实际油价固化。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><div><Label>资源类型</Label><Select value={draft.assetType} onValueChange={value => setDraft(current => ({ ...current, assetType: value as "vehicle" | "machine", assetId: "", deductFromFreight: false }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="vehicle">车辆</SelectItem><SelectItem value="machine">机械</SelectItem></SelectContent></Select></div><div><Label>{draft.assetType === "vehicle" ? "车辆" : "机械"}</Label><Select value={draft.assetId} onValueChange={value => setDraft(current => ({ ...current, assetId: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="选择项目资源" /></SelectTrigger><SelectContent>{assets.map(asset => <SelectItem key={asset.id} value={String(asset.id)}>{asset.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid grid-cols-2 gap-3"><div><Label>供油方式</Label><Select value={draft.supplyMethod} onValueChange={value => setDraft(current => ({ ...current, supplyMethod: value as "project_supply" | "external_station" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project_supply">项目部供油</SelectItem><SelectItem value="external_station">加油站现金加油</SelectItem></SelectContent></Select></div><div><Label>加油升数（L）</Label><Input className="mt-1" inputMode="decimal" type="number" min="0.001" step="0.001" value={draft.liters} onChange={event => setDraft(current => ({ ...current, liters: event.target.value }))} /></div></div>{draft.supplyMethod === "external_station" ? <div className="grid grid-cols-2 gap-3"><div><Label>加油站 / 供应商</Label><Input className="mt-1" value={draft.stationOrSupplierName} onChange={event => setDraft(current => ({ ...current, stationOrSupplierName: event.target.value }))} /></div><div><Label>实际单价（元/L）</Label><Input className="mt-1" inputMode="decimal" type="number" min="0.01" step="0.01" value={draft.actualUnitPrice} onChange={event => setDraft(current => ({ ...current, actualUnitPrice: event.target.value }))} /></div></div> : <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">项目部供油将由服务端匹配加油日期的有效柴油指导价；若未维护有效指导价，系统会拒绝记账。</p>}<div className="grid grid-cols-2 gap-3"><div><Label>加油时间</Label><Input className="mt-1" type="datetime-local" value={draft.refueledAt} onChange={event => setDraft(current => ({ ...current, refueledAt: event.target.value }))} /></div><div><Label>油表 / 里程读数</Label><Input className="mt-1" inputMode="decimal" type="number" min="0" step="0.01" value={draft.meterReading} onChange={event => setDraft(current => ({ ...current, meterReading: event.target.value }))} /></div></div>{recentDuplicateRefuel ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">检测到最近 {DUPLICATE_REFUEL_WINDOW_MILLISECONDS / 60_000} 分钟内相同资源、相同加油量的记录（{recentDuplicateRefuel.recordNo}）。为防止重复入账，本次保存已禁用；如确为不同加油，请核对时间或升数后再登记。</p> : null}{draft.assetType === "vehicle" && data?.capabilities?.canSettleDeduction ? <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><Checkbox checked={draft.deductFromFreight} onCheckedChange={checked => setDraft(current => ({ ...current, deductFromFreight: Boolean(checked) }))} /><span><strong>本次油款从渣土车运费结算中扣除。</strong><br />系统将按车辆运输结算规则统一归集，不选择某一趟运输单。</span></label> : null}<div><Label>小票 / 凭证号</Label><Input className="mt-1" value={draft.receiptNo} onChange={event => setDraft(current => ({ ...current, receiptNo: event.target.value }))} placeholder="可选" /></div><div><Label>说明</Label><Input className="mt-1" value={draft.remarks} onChange={event => setDraft(current => ({ ...current, remarks: event.target.value }))} placeholder="用途或异常说明（可选）" /></div><div className="rounded-xl border border-[#79a57f] bg-[#f4fbf1] p-3"><p className="text-xs leading-5 text-[#47754d]">加油表现场照片为必拍项：仅支持后置相机直拍，不提供相册选择；照片会写入项目、时间、操作人和防伪编号水印。</p>{cameraOpen ? <div className="mt-2 overflow-hidden rounded-xl bg-[#18301d]"><video ref={cameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="bg-white text-[#47754d]" onClick={stopCamera}>取消拍照</Button><Button type="button" className="bg-[#47754d] text-white hover:bg-[#39623e]" onClick={capturePhoto}><Camera className="mr-1 h-4 w-4" />确认照片</Button></div></div> : <Button type="button" variant="outline" className="mt-2 h-10 w-full border-dashed border-[#79a57f] text-[#47754d]" onClick={() => void startCamera()}><Camera className="mr-2 h-4 w-4" />打开后置相机拍摄加油表</Button>}{photoPreview ? <div className="mt-2"><img src={photoPreview} alt="待归档加油表现场照片" className="max-h-56 w-full rounded-xl border border-[#c6ddc5] object-cover" /><Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-[#47754d]" onClick={() => void startCamera()}><Camera className="mr-1 h-3.5 w-3.5" />重新拍摄</Button></div> : null}</div></div><DialogFooter><Button variant="outline" onClick={closeRefuelDialog}>取消</Button><Button className="bg-[#a65e2d] text-white hover:bg-[#884a22]" disabled={refuelCreate.isPending || evidenceUpload.isPending || !draft.assetId || !draft.liters || !photoFile || Boolean(captureConfig.error) || Boolean(recentDuplicateRefuel)} onClick={() => void submitRefuel()}>{refuelCreate.isPending || evidenceUpload.isPending ? "正在归档并记账…" : recentDuplicateRefuel ? "检测到重复记录" : "保存并直接记账"}</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Fuel; label: string; value: string }) {
  return <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><Icon className="h-4 w-4 text-[#a65e2d]" /><p className="mt-2 text-sm font-semibold text-[#5b3b2e]">{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>;
}
