import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Camera, CheckCircle2, ImagePlus, LayoutDashboard, LocateFixed, MapPin, ReceiptText, ScanLine, ShieldCheck, UserRound } from "lucide-react";
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

/** 将服务器 UTC 时间以用户本地时区显示，避免现场人员误解取证时间。 */
function formatCapturedTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * 水印影像取证移动页面。
 * 浏览器只有在用户主动点击定位按钮后才请求位置；图片和元数据均由服务端进行项目范围校验与审计。
 */
export default function MobileEvidencePage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [sourceType, setSourceType] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>("site_photo");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<{ longitude: number; latitude: number } | null>(null);
  const projectOptions = trpc.evidence.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const cameraEnabled = captureConfig.data?.camera.enabled ?? true;
  const locationEnabled = captureConfig.data?.location.enabled ?? true;
  const locationRequired = captureConfig.data?.location.required ?? false;

  /** 首次获得授权项目时选中首项，用户仍能手动切换其权限范围内项目。 */
  useEffect(() => {
    if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
  }, [projectId, projectOptions.data]);

  /** 释放本地预览 URL，防止多次拍照选择造成浏览器内存持续占用。 */
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const selectedProjectId = projectId ?? 0;
  const evidenceListInput = useMemo(() => ({ projectId: selectedProjectId, limit: 50 }), [selectedProjectId]);
  const evidence = trpc.evidence.list.useQuery(evidenceListInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const upload = trpc.evidence.upload.useMutation({
    onSuccess: async () => {
      toast.success("现场影像已安全归档");
      setDescription("");
      setSourceId("");
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      await evidence.refetch();
    },
    onError: error => toast.error(error.message),
  });
  /** OCR 由用户主动发起；识别文本只作为辅助信息，页面始终显示人工复核提示。 */
  const runOcr = trpc.evidence.ocr.useMutation({
    onSuccess: async () => {
      toast.success("票据识别已完成，请人工复核结果");
      await evidence.refetch();
    },
    onError: error => toast.error(error.message),
  });

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载现场取证权限…" title="水印影像取证" description="登录后可按项目范围采集并归档现场影像。" Icon={Camera} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  /** 前端仅做体验校验；服务端会再次检查格式、大小、文件头、项目范围和坐标合法性。 */
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    if (!["image/jpeg", "image/png"].includes(selected.type)) return toast.error("仅支持 JPG 或 PNG 格式影像");
    if (selected.size > 8 * 1024 * 1024) return toast.error("单张影像不能超过 8MB");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  /** 定位权限由用户主动触发；拒绝或超时不阻断影像归档。 */
  function requestCoordinates() {
    if (!locationEnabled) return toast.error("管理员已停用浏览器定位采集连接器");
    if (!navigator.geolocation) return toast.error("当前浏览器不支持定位服务");
    navigator.geolocation.getCurrentPosition(
      position => { setCoordinates({ longitude: position.coords.longitude, latitude: position.coords.latitude }); toast.success("已读取当前定位"); },
      () => toast.error("未能读取定位，您仍可在无定位状态下归档影像"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  /** 提交影像时仅传递当前表单和本地文件；后端独立生成对象存储键与审计记录。 */
  async function submitEvidence() {
    if (!selectedProjectId) return toast.error("请先选择已授权项目");
    if (captureConfig.isError) return toast.error("采集连接器配置加载失败，请稍后重试");
    if (!cameraEnabled) return toast.error("现场影像采集连接器已被管理员停用");
    if (locationRequired && !coordinates) return toast.error("当前项目要求上传影像时读取定位");
    if (!file) return toast.error("请拍摄或选择现场影像");
    if (!description.trim()) return toast.error("请填写现场说明");
    try {
      const base64Data = await readImageAsBase64(file);
      upload.mutate({ projectId: selectedProjectId, sourceType, sourceId: sourceId.trim() || null, description: description.trim(), capturedAt: new Date().toISOString(), longitude: coordinates?.longitude ?? null, latitude: coordinates?.latitude ?? null, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png", base64Data });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "影像读取失败");
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-7 pt-6 text-[#fff7ea]">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center gap-3"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div><p className="text-sm font-semibold">工程云管</p><h1 className="mt-0.5 text-xl font-semibold">水印影像取证</h1></div></div>
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
              <div className="flex items-center justify-between rounded-xl bg-[#f9eddf] px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-xs text-[#80543d]"><MapPin className="h-3.5 w-3.5" />{coordinates ? `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}` : locationEnabled ? (locationRequired ? "需读取定位后上传" : "尚未读取定位") : "定位连接器已停用"}</span><button className="inline-flex items-center gap-1 text-xs font-semibold text-[#9a5128] disabled:cursor-not-allowed disabled:opacity-50" disabled={!locationEnabled} onClick={requestCoordinates}><LocateFixed className="h-3.5 w-3.5" />读取定位</button></div>
            </CardContent></Card>
            <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><Label>现场影像</Label><label className={`mt-2 flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8bca5] bg-[#fffaf5] p-3 text-center ${cameraEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}><input className="sr-only" type="file" accept="image/jpeg,image/png" capture="environment" disabled={!cameraEnabled} onChange={handleFileChange} />{previewUrl ? <img src={previewUrl} alt="待归档现场影像预览" className="max-h-52 rounded-xl object-cover" /> : <><ImagePlus className="h-7 w-7 text-[#ad6335]" /><span className="mt-2 text-xs font-medium text-[#80543d]">{cameraEnabled ? "拍摄或选择 JPG、PNG 影像" : "影像采集连接器已停用"}</span><span className="mt-1 text-[11px] text-[#765544]">单张不超过 8MB</span></>}</label>{file ? <p className="mt-2 truncate text-xs text-[#80685b]">已选择：{file.name}</p> : null}<Button className="mt-4 w-full bg-[#9a5128] text-white hover:bg-[#7e3d1c]" disabled={upload.isPending || captureConfig.isError || !cameraEnabled || (locationRequired && !coordinates)} onClick={submitEvidence}>{upload.isPending ? "正在安全归档…" : "归档现场影像"}</Button></CardContent></Card>
            <section><div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold">最近取证</h2><p className="mt-0.5 text-xs text-[#9b8170]">仅显示当前授权项目的影像记录</p></div><CheckCircle2 className="h-5 w-5 text-[#b87333]" /></div>{evidence.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-xs text-[#9c4d27]">影像台账加载失败：{evidence.error.message}</CardContent></Card> : evidence.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-4 text-center text-sm text-[#8f7566]">正在加载影像台账…</CardContent></Card> : !evidence.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-xs leading-5 text-[#765544]">该项目暂未归档现场影像。</CardContent></Card> : <div className="grid grid-cols-2 gap-3">{evidence.data.map(item => <Card key={item.id} className="overflow-hidden border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.07)]"><img src={item.url} alt={item.description} className="h-28 w-full object-cover" /><CardContent className="space-y-2 p-3"><p className="line-clamp-2 text-xs font-medium leading-5">{item.description}</p><p className="text-[10px] text-[#9d8574]">{formatCapturedTime(item.capturedAt)}</p>{item.ocrResult ? <div className="rounded-lg bg-[#f9eddf] p-2 text-[10px] leading-4 text-[#704b38]"><p className="flex items-center gap-1 font-semibold text-[#905027]"><ReceiptText className="h-3 w-3" />OCR 结果 · 需人工复核</p><p className="mt-1 line-clamp-2">{item.ocrResult.summary || "未能识别摘要"}</p><p className="mt-1">金额：{item.ocrResult.amount || "未识别"}</p></div> : <Button size="sm" variant="outline" className="h-7 w-full border-[#d6ae8e] px-2 text-[10px] text-[#8a4b25] hover:bg-[#fff3e5]" disabled={runOcr.isPending} onClick={() => runOcr.mutate({ id: item.id })}><ScanLine className="mr-1 h-3 w-3" />{runOcr.isPending ? "正在识别…" : "票据 OCR"}</Button>}</CardContent></Card>)}</div>}</section>
          </>}
        </main>
        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Camera className="h-5 w-5" /><span className="text-[10px] font-medium">取证</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>
    </div>
  );
}
