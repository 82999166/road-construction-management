import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatChinaTime } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { ArrowLeft, Clock3, MapPin, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type AttendanceStatusOverride = {
  projectId: number;
  checkedIn: boolean;
  checkedOut: boolean;
  checkedInAt: Date | string | null;
  checkedOutAt: Date | string | null;
};

async function getDeviceFingerprint() {
  const storageKey = "road-construction-attendance-device-key";
  let localKey = window.localStorage.getItem(storageKey);
  if (!localKey) {
    localKey = crypto.randomUUID();
    window.localStorage.setItem(storageKey, localKey);
  }
  const source = `${localKey}|${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}

function getDeviceLabel() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "移动设备";
  const browser = /MicroMessenger/i.test(navigator.userAgent) ? "微信内置浏览器" : /Chrome/i.test(navigator.userAgent) ? "Chrome" : /Safari/i.test(navigator.userAgent) ? "Safari" : "浏览器";
  return `${String(platform).slice(0, 80)} · ${browser}`;
}

function displayTime(value: Date | string | null | undefined) {
  return formatChinaTime(value);
}

/** 保留独立地址供旧链接访问；主入口固定在移动首页，任何打卡都必须上传实时定位。 */
export default function MobileAttendancePage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [attendanceStatusOverride, setAttendanceStatusOverride] = useState<AttendanceStatusOverride | null>(null);
  const projectOptions = trpc.mobile.attendanceProjects.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const selectedProjectId = projectId ?? projectOptions.data?.projects[0]?.id ?? 0;
  const statusInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const attendanceStatus = trpc.labor.attendance.myCheckInStatus.useQuery(statusInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const currentAttendanceOverride = attendanceStatusOverride?.projectId === selectedProjectId ? attendanceStatusOverride : null;
  const attendanceCheckedIn = Boolean(attendanceStatus.data?.checkedIn || currentAttendanceOverride?.checkedIn);
  const attendanceCheckedOut = Boolean(attendanceStatus.data?.checkedOut || currentAttendanceOverride?.checkedOut);
  const attendanceCheckInAt = attendanceStatus.data?.checkIn?.checkedInAt ?? currentAttendanceOverride?.checkedInAt ?? null;
  const attendanceCheckOutAt = attendanceStatus.data?.checkOut?.checkedOutAt ?? currentAttendanceOverride?.checkedOutAt ?? null;
  const punch = trpc.labor.attendance.checkIn.useMutation({
    onSuccess: async (result, variables) => {
      const refreshed = await attendanceStatus.refetch();
      const serverStatus = refreshed.data;
      if (result.punchType === "out" && serverStatus && !serverStatus.checkedOut) {
        setAttendanceStatusOverride(null);
        toast.error("下班打卡尚未被服务器确认，请刷新状态后重试");
        return;
      }
      setAttendanceStatusOverride({ projectId: variables.projectId, checkedIn: true, checkedOut: result.punchType === "out", checkedInAt: result.punchType === "in" ? result.checkedInAt : attendanceStatus.data?.checkIn?.checkedInAt ?? null, checkedOutAt: result.punchType === "out" ? result.checkedOutAt : null });
      const label = result.punchType === "out" ? "下班" : "上班";
      toast.success(result.duplicate ? `今日${label}打卡已完成` : `${label}打卡成功，定位已上传`);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "考勤提交未完成，请稍后重试")),
  });

  useEffect(() => {
    if (!projectId && projectOptions.data?.projects.length) setProjectId(projectOptions.data.projects[0].id);
  }, [projectId, projectOptions.data]);

  useEffect(() => {
    if (!currentAttendanceOverride) return;
    if (attendanceStatus.data?.checkedIn && (currentAttendanceOverride.checkedOut ? attendanceStatus.data.checkedOut : true)) setAttendanceStatusOverride(null);
  }, [attendanceStatus.data?.checkedIn, attendanceStatus.data?.checkedOut, currentAttendanceOverride]);

  async function submitPunch(punchType: "in" | "out") {
    if (!selectedProjectId) return toast.error("请先选择已授权项目");
    if (!navigator.geolocation) return toast.error("当前浏览器不支持定位，无法完成考勤打卡");
    try {
      const deviceFingerprintHash = await getDeviceFingerprint();
      const deviceLabel = getDeviceLabel();
      navigator.geolocation.getCurrentPosition(position => punch.mutate({ projectId: selectedProjectId, punchType, deviceFingerprintHash, deviceLabel, longitude: position.coords.longitude, latitude: position.coords.latitude, locationAccuracyMeters: position.coords.accuracy }), () => toast.error("未取得实时定位，无法完成考勤打卡。请允许定位权限后重试"), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
    } catch {
      toast.error("无法生成设备匿名指纹，请检查浏览器隐私设置后重试");
    }
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载今日考勤…" title="上下班考勤" description="请使用企业统一身份进入已授权项目完成每日打卡。" Icon={Clock3} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]"><header className="bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea]"><div className="flex items-center justify-between"><button aria-label="返回移动工作台" onClick={() => navigate("/mobile")} className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="font-semibold">上下班考勤</p><p className="mt-0.5 text-xs text-[#e8cfb2]">每日上班、下班均须上传实时定位</p></div><span className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><Clock3 className="h-5 w-5" /></span></div></header><main className="space-y-5 px-5 pt-5"><Select value={selectedProjectId ? String(selectedProjectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data?.projects.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select>{!projectOptions.data?.projects.length ? <Card><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前账号尚未配置项目范围，无法完成项目考勤。请联系主管分配项目范围。</CardContent></Card> : <Card className="border-0 bg-gradient-to-br from-[#6d3421] to-[#3a2117] text-[#fff7ea] shadow-[0_10px_24px_rgba(75,39,24,.18)]"><CardContent className="p-5"><div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-[#f0bd7d]" /><p className="font-semibold">今日考勤状态</p></div><p className="mt-2 text-xs leading-5 text-[#e8cfb2]">设备匿名指纹、服务端时间与实时定位会分别记录。未完成下班打卡的考勤将显示在管理后台统一台账。</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-[#e8cfb2]">上班打卡</p><p className="mt-1 font-semibold">{attendanceCheckedIn ? displayTime(attendanceCheckInAt) : "未完成"}</p><Button className={`mt-3 w-full ${attendanceCheckedIn ? "bg-slate-200 text-slate-500 hover:bg-slate-200" : "bg-[#f2bb79] text-[#4b2517] hover:bg-[#f6cb93]"}`} size="sm" disabled={punch.isPending || attendanceCheckedIn} onClick={() => void submitPunch("in")}>{attendanceCheckedIn ? "已上班" : punch.isPending ? "定位打卡中…" : "上班打卡"}</Button></div><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-[#e8cfb2]">下班打卡</p><p className="mt-1 font-semibold">{attendanceCheckedOut ? displayTime(attendanceCheckOutAt) : "未完成"}</p><Button className={`mt-3 w-full border-[#f2bb79] ${attendanceCheckedOut ? "bg-slate-200 text-slate-500 hover:bg-slate-200" : "bg-transparent text-[#fff7ea] hover:bg-white/10 hover:text-white"}`} variant="outline" size="sm" disabled={punch.isPending || !attendanceCheckedIn || attendanceCheckedOut} onClick={() => void submitPunch("out")}>{attendanceCheckedOut ? "已下班" : punch.isPending ? "定位打卡中…" : "下班打卡"}</Button></div></div><p className="mt-4 flex items-center gap-1 text-xs text-[#e8cfb2]"><MapPin className="h-3.5 w-3.5" />{attendanceCheckedIn ? "上班定位：已上传" : "打卡时必须上传现场定位"}</p></CardContent></Card>}</main></div></div>;
}
