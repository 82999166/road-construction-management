import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useAuth } from "@/_core/hooks/useAuth";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Bell, Camera, ClipboardCheck, FileText, HardHat, LayoutDashboard, Pencil, Plus, Printer, ShieldCheck, UserRound } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatReportDateTime(value: Date) {
  return value.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function getBusinessDateText(value: Date | string | null | undefined) {
  if (!value) return "—";
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function getWeatherLabel(value: Weather) {
  return { sunny: "晴", cloudy: "多云", rainy: "雨", snowy: "雪", windy: "大风", other: "其他" }[value];
}

function getStatusMeta(value: ReportStatus) {
  return {
    draft: { label: "草稿", className: "bg-[#f7ead8] text-[#8a542e]" },
    submitted: { label: "待审核", className: "bg-[#f9e6bd] text-[#9c6425]" },
    approved: { label: "已审核", className: "bg-[#e5f1e3] text-[#47744d]" },
    rejected: { label: "已退回", className: "bg-[#f7e5e1] text-[#a34b3a]" },
    locked: { label: "已归档", className: "bg-[#e9ecef] text-[#59636c]" },
  }[value];
}

/** 施工现场日报页：所有可见数据均以服务端项目范围为准，页面只提供受控操作入口。 */
export default function MobileConstructionPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const { isSuperAdmin } = useManagementPermissions();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft, reportDate: getTodayText() });
  const [captureAfterSave, setCaptureAfterSave] = useState(false);
  const [reportCapturedAt, setReportCapturedAt] = useState(() => new Date());
  const [weatherCoordinates, setWeatherCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("打开新建日报后将自动获取当前天气；您仍可手动调整。");

  const projectOptions = trpc.construction.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => {
    if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
  }, [projectId, projectOptions.data]);

  const selectedProjectId = projectId ?? 0;
  const reportInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const reports = trpc.construction.listReports.useQuery(reportInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.construction.summary.useQuery(reportInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const resolvedWeather = trpc.construction.resolveCurrentWeather.useQuery(weatherCoordinates ?? { latitude: 0, longitude: 0 }, { enabled: isAuthenticated && dialogOpen && !editingId && Boolean(weatherCoordinates), retry: false });

  useEffect(() => {
    if (!resolvedWeather.data) return;
    if (resolvedWeather.data.source === "auto") {
      setDraft(current => ({ ...current, weather: resolvedWeather.data.weather }));
      setWeatherStatus(`已自动获取天气：${getWeatherLabel(resolvedWeather.data.weather)}（可手动修改）`);
    } else {
      setWeatherStatus("当前无法自动获取天气，请手动选择。");
    }
  }, [resolvedWeather.data]);

  const saveReport = trpc.construction.saveReport.useMutation({
    onSuccess: async result => {
      const shouldCapture = captureAfterSave;
      const captureWeather = getWeatherLabel(draft.weather);
      const captureDescription = `${draft.workArea} · ${draft.workContent.slice(0, 100)}`;
      toast.success(editingId ? "施工日报已更新" : "施工日报已保存为草稿");
      setDialogOpen(false);
      setEditingId(null);
      setDraft({ ...emptyDraft, reportDate: getTodayText() });
      setCaptureAfterSave(false);
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
      if (shouldCapture) navigate(`/mobile/evidence?projectId=${selectedProjectId}&sourceType=site_photo&sourceId=construction-report-${result.id}&weather=${encodeURIComponent(captureWeather)}&description=${encodeURIComponent(captureDescription)}`);
    },
    onError: error => toast.error(error.message),
  });
  const transitionReport = trpc.construction.transitionReport.useMutation({
    onSuccess: async () => {
      toast.success("施工日报状态已更新");
      await Promise.all([utils.construction.listReports.invalidate(), utils.construction.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  function openCreate() {
    setEditingId(null);
    setDraft({ ...emptyDraft, reportDate: getTodayText() });
    setReportCapturedAt(new Date());
    setWeatherCoordinates(null);
    setWeatherStatus("正在获取定位与当前天气；您仍可手动调整天气。");
    setDialogOpen(true);
    if (!navigator.geolocation) {
      setWeatherStatus("当前设备不支持定位，无法自动获取天气，请手动选择。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => setWeatherCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
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
    setWeatherStatus("修改日报时保留原天气；如需调整请手动选择。");
    setDialogOpen(true);
  }

  function submitDraft(withEvidence = false) {
    if (!selectedProjectId) return;
    const progressPercent = Number(draft.progressPercent);
    if (!Number.isFinite(progressPercent)) {
      toast.error("请填写有效的累计完成比例");
      return;
    }
    setCaptureAfterSave(withEvidence);
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

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载施工现场权限…" title="施工现场日报" description="请先登录，系统会按岗位、项目范围与授权有效期展示施工业务。" Icon={HardHat} onRetry={() => void refresh()} />;
  }

  const isBusy = projectOptions.isLoading || reports.isLoading || summary.isLoading;
  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="bg-[#3a2117] px-5 pb-7 pt-5 text-[#fff7ea]">
          <div className="flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">施工现场</p><p className="mt-0.5 text-xs text-[#e8cfb2]">日报 · 进度 · 安全问题</p></div><button aria-label="打印当前施工日报" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={() => window.print()}><Printer className="h-5 w-5" /></button></div>
          <div className="mt-6"><Label htmlFor="construction-project" className="text-xs text-[#e8cfb2]">当前项目</Label><Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger id="construction-project" className="mt-1 border-white/15 bg-white/10 text-[#fff7ea]"><SelectValue placeholder="请选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div>
        </header>

        <main className="space-y-5 px-5 pt-5">
          {!projectOptions.isLoading && !projectOptions.data?.length ? <Card className="border-[#ead9c8] bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">当前账号尚未获施工现场项目范围授权。请由超级管理员在“人员与权限”中配置角色和项目范围。</CardContent></Card> : null}
          {selectedProjectId ? <section className="grid grid-cols-2 gap-3 print:hidden"><Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><p className="text-xs text-[#8f7566]">日报数量</p><p className="mt-1 text-2xl font-semibold">{summary.data?.total ?? 0}</p><p className="mt-1 text-xs text-[#9b8170]">待审核 {summary.data?.submitted ?? 0} 份</p></CardContent></Card><Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-4"><p className="text-xs text-[#8f7566]">平均累计进度</p><p className="mt-1 text-2xl font-semibold">{summary.data?.averageProgressPercent ?? 0}%</p><p className="mt-1 text-xs text-[#9b8170]">已审核 {summary.data?.approved ?? 0} 份</p></CardContent></Card></section> : null}

          <section id="construction-print-area" className="space-y-3"><div className="flex items-center justify-between"><div><h1 className="text-lg font-semibold">施工日报</h1><p className="mt-1 text-xs text-[#9b8170]">日报提交后由超级管理员审核与归档，归档记录不支持回退。</p></div><Button disabled={!selectedProjectId || saveReport.isPending} className="bg-[#9f582b] text-white hover:bg-[#85451f] print:hidden" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />新建日报</Button></div>
            {isBusy ? <Card className="border-[#ead9c8] bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">正在读取真实施工日报…</CardContent></Card> : null}
            {!isBusy && selectedProjectId && !reports.data?.length ? <Card className="border-dashed border-[#dfc4a9] bg-[#fffaf2]"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#b87333]" /><p className="mt-3 text-sm font-medium">暂无施工日报</p><p className="mt-1 text-xs leading-5 text-[#8f7566]">请根据真实现场情况录入第一份日报，不会生成演示数据。</p></CardContent></Card> : null}
            {reports.data?.map(report => { const status = getStatusMeta(report.status); return <Card key={report.id} className="border-[#ead9c8] bg-white"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{getBusinessDateText(report.reportDate)} · {report.workArea}</p><span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#9b8170]">天气：{getWeatherLabel(report.weather)} · 累计完成 {Number(report.progressPercent ?? 0).toFixed(2)}%</p></div>{isSuperAdmin && (report.status === "draft" || report.status === "rejected") ? <Button variant="outline" size="sm" className="border-[#dfc4a9] bg-white print:hidden" onClick={() => openEdit(report)}><Pencil className="mr-1 h-3.5 w-3.5" />修改</Button> : null}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#5b3b2e]">{report.workContent}</p>{report.safetyNotes ? <p className="mt-2 rounded-xl bg-[#fff3df] p-2 text-xs leading-5 text-[#7a4d25]">安全：{report.safetyNotes}</p> : null}{report.issueNotes ? <p className="mt-2 rounded-xl bg-[#f9e9e4] p-2 text-xs leading-5 text-[#934936]">问题：{report.issueNotes}</p> : null}{isSuperAdmin ? <div className="mt-3 flex flex-wrap gap-2 print:hidden">{report.status === "draft" ? <Button size="sm" variant="outline" onClick={() => transitionReport.mutate({ id: report.id, projectId: selectedProjectId, nextStatus: "submitted" })}>提交审核</Button> : null}{report.status === "submitted" ? <><Button size="sm" className="bg-[#47744d] text-white hover:bg-[#3a603f]" onClick={() => transitionReport.mutate({ id: report.id, projectId: selectedProjectId, nextStatus: "approved" })}>审核通过</Button><Button size="sm" variant="outline" onClick={() => transitionReport.mutate({ id: report.id, projectId: selectedProjectId, nextStatus: "rejected" })}>退回修改</Button></> : null}{report.status === "approved" ? <Button size="sm" variant="outline" onClick={() => transitionReport.mutate({ id: report.id, projectId: selectedProjectId, nextStatus: "locked" })}>归档锁定</Button> : null}</div> : null}</CardContent></Card>; })}
          </section>
        </main>

        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><HardHat className="h-5 w-5" /><span className="text-[10px] font-medium">施工</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "修改施工日报" : "新建施工日报"}</DialogTitle>
            <DialogDescription>项目范围和日报状态由服务端校验；保存后可连续添加多张现场照片，每张都会固化管理员、项目、定位、日期、时间和天气水印。</DialogDescription>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button disabled={saveReport.isPending} variant="outline" onClick={() => submitDraft(true)}><Camera className="mr-1.5 h-4 w-4" />保存并添加照片</Button>
            <Button disabled={saveReport.isPending} className="bg-[#9f582b] text-white hover:bg-[#85451f]" onClick={() => submitDraft(false)}><FileText className="mr-1.5 h-4 w-4" />{editingId ? "保存修改" : "保存草稿"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
