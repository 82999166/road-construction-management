import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { useMobileFormProtection, useMobileSafeNavigate } from "@/contexts/MobileFormProtectionContext";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { clearMobileDraft, hasMobileDraftContent, readMobileDraft, saveMobileDraft } from "@/lib/mobileDraftStorage";
import { formatChinaDate, formatChinaDateTime, formatChinaTime, toDeviceDateInput } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import {
  ArrowLeft,
  Ban,
  BadgeCheck,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  ContactRound,
  FileText,
  HardHat,
  Landmark,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/** 将本地日期统一格式化为 YYYY-MM-DD，供移动端日期控件与接口稳定交互。 */
function getTodayText() {
  return toDeviceDateInput();
}

/** 获取当前月份，工资结算和统计始终以自然月为单位。 */
function getCurrentPeriod() {
  return getTodayText().slice(0, 7);
}

/** 仅当相对打开时的初始值有变化时才视为未提交，避免默认日期、工时等误触离开提醒。 */
function hasDraftChange(current: object, initial: object) {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
function hasMeaningfulDraftChange(current: object, initial: object) {
  return hasDraftChange(current, initial) && hasMobileDraftContent(current as Record<string, unknown>);
}

/** 根据 YYYY-MM 计算当月最后一天，防止二月及小月的考勤筛选误跨入下月。 */
function getPeriodEndDate(period: string) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, "0")}`;
}

/** 将浏览器选取的证照文件转换为 base64 负载，由受权限保护的 tRPC 接口写入对象存储。 */
function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("证照文件读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 将数据库中的金额转为两位小数展示，兼容 decimal 字段的字符串返回值。 */
function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 将业务日期在移动端按中文本地习惯展示，不向用户暴露 UTC 存储细节。 */
function formatDate(value: Date | string | null | undefined) {
  return formatChinaDate(value);
}

/** 将日期型返回值稳定转换为业务自然键，避免普通管理人员误将已有考勤提交为更新。 */
function getBusinessDateText(value: Date | string | null | undefined) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 设备原始信息只在浏览器本地组合，提交前转换为不可逆 SHA-256 指纹。 */
async function getAttendanceDeviceFingerprint() {
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

function getAttendanceDeviceLabel() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "移动设备";
  const browser = /MicroMessenger/i.test(navigator.userAgent) ? "微信内置浏览器" : /Chrome/i.test(navigator.userAgent) ? "Chrome" : /Safari/i.test(navigator.userAgent) ? "Safari" : "浏览器";
  return `${String(platform).slice(0, 80)} · ${browser}`;
}

/** 根据工资单状态生成简洁、可读的巧克力主题状态样式。 */
function getPayrollStatus(status: "draft" | "reviewing" | "approved" | "partial" | "paid" | "void") {
  const dictionary = {
    draft: { label: "草稿", className: "bg-[#f7ead8] text-[#8a542e]" },
    reviewing: { label: "待会计审核", className: "bg-[#f9e6bd] text-[#9c6425]" },
    approved: { label: "已审核", className: "bg-[#e5f1e3] text-[#47744d]" },
    partial: { label: "部分发放", className: "bg-[#fff0cf] text-[#95621f]" },
    paid: { label: "已发放", className: "bg-[#e2f0ed] text-[#3e746a]" },
    void: { label: "已作废", className: "bg-[#eee8e2] text-[#857365]" },
  } as const;
  return dictionary[status];
}

/** 将实名审核状态映射为简洁且区分明确的移动端徽章。 */
function getIdentityVerificationStatus(status: "pending" | "verified" | "rejected") {
  const dictionary = {
    pending: { label: "待核验", className: "bg-[#f8ead8] text-[#94603a]" },
    verified: { label: "已实名", className: "bg-[#e6f1e4] text-[#47754d]" },
    rejected: { label: "核验退回", className: "bg-[#f7e5e1] text-[#a34b3a]" },
  } as const;
  return dictionary[status];
}

/** 劳务页底部导航限定在移动端路由域，避免业务人员跳转至通用根路由。 */
export const MOBILE_LABOR_BOTTOM_NAVIGATION = {
  workbench: "/mobile",
  messages: "/mobile/messages",
  profile: "/mobile/profile",
} as const;

/** 实际资金发放必须由PC财务台账上传每笔凭证；移动端只展示受控状态。 */
export function canPayPayrollFromMobile(roleCodes: readonly string[]) {
  void roleCodes;
  return false;
}

/** 工资草稿只允许劳资负责人或系统级应急角色提交至会计审核。 */
export function canSubmitPayrollFromMobile(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("LABOR_MANAGER");
}

/** 审核中的工资条仅向会计或系统级应急角色显示审核操作。 */
export function canApprovePayrollFromMobile(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT");
}

/** 未确认发放的工资条仅向会计、财务负责人或系统级应急角色显示作废入口。 */
export function canVoidPayrollFromMobile(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT") || roleCodes.includes("FINANCE_MANAGER");
}

/** 将工资状态和服务端投影的岗位代码收敛为页面可见操作，避免 UI 与接口权限规则漂移。 */
export function getMobilePayrollActions(status: "draft" | "reviewing" | "approved" | "partial" | "paid" | "void", roleCodes: readonly string[]) {
  return {
    submit: status === "draft" && canSubmitPayrollFromMobile(roleCodes),
    approve: status === "reviewing" && canApprovePayrollFromMobile(roleCodes),
    pay: false,
    void: ["draft", "reviewing", "approved"].includes(status) && canVoidPayrollFromMobile(roleCodes),
  };
}

/** 考勤人员的默认表单状态，集中维护可避免多处表单字段漂移。 */
const emptyWorkerDraft = {
  realName: "",
  teamName: "",
  workerCategory: "labor_team" as "company_admin" | "labor_team" | "temporary_daily",
  remarks: "",
  identityNo: "",
  phone: "",
  bankAccount: "",
  bankName: "",
  identityVerificationStatus: "pending" as "pending" | "verified" | "rejected",
  identityVerificationNote: "",
  attendanceStatus: "active" as "pending" | "active" | "left",
  entryDate: getTodayText(),
  exitDate: "",
};

/**
 * 劳务工资移动业务页。
 * 页面不存储或展示身份证、手机号、银行卡原文；敏感字段只在受控录入时提交服务端加密，回显均为掩码。
 */
export default function MobileLaborPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const navigate = useMobileSafeNavigate();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [activeTab, setActiveTab] = useState("workers");
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [attendanceDialogOpen, setAttendanceDialogOpen] = useState(false);
  const [payrollDialogOpen, setPayrollDialogOpen] = useState(false);
  const [payrollVoidDialogOpen, setPayrollVoidDialogOpen] = useState(false);
  const [dailyWageDialogOpen, setDailyWageDialogOpen] = useState(false);
  const [certificateDialogOpen, setCertificateDialogOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<number | null>(null);
  const [workerDraft, setWorkerDraft] = useState(emptyWorkerDraft);
  const [workerInitialDraft, setWorkerInitialDraft] = useState(emptyWorkerDraft);
  const [attendanceDraft, setAttendanceDraft] = useState({ workerId: "", attendanceDate: getTodayText(), workHours: "8", overtimeHours: "0", note: "" });
  const [attendanceInitialDraft, setAttendanceInitialDraft] = useState({ workerId: "", attendanceDate: getTodayText(), workHours: "8", overtimeHours: "0", note: "" });
  const [payrollDraft, setPayrollDraft] = useState({ workerId: "", payableAmount: "", deductionAmount: "0" });
  const [payrollInitialDraft, setPayrollInitialDraft] = useState({ workerId: "", payableAmount: "", deductionAmount: "0" });
  const [payrollVoidDraft, setPayrollVoidDraft] = useState({ id: 0, reason: "" });
  const [dailyWageDraft, setDailyWageDraft] = useState({ workerId: "", settlementDate: getTodayText(), payableAmount: "", deductionAmount: "0", remarks: "" });
  const [dailyWageInitialDraft, setDailyWageInitialDraft] = useState({ workerId: "", settlementDate: getTodayText(), payableAmount: "", deductionAmount: "0", remarks: "" });
  const [certificateWorker, setCertificateWorker] = useState<{ id: number; realName: string } | null>(null);
  const [certificateName, setCertificateName] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);

  const projectOptions = trpc.labor.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });

  /** 首次取得授权项目后自动选中第一个可访问项目；用户仍可手动切换项目。 */
  useEffect(() => {
    if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
  }, [projectId, projectOptions.data]);

  const selectedProjectId = projectId ?? projectOptions.data?.[0]?.id ?? 0;
  /** 每个项目及业务表单各自使用稳定草稿键；本机草稿不参与服务端业务草稿或审核状态。 */
  const getWorkerDraftKey = (workerId: number | null = editingWorkerId) => `labor-worker:${selectedProjectId || "pending"}:${workerId ?? "new"}`;
  const workerDraftKey = getWorkerDraftKey();
  const attendanceDraftKey = `labor-attendance:${selectedProjectId || "pending"}`;
  const payrollDraftKey = `labor-payroll:${selectedProjectId || "pending"}:${period}`;
  const dailyWageDraftKey = `labor-daily-wage:${selectedProjectId || "pending"}`;
  /** 人员本机草稿严格排除姓名、身份证、手机号、银行卡和开户行等个人/资金敏感信息。 */
  const workerLocalDraft = useMemo(() => ({
    teamName: workerDraft.teamName,
    workerCategory: workerDraft.workerCategory,
    remarks: workerDraft.remarks,
    attendanceStatus: workerDraft.attendanceStatus,
    entryDate: workerDraft.entryDate,
    exitDate: workerDraft.exitDate,
  }), [workerDraft]);
  const workerInitialLocalDraft = useMemo(() => ({
    teamName: workerInitialDraft.teamName,
    workerCategory: workerInitialDraft.workerCategory,
    remarks: workerInitialDraft.remarks,
    attendanceStatus: workerInitialDraft.attendanceStatus,
    entryDate: workerInitialDraft.entryDate,
    exitDate: workerInitialDraft.exitDate,
  }), [workerInitialDraft]);
  const attendanceLocalDraft = useMemo(() => ({ ...attendanceDraft }), [attendanceDraft]);
  const payrollLocalDraft = useMemo(() => ({ ...payrollDraft }), [payrollDraft]);
  const dailyWageLocalDraft = useMemo(() => ({ ...dailyWageDraft }), [dailyWageDraft]);
  const workerDraftDirty = workerDialogOpen && hasDraftChange(workerDraft, workerInitialDraft);
  const attendanceDraftDirty = attendanceDialogOpen && hasDraftChange(attendanceDraft, attendanceInitialDraft);
  const payrollDraftDirty = payrollDialogOpen && hasDraftChange(payrollDraft, payrollInitialDraft);
  const dailyWageDraftDirty = dailyWageDialogOpen && hasDraftChange(dailyWageDraft, dailyWageInitialDraft);
  function resetWorkerForm() {
    const initial = { ...emptyWorkerDraft, entryDate: getTodayText() };
    setWorkerDialogOpen(false);
    setEditingWorkerId(null);
    setWorkerDraft(initial);
    setWorkerInitialDraft(initial);
  }
  function resetAttendanceForm() {
    const initial = { workerId: "", attendanceDate: getTodayText(), workHours: "8", overtimeHours: "0", note: "" };
    setAttendanceDialogOpen(false);
    setAttendanceDraft(initial);
    setAttendanceInitialDraft(initial);
  }
  function resetPayrollForm() {
    const initial = { workerId: "", payableAmount: "", deductionAmount: "0" };
    setPayrollDialogOpen(false);
    setPayrollDraft(initial);
    setPayrollInitialDraft(initial);
  }
  function resetDailyWageForm() {
    const initial = { workerId: "", settlementDate: getTodayText(), payableAmount: "", deductionAmount: "0", remarks: "" };
    setDailyWageDialogOpen(false);
    setDailyWageDraft(initial);
    setDailyWageInitialDraft(initial);
  }
  function saveWorkerLocalDraft() {
    if (!hasMeaningfulDraftChange(workerLocalDraft, workerInitialLocalDraft)) {
      toast.info("暂无可保存的非敏感人员信息；身份证、手机号、银行卡和开户行不会保存到本机");
      return;
    }
    if (!saveMobileDraft(workerDraftKey, workerLocalDraft)) throw new Error("本机草稿保存失败");
    toast.success("人员档案的非敏感业务字段已保存到本机草稿；身份证、手机号、银行卡和开户行需重新填写");
  }
  function saveAttendanceLocalDraft() {
    if (!hasMeaningfulDraftChange(attendanceLocalDraft, attendanceInitialDraft)) { toast.info("暂无需要保存的考勤修改"); return; }
    if (!saveMobileDraft(attendanceDraftKey, attendanceLocalDraft)) throw new Error("本机草稿保存失败");
    toast.success("考勤内容已保存到本机草稿，尚未提交");
  }
  function savePayrollLocalDraft() {
    if (!hasMeaningfulDraftChange(payrollLocalDraft, payrollInitialDraft)) { toast.info("暂无需要保存的工资核算修改"); return; }
    if (!saveMobileDraft(payrollDraftKey, payrollLocalDraft)) throw new Error("本机草稿保存失败");
    toast.success("工资核算内容已保存到本机草稿，尚未生成工资条");
  }
  function saveDailyWageLocalDraft() {
    if (!hasMeaningfulDraftChange(dailyWageLocalDraft, dailyWageInitialDraft)) { toast.info("暂无需要保存的临时日结修改"); return; }
    if (!saveMobileDraft(dailyWageDraftKey, dailyWageLocalDraft)) throw new Error("本机草稿保存失败");
    toast.success("临时日结内容已保存到本机草稿，尚未提交审核");
  }
  const { requestClose: requestWorkerClose } = useMobileFormProtection({
    id: "labor-worker-form",
    label: "劳务人员档案（敏感字段不保存）",
    isDirty: workerDraftDirty,
    saveDraft: () => {
      if (!hasMeaningfulDraftChange(workerLocalDraft, workerInitialLocalDraft) && workerDraftDirty) {
        throw new Error("当前仅填写了身份证、手机号、银行卡或开户行等敏感信息，不能保存到本机。请继续填写并安全提交，或选择放弃填写。");
      }
      saveWorkerLocalDraft();
    },
    discard: () => { clearMobileDraft(workerDraftKey); resetWorkerForm(); },
  });
  const { requestClose: requestAttendanceClose } = useMobileFormProtection({
    id: "labor-attendance-form",
    label: "考勤录入",
    isDirty: attendanceDraftDirty,
    saveDraft: saveAttendanceLocalDraft,
    discard: () => { clearMobileDraft(attendanceDraftKey); resetAttendanceForm(); },
  });
  const { requestClose: requestPayrollClose } = useMobileFormProtection({
    id: "labor-payroll-form",
    label: "工资核算",
    isDirty: payrollDraftDirty,
    saveDraft: savePayrollLocalDraft,
    discard: () => { clearMobileDraft(payrollDraftKey); resetPayrollForm(); },
  });
  const { requestClose: requestDailyWageClose } = useMobileFormProtection({
    id: "labor-daily-wage-form",
    label: "临时日结",
    isDirty: dailyWageDraftDirty,
    saveDraft: saveDailyWageLocalDraft,
    discard: () => { clearMobileDraft(dailyWageDraftKey); resetDailyWageForm(); },
  });
  // 所有 tRPC 输入均 memo 化，避免渲染时新建对象导致不必要的查询。
  const workersInput = useMemo(() => ({ projectId: selectedProjectId, includeLeft: true }), [selectedProjectId]);
  const attendanceInput = useMemo(() => ({ projectId: selectedProjectId, startDate: `${period}-01`, endDate: getPeriodEndDate(period) }), [period, selectedProjectId]);
  const payrollInput = useMemo(() => ({ projectId: selectedProjectId, period }), [period, selectedProjectId]);
  const dailyWageInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const summaryInput = useMemo(() => ({ projectId: selectedProjectId, period }), [period, selectedProjectId]);
  const checkInInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const certificateInput = useMemo(() => ({ projectId: selectedProjectId, workerId: certificateWorker?.id ?? 0 }), [certificateWorker?.id, selectedProjectId]);
  const workers = trpc.labor.listWorkers.useQuery(workersInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const attendance = trpc.labor.attendance.list.useQuery(attendanceInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const payroll = trpc.labor.payroll.list.useQuery(payrollInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const dailyWages = trpc.labor.dailyWage.list.useQuery(dailyWageInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.labor.summary.useQuery(summaryInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const certificates = trpc.labor.certificates.list.useQuery(certificateInput, { enabled: isAuthenticated && certificateDialogOpen && Boolean(selectedProjectId) && Boolean(certificateWorker?.id), retry: false });
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const checkInStatus = trpc.labor.attendance.myCheckInStatus.useQuery(checkInInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });

  /** 仅打印当前已授权项目、已选期间及服务端返回的工资条与汇总，不打印移动页面或重算业务金额。 */
  const printPayrollSummary = () => {
    if (!selectedProjectId || !summary.data) {
      toast.error("工资统计正在加载，请稍候重试");
      return;
    }
    const projectName = projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "当前项目";
    const statements = payroll.data ?? [];
    const rows = statements.map((statement, index) => {
      const status = getPayrollStatus(statement.status);
      return `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(statement.workerName)}</td><td>${escapePrintHtml(statement.teamName || "未分班组")}</td><td>${escapePrintHtml(statement.bankAccountMasked || "未录入")}</td><td class="right">${escapePrintHtml(formatMoney(statement.payableAmount))}</td><td class="right">${escapePrintHtml(formatMoney(statement.deductionAmount))}</td><td class="right">${escapePrintHtml(formatMoney(statement.actualAmount))}</td><td class="center">${escapePrintHtml(status.label)}</td><td>${escapePrintHtml(statement.paymentReference || "—")}</td></tr>`;
    }).join("");
    openA4LandscapePrintDocument({
      title: "劳务工资统计及明细表",
      bodyHtml: `<h1>劳务工资统计及明细表</h1><p class="sub">项目：${escapePrintHtml(projectName)}　|　期间：${escapePrintHtml(period)}　|　生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><p class="sub">数据范围：当前账号已授权项目与人员；金额以服务端工资条及统计汇总为准。</p><hr class="rule"><table><thead><tr><th style="width:5%">序号</th><th style="width:11%">人员</th><th style="width:12%">班组</th><th style="width:13%">银行卡号</th><th style="width:11%">应发</th><th style="width:11%">扣款</th><th style="width:11%">实发</th><th style="width:9%">状态</th><th style="width:17%">付款凭证</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="center">当前期间暂无工资条</td></tr>'}<tr class="summary"><td colspan="4">合计：工资条 ${statements.length} 份　|　在场人员 ${summary.data.activeWorkers} 人　|　考勤 ${summary.data.attendanceDays} 天</td><td class="right">${escapePrintHtml(formatMoney(summary.data.payableAmount))}</td><td class="right">${escapePrintHtml(formatMoney(summary.data.deductionAmount))}</td><td class="right">${escapePrintHtml(formatMoney(summary.data.actualAmount))}</td><td colspan="2">待审核：${summary.data.awaitingReviewCount} 份 / ${escapePrintHtml(formatMoney(summary.data.awaitingReviewAmount))}</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>`,
    });
  };

  /** 保存实名制档案后刷新相关台账和统计，避免本地手工拼接敏感字段缓存。 */
  const saveWorker = trpc.labor.saveWorker.useMutation({
    onSuccess: async () => {
      toast.success(editingWorkerId ? "人员档案已更新" : "实名制人员已录入");
      clearMobileDraft(workerDraftKey);
      resetWorkerForm();
      await Promise.all([utils.labor.listWorkers.invalidate(), utils.labor.summary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  /** 考勤幂等保存成功后刷新考勤和工资统计。 */
  const saveAttendance = trpc.labor.attendance.save.useMutation({
    onSuccess: async () => {
      toast.success("考勤已保存");
      clearMobileDraft(attendanceDraftKey);
      resetAttendanceForm();
      await Promise.all([utils.labor.attendance.list.invalidate(), utils.labor.summary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const mobileCheckIn = trpc.labor.attendance.checkIn.useMutation({
    onSuccess: async result => {
      toast.success(result.duplicate ? "今日已完成打卡，已返回服务端记录" : result.newlyBound ? "设备已绑定并完成打卡" : "打卡成功，已记录服务端时间与定位");
      await checkInStatus.refetch();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  /** 工资草稿由服务端计算实发金额，客户端只负责提交可审计的应发和扣款金额。 */
  const savePayroll = trpc.labor.payroll.save.useMutation({
    onSuccess: async data => {
      toast.success(`工资草稿已保存，实发 ${formatMoney(data.actualAmount)}`);
      clearMobileDraft(payrollDraftKey);
      resetPayrollForm();
      await Promise.all([utils.labor.payroll.list.invalidate(), utils.labor.summary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const submitPayroll = trpc.labor.payroll.submit.useMutation({
    onSuccess: async () => {
      toast.success("工资条已提交至会计审核");
      await Promise.all([utils.labor.payroll.list.invalidate(), utils.labor.summary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const approvePayroll = trpc.labor.payroll.approve.useMutation({
    onSuccess: async data => {
      toast.success(data.status === "approved" ? "工资条已审核通过" : "工资条已退回草稿");
      await Promise.all([utils.labor.payroll.list.invalidate(), utils.labor.summary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  /** 作废必须说明原因；页面只负责采集，服务端负责终态和权限拦截。 */
  const voidPayroll = trpc.labor.payroll.void.useMutation({
    onSuccess: async () => {
      toast.success("工资条已作废");
      setPayrollVoidDialogOpen(false);
      setPayrollVoidDraft({ id: 0, reason: "" });
      await Promise.all([utils.labor.payroll.list.invalidate(), utils.labor.summary.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const saveDailyWage = trpc.labor.dailyWage.save.useMutation({
    onSuccess: async () => {
      toast.success("临时日结草稿已保存");
      clearMobileDraft(dailyWageDraftKey);
      resetDailyWageForm();
      await utils.labor.dailyWage.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const submitDailyWage = trpc.labor.dailyWage.submit.useMutation({
    onSuccess: async () => {
      toast.success("临时日结已提交会计/财务审核");
      await utils.labor.dailyWage.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  const reviewDailyWage = trpc.labor.dailyWage.review.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "approved" ? "临时日结已审核通过，待登记实际付款" : "临时日结已退回草稿，可修改后重新提交");
      await utils.labor.dailyWage.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });
  /** 证照本体仅上传至对象存储，台账只保留受权限控制的元数据与安全访问地址。 */
  const uploadCertificate = trpc.labor.certificates.upload.useMutation({
    onSuccess: async () => {
      toast.success("证照已安全归档");
      setCertificateName("");
      setCertificateFile(null);
      await utils.labor.certificates.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "劳务工资操作未完成，请稍后重试")),
  });

  /** 会话未完成时工作台摘要可能尚无用户对象；门禁会在下方接管页面渲染。 */
  const activeRoleCodes = workbench.data?.user?.roleCodes ?? [];
  const canSubmitPayroll = canSubmitPayrollFromMobile(activeRoleCodes);
  const canApprovePayroll = canApprovePayrollFromMobile(activeRoleCodes);
  const canVoidPayroll = canVoidPayrollFromMobile(activeRoleCodes);
  const canManageDailyWage = activeRoleCodes.includes("ALL") || activeRoleCodes.includes("LABOR_MANAGER") || activeRoleCodes.includes("PROJECT_MANAGER");
  const canReviewDailyWage = activeRoleCodes.includes("ALL") || activeRoleCodes.includes("ACCOUNTANT") || activeRoleCodes.includes("FINANCE_MANAGER");
  const existingAttendanceForDraft = Boolean(attendance.data?.some(record => record.workerId === Number(attendanceDraft.workerId) && getBusinessDateText(record.attendanceDate) === attendanceDraft.attendanceDate));
  const existingPayrollForDraft = Boolean(payroll.data?.some(statement => statement.workerId === Number(payrollDraft.workerId) && statement.period === period));
  const isBusy = workers.isLoading || attendance.isLoading || payroll.isLoading || summary.isLoading;

  /** 新建或编辑时仅预填非敏感字段；敏感输入框留空即表示保留既有加密值。 */
  function openWorkerDialog(worker?: NonNullable<typeof workers.data>[number]) {
    const initial = worker
      ? {
          realName: worker.realName,
          teamName: worker.teamName ?? "",
          workerCategory: worker.workerCategory,
          remarks: worker.remarks ?? "",
          identityNo: "",
          phone: "",
          bankAccount: "",
          bankName: worker.bankName ?? "",
          identityVerificationStatus: worker.identityVerificationStatus,
          identityVerificationNote: worker.identityVerificationNote ?? "",
          attendanceStatus: worker.attendanceStatus,
          entryDate: worker.entryDate ? new Date(worker.entryDate).toISOString().slice(0, 10) : "",
          exitDate: worker.exitDate ? new Date(worker.exitDate).toISOString().slice(0, 10) : "",
        }
      : { ...emptyWorkerDraft, entryDate: getTodayText() };
    const saved = readMobileDraft<typeof workerLocalDraft>(getWorkerDraftKey(worker?.id ?? null));
    const restored = saved && hasMobileDraftContent(saved.value) ? { ...initial, ...saved.value } : initial;
    setEditingWorkerId(worker?.id ?? null);
    setWorkerInitialDraft(initial);
    setWorkerDraft(restored);
    setWorkerDialogOpen(true);
    if (saved && hasMobileDraftContent(saved.value)) toast.info("已恢复这台设备上未提交的人员档案非敏感字段；身份证、联系方式和银行卡需重新填写。");
  }
  function openAttendanceDialog() {
    const initial = { workerId: workers.data?.find(item => item.attendanceStatus === "active")?.id ? String(workers.data.find(item => item.attendanceStatus === "active")!.id) : "", attendanceDate: getTodayText(), workHours: "8", overtimeHours: "0", note: "" };
    const saved = readMobileDraft<typeof attendanceLocalDraft>(attendanceDraftKey);
    const restored = saved && hasMobileDraftContent(saved.value) ? { ...initial, ...saved.value } : initial;
    setAttendanceInitialDraft(initial);
    setAttendanceDraft(restored);
    setAttendanceDialogOpen(true);
    if (saved && hasMobileDraftContent(saved.value)) toast.info("已恢复这台设备上未提交的考勤草稿。");
  }
  function openPayrollDialog() {
    const initial = { workerId: workers.data?.find(item => item.attendanceStatus === "active")?.id ? String(workers.data.find(item => item.attendanceStatus === "active")!.id) : "", payableAmount: "", deductionAmount: "0" };
    const saved = readMobileDraft<typeof payrollLocalDraft>(payrollDraftKey);
    const restored = saved && hasMobileDraftContent(saved.value) ? { ...initial, ...saved.value } : initial;
    setPayrollInitialDraft(initial);
    setPayrollDraft(restored);
    setPayrollDialogOpen(true);
    if (saved && hasMobileDraftContent(saved.value)) toast.info("已恢复这台设备上未提交的工资核算草稿。");
  }
  function openDailyWageDialog() {
    const initial = { workerId: workers.data?.find(item => item.workerCategory === "temporary_daily" && item.attendanceStatus !== "left")?.id ? String(workers.data.find(item => item.workerCategory === "temporary_daily" && item.attendanceStatus !== "left")!.id) : "", settlementDate: getTodayText(), payableAmount: "", deductionAmount: "0", remarks: "" };
    const saved = readMobileDraft<typeof dailyWageLocalDraft>(dailyWageDraftKey);
    const restored = saved && hasMobileDraftContent(saved.value) ? { ...initial, ...saved.value } : initial;
    setDailyWageInitialDraft(initial);
    setDailyWageDraft(restored);
    setDailyWageDialogOpen(true);
    if (saved && hasMobileDraftContent(saved.value)) toast.info("已恢复这台设备上未提交的临时日结草稿。");
  }

  /** 打开指定人员的证照档案，只允许在当前已授权项目范围内访问和上传。 */
  function openCertificateDialog(worker: NonNullable<typeof workers.data>[number]) {
    setCertificateWorker({ id: worker.id, realName: worker.realName });
    setCertificateName("");
    setCertificateFile(null);
    setCertificateDialogOpen(true);
  }

  /** 前端只进行必要的体验校验，最终身份、范围、金额和状态校验均由服务端完成。 */
  function submitWorkerForm() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!workerDraft.realName.trim()) return toast.error("请填写实名姓名");
    if (!editingWorkerId && !workerDraft.identityNo.trim()) return toast.error("新建人员必须录入身份证号码");
    if (!editingWorkerId && workerDraft.identityVerificationStatus === "verified" && !workerDraft.identityNo.trim()) return toast.error("完成实名核验前必须录入身份证号码");
    saveWorker.mutate({
      id: editingWorkerId ?? undefined,
      projectId: selectedProjectId,
      realName: workerDraft.realName.trim(),
      teamName: workerDraft.teamName.trim() || null,
      workerCategory: workerDraft.workerCategory,
      remarks: workerDraft.remarks.trim() || null,
      identityNo: workerDraft.identityNo.trim() || undefined,
      phone: workerDraft.phone.trim() || (editingWorkerId ? undefined : null),
      bankAccount: workerDraft.bankAccount.trim() || (editingWorkerId ? undefined : null),
      bankName: workerDraft.bankName.trim() || null,
      identityVerificationStatus: workerDraft.identityVerificationStatus,
      identityVerificationNote: workerDraft.identityVerificationNote.trim() || null,
      attendanceStatus: workerDraft.attendanceStatus,
      entryDate: workerDraft.entryDate || null,
      exitDate: workerDraft.exitDate || null,
    });
  }

  /** 考勤表单以人员日期为幂等键，重复提交会更新未锁定记录。 */
  function submitAttendanceForm() {
    if (!selectedProjectId || !attendanceDraft.workerId) return toast.error("请选择项目与劳务人员");
    if (!isSuperAdmin && existingAttendanceForDraft) return toast.error("普通管理人员仅可新增考勤，已有考勤记录请联系超级管理员维护");
    saveAttendance.mutate({
      workerId: Number(attendanceDraft.workerId),
      projectId: selectedProjectId,
      attendanceDate: attendanceDraft.attendanceDate,
      workHours: Number(attendanceDraft.workHours),
      overtimeHours: Number(attendanceDraft.overtimeHours),
      note: attendanceDraft.note.trim() || null,
      source: "mobile",
      status: "confirmed",
    });
  }

  /** 上下班时间由服务端生成；定位授权拒绝不绕过记录，而是明确标记为待核验。 */
  async function submitMobileCheckIn(punchType: "in" | "out") {
    if (!selectedProjectId) return toast.error("请先选择项目");
    try {
      const deviceFingerprintHash = await getAttendanceDeviceFingerprint();
      const deviceLabel = getAttendanceDeviceLabel();
      const sendCheckIn = (position?: GeolocationPosition) => mobileCheckIn.mutate({
        projectId: selectedProjectId,
        punchType,
        deviceFingerprintHash,
        deviceLabel,
        longitude: position?.coords.longitude ?? null,
        latitude: position?.coords.latitude ?? null,
        locationAccuracyMeters: position?.coords.accuracy ?? null,
      });
      if (!navigator.geolocation) return sendCheckIn();
      navigator.geolocation.getCurrentPosition(sendCheckIn, () => { toast.info("未取得定位，本次打卡将标记为“缺少定位”供项目负责人核验"); sendCheckIn(); }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
    } catch {
      toast.error("无法生成设备匿名指纹，请检查浏览器隐私设置后重试");
    }
  }

  /** 工资草稿提交后由服务端以同一人员、项目、工资期间进行唯一约束与状态控制。 */
  function submitPayrollForm() {
    if (!selectedProjectId || !payrollDraft.workerId) return toast.error("请选择项目与劳务人员");
    if (!payrollDraft.payableAmount) return toast.error("请填写应发金额");
    if (!isSuperAdmin && existingPayrollForDraft) return toast.error("普通管理人员仅可新增工资草稿，已有工资条请联系超级管理员维护");
    savePayroll.mutate({
      workerId: Number(payrollDraft.workerId),
      projectId: selectedProjectId,
      period,
      payableAmount: Number(payrollDraft.payableAmount),
      deductionAmount: Number(payrollDraft.deductionAmount || 0),
    });
  }

  function submitDailyWageForm() {
    if (!selectedProjectId || !dailyWageDraft.workerId) return toast.error("请选择临时日结人员");
    if (!dailyWageDraft.payableAmount) return toast.error("请填写应发金额");
    saveDailyWage.mutate({ workerId: Number(dailyWageDraft.workerId), projectId: selectedProjectId, settlementDate: dailyWageDraft.settlementDate, payableAmount: Number(dailyWageDraft.payableAmount), deductionAmount: Number(dailyWageDraft.deductionAmount || 0), remarks: dailyWageDraft.remarks.trim() || null });
  }

  /** 上传前在客户端做文件类型、容量与名称体验校验；服务端仍会执行同等强制校验。 */
  async function submitCertificateForm() {
    if (!selectedProjectId || !certificateWorker) return toast.error("请先选择人员档案");
    if (!certificateName.trim()) return toast.error("请填写证照名称");
    if (!certificateFile) return toast.error("请选择证照文件");
    if (certificateFile.size > 5 * 1024 * 1024) return toast.error("单个证照文件不能超过 5MB");
    if (!(["image/jpeg", "image/png", "application/pdf"] as const).includes(certificateFile.type as "image/jpeg" | "image/png" | "application/pdf")) {
      return toast.error("仅支持 JPG、PNG 或 PDF 格式证照");
    }
    try {
      const base64Data = await readFileAsBase64(certificateFile);
      uploadCertificate.mutate({ projectId: selectedProjectId, workerId: certificateWorker.id, certificateName: certificateName.trim(), fileName: certificateFile.name, mimeType: certificateFile.type as "image/jpeg" | "image/png" | "application/pdf", base64Data });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "证照文件读取失败，请稍后重试"));
    }
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载劳务工资台账…" title="劳务工资" description="请使用企业统一身份进入已授权的项目数据范围。" Icon={ContactRound} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;
  if (projectOptions.error) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-sm text-[#f8ead7]">劳务工资模块加载失败：{getUserFacingErrorMessage(projectOptions.error, "暂无法读取劳务工资项目范围，请稍后重试")}</div>;
  }

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mobile-viewport-shell mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden">
          <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" />
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 active:scale-95" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button>
            <div className="text-center"><p className="text-sm font-semibold">劳务工资</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">实名制 · 考勤 · 工资核算</p></div>
            <button aria-label="查看劳务工资使用说明" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 active:scale-95" onClick={() => setHelpDialogOpen(true)}><CircleHelp className="h-5 w-5" /></button>
          </div>
          <div className="relative mt-5 flex items-end justify-between gap-3">
            <div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "请选择项目"}</p></div>
            <ShieldCheck className="h-6 w-6 text-[#e7b779]" />
          </div>
        </header>

        <main className="space-y-5 px-5 pt-5">
          <section className="grid grid-cols-[1fr_auto] gap-3 print:hidden">
            <Select value={selectedProjectId ? String(selectedProjectId) : undefined} onValueChange={value => setProjectId(Number(value))}>
              <SelectTrigger className="h-11 border-[#e9d8c6] bg-white text-[#4d2e22]"><SelectValue placeholder="选择已授权项目" /></SelectTrigger>
              <SelectContent>{projectOptions.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input aria-label="工资统计期间" className="h-11 w-[112px] border-[#e9d8c6] bg-white text-[#4d2e22]" type="month" value={period} onChange={event => setPeriod(event.target.value)} />
          </section>

          {selectedProjectId ? <Card className="border-0 bg-gradient-to-br from-[#6d3421] to-[#3a2117] text-[#fff7ea] shadow-[0_10px_24px_rgba(75,39,24,.18)] print:hidden"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-[#f0bd7d]" /><p className="font-semibold">今日上下班考勤</p></div><p className="mt-1 text-xs leading-5 text-[#e8cfb2]">所有登录人员每天须完成上班、下班打卡；服务端记录时间，定位用于现场复核。</p><div className="mt-2 space-y-1 text-xs"><p className={checkInStatus.data?.checkedIn ? "text-[#d8f0d4]" : "text-[#f4d9b4]"}>上班：{checkInStatus.data?.checkedIn ? `${formatChinaTime(checkInStatus.data.checkIn!.checkedInAt)} · ${checkInStatus.data.checkIn?.status === "normal" ? "已记录定位" : "缺少定位，待核验"}` : "尚未打卡"}</p><p className={checkInStatus.data?.checkedOut ? "text-[#d8f0d4]" : "text-[#f4d9b4]"}>下班：{checkInStatus.data?.checkedOut ? `${formatChinaTime(checkInStatus.data.checkOut!.checkedOutAt)} · ${checkInStatus.data.checkOut?.status === "normal" ? "已记录定位" : "缺少定位，待核验"}` : "尚未打卡"}</p></div></div><div className="flex shrink-0 flex-col gap-2"><Button size="sm" className="bg-[#f2bb79] text-[#4b2517] hover:bg-[#f6cb93]" disabled={mobileCheckIn.isPending || checkInStatus.data?.checkedIn} onClick={() => void submitMobileCheckIn("in")}>{mobileCheckIn.isPending && !checkInStatus.data?.checkedIn ? "打卡中…" : checkInStatus.data?.checkedIn ? "已上班" : "上班打卡"}</Button><Button size="sm" variant="outline" className="border-[#f2bb79] bg-transparent text-[#fff7ea] hover:bg-white/10 hover:text-white" disabled={mobileCheckIn.isPending || !checkInStatus.data?.checkedIn || checkInStatus.data?.checkedOut} onClick={() => void submitMobileCheckIn("out")}>{mobileCheckIn.isPending && checkInStatus.data?.checkedIn ? "打卡中…" : checkInStatus.data?.checkedOut ? "已下班" : "下班打卡"}</Button></div></div></CardContent></Card> : null}

          {!projectOptions.data?.length ? <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-5 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fff1dd] text-[#b96e34]"><HardHat className="h-6 w-6" /></span><p className="mt-4 text-[11px] font-medium tracking-[0.16em] text-[#b36c39]">项目范围保护中</p><h2 className="mt-1 text-sm font-semibold">尚未配置项目数据范围</h2><p className="mt-2 text-xs leading-5 text-[#8f7566]">请联系超级管理员在 PC 管理后台为您的岗位配置有效的项目数据范围。</p></CardContent></Card> : null}

          {selectedProjectId ? <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 print-grid">
              {[{ label: "在场人员", value: summary.data?.activeWorkers ?? 0, icon: UsersRound, tone: "bg-[#fff0df] text-[#9b552a]" }, { label: "本月考勤", value: summary.data?.attendanceDays ?? 0, icon: CalendarDays, tone: "bg-[#f3eee7] text-[#745340]" }, { label: "待审核", value: summary.data?.awaitingReviewCount ?? 0, icon: ReceiptText, tone: "bg-[#f8eadc] text-[#9c4d27]" }, { label: "实发合计", value: formatMoney(summary.data?.actualAmount), icon: WalletCards, tone: "bg-[#e7f1e5] text-[#4b7750]" }].map(item => {
                const StatIcon = item.icon;
                return <Card key={item.label} className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="flex items-center gap-3 p-3.5"><span className={`grid h-9 w-9 place-items-center rounded-xl ${item.tone}`}><StatIcon className="h-4.5 w-4.5" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.value}</p><p className="mt-0.5 text-[11px] text-[#8f7566]">{item.label}</p></div></CardContent></Card>;
              })}
            </section>

            <section className="flex items-center justify-between rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div><p className="text-sm font-semibold">{period} 劳务工资统计</p><p className="mt-1 text-xs text-[#7d563d]">应发 {formatMoney(summary.data?.payableAmount)} · 扣款 {formatMoney(summary.data?.deductionAmount)} · 待审 {formatMoney(summary.data?.awaitingReviewAmount)}</p></div><Button size="sm" variant="ghost" className="gap-1 text-[#8b3f20] hover:bg-[#e8cda9] hover:text-[#6e2e15]" disabled={!summary.data || payroll.isLoading} onClick={printPayrollSummary}><Printer className="h-4 w-4" />打印汇总</Button></section>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-[#f0e5d7] p-1 print:hidden"><TabsTrigger value="workers" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">实名人员</TabsTrigger><TabsTrigger value="attendance" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">考勤</TabsTrigger><TabsTrigger value="payroll" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">工资条</TabsTrigger></TabsList>

              <TabsContent value="workers" className="mt-4 space-y-3">
                <div className="flex items-center justify-between print:hidden"><div><h2 className="text-base font-semibold">实名制人员台账</h2><p className="mt-0.5 text-xs text-[#8f7566]">敏感信息仅显示掩码</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openWorkerDialog()}><Plus className="mr-1 h-4 w-4" />录入人员</Button></div>
                {isBusy ? <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8f7566]">正在同步数据…</div> : null}
                {!isBusy && !workers.data?.length ? <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8f7566]">当前项目尚未录入劳务人员。</div> : null}
                {workers.data?.map(worker => {
                  const identityStatus = getIdentityVerificationStatus(worker.identityVerificationStatus);
                  return <Card key={worker.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{worker.realName}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${identityStatus.className}`}>{identityStatus.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${worker.attendanceStatus === "active" ? "bg-[#e6f1e4] text-[#47754d]" : worker.attendanceStatus === "left" ? "bg-[#eee8e2] text-[#806e60]" : "bg-[#f8ead8] text-[#94603a]"}`}>{worker.attendanceStatus === "active" ? "在场" : worker.attendanceStatus === "left" ? "已退场" : "待进场"}</span></div>
                          <p className="mt-1 text-xs text-[#8f7566]">{worker.teamName || "未分班组"} · 进场 {formatDate(worker.entryDate)}</p>
                        </div>
                        <div className="flex items-center gap-2 print:hidden">
                          <button aria-label={`管理${worker.realName}证照`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openCertificateDialog(worker)}><FileText className="h-4 w-4" /></button>
                          {isSuperAdmin ? <button aria-label={`编辑${worker.realName}档案`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#fbefe0] text-[#975227] active:scale-95" onClick={() => openWorkerDialog(worker)}><Pencil className="h-4 w-4" /></button> : null}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-[#fcf8f2] px-3 py-2.5 text-[11px] text-[#765a49]"><span>身份证：{worker.identityNoMasked || "未录入"}</span><span>手机：{worker.phoneMasked || "未录入"}</span><span>开户行：{worker.bankName || "未录入"}</span><span>银行卡：{worker.bankAccountMasked || "未录入"}</span>{worker.identityVerificationNote ? <span className="col-span-2">核验说明：{worker.identityVerificationNote}</span> : null}</div>
                    </CardContent>
                  </Card>;
                })}
              </TabsContent>

              <TabsContent value="attendance" className="mt-4 space-y-3">
                <div className="flex items-center justify-between print:hidden"><div><h2 className="text-base font-semibold">考勤与工时</h2><p className="mt-0.5 text-xs text-[#8f7566]">按人员与日期幂等保存</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={openAttendanceDialog}><Plus className="mr-1 h-4 w-4" />录入考勤</Button></div>
                {!attendance.data?.length && !attendance.isLoading ? <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8f7566]">{period} 暂无考勤记录。</div> : null}
                {attendance.data?.map(record => <Card key={record.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="flex items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{record.workerName}</h3><span className="text-[11px] text-[#8f7566]">{record.teamName || "未分班组"}</span></div><p className="mt-1 text-xs text-[#8f7566]">{formatDate(record.attendanceDate)} · {record.source === "mobile" ? "移动端" : record.source === "manual" ? "手工" : record.source === "device" ? "设备" : "导入"}</p>{record.note ? <p className="mt-1 text-[11px] leading-4 text-[#846653]">备注：{record.note}</p> : null}</div><div className="text-right"><p className="text-sm font-semibold text-[#6d3f2b]">{record.workHours}h <span className="text-xs font-normal text-[#9a755f]">+ {record.overtimeHours}h 加班</span></p><p className="mt-1 text-[10px] text-[#7a675a]">{record.status === "confirmed" ? "已确认" : record.status === "locked" ? "已锁定" : "草稿"}</p></div></CardContent></Card>)}
              </TabsContent>

              <TabsContent value="payroll" className="mt-4 space-y-3">
                <div className="flex items-center justify-between print:hidden"><div><h2 className="text-base font-semibold">{period} 工资条</h2><p className="mt-0.5 text-xs text-[#8f7566]">会计审核后方可进入发放流程</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={openPayrollDialog}><Plus className="mr-1 h-4 w-4" />核算工资</Button></div>
                <Card className="border border-[#ead2b8] bg-[#fff8ef] shadow-none"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#6d3421]">临时日结</p><p className="mt-1 text-xs leading-5 text-[#8f7566]">劳资负责人或项目经理录入并提交；会计/财务审核后，由PC财务台账上传付款凭证并分笔登记。付款后为最终结算，不可作废。</p></div>{canManageDailyWage ? <Button size="sm" className="shrink-0 bg-[#6d3421] hover:bg-[#542516]" onClick={openDailyWageDialog}><Plus className="mr-1 h-4 w-4" />录入日结</Button> : null}</div><div className="mt-3 space-y-2">{!dailyWages.data?.length && !dailyWages.isLoading ? <p className="rounded-lg bg-white px-3 py-2 text-xs text-[#8f7566]">当前项目暂无临时日结记录。</p> : null}{dailyWages.data?.map(item => <div key={item.id} className="rounded-lg bg-white px-3 py-2 text-xs"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-[#5c3422]">{item.workerName}{item.teamName ? ` · ${item.teamName}` : ""}</p><p className="mt-1 text-[#8f7566]">{formatDate(item.settlementDate)} · 应发 {formatMoney(item.payableAmount)} · 扣款 {formatMoney(item.deductionAmount)} · 实发 {formatMoney(item.actualAmount)}</p>{item.paidAt ? <p className="mt-1 text-[#3e746a]">实际付款：{formatDate(item.paidAt)}</p> : null}</div><span className={`rounded-full px-2 py-1 ${item.status === "paid" ? "bg-emerald-50 text-emerald-700" : item.status === "approved" ? "bg-[#e5f1e3] text-[#47744d]" : item.status === "reviewing" ? "bg-[#f9e6bd] text-[#9c6425]" : "bg-[#f6eadb] text-[#81512e]"}`}>{item.status === "draft" ? "草稿" : item.status === "reviewing" ? "待审核" : item.status === "approved" ? "已审核" : "已付款"}</span></div>{(canManageDailyWage || canReviewDailyWage) ? <div className="mt-2 flex flex-wrap justify-end gap-2">{item.status === "draft" && canManageDailyWage ? <Button size="sm" variant="outline" className="h-8" disabled={submitDailyWage.isPending} onClick={() => submitDailyWage.mutate({ id: item.id })}>提交审核</Button> : null}{item.status === "reviewing" && canReviewDailyWage ? <><Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700" disabled={reviewDailyWage.isPending} onClick={() => reviewDailyWage.mutate({ id: item.id, decision: "returned" })}>退回草稿</Button><Button size="sm" className="h-8 bg-[#4d7954] text-white hover:bg-[#3d6644]" disabled={reviewDailyWage.isPending} onClick={() => reviewDailyWage.mutate({ id: item.id, decision: "approved" })}>审核通过</Button></> : null}{item.status === "approved" && canReviewDailyWage ? <p className="self-center text-[11px] text-[#3e746a]">请在 PC 财务台账上传凭证后分笔登记付款</p> : null}</div> : null}</div>)}</div></CardContent></Card>
                {!payroll.data?.length && !payroll.isLoading ? <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8f7566]">当前结算期间尚未生成工资条。</div> : null}
                {payroll.data?.map(statement => {
                  const status = getPayrollStatus(statement.status);
                  const payrollActions = getMobilePayrollActions(statement.status, activeRoleCodes);
                  const hasAction = Object.values(payrollActions).some(Boolean);
                  return (
                    <Card key={statement.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2"><h3 className="font-semibold">{statement.workerName}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div>
                            <p className="mt-1 text-xs text-[#8f7566]">{statement.teamName || "未分班组"} · 卡号 {statement.bankAccountMasked || "未录入"}</p>
                            {statement.paymentReference ? <p className="mt-1 text-[10px] text-[#8f7566]">付款凭证：{statement.paymentReference}</p> : null}
                          </div>
                          <div className="text-right"><p className="text-base font-semibold text-[#75351e]">{formatMoney(statement.actualAmount)}</p><p className="mt-1 text-[10px] text-[#8f7566]">应发 {formatMoney(statement.payableAmount)} · 扣 {formatMoney(statement.deductionAmount)}</p></div>
                        </div>
                        {hasAction ? <div className="mt-3 flex flex-wrap justify-end gap-2 print:hidden">
                          {payrollActions.submit ? <Button size="sm" variant="outline" className="h-8 border-[#dfc5ad] text-[#87502d] hover:bg-[#fbefe0]" disabled={submitPayroll.isPending} onClick={() => submitPayroll.mutate({ id: statement.id })}>提交审核 <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button> : null}
                          {payrollActions.approve ? <><Button size="sm" variant="outline" className="h-8 border-[#dfc5ad] text-[#87502d] hover:bg-[#fbefe0]" disabled={approvePayroll.isPending} onClick={() => approvePayroll.mutate({ id: statement.id, decision: "returned" })}>退回</Button><Button size="sm" className="h-8 bg-[#4d7954] text-white hover:bg-[#3d6644]" disabled={approvePayroll.isPending} onClick={() => approvePayroll.mutate({ id: statement.id, decision: "approved" })}><BadgeCheck className="mr-1 h-3.5 w-3.5" />审核通过</Button></> : null}
                          {payrollActions.void ? <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={voidPayroll.isPending} onClick={() => { setPayrollVoidDraft({ id: statement.id, reason: "" }); setPayrollVoidDialogOpen(true); }}><Ban className="mr-1 h-3.5 w-3.5" />作废</Button> : null}
                        </div> : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </TabsContent>
            </Tabs>
          </> : null}
        </main>

        <nav className="mobile-bottom-navigation fixed right-0 bottom-0 left-0 z-20 flex w-full max-w-none items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate(MOBILE_LABOR_BOTTOM_NAVIGATION.workbench)}><ContactRound className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><WalletCards className="h-5 w-5" /><span className="text-[10px] font-medium">劳务工资</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate(MOBILE_LABOR_BOTTOM_NAVIGATION.messages)}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate(MOBILE_LABOR_BOTTOM_NAVIGATION.profile)}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>

      <Dialog open={workerDialogOpen} onOpenChange={open => { if (open) setWorkerDialogOpen(true); else requestWorkerClose(resetWorkerForm); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>{editingWorkerId ? "编辑人员档案" : "录入实名制人员"}</DialogTitle><DialogDescription>{editingWorkerId ? "敏感信息留空即保持现有加密值，不会在页面回显。" : "身份证号码将由服务端加密保存，页面仅展示掩码。"}</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label htmlFor="worker-name">实名姓名</Label><Input id="worker-name" value={workerDraft.realName} onChange={event => setWorkerDraft(current => ({ ...current, realName: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="worker-team">班组</Label><Input id="worker-team" value={workerDraft.teamName} onChange={event => setWorkerDraft(current => ({ ...current, teamName: event.target.value }))} /></div></div><div className="grid gap-1.5"><Label htmlFor="worker-id-card">身份证号码{editingWorkerId ? "（如需变更请填写）" : ""}</Label><Input id="worker-id-card" inputMode="text" placeholder={editingWorkerId ? "留空保持不变" : "实名制必填"} value={workerDraft.identityNo} onChange={event => setWorkerDraft(current => ({ ...current, identityNo: event.target.value }))} /></div><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label htmlFor="worker-phone">联系电话</Label><Input id="worker-phone" inputMode="tel" placeholder={editingWorkerId ? "留空保持不变" : "可选"} value={workerDraft.phone} onChange={event => setWorkerDraft(current => ({ ...current, phone: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="worker-bank">开户行</Label><Input id="worker-bank" value={workerDraft.bankName} onChange={event => setWorkerDraft(current => ({ ...current, bankName: event.target.value }))} /></div></div><div className="grid gap-1.5"><Label htmlFor="worker-account">银行卡号</Label><Input id="worker-account" inputMode="numeric" placeholder={editingWorkerId ? "留空保持不变" : "可选"} value={workerDraft.bankAccount} onChange={event => setWorkerDraft(current => ({ ...current, bankAccount: event.target.value }))} /></div><div className="rounded-xl bg-[#fcf4e9] p-3"><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label>实名审核状态</Label><Select value={workerDraft.identityVerificationStatus} onValueChange={(value: "pending" | "verified" | "rejected") => setWorkerDraft(current => ({ ...current, identityVerificationStatus: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">待核验</SelectItem><SelectItem value="verified">已核验</SelectItem><SelectItem value="rejected">核验退回</SelectItem></SelectContent></Select></div><div className="grid gap-1.5"><Label htmlFor="identity-verification-note">审核备注</Label><Input id="identity-verification-note" maxLength={500} placeholder="非敏感核验结论（可选）" value={workerDraft.identityVerificationNote} onChange={event => setWorkerDraft(current => ({ ...current, identityVerificationNote: event.target.value }))} /></div></div><p className="mt-2 text-[11px] leading-4 text-[#846653]">标记“已核验”前请先确认身份证资料和已归档证照；系统不显示身份证原文。</p></div><div className="grid grid-cols-3 gap-3"><div className="grid gap-1.5"><Label>状态</Label><Select value={workerDraft.attendanceStatus} onValueChange={(value: "pending" | "active" | "left") => setWorkerDraft(current => ({ ...current, attendanceStatus: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">待进场</SelectItem><SelectItem value="active">在场</SelectItem><SelectItem value="left">已退场</SelectItem></SelectContent></Select></div><div className="grid gap-1.5"><Label htmlFor="worker-entry">进场日期</Label><Input id="worker-entry" type="date" value={workerDraft.entryDate} onChange={event => setWorkerDraft(current => ({ ...current, entryDate: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="worker-exit">退场日期</Label><Input id="worker-exit" type="date" value={workerDraft.exitDate} onChange={event => setWorkerDraft(current => ({ ...current, exitDate: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => requestWorkerClose(resetWorkerForm)}>取消</Button><Button variant="secondary" onClick={() => { try { saveWorkerLocalDraft(); } catch { toast.error("本机草稿保存失败，请检查设备存储权限"); } }}>保存本机草稿</Button><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" disabled={saveWorker.isPending} onClick={submitWorkerForm}>{saveWorker.isPending ? "保存中…" : "安全保存"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={certificateDialogOpen} onOpenChange={setCertificateDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>{certificateWorker?.realName ?? "人员"}的证照档案</DialogTitle><DialogDescription>仅支持 JPG、PNG 或 PDF，单个文件不超过 5MB；文件将按当前项目和人员归档。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-1.5"><Label htmlFor="certificate-name">证照名称</Label><Input id="certificate-name" placeholder="如特种作业操作证、身份证正面" value={certificateName} onChange={event => setCertificateName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="certificate-file">选择证照文件</Label><Input id="certificate-file" type="file" accept="image/jpeg,image/png,application/pdf" onChange={event => setCertificateFile(event.target.files?.[0] ?? null)} /><p className="text-[11px] text-[#8f7566]">{certificateFile ? `${certificateFile.name} · ${(certificateFile.size / 1024).toFixed(0)} KB` : "未选择文件"}</p></div><div className="rounded-xl bg-[#fcf4e9] p-3"><p className="text-xs font-medium text-[#70402a]">已归档证照</p>{certificates.isLoading ? <p className="mt-2 text-xs text-[#8f7566]">正在加载证照…</p> : null}{!certificates.isLoading && !certificates.data?.length ? <p className="mt-2 text-xs text-[#8f7566]">暂未上传证照。</p> : null}<div className="mt-2 space-y-2">{certificates.data?.map(item => <ProtectedImagePreview key={item.id} file={{ url: item.url, fileName: item.fileName, mimeType: item.mimeType }} title={item.certificateName} description="证照图片在当前页面内预览，不会下载。" className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-xs text-[#754222]"><span className="min-w-0 truncate"><FileText className="mr-1 inline h-3.5 w-3.5" />{item.certificateName}</span><span className="ml-2 shrink-0 text-[#9b765e]">查看</span></ProtectedImagePreview>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setCertificateDialogOpen(false)}>关闭</Button><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" disabled={uploadCertificate.isPending} onClick={submitCertificateForm}>{uploadCertificate.isPending ? "归档中…" : "上传归档"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={attendanceDialogOpen} onOpenChange={open => { if (open) setAttendanceDialogOpen(true); else requestAttendanceClose(resetAttendanceForm); }}>
        <DialogContent className="border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>录入考勤</DialogTitle><DialogDescription>同一人员同一天的未锁定考勤将被更新，不会产生重复记录。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-1.5"><Label>劳务人员</Label><Select value={attendanceDraft.workerId} onValueChange={value => setAttendanceDraft(current => ({ ...current, workerId: value }))}><SelectTrigger><SelectValue placeholder="选择在场人员" /></SelectTrigger><SelectContent>{workers.data?.filter(worker => worker.attendanceStatus === "active").map(worker => <SelectItem key={worker.id} value={String(worker.id)}>{worker.realName}{worker.teamName ? ` · ${worker.teamName}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-3 gap-3"><div className="grid gap-1.5"><Label htmlFor="attendance-date">日期</Label><Input id="attendance-date" type="date" value={attendanceDraft.attendanceDate} onChange={event => setAttendanceDraft(current => ({ ...current, attendanceDate: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="work-hours">正常工时</Label><Input id="work-hours" type="number" min="0" max="24" step="0.5" value={attendanceDraft.workHours} onChange={event => setAttendanceDraft(current => ({ ...current, workHours: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="overtime-hours">加班工时</Label><Input id="overtime-hours" type="number" min="0" max="24" step="0.5" value={attendanceDraft.overtimeHours} onChange={event => setAttendanceDraft(current => ({ ...current, overtimeHours: event.target.value }))} /></div></div><div className="grid gap-1.5"><Label htmlFor="attendance-note">备注</Label><Textarea id="attendance-note" maxLength={500} placeholder="如请假、调休、异常工时等补充说明（可选）" value={attendanceDraft.note} onChange={event => setAttendanceDraft(current => ({ ...current, note: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => requestAttendanceClose(resetAttendanceForm)}>取消</Button><Button variant="secondary" onClick={() => { try { saveAttendanceLocalDraft(); } catch { toast.error("本机草稿保存失败，请检查设备存储权限"); } }}>保存本机草稿</Button><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" disabled={saveAttendance.isPending} onClick={submitAttendanceForm}>{saveAttendance.isPending ? "保存中…" : "确认考勤"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={dailyWageDialogOpen} onOpenChange={open => { if (open) setDailyWageDialogOpen(true); else requestDailyWageClose(resetDailyWageForm); }}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto border-[#ead9c8] bg-[#fffaf2] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md"><DialogHeader><DialogTitle>录入临时日结</DialogTitle><DialogDescription>当天录入后提交会计/财务审核；审核通过不等于付款，实际付款须由PC财务台账上传凭证并分笔登记后才完成结算。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-1.5"><Label>临时日结人员</Label><Select value={dailyWageDraft.workerId} onValueChange={value => setDailyWageDraft(current => ({ ...current, workerId: value }))}><SelectTrigger><SelectValue placeholder="选择已授权项目下临时人员" /></SelectTrigger><SelectContent>{workers.data?.filter(worker => worker.workerCategory === "temporary_daily" && worker.attendanceStatus !== "left").map(worker => <SelectItem key={worker.id} value={String(worker.id)}>{worker.realName}{worker.teamName ? ` · ${worker.teamName}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-3 gap-3"><div className="grid gap-1.5"><Label>日结日期</Label><Input type="date" value={dailyWageDraft.settlementDate} onChange={event => setDailyWageDraft(current => ({ ...current, settlementDate: event.target.value }))} /></div><div className="grid gap-1.5"><Label>应发金额</Label><Input inputMode="decimal" value={dailyWageDraft.payableAmount} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setDailyWageDraft(current => ({ ...current, payableAmount: event.target.value }))} /></div><div className="grid gap-1.5"><Label>扣款</Label><Input inputMode="decimal" value={dailyWageDraft.deductionAmount} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setDailyWageDraft(current => ({ ...current, deductionAmount: event.target.value }))} /></div></div><div className="grid gap-1.5"><Label>备注（可选）</Label><Textarea maxLength={500} value={dailyWageDraft.remarks} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setDailyWageDraft(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => requestDailyWageClose(resetDailyWageForm)}>取消</Button><Button variant="secondary" onClick={() => { try { saveDailyWageLocalDraft(); } catch { toast.error("本机草稿保存失败，请检查设备存储权限"); } }}>保存本机草稿</Button><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" disabled={saveDailyWage.isPending} onClick={submitDailyWageForm}>{saveDailyWage.isPending ? "保存中…" : "保存日结草稿"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={payrollDialogOpen} onOpenChange={open => { if (open) setPayrollDialogOpen(true); else requestPayrollClose(resetPayrollForm); }}>
        <DialogContent className="border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>核算 {period} 工资</DialogTitle><DialogDescription>实发金额将由服务端按“应发金额 − 扣款金额”计算，保存后仍需提交会计审核。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-1.5"><Label>劳务人员</Label><Select value={payrollDraft.workerId} onValueChange={value => setPayrollDraft(current => ({ ...current, workerId: value }))}><SelectTrigger><SelectValue placeholder="选择劳务人员" /></SelectTrigger><SelectContent>{workers.data?.filter(worker => worker.attendanceStatus !== "left").map(worker => <SelectItem key={worker.id} value={String(worker.id)}>{worker.realName}{worker.teamName ? ` · ${worker.teamName}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label htmlFor="payable-amount">应发金额（元）</Label><Input id="payable-amount" type="number" min="0" step="0.01" value={payrollDraft.payableAmount} onChange={event => setPayrollDraft(current => ({ ...current, payableAmount: event.target.value }))} /></div><div className="grid gap-1.5"><Label htmlFor="deduction-amount">扣款金额（元）</Label><Input id="deduction-amount" type="number" min="0" step="0.01" value={payrollDraft.deductionAmount} onChange={event => setPayrollDraft(current => ({ ...current, deductionAmount: event.target.value }))} /></div></div><div className="rounded-xl bg-[#f6eadb] px-3 py-2 text-xs text-[#80543c]"><Landmark className="mr-1 inline h-3.5 w-3.5" />工资条将关联当前加密保存的银行卡尾号；如需变更银行卡，请先维护人员档案。</div></div><DialogFooter><Button variant="outline" onClick={() => requestPayrollClose(resetPayrollForm)}>取消</Button><Button variant="secondary" onClick={() => { try { savePayrollLocalDraft(); } catch { toast.error("本机草稿保存失败，请检查设备存储权限"); } }}>保存本机草稿</Button><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" disabled={savePayroll.isPending} onClick={submitPayrollForm}>{savePayroll.isPending ? "核算中…" : "保存工资草稿"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={payrollVoidDialogOpen} onOpenChange={setPayrollVoidDialogOpen}>
        <DialogContent className="border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>作废工资条</DialogTitle><DialogDescription>仅未确认发放的工资条可以作废。作废后不能恢复，请填写原因以便审计追溯。</DialogDescription></DialogHeader><div className="grid gap-2 py-2"><Label htmlFor="payroll-void-reason">作废原因</Label><Textarea id="payroll-void-reason" value={payrollVoidDraft.reason} onChange={event => setPayrollVoidDraft(current => ({ ...current, reason: event.target.value }))} placeholder="例如：考勤口径调整，需要重新核算" /></div><DialogFooter><Button variant="outline" onClick={() => setPayrollVoidDialogOpen(false)}>取消</Button><Button className="bg-rose-700 hover:bg-rose-800" disabled={voidPayroll.isPending} onClick={() => { if (!payrollVoidDraft.reason.trim()) return toast.error("请填写作废原因"); voidPayroll.mutate({ id: payrollVoidDraft.id, reason: payrollVoidDraft.reason.trim() }); }}><Ban className="mr-1 h-4 w-4" />确认作废</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen}>
        <DialogContent className="border-[#ead9c8] bg-[#fffaf2] sm:max-w-md"><DialogHeader><DialogTitle>劳务工资办理说明</DialogTitle><DialogDescription>按照实名制、考勤、核算、审核的顺序完成工资管理闭环。</DialogDescription></DialogHeader><ol className="space-y-3 text-sm leading-6 text-[#634438]"><li><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-[#f1d8ba] text-xs font-semibold text-[#7b3c1d]">1</span>先维护实名制人员档案。身份证、手机号和银行卡只会加密保存，后续均按掩码显示。</li><li><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-[#f1d8ba] text-xs font-semibold text-[#7b3c1d]">2</span>按人员和日期确认工时与加班工时；被锁定的考勤由后续结算流程保护，不可直接修改。</li><li><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-[#f1d8ba] text-xs font-semibold text-[#7b3c1d]">3</span>录入应发与扣款生成工资草稿，再提交会计审核。只有会计岗位可通过或退回审核中的工资条。</li></ol><DialogFooter><Button className="bg-[#a85f30] hover:bg-[#8e4b22]" onClick={() => setHelpDialogOpen(false)}>我知道了</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
