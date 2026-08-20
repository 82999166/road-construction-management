import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { trpc } from "@/lib/trpc";
import {
  Bell,
  Camera,
  ClipboardCheck,
  Clock3,
  CloudOff,
  ContactRound,
  HardHat,
  LayoutDashboard,
  MapPin,
  PackageSearch,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Tractor,
  Truck,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * 业务菜单图标仅由前端视觉层维护，菜单本身及其岗位可见性始终以服务端 workbench 接口为准。
 * 这样既避免前端硬编码岗位权限，也便于后台变更授权后立即生效。
 */
const MENU_ICONS: Record<string, LucideIcon> = {
  WORKBENCH: LayoutDashboard,
  CONSTRUCTION: HardHat,
  LABOR: ContactRound,
  MACHINERY: Tractor,
  TRANSPORT: Truck,
  PURCHASING: PackageSearch,
  MEASUREMENT: Ruler,
  FINANCE: WalletCards,
  EVIDENCE: Camera,
  MESSAGES: Bell,
};

type WorkbenchSnapshot = {
  userName: string | null;
  menus: Array<{ code: string; title: string }>;
  departmentNames: string[];
  departmentModules: string[];
  statistics: { pendingApprovals: number; unreadMessages: number; todayTrips: number; pendingPayroll: number };
  savedAt: number;
};

const WORKBENCH_SNAPSHOT_KEY = "road-construction-workbench-snapshot";

async function getAttendanceDeviceFingerprint() {
  const storageKey = "road-construction-attendance-device-key";
  let localKey = window.localStorage.getItem(storageKey);
  if (!localKey) { localKey = crypto.randomUUID(); window.localStorage.setItem(storageKey, localKey); }
  const source = `${localKey}|${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}

function getAttendanceDeviceLabel() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "移动设备";
  const browser = /MicroMessenger/i.test(navigator.userAgent) ? "微信内置浏览器" : /Chrome/i.test(navigator.userAgent) ? "Chrome" : /Safari/i.test(navigator.userAgent) ? "Safari" : "浏览器";
  return `${String(platform).slice(0, 80)} · ${browser}`;
}

function displayAttendanceTime(value: Date | string | null | undefined) {
  if (!value) return "未完成";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未完成" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * 预览代理、移动 WebView 或网络从离线恢复时，浏览器可能在请求尚未抵达服务端前抛出 Failed to fetch。
 * 仅对此类传输层错误作有限重试；权限、输入校验和业务错误必须立即交由服务端返回，不能被客户端重试掩盖。
 */
export function shouldRetryMobileWorkbenchRequest(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}

/** 仅缓存已脱敏的工作台摘要；项目明细和业务数据仍需联网后由服务端重新鉴权。 */
function readWorkbenchSnapshot(): WorkbenchSnapshot | null {
  try {
    const rawValue = window.localStorage.getItem(WORKBENCH_SNAPSHOT_KEY);
    if (!rawValue) return null;
    const snapshot = JSON.parse(rawValue) as WorkbenchSnapshot;
    if (!Array.isArray(snapshot.menus) || !snapshot.statistics || !Number.isFinite(snapshot.savedAt)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

/** 移动端工作台只处理业务入口，不复用 PC 后台的侧栏布局。 */
export default function MobileWorkbench() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(() => readWorkbenchSnapshot());
  const [attendanceProjectId, setAttendanceProjectId] = useState<number | undefined>();
  const workbench = trpc.mobile.workbench.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: shouldRetryMobileWorkbenchRequest,
    retryDelay: attemptIndex => Math.min(500 * 2 ** attemptIndex, 2_000),
    refetchOnReconnect: true,
  });
  const attendanceProjects = trpc.mobile.attendanceProjects.useQuery(undefined, { enabled: isAuthenticated && isOnline, retry: false });
  const authorizedAttendanceProjects = attendanceProjects.data?.projects ?? [];
  const selectedAttendanceProjectId = attendanceProjectId ?? authorizedAttendanceProjects[0]?.id ?? 0;
  const attendanceStatus = trpc.labor.attendance.myCheckInStatus.useQuery({ projectId: selectedAttendanceProjectId }, { enabled: isAuthenticated && isOnline && Boolean(selectedAttendanceProjectId), retry: false });
  const attendancePunch = trpc.labor.attendance.checkIn.useMutation({ onSuccess: async result => { toast.success(result.duplicate ? `今日${result.punchType === "out" ? "下班" : "上班"}打卡已完成` : `${result.punchType === "out" ? "下班" : "上班"}打卡成功，定位已上传`); await attendanceStatus.refetch(); }, onError: error => toast.error(error.message) });

  /** 离线缓存仅可阅读，不允许通过重试按钮主动发起业务接口调用。 */
  const retryWorkbench = () => {
    if (isOnline) void workbench.refetch();
  };

  useEffect(() => {
    const markOnline = () => {
      setIsOnline(true);
      void workbench.refetch();
    };
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [workbench.refetch]);

  useEffect(() => {
    if (!workbench.data) return;
    const nextSnapshot: WorkbenchSnapshot = {
      userName: workbench.data.user.name ?? null,
      menus: workbench.data.menus.map(menu => ({ code: menu.code, title: menu.title })),
      departmentNames: workbench.data.user.departments.map(department => department.name),
      departmentModules: workbench.data.user.departmentModules,
      statistics: workbench.data.statistics,
      savedAt: Date.now(),
    };
    setSnapshot(nextSnapshot);
    try {
      window.localStorage.setItem(WORKBENCH_SNAPSHOT_KEY, JSON.stringify(nextSnapshot));
    } catch {
      // 本地存储被浏览器禁用时不影响在线工作台读取。
    }
  }, [workbench.data]);

  useEffect(() => {
    if (!attendanceProjectId && authorizedAttendanceProjects.length) setAttendanceProjectId(authorizedAttendanceProjects[0].id);
  }, [attendanceProjectId, authorizedAttendanceProjects]);

  async function submitAttendancePunch(punchType: "in" | "out") {
    if (!selectedAttendanceProjectId) return toast.error("请先选择已授权项目后打卡");
    if (!navigator.geolocation) return toast.error("当前浏览器不支持定位，无法完成考勤打卡");
    try {
      const deviceFingerprintHash = await getAttendanceDeviceFingerprint();
      const deviceLabel = getAttendanceDeviceLabel();
      navigator.geolocation.getCurrentPosition(position => attendancePunch.mutate({ projectId: selectedAttendanceProjectId, punchType, deviceFingerprintHash, deviceLabel, longitude: position.coords.longitude, latitude: position.coords.latitude, locationAccuracyMeters: position.coords.accuracy }), () => toast.error("未取得实时定位，无法完成考勤打卡。请允许定位权限后重试"), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
    } catch { toast.error("无法生成设备匿名指纹，请检查浏览器隐私设置后重试"); }
  }

  // 离线且没有可安全阅读的本地摘要时，不主动发起业务请求。
  if (!isOnline && isAuthenticated && !snapshot) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-[#fff8ed]"><div className="max-w-xs"><div className="mx-auto grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><CloudOff className="h-8 w-8" /></div><h1 className="mt-6 text-2xl font-semibold">当前处于离线状态</h1><p className="mt-3 text-sm leading-6 text-[#e6cdb0]">尚未找到本机已同步的工作台摘要。请恢复网络后重新登录或加载岗位数据。</p><Button disabled className="mt-6 bg-[#f4dfc3] text-[#3b2118] hover:bg-white disabled:opacity-60" onClick={retryWorkbench}><RefreshCw className="mr-1.5 h-4 w-4" />恢复网络后重试</Button></div></div>;
  }

  // 登录态、企业身份核验或在线岗位摘要未完成时统一提供重试和登录出口。
  const isOnlineWorkbenchLoading = isAuthenticated && workbench.isLoading && (isOnline || !snapshot);
  if (loading || !isAuthenticated || authLoadingTimedOut || isOnlineWorkbenchLoading) {
    return <MobileAccessGate
      isAuthenticated={isAuthenticated}
      isLoading={loading || isOnlineWorkbenchLoading}
      authLoadingTimedOut={authLoadingTimedOut}
      loadingText="正在同步您的岗位工作台…"
      title="工程云管移动工作台"
      description="请先通过企业统一身份登录，系统将按您的岗位展示可办理业务。"
      Icon={HardHat}
      onRetry={() => {
        if (!isOnline) return;
        void refresh();
        void workbench.refetch();
      }}
    />;
  }

  if (workbench.error && isOnline && !snapshot) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-[#f8ead7]"><div className="max-w-xs"><div className="mx-auto grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><CloudOff className="h-8 w-8" /></div><h1 className="mt-6 text-2xl font-semibold">工作台暂时无法连接</h1><p className="mt-3 text-sm leading-6 text-[#e6cdb0]">网络正在恢复或服务正在重新连接。系统已自动重试；您也可以稍后手动同步。</p><Button variant="outline" className="mt-6 border-[#c9854a] text-[#fff8ed]" onClick={retryWorkbench}><RefreshCw className="mr-1.5 h-4 w-4" />重新同步</Button></div></div>;
  }

  const activeWorkbench = isOnline ? workbench.data : undefined;
  const isUsingSnapshot = !activeWorkbench && Boolean(snapshot);
  const menus = (activeWorkbench?.menus ?? snapshot?.menus ?? []).filter(menu => menu.code !== "WORKBENCH");
  // 消息中心属于所有已登录人员的通用入口，已由顶部和底部导航提供；“我的业务”只展示部门可办理模块。
  const businessMenus = menus.filter(menu => menu.code !== "MESSAGES");
  const statistics = activeWorkbench?.statistics ?? snapshot?.statistics;
  const greetingName = activeWorkbench?.user.name ?? snapshot?.userName ?? user?.name ?? "同事";
  const departmentNames = activeWorkbench?.user.departments.map(department => department.name) ?? snapshot?.departmentNames ?? [];
  const departmentModules = activeWorkbench?.user.departmentModules ?? snapshot?.departmentModules ?? [];
  const userSpecificModules = activeWorkbench?.user.userSpecificModules ?? [];
  // 超级管理员的角色由服务端下发，界面仅作来源说明，不能据此绕过任何接口鉴权。
  const hasGlobalBusinessAccess = activeWorkbench?.user.roleCodes.includes("SUPER_ADMIN") ?? false;

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl overflow-hidden bg-[#fdf7ee] shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-9 pt-6 text-[#fff7ea]">
          <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#c9854a] shadow-[0_8px_18px_rgba(0,0,0,.24)]"><HardHat className="h-5 w-5" /></div><div><p className="text-sm font-semibold">工程云管</p><p className="mt-0.5 text-xs text-[#e8cfb2]">施工承包移动工作台</p></div></div>
            <div className="flex items-center gap-2">
              {hasGlobalBusinessAccess ? <button aria-label="返回统一管理后台" title="返回统一管理后台" disabled={!isOnline} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => navigate("/admin")}><ShieldCheck className="h-5 w-5" /></button> : null}
              <button aria-label="进入消息中心" disabled={!isOnline} className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" />{(statistics?.unreadMessages ?? 0) > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#f3bf6b]" /> : null}</button>
            </div>
          </div>
          <div className="relative mt-8"><p className="text-sm text-[#e8cfb2]">您好，{greetingName}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">今天先完成最重要的事</h1><p className="mt-2 flex items-center gap-1 text-xs text-[#e8cfb2]"><MapPin className="h-3.5 w-3.5" />{hasGlobalBusinessAccess ? "当前权限：超级管理员（全局业务授权）" : departmentNames.length ? `当前部门：${departmentNames.join("、")}` : "当前账号尚未配置业务部门"}</p>{userSpecificModules.length ? <p className="mt-2 text-xs leading-5 text-[#f4d7b6]">已按专属权限开放：{userSpecificModules.map(module => ({ CONSTRUCTION: "施工", LABOR: "劳务", MACHINERY: "机械", TRANSPORT: "运输", PURCHASING: "采购", MEASUREMENT: "计量", CONTRACT: "合同", FINANCE: "财务", EVIDENCE: "影像" })[module]).filter(Boolean).join("、")}</p> : null}</div>
        </header>

        <main className="space-y-6 px-5 pb-24 pt-5">
          {isUsingSnapshot ? <section role="status" className="flex items-start gap-3 rounded-2xl border border-[#dfb78a] bg-[#fff0db] p-3 text-[#6d3d20]"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0"><p className="text-xs font-semibold">{isOnline ? "网络连接暂时不稳定" : "离线查看模式"}</p><p className="mt-1 text-xs leading-5">正在显示本机上次同步的岗位菜单和摘要（{new Date(snapshot?.savedAt ?? Date.now()).toLocaleString()}）。{isOnline ? "网络恢复后会自动同步，您也可以立即重新同步。" : "离线期间不可提交业务操作。"}</p></div><button aria-label="恢复网络后重新尝试同步" disabled={!isOnline} className="ml-auto rounded-lg p-1.5 transition-colors hover:bg-[#f5dfc4] disabled:cursor-not-allowed disabled:opacity-50" onClick={retryWorkbench}><RefreshCw className="h-4 w-4" /></button></section> : null}
          <section className="grid grid-cols-3 gap-2">
            {[{ label: "待办理审批", value: statistics?.pendingApprovals ?? 0, icon: ClipboardCheck, tone: "bg-[#eef3e8] text-[#567243]" }, { label: "待确认工资", value: statistics?.pendingPayroll ?? 0, icon: WalletCards, tone: "bg-[#f7e9de] text-[#8a3e27]" }, { label: "今日运输趟次", value: statistics?.todayTrips ?? 0, icon: Truck, tone: "bg-[#f2eee8] text-[#72503c]" }].map(item => {
              // 将图标提升为大写组件变量，符合 JSX 动态组件的语法约束。
              const StatisticIcon = item.icon;
              const cardBody = <><div className={`grid h-9 w-9 place-items-center rounded-xl ${item.tone}`}><StatisticIcon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-base font-semibold leading-none">{item.value}</p><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#8f7566]">{item.label}</p></div></>;
              return <Card key={item.label} className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="flex items-start gap-2 p-3">{cardBody}</CardContent></Card>;
            })}
          </section>

          <section className="rounded-2xl border border-[#e7c79f] bg-[#fff4e5] p-4 shadow-[0_6px_18px_rgba(71,42,30,.05)]"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d99855] text-white"><Clock3 className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-[#683a24]">每日上下班考勤</p><p className="mt-1 text-xs text-[#8f7566]">打卡时必须上传实时定位</p></div></div><MapPin className="mt-1 h-5 w-5 text-[#b46836]" /></div>{authorizedAttendanceProjects.length ? <><div className="mt-3 rounded-xl border border-[#ead4b4] bg-white px-3 py-2"><select aria-label="选择考勤项目" className="w-full bg-transparent text-sm text-[#623d2d] outline-none" value={selectedAttendanceProjectId ? String(selectedAttendanceProjectId) : ""} onChange={event => setAttendanceProjectId(Number(event.target.value))}>{authorizedAttendanceProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/80 p-3"><p className="text-xs text-[#8f7566]">上班打卡</p><p className="mt-1 text-sm font-semibold text-[#613a28]">{attendanceStatus.data?.checkedIn ? displayAttendanceTime(attendanceStatus.data.checkIn?.checkedInAt) : "未完成"}</p><Button className="mt-3 w-full bg-[#b96932] text-white hover:bg-[#995022]" size="sm" disabled={!isOnline || attendancePunch.isPending || attendanceStatus.data?.checkedIn} onClick={() => void submitAttendancePunch("in")}>{attendanceStatus.data?.checkedIn ? "已上班" : attendancePunch.isPending ? "定位打卡中…" : "上班打卡"}</Button></div><div className="rounded-xl bg-white/80 p-3"><p className="text-xs text-[#8f7566]">下班打卡</p><p className="mt-1 text-sm font-semibold text-[#613a28]">{attendanceStatus.data?.checkedOut ? displayAttendanceTime(attendanceStatus.data.checkOut?.checkedOutAt) : "未完成"}</p><Button className="mt-3 w-full border-[#b96932] text-[#995022] hover:bg-[#f8e3c8]" variant="outline" size="sm" disabled={!isOnline || attendancePunch.isPending || !attendanceStatus.data?.checkedIn || attendanceStatus.data?.checkedOut} onClick={() => void submitAttendancePunch("out")}>{attendanceStatus.data?.checkedOut ? "已下班" : attendancePunch.isPending ? "定位打卡中…" : "下班打卡"}</Button></div></div></> : <p className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-5 text-[#8f7566]">当前账号尚未配置项目范围，无法完成项目考勤。请联系主管分配项目范围。</p>}</section>

          <section>
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold">我的业务</h2><p className="mt-0.5 text-xs text-[#9b8170]">{hasGlobalBusinessAccess ? "已启用超级管理员全局业务授权，接口仍执行服务端校验" : `菜单随部门、岗位、项目范围与授权有效期动态更新${departmentModules.length ? ` · 已开通 ${departmentModules.length} 项部门业务` : ""}${userSpecificModules.length ? ` · 其中 ${userSpecificModules.length} 项来自专属权限` : ""}`}</p></div><ShieldCheck className="h-5 w-5 text-[#b87333]" /></div>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {businessMenus.map(menu => {
                const Icon = MENU_ICONS[menu.code] ?? LayoutDashboard;
                return <button key={menu.code} disabled={!isOnline} className="group flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-white px-2 py-3 text-center shadow-[0_6px_18px_rgba(71,42,30,.06)] transition-transform enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => navigate(`/mobile/${menu.code.toLowerCase()}`)}><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fbefe0] text-[#9f582b] transition-colors group-hover:bg-[#f4dfc3]"><Icon className="h-5 w-5" /></span><span className="line-clamp-2 text-xs font-medium leading-4 text-[#5b3b2e]">{menu.title}</span></button>;
              })}
              {!businessMenus.length ? <p className="col-span-4 rounded-xl bg-white p-4 text-center text-xs text-[#8f7566]">当前账号尚未获分配业务岗位，请联系超级管理员授权。</p> : null}
            </div>
          </section>
        </main>

        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><LayoutDashboard className="h-5 w-5" /><span className="text-[10px] font-medium">工作台</span></button><button disabled={!isOnline} className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566] disabled:opacity-50" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>
    </div>
  );
}
