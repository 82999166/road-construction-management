import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { formatChinaDateTime } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "@shared/watermarkTemplate";
import { ArrowLeft, Camera, CheckCircle2, ImagePlus, LayoutDashboard, LocateFixed, MapPin, ReceiptText, ScanLine, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

/** 影像类型与后端枚举保持一致，避免客户端传递不可识别的业务分类。 */
const SOURCE_OPTIONS = [
  { value: "site_photo", label: "施工现场" },
  { value: "safety", label: "安全文明施工" },
  { value: "transport", label: "运输作业" },
  { value: "attendance", label: "考勤佐证" },
  { value: "purchase", label: "采购验收 / 票据" },
  { value: "other", label: "其他事项" },
] as const;

/** 将浏览器选择的图片转为不含 data URL 前缀的 Base64，交给服务端做强制验签与对象存储归档。 */
function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("影像文件读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 将服务器 UTC 时间固定显示为北京时间，避免现场人员所在地或浏览器时区改变取证时间。 */
function formatCapturedTime(value: Date | string | null | undefined) {
  return formatChinaDateTime(value);
}

/** 将现场关键水印写入图片像素；原图只保留在当前浏览器，服务端仍保存独立审计元数据。 */
function createWatermarkedImage(file: File, watermarkLines: string[], template: EvidenceWatermarkTemplate) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("水印影像生成失败")); };
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
        const visibleLines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(canvas.width - padding * 2, Math.max(...visibleLines.map(line => context.measureText(line).width), canvas.width * 0.42));
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight = headerHeight + visibleLines.length * lineHeight + footerHeight + padding * 2;
        const boxY = canvas.height - boxHeight - padding;
        context.fillStyle = "rgba(255, 255, 255, .88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(33, 119, 211, .9)";
        context.fillRect(padding, boxY, textWidth + padding * 2, headerHeight + padding);
        context.fillStyle = "#ffffff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(template.title, padding * 2, boxY + Math.round(padding * .55));
        context.fillStyle = "#26333d";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        visibleLines.forEach((line, index) => context.fillText(line, padding * 2, boxY + headerHeight + padding + index * lineHeight));
        context.fillStyle = "rgba(33, 119, 211, .92)";
        context.fillRect(padding, boxY + boxHeight - footerHeight - padding, textWidth + padding * 2, footerHeight + padding);
        context.fillStyle = "#ffffff";
        context.font = `600 ${Math.round(fontSize * .78)}px sans-serif`;
        context.fillText(template.footerLabel, padding * 2, boxY + boxHeight - footerHeight - Math.round(padding * .1));
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("水印影像生成失败"));
          const name = file.name.replace(/\.(jpe?g|png)$/i, "") || "site-photo";
          resolve(new File([blob], `${name}-watermark.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", 0.9);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error("水印影像生成失败"));
      }
    };
    image.src = objectUrl;
  });
}

/**
 * 水印影像取证移动页面。
 * 浏览器只有在用户主动点击定位按钮后才请求位置；图片和元数据均由服务端进行项目范围校验与审计。
 */
export default function MobileEvidencePage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [location, navigate] = useLocation();
  const capturePreset = useMemo(() => {
    const search = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
    const params = new URLSearchParams(search);
    const sourceType = params.get("sourceType");
    return {
      projectId: Number(params.get("projectId") || 0),
      sourceType: SOURCE_OPTIONS.some(item => item.value === sourceType) ? sourceType as (typeof SOURCE_OPTIONS)[number]["value"] : null,
      sourceId: params.get("sourceId")?.slice(0, 128) || "",
      weather: params.get("weather")?.slice(0, 32) || "",
      description: params.get("description")?.slice(0, 240) || "",
    };
  }, [location]);
  const [projectId, setProjectId] = useState<number | undefined>();
  const [sourceType, setSourceType] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>("site_photo");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [coordinates, setCoordinates] = useState<{ longitude: number; latitude: number } | null>(null);
  const [locationAddress, setLocationAddress] = useState("");
  const [captureWeather, setCaptureWeather] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: number; fileName: string } | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const projectOptions = trpc.evidence.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const cameraEnabled = captureConfig.data?.camera.enabled ?? true;
  const locationEnabled = captureConfig.data?.location.enabled ?? true;
  const locationRequired = captureConfig.data?.location.required ?? false;
  const watermarkTemplate = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;

  /** 首次获得授权项目时选中首项，用户仍能手动切换其权限范围内项目。 */
  useEffect(() => {
    if (capturePreset.projectId && projectOptions.data?.some(project => project.id === capturePreset.projectId)) setProjectId(capturePreset.projectId);
    else if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
    if (capturePreset.sourceType) setSourceType(capturePreset.sourceType);
    if (capturePreset.sourceId) setSourceId(capturePreset.sourceId);
    if (capturePreset.weather) setCaptureWeather(capturePreset.weather);
    if (capturePreset.description) setDescription(capturePreset.description);
  }, [capturePreset.projectId, capturePreset.sourceId, capturePreset.sourceType, capturePreset.weather, capturePreset.description, projectId, projectOptions.data]);

  /** 释放本地预览 URL，防止多次连续拍照选择造成浏览器内存持续占用。 */
  useEffect(() => () => { previewUrls.forEach(url => URL.revokeObjectURL(url)); }, [previewUrls]);

  const selectedProjectId = projectId ?? 0;
  const evidenceListInput = useMemo(() => ({ projectId: selectedProjectId, limit: 50 }), [selectedProjectId]);
  const evidence = trpc.evidence.list.useQuery(evidenceListInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const upload = trpc.evidence.upload.useMutation({ onError: error => toast.error(error.message) });
  const reverseGeocode = trpc.location.reverseGeocode.useMutation({
    onSuccess: result => setLocationAddress(result.address),
    onError: () => toast.warning("当前定位未能解析为中文详细地址，请稍后重新读取定位"),
  });
  /** OCR 仅作辅助，采购影像上传后自动执行一次，其他影像仍保留用户主动触发入口。 */
  const runOcr = trpc.evidence.ocr.useMutation({
    onSuccess: async () => {
      toast.success("票据识别已完成，请人工复核结果");
      await evidence.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const removeEvidence = trpc.evidence.delete.useMutation({
    onSuccess: async () => {
      setDeleteCandidate(null);
      setDeletionReason("");
      await evidence.refetch();
      toast.success("现场影像已删除，操作已记录审计");
    },
    onError: error => toast.error(error.message),
  });

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载现场取证权限…" title="水印影像取证" description="登录后可按项目范围采集并归档现场影像。" Icon={Camera} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  /** 前端仅做体验校验；服务端会再次检查格式、大小、文件头、项目范围和坐标合法性。 */
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;
    if (selected.some(file => !["image/jpeg", "image/png"].includes(file.type))) return toast.error("仅支持 JPG 或 PNG 格式影像");
    if (selected.some(file => file.size > 8 * 1024 * 1024)) return toast.error("单张影像不能超过 8MB");
    const combined = [...files, ...selected].slice(0, 12);
    if (combined.length < files.length + selected.length) toast.warning("单次最多连续归档 12 张照片，超出部分未加入队列");
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setFiles(combined);
    setPreviewUrls(combined.map(file => URL.createObjectURL(file)));
    event.target.value = "";
  }

  /** 定位权限由用户主动触发；拒绝或超时不阻断影像归档。 */
  function requestCoordinates() {
    if (!locationEnabled) return toast.error("管理员已停用浏览器定位采集连接器");
    if (!navigator.geolocation) return toast.error("当前浏览器不支持定位服务");
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = { longitude: position.coords.longitude, latitude: position.coords.latitude };
        setCoordinates(next);
        setLocationAddress("");
        reverseGeocode.mutate({ latitude: next.latitude, longitude: next.longitude });
        toast.success("已读取现场定位，正在解析中文详细地址");
      },
      () => toast.error("未能读取定位，您仍可在无定位状态下归档影像"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  /** 提交影像前固化水印；后端继续独立执行验签、项目范围校验、存储与审计。 */
  async function submitEvidence() {
    if (!selectedProjectId) return toast.error("请先选择已授权项目");
    if (captureConfig.isError) return toast.error("采集连接器配置加载失败，请稍后重试");
    if (!cameraEnabled) return toast.error("现场影像采集连接器已被管理员停用");
    if (locationRequired && !coordinates) return toast.error("当前项目要求上传影像时读取定位");
    if (coordinates && !locationAddress) return toast.error("正在解析中文详细地址，请稍候再归档");
    if (!files.length) return toast.error("请拍摄或选择至少一张现场影像");
    if (!description.trim()) return toast.error("请填写现场说明");
    try {
      const capturedAt = new Date();
      const projectName = projectOptions.data?.find(project => project.id === selectedProjectId)?.name ?? `项目 #${selectedProjectId}`;
      const antiCounterfeitId = `${selectedProjectId}-${capturedAt.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const watermarkValues: Record<string, string> = {
        capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`,
        principal: `施工负责人：${user?.name || "当前管理员"}`,
        weather: `天气：${captureWeather || "未获取"}`,
        location: `详细地点：${locationAddress || "未取得"}`,
        coordinates: `详细地点：${locationAddress || "未取得"}`,
        organization: `施工单位：${watermarkTemplate.organizationLabel}`,
        project: `项目名称：${projectName}`,
        antiCounterfeit: `防伪编号：${antiCounterfeitId}`,
      };
      const watermarkLines = watermarkTemplate.fields.map(field => watermarkValues[field]).filter(Boolean);
      const auditedDescription = `${description.trim()}｜${watermarkLines.filter(Boolean).join("；")}`.slice(0, 500);
      const results = [] as Array<{ id: number | null }>;
      for (const file of files) {
        const watermarkedFile = await createWatermarkedImage(file, watermarkLines, watermarkTemplate);
        const base64Data = await readImageAsBase64(watermarkedFile);
        results.push(await upload.mutateAsync({ projectId: selectedProjectId, sourceType, sourceId: sourceId.trim() || null, description: auditedDescription, capturedAt: capturedAt.toISOString(), longitude: coordinates?.longitude ?? null, latitude: coordinates?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data }));
      }
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      setFiles([]);
      setPreviewUrls([]);
      await evidence.refetch();
      toast.success(sourceId.trim() ? `${results.length} 张现场影像已归档，将随关联业务单据一并提交主管审核` : `${results.length} 张现场影像已归档，请在业务单据中关联后提交审核`);
      if (sourceType === "purchase") results.filter(result => result.id).forEach(result => runOcr.mutate({ id: result.id! }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "影像水印或读取失败");
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-7 pt-6 text-[#fff7ea]">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center gap-3"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div><p className="text-sm font-semibold">悦信云智管</p><h1 className="mt-0.5 text-xl font-semibold">水印影像取证</h1></div></div>
          <p className="relative mt-4 flex items-center gap-1 text-xs leading-5 text-[#e8cfb2]"><ShieldCheck className="h-3.5 w-3.5" />文件、拍摄时间、项目与定位信息将受控归档并记录操作审计。</p>
        </header>

        <main className="space-y-5 px-5 py-5">
          {projectOptions.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">项目权限加载失败：{projectOptions.error.message}</CardContent></Card> : null}
          {captureConfig.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">采集连接器配置加载失败：{captureConfig.error.message}</CardContent></Card> : null}
          {!projectOptions.data?.length && !projectOptions.isLoading ? <Card className="border-0 bg-[#fffaf3] shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-8 text-center"><Camera className="mx-auto h-8 w-8 text-[#a85e31]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系超级管理员为您的岗位分配项目或组织数据范围后再采集影像。</p></CardContent></Card> : <>
            <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="space-y-4 p-4">
              <div><Label>归属项目</Label><Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="mt-2 border-[#ead9c8] bg-[#fffaf5]"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>取证类型</Label><Select value={sourceType} onValueChange={value => setSourceType(value as typeof sourceType)}><SelectTrigger className="mt-2 border-[#ead9c8] bg-[#fffaf5]"><SelectValue /></SelectTrigger><SelectContent>{SOURCE_OPTIONS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div><Label>关联业务编号</Label><Input className="mt-2 border-[#ead9c8] bg-[#fffaf5]" value={sourceId} maxLength={128} placeholder="可选" onChange={event => setSourceId(event.target.value)} /></div></div>
              <div><Label>现场说明</Label><Textarea className="mt-2 min-h-20 border-[#ead9c8] bg-[#fffaf5]" value={description} maxLength={500} placeholder="例如：K12+500 路基压实作业完成情况" onChange={event => setDescription(event.target.value)} /></div>
              <div className="rounded-xl border border-[#c7d7e8] bg-[#f6fbff] p-3"><div className="flex items-center justify-between gap-3"><span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[#366c9e]"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{locationAddress ? `详细地点：${locationAddress}` : coordinates ? "正在解析中文详细地址…" : locationEnabled ? (locationRequired ? "需读取定位后上传" : "尚未读取定位") : "定位连接器已停用"}</span></span><button className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#276da7]" disabled={!locationEnabled || reverseGeocode.isPending} onClick={requestCoordinates}><LocateFixed className="h-3.5 w-3.5" />读取定位</button></div><div className="mt-3 overflow-hidden rounded-lg border border-[#cfe0ef]"><div className="bg-[#2177d3] px-3 py-1.5 text-xs font-bold text-white">{watermarkTemplate.title}</div><div className="space-y-1 bg-white/90 px-3 py-2 text-[11px] leading-4 text-[#2b3b48]">{watermarkTemplate.fields.slice(0, 4).map(field => <p key={field}>{({ capturedAt: `拍摄时间：${formatChinaDateTime(new Date())}`, principal: `施工负责人：${user?.name || "当前管理员"}`, weather: `天气：${captureWeather || "待获取"}`, location: `详细地点：${locationAddress || "待获取"}`, coordinates: `详细地点：${locationAddress || "待获取"}`, organization: `施工单位：${watermarkTemplate.organizationLabel}`, project: `项目名称：${projectOptions.data?.find(project => project.id === selectedProjectId)?.name || "待选择"}`, antiCounterfeit: "防伪编号：归档时生成" } as Record<string, string>)[field]}</p>)}</div><div className="bg-[#2177d3] px-3 py-1 text-[10px] font-medium text-white">{watermarkTemplate.footerLabel}</div></div></div>
            </CardContent></Card>
            <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><div className="flex items-end justify-between gap-3"><div><Label>现场影像</Label><p className="mt-1 text-[11px] text-[#80685b]">可连续添加多张；每张将固化管理员、项目、定位、日期、时间与天气水印。</p></div>{files.length ? <span className="rounded-full bg-[#f9eddf] px-2 py-1 text-xs font-semibold text-[#8a4b25]">已选 {files.length}/12 张</span> : null}</div><label className={`mt-3 flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8bca5] bg-[#fffaf5] p-3 text-center ${cameraEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}><input className="sr-only" type="file" multiple accept="image/jpeg,image/png" capture="environment" disabled={!cameraEnabled} onChange={handleFileChange} /><ImagePlus className="h-7 w-7 text-[#ad6335]" /><span className="mt-2 text-xs font-medium text-[#80543d]">{cameraEnabled ? (files.length ? "继续拍摄或添加照片" : "拍摄或选择 JPG、PNG 影像") : "影像采集连接器已停用"}</span><span className="mt-1 text-[11px] text-[#765544]">单张不超过 8MB，单次最多 12 张</span></label>{previewUrls.length ? <div className="mt-3 grid grid-cols-3 gap-2">{previewUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`待归档现场影像 ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />)}</div> : null}<Button className="mt-4 w-full bg-[#9a5128] text-white hover:bg-[#7e3d1c]" disabled={upload.isPending || captureConfig.isError || !cameraEnabled || !files.length || (locationRequired && !coordinates)} onClick={submitEvidence}>{upload.isPending ? "正在逐张安全归档…" : `归档 ${files.length || ""} 张现场影像`}</Button></CardContent></Card>
            <section>
              <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold">最近取证</h2><p className="mt-0.5 text-xs text-[#9b8170]">仅显示取证摘要；照片随关联单据在主管审核、业务详情和归档记录中查看。</p></div><CheckCircle2 className="h-5 w-5 text-[#b87333]" /></div>
              {evidence.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-xs text-[#9c4d27]">影像台账加载失败：{evidence.error.message}</CardContent></Card> : evidence.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-4 text-center text-sm text-[#8f7566]">正在加载影像台账…</CardContent></Card> : !evidence.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-xs leading-5 text-[#765544]">该项目暂未归档现场影像。</CardContent></Card> : <div className="space-y-3">
                {evidence.data.map(item => {
                  const sourceLabel = SOURCE_OPTIONS.find(option => option.value === item.sourceType)?.label || "现场取证";
                  return <Card key={item.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.07)]"><CardContent className="space-y-2.5 p-3.5">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#5f3625]">{sourceLabel} · 取证记录 #{item.id}</p><p className="mt-1 text-[10px] text-[#9d8574]">归档时间：{formatCapturedTime(item.capturedAt)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${item.sourceId ? "bg-[#e5f4e9] text-[#30714b]" : "bg-[#f9eddf] text-[#8a4b25]"}`}>{item.sourceId ? "随单审核" : "待关联单据"}</span></div>
                    <p className="text-xs leading-5 text-[#634838]">{item.description}</p>
                    <div className="rounded-lg bg-[#f9f4ed] px-2.5 py-2 text-[10px] leading-4 text-[#735645]"><p>关联业务：{item.sourceId ? `${sourceLabel} · ${item.sourceId}` : "暂未关联，后续可在业务单据中关联后提交"}</p><p className="mt-1">影像查看：主管审核、业务详情与归档记录</p></div>
                    {item.ocrResult ? <div className="rounded-lg bg-[#f9eddf] p-2 text-[10px] leading-4 text-[#704b38]"><p className="flex items-center gap-1 font-semibold text-[#905027]"><ReceiptText className="h-3 w-3" />OCR 结果 · 需人工复核</p><p className="mt-1 line-clamp-2">{item.ocrResult.summary || "未能识别摘要"}</p><p className="mt-1">金额：{item.ocrResult.amount || "未识别"}</p></div> : item.sourceType === "purchase" ? <Button size="sm" variant="outline" className="h-7 w-full border-[#d6ae8e] px-2 text-[10px] text-[#8a4b25] hover:bg-[#fff3e5]" disabled={runOcr.isPending} onClick={() => runOcr.mutate({ id: item.id })}><ScanLine className="mr-1 h-3 w-3" />{runOcr.isPending ? "正在识别…" : "票据 OCR"}</Button> : null}
                    {item.canDelete ? <Button size="sm" variant="outline" className="h-7 w-full border-[#e8c2bc] px-2 text-[10px] text-[#a44336] hover:bg-[#fff2f0]" onClick={() => { setDeletionReason(""); setDeleteCandidate({ id: item.id, fileName: item.fileName || "现场影像" }); }}><Trash2 className="mr-1 h-3 w-3" />删除取证记录</Button> : null}
                  </CardContent></Card>;
                })}
              </div>}
            </section>
          </>}
        </main>
        <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={open => { if (!open && !removeEvidence.isPending) { setDeleteCandidate(null); setDeletionReason(""); } }}>
          <AlertDialogContent className="border-[#ead9c8] bg-[#fffaf5] text-[#3b2118]">
            <AlertDialogHeader><AlertDialogTitle>确认受控删除现场影像？</AlertDialogTitle><AlertDialogDescription>“{deleteCandidate?.fileName || "该照片"}”会从日常影像台账中隐藏，原对象键、内容指纹和删除原因将保留用于审计追溯。已关联业务单据的影像不可删除。</AlertDialogDescription></AlertDialogHeader>
            <div><Label>删除原因</Label><Textarea className="mt-2 border-[#ead9c8] bg-white" value={deletionReason} maxLength={500} placeholder="例如：重复上传，已保留正确影像记录 #123" onChange={event => setDeletionReason(event.target.value)} /></div>
            <AlertDialogFooter><AlertDialogCancel disabled={removeEvidence.isPending}>取消</AlertDialogCancel><AlertDialogAction className="bg-[#a44336] text-white hover:bg-[#843328]" disabled={!deleteCandidate || removeEvidence.isPending || deletionReason.trim().length < 5} onClick={() => { if (deleteCandidate) removeEvidence.mutate({ id: deleteCandidate.id, deletionReason: deletionReason.trim() }); }}>{removeEvidence.isPending ? "正在受控删除…" : "确认受控删除"}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Camera className="h-5 w-5" /><span className="text-[10px] font-medium">取证</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>
    </div>
  );
}
