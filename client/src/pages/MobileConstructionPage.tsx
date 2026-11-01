import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import { useAuth } from "@/_core/hooks/useAuth";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDate, formatChinaDateTime, toDeviceDateInput } from "@/lib/businessTime";
import { clearMobileDraft, hasMobileDraftContent, readMobileDraft, saveMobileDraft } from "@/lib/mobileDraftStorage";
import { normalizeMobileImage } from "@/lib/mobileImageUpload";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { useMobileFormProtection, useMobileSafeNavigate } from "@/contexts/MobileFormProtectionContext";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "@shared/watermarkTemplate";
import { ArrowLeft, Bell, Camera, ClipboardCheck, FileText, HardHat, ImagePlus, LayoutDashboard, Pencil, Plus, Printer, ShieldCheck, UserRound, X } from "lucide-react";
import React, { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Weather = "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other";
type ReportStatus = "draft" | "submitted" | "approved" | "rejected" | "locked";

const emptyDraft = {
  reportDate: "",
  workArea: "",
  weather: "other" as Weather,
  workContent: "",
  safetyNotes: "",
  issueNotes: "",
  progressPercent: "0",
};

function getTodayText() {
  return toDeviceDateInput();
}

function formatReportDateTime(value: Date | string) {
  return formatChinaDateTime(value);
}

function getBusinessDateText(value: Date | string | null | undefined) {
  return formatChinaDate(value);
}

function getWeatherLabel(value: Weather) {
  return { sunny: "晴", cloudy: "多云", rainy: "雨", snowy: "雪", windy: "大风", other: "其他" }[value];
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("影像文件读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

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
          if (blob.size > 8 * 1024 * 1024) return reject(new Error("水印照片超过 8MB，请在相册中裁剪后重新选择"));
          const name = file.name.replace(/\.(jpe?g|png)$/i, "") || "construction-photo";
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

function getStatusMeta(value: string) {
  const labels = {
    draft: { label: "草稿", className: "bg-[#f7ead8] text-[#8a542e]" },
    submitted: { label: "待审核", className: "bg-[#f9e6bd] text-[#9c6425]" },
    approved: { label: "已审核", className: "bg-[#e5f1e3] text-[#47744d]" },
    rejected: { label: "已退回", className: "bg-[#f7e5e1] text-[#a34b3a]" },
    locked: { label: "已归档", className: "bg-[#e9ecef] text-[#59636c]" },
  } as Record<string, { label: string; className: string }>;
  return labels[value] ?? { label: "待处理", className: "bg-slate-100 text-slate-600" };
}

/** 施工现场日报页：所有可见数据均以服务端项目范围为准，页面只提供受控操作入口。 */
export default function MobileConstructionPage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const { isSuperAdmin } = useManagementPermissions();
  const navigate = useMobileSafeNavigate();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft, reportDate: getTodayText() });
  const [pendingEvidenceFiles, setPendingEvidenceFiles] = useState<File[]>([]);
  const [pendingEvidencePreviews, setPendingEvidencePreviews] = useState<string[]>([]);
  const [reportCapturedAt, setReportCapturedAt] = useState(() => new Date());
  const [weatherCoordinates, setWeatherCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [weatherAddress, setWeatherAddress] = useState("");
  const [weatherStatus, setWeatherStatus] = useState("打开新建日报后将自动获取当前天气；您仍可手动调整。");
  const [detailTarget, setDetailTarget] = useState<NonNullable<typeof reports.data>[number] | null>(null);
  const [reviewTarget, setReviewTarget] = useState<NonNullable<typeof reports.data>[number] | null>(null);
  const [reviewReply, setReviewReply] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);

  const deviceDraftKey = `construction-report:${projectId ?? "pending"}:${editingId ?? "new"}`;
  const localDraftPayload = useMemo(() => ({
    reportDate: draft.reportDate,
    workArea: draft.workArea,
    weather: draft.weather,
    workContent: draft.workContent,
    safetyNotes: draft.safetyNotes,
    issueNotes: draft.issueNotes,
    progressPercent: draft.progressPercent,
  }), [draft]);
  const localDraftDirty = dialogOpen && (hasMobileDraftContent(localDraftPayload, ["reportDate", "weather", "progressPercent"]) || draft.progressPercent !== "0" || pendingEvidenceFiles.length > 0);

  function resetReportForm() {
    setDialogOpen(false);
    setEditingId(null);
    setDraft({ ...emptyDraft, reportDate: getTodayText() });
    pendingEvidencePreviews.forEach(url => URL.revokeObjectURL(url));
    setPendingEvidenceFiles([]);
    setPendingEvidencePreviews([]);
  }

  const { requestClose: requestReportClose } = useMobileFormProtection({
    id: "construction-report-form",
    label: pendingEvidenceFiles.length ? "施工日报（已选照片需重新选择）" : "施工日报",
    isDirty: localDraftDirty,
    saveDraft: () => {
      if (!saveMobileDraft(deviceDraftKey, localDraftPayload)) throw new Error("本机草稿保存失败");
      toast.success("日报文字内容已保存到本机草稿；照片不会保存在设备草稿中");
    },
    discard: () => {
      clearMobileDraft(deviceDraftKey);
      resetReportForm();
    },
  });

  const projectOptions = trpc.construction.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => {
    if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
  }, [projectId, projectOptions.data]);

  const selectedProjectId = projectId ?? 0;
  useEffect(() => {
    setDetailTarget(null);
    setReviewTarget(null);
    setReviewReply("");
  }, [selectedProjectId]);
  const reportInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const reports = trpc.construction.listReports.useQuery(reportInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.construction.summary.useQuery(reportInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const reportEvidenceIds = useMemo(() => Array.from(new Set([detailTarget?.id, reviewTarget?.id].filter((id): id is number => Number.isInteger(id)))), [detailTarget?.id, reviewTarget?.id]);
  const reportEvidenceInput = useMemo(() => ({ projectId: selectedProjectId, reportIds: reportEvidenceIds.length ? reportEvidenceIds : [0] }), [selectedProjectId, reportEvidenceIds]);
  const reportEvidence = trpc.construction.reportEvidence.useQuery(reportEvidenceInput, { enabled: isAuthenticated && Boolean(selectedProjectId) && reportEvidenceIds.length > 0, retry: false });
  const detailEvidence = useMemo(() => (reportEvidence.data ?? []).filter(item => item.reportId === detailTarget?.id), [reportEvidence.data, detailTarget?.id]);
  const reviewEvidence = useMemo(() => (reportEvidence.data ?? []).filter(item => item.reportId === reviewTarget?.id), [reportEvidence.data, reviewTarget?.id]);
  const resolvedWeather = trpc.construction.resolveCurrentWeather.useQuery(weatherCoordinates ?? { latitude: 0, longitude: 0 }, { enabled: isAuthenticated && dialogOpen && !editingId && Boolean(weatherCoordinates), retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const evidenceUpload = trpc.evidence.upload.useMutation({ onError: error => toast.error(getUserFacingErrorMessage(error, "施工日报操作未完成，请稍后重试")) });
  const reverseGeocode = trpc.location.reverseGeocode.useMutation({
    onSuccess: result => setWeatherAddress(result.address),
    onError: () => setWeatherStatus("已读取现场定位，但暂未解析中文详细地址；请稍后重新打开日报。"),
  });

  useEffect(() => {
    if (!resolvedWeather.data) return;
    if (resolvedWeather.data.source === "auto") {
      setDraft(current => ({ ...current, weather: resolvedWeather.data.weather }));
      setWeatherStatus(`已自动获取天气：${getWeatherLabel(resolvedWeather.data.weather)}（可手动修改）`);
    } else {
      setWeatherStatus("当前无法自动获取天气，请手动选择。");
    }
  }, [resolvedWeather.data]);

  useEffect(() => {
    if (!dialogOpen) return;
    const saved = readMobileDraft<typeof localDraftPayload>(deviceDraftKey);
    if (!saved || !hasMobileDraftContent(saved.value)) return;
    setDraft(current => ({ ...current, ...saved.value }));
    toast.info("已恢复这台设备上未提交的施工日报文字草稿；照片需重新选择。");
  // 仅在表单首次打开或切换编辑记录时恢复，避免输入中被重复覆盖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, deviceDraftKey]);

  const saveReport = trpc.construction.saveReport.useMutation({
    onSuccess: async result => {
      const files = pendingEvidenceFiles;
      const watermarkTemplate = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
      const locationRequired = captureConfig.data?.location.required ?? false;
      const selectedProject = projectOptions.data?.find(project => project.id === selectedProjectId);
      try {
        if (files.length) {
          if (locationRequired && !weatherCoordinates) throw new Error("当前项目要求上传现场照片时读取定位");
          if (weatherCoordinates && !weatherAddress) throw new Error("正在解析中文详细地址，请稍候再提交日报照片");
          const capturedAt = new Date();
          const antiCounterfeitId = `${selectedProjectId}-${capturedAt.getTime().toString(36).toUpperCase()}`;
          const watermarkValues: Record<string, string> = {
            capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`,
            principal: `施工负责人：${user?.name || "当前管理员"}`,
            weather: `天气：${getWeatherLabel(draft.weather)}`,
            location: `详细地点：${weatherAddress || "未取得"}`,
            coordinates: `详细地点：${weatherAddress || "未取得"}`,
            organization: `施工单位：${watermarkTemplate.organizationLabel}`,
            project: `项目名称：${selectedProject?.name || `项目 #${selectedProjectId}`}`,
            antiCounterfeit: `防伪编号：${antiCounterfeitId}`,
          };
          const watermarkLines = watermarkTemplate.fields.map(field => watermarkValues[field]).filter(Boolean);
          const description = `${draft.workArea} · ${draft.workContent.slice(0, 100)}｜${watermarkLines.join("；")}`.slice(0, 500);
          for (const file of files) {
            const watermarkedFile = await createWatermarkedImage(file, watermarkLines, watermarkTemplate);
            const base64Data = await readImageAsBase64(watermarkedFile);
            await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "site_photo", sourceId: `construction-report-${result.id}`, description, capturedAt: capturedAt.toISOString(), longitude: weatherCoordinates?.longitude ?? null, latitude: weatherCoordinates?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data });
          }
        }
        toast.success(files.length ? `施工日报已保存，${files.length} 张水印照片已关联本日报` : (editingId ? "施工日报已更新" : "施工日报已保存为草稿"));
      } catch (error) {
        // 日报主体已由服务端保存。保留照片和弹窗，转入编辑态后可直接再次提交归档，
        // 避免网络、定位或个别 HEIC 解码失败时让现场人员重新填写整份日报。
        setEditingId(result.id);
        toast.error(`日报已保存，照片尚未归档：${getUserFacingErrorMessage(error, "请检查照片后重试")}`);
        await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
        return;
      }
      clearMobileDraft(deviceDraftKey);
      resetReportForm();
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "施工日报操作未完成，请稍后重试")),
  });
  const transitionReport = trpc.construction.transitionReport.useMutation({
    onSuccess: async () => {
      toast.success("施工日报状态已更新");
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "施工日报操作未完成，请稍后重试")),
  });
  const submitForReview = trpc.construction.submitReportForReview.useMutation({
    onSuccess: async result => {
      toast.success(`日报已上报 ${result.supervisorCount} 位项目主管审核`);
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "施工日报操作未完成，请稍后重试")),
  });
  const reviewReport = trpc.construction.reviewReport.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "locked" ? "已确认通过并自动归档" : "日报已退回填报人修改");
      setReviewTarget(null);
      setReviewReply("");
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "施工日报操作未完成，请稍后重试")),
  });

  function openCreate() {
    setEditingId(null);
    setDraft({ ...emptyDraft, reportDate: getTodayText() });
    setReportCapturedAt(new Date());
    setWeatherCoordinates(null);
    setWeatherAddress("");
    pendingEvidencePreviews.forEach(url => URL.revokeObjectURL(url));
    setPendingEvidenceFiles([]);
    setPendingEvidencePreviews([]);
    setWeatherStatus("正在获取定位与当前天气；您仍可手动调整天气。");
    setDialogOpen(true);
    if (!navigator.geolocation) {
      setWeatherStatus("当前设备不支持定位，无法自动获取天气，请手动选择。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setWeatherCoordinates(next);
        setWeatherAddress("");
        reverseGeocode.mutate(next);
      },
      () => setWeatherStatus("未取得定位，无法自动获取天气，请手动选择。"),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 10 * 60_000 },
    );
  }

  function openEdit(report: NonNullable<typeof reports.data>[number]) {
    setEditingId(report.id);
    setDraft({
      reportDate: getBusinessDateText(report.reportDate),
      workArea: report.workArea,
      weather: report.weather,
      workContent: report.workContent,
      safetyNotes: report.safetyNotes ?? "",
      issueNotes: report.issueNotes ?? "",
      progressPercent: String(report.progressPercent ?? 0),
    });
    setReportCapturedAt(new Date());
    setWeatherCoordinates(null);
    pendingEvidencePreviews.forEach(url => URL.revokeObjectURL(url));
    setPendingEvidenceFiles([]);
    setPendingEvidencePreviews([]);
    setWeatherStatus("修改日报时保留原天气；如需调整请手动选择。");
    setDialogOpen(true);
  }

  async function handleEvidenceFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    const availableSlots = Math.max(0, 12 - pendingEvidenceFiles.length);
    if (!availableSlots) return toast.warning("最多关联 12 张现场照片，请先移除不需要的照片");
    const accepted = selected.slice(0, availableSlots);
    if (accepted.length < selected.length) toast.warning("最多关联 12 张现场照片，超出部分未加入");
    try {
      const normalized = await Promise.all(accepted.map(file => normalizeMobileImage(file, { maxEdge: 1920, quality: 0.84 })));
      const combined = [...pendingEvidenceFiles, ...normalized];
      pendingEvidencePreviews.forEach(url => URL.revokeObjectURL(url));
      setPendingEvidenceFiles(combined);
      setPendingEvidencePreviews(combined.map(file => URL.createObjectURL(file)));
      toast.success(`已添加 ${normalized.length} 张照片，保存日报后自动生成水印并归档`);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "照片处理失败，请重新拍摄或从相册选择"));
    }
  }

  function removePendingEvidence(index: number) {
    const nextFiles = pendingEvidenceFiles.filter((_, currentIndex) => currentIndex !== index);
    pendingEvidencePreviews.forEach(url => URL.revokeObjectURL(url));
    setPendingEvidenceFiles(nextFiles);
    setPendingEvidencePreviews(nextFiles.map(file => URL.createObjectURL(file)));
  }

  function submitDraft() {
    if (!selectedProjectId) return;
    const progressPercent = Number(draft.progressPercent);
    if (!Number.isFinite(progressPercent)) {
      toast.error("请填写有效的累计完成比例");
      return;
    }
    saveReport.mutate({
      ...(editingId ? { id: editingId } : {}),
      projectId: selectedProjectId,
      reportDate: draft.reportDate,
      workArea: draft.workArea,
      weather: draft.weather,
      workContent: draft.workContent,
      safetyNotes: draft.safetyNotes || null,
      issueNotes: draft.issueNotes || null,
      progressPercent,
    });
  }

  async function printCurrentReports() {
    if (!selectedProjectId) return;
    setIsPrinting(true);
    try {
      const printableReports = await utils.construction.printReports.fetch({ projectId: selectedProjectId });
      const projectName = projectOptions.data?.find(project => project.id === selectedProjectId)?.name ?? "当前项目";
      const statusCounts = printableReports.reduce((counts, report) => ({ ...counts, [report.status]: (counts[report.status] ?? 0) + 1 }), {} as Record<string, number>);
      const rows = printableReports.map((report, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(getBusinessDateText(report.reportDate))}</td><td>${escapePrintHtml(report.workArea)}</td><td>${escapePrintHtml(getWeatherLabel(report.weather))}</td><td class="right">${escapePrintHtml(Number(report.progressPercent ?? 0).toFixed(2))}%</td><td>${escapePrintHtml(getStatusMeta(report.status).label)}</td><td>${escapePrintHtml(report.workContent.slice(0, 240))}</td><td>${escapePrintHtml(report.safetyNotes || "—")}</td><td>${escapePrintHtml(report.issueNotes || "—")}</td></tr>`).join("");
      openA4LandscapePrintDocument({ title: "施工日报明细表", bodyHtml: `<h1>施工日报明细表</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr><th style="width:5%">序号</th><th style="width:10%">日期</th><th style="width:12%">施工部位</th><th style="width:6%">天气</th><th style="width:8%">累计进度</th><th style="width:9%">状态</th><th style="width:22%">施工内容</th><th style="width:14%">安全情况</th><th style="width:14%">质量/协调问题</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="center">当前项目暂无施工日报</td></tr>'}<tr class="summary"><td colspan="9">合计：当前项目施工日报 ${printableReports.length} 份；待审核 ${statusCounts.submitted ?? 0} 份，已审核 ${(statusCounts.approved ?? 0) + (statusCounts.locked ?? 0)} 份。</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "当前账号无施工日报打印权限，或请缩小打印范围后重试"));
    } finally {
      setIsPrinting(false);
    }
  }

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载施工现场权限…" title="施工现场日报" description="请先登录，系统会按岗位、项目范围与授权有效期展示施工业务。" Icon={HardHat} onRetry={() => void refresh()} />;
  }

  const isBusy = projectOptions.isLoading || reports.isLoading || summary.isLoading;
  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mobile-viewport-shell mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(71,42,29,.12)]">
        <header className="bg-[#3a2117] px-5 pb-7 pt-5 text-[#fff7ea]">
          <div className="flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">施工现场</p><p className="mt-0.5 text-xs text-[#e8cfb2]">日报 · 进度 · 安全问题</p></div><button aria-label="打印当前施工日报" disabled={isPrinting} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 disabled:opacity-60" onClick={() => { void printCurrentReports(); }}><Printer className="h-5 w-5" /></button></div>
          <div className="mt-6"><Label htmlFor="construction-project" className="text-xs text-[#e8cfb2]">当前项目</Label><Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger id="construction-project" className="mt-1 border-white/15 bg-white/10 text-[#fff7ea]"><SelectValue placeholder="请选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div>
        </header>

        <main className="space-y-5 px-5 pt-5">
          {!projectOptions.isLoading && !projectOptions.data?.length ? <Card className="border-[#ead9c8] bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">当前账号尚未获施工现场项目范围授权。请由超级管理员在“人员与权限”中配置角色和项目范围。</CardContent></Card> : null}
          {selectedProjectId ? <section className="grid grid-cols-2 gap-3 print:hidden"><Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><p className="text-xs text-[#8f7566]">日报数量</p><p className="mt-1 text-2xl font-semibold">{summary.data?.total ?? 0}</p><p className="mt-1 text-xs text-[#9b8170]">待审核 {summary.data?.submitted ?? 0} 份</p></CardContent></Card><Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><p className="text-xs text-[#8f7566]">平均累计进度</p><p className="mt-1 text-2xl font-semibold">{summary.data?.averageProgressPercent ?? 0}%</p><p className="mt-1 text-xs text-[#9b8170]">已审核 {summary.data?.approved ?? 0} 份</p></CardContent></Card></section> : null}

          <section id="construction-print-area" className="space-y-3"><div className="flex items-center justify-between"><div><h1 className="text-lg font-semibold">施工日报</h1><p className="mt-1 text-xs text-[#9b8170]">填报人提交后上报项目主管审核；主管回复并确认后自动归档锁定。</p></div><Button disabled={!selectedProjectId || saveReport.isPending} className="bg-[#9f582b] text-white hover:bg-[#85451f] print:hidden" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />新建日报</Button></div>
            {isBusy ? <Card className="border-[#ead9c8] bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">正在读取真实施工日报…</CardContent></Card> : null}
            {!isBusy && selectedProjectId && !reports.data?.length ? <Card className="border-dashed border-[#dfc4a9] bg-[#fffaf2]"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#b87333]" /><p className="mt-3 text-sm font-medium">暂无施工日报</p><p className="mt-1 text-xs leading-5 text-[#8f7566]">请根据真实现场情况录入第一份日报，不会生成演示数据。</p></CardContent></Card> : null}
            {reports.data?.map(report => {
              const status = getStatusMeta(report.status);
              const isOwner = report.createdBy === user?.id;
              const canEdit = (isOwner || isSuperAdmin) && (report.status === "draft" || report.status === "rejected");
              return <Card key={report.id} className="border-[#ead9c8] bg-white"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{getBusinessDateText(report.reportDate)} · {report.workArea}</p><span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#9b8170]">天气：{getWeatherLabel(report.weather)} · 累计完成 {Number(report.progressPercent ?? 0).toFixed(2)}%</p></div>{canEdit ? <Button variant="outline" size="sm" className="border-[#dfc4a9] bg-white print:hidden" onClick={() => openEdit(report)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button> : null}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#5b3b2e]">{report.workContent}</p>{report.safetyNotes ? <p className="mt-2 rounded-xl bg-[#fff3df] p-2 text-xs leading-5 text-[#7a4d25]">安全：{report.safetyNotes}</p> : null}{report.issueNotes ? <p className="mt-2 rounded-xl bg-[#f9e9e4] p-2 text-xs leading-5 text-[#934936]">问题：{report.issueNotes}</p> : null}{report.reviewReply ? <p className={`mt-2 rounded-xl p-2 text-xs leading-5 ${report.status === "rejected" ? "bg-[#f9e9e4] text-[#934936]" : "bg-[#eaf4ec] text-[#3f6d46]"}`}>主管回复：{report.reviewReply}</p> : null}<div className="mt-3 flex flex-wrap gap-2 print:hidden"><Button size="sm" variant="outline" className="border-[#b99679] text-[#6c452f]" onClick={() => setDetailTarget(report)}><FileText className="mr-1 h-3.5 w-3.5" />查看详情</Button>{isOwner && report.status === "draft" ? <Button size="sm" className="bg-[#9f582b] text-white hover:bg-[#85451f]" disabled={submitForReview.isPending} onClick={() => submitForReview.mutate({ id: report.id, projectId: selectedProjectId })}>提交主管审核</Button> : null}{report.status === "submitted" ? <Button size="sm" variant="outline" className="border-[#6f9775] text-[#3f6d46]" onClick={() => { setReviewTarget(report); setReviewReply(""); }}>主管审核回复</Button> : null}</div></CardContent></Card>;
            })}
          </section>
        </main>

        <nav className="mobile-bottom-navigation fixed right-0 bottom-0 left-0 z-20 flex w-full max-w-none items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><HardHat className="h-5 w-5" /><span className="text-[10px] font-medium">施工</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>

      <Dialog open={dialogOpen} onOpenChange={open => { if (open) setDialogOpen(true); else requestReportClose(resetReportForm); }}>
          <DialogContent className="max-h-[92dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <DialogHeader>
            <DialogTitle>{editingId ? "修改施工日报" : "新建施工日报"}</DialogTitle>
            <DialogDescription>先保存日报与本次照片，再由日报卡片点击“提交主管审核”。照片将自动关联本日报，无须跳转或反复返回填写页面。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="report-date">日期 + 时间</Label><Input id="report-date" type="date" value={draft.reportDate} onChange={event => setDraft(current => ({ ...current, reportDate: event.target.value }))} /><p className="mt-1 text-[11px] text-[#8f7566]">{formatReportDateTime(reportCapturedAt)}</p></div>
              <div><Label htmlFor="report-weather">天气</Label><Select value={draft.weather} onValueChange={value => { setDraft(current => ({ ...current, weather: value as Weather })); setWeatherStatus("天气已手动调整。"); }}><SelectTrigger id="report-weather"><SelectValue /></SelectTrigger><SelectContent>{(["sunny", "cloudy", "rainy", "snowy", "windy", "other"] as Weather[]).map(weather => <SelectItem key={weather} value={weather}>{getWeatherLabel(weather)}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[11px] leading-4 text-[#47744d]">{weatherStatus}</p></div>
            </div>
            <div><Label htmlFor="report-area">施工部位 / 作业面</Label><Input id="report-area" value={draft.workArea} maxLength={200} placeholder="例如：K12+500 路基填筑作业面" onChange={event => setDraft(current => ({ ...current, workArea: event.target.value }))} /></div>
            <div><Label htmlFor="report-progress">累计完成比例（%）</Label><Input id="report-progress" type="number" min="0" max="100" step="0.01" value={draft.progressPercent} onChange={event => setDraft(current => ({ ...current, progressPercent: event.target.value }))} /></div>
            <div><Label htmlFor="report-content">当日施工内容</Label><Textarea id="report-content" value={draft.workContent} maxLength={8000} placeholder="填写人员、工序、产出或实际施工情况。" onChange={event => setDraft(current => ({ ...current, workContent: event.target.value }))} /></div>
            <div><Label htmlFor="report-safety">安全情况（可选）</Label><Textarea id="report-safety" value={draft.safetyNotes} maxLength={1000} placeholder="不得填写个人敏感信息。" onChange={event => setDraft(current => ({ ...current, safetyNotes: event.target.value }))} /></div>
            <div><Label htmlFor="report-issues">质量 / 协调问题（可选）</Label><Textarea id="report-issues" value={draft.issueNotes} maxLength={1000} placeholder="不得填写个人敏感信息；现场照片将统一固化管理员、项目、定位、日期、时间和天气水印。" onChange={event => setDraft(current => ({ ...current, issueNotes: event.target.value }))} /></div>
            <div className="rounded-xl border border-dashed border-[#d8bca5] bg-[#fffaf5] p-3"><div className="flex items-center justify-between gap-3"><div><Label>现场水印照片（可连续添加）</Label><p className="mt-1 text-[11px] leading-4 text-[#80685b]">支持相机直拍和从手机相册选择；照片会压缩为 JPG 后在保存日报时生成水印并关联，单次最多 12 张。</p></div>{pendingEvidenceFiles.length ? <span className="shrink-0 rounded-full bg-[#f9eddf] px-2 py-1 text-xs font-semibold text-[#8a4b25]">已选 {pendingEvidenceFiles.length}/12 张</span> : null}</div><div className="mt-3 grid grid-cols-2 gap-2"><label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d8bca5] bg-white p-3 text-center"><input className="sr-only" type="file" multiple accept="image/*" capture="environment" onChange={event => { void handleEvidenceFiles(event); }} /><Camera className="h-5 w-5 text-[#ad6335]" /><span className="mt-1 text-xs font-medium text-[#80543d]">拍摄现场照片</span></label><label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d8bca5] bg-white p-3 text-center"><input className="sr-only" type="file" multiple accept="image/*" onChange={event => { void handleEvidenceFiles(event); }} /><ImagePlus className="h-5 w-5 text-[#ad6335]" /><span className="mt-1 text-xs font-medium text-[#80543d]">从手机相册选择</span></label></div>{pendingEvidencePreviews.length ? <div className="mt-3 grid grid-cols-4 gap-2">{pendingEvidencePreviews.map((url, index) => <div key={`${url}-${index}`} className="relative"><img src={url} alt={`待关联日报照片 ${index + 1}`} className="aspect-square w-full rounded-lg object-cover" /><button aria-label={`移除照片 ${index + 1}`} type="button" className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#6d3421] text-white shadow" onClick={() => removePendingEvidence(index)}><X className="h-3 w-3" /></button></div>)}</div> : null}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => requestReportClose(resetReportForm)}>取消</Button>
            <Button variant="secondary" onClick={() => { if (saveMobileDraft(deviceDraftKey, localDraftPayload)) toast.success("日报文字内容已保存到本机草稿；照片需重新选择"); else toast.error("本机草稿保存失败，请检查设备存储权限"); }}>保存本机草稿</Button>
            <Button disabled={saveReport.isPending || evidenceUpload.isPending} className="bg-[#9f582b] text-white hover:bg-[#85451f]" onClick={submitDraft}><Camera className="mr-1.5 h-4 w-4" />{saveReport.isPending || evidenceUpload.isPending ? "正在保存…" : pendingEvidenceFiles.length ? `保存日报并归档 ${pendingEvidenceFiles.length} 张照片` : (editingId ? "保存修改" : "保存草稿")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(detailTarget)} onOpenChange={open => { if (!open) setDetailTarget(null); }}>
        <DialogContent className="max-h-[88dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <DialogHeader>
            <DialogTitle>施工日报详情</DialogTitle>
            <DialogDescription>只读查看当前项目内的日报、审核结果与关联现场照片；详情不授予编辑或审核权限。</DialogDescription>
          </DialogHeader>
          {detailTarget ? <div className="space-y-4"><section className="rounded-xl bg-[#fff5e8] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{getBusinessDateText(detailTarget.reportDate)} · {detailTarget.workArea}</p><span className={`rounded-full px-2 py-0.5 text-xs ${getStatusMeta(detailTarget.status).className}`}>{getStatusMeta(detailTarget.status).label}</span></div><p className="mt-2 text-xs leading-5 text-[#80604c]">填报管理员：{detailTarget.createdByName || `管理员 #${detailTarget.createdBy}`}　·　天气：{getWeatherLabel(detailTarget.weather)}　·　累计完成 {Number(detailTarget.progressPercent ?? 0).toFixed(2)}%</p></section><section className="space-y-2"><p className="text-sm font-semibold text-[#5b3b2e]">当日施工内容</p><p className="whitespace-pre-wrap rounded-xl border border-[#ead9c8] bg-white p-3 text-sm leading-6 text-[#5b3b2e]">{detailTarget.workContent}</p></section><div className="grid gap-3 sm:grid-cols-2"><section className="rounded-xl bg-[#fff3df] p-3"><p className="text-xs font-semibold text-[#7a4d25]">安全情况</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#7a4d25]">{detailTarget.safetyNotes || "未记录"}</p></section><section className="rounded-xl bg-[#f9e9e4] p-3"><p className="text-xs font-semibold text-[#934936]">质量 / 协调问题</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#934936]">{detailTarget.issueNotes || "未记录"}</p></section></div>{detailTarget.reviewReply ? <section className={`rounded-xl p-3 ${detailTarget.status === "rejected" ? "bg-[#f9e9e4] text-[#934936]" : "bg-[#eaf4ec] text-[#3f6d46]"}`}><p className="text-xs font-semibold">主管审核回复</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{detailTarget.reviewReply}</p></section> : null}<section className="rounded-xl border border-[#ead9c8] bg-[#fffaf5] p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold text-[#5b3b2e]">关联现场照片</p><p className="mt-1 text-[11px] leading-4 text-[#8f7566]">仅在当前项目与施工读取授权范围内站内预览。</p></div><span className="rounded-full bg-[#f9eddf] px-2 py-1 text-xs font-semibold text-[#8a4b25]">{reportEvidence.isFetching ? "读取中" : `${detailEvidence.length} 张`}</span></div>{reportEvidence.isFetching ? <p className="mt-3 text-xs text-[#8f7566]">正在读取关联影像…</p> : detailEvidence.length ? <div className="mt-3 grid grid-cols-2 gap-2">{detailEvidence.map((photo, index) => <ProtectedImagePreview key={photo.id} file={{ url: photo.url, fileName: photo.fileName }} title={`施工日报照片 ${index + 1}`} description="现场水印照片仅在当前项目授权范围内站内预览。" className="overflow-hidden rounded-lg border border-[#ead9c8] bg-white"><img className="aspect-square w-full object-cover" src={photo.url} alt={photo.description || `施工日报照片 ${index + 1}`} /><span className="block truncate px-2 py-1.5 text-[11px] text-[#80604c]">照片 {index + 1} · 点击预览</span></ProtectedImagePreview>)}</div> : <p className="mt-3 rounded-lg bg-white p-2 text-xs leading-5 text-[#8f7566]">该日报暂未关联照片。</p>}</section></div> : null}
          <DialogFooter><Button onClick={() => setDetailTarget(null)}>关闭详情</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(reviewTarget)} onOpenChange={open => { if (!open) { setReviewTarget(null); setReviewReply(""); } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>主管审核施工日报</DialogTitle>
            <DialogDescription>请填写审核回复。确认通过后，日报将立即归档锁定；退回后仅填报人可修改并重新提交。</DialogDescription>
          </DialogHeader>
          {reviewTarget ? <div className="space-y-4"><div className="rounded-xl bg-[#fff5e8] p-3 text-sm"><p className="font-semibold">{getBusinessDateText(reviewTarget.reportDate)} · {reviewTarget.workArea}</p><p className="mt-1 text-xs leading-5 text-[#80604c]">{reviewTarget.workContent}</p></div><section className="rounded-xl border border-[#ead9c8] bg-[#fffaf5] p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold text-[#5b3b2e]">随日报提交的现场照片</p><p className="mt-1 text-[11px] leading-4 text-[#8f7566]">水印照片仅对当前项目的主管审核范围显示。</p></div><span className="rounded-full bg-[#f9eddf] px-2 py-1 text-xs font-semibold text-[#8a4b25]">{reportEvidence.isFetching ? "读取中" : `${reviewEvidence.length} 张`}</span></div>{reportEvidence.isFetching ? <p className="mt-3 text-xs text-[#8f7566]">正在读取关联影像…</p> : reviewEvidence.length ? <div className="mt-3 grid grid-cols-2 gap-2">{reviewEvidence.map((photo, index) => <ProtectedImagePreview key={photo.id} file={{ url: photo.url }} title={`施工日报照片 ${index + 1}`} description="现场水印照片仅在当前项目与审核授权范围内站内预览。" className="overflow-hidden rounded-lg border border-[#ead9c8] bg-white"><img className="aspect-square w-full object-cover" src={photo.url} alt={photo.description || `施工日报照片 ${index + 1}`} /><span className="block truncate px-2 py-1.5 text-[11px] text-[#80604c]">照片 {index + 1} · 点击预览</span></ProtectedImagePreview>)}</div> : <p className="mt-3 rounded-lg bg-white p-2 text-xs leading-5 text-[#8f7566]">该日报暂未关联照片。填报人可在日报新建或编辑窗口中连续补充水印照片。</p>}</section><div><Label htmlFor="review-reply">审核回复</Label><Textarea id="review-reply" value={reviewReply} maxLength={1000} placeholder="填写确认意见、整改要求或退回原因。" onChange={event => setReviewReply(event.target.value)} /></div></div> : null}
          <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => { setReviewTarget(null); setReviewReply(""); }}>取消</Button><Button variant="outline" className="border-[#c98666] text-[#9a432b]" disabled={!reviewTarget || reviewReport.isPending || reviewReply.trim().length < 2} onClick={() => reviewTarget && reviewReport.mutate({ id: reviewTarget.id, projectId: selectedProjectId, decision: "return", reply: reviewReply })}>退回修改</Button><Button className="bg-[#47744d] text-white hover:bg-[#3a603f]" disabled={!reviewTarget || reviewReport.isPending || reviewReply.trim().length < 2} onClick={() => reviewTarget && reviewReport.mutate({ id: reviewTarget.id, projectId: selectedProjectId, decision: "confirm", reply: reviewReply })}>{reviewReport.isPending ? "正在处理…" : "确认通过并归档"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
