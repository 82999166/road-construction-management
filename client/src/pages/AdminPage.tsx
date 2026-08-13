import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardMenuItem } from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  BarChart3,
  DatabaseBackup,
  ExternalLink,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Printer,
  ScrollText,
  Settings2,
  ShieldCheck,
  Truck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * PC 端为统一管理入口中的全局治理工作台。菜单只负责界面导航，服务端仍会对每个全局治理接口执行超级管理员校验。
 */
const ADMIN_MENU: DashboardMenuItem[] = [
  { icon: LayoutDashboard, label: "运营概览", path: "/admin" },
  { icon: Building2, label: "组织与项目", path: "/admin/organization" },
  { icon: Truck, label: "车辆与资源", path: "/admin/vehicles" },
  { icon: FolderKanban, label: "施工执行", path: "/admin/construction" },
  { icon: UsersRound, label: "劳务工资", path: "/admin/labor" },
  { icon: Settings2, label: "机械资源", path: "/admin/machinery" },
  { icon: Truck, label: "运输调度", path: "/admin/transport" },
  { icon: UsersRound, label: "人员与权限", path: "/admin/permission" },
  { icon: BarChart3, label: "财务管理", path: "/admin/finance" },
  { icon: Megaphone, label: "范围通知", path: "/admin/broadcast" },
  { icon: KeyRound, label: "微信登录管理", path: "/admin/wechat-login" },
  { icon: BarChart3, label: "业务治理与备份", path: "/admin/business" },
  { icon: Settings2, label: "系统设置", path: "/admin/settings" },
  { icon: ScrollText, label: "发布与审计", path: "/admin/audit" },
];

/** 超级管理员从业务治理页进入时，优先落在 PC 端受控台账；其他模块仍使用已部署的既有工作台。 */
export const ADMIN_BUSINESS_ROUTE_BY_MODULE: Record<string, string> = {
  CONSTRUCTION: "/admin/construction",
  LABOR: "/admin/labor",
  MACHINERY: "/admin/machinery",
  TRANSPORT: "/admin/transport",
};

type OrganizationType = "group" | "company" | "project_department" | "department" | "team";
type DepartmentModuleCode = "CONSTRUCTION" | "LABOR" | "MACHINERY" | "TRANSPORT" | "PURCHASING" | "MEASUREMENT" | "FINANCE" | "EVIDENCE";
type OrganizationStatus = "active" | "disabled";
type ProjectType = "highway" | "railway" | "municipal" | "other";
type ProjectStatus = "planning" | "active" | "suspended" | "completed" | "archived";

type OrganizationForm = { id?: number; parentId: string; code: string; name: string; type: OrganizationType; managerUserId: string; costCenterCode: string; sortOrder: string; status: OrganizationStatus };
type ProjectForm = { id?: number; parentId: string; organizationId: string; code: string; name: string; nodeType: string; projectType: ProjectType; status: ProjectStatus; startDate: string; endDate: string; costCenterCode: string; sortOrder: string };
type PositionForm = { id?: number; code: string; name: string; category: string; description: string; status: OrganizationStatus };
type VehicleType = "dump_truck" | "tractor" | "mixer" | "flatbed" | "other";
type VehicleStatus = "active" | "suspended" | "disabled";
type LeaseBillingType = "monthly" | "daily" | "hourly" | "shift";
type VehicleForm = { id?: number; projectId: string; organizationId: string; plateNo: string; vehicleType: VehicleType; ownership: "owned" | "leased"; ownerName: string; driverUserId: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; status: VehicleStatus; leaseBillingType: LeaseBillingType; leaseRate: string; leaseStartDate: string; leaseEndDate: string };
type MachineOwnership = "owned" | "leased";
type MachineStatus = "idle" | "working" | "repairing" | "offsite" | "retired";
type MachineCostType = "fuel" | "repair" | "overtime" | "mobilization" | "other";
type MachineForm = { id?: number; projectId: string; operatorUserId: string; code: string; name: string; model: string; ownership: MachineOwnership; supplierName: string; plateOrAssetNo: string; status: MachineStatus; leaseBillingType: LeaseBillingType; leaseRate: string; leaseStartDate: string; leaseEndDate: string };
type MachineCostForm = { machineId: string; projectId: string; costType: MachineCostType; quantity: string; unitPrice: string; occurredAt: string };
type RfidWriterDeviceForm = { id?: number; deviceCode: string; displayName: string; model: string; connectionMode: "manual_placeholder" | "usb" | "serial" | "network"; status: "active" | "disabled" | "maintenance"; remarks: string };
type RfidCardForm = { id?: number; vehicleId: string; writerDeviceId: string; cardUid: string; driverPhone: string; status: "active" | "suspended" | "revoked" };
type LocalAccountStatus = "active" | "disabled";
type LocalLoginMode = "pc" | "mobile" | "both";
type LocalAccountEditForm = { userId: number; username: string; displayName: string; status: LocalAccountStatus; loginMode: LocalLoginMode };
type LocalAccountActionTarget = { id: number; name: string; username: string };
type AssignmentForm = { id?: number; userId: string; roleId: string; organizationId: string; projectId: string; validFrom: string; validTo: string };
type RoleForm = { id?: number; code: string; name: string; category: "system" | "business"; description: string; status: OrganizationStatus; isSystem: boolean };
type SettingForm = { id?: number; expectedVersion?: number; category: string; settingKey: string; displayName: string; value: string; isSensitive: boolean; remarks: string };
type SettingDeleteTarget = { id: number; displayName: string; settingKey: string; version: number; isSensitive: boolean };
type DailyDigestForm = { enabled: boolean; deliveryHour: string; deliveryMinute: string; includeEmptyProjects: boolean };
type BroadcastAudienceType = "project" | "organization" | "role";
type BroadcastForm = { id?: number; title: string; content: string; deepLink: string; audienceType: BroadcastAudienceType; scopeValue: string };
type MasterDataResource = "organization" | "position" | "project" | "vehicle" | "role" | "department_scope" | "role_assignment";
type MasterDataDeleteTarget = { resource: MasterDataResource; id: number; label: string; description: string };
type PayrollPaymentTarget = { id: number; workerName: string; period: string };
type WechatBindingActionTarget = { userId: number; displayName: string };
type ConstructionWeather = "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other";
type ConstructionReportEditor = { id?: number; projectId: number; status: "draft" | "submitted" | "approved" | "rejected" | "locked"; reportDate: string; workArea: string; weather: ConstructionWeather; workContent: string; safetyNotes: string; issueNotes: string; progressPercent: string };
type DesktopRecordDetail = { title: string; description: string; fields: Array<{ label: string; value: ReactNode }>; note?: string };

const EMPTY_ORGANIZATION_FORM: OrganizationForm = { parentId: "", code: "", name: "", type: "department", managerUserId: "", costCenterCode: "", sortOrder: "0", status: "active" };
const EMPTY_PROJECT_FORM: ProjectForm = { parentId: "", organizationId: "", code: "", name: "", nodeType: "项目", projectType: "highway", status: "planning", startDate: "", endDate: "", costCenterCode: "", sortOrder: "0" };
const EMPTY_POSITION_FORM: PositionForm = { code: "", name: "", category: "业务岗位", description: "", status: "active" };
const EMPTY_VEHICLE_FORM: VehicleForm = { projectId: "", organizationId: "", plateNo: "", vehicleType: "dump_truck", ownership: "owned", ownerName: "", driverUserId: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", status: "active", leaseBillingType: "monthly", leaseRate: "", leaseStartDate: "", leaseEndDate: "" };
const EMPTY_MACHINE_FORM: MachineForm = { projectId: "", operatorUserId: "", code: "", name: "", model: "", ownership: "owned", supplierName: "", plateOrAssetNo: "", status: "idle", leaseBillingType: "monthly", leaseRate: "", leaseStartDate: "", leaseEndDate: "" };
const EMPTY_MACHINE_COST_FORM: MachineCostForm = { machineId: "", projectId: "", costType: "fuel", quantity: "", unitPrice: "", occurredAt: "" };
const EMPTY_RFID_WRITER_DEVICE_FORM: RfidWriterDeviceForm = { deviceCode: "", displayName: "", model: "", connectionMode: "manual_placeholder", status: "active", remarks: "" };
const EMPTY_RFID_CARD_FORM: RfidCardForm = { vehicleId: "", writerDeviceId: "", cardUid: "", driverPhone: "", status: "active" };
const EMPTY_ROLE_FORM: RoleForm = { code: "", name: "", category: "business", description: "", status: "active", isSystem: false };
const EMPTY_ASSIGNMENT_FORM: AssignmentForm = { userId: "", roleId: "", organizationId: "", projectId: "", validFrom: "", validTo: "" };
const EMPTY_SETTING_FORM: SettingForm = { category: "微信公众号服务号", settingKey: "", displayName: "", value: "", isSensitive: false, remarks: "" };
const EMPTY_DAILY_DIGEST_FORM: DailyDigestForm = { enabled: false, deliveryHour: "17", deliveryMinute: "30", includeEmptyProjects: false };
const EMPTY_BROADCAST_FORM: BroadcastForm = { title: "", content: "", deepLink: "/mobile/messages", audienceType: "project", scopeValue: "" };
const CONSTRUCTION_WEATHER_LABELS: Record<ConstructionWeather, string> = { sunny: "晴", cloudy: "多云", rainy: "雨", snowy: "雪", windy: "大风", other: "其他" };
const OFFICIAL_ACCOUNT_SETTING_PRESETS: Array<Omit<SettingForm, "id" | "expectedVersion">> = [
  { category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_ID", displayName: "微信公众号服务号 AppID", value: "", isSensitive: false, remarks: "新版路径：微信开发者平台 → 我的业务 → 服务号 → 基础信息。此值填写 AppID，不要填入显示名称。用于员工微信身份绑定和业务通知。" },
  { category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_SECRET", displayName: "微信公众号服务号 AppSecret", value: "", isSensitive: true, remarks: "新版路径：微信开发者平台 → 我的业务 → 服务号 → 基础信息 → 开发密钥。请先确认 AppSecret 为启用状态；仅在服务端 AES-GCM 加密保存。" },
  { category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_APP_URL", displayName: "公众号业务跳转地址", value: "https://roadmanage-xjifzbue.manus.space", isSensitive: false, remarks: "必须是正式 HTTPS 站点根地址；用于模板消息跳转和员工 OAuth 绑定回调。若已绑定自有域名，请替换为自有正式域名。" },
  { category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_EGRESS_URL", displayName: "微信 API 固定出口网关地址", value: "https://wechat-egress.maomaoyx.com", isSensitive: false, remarks: "仅用于服务端访问 api.weixin.qq.com 的固定出口。微信 API IP 白名单应只加入该网关公网 IP；地址与签名密钥须同时发布后才启用。" },
  { category: "微信公众号服务号", settingKey: "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET", displayName: "固定出口网关签名密钥", value: "", isSensitive: true, remarks: "由网关部署时生成；仅服务端加密托管，不在页面、日志或审计中回显。" },
];
/** 服务号配置的敏感等级由后端契约决定，避免管理员手动误将 AppID 等运行参数保存为密文。 */
function resolveOfficialAccountSensitivity(settingKey: string, fallback: boolean) {
  if (settingKey === "WECHAT_OFFICIAL_APP_SECRET") return true;
  if (settingKey === "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET") return true;
  if (settingKey.startsWith("WECHAT_OFFICIAL_")) return false;
  return fallback;
}

/** 将同一安全测试按新版服务号配置阶段呈现为管理员可理解的操作标签。 */
function getOfficialAccountTestLabel(settingKey: string) {
  if (settingKey === "WECHAT_OFFICIAL_APP_ID" || settingKey === "WECHAT_OFFICIAL_APP_SECRET") return "校验开发密钥";
  if (settingKey === "WECHAT_OFFICIAL_TEMPLATE_ID" || settingKey === "WECHAT_OFFICIAL_TEMPLATE_FIELDS") return "检查通知就绪";
  if (settingKey === "WECHAT_OFFICIAL_APP_URL") return "校验绑定前置";
  return "校验服务号";
}

/** 兼容 API 返回 Date 或字符串的时间展示方法。 */
function displayDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

/** 本地日期筛选以用户浏览器日历为准，避免将 UTC 日期偏移带入运输日结算口径。 */
function toLocalDateInput(value = new Date()) {
  const localValue = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return localValue.toISOString().slice(0, 10);
}

/** 日期字段优先保留接口返回的自然日，避免桌面端编辑日报时发生时区偏移。 */
function toBusinessDateInput(value: Date | string | null | undefined) {
  if (!value) return toLocalDateInput();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return toLocalDateInput(new Date(value));
}

/** 只有草稿或退回日报可在桌面端提交编辑；类型守卫同时避免只读详情误用空表单。 */
function isEditableConstructionReport(input: ConstructionReportEditor | null): input is ConstructionReportEditor {
  return input !== null && (!input.id || ["draft", "rejected"].includes(input.status));
}

/** 将服务端 UTC 时间转换为 datetime-local 控件可编辑的本地值，避免维护授权有效期时出现时区偏移。 */
function toLocalDateTimeInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** 后台仅展示推导状态；服务端仍以授权记录、角色状态和当前时间作为最终访问边界。 */
function getAssignmentLifecycle(input: { status: string; roleStatus: string; validFrom: Date | string | null; validTo: Date | string | null }) {
  if (input.status === "revoked") return { label: "已撤销", tone: "outline" as const };
  if (input.roleStatus !== "active") return { label: "角色已停用", tone: "destructive" as const };
  const now = Date.now();
  if (input.validFrom && new Date(input.validFrom).getTime() > now) return { label: "尚未生效", tone: "outline" as const };
  if (input.validTo && new Date(input.validTo).getTime() <= now) return { label: "已过期", tone: "outline" as const };
  return { label: "有效", tone: "secondary" as const };
}

/** 空、非整数或非正项目号一律不作为业务查询范围，避免前端误把缺省条件视为全项目。 */
export function getBusinessWorkspaceProjectState(value: string) {
  const projectId = Number(value);
  return {
    projectId: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : 0,
    hasProject: Number.isSafeInteger(projectId) && projectId > 0,
  };
}

/** 投递审计仅在当前被点击的通知卡片内展开，避免跳转至页面下方的独立区域。 */
export function isInlineBroadcastDeliveryExpanded(selectedBroadcastId: number | undefined, broadcastId: number) {
  return selectedBroadcastId === broadcastId;
}

/**
 * 人员角色授权只能按“部门范围”或“具体项目范围”二选一保存。
 * 若选择具体项目，项目范围始终优先，以防历史双范围组合被误投影为部门授权。
 */
export function getAssignmentScopeSaveInput(input: { organizationId: string; projectId: string }) {
  const projectId = Number(input.projectId);
  if (Number.isSafeInteger(projectId) && projectId > 0) {
    return { organizationId: null, projectId };
  }
  const organizationId = Number(input.organizationId);
  return {
    organizationId: Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : null,
    projectId: null,
  };
}

function displayMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

/** 将后台表单转换为群发接口的三选一范围契约，避免浏览器同时提交项目、组织和岗位而扩大收件人。 */
function getBroadcastAudienceInput(form: BroadcastForm) {
  if (form.audienceType === "project") return { audienceType: "project" as const, projectId: Number(form.scopeValue) };
  if (form.audienceType === "organization") return { audienceType: "organization" as const, organizationId: Number(form.scopeValue) };
  return { audienceType: "role" as const, roleCode: form.scopeValue.trim() };
}

/** 只用于展示服务端返回的真实状态，按钮是否可操作仍由后端状态机二次判定。 */
function BusinessStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "待进场", active: "可用", left: "已退场", idle: "闲置", working: "作业中", repairing: "维修中", offsite: "场外", retired: "已退役",
    draft: "草稿", submitted: "待审核", reviewing: "审核中", approved: "已审核", verified: "已核验", paid: "已发放", settled: "已结算", rejected: "已退回", locked: "已归档", void: "已作废", suspended: "已暂停", disabled: "已停用", publishing: "发布中", published: "已发布", partial: "部分失败", failed: "发布失败", cancelled: "已取消", sent: "已投递", skipped: "已跳过",
  };
  const tone = ["approved", "verified", "paid", "settled", "active", "working"].includes(status)
    ? "bg-emerald-50 text-emerald-700"
    : ["rejected", "void", "disabled", "retired"].includes(status)
      ? "bg-rose-50 text-rose-700"
      : ["submitted", "reviewing", "pending", "repairing", "suspended"].includes(status)
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";
  return <Badge className={tone}>{labels[status] ?? status}</Badge>;
}

/** 用于治理概览的统一统计卡片，不展示任何虚构项目业务数据。 */
function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: number | undefined;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value ?? "—"}</p>
          <p className="mt-2 text-xs text-slate-500">{description}</p>
        </div>
        <div className="rounded-xl bg-slate-100 p-2.5 text-[#203c48]">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

/** 没有真实数据时使用明确空状态，避免用演示数据误导管理人员。 */
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

/** 权限页的组织范围选择必须区分加载中、尚未建节点和可正常选择三种状态，避免空下拉让管理员误以为页面失效。 */
export function getDepartmentScopePickerState(isLoading: boolean, nodeCount: number) {
  if (isLoading) return { disabled: true, placeholder: "正在加载组织节点…", needsOrganizationSetup: false };
  if (nodeCount === 0) return { disabled: true, placeholder: "暂无部门或项目部", needsOrganizationSetup: true };
  return { disabled: false, placeholder: "选择部门或项目部", needsOrganizationSetup: false };
}

export default function AdminPage() {
  const { isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();
  const activeSection = location.split("/")[2] || "overview";

  /**
   * tRPC 会将同一渲染周期内的查询合并为一个批次。后台全部 17 个数据域若在首屏同时请求，任何慢查询都会阻塞运营概览。
   * 因此只为当前分区和该分区实际依赖的数据源发起查询；服务端权限校验仍是最终边界。
   */
  const canQuery = isAuthenticated;
  const isOverview = activeSection === "overview";
  const isOrganization = activeSection === "organization";
  const isVehicle = activeSection === "vehicles";
  const isConstruction = activeSection === "construction";
  const isLabor = activeSection === "labor";
  const isMachinery = activeSection === "machinery";
  const isTransport = activeSection === "transport";
  const isFinance = activeSection === "finance";
  const isBroadcast = activeSection === "broadcast";
  const isWechatLogin = activeSection === "wechat-login";
  const isBusinessWorkspace = isConstruction || isLabor || isMachinery || isTransport;
  const isPermission = activeSection === "permission";
  const isBusiness = activeSection === "business";
  const isSettings = activeSection === "settings";
  const isAudit = activeSection === "audit";
  const needsOrganizations = isOrganization || isVehicle || isPermission;
  const needsProjects = isOrganization || isVehicle || isPermission || isBusiness || isBusinessWorkspace || isFinance || isSettings;
  const needsUsers = isOrganization || isVehicle || isPermission || isMachinery;

  const overview = trpc.admin.overview.useQuery(undefined, { enabled: canQuery && isOverview });
  const organizations = trpc.admin.organization.list.useQuery(undefined, { enabled: canQuery && needsOrganizations });
  const positions = trpc.admin.position.list.useQuery(undefined, { enabled: canQuery && isOrganization });
  const projects = trpc.admin.project.list.useQuery(undefined, { enabled: canQuery && needsProjects });
  const roles = trpc.admin.role.list.useQuery(undefined, { enabled: canQuery && isPermission });
  const roleTemplates = trpc.admin.role.templates.useQuery(undefined, { enabled: canQuery && isPermission });
  const permissions = trpc.admin.role.permissions.useQuery(undefined, { enabled: canQuery && isPermission });
  const users = trpc.admin.personnel.listUsers.useQuery(undefined, { enabled: canQuery && needsUsers });
  const assignments = trpc.admin.personnel.listAssignments.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentScopes = trpc.admin.department.listScopes.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentModules = trpc.admin.department.modules.useQuery(undefined, { enabled: canQuery && isPermission });
  const settings = trpc.admin.settings.list.useQuery(undefined, { enabled: canQuery && isSettings });
  const officialTemplateCoverage = trpc.admin.settings.officialAccountTemplateCoverage.useQuery(undefined, { enabled: canQuery && isSettings });
  const dailyDigestSettings = trpc.dailyDigest.getSettings.useQuery(undefined, { enabled: canQuery && isSettings });
  const audits = trpc.admin.audit.list.useQuery(undefined, { enabled: canQuery && isAudit });
  const broadcastOptions = trpc.broadcast.formOptions.useQuery(undefined, { enabled: canQuery && isBroadcast });
  const broadcasts = trpc.broadcast.list.useQuery(undefined, { enabled: canQuery && isBroadcast });
  const wechatLogins = trpc.admin.wechatLogin.list.useQuery(undefined, { enabled: canQuery && isWechatLogin });
  const realDataReadiness = trpc.admin.acceptance.realDataReadiness.useQuery(undefined, { enabled: canQuery && isOverview });
  const vehicles = trpc.admin.vehicle.list.useQuery(undefined, { enabled: canQuery && isVehicle });
  const [businessFilter, setBusinessFilter] = useState({ projectId: "all", period: "" });
  const [businessWorkspaceProjectId, setBusinessWorkspaceProjectId] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [transportDate, setTransportDate] = useState(() => toLocalDateInput());
  const [laborPeriod, setLaborPeriod] = useState("");
  const [financeProjectId, setFinanceProjectId] = useState("");
  const [financePeriod, setFinancePeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [financeClosingDate, setFinanceClosingDate] = useState(() => toLocalDateInput());
  const [broadcastForm, setBroadcastForm] = useState<BroadcastForm>(EMPTY_BROADCAST_FORM);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number>();
  const [payrollPaymentTarget, setPayrollPaymentTarget] = useState<PayrollPaymentTarget | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [constructionReportEditor, setConstructionReportEditor] = useState<ConstructionReportEditor | null>(null);
  const [desktopRecordDetail, setDesktopRecordDetail] = useState<DesktopRecordDetail | null>(null);
  const businessStatisticsInput = useMemo(() => ({
    projectId: businessFilter.projectId === "all" ? undefined : Number(businessFilter.projectId),
    period: businessFilter.period || undefined,
  }), [businessFilter.period, businessFilter.projectId]);
  const businessStatistics = trpc.admin.business.statistics.useQuery(businessStatisticsInput, { enabled: canQuery && isBusiness });
  const backups = trpc.admin.backup.list.useQuery(undefined, { enabled: canQuery && isBusiness });
  const workspaceProjectState = getBusinessWorkspaceProjectState(businessWorkspaceProjectId);
  const workspaceProjectId = workspaceProjectState.projectId;
  const hasBusinessWorkspaceProject = workspaceProjectState.hasProject;
  const workspaceProjectInput = useMemo(() => ({ projectId: workspaceProjectId }), [workspaceProjectId]);
  const laborWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, includeLeft: true }), [workspaceProjectId]);
  const payrollWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, period: laborPeriod || undefined }), [laborPeriod, workspaceProjectId]);
  const machineCostWorkspaceInput = useMemo(() => ({ machineId: Number(selectedMachineId || 0), projectId: workspaceProjectId }), [selectedMachineId, workspaceProjectId]);
  const transportWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, date: transportDate || undefined }), [transportDate, workspaceProjectId]);
  const financeProjectInput = useMemo(() => ({ projectId: Number(financeProjectId || 0), period: financePeriod || undefined }), [financePeriod, financeProjectId]);
  const broadcastAudienceInput = useMemo(() => getBroadcastAudienceInput(broadcastForm), [broadcastForm]);
  const validBroadcastScope = broadcastForm.audienceType === "role" ? Boolean(broadcastForm.scopeValue.trim()) : Number.isInteger(Number(broadcastForm.scopeValue)) && Number(broadcastForm.scopeValue) > 0;
  const broadcastAudiencePreview = trpc.broadcast.previewAudience.useQuery(broadcastAudienceInput, { enabled: canQuery && isBroadcast && validBroadcastScope, retry: false });
  const broadcastDeliveries = trpc.broadcast.getDeliveries.useQuery({ broadcastId: selectedBroadcastId ?? 0 }, { enabled: canQuery && isBroadcast && selectedBroadcastId !== undefined, retry: false });
  const constructionDailyReports = trpc.construction.listReports.useQuery(workspaceProjectInput, { enabled: canQuery && isConstruction && hasBusinessWorkspaceProject });
  const constructionDailySummary = trpc.construction.summary.useQuery(workspaceProjectInput, { enabled: canQuery && isConstruction && hasBusinessWorkspaceProject });
  const laborWorkers = trpc.labor.listWorkers.useQuery(laborWorkspaceInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const laborAttendance = trpc.labor.attendance.list.useQuery(workspaceProjectInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const payrollStatements = trpc.labor.payroll.list.useQuery(payrollWorkspaceInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const machineryLedger = trpc.machinery.listMachines.useQuery(workspaceProjectInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject });
  const machineCosts = trpc.machinery.listCosts.useQuery(machineCostWorkspaceInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject && Boolean(selectedMachineId) });
  const transportVehicleLedger = trpc.transport.listVehicles.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const transportTrips = trpc.transport.listTrips.useQuery(transportWorkspaceInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const rfidWriterDevices = trpc.transport.listRfidWriterDevices.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const vehicleRfidCards = trpc.transport.listVehicleRfidCards.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const financeSummary = trpc.finance.summary.useQuery({ projectId: Number(financeProjectId || 0), period: financePeriod }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && Boolean(financePeriod) });
  const financeInvoices = trpc.finance.listInvoices.useQuery(financeProjectInput, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dailyAccountingReport = trpc.finance.getDailyPrintableReport.useQuery({ projectId: Number(financeProjectId || 0), closingDate: financeClosingDate }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && Boolean(financeClosingDate) });
  const closeDailyAccount = trpc.finance.closeDailyAccount.useMutation({
    onSuccess: async result => {
      toast.success(`日结已封存：${result.closingNo}`);
      await Promise.all([financeSummary.refetch(), financeInvoices.refetch(), dailyAccountingReport.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const refreshBroadcasts = async () => { await Promise.all([broadcasts.refetch(), selectedBroadcastId ? broadcastDeliveries.refetch() : Promise.resolve()]); };
  const saveBroadcastDraft = trpc.broadcast.saveDraft.useMutation({
    onSuccess: async result => {
      toast.success("群发内容已保存，正在按授权范围直接发送");
      setSelectedBroadcastId(result.broadcastId);
      setBroadcastForm(EMPTY_BROADCAST_FORM);
      publishBroadcast.mutate({ id: result.broadcastId });
      await refreshBroadcasts();
    },
    onError: error => toast.error(error.message),
  });
  const reviewBroadcast = trpc.broadcast.review.useMutation({
    onSuccess: async result => { toast.success(`群发单状态已更新为 ${result.status}`); await refreshBroadcasts(); },
    onError: error => toast.error(error.message),
  });
  const publishBroadcast = trpc.broadcast.publish.useMutation({
    onSuccess: async result => { toast.success(`群发处理完成：成功 ${result.deliveredCount}，失败 ${result.failedCount}`); await refreshBroadcasts(); },
    onError: error => toast.error(error.message),
  });
  const revokeWechatBinding = trpc.admin.wechatLogin.revoke.useMutation({
    onSuccess: async () => {
      toast.success("微信授权绑定已解除；该人员须重新在微信内完成授权绑定");
      setWechatBindingActionTarget(null);
      await wechatLogins.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const [selectedRoleId, setSelectedRoleId] = useState<number>();
  const [selectedSettingId, setSelectedSettingId] = useState<number>();
  const settingHistory = trpc.admin.settings.history.useQuery(
    { settingId: selectedSettingId ?? 0 },
    { enabled: canQuery && isSettings && selectedSettingId !== undefined },
  );
  const rolePermissionIds = trpc.admin.role.permissionIds.useQuery(
    { roleId: selectedRoleId ?? 0 },
    { enabled: canQuery && isPermission && selectedRoleId !== undefined },
  );
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);

  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(EMPTY_ORGANIZATION_FORM);
  const [projectForm, setProjectForm] = useState<ProjectForm>(EMPTY_PROJECT_FORM);
  const [positionForm, setPositionForm] = useState<PositionForm>(EMPTY_POSITION_FORM);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
  const [machineForm, setMachineForm] = useState<MachineForm>(EMPTY_MACHINE_FORM);
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [machineCostForm, setMachineCostForm] = useState<MachineCostForm>(EMPTY_MACHINE_COST_FORM);
  const [machineCostDialogOpen, setMachineCostDialogOpen] = useState(false);
  const [rfidWriterDeviceForm, setRfidWriterDeviceForm] = useState<RfidWriterDeviceForm>(EMPTY_RFID_WRITER_DEVICE_FORM);
  const [rfidCardForm, setRfidCardForm] = useState<RfidCardForm>(EMPTY_RFID_CARD_FORM);
  const [rfidWriterDialogOpen, setRfidWriterDialogOpen] = useState(false);
  const [rfidCardDialogOpen, setRfidCardDialogOpen] = useState(false);
  const [rfidWritePreview, setRfidWritePreview] = useState<{ jobId: number; jobNo: string; payload: Record<string, unknown>; hardwareMode: "manual_confirmation" } | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(EMPTY_ASSIGNMENT_FORM);
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [localAccountForm, setLocalAccountForm] = useState({ username: "", displayName: "", initialPassword: "", status: "active" as LocalAccountStatus, loginMode: "both" as LocalLoginMode });
  const [localAccountEditForm, setLocalAccountEditForm] = useState<LocalAccountEditForm | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] = useState<LocalAccountActionTarget | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LocalAccountActionTarget | null>(null);
  const [wechatBindingActionTarget, setWechatBindingActionTarget] = useState<WechatBindingActionTarget | null>(null);
  const [departmentScopeForm, setDepartmentScopeForm] = useState<{ organizationId: string; module: DepartmentModuleCode | "" }>({ organizationId: "", module: "" });
  const [settingForm, setSettingForm] = useState<SettingForm>(EMPTY_SETTING_FORM);
  const [dailyDigestForm, setDailyDigestForm] = useState<DailyDigestForm>(EMPTY_DAILY_DIGEST_FORM);
  const [dailyDigestPreviewProjectId, setDailyDigestPreviewProjectId] = useState("");
  const [dailyDigestPreviewDate, setDailyDigestPreviewDate] = useState(() => toLocalDateInput());
  const [settingDeleteTarget, setSettingDeleteTarget] = useState<SettingDeleteTarget | null>(null);
  const [masterDataDeleteTarget, setMasterDataDeleteTarget] = useState<MasterDataDeleteTarget | null>(null);

  /** 管理后台对话框统一使用的紧凑字段包装，避免设备与车辆卡表单出现无标签输入。 */
  const Field = ({ label, children }: { label: string; children: ReactNode }) => <div><Label>{label}</Label><div className="mt-1">{children}</div></div>;

  // 首次加载后默认选中第一个角色；角色切换后以服务端真实权限回显编辑矩阵。
  useEffect(() => {
    if (!selectedRoleId && roles.data?.[0]) setSelectedRoleId(roles.data[0].id);
  }, [roles.data, selectedRoleId]);
  useEffect(() => {
    setDraftPermissionIds(rolePermissionIds.data ?? []);
  }, [rolePermissionIds.data]);
  // 默认选中第一条配置，方便管理员直接查看其发布历史和回滚入口。
  /** 主清单隐藏停用项和当前无可下发模板的手工字段；历史、审计和服务端兼容读取不受影响。 */
  const allSettings = settings.data ?? [];
  const templateSettingKeys = new Set(["WECHAT_OFFICIAL_TEMPLATE_ID", "WECHAT_OFFICIAL_TEMPLATE_FIELDS"]);
  const visibleSettings = allSettings.filter(item => item.status !== "disabled" && !templateSettingKeys.has(item.settingKey));
  const publishedOfficialSettingKeys = new Set(allSettings.filter(item => item.status === "published").map(item => item.settingKey));
  const officialCredentialsReady = publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_ID") && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_SECRET");
  const officialBindingReady = officialCredentialsReady && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_URL");
  const officialTemplateReady = officialCredentialsReady && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_TEMPLATE_ID");
  useEffect(() => {
    if (!visibleSettings.length) {
      if (selectedSettingId !== undefined) setSelectedSettingId(undefined);
      return;
    }
    if (!visibleSettings.some(item => item.id === selectedSettingId)) setSelectedSettingId(visibleSettings[0].id);
  }, [selectedSettingId, visibleSettings]);
  useEffect(() => {
    if (!dailyDigestSettings.data) return;
    setDailyDigestForm({
      enabled: dailyDigestSettings.data.enabled,
      deliveryHour: String(dailyDigestSettings.data.deliveryHour).padStart(2, "0"),
      deliveryMinute: String(dailyDigestSettings.data.deliveryMinute).padStart(2, "0"),
      includeEmptyProjects: dailyDigestSettings.data.includeEmptyProjects,
    });
  }, [dailyDigestSettings.data]);
  useEffect(() => {
    if (!isBusinessWorkspace || businessWorkspaceProjectId || !projects.data?.length) return;
    const firstAvailableProject = projects.data.find(project => project.status !== "archived");
    if (firstAvailableProject) setBusinessWorkspaceProjectId(String(firstAvailableProject.id));
  }, [businessWorkspaceProjectId, isBusinessWorkspace, projects.data]);
  useEffect(() => {
    setSelectedMachineId("");
  }, [businessWorkspaceProjectId]);
  useEffect(() => {
    if (!isMachinery || !machineryLedger.data?.length) return;
    if (!machineryLedger.data.some(machine => String(machine.id) === selectedMachineId)) {
      setSelectedMachineId(String(machineryLedger.data[0].id));
    }
  }, [isMachinery, machineryLedger.data, selectedMachineId]);
  const selectedSetting = visibleSettings.find(item => item.id === selectedSettingId);
  const selectedBusinessProject = projects.data?.find(project => String(project.id) === businessFilter.projectId);
  const selectedWorkspaceProject = projects.data?.find(project => String(project.id) === businessWorkspaceProjectId);
  const selectedMachineForDialog = (machineryLedger.data ?? []).find(machine => String(machine.id) === selectedMachineId);
  const businessFilterLabel = `${selectedBusinessProject?.name ?? "全部项目"}${businessFilter.period ? ` · ${businessFilter.period}` : " · 全部期间"}`;
  const dailyDigestPreviewInput = useMemo(() => ({ projectId: Number(dailyDigestPreviewProjectId || 0), businessDate: dailyDigestPreviewDate }), [dailyDigestPreviewDate, dailyDigestPreviewProjectId]);
  const dailyDigestPreview = trpc.dailyDigest.preview.useQuery(dailyDigestPreviewInput, { enabled: canQuery && isSettings && Number(dailyDigestPreviewProjectId) > 0 && Boolean(dailyDigestPreviewDate) });

  /** 配置版本冲突后强制刷新列表与历史，避免管理员继续在旧版本上操作。 */
  const refreshAfterSettingConflict = async () => {
    toast.error("配置已被其他管理员更新，已刷新为最新版本，请确认后重试");
    await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
  };

  const saveOrganization = trpc.admin.organization.save.useMutation({
    onSuccess: async () => {
      toast.success("组织节点已保存");
      setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      await Promise.all([organizations.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveProject = trpc.admin.project.save.useMutation({
    onSuccess: async () => {
      toast.success("项目节点已保存");
      setProjectForm(EMPTY_PROJECT_FORM);
      await Promise.all([projects.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const savePosition = trpc.admin.position.save.useMutation({
    onSuccess: async () => {
      toast.success("岗位字典已保存");
      setPositionForm(EMPTY_POSITION_FORM);
      await Promise.all([positions.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveVehicle = trpc.admin.vehicle.save.useMutation({
    onSuccess: async data => {
      toast.success(`车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`);
      setVehicleForm(EMPTY_VEHICLE_FORM);
      await Promise.all([vehicles.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveMachine = trpc.machinery.saveMachine.useMutation({
    onSuccess: async () => {
      toast.success(machineForm.id ? "机械档案已在 PC 后台更新" : "机械档案已在 PC 后台建立");
      setMachineForm(EMPTY_MACHINE_FORM);
      setMachineDialogOpen(false);
      await Promise.all([machineryLedger.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveMachineCost = trpc.machinery.saveCost.useMutation({
    onSuccess: async data => {
      toast.success(`机械成本已录入，系统核算金额 ¥${displayMoney(data.amount)}`);
      setMachineCostForm(EMPTY_MACHINE_COST_FORM);
      setMachineCostDialogOpen(false);
      await Promise.all([machineCosts.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveRfidWriterDevice = trpc.transport.saveRfidWriterDevice.useMutation({
    onSuccess: async () => {
      toast.success("写卡器台账已保存");
      setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM);
      setRfidWriterDialogOpen(false);
      await Promise.all([rfidWriterDevices.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveVehicleRfidCard = trpc.transport.saveVehicleRfidCard.useMutation({
    onSuccess: async () => {
      toast.success("车辆射频卡绑定已保存；请生成写卡任务后再进行物理写入");
      setRfidCardForm(EMPTY_RFID_CARD_FORM);
      setRfidCardDialogOpen(false);
      await Promise.all([vehicleRfidCards.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const prepareRfidCardWrite = trpc.transport.prepareRfidCardWrite.useMutation({
    onSuccess: data => {
      setRfidWritePreview({ jobId: data.jobId, jobNo: data.jobNo, payload: data.payload as Record<string, unknown>, hardwareMode: data.hardwareMode });
      toast.success("写卡载荷已生成；请在现场写卡器完成物理写入后确认结果");
    },
    onError: error => toast.error(error.message),
  });
  const confirmRfidCardWrite = trpc.transport.confirmRfidCardWrite.useMutation({
    onSuccess: async data => {
      toast.success(data.status === "confirmed" ? "写卡结果已确认并留痕" : "写卡失败已记录，请核对设备和卡片后重试");
      setRfidWritePreview(null);
      await Promise.all([vehicleRfidCards.refetch(), rfidWriterDevices.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveRole = trpc.admin.role.save.useMutation({
    onSuccess: async () => {
      toast.success("角色已保存");
      setRoleForm(EMPTY_ROLE_FORM);
      await roles.refetch();
      await overview.refetch();
    },
  });
  const saveAssignment = trpc.admin.personnel.saveAssignment.useMutation({
    onSuccess: async () => {
      toast.success(assignmentForm.id ? "人员授权已更新" : "人员授权已保存");
      setAssignmentForm(EMPTY_ASSIGNMENT_FORM);
      await Promise.all([assignments.refetch(), audits.refetch(), users.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const createLocalUser = trpc.admin.personnel.createLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号已创建，请继续配置角色、部门和项目范围");
      setLocalAccountForm({ username: "", displayName: "", initialPassword: "", status: "active", loginMode: "both" });
      await Promise.all([users.refetch(), audits.refetch(), overview.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const setLocalUserStatus = trpc.admin.personnel.setLocalUserStatus.useMutation({
    onSuccess: async () => {
      toast.success("本地账号状态已更新；已停用账号的后续请求会被服务端拒绝");
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const updateLocalUser = trpc.admin.personnel.updateLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号资料已更新");
      setLocalAccountEditForm(null);
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const resetLocalUserPassword = trpc.admin.personnel.resetLocalUserPassword.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员密码已重置，新密码不会再次显示");
      setPasswordResetTarget(null);
      setResetPassword("");
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const deleteLocalUser = trpc.admin.personnel.deleteLocalUser.useMutation({
    onSuccess: async data => {
      toast.success(`普通管理人员账号已删除，并撤销 ${data.revokedAssignmentCount} 项角色授权`);
      setDeleteTarget(null);
      await Promise.all([users.refetch(), assignments.refetch(), audits.refetch(), overview.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveDepartmentScope = trpc.admin.department.saveScope.useMutation({
    onSuccess: async () => {
      toast.success("部门业务范围已保存，相关人员下次请求将按新范围校验");
      setDepartmentScopeForm({ organizationId: "", module: "" });
      await departmentScopes.refetch();
    },
  });
  const saveSetting = trpc.admin.settings.saveDraft.useMutation({
    onSuccess: async data => {
      toast.success(settingForm.id ? `配置草稿已更新为 v${data.version ?? "新版本"}` : "配置草稿已安全保存");
      setSettingForm(EMPTY_SETTING_FORM);
      await Promise.all([settings.refetch(), settingHistory.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const publishSetting = trpc.admin.settings.publish.useMutation({
    onSuccess: async () => {
      toast.success("配置已发布并记录版本");
      await settings.refetch();
      await audits.refetch();
    },
    onError: refreshAfterSettingConflict,
  });
  const testSetting = trpc.admin.settings.test.useMutation({
    onSuccess: async result => {
      result.success ? toast.success(result.message) : toast.error(result.message);
      await audits.refetch();
    },
  });
  const checkOfficialTemplateCapability = trpc.admin.settings.checkOfficialAccountTemplateCapability.useMutation({
    onSuccess: async result => {
      result.success ? toast.success(result.message) : toast.error(result.message);
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const [officialTemplateOptions, setOfficialTemplateOptions] = useState<Array<{ templateId: string; title: string; content: string; fieldMapping: Record<string, string>; persistentBusinessEligible?: boolean; eligibilityMessage?: string }>>([]);
  const listOfficialTemplates = trpc.admin.settings.listOfficialAccountTemplates.useMutation({
    onSuccess: result => {
      setOfficialTemplateOptions(result.templates);
      result.success ? toast.success(result.message) : toast.error(result.message);
    },
    onError: error => toast.error(error.message),
  });
  const createOfficialTemplateDraft = trpc.admin.settings.createOfficialAccountTemplateDraft.useMutation({
    onSuccess: async result => {
      toast.success(result.message);
      setOfficialTemplateOptions([]);
      await Promise.all([settings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveDailyDigest = trpc.dailyDigest.saveSettings.useMutation({
    onSuccess: async data => {
      toast.success(data.taskUid ? "每日项目汇总已保存，定时任务已同步" : "每日项目汇总设置已保存");
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const runDailyDigestNow = trpc.dailyDigest.runNow.useMutation({
    onSuccess: async result => {
      toast.success(`每日汇总已执行：${result.projectCount} 个项目，成功/幂等投递 ${result.deliveredCount} 次，失败 ${result.failedCount} 次`);
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const disableSetting = trpc.admin.settings.disable.useMutation({
    onSuccess: async result => {
      toast.success(`配置已停用并记录为 v${result.version}`);
      await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeSetting = trpc.admin.settings.remove.useMutation({
    onSuccess: async () => {
      toast.success("配置已删除，配置值与历史快照中的可恢复内容已清除");
      setSettingDeleteTarget(null);
      setSettingForm(current => current.id ? EMPTY_SETTING_FORM : current);
      setSelectedSettingId(undefined);
      await Promise.all([settings.refetch(), settingHistory.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeMasterData = trpc.admin.masterData.remove.useMutation({
    onSuccess: async result => {
      const target = masterDataDeleteTarget;
      toast.success(result.operation === "revoked" ? "角色授权已撤销并保留可追溯历史" : `${target?.label ?? "主数据"}已安全删除`);
      setMasterDataDeleteTarget(null);
      if (target?.resource === "organization") setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      if (target?.resource === "position") setPositionForm(EMPTY_POSITION_FORM);
      if (target?.resource === "project") setProjectForm(EMPTY_PROJECT_FORM);
      if (target?.resource === "vehicle") setVehicleForm(EMPTY_VEHICLE_FORM);
      if (target?.resource === "role") setRoleForm(EMPTY_ROLE_FORM);
      await Promise.all([organizations.refetch(), positions.refetch(), projects.refetch(), vehicles.refetch(), roles.refetch(), assignments.refetch(), departmentScopes.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const rollbackSetting = trpc.admin.settings.rollback.useMutation({
    onSuccess: async result => {
      toast.success(`配置已回滚并发布为 v${result.version}`);
      await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const savePermissions = trpc.admin.role.setPermissions.useMutation({
    onSuccess: async () => {
      toast.success("角色权限矩阵已更新");
      await rolePermissionIds.refetch();
    },
  });
  const createBackup = trpc.admin.backup.create.useMutation({
    onSuccess: async backup => {
      toast.success(`业务数据逻辑备份已归档：${backup.recordCount} 条记录`);
      await Promise.all([backups.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const downloadBackup = trpc.admin.backup.download.useMutation({
    onSuccess: async backup => {
      const anchor = document.createElement("a");
      anchor.href = backup.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.download = backup.fileName;
      anchor.click();
      toast.success("已生成受控下载链接，下载行为已记录审计");
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const transitionConstructionReport = trpc.construction.transitionReport.useMutation({
    onSuccess: async () => {
      toast.success("施工日报状态已更新");
      await Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveConstructionReport = trpc.construction.saveReport.useMutation({
    onSuccess: async result => {
      toast.success(result.created ? "施工日报已在 PC 后台保存" : "施工日报已在 PC 后台更新");
      setConstructionReportEditor(null);
      await Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const submitPayroll = trpc.labor.payroll.submit.useMutation({
    onSuccess: async () => {
      toast.success("工资条已提交会计审核");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const approvePayroll = trpc.labor.payroll.approve.useMutation({
    onSuccess: async () => {
      toast.success("工资条审核状态已更新");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const payPayroll = trpc.labor.payroll.pay.useMutation({
    onSuccess: async () => {
      toast.success("工资条已确认发放");
      setPayrollPaymentTarget(null);
      setPaymentReference("");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const transitionMachineCost = trpc.machinery.transitionCost.useMutation({
    onSuccess: async () => {
      toast.success("机械成本状态已更新");
      await machineCosts.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const transitionTransportTrip = trpc.transport.transitionTrip.useMutation({
    onSuccess: async () => {
      toast.success("运输趟次状态已更新");
      await transportTrips.refetch();
    },
    onError: error => toast.error(error.message),
  });

  // 按功能模块分组展示权限，避免管理员在长列表中难以辨识业务归属。
  const permissionGroups = useMemo(() => {
    const grouped: Record<string, Array<NonNullable<typeof permissions.data>[number]>> = {};
    for (const permission of permissions.data ?? []) {
      (grouped[permission.module] ??= []).push(permission);
    }
    return Object.entries(grouped);
  }, [permissions.data]);
  const departmentNodes = useMemo(
    () => (organizations.data ?? []).filter(item => item.type === "department" || item.type === "project_department"),
    [organizations.data],
  );
  const departmentScopePickerState = getDepartmentScopePickerState(organizations.isLoading, departmentNodes.length);
  const organizationNameById = useMemo(
    () => new Map((organizations.data ?? []).map(item => [item.id, item.name])),
    [organizations.data],
  );
  const userNameById = useMemo(
    () => new Map((users.data ?? []).map(user => [user.id, user.name || `用户 #${user.id}`])),
    [users.data],
  );
  const selectedAssignmentRole = useMemo(
    () => roles.data?.find(role => role.id === Number(assignmentForm.roleId)),
    [assignmentForm.roleId, roles.data],
  );
  const selectedAssignmentTemplate = useMemo(
    () => roleTemplates.data?.find(template => template.roleId === Number(assignmentForm.roleId)) ?? null,
    [assignmentForm.roleId, roleTemplates.data],
  );
  const groupedRoleTemplates = useMemo(() => {
    const grouped: Record<string, NonNullable<typeof roleTemplates.data>> = {};
    for (const template of roleTemplates.data ?? []) {
      if (template.code === "SUPER_ADMIN") continue;
      (grouped[template.group] ??= []).push(template);
    }
    return Object.entries(grouped);
  }, [roleTemplates.data]);
  const assignmentRequiresBusinessScope = Boolean(selectedAssignmentRole && selectedAssignmentRole.code !== "SUPER_ADMIN");
  const assignmentHasScope = Boolean(assignmentForm.organizationId || assignmentForm.projectId);
  const assignmentReady = Boolean(assignmentForm.userId && selectedAssignmentRole && (!assignmentRequiresBusinessScope || assignmentHasScope));
  const normalizedAssignmentScope = getAssignmentScopeSaveInput(assignmentForm);
  const localManagerUsers = useMemo(() => (users.data ?? []).filter(user => user.loginMethod === "local_manager"), [users.data]);
  const filteredLocalManagerUsers = useMemo(() => {
    const keyword = personnelSearch.trim().toLowerCase();
    if (!keyword) return localManagerUsers;
    return localManagerUsers.filter(user => `${user.name ?? ""} ${user.localUsername ?? ""}`.toLowerCase().includes(keyword));
  }, [localManagerUsers, personnelSearch]);
  const filteredAssignments = useMemo(() => {
    const keyword = assignmentSearch.trim().toLowerCase();
    const rows = assignments.data ?? [];
    if (!keyword) return rows;
    return rows.filter(item => `${item.userName ?? ""} ${item.localUsername ?? ""} ${item.roleName} ${item.roleCode} ${item.organizationName ?? ""} ${item.projectName ?? ""}`.toLowerCase().includes(keyword));
  }, [assignmentSearch, assignments.data]);
  const activeAssignmentCount = useMemo(() => (assignments.data ?? []).filter(item => getAssignmentLifecycle(item).label === "有效").length, [assignments.data]);

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#203c48]">统一管理入口 · 全局治理</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">系统治理概览</h1>
        <p className="mt-2 text-sm text-slate-500">此处仅展示配置与治理对象，施工生产数据在移动业务工作台按岗位办理。</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="组织节点" value={overview.data?.organizations} description="部门、班组与成本中心" icon={Building2} />
        <MetricCard title="项目层级" value={overview.data?.projects} description="项目、标段、工区与作业面" icon={FolderKanban} />
        <MetricCard title="角色数量" value={overview.data?.roles} description="可分配的后台和业务角色" icon={ShieldCheck} />
        <MetricCard title="配置项" value={overview.data?.settings} description="接口、密钥与业务参数" icon={KeyRound} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">上线前治理清单</CardTitle>
          <CardDescription>按以下顺序完成基础配置，避免业务账号、项目范围和外部接口出现无主状态。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">01 组织与项目</b><p className="mt-1 text-xs leading-5">建立公司、部门、项目、标段和成本中心。</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">02 人员与角色</b><p className="mt-1 text-xs leading-5">设置岗位、角色、项目数据范围和有效期。</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">03 系统设置</b><p className="mt-1 text-xs leading-5">配置微信公众号服务号及外部 API，校验后发布。</p></div>
        </CardContent>
      </Card>
      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">真实项目数据验收预检</CardTitle>
            <CardDescription>仅统计授权与业务记录数量，不读取或展示人员、考勤、工资明细；不会创建任何模拟数据。</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => realDataReadiness.refetch()} disabled={realDataReadiness.isFetching}>刷新预检</Button>
        </CardHeader>
        <CardContent>
          {realDataReadiness.isLoading ? <EmptyState text="正在读取真实数据验收准备度…" /> : realDataReadiness.isError ? <EmptyState text="暂无法读取验收预检，请确认当前账号具有超级管理员权限并稍后重试。" /> : realDataReadiness.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <div><p className="text-sm font-medium text-slate-800">{realDataReadiness.data.ready ? "已具备完整复测前提" : "尚未具备完整复测前提"}</p><p className="mt-1 text-xs text-slate-500">真实项目验收应使用已授权账号和可追溯业务记录完成，不能以模拟数据替代。</p></div>
                <Badge variant={realDataReadiness.data.ready ? "secondary" : "outline"}>{realDataReadiness.data.ready ? "可安排复测" : "待补齐真实数据"}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {realDataReadiness.data.checks.map(check => <div key={check.key} className={`rounded-lg border p-3 ${check.ready ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100 bg-amber-50/40"}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{check.label}</p><Badge variant={check.ready ? "secondary" : "outline"}>{check.ready ? "已就绪" : "待补齐"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-500">{check.detail}</p></div>)}
              </div>
            </div>
          ) : <EmptyState text="暂无预检结果，请刷新后重试。" />}
        </CardContent>
      </Card>
    </div>
  );

  const renderOrganization = () => {
    const submitOrganization = () => {
      if (!organizationForm.code.trim() || !organizationForm.name.trim()) return toast.error("请填写组织编码和组织名称");
      saveOrganization.mutate({
        id: organizationForm.id,
        parentId: organizationForm.parentId ? Number(organizationForm.parentId) : null,
        code: organizationForm.code.trim(),
        name: organizationForm.name.trim(),
        type: organizationForm.type,
        managerUserId: organizationForm.managerUserId ? Number(organizationForm.managerUserId) : null,
        costCenterCode: organizationForm.costCenterCode.trim() || null,
        sortOrder: Number(organizationForm.sortOrder || 0),
        status: organizationForm.status,
      });
    };
    const submitProject = () => {
      if (!projectForm.code.trim() || !projectForm.name.trim() || !projectForm.nodeType.trim()) return toast.error("请填写项目编码、名称和层级名称");
      saveProject.mutate({
        id: projectForm.id,
        parentId: projectForm.parentId ? Number(projectForm.parentId) : null,
        organizationId: projectForm.organizationId ? Number(projectForm.organizationId) : null,
        code: projectForm.code.trim(),
        name: projectForm.name.trim(),
        nodeType: projectForm.nodeType.trim(),
        projectType: projectForm.projectType,
        status: projectForm.status,
        startDate: projectForm.startDate || null,
        endDate: projectForm.endDate || null,
        costCenterCode: projectForm.costCenterCode.trim() || null,
        sortOrder: Number(projectForm.sortOrder || 0),
      });
    };
    const submitPosition = () => {
      if (!positionForm.code.trim() || !positionForm.name.trim() || !positionForm.category.trim()) return toast.error("请填写岗位编码、名称和分类");
      savePosition.mutate({ id: positionForm.id, code: positionForm.code.trim(), name: positionForm.name.trim(), category: positionForm.category.trim(), description: positionForm.description.trim() || null, status: positionForm.status });
    };
    const editableOrganizationOptions = (organizations.data ?? []).filter(item => item.id !== organizationForm.id);
    const editableProjectOptions = (projects.data ?? []).filter(item => item.id !== projectForm.id);

    return (
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <section className="space-y-6">
          <div>
            <p className="text-sm font-medium text-[#203c48]">基础主数据</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">组织、岗位与项目层级</h1>
            <p className="mt-2 text-sm text-slate-500">统一维护管理部门、负责人、岗位、项目范围和状态；所有保存均由超级管理员鉴权并写入审计。</p>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">组织架构</CardTitle><CardDescription>支持集团、公司、部门、项目部和班组层级。点击条目即可在右侧维护。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {organizations.data?.length ? organizations.data.map(item => (
                <button key={item.id} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setOrganizationForm({ id: item.id, parentId: item.parentId ? String(item.parentId) : "", code: item.code, name: item.name, type: item.type, managerUserId: item.managerUserId ? String(item.managerUserId) : "", costCenterCode: item.costCenterCode ?? "", sortOrder: String(item.sortOrder), status: item.status })}>
                  <div><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · 上级：{item.parentId ? organizationNameById.get(item.parentId) ?? `#${item.parentId}` : "顶级"} · 负责人：{item.managerUserId ? userNameById.get(item.managerUserId) ?? `#${item.managerUserId}` : "未设置"} · 成本中心：{item.costCenterCode || "未设置"}</p></div>
                  <Badge variant={item.status === "active" ? "secondary" : "outline"}>{item.status === "active" ? "启用" : "停用"}</Badge>
                </button>
              )) : <EmptyState text="暂无组织节点，请在右侧新增后开始维护。" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">岗位字典</CardTitle><CardDescription>岗位用于人员档案与职责管理，不直接替代角色权限。</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {positions.data?.length ? positions.data.map(item => <button key={item.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setPositionForm({ id: item.id, code: item.code, name: item.name, category: item.category, description: item.description ?? "", status: item.status })}>{item.name}<span className="ml-1 text-xs text-slate-400">{item.category} · {item.status === "active" ? "启用" : "停用"}</span></button>) : <EmptyState text="暂无自定义岗位；请在右侧新增后再为人员分配。" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">项目层级</CardTitle><CardDescription>推荐“项目 → 标段/工区 → 单位工程 → 施工段/作业面”；点击条目可维护归属、计划日期和状态。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {projects.data?.length ? projects.data.map(item => <button key={item.id} className="w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setProjectForm({ id: item.id, parentId: item.parentId ? String(item.parentId) : "", organizationId: item.organizationId ? String(item.organizationId) : "", code: item.code, name: item.name, nodeType: item.nodeType, projectType: item.projectType ?? "other", status: item.status, startDate: item.startDate ? new Date(item.startDate).toISOString().slice(0, 10) : "", endDate: item.endDate ? new Date(item.endDate).toISOString().slice(0, 10) : "", costCenterCode: item.costCenterCode ?? "", sortOrder: String(item.sortOrder) })}><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · {item.nodeType} · 上级：{item.parentId ? projects.data?.find(project => project.id === item.parentId)?.name ?? `#${item.parentId}` : "顶级"} · {item.status}</p></button>) : <EmptyState text="暂无项目层级，请在右侧新增项目或项目节点。" />}
            </CardContent>
          </Card>
        </section>
        <aside className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{organizationForm.id ? "维护组织节点" : "新增组织节点"}</CardTitle>{organizationForm.id ? <Button size="sm" variant="ghost" onClick={() => setOrganizationForm(EMPTY_ORGANIZATION_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div><Label>组织编码</Label><Input value={organizationForm.code} placeholder="例如 DEPT_FIN" onChange={event => setOrganizationForm({ ...organizationForm, code: event.target.value.toUpperCase() })} /></div>
              <div><Label>组织名称</Label><Input value={organizationForm.name} placeholder="例如 财务部" onChange={event => setOrganizationForm({ ...organizationForm, name: event.target.value })} /></div>
              <div><Label>上级组织</Label><Select value={organizationForm.parentId || "ROOT"} onValueChange={value => setOrganizationForm({ ...organizationForm, parentId: value === "ROOT" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ROOT">顶级节点</SelectItem>{editableOrganizationOptions.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>节点类型</Label><Select value={organizationForm.type} onValueChange={(value: OrganizationType) => setOrganizationForm({ ...organizationForm, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="group">集团</SelectItem><SelectItem value="company">公司</SelectItem><SelectItem value="department">部门</SelectItem><SelectItem value="project_department">项目部</SelectItem><SelectItem value="team">班组</SelectItem></SelectContent></Select></div>
              <div><Label>组织负责人</Label><Select value={organizationForm.managerUserId || "UNASSIGNED"} onValueChange={value => setOrganizationForm({ ...organizationForm, managerUserId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>成本中心</Label><Input value={organizationForm.costCenterCode} placeholder="可选" onChange={event => setOrganizationForm({ ...organizationForm, costCenterCode: event.target.value.toUpperCase() })} /></div><div><Label>排序</Label><Input type="number" min="0" value={organizationForm.sortOrder} onChange={event => setOrganizationForm({ ...organizationForm, sortOrder: event.target.value })} /></div></div>
              <div><Label>状态</Label><Select value={organizationForm.status} onValueChange={(value: OrganizationStatus) => setOrganizationForm({ ...organizationForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!organizationForm.code || !organizationForm.name || saveOrganization.isPending} onClick={submitOrganization}>{organizationForm.id ? "保存组织变更" : "保存组织节点"}</Button>{organizationForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "organization", id: organizationForm.id!, label: organizationForm.name, description: `确认删除组织“${organizationForm.name}”？若仍被下级节点、人员、项目、车辆、授权或部门业务范围引用，系统将拒绝删除并要求先迁移或停用。` })}>删除组织</Button> : null}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{projectForm.id ? "维护项目节点" : "新增项目节点"}</CardTitle>{projectForm.id ? <Button size="sm" variant="ghost" onClick={() => setProjectForm(EMPTY_PROJECT_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div><Label>项目编码</Label><Input value={projectForm.code} placeholder="例如 GZ-GS-01" onChange={event => setProjectForm({ ...projectForm, code: event.target.value.toUpperCase() })} /></div>
              <div><Label>项目名称</Label><Input value={projectForm.name} placeholder="例如 GZ 高速一标段" onChange={event => setProjectForm({ ...projectForm, name: event.target.value })} /></div>
              <div><Label>上级项目</Label><Select value={projectForm.parentId || "ROOT"} onValueChange={value => setProjectForm({ ...projectForm, parentId: value === "ROOT" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ROOT">顶级项目</SelectItem>{editableProjectOptions.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>归属组织</Label><Select value={projectForm.organizationId || "UNASSIGNED"} onValueChange={value => setProjectForm({ ...projectForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{organizations.data?.filter(item => item.status === "active").map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>层级名称</Label><Input value={projectForm.nodeType} onChange={event => setProjectForm({ ...projectForm, nodeType: event.target.value })} /></div><div><Label>工程类型</Label><Select value={projectForm.projectType} onValueChange={(value: ProjectType) => setProjectForm({ ...projectForm, projectType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="highway">公路</SelectItem><SelectItem value="railway">铁路</SelectItem><SelectItem value="municipal">市政</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>开始日期</Label><Input type="date" value={projectForm.startDate} onChange={event => setProjectForm({ ...projectForm, startDate: event.target.value })} /></div><div><Label>结束日期</Label><Input type="date" value={projectForm.endDate} onChange={event => setProjectForm({ ...projectForm, endDate: event.target.value })} /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>成本中心</Label><Input value={projectForm.costCenterCode} placeholder="可选" onChange={event => setProjectForm({ ...projectForm, costCenterCode: event.target.value.toUpperCase() })} /></div><div><Label>排序</Label><Input type="number" min="0" value={projectForm.sortOrder} onChange={event => setProjectForm({ ...projectForm, sortOrder: event.target.value })} /></div></div>
              <div><Label>状态</Label><Select value={projectForm.status} onValueChange={(value: ProjectStatus) => setProjectForm({ ...projectForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planning">筹备</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="completed">已完工</SelectItem><SelectItem value="archived">已归档</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!projectForm.code || !projectForm.name || !projectForm.nodeType || saveProject.isPending} onClick={submitProject}>{projectForm.id ? "保存项目变更" : "保存项目节点"}</Button>{projectForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "project", id: projectForm.id!, label: projectForm.name, description: `确认删除项目节点“${projectForm.name}”？若仍有下级项目、授权、资源或业务单据，系统将拒绝删除并提示改为归档。` })}>删除项目</Button> : null}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{positionForm.id ? "维护岗位" : "新增岗位"}</CardTitle>{positionForm.id ? <Button size="sm" variant="ghost" onClick={() => setPositionForm(EMPTY_POSITION_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3"><div><Label>岗位编码</Label><Input value={positionForm.code} placeholder="例如 TRANSPORT_MANAGER" onChange={event => setPositionForm({ ...positionForm, code: event.target.value.toUpperCase() })} /></div><div><Label>岗位名称</Label><Input value={positionForm.name} placeholder="例如 运输主管" onChange={event => setPositionForm({ ...positionForm, name: event.target.value })} /></div><div><Label>岗位分类</Label><Input value={positionForm.category} placeholder="例如 业务岗位" onChange={event => setPositionForm({ ...positionForm, category: event.target.value })} /></div><div><Label>职责说明</Label><Input value={positionForm.description} placeholder="可选" onChange={event => setPositionForm({ ...positionForm, description: event.target.value })} /></div><div><Label>状态</Label><Select value={positionForm.status} onValueChange={(value: OrganizationStatus) => setPositionForm({ ...positionForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!positionForm.code || !positionForm.name || !positionForm.category || savePosition.isPending} onClick={submitPosition}>{positionForm.id ? "保存岗位变更" : "保存岗位"}</Button>{positionForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "position", id: positionForm.id!, label: positionForm.name, description: `确认删除岗位“${positionForm.name}”？若仍被人员档案引用，系统将拒绝删除并提示改为停用。` })}>删除岗位</Button> : null}</div></CardContent>
          </Card>
        </aside>
      </div>
    );
  };

  const renderVehicles = () => {
    const vehicleTypeLabel: Record<VehicleType, string> = { dump_truck: "渣土车", tractor: "牵引车", mixer: "搅拌车", flatbed: "平板车", other: "其他" };
    const vehicleStatusLabel: Record<VehicleStatus, string> = { active: "可调度", suspended: "暂停", disabled: "停用" };
    const vehicleStatusClass: Record<VehicleStatus, string> = { active: "bg-emerald-50 text-emerald-700", suspended: "bg-amber-50 text-amber-700", disabled: "bg-slate-100 text-slate-600" };
    const rows = vehicles.data ?? [];
    const submitVehicle = () => {
      if (!vehicleForm.projectId || !vehicleForm.plateNo.trim()) return toast.error("请填写车辆归属项目和车牌号");
      if (!vehicleForm.boxLengthMeters || !vehicleForm.boxWidthMeters || !vehicleForm.boxHeightMeters) return toast.error("请填写货厢长、宽、高");
      if (vehicleForm.ownership === "leased" && (!vehicleForm.ownerName.trim() || !vehicleForm.leaseRate || !vehicleForm.leaseStartDate)) return toast.error("外租车辆必须填写出租方、租金和起租日期");
      saveVehicle.mutate({
        id: vehicleForm.id,
        projectId: Number(vehicleForm.projectId),
        organizationId: vehicleForm.organizationId ? Number(vehicleForm.organizationId) : null,
        plateNo: vehicleForm.plateNo.trim(),
        vehicleType: vehicleForm.vehicleType,
        ownership: vehicleForm.ownership,
        ownerName: vehicleForm.ownerName.trim() || null,
        driverUserId: vehicleForm.driverUserId ? Number(vehicleForm.driverUserId) : null,
        boxLengthMeters: Number(vehicleForm.boxLengthMeters),
        boxWidthMeters: Number(vehicleForm.boxWidthMeters),
        boxHeightMeters: Number(vehicleForm.boxHeightMeters),
        loadFactor: Number(vehicleForm.loadFactor || 1),
        payloadTons: vehicleForm.payloadTons ? Number(vehicleForm.payloadTons) : null,
        status: vehicleForm.status,
        leaseTerms: vehicleForm.ownership === "leased" ? { billingType: vehicleForm.leaseBillingType, rate: Number(vehicleForm.leaseRate), effectiveFrom: vehicleForm.leaseStartDate, effectiveTo: vehicleForm.leaseEndDate || null } : null,
      });
    };
    const openVehicle = (item: NonNullable<typeof vehicles.data>[number]) => setVehicleForm({
      id: item.id,
      projectId: String(item.projectId),
      organizationId: item.organizationId ? String(item.organizationId) : "",
      plateNo: item.plateNo,
      vehicleType: item.vehicleType,
      ownership: item.ownership,
      ownerName: item.ownerName ?? "",
      driverUserId: item.driverUserId ? String(item.driverUserId) : "",
      boxLengthMeters: String(item.boxLengthMeters),
      boxWidthMeters: String(item.boxWidthMeters),
      boxHeightMeters: String(item.boxHeightMeters),
      loadFactor: String(item.loadFactor),
      payloadTons: item.payloadTons ? String(item.payloadTons) : "",
      status: item.status,
      leaseBillingType: item.leaseTerms?.billingType ?? "monthly",
      leaseRate: item.leaseTerms?.rate ? String(item.leaseTerms.rate) : "",
      leaseStartDate: item.leaseTerms?.effectiveFrom ? toLocalDateInput(item.leaseTerms.effectiveFrom) : "",
      leaseEndDate: item.leaseTerms?.effectiveTo ? toLocalDateInput(item.leaseTerms.effectiveTo) : "",
    });
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-[#203c48]">资源与运输治理</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">车辆统一台账</h1><p className="mt-2 text-sm text-slate-500">与移动运输端使用同一车辆数据源。超级管理员可维护归属、司机、货厢参数和启停状态；已存在未结算趟次的车辆不能直接停用。</p></div><Button variant="outline" onClick={() => { setVehicleForm(EMPTY_VEHICLE_FORM); void vehicles.refetch(); }}><Truck className="mr-2 h-4 w-4" />新建或刷新</Button></div>
        <section className="grid gap-3 sm:grid-cols-3"><MetricCard title="车辆总数" value={rows.length} description="运输车辆唯一台账" icon={Truck} /><MetricCard title="可调度" value={rows.filter(item => item.status === "active").length} description="可用于新建运输趟次" icon={ShieldCheck} /><MetricCard title="暂停或停用" value={rows.filter(item => item.status !== "active").length} description="需先处理未结算趟次" icon={ScrollText} /></section>
        <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">车辆资源列表</CardTitle><CardDescription>点击一辆车即可在右侧编辑。系统不会创建演示车辆或模拟运输记录。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {rows.length ? rows.map(item => <button key={item.id} className="flex w-full flex-col gap-2 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9] sm:flex-row sm:items-center sm:justify-between" onClick={() => openVehicle(item)}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-800">{item.plateNo}</p><Badge variant="outline">{vehicleTypeLabel[item.vehicleType]}</Badge><Badge className={vehicleStatusClass[item.status]}>{vehicleStatusLabel[item.status]}</Badge></div><p className="mt-1 truncate text-xs text-slate-500">项目：{projects.data?.find(project => project.id === item.projectId)?.name ?? `#${item.projectId}`} · 所属单位：{item.organizationId ? organizationNameById.get(item.organizationId) ?? `#${item.organizationId}` : "未设置"} · 司机：{item.driverUserId ? userNameById.get(item.driverUserId) ?? `#${item.driverUserId}` : "未分配"}</p><p className="mt-1 text-xs text-slate-500">货厢 {item.boxLengthMeters} × {item.boxWidthMeters} × {item.boxHeightMeters} m · 装载系数 {item.loadFactor} · 理论方量 {item.theoreticalVolumeCubicMeters} m³ · 核定载重 {item.payloadTons ?? "—"} t</p></div><span className="text-xs font-medium text-[#203c48]">编辑台账</span></button>) : <EmptyState text="尚无真实车辆台账。请使用右侧表单录入已授权项目的真实车辆资料。" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">{vehicleForm.id ? "维护车辆档案" : "新增车辆档案"}</CardTitle><CardDescription>车牌全局唯一，理论方量由服务端计算；车辆、司机、项目、调度状态与 RFID 卡均在 PC 后台关联维护。</CardDescription></div>{vehicleForm.id ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `车辆档案 · ${vehicleForm.plateNo}`, description: "车辆档案由超级管理后台统一维护。已有运输趟次的车辆不可删除，应改为暂停或停用以保留运输责任链。", fields: [{ label: "所属项目", value: projects.data?.find(project => String(project.id) === vehicleForm.projectId)?.name ?? `#${vehicleForm.projectId}` }, { label: "车辆类型", value: vehicleTypeLabel[vehicleForm.vehicleType] }, { label: "产权/所属人", value: vehicleForm.ownerName || "未登记" }, { label: "绑定司机", value: vehicleForm.driverUserId ? userNameById.get(Number(vehicleForm.driverUserId)) ?? `用户 #${vehicleForm.driverUserId}` : "未分配" }, { label: "货厢尺寸", value: `${vehicleForm.boxLengthMeters} × ${vehicleForm.boxWidthMeters} × ${vehicleForm.boxHeightMeters} m` }, { label: "装载系数", value: vehicleForm.loadFactor }, { label: "核定载重", value: vehicleForm.payloadTons ? `${vehicleForm.payloadTons} t` : "未登记" }, { label: "调度状态", value: <Badge className={vehicleStatusClass[vehicleForm.status]}>{vehicleStatusLabel[vehicleForm.status]}</Badge> }] })}>查看详情</Button><Button size="sm" variant="outline" onClick={() => { setBusinessWorkspaceProjectId(vehicleForm.projectId); setLocation("/admin/transport"); }}>运输调度</Button><Button size="sm" variant="outline" onClick={() => { setBusinessWorkspaceProjectId(vehicleForm.projectId); setLocation("/admin/transport"); }}>RFID 写卡</Button><Button size="sm" variant="ghost" onClick={() => setVehicleForm(EMPTY_VEHICLE_FORM)}>新建</Button></div> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3"><div><Label>车牌号</Label><Input value={vehicleForm.plateNo} placeholder="例如 粤A12345" onChange={event => setVehicleForm({ ...vehicleForm, plateNo: event.target.value.toUpperCase() })} /></div><div><Label>车辆类型</Label><Select value={vehicleForm.vehicleType} onValueChange={(value: VehicleType) => setVehicleForm({ ...vehicleForm, vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dump_truck">渣土车</SelectItem><SelectItem value="tractor">牵引车</SelectItem><SelectItem value="mixer">搅拌车</SelectItem><SelectItem value="flatbed">平板车</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div></div>
              <div><Label>归属项目</Label><Select value={vehicleForm.projectId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, projectId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue placeholder="选择有效项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>所属单位</Label><Select value={vehicleForm.organizationId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{organizations.data?.filter(item => item.status === "active").map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-3 sm:grid-cols-3"><div><Label>资源性质</Label><Select value={vehicleForm.ownership} onValueChange={value => setVehicleForm({ ...vehicleForm, ownership: value as "owned" | "leased" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租车辆</SelectItem></SelectContent></Select></div><div><Label>{vehicleForm.ownership === "leased" ? "出租方" : "产权/所属人"}</Label><Input value={vehicleForm.ownerName} placeholder={vehicleForm.ownership === "leased" ? "外租必填" : "可选"} onChange={event => setVehicleForm({ ...vehicleForm, ownerName: event.target.value })} /></div><div><Label>绑定司机</Label><Select value={vehicleForm.driverUserId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, driverUserId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不分配</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>货厢长(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxLengthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxLengthMeters: event.target.value })} /></div><div><Label>货厢宽(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxWidthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxWidthMeters: event.target.value })} /></div><div><Label>货厢高(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxHeightMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxHeightMeters: event.target.value })} /></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>装载系数</Label><Input type="number" min="0.001" max="1.5" step="0.001" value={vehicleForm.loadFactor} onChange={event => setVehicleForm({ ...vehicleForm, loadFactor: event.target.value })} /></div><div><Label>核定载重(t)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.payloadTons} placeholder="可选" onChange={event => setVehicleForm({ ...vehicleForm, payloadTons: event.target.value })} /></div><div><Label>调度状态</Label><Select value={vehicleForm.status} onValueChange={(value: VehicleStatus) => setVehicleForm({ ...vehicleForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div></div>
              {vehicleForm.ownership === "leased" ? <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div><p className="text-sm font-semibold text-amber-950">外租合同与租金</p><p className="mt-1 text-xs text-amber-800">租金和租期会同步到车辆租赁规则；自有车辆不录入该项。</p></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>计费方式</Label><Select value={vehicleForm.leaseBillingType} onValueChange={value => setVehicleForm({ ...vehicleForm, leaseBillingType: value as LeaseBillingType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></div><div><Label>租金（元）</Label><Input type="number" min="0.01" step="0.01" value={vehicleForm.leaseRate} placeholder="外租必填" onChange={event => setVehicleForm({ ...vehicleForm, leaseRate: event.target.value })} /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>起租日期</Label><Input type="date" value={vehicleForm.leaseStartDate} onChange={event => setVehicleForm({ ...vehicleForm, leaseStartDate: event.target.value })} /></div><div><Label>截止日期</Label><Input type="date" min={vehicleForm.leaseStartDate || undefined} value={vehicleForm.leaseEndDate} onChange={event => setVehicleForm({ ...vehicleForm, leaseEndDate: event.target.value })} /></div></div></section> : null}
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!vehicleForm.projectId || !vehicleForm.plateNo || !vehicleForm.boxLengthMeters || !vehicleForm.boxWidthMeters || !vehicleForm.boxHeightMeters || (vehicleForm.ownership === "leased" && (!vehicleForm.ownerName || !vehicleForm.leaseRate || !vehicleForm.leaseStartDate)) || saveVehicle.isPending} onClick={submitVehicle}>{vehicleForm.id ? "保存车辆变更" : "保存车辆档案"}</Button>{vehicleForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "vehicle", id: vehicleForm.id!, label: vehicleForm.plateNo, description: `确认删除车辆“${vehicleForm.plateNo}”？已有运输趟次的车辆不可删除，应改为停用以保留责任链。` })}>删除车辆</Button> : null}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderPermissions = () => (
    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <section className="space-y-4">
        <div><p className="text-sm font-medium text-[#203c48]">人员与授权</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">人员、角色与数据范围</h1><p className="mt-2 text-sm text-slate-500">先维护账号与岗位，再以部门或具体项目配置数据范围；所有实际访问均由服务端按角色状态、有效期和范围实时裁决。</p></div>
        <div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">普通管理账号</p><p className="mt-1 text-2xl font-semibold text-slate-800">{localManagerUsers.length}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">账号已启用</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{localManagerUsers.filter(user => user.localAccountStatus === "active").length}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">当前有效授权</p><p className="mt-1 text-2xl font-semibold text-[#203c48]">{activeAssignmentCount}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">待关注绑定</p><p className="mt-1 text-2xl font-semibold text-amber-700">{localManagerUsers.filter(user => user.profileStatus !== "active").length}</p></div></div>
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">高级治理：岗位字典与自定义角色</summary>
          <p className="mt-1 text-xs leading-5 text-slate-500">日常授权请使用右侧的“人员—岗位模板—范围—有效期”流程；仅在维护自定义岗位时展开。</p>
          <div className="mt-3 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">角色列表</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {roles.data?.map(role => <button key={role.id} className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedRoleId === role.id ? "border-[#203c48] bg-[#edf4f1]" : "border-slate-100 hover:bg-slate-50"}`} onClick={() => { setSelectedRoleId(role.id); setRoleForm(role.isSystem ? EMPTY_ROLE_FORM : { id: role.id, code: role.code, name: role.name, category: role.category, description: role.description ?? "", status: role.status, isSystem: role.isSystem }); }}><p className="text-sm font-medium">{role.name}</p><p className="mt-0.5 text-xs text-slate-500">{role.code} · {role.category === "system" ? "系统角色" : "业务角色"} · {role.status === "active" ? "启用" : "停用"}</p></button>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{roleForm.id ? "维护业务角色" : "新增业务角色"}</CardTitle>{roleForm.id ? <Button size="sm" variant="ghost" onClick={() => setRoleForm(EMPTY_ROLE_FORM)}>新建</Button> : null}</CardHeader>
          <CardContent className="space-y-3">
            <Input value={roleForm.code} placeholder="角色编码，例如 CONTRACT_MANAGER" onChange={event => setRoleForm({ ...roleForm, code: event.target.value.toUpperCase() })} />
            <Input value={roleForm.name} placeholder="角色名称" onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} />
            <Input value={roleForm.description} placeholder="职责说明（可选）" onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} />
            <Select value={roleForm.status} onValueChange={(value: OrganizationStatus) => setRoleForm({ ...roleForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select>
            <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!roleForm.code || !roleForm.name || saveRole.isPending} onClick={() => { const { isSystem, ...input } = roleForm; saveRole.mutate(input); }}>{roleForm.id ? "保存角色变更" : "保存角色"}</Button>{roleForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "role", id: roleForm.id!, label: roleForm.name, description: `确认删除自定义角色“${roleForm.name}”？系统内置角色和已有授权历史的角色不可删除，应改为停用并撤销现有授权。` })}>删除角色</Button> : null}</div>
          </CardContent>
        </Card>
          </div>
        </details>
      </section>
      <section className="space-y-4">
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">高级治理：权限矩阵与部门业务开关</summary>
          <p className="mt-1 text-xs leading-5 text-slate-500">岗位模板已说明标准职责。仅在维护角色权限矩阵或启停部门业务模块时展开。</p>
          <div className="mt-3 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">权限分配</CardTitle><CardDescription>选择角色后勾选其可操作的后台及移动端权限；保存后对下一次请求即时生效。</CardDescription></CardHeader>
          <CardContent>
            {selectedRoleId === undefined ? <EmptyState text="正在加载可分配角色…" /> : (
              <div className="space-y-5">
                {permissionGroups.map(([module, items]) => (
                  <div key={module}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{module}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {items.map(permission => (
                        <label key={permission.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                          <Checkbox checked={draftPermissionIds.includes(permission.id)} onCheckedChange={checked => setDraftPermissionIds(current => checked ? Array.from(new Set([...current, permission.id])) : current.filter(id => id !== permission.id))} />
                          <span><span className="block text-sm font-medium text-slate-700">{permission.name}</span><span className="block text-xs text-slate-400">{permission.code}</span></span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={savePermissions.isPending} onClick={() => selectedRoleId && savePermissions.mutate({ roleId: selectedRoleId, permissionIds: draftPermissionIds })}>保存当前角色权限</Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">部门可办理业务</CardTitle><CardDescription>先为部门或项目部启用业务模块，再向人员授予该部门角色。服务端会同时校验角色、部门模块和项目范围。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Select value={departmentScopeForm.organizationId} disabled={departmentScopePickerState.disabled} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, organizationId: value })}><SelectTrigger><SelectValue placeholder={departmentScopePickerState.placeholder} /></SelectTrigger><SelectContent>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select>
              <Select value={departmentScopeForm.module} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, module: value as DepartmentModuleCode })}><SelectTrigger><SelectValue placeholder="选择业务模块" /></SelectTrigger><SelectContent>{departmentModules.data?.map(module => <SelectItem key={module.code} value={module.code}>{module.name}</SelectItem>)}</SelectContent></Select>
              <Button disabled={!departmentScopeForm.organizationId || !departmentScopeForm.module || saveDepartmentScope.isPending} onClick={() => { if (departmentScopeForm.module) saveDepartmentScope.mutate({ organizationId: Number(departmentScopeForm.organizationId), module: departmentScopeForm.module, status: "active" }); }}>启用业务</Button>
            </div>
            {departmentScopePickerState.needsOrganizationSetup ? <div className="flex flex-col gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-amber-950">尚无可选择的部门或项目部</p><p className="mt-1 text-xs leading-5 text-amber-800">请先在“组织与项目”中新增类型为“部门”或“项目部”的启用节点；保存后返回本页即可选择并启用业务模块。</p></div><Button variant="outline" className="shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100" onClick={() => setLocation("/admin/organization")}>建立组织节点</Button></div> : null}
            {departmentScopes.data?.length ? <div className="space-y-2">{departmentScopes.data.map(scope => {
              const module = departmentModules.data?.find(item => item.code === scope.module);
              return <div key={scope.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-medium text-slate-800">{scope.organizationName} · {module?.name ?? scope.module}</p><p className="mt-0.5 text-xs text-slate-500">{module?.description ?? "部门业务模块"} · 最后更新：{displayDate(scope.updatedAt)}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saveDepartmentScope.isPending} onClick={() => saveDepartmentScope.mutate({ organizationId: scope.organizationId, module: scope.module, status: scope.status === "active" ? "disabled" : "active" })}>{scope.status === "active" ? "停用" : "启用"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "department_scope", id: scope.id, label: `${scope.organizationName} · ${module?.name ?? scope.module}`, description: `确认删除“${scope.organizationName}”的“${module?.name ?? scope.module}”业务范围？删除后该部门不再拥有该模块入口，可重新启用创建。` })}>删除</Button></div></div>;
            })}</div> : <EmptyState text="尚未配置部门可办理业务。请先建立部门节点，再按实际职责启用业务模块。" />}
          </CardContent>
        </Card>
          </div>
        </details>
        <Card>
          <CardHeader><CardTitle className="text-base">普通管理人员账号</CardTitle><CardDescription>可创建、编辑、重置密码、启停和删除本地登录账号。口令只会生成不可逆摘要；删除会撤销角色授权，且存在业务责任、资源归属或历史单据的账号必须先完成交接。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="local-account-username">登录账号</Label><Input id="local-account-username" autoComplete="off" value={localAccountForm.username} onChange={event => setLocalAccountForm({ ...localAccountForm, username: event.target.value })} placeholder="例如：zhangsan" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-name">显示姓名</Label><Input id="local-account-name" value={localAccountForm.displayName} onChange={event => setLocalAccountForm({ ...localAccountForm, displayName: event.target.value })} placeholder="例如：张三" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-password">初始密码</Label><Input id="local-account-password" type="password" autoComplete="new-password" value={localAccountForm.initialPassword} onChange={event => setLocalAccountForm({ ...localAccountForm, initialPassword: event.target.value })} placeholder="至少 6 位，任意数字或字符" /></div>
              <div className="grid gap-1.5"><Label>初始状态</Label><Select value={localAccountForm.status} onValueChange={value => setLocalAccountForm({ ...localAccountForm, status: value as "active" | "disabled" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>登录方式</Label><Select value={localAccountForm.loginMode} onValueChange={value => setLocalAccountForm({ ...localAccountForm, loginMode: value as LocalLoginMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pc">仅 PC 端</SelectItem><SelectItem value="mobile">仅手机端</SelectItem><SelectItem value="both">PC 端＋手机端</SelectItem></SelectContent></Select><p className="text-xs text-slate-500">服务端按实际请求终端限制，既有会话跨端复用也会被拒绝。</p></div>
              <div className="flex items-end"><Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!localAccountForm.username || !localAccountForm.displayName || !localAccountForm.initialPassword || createLocalUser.isPending} onClick={() => createLocalUser.mutate(localAccountForm)}>{createLocalUser.isPending ? "正在创建…" : "创建普通管理人员"}</Button></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5"><p className="text-xs text-slate-600">账号目录 · {localManagerUsers.length} 人</p><Input className="h-8 w-full sm:w-56" value={personnelSearch} onChange={event => setPersonnelSearch(event.target.value)} placeholder="搜索姓名或登录账号" /></div>
            {localManagerUsers.length ? <div className="space-y-2">{filteredLocalManagerUsers.map(user => {
              const accountTarget = { id: user.id, name: user.name || `用户 #${user.id}`, username: user.localUsername || "" };
              const bindingLabel = user.profileStatus === "active" ? "已完成关注绑定" : user.profileStatus === "disabled" ? "绑定已停用" : "待关注绑定";
              return <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{accountTarget.name}</p><span className="font-mono text-xs text-slate-500">{user.localUsername}</span><Badge variant={user.localAccountStatus === "active" ? "secondary" : "outline"}>{user.localAccountStatus === "active" ? "已启用" : "已停用"}</Badge><Badge variant="outline">登录：{user.localLoginMode === "pc" ? "仅 PC" : user.localLoginMode === "mobile" ? "仅手机" : "双端"}</Badge><Badge variant="outline">公众号：{bindingLabel}</Badge></div><p className="mt-1 text-xs text-slate-500">密码已设置 · 最近登录：{displayDate(user.lastSignedIn)}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setLocalAccountEditForm({ userId: user.id, username: user.localUsername || "", displayName: accountTarget.name, status: user.localAccountStatus, loginMode: user.localLoginMode ?? "both" })}>编辑</Button><Button size="sm" variant="outline" onClick={() => { setPasswordResetTarget(accountTarget); setResetPassword(""); }}>重置密码</Button><Button size="sm" variant="outline" disabled={setLocalUserStatus.isPending} onClick={() => setLocalUserStatus.mutate({ userId: user.id, status: user.localAccountStatus === "active" ? "disabled" : "active" })}>{user.localAccountStatus === "active" ? "停用" : "启用"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setDeleteTarget(accountTarget)}>删除</Button></div></div>;
            })}</div> : <EmptyState text={personnelSearch ? "未找到匹配的普通管理账号。" : "尚未创建普通管理人员本地账号。创建后请在下方继续配置其角色与数据范围。"} />}
          </CardContent>
        </Card>
        <Dialog open={Boolean(localAccountEditForm)} onOpenChange={open => { if (!open) setLocalAccountEditForm(null); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>编辑普通管理人员账号</DialogTitle><DialogDescription>可修改登录账号、显示姓名和启停状态；公众号关注绑定请由员工在移动端个人中心自主完成，角色及数据范围请在下方“管理人员角色授权”中单独维护。</DialogDescription></DialogHeader>
            {localAccountEditForm ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); updateLocalUser.mutate(localAccountEditForm); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor="edit-local-account-username">登录账号</Label><Input id="edit-local-account-username" autoComplete="off" value={localAccountEditForm.username} onChange={event => setLocalAccountEditForm({ ...localAccountEditForm, username: event.target.value })} /><p className="text-xs text-slate-500">以字母开头，可使用小写字母、数字、点、下划线或连字符。</p></div>
                <div className="grid gap-1.5"><Label htmlFor="edit-local-account-name">显示姓名</Label><Input id="edit-local-account-name" value={localAccountEditForm.displayName} onChange={event => setLocalAccountEditForm({ ...localAccountEditForm, displayName: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label>账号状态</Label><Select value={localAccountEditForm.status} onValueChange={value => setLocalAccountEditForm({ ...localAccountEditForm, status: value as LocalAccountStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
                <div className="grid gap-1.5"><Label>登录方式</Label><Select value={localAccountEditForm.loginMode} onValueChange={value => setLocalAccountEditForm({ ...localAccountEditForm, loginMode: value as LocalLoginMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pc">仅 PC 端</SelectItem><SelectItem value="mobile">仅手机端</SelectItem><SelectItem value="both">PC 端＋手机端</SelectItem></SelectContent></Select></div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setLocalAccountEditForm(null)}>取消</Button><Button type="submit" className="bg-[#203c48] hover:bg-[#17313b]" disabled={!localAccountEditForm.username || !localAccountEditForm.displayName || updateLocalUser.isPending}>{updateLocalUser.isPending ? "正在保存…" : "保存修改"}</Button></DialogFooter>
            </form> : null}
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(passwordResetTarget)} onOpenChange={open => { if (!open) { setPasswordResetTarget(null); setResetPassword(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>重置普通管理人员密码</DialogTitle><DialogDescription>正在为“{passwordResetTarget?.name}”设置新密码。新密码至少 6 位，任意数字或字符均可；系统只保存不可逆摘要，设置后不会再次显示。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (passwordResetTarget) resetLocalUserPassword.mutate({ userId: passwordResetTarget.id, newPassword: resetPassword }); }}>
              <div className="grid gap-1.5"><Label htmlFor="reset-local-account-password">新密码</Label><Input id="reset-local-account-password" type="password" autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} placeholder="至少 6 位，任意数字或字符" /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setPasswordResetTarget(null); setResetPassword(""); }}>取消</Button><Button type="submit" className="bg-[#203c48] hover:bg-[#17313b]" disabled={resetPassword.length < 6 || resetLocalUserPassword.isPending}>{resetLocalUserPassword.isPending ? "正在重置…" : "确认重置密码"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>确认删除管理人员账号？</AlertDialogTitle><AlertDialogDescription>将删除“{deleteTarget?.name}（{deleteTarget?.username}）”的本地登录能力，并撤销其角色授权。系统会保留必要审计索引；如账号仍关联业务单据、资源责任或组织负责人信息，服务端会拒绝删除并提示需交接的事项。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" disabled={deleteLocalUser.isPending} onClick={() => { if (deleteTarget) deleteLocalUser.mutate({ userId: deleteTarget.id }); }}>{deleteLocalUser.isPending ? "正在删除…" : "确认删除"}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-medium tracking-wide text-[#467067]">简明授权流程</p><CardTitle className="mt-1 text-base">{assignmentForm.id ? "编辑管理人员授权" : "为人员分配岗位"}</CardTitle><CardDescription className="mt-1">按“1 人员 → 2 岗位模板 → 3 部门或项目 → 4 有效期”完成授权。系统会在每次访问时同时校验岗位、范围、有效期和业务状态。</CardDescription></div>{assignmentForm.id ? <Button size="sm" variant="outline" onClick={() => setAssignmentForm(EMPTY_ASSIGNMENT_FORM)}>取消编辑</Button> : null}</CardHeader>
          <CardContent className="space-y-4">
            <section className="rounded-xl border border-[#d8e3e0] bg-[#f7faf9] p-3">
              <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-sm font-semibold text-[#203c48]">第 2 步：选择行业岗位模板</p><p className="mt-1 text-xs text-slate-500">岗位模板只展示职责摘要；保存时仍写入系统角色并由服务端强制权限边界。</p></div>{selectedAssignmentTemplate ? <Badge variant="secondary">已选：{selectedAssignmentTemplate.name}</Badge> : null}</div>
              {roleTemplates.isLoading ? <p className="py-3 text-xs text-slate-500">正在加载标准岗位…</p> : <div className="mt-3 space-y-3">{groupedRoleTemplates.map(([group, templates]) => <div key={group}><p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500">{group}</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{templates.map(template => <button type="button" key={template.code} disabled={!template.available || !template.roleId} className={`rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${Number(assignmentForm.roleId) === template.roleId ? "border-[#3e6a61] bg-white shadow-sm" : "border-[#dbe8e4] bg-white hover:border-[#7fa69d]"}`} onClick={() => setAssignmentForm(current => ({ ...current, roleId: String(template.roleId) }))}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-800">{template.name}</span><span className="text-[10px] text-slate-500">{template.available ? "可用" : "已停用"}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{template.summary}</p></button>)}</div></div>)}</div>}
            </section>
            {assignmentRequiresBusinessScope && !assignmentHasScope ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">请为业务角色至少选择一个所属部门/项目部或一个具体项目范围；未选择时不会提交授权。</div> : null}
            {!departmentNodes.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900"><span>当前未配置可用部门或项目部。您仍可直接按具体项目授权；如需部门级范围，请先建立项目部并启用对应业务模块。</span><Button size="sm" variant="outline" onClick={() => setLocation("/admin/organization")}>配置组织与项目</Button></div> : null}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid gap-1.5"><Label>管理人员</Label><Select value={assignmentForm.userId} onValueChange={value => setAssignmentForm({ ...assignmentForm, userId: value })}><SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger><SelectContent>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}{user.localUsername ? `（${user.localUsername}）` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>岗位模板</Label><Select value={assignmentForm.roleId} onValueChange={value => setAssignmentForm({ ...assignmentForm, roleId: value })}><SelectTrigger><SelectValue placeholder="从上方卡片或此处选择岗位" /></SelectTrigger><SelectContent>{roles.data?.filter(role => role.status === "active" || String(role.id) === assignmentForm.roleId).filter(role => role.code !== "SUPER_ADMIN").map(role => <SelectItem key={role.id} value={String(role.id)}>{role.name}{role.status !== "active" ? "（已停用）" : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>所属部门 / 项目部</Label><Select value={assignmentForm.organizationId || "UNASSIGNED"} onValueChange={value => setAssignmentForm({ ...assignmentForm, organizationId: value === "UNASSIGNED" ? "" : value, projectId: value === "UNASSIGNED" ? assignmentForm.projectId : "" })}><SelectTrigger><SelectValue placeholder="选择所属部门" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">不设置（可改用具体项目范围）</SelectItem>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>具体项目范围</Label><Select value={assignmentForm.projectId || "ALL"} onValueChange={value => setAssignmentForm({ ...assignmentForm, projectId: value === "ALL" ? "" : value, organizationId: value === "ALL" ? assignmentForm.organizationId : "" })}><SelectTrigger><SelectValue placeholder="项目范围（可选）" /></SelectTrigger><SelectContent><SelectItem value="ALL">不设置项目范围</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-from">授权生效时间</Label><Input id="assignment-valid-from" type="datetime-local" value={assignmentForm.validFrom} onChange={event => setAssignmentForm({ ...assignmentForm, validFrom: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-to">授权失效时间</Label><Input id="assignment-valid-to" type="datetime-local" value={assignmentForm.validTo} onChange={event => setAssignmentForm({ ...assignmentForm, validTo: event.target.value })} /></div>
            </div>
            {selectedAssignmentTemplate ? <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-950"><p className="font-semibold">{selectedAssignmentTemplate.name} · 职责摘要</p><p className="mt-1">可办理：{selectedAssignmentTemplate.allowedActions.join("、")}。</p><p className="mt-1 text-sky-800">职责分离：{selectedAssignmentTemplate.restrictedActions.join("、")}。</p></div> : null}
            <div className="rounded-lg border border-[#d8e3e0] bg-[#f7faf9] px-3 py-2 text-xs leading-5 text-slate-600">{normalizedAssignmentScope.projectId ? "当前为具体项目授权：保存后仅可访问该项目，角色对应业务模块将立即生效；不再依赖部门业务模块配置。" : normalizedAssignmentScope.organizationId ? "当前为部门范围授权：请先在“部门可办理业务”启用对应模块，才能显示业务入口。" : "请选择部门范围或具体项目范围后再授权。"}</div>
            <Button className="min-w-40 bg-[#203c48] hover:bg-[#17313b]" disabled={!assignmentReady || saveAssignment.isPending} onClick={() => saveAssignment.mutate({ id: assignmentForm.id, userId: Number(assignmentForm.userId), roleId: Number(assignmentForm.roleId), organizationId: normalizedAssignmentScope.organizationId, projectId: normalizedAssignmentScope.projectId, validFrom: assignmentForm.validFrom ? new Date(assignmentForm.validFrom).toISOString() : null, validTo: assignmentForm.validTo ? new Date(assignmentForm.validTo).toISOString() : null })}>{saveAssignment.isPending ? "正在保存…" : assignmentForm.id ? "保存授权修改" : "授予角色"}</Button>
          </CardContent>
          <CardContent className="pt-0">
            {(assignments.data ?? []).length ? <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5"><p className="text-xs text-slate-600">授权目录 · {filteredAssignments.length}/{(assignments.data ?? []).length} 条</p><Input className="h-8 w-full sm:w-64" value={assignmentSearch} onChange={event => setAssignmentSearch(event.target.value)} placeholder="搜索人员、角色、部门或项目" /></div>{filteredAssignments.map(item => { const lifecycle = getAssignmentLifecycle(item); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-3 shadow-sm"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{item.userName || `用户 #${item.userId}`}</p>{item.localUsername ? <span className="font-mono text-xs text-slate-500">{item.localUsername}</span> : null}<Badge variant={lifecycle.tone}>{lifecycle.label}</Badge><Badge variant="outline">{item.roleName} · {item.roleCode}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-500">范围：{item.projectName ? `项目 · ${item.projectName}` : item.organizationName ? `部门 · ${item.organizationName}` : "全局管理员"} · 生效：{displayDate(item.validFrom)} · 到期：{displayDate(item.validTo)}</p></div><div className="flex flex-wrap items-center gap-2">{item.status !== "revoked" ? <><Button size="sm" variant="outline" onClick={() => setAssignmentForm({ id: item.id, userId: String(item.userId), roleId: String(item.roleId), organizationId: item.organizationId ? String(item.organizationId) : "", projectId: item.projectId ? String(item.projectId) : "", validFrom: toLocalDateTimeInput(item.validFrom), validTo: toLocalDateTimeInput(item.validTo) })}>编辑</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "role_assignment", id: item.id, label: `${item.userName || `用户 #${item.userId}`} 的 ${item.roleName} 授权`, description: "确认撤销该角色授权？系统将立即停止其权限，并保留原授权记录、操作人和审计历史。" })}>撤销</Button></> : null}</div></div>; })}{!filteredAssignments.length ? <EmptyState text="未找到匹配的授权记录。" /> : null}</div> : <EmptyState text="暂无角色授权记录。" />}
          </CardContent>
        </Card>
      </section>
    </div>
  );

  const renderSettings = () => (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="space-y-6">
        <div><p className="text-sm font-medium text-[#203c48]">系统设置中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">接口、密钥与业务参数</h1><p className="mt-2 text-sm text-slate-500">微信公众号服务号是唯一通知通道；地图、OCR、定位、油卡和地磅等连接均在此处加密托管并经过发布流程。</p></div>
        <Card className="border-[#d8e3e0]">
          <CardHeader><CardTitle className="text-base">每日项目站内汇总</CardTitle><CardDescription>每天按中国标准时间汇总施工日报、收入开支、计量申报与运输装卸数据，并写入项目负责人的站内消息中心。定时任务、运行结果和配置修改均保留审计记录。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.1fr_.8fr_.8fr]">
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700"><Checkbox checked={dailyDigestForm.enabled} onCheckedChange={checked => setDailyDigestForm(current => ({ ...current, enabled: Boolean(checked) }))} />启用每日自动汇总</label>
              <div><Label>汇总时</Label><Select value={dailyDigestForm.deliveryHour} onValueChange={value => setDailyDigestForm(current => ({ ...current, deliveryHour: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 24 }, (_, hour) => <SelectItem key={hour} value={String(hour).padStart(2, "0")}>{String(hour).padStart(2, "0")} 时</SelectItem>)}</SelectContent></Select></div>
              <div><Label>汇总分</Label><Select value={dailyDigestForm.deliveryMinute} onValueChange={value => setDailyDigestForm(current => ({ ...current, deliveryMinute: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["00", "15", "30", "45"].map(minute => <SelectItem key={minute} value={minute}>{minute} 分</SelectItem>)}</SelectContent></Select></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><Checkbox checked={dailyDigestForm.includeEmptyProjects} onCheckedChange={checked => setDailyDigestForm(current => ({ ...current, includeEmptyProjects: Boolean(checked) }))} />无业务数据的项目也生成“无新增数据”站内汇总</label>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><BusinessStatusBadge status={dailyDigestSettings.data?.enabled ? "active" : "disabled"} /><span>最近尝试：{displayDate(dailyDigestSettings.data?.lastAttemptedAt)}</span><span>最近完整业务日：{dailyDigestSettings.data?.lastSuccessfulBusinessDate ? new Date(dailyDigestSettings.data.lastSuccessfulBusinessDate).toISOString().slice(0, 10) : "—"}</span>{dailyDigestSettings.data?.scheduleCronTaskUid ? <span className="font-mono">任务已登记</span> : null}</div>
            <div className="flex flex-wrap gap-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={saveDailyDigest.isPending} onClick={() => saveDailyDigest.mutate({ enabled: dailyDigestForm.enabled, deliveryHour: Number(dailyDigestForm.deliveryHour), deliveryMinute: Number(dailyDigestForm.deliveryMinute), includeEmptyProjects: dailyDigestForm.includeEmptyProjects })}>{dailyDigestForm.enabled ? "保存并启用站内汇总" : "保存并停用站内汇总"}</Button><Button variant="outline" disabled={!dailyDigestSettings.data?.enabled || runDailyDigestNow.isPending} onClick={() => runDailyDigestNow.mutate({ businessDate: dailyDigestPreviewDate || undefined })}>立即生成所选日期站内汇总</Button></div>
            <div className="grid gap-3 rounded-xl border border-slate-100 p-3 lg:grid-cols-[1fr_180px_auto]"><div><Label>预览项目</Label><Select value={dailyDigestPreviewProjectId || "UNASSIGNED"} onValueChange={value => setDailyDigestPreviewProjectId(value === "UNASSIGNED" ? "" : value)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{(projects.data ?? []).filter(project => project.status === "active").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div><div><Label>业务日期</Label><Input className="mt-1" type="date" value={dailyDigestPreviewDate} onChange={event => setDailyDigestPreviewDate(event.target.value)} /></div><Button className="self-end" variant="outline" disabled={!dailyDigestPreviewProjectId || dailyDigestPreview.isFetching} onClick={() => dailyDigestPreview.refetch()}>刷新预览</Button></div>
            {dailyDigestPreview.data ? <div className="grid gap-2 rounded-xl bg-[#f7faf9] p-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4"><div><b>施工日报</b><p className="mt-1">{dailyDigestPreview.data.construction.reportCount} 份 · 进度 {dailyDigestPreview.data.construction.averageProgressPercent}%</p></div><div><b>收入 / 开支</b><p className="mt-1">¥{displayMoney(dailyDigestPreview.data.finance.incomeAmount)} / ¥{displayMoney(dailyDigestPreview.data.finance.expenseAmount)}</p></div><div><b>计量申报</b><p className="mt-1">{dailyDigestPreview.data.measurement.claimCount} 笔 · ¥{displayMoney(dailyDigestPreview.data.measurement.declaredAmount)}</p></div><div><b>运输闭环</b><p className="mt-1">{dailyDigestPreview.data.transport.tripCount} 趟 · 装/卸 {dailyDigestPreview.data.transport.loadConfirmedCount}/{dailyDigestPreview.data.transport.unloadConfirmedCount} · 异常 {dailyDigestPreview.data.transport.exceptionTripCount}</p></div></div> : dailyDigestPreviewProjectId && !dailyDigestPreview.isLoading ? <p className="text-xs text-slate-500">选择项目和业务日期后可查看真实聚合结果；预览不会发送通知。</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">配置项清单</CardTitle><CardDescription>敏感值仅以掩码展示。发布后生成版本与审计日志；不提供明文导出。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {visibleSettings.length ? visibleSettings.map(item => (
              <div key={item.id} className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${selectedSettingId === item.id ? "border-[#203c48] bg-[#f7faf9]" : "border-slate-100"}`}>
                <button className="text-left" onClick={() => setSelectedSettingId(item.id)}><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.displayName}</p>{item.isSensitive ? <Badge variant="outline">加密托管</Badge> : null}<Badge variant={item.status === "published" ? "secondary" : "outline"}>{item.status === "published" ? "已发布" : item.status === "draft" ? "草稿" : "已禁用"}</Badge></div><p className="mt-1 text-xs text-slate-500">{item.category} · {item.settingKey} · v{item.version} · {item.valuePreview || "未设置值"}</p></button>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    setSelectedSettingId(item.id);
                    setSettingForm({ id: item.id, expectedVersion: item.version, category: item.category, settingKey: item.settingKey, displayName: item.displayName, value: item.isSensitive ? "" : item.valueJson ?? "", isSensitive: item.isSensitive, remarks: item.remarks ?? "" });
                  }}>编辑</Button>
                  <Button size="sm" variant="outline" disabled={item.status === "published" || publishSetting.isPending} onClick={() => publishSetting.mutate({ id: item.id, expectedVersion: item.version })}>发布</Button>
                  <Button size="sm" variant="outline" disabled={testSetting.isPending} onClick={() => testSetting.mutate({ id: item.id })}>{item.settingKey.startsWith("WECHAT_OFFICIAL_") ? getOfficialAccountTestLabel(item.settingKey) : "校验 / 测试"}</Button>
                  {item.status !== "disabled" ? <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800" disabled={disableSetting.isPending} onClick={() => { if (window.confirm(`确认停用“${item.displayName}”？停用后将保留密文和历史版本，但不再参与业务调用。`)) disableSetting.mutate({ id: item.id, expectedVersion: item.version }); }}>停用</Button> : null}
                  <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800" disabled={removeSetting.isPending} onClick={() => setSettingDeleteTarget({ id: item.id, displayName: item.displayName, settingKey: item.settingKey, version: item.version, isSensitive: item.isSensitive })}>删除</Button>
                </div>
              </div>
            )) : <EmptyState text="暂无有效配置项。已停用配置仅保留在发布历史与审计中，不参与系统调用。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">配置版本与安全回滚</CardTitle><CardDescription>历史版本不展示密钥明文；回滚后会生成新的已发布版本，并全程记录审计日志。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {selectedSettingId === undefined ? <EmptyState text="请选择一条配置查看其发布历史。" /> : settingHistory.data?.length ? settingHistory.data.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3"><div><p className="text-sm font-medium">{item.operation === "publish" ? "发布版本" : item.operation === "update" ? "草稿修订" : "回滚版本"} · v{item.version}</p><p className="mt-0.5 text-xs text-slate-500">{item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "时间未知"}</p></div><Button size="sm" variant="outline" disabled={!selectedSetting || rollbackSetting.isPending} onClick={() => { if (selectedSetting && window.confirm("确认将当前配置回滚至此历史版本？此操作会创建新的发布版本。")) rollbackSetting.mutate({ settingId: selectedSettingId, publishLogId: item.id, expectedVersion: selectedSetting.version }); }}>回滚至此版本</Button></div>) : <EmptyState text="该配置尚无已发布历史；发布后即可在此回滚。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">统一配置分类</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {["基础品牌与多语言", "账号安全与密码策略", "微信公众号服务号与消息模板", "地图 / OCR / 定位连接器", "油卡 / 地磅 / 外部 API", "业务参数与编号规则", "文档影像与归档规则", "运行监控与审计", "发布、回滚与版本"].map(item => <div key={item} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">{item}</div>)}
          </CardContent>
        </Card>
      </section>
      <aside className="space-y-4">
        <Card className="border-[#cbded9] bg-[#f4faf8]">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="text-base">新版微信开发者平台接入状态</CardTitle><CardDescription className="mt-1">服务号开发配置已迁移至“微信开发者平台 → 我的业务 → 服务号”。运营、模板选用和网页授权域名仍按微信各业务后台当前可见能力配置。</CardDescription></div>
              <a className="inline-flex items-center gap-1 text-xs font-medium text-[#1b5c54] hover:underline" href="https://developers.weixin.qq.com/platform/" target="_blank" rel="noreferrer">打开开发者平台<ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-medium text-slate-800"><KeyRound className="h-4 w-4 text-[#1f6b60]" />开发密钥</div><Badge variant="outline" className={officialCredentialsReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialCredentialsReady ? "AppID / AppSecret 已发布" : "待发布"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-600">路径：基础信息 → 开发密钥。AppSecret 必须为“启用”状态；重置后旧密钥立即失效。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center gap-2 font-medium text-slate-800"><ShieldCheck className="h-4 w-4 text-[#1f6b60]" />API IP 白名单</div><p className="mt-1.5 text-xs leading-5 text-slate-600">系统已使用受控固定出口。微信后台仅需保留固定出口 IP <span className="font-mono">35.237.214.196</span>；无需继续追加托管环境的动态 IP。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center justify-between gap-3"><div className="font-medium text-slate-800">网页授权与跳转域名</div><Badge variant="outline" className={officialBindingReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialBindingReady ? "可发起员工绑定" : "待发布 HTTPS 地址"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-600">系统跳转地址须发布为 HTTPS。网页授权域名在微信公众平台“设置与开发 → 账号设置 → 功能设置”中配置，只填域名，不填协议和路径。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
              <div className="flex items-center justify-between gap-3"><div className="font-medium text-slate-800">模板消息通知</div><Badge variant="outline" className={officialTemplateReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-600"}>{officialTemplateReady ? "业务通知已就绪" : "待开通或选用模板"}</Badge></div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">范围通知和每日汇总使用站内消息，不依赖服务号模板。仅在刷卡、审核或状态变更等具体业务即时提醒需要服务号时，才选择符合微信规则的业务模板；员工 OAuth 绑定不依赖模板 ID。</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><Button size="sm" variant="outline" disabled={checkOfficialTemplateCapability.isPending} onClick={() => checkOfficialTemplateCapability.mutate()}>{checkOfficialTemplateCapability.isPending ? "正在检测模板功能…" : "检测模板消息功能插件"}</Button><Button size="sm" className="bg-[#1f6b60] hover:bg-[#18564e]" disabled={listOfficialTemplates.isPending} onClick={() => listOfficialTemplates.mutate()}>{listOfficialTemplates.isPending ? "正在读取私有模板…" : "读取并选择私有模板"}</Button></div>
              {officialTemplateOptions.length ? <div className="mt-3 space-y-2 rounded-md border border-[#d7e8e3] bg-[#f8fbfa] p-2">{officialTemplateOptions.map(template => <div key={template.templateId} className="rounded border border-slate-200 bg-white p-2"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium text-slate-800">{template.title}</div><Badge variant="outline" className={template.persistentBusinessEligible === false ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}>{template.persistentBusinessEligible === false ? "不可用于持续群发" : "可生成业务草稿"}</Badge></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{template.content}</p><p className="mt-1 text-[11px] text-slate-500">字段：{Object.keys(template.fieldMapping).join("、") || "未识别"}</p>{template.eligibilityMessage ? <p className="mt-1 text-[11px] leading-5 text-amber-700">{template.eligibilityMessage}</p> : null}<Button className="mt-2 w-full" size="sm" variant="outline" disabled={createOfficialTemplateDraft.isPending || template.persistentBusinessEligible === false} onClick={() => createOfficialTemplateDraft.mutate({ templateId: template.templateId })}>{createOfficialTemplateDraft.isPending ? "正在生成草稿…" : template.persistentBusinessEligible === false ? "该模板不可用于持续业务通知" : "选择此模板并生成配置草稿"}</Button></div>)}</div> : null}
            </div>
            <div className="rounded-lg border border-[#d7e8e3] bg-[#f8fbfa] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">业务通知模板矩阵</p><Badge variant="outline" className={officialTemplateCoverage.data?.configured ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialTemplateCoverage.data?.configured ? "已读取发布模板" : "待发布模板"}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-600">系统将所有业务消息统一填入已发布服务号模板；下列矩阵显示每个模块的事件范围与字段是否完整，不展示模板密钥、OpenID 或敏感内容。</p><div className="mt-3 space-y-2">{officialTemplateCoverage.isLoading ? <p className="text-xs text-slate-500">正在核验各业务模板字段…</p> : officialTemplateCoverage.data?.matrix.map(item => <div key={item.module} className="rounded-md border border-slate-200 bg-white px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{item.name}</p><Badge variant="outline" className={item.ready ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{item.ready ? "字段覆盖完成" : "需补充字段映射"}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-600">{item.purpose}</p><p className="mt-1 text-[11px] text-slate-500">事件：{item.events.join("、")}</p>{item.missingVariables.length ? <p className="mt-1 text-[11px] text-amber-700">缺少占位符：{item.missingVariables.map(variable => `{${variable}}`).join("、")}</p> : null}</div>) ?? <p className="text-xs text-slate-500">模板矩阵暂不可读取，请先检查已发布服务号配置。</p>}</div></div>
            <p className="rounded-lg bg-[#e8f2ef] px-3 py-2 text-xs leading-5 text-[#28584f]">“绑定关系 → 开放平台”仅在需要与小程序、网站应用或 UnionID 体系打通时配置；当前服务号通知与员工网页授权不以此为前置条件。</p>
          </CardContent>
        </Card>
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">系统内服务号配置</CardTitle><CardDescription>先发布 AppID、AppSecret 与 HTTPS 跳转地址以完成凭据校验和员工绑定；模板 ID 与字段映射用于后续业务通知。密钥只会加密保存；“校验开发密钥”不会向员工推送测试消息。</CardDescription></CardHeader>
          <CardContent className="space-y-2">{OFFICIAL_ACCOUNT_SETTING_PRESETS.map(preset => <Button key={preset.settingKey} variant="outline" className="w-full justify-start border-[#203c48] text-left text-[#203c48]" onClick={() => setSettingForm(preset)}>{preset.displayName}</Button>)}</CardContent>
        </Card>
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">企业身份账号恢复</CardTitle><CardDescription>仅配置身份提供方公开 HTTPS 恢复页面。系统不保存企业密码，登录页和个人中心将通过受控端点跳转至该地址。</CardDescription></CardHeader>
          <CardContent><Button variant="outline" className="w-full border-[#203c48] text-[#203c48]" onClick={() => setSettingForm({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份平台账号恢复地址", value: "", isSensitive: false, remarks: "仅限企业统一身份提供方的账号找回或密码重置页面；保存草稿后需发布才会对用户生效。" })}>填入身份恢复地址模板</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{settingForm.id ? "编辑配置草稿" : "新建配置草稿"}</CardTitle><CardDescription>{settingForm.id ? "编辑会生成新的草稿版本。敏感值留空时保留现有密文；输入完整新值才会替换。配置键与敏感等级需通过新建替代配置变更。" : "密钥类内容会在服务端立即进行 AES-GCM 加密且不会回传明文；既有配置可从左侧编辑、停用或删除。"}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>配置分类</Label><Select value={settingForm.category} onValueChange={value => setSettingForm({ ...settingForm, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="账号安全">账号安全与身份平台</SelectItem><SelectItem value="微信公众号服务号">微信公众号服务号</SelectItem><SelectItem value="公众号消息模板">公众号消息模板</SelectItem><SelectItem value="外部API">外部 API 连接器</SelectItem><SelectItem value="业务参数">业务参数与计价规则</SelectItem><SelectItem value="文档影像">文档影像与归档</SelectItem></SelectContent></Select></div>
            <div><Label>配置键</Label><Input value={settingForm.settingKey} disabled={Boolean(settingForm.id)} placeholder="WECHAT_OFFICIAL_APP_ID" onChange={event => { const settingKey = event.target.value.toUpperCase(); setSettingForm({ ...settingForm, settingKey, isSensitive: resolveOfficialAccountSensitivity(settingKey, settingForm.isSensitive) }); }} /></div>
            <div><Label>显示名称（仅系统内标签）</Label><Input value={settingForm.displayName} placeholder="微信公众号服务号 AppID" onChange={event => setSettingForm({ ...settingForm, displayName: event.target.value })} /><p className="mt-1 text-xs text-slate-500">不要将 AppID、AppSecret、模板 ID 填在这里；请填入下方“配置值”。</p></div>
            <div><Label>配置值</Label><Input value={settingForm.value} type={settingForm.isSensitive ? "password" : "text"} placeholder={settingForm.id && settingForm.isSensitive ? "留空保留现有加密值；输入完整新值以替换" : "输入值或密钥"} onChange={event => setSettingForm({ ...settingForm, value: event.target.value })} />{settingForm.id && settingForm.isSensitive ? <p className="mt-1 text-xs leading-5 text-slate-500">为保护密钥，系统不会回显现有值。留空仅更新名称、分类或备注；填写完整新值才会替换。</p> : null}</div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><Checkbox checked={settingForm.isSensitive} disabled={Boolean(settingForm.id) || settingForm.settingKey.startsWith("WECHAT_OFFICIAL_")} onCheckedChange={checked => setSettingForm({ ...settingForm, isSensitive: Boolean(checked) })} />按敏感密钥加密托管{settingForm.settingKey.startsWith("WECHAT_OFFICIAL_") ? <span className="text-xs text-slate-400">（服务号字段按安全规则自动设置）</span> : null}</label>
            <div><Label>备注</Label><Input value={settingForm.remarks} placeholder="用途、回调地址或维护说明" onChange={event => setSettingForm({ ...settingForm, remarks: event.target.value })} /></div>
            <div className="flex gap-2"><Button className="flex-1 bg-[#203c48] hover:bg-[#17313b]" disabled={!settingForm.settingKey || !settingForm.displayName || (!settingForm.value && !(settingForm.id && settingForm.isSensitive)) || saveSetting.isPending} onClick={() => saveSetting.mutate(settingForm)}>{settingForm.id ? "保存修订草稿" : "保存草稿"}</Button>{settingForm.id ? <Button variant="outline" onClick={() => setSettingForm(EMPTY_SETTING_FORM)}>取消编辑</Button> : null}</div>
          </CardContent>
        </Card>
        <AlertDialog open={Boolean(settingDeleteTarget)} onOpenChange={open => { if (!open) setSettingDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除配置？</AlertDialogTitle>
              <AlertDialogDescription>将删除“{settingDeleteTarget?.displayName}”（{settingDeleteTarget?.settingKey}）。{settingDeleteTarget?.isSensitive ? "系统会同步抹除当前密文及历史快照中的可恢复内容；" : "系统会同步抹除当前值及历史快照中的可恢复内容；"}保留的审计记录仅包含操作标识，不含配置值。此操作不可恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeSetting.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!settingDeleteTarget || removeSetting.isPending} onClick={() => { if (settingDeleteTarget) removeSetting.mutate({ id: settingDeleteTarget.id, expectedVersion: settingDeleteTarget.version }); }}>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-[#203c48]">治理留痕</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">配置发布与审计日志</h1><p className="mt-2 text-sm text-slate-500">所有组织、角色、授权和系统设置的关键操作都会写入服务端审计记录。</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">最近操作</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {audits.data?.length ? audits.data.map(item => <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium text-slate-700">{item.summary}</p><p className="mt-1 text-xs text-slate-400">{item.module} · {item.action} · 操作人 #{item.userId ?? "系统"}</p></div><p className="text-xs text-slate-400">{displayDate(item.createdAt)}</p></div>) : <EmptyState text="尚无审计记录；首次保存组织、角色或配置后将自动生成。" />}
        </CardContent>
      </Card>
    </div>
  );

  /** 微信登录台账只展示可读状态和业务范围；OpenID、令牌及设备原始指纹始终不进入浏览器。 */
  const renderWechatLogin = () => {
    const rows = wechatLogins.data ?? [];
    const activeCount = rows.filter(item => item.bindingStatus === "active").length;
    const needsActionCount = rows.filter(item => ["unsubscribed", "revoked", "disabled"].includes(item.bindingStatus)).length;
    const statusLabel: Record<string, string> = { active: "已绑定", pending: "待完成", unsubscribed: "未关注服务号", revoked: "已解除", disabled: "已停用" };
    const loginModeLabel: Record<string, string> = { pc: "仅 PC", mobile: "仅手机", both: "PC + 手机" };
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">微信公众号服务号 · 身份治理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">微信登录管理</h1>
          <p className="mt-2 text-sm text-slate-500">集中核验微信 OAuth 授权、服务号关注状态、岗位范围和匿名设备摘要。仅超级管理员可解除绑定；解除后人员须在微信内重新授权。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard title="已绑定账号" value={activeCount} description="可接收服务号业务通知" icon={KeyRound} />
          <MetricCard title="需处理状态" value={needsActionCount} description="未关注、已解除或已停用" icon={ShieldCheck} />
          <MetricCard title="绑定台账" value={rows.length} description="不展示 OpenID、令牌或设备指纹" icon={UsersRound} />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div><CardTitle className="text-base">微信授权与登录台账</CardTitle><CardDescription>姓名、职务、角色、部门/项目范围和最近状态均为服务端投影；设备仅显示可读摘要。</CardDescription></div>
            <Button size="sm" variant="outline" onClick={() => wechatLogins.refetch()} disabled={wechatLogins.isFetching}>刷新台账</Button>
          </CardHeader>
          <CardContent>
            {wechatLogins.isLoading ? <EmptyState text="正在读取微信授权登录台账…" /> : wechatLogins.isError ? <EmptyState text="暂无法读取微信登录台账，请确认当前账号具有超级管理员权限后重试。" /> : rows.length ? <div className="space-y-3">{rows.map(item => (
              <div key={item.userId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.displayName || item.localUsername || "未命名人员"}</p><Badge className={item.bindingStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>{statusLabel[item.bindingStatus] ?? item.bindingStatus}</Badge></div>
                    <p className="mt-1 text-xs text-slate-500">职务：{item.positionName || "未配置"} · 登录终端：{loginModeLabel[item.loginMode] ?? "按账号策略"} · 身份来源：{item.bindingSource === "wechat_oauth" ? "微信 OAuth" : "管理员核验"}</p>
                  </div>
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" disabled={item.bindingStatus === "revoked" || revokeWechatBinding.isPending} onClick={() => setWechatBindingActionTarget({ userId: item.userId, displayName: item.displayName || item.localUsername || "该人员" })}>解除绑定</Button>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                  <p><span className="text-slate-400">岗位：</span>{item.roleNames.length ? item.roleNames.join("、") : "未授权"}</p>
                  <p><span className="text-slate-400">范围：</span>{item.scopeNames.length ? item.scopeNames.join("、") : "未配置"}</p>
                  <p><span className="text-slate-400">最近登录：</span>{displayDate(item.lastSignedIn)}</p>
                  <p><span className="text-slate-400">最近核验：</span>{displayDate(item.lastVerifiedAt)}</p>
                  <p><span className="text-slate-400">绑定时间：</span>{displayDate(item.boundAt)}</p>
                  <p><span className="text-slate-400">设备摘要：</span>{item.deviceLabel || "未绑定考勤设备"}</p>
                  <p><span className="text-slate-400">设备最近使用：</span>{displayDate(item.deviceLastUsedAt)}</p>
                  <p><span className="text-slate-400">投递异常：</span>{item.failureCount ? `${item.failureCount} 次，最近 ${displayDate(item.lastFailureAt)}` : "无"}</p>
                </div>
              </div>
            ))}</div> : <EmptyState text="尚无微信授权绑定记录。人员可在移动端“我的”中完成服务号 OAuth 绑定后在此出现。" />}
          </CardContent>
        </Card>
        <AlertDialog open={Boolean(wechatBindingActionTarget)} onOpenChange={open => { if (!open) setWechatBindingActionTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>确认解除微信授权绑定？</AlertDialogTitle><AlertDialogDescription>将解除“{wechatBindingActionTarget?.displayName}”的微信服务号身份关联。该人员将无法继续接收服务号业务通知，直到其在移动端重新完成微信授权绑定。岗位、项目范围和业务数据不会被修改。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel disabled={revokeWechatBinding.isPending}>取消</AlertDialogCancel><AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!wechatBindingActionTarget || revokeWechatBinding.isPending} onClick={() => { if (wechatBindingActionTarget) revokeWechatBinding.mutate({ userId: wechatBindingActionTarget.userId }); }}>确认解除</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  /** 业务台账不把空项目解释为全量范围；数据读取仍由各业务路由在服务端复核权限。 */
  const renderWorkspaceProjectFilter = (title: string, description: string) => (
    <Card className="border-[#d8e3e0]">
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <Label htmlFor="business-workspace-project">当前项目</Label>
          <Select value={businessWorkspaceProjectId || "UNASSIGNED"} onValueChange={value => setBusinessWorkspaceProjectId(value === "UNASSIGNED" ? "" : value)}>
            <SelectTrigger id="business-workspace-project" className="mt-1"><SelectValue placeholder="选择已授权项目" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
              {(projects.data ?? []).filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[260px] flex-[2]"><p className="text-sm font-medium text-slate-800">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
        <Button size="sm" variant="outline" onClick={() => projects.refetch()} disabled={projects.isFetching}>刷新项目</Button>
      </CardContent>
    </Card>
  );

  const renderConstruction = () => {
    const rows = constructionDailyReports.data ?? [];
    const summary = constructionDailySummary.data;
    const editorCanEdit = isEditableConstructionReport(constructionReportEditor);
    const openConstructionEditor = (item?: typeof rows[number]) => setConstructionReportEditor(item ? {
      id: Number(item.id), projectId: workspaceProjectId, status: item.status, reportDate: toBusinessDateInput(item.reportDate), workArea: item.workArea, weather: item.weather, workContent: item.workContent, safetyNotes: item.safetyNotes ?? "", issueNotes: item.issueNotes ?? "", progressPercent: String(item.progressPercent),
    } : { projectId: workspaceProjectId, status: "draft", reportDate: toLocalDateInput(), workArea: "", weather: "other", workContent: "", safetyNotes: "", issueNotes: "", progressPercent: "0" });
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-medium text-[#203c48]">施工执行 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">施工日报与现场进度</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">仅查询所选项目的真实施工日报。提交、审核、退回和归档均继续通过服务端项目范围、岗位和状态机校验。</p></div>
          <Button onClick={() => openConstructionEditor()} disabled={!hasBusinessWorkspaceProject}>新建施工日报</Button>
        </div>
        {renderWorkspaceProjectFilter("施工项目范围", "选择项目后加载日报、累计进度和待处理状态；未选择项目时不会请求或展示施工生产记录。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实施工日报。" /> : constructionDailyReports.isLoading || constructionDailySummary.isLoading ? <EmptyState text="正在读取施工日报与进度汇总…" /> : constructionDailyReports.isError || constructionDailySummary.isError ? <EmptyState text="暂无法读取施工业务数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="日报总数" value={summary?.total} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={FolderKanban} />
              <MetricCard title="待审核日报" value={summary?.submitted} description="已提交，待处理" icon={ScrollText} />
              <MetricCard title="已归档日报" value={summary?.locked} description="不可再回退" icon={ShieldCheck} />
              <MetricCard title="平均进度" value={summary?.averageProgressPercent} description="来自真实日报申报比例" icon={BarChart3} />
            </section>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0"><div><CardTitle className="text-base">施工日报台账</CardTitle><CardDescription>展示施工部位、天气、内容摘要、安全与问题记录。点击状态操作后会由服务端重新验证当前日报状态。</CardDescription></div><Button size="sm" variant="outline" onClick={() => Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch()])} disabled={constructionDailyReports.isFetching || constructionDailySummary.isFetching}>刷新</Button></CardHeader>
              <CardContent className="space-y-3">
                {rows.length ? rows.map(item => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.workArea}</p><BusinessStatusBadge status={item.status} /><Badge variant="outline">{CONSTRUCTION_WEATHER_LABELS[item.weather]}</Badge></div><p className="mt-1 text-xs text-slate-500">{displayDate(item.reportDate)} · 累计完成 {Number(item.progressPercent).toFixed(2)}%</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openConstructionEditor(item)}>{["draft", "rejected"].includes(item.status) ? "查看/编辑" : "查看详情"}</Button>{item.status === "draft" ? <Button size="sm" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "submitted" })} disabled={transitionConstructionReport.isPending}>提交</Button> : null}{item.status === "submitted" ? <><Button size="sm" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "approved" })} disabled={transitionConstructionReport.isPending}>审核通过</Button><Button size="sm" variant="outline" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "rejected" })} disabled={transitionConstructionReport.isPending}>退回</Button></> : null}{item.status === "approved" ? <Button size="sm" variant="outline" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "locked" })} disabled={transitionConstructionReport.isPending}>归档</Button> : null}</div></div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.workContent}</p>
                    {(item.safetyNotes || item.issueNotes) ? <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 md:grid-cols-2"><p><b className="text-slate-700">安全：</b>{item.safetyNotes || "未记录"}</p><p><b className="text-slate-700">问题：</b>{item.issueNotes || "未记录"}</p></div> : null}
                  </div>
                )) : <EmptyState text="当前项目尚无真实施工日报。请使用右上方“新建施工日报”在 PC 后台录入现场记录。" />}
              </CardContent>
            </Card>
            <Dialog open={Boolean(constructionReportEditor)} onOpenChange={open => { if (!open) setConstructionReportEditor(null); }}><DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{constructionReportEditor?.id ? "施工日报查看与编辑" : "新建施工日报"}</DialogTitle><DialogDescription>{editorCanEdit ? "当前日报可在 PC 后台直接维护。保存后由服务端重新校验项目范围、岗位和草稿/退回状态。" : "该日报已进入受控状态，PC 后台仅允许查看；如需处理，请使用本页状态操作。"}</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-4 sm:grid-cols-2"><Field label="日报日期"><Input type="date" value={constructionReportEditor?.reportDate ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, reportDate: event.target.value } : current)} /></Field><Field label="天气"><Select value={constructionReportEditor?.weather ?? "other"} disabled={!editorCanEdit} onValueChange={weather => setConstructionReportEditor(current => current ? { ...current, weather: weather as ConstructionWeather } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(CONSTRUCTION_WEATHER_LABELS) as ConstructionWeather[]).map(weather => <SelectItem key={weather} value={weather}>{CONSTRUCTION_WEATHER_LABELS[weather]}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid gap-4 sm:grid-cols-[1fr_180px]"><Field label="施工部位 / 作业面"><Input value={constructionReportEditor?.workArea ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, workArea: event.target.value } : current)} /></Field><Field label="累计完成比例（%）"><Input type="number" min="0" max="100" step="0.01" value={constructionReportEditor?.progressPercent ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, progressPercent: event.target.value } : current)} /></Field></div><Field label="当日施工内容"><Textarea className="min-h-32" value={constructionReportEditor?.workContent ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, workContent: event.target.value } : current)} /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="安全记录（可选）"><Textarea value={constructionReportEditor?.safetyNotes ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, safetyNotes: event.target.value } : current)} /></Field><Field label="问题记录（可选）"><Textarea value={constructionReportEditor?.issueNotes ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, issueNotes: event.target.value } : current)} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setConstructionReportEditor(null)} disabled={saveConstructionReport.isPending}>关闭</Button>{editorCanEdit ? <Button disabled={!constructionReportEditor || !constructionReportEditor.reportDate || constructionReportEditor.workArea.trim().length < 2 || constructionReportEditor.workContent.trim().length < 4 || !Number.isFinite(Number(constructionReportEditor.progressPercent)) || saveConstructionReport.isPending} onClick={() => constructionReportEditor && saveConstructionReport.mutate({ id: constructionReportEditor.id, projectId: constructionReportEditor.projectId, reportDate: constructionReportEditor.reportDate, workArea: constructionReportEditor.workArea.trim(), weather: constructionReportEditor.weather, workContent: constructionReportEditor.workContent.trim(), safetyNotes: constructionReportEditor.safetyNotes.trim() || null, issueNotes: constructionReportEditor.issueNotes.trim() || null, progressPercent: Number(constructionReportEditor.progressPercent) })}>{saveConstructionReport.isPending ? "正在保存…" : constructionReportEditor.id ? "保存修改" : "保存日报"}</Button> : null}</DialogFooter></DialogContent></Dialog>
          </>
        )}
      </div>
    );
  };

  const renderLabor = () => {
    const workers = laborWorkers.data ?? [];
    const attendance = laborAttendance.data ?? [];
    const payrolls = payrollStatements.data ?? [];
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">劳务工资 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">实名制、考勤与工资条</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">人员证件、手机号和银行卡均由服务端脱敏后返回；工资发放只保存付款凭证引用，不会在系统内发起转账。档案和工资条详情均在当前 PC 台账中查看。</p></div></div>
        {renderWorkspaceProjectFilter("劳务项目范围", "选择项目后按真实人员、考勤和工资条加载。每个工资状态操作仍由劳务、会计和财务角色在服务端二次核验。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实劳务工资台账。" /> : laborWorkers.isLoading || laborAttendance.isLoading || payrollStatements.isLoading ? <EmptyState text="正在读取实名制、考勤和工资条数据…" /> : laborWorkers.isError || laborAttendance.isError || payrollStatements.isError ? <EmptyState text="暂无法读取劳务工资数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="实名制人员" value={workers.length} description="已按敏感字段脱敏" icon={UsersRound} /><MetricCard title="在场人员" value={workers.filter(item => item.attendanceStatus === "active").length} description="可计入当前项目考勤" icon={ShieldCheck} /><MetricCard title="考勤记录" value={attendance.length} description="当前项目全部真实记录" icon={ScrollText} /><MetricCard title="待会计处理" value={payrolls.filter(item => item.status === "reviewing").length} description="审核中工资条" icon={BarChart3} /></section>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-base">劳务人员台账</CardTitle><CardDescription>展示实名核验与进退场状态；个人身份和资金字段保持脱敏。</CardDescription></CardHeader><CardContent className="space-y-2">{workers.length ? workers.map(worker => <div key={worker.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{worker.realName}</p><BusinessStatusBadge status={worker.attendanceStatus} /><Badge variant="outline">实名：{worker.identityVerificationStatus === "verified" ? "已核验" : worker.identityVerificationStatus === "rejected" ? "已驳回" : "待核验"}</Badge></div><p className="mt-1 text-xs text-slate-500">班组：{worker.teamName || "未设置"} · 入场：{worker.entryDate ? displayDate(worker.entryDate) : "未登记"} · 退场：{worker.exitDate ? displayDate(worker.exitDate) : "—"}</p></div><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `劳务人员档案 · ${worker.realName}`, description: "此为 PC 后台的受控脱敏档案视图。人员资料变更继续受岗位与项目范围校验。", fields: [{ label: "班组", value: worker.teamName || "未设置" }, { label: "实名状态", value: worker.identityVerificationStatus === "verified" ? "已核验" : worker.identityVerificationStatus === "rejected" ? "已驳回" : "待核验" }, { label: "出勤状态", value: <BusinessStatusBadge status={worker.attendanceStatus} /> }, { label: "入场日期", value: worker.entryDate ? displayDate(worker.entryDate) : "未登记" }, { label: "退场日期", value: worker.exitDate ? displayDate(worker.exitDate) : "—" }] })}>查看档案</Button></div>) : <EmptyState text="当前项目尚无真实劳务人员档案。" />}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">考勤记录</CardTitle><CardDescription>按人员与日期幂等保存；锁定记录不可由前端覆盖。</CardDescription></CardHeader><CardContent className="space-y-2">{attendance.length ? attendance.slice(0, 20).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><p className="text-sm font-medium text-slate-800">{item.workerName} <span className="font-normal text-slate-400">{item.teamName ? `· ${item.teamName}` : ""}</span></p><p className="mt-1 text-xs text-slate-500">{displayDate(item.attendanceDate)} · 正常 {item.workHours} h · 加班 {item.overtimeHours} h · {item.source}</p></div><BusinessStatusBadge status={item.status} /></div>) : <EmptyState text="当前项目尚无真实考勤记录。" />}</CardContent></Card>
            </div>
            <Card><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">工资条与结算状态</CardTitle><CardDescription>应发、扣款与实发金额均由服务端计算；付款凭证只对获授权财务岗位返回。</CardDescription></div><div className="min-w-[180px]"><Label htmlFor="labor-period">工资期间</Label><Input id="labor-period" className="mt-1" type="month" value={laborPeriod} onChange={event => setLaborPeriod(event.target.value)} /></div></CardHeader><CardContent className="space-y-2">{payrolls.length ? payrolls.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{item.workerName}</p><BusinessStatusBadge status={item.status} /><Badge variant="outline">{item.period}</Badge></div><p className="mt-1 text-xs text-slate-500">应发 ¥{displayMoney(item.payableAmount)} · 扣款 ¥{displayMoney(item.deductionAmount)} · 实发 ¥{displayMoney(item.actualAmount)} · {item.bankAccountMasked || "未登记收款账户"}{item.paymentReference ? ` · 凭证 ${item.paymentReference}` : ""}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `工资条明细 · ${item.workerName}`, description: "工资金额由服务端计算，付款凭证与敏感账户字段仅向获授权岗位展示。", fields: [{ label: "工资期间", value: item.period }, { label: "状态", value: <BusinessStatusBadge status={item.status} /> }, { label: "应发金额", value: `¥ ${displayMoney(item.payableAmount)}` }, { label: "扣款金额", value: `¥ ${displayMoney(item.deductionAmount)}` }, { label: "实发金额", value: `¥ ${displayMoney(item.actualAmount)}` }, { label: "收款账户", value: item.bankAccountMasked || "未登记" }, { label: "付款凭证", value: item.paymentReference || "尚未发放" }] })}>查看明细</Button>{item.status === "draft" ? <Button size="sm" onClick={() => submitPayroll.mutate({ id: item.id })} disabled={submitPayroll.isPending}>提交审核</Button> : null}{item.status === "reviewing" ? <><Button size="sm" onClick={() => approvePayroll.mutate({ id: item.id, decision: "approved" })} disabled={approvePayroll.isPending}>审核通过</Button><Button size="sm" variant="outline" onClick={() => approvePayroll.mutate({ id: item.id, decision: "returned" })} disabled={approvePayroll.isPending}>退回</Button></> : null}{item.status === "approved" ? <Button size="sm" onClick={() => { setPayrollPaymentTarget({ id: item.id, workerName: item.workerName, period: item.period }); setPaymentReference(""); }}>确认发放</Button> : null}</div></div>) : <EmptyState text={laborPeriod ? "当前项目和工资期间尚无真实工资条。" : "当前项目尚无真实工资条。"} />}</CardContent></Card>
          </>
        )}
        <Dialog open={Boolean(payrollPaymentTarget)} onOpenChange={open => { if (!open) { setPayrollPaymentTarget(null); setPaymentReference(""); } }}><DialogContent><DialogHeader><DialogTitle>确认工资发放</DialogTitle><DialogDescription>系统不会发起银行转账。请在外部资金流程完成后，填写付款凭证号或资金流水号，服务端会复核财务岗位、项目范围和工资条状态。</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="payment-reference">付款凭证号 / 资金流水号</Label><Input id="payment-reference" value={paymentReference} placeholder="至少 4 个字符" onChange={event => setPaymentReference(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setPayrollPaymentTarget(null)} disabled={payPayroll.isPending}>取消</Button><Button disabled={!payrollPaymentTarget || paymentReference.trim().length < 4 || payPayroll.isPending} onClick={() => payrollPaymentTarget && payPayroll.mutate({ id: payrollPaymentTarget.id, paymentReference: paymentReference.trim() })}>{payPayroll.isPending ? "正在确认…" : `确认 ${payrollPaymentTarget?.workerName ?? "工资条"} 发放`}</Button></DialogFooter></DialogContent></Dialog>
      </div>
    );
  };

  const renderMachinery = () => {
    const machines = machineryLedger.data ?? [];
    const costs = machineCosts.data ?? [];
    const selectedMachine = machines.find(machine => String(machine.id) === selectedMachineId);
    const openMachineEditor = (machine?: typeof machines[number]) => {
      setMachineForm(machine ? {
        id: machine.id,
        projectId: String(machine.projectId),
        operatorUserId: machine.operatorUserId ? String(machine.operatorUserId) : "",
        code: machine.code,
        name: machine.name,
        model: machine.model ?? "",
        ownership: machine.ownership,
        supplierName: machine.supplierName ?? "",
        plateOrAssetNo: machine.plateOrAssetNo ?? "",
        status: machine.status,
        leaseBillingType: machine.leaseTerms?.billingType ?? "monthly",
        leaseRate: machine.leaseTerms?.rate ? String(machine.leaseTerms.rate) : "",
        leaseStartDate: machine.leaseTerms?.effectiveFrom ? toLocalDateInput(machine.leaseTerms.effectiveFrom) : "",
        leaseEndDate: machine.leaseTerms?.effectiveTo ? toLocalDateInput(machine.leaseTerms.effectiveTo) : "",
      } : { ...EMPTY_MACHINE_FORM, projectId: String(workspaceProjectId) });
      setMachineDialogOpen(true);
    };
    const openMachineCostEditor = () => {
      if (!selectedMachine) return toast.error("请先选择机械台账");
      setMachineCostForm({ ...EMPTY_MACHINE_COST_FORM, machineId: String(selectedMachine.id), projectId: String(workspaceProjectId), occurredAt: toLocalDateTimeInput(new Date()) });
      setMachineCostDialogOpen(true);
    };
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">机械资源 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">机械台账与成本结算</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">机械档案、操作员、产权/租赁、状态、成本录入与结算均在当前 PC 台账完成；已退役设备保留历史责任链。</p></div><Button onClick={() => openMachineEditor()} disabled={!hasBusinessWorkspaceProject}>新建机械档案</Button></div>
        {renderWorkspaceProjectFilter("机械项目范围", "选择项目后读取机械资源台账。选择具体机械后再读取其真实成本记录，避免无筛选的成本明细暴露。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实机械资源台账。" /> : machineryLedger.isLoading ? <EmptyState text="正在读取机械资源台账…" /> : machineryLedger.isError ? <EmptyState text="暂无法读取机械资源，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="机械总数" value={machines.length} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={Settings2} /><MetricCard title="作业中" value={machines.filter(item => item.status === "working").length} description="当前可见机械资源" icon={BarChart3} /><MetricCard title="维修中" value={machines.filter(item => item.status === "repairing").length} description="需关注维修安排" icon={ScrollText} /><MetricCard title="已选成本记录" value={costs.length} description={selectedMachine ? selectedMachine.name : "请先选择机械"} icon={ShieldCheck} /></section>
            <Card className="border-[#d8e3e0]">
              <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">机械档案维护</CardTitle><CardDescription>先从下方台账选择机械，再在此处查看资产信息、维护资料、登记成本或进入同项目调度。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!selectedMachine} onClick={() => selectedMachine && setDesktopRecordDetail({ title: `机械档案 · ${selectedMachine.name}`, description: "机械档案、操作员及状态由超级管理后台受控维护；退役设备不物理删除，以保留成本和责任链。", fields: [{ label: "机械编号", value: selectedMachine.code }, { label: "项目", value: selectedWorkspaceProject?.name ?? `#${selectedMachine.projectId}` }, { label: "型号", value: selectedMachine.model || "未登记" }, { label: "产权", value: selectedMachine.ownership === "owned" ? "自有" : "外租" }, { label: "供应商", value: selectedMachine.supplierName || "未登记" }, { label: "资产/车牌", value: selectedMachine.plateOrAssetNo || "未登记" }, { label: "操作员", value: selectedMachine.operatorUserId ? userNameById.get(selectedMachine.operatorUserId) ?? `用户 #${selectedMachine.operatorUserId}` : "未分配" }, { label: "当前状态", value: <BusinessStatusBadge status={selectedMachine.status} /> }] })}>查看档案</Button><Button size="sm" variant="outline" disabled={!selectedMachine} onClick={() => selectedMachine && openMachineEditor(selectedMachine)}>编辑档案</Button><Button size="sm" disabled={!selectedMachine} onClick={openMachineCostEditor}>录入成本</Button><Button size="sm" variant="outline" onClick={() => setLocation("/admin/transport")}>关联运输调度</Button></div></CardHeader>
              <CardContent>{selectedMachine ? <div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-slate-500">编号</p><p className="mt-1 font-medium text-slate-800">{selectedMachine.code}</p></div><div><p className="text-xs text-slate-500">操作员</p><p className="mt-1 font-medium text-slate-800">{selectedMachine.operatorUserId ? userNameById.get(selectedMachine.operatorUserId) ?? `用户 #${selectedMachine.operatorUserId}` : "未分配"}</p></div><div><p className="text-xs text-slate-500">资产/车牌</p><p className="mt-1 font-medium text-slate-800">{selectedMachine.plateOrAssetNo || "未登记"}</p></div><div><p className="text-xs text-slate-500">状态</p><div className="mt-1"><BusinessStatusBadge status={selectedMachine.status} /></div></div></div> : <EmptyState text="请选择下方机械台账后进行查看、编辑或成本录入。" />}</CardContent>
            </Card>
            <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
              <Card><CardHeader><CardTitle className="text-base">机械资源列表</CardTitle><CardDescription>点击机械后读取该机械的真实成本记录。机械档案编辑和计价规则维护仍走完整业务入口。</CardDescription></CardHeader><CardContent className="space-y-2">{machines.length ? machines.map(machine => <button key={machine.id} className={`w-full rounded-xl border p-3 text-left transition-colors ${String(machine.id) === selectedMachineId ? "border-[#203c48] bg-[#edf4f1]" : "border-slate-100 hover:bg-slate-50"}`} onClick={() => setSelectedMachineId(String(machine.id))}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{machine.name}</p><Badge variant="outline">{machine.code}</Badge><BusinessStatusBadge status={machine.status} /></div><Badge variant="outline">{machine.ownership === "owned" ? "自有" : "外租"}</Badge></div><p className="mt-1 text-xs text-slate-500">型号：{machine.model || "未登记"} · 资产/车牌：{machine.plateOrAssetNo || "未登记"} · 供应商：{machine.supplierName || "—"}</p></button>) : <EmptyState text="当前项目尚无真实机械台账。" />}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">{selectedMachine ? `${selectedMachine.name} · 成本记录` : "机械成本记录"}</CardTitle><CardDescription>审核、结算和作废操作会由服务端按机械成本状态机、项目范围与财务岗位重新校验；PC 台账不再跳转到移动端。</CardDescription></CardHeader><CardContent className="space-y-2">{!selectedMachineId ? <EmptyState text="请选择左侧机械，查看其真实成本记录。" /> : machineCosts.isLoading ? <EmptyState text="正在读取机械成本记录…" /> : machineCosts.isError ? <EmptyState text="暂无法读取机械成本记录。" /> : costs.length ? costs.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{item.costType === "fuel" ? "油料" : item.costType === "repair" ? "维修" : item.costType === "overtime" ? "加班" : item.costType === "mobilization" ? "进退场" : "其他"}</p><BusinessStatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{displayDate(item.occurredAt)} · 数量 {item.quantity} · 单价 ¥{displayMoney(item.unitPrice)} · 金额 ¥{displayMoney(item.amount)}</p></div><div className="flex flex-wrap gap-2">{item.status === "draft" ? <Button size="sm" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "approved" })} disabled={transitionMachineCost.isPending}>审核</Button> : null}{item.status === "approved" ? <Button size="sm" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "settled" })} disabled={transitionMachineCost.isPending}>确认结算</Button> : null}{["draft", "approved"].includes(item.status) ? <Button size="sm" variant="outline" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionMachineCost.isPending}>作废</Button> : null}</div></div>) : <EmptyState text="当前机械尚无真实成本记录。" />}</CardContent></Card>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTransport = () => {
    const vehiclesForProject = transportVehicleLedger.data ?? [];
    const trips = transportTrips.data ?? [];
    const activeTrips = trips.filter(item => item.status !== "void");
    const totalAmount = activeTrips.reduce((sum, item) => sum + Number(item.calculatedAmount ?? 0), 0);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">运输调度 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">车辆、趟次与结算状态</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">展示真实车辆资源与指定自然日趟次。运价快照、理论方量、异常检测、核验、详情查看和结算均在当前 PC 台账中完成。</p></div></div>
        {renderWorkspaceProjectFilter("运输项目范围", "选择项目后读取车辆台账和实际运输趟次。司机、运输管理和财务操作由服务端按角色、项目和状态分别校验。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实运输调度台账。" /> : transportVehicleLedger.isLoading || transportTrips.isLoading ? <EmptyState text="正在读取车辆和运输趟次…" /> : transportVehicleLedger.isError || transportTrips.isError ? <EmptyState text="暂无法读取运输调度数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="可见车辆" value={vehiclesForProject.length} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={Truck} /><MetricCard title="可调度车辆" value={vehiclesForProject.filter(item => item.status === "active").length} description="车辆状态来自真实台账" icon={ShieldCheck} /><MetricCard title="当日有效趟次" value={activeTrips.length} description={transportDate || "全部日期"} icon={ScrollText} /><MetricCard title="可结算金额" value={Math.round(totalAmount * 100) / 100} description="非作废趟次金额合计" icon={BarChart3} /></section>
            <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
              <Card><CardHeader><CardTitle className="text-base">车辆资源台账</CardTitle><CardDescription>与统一车辆主数据使用同一真实数据源。车辆档案、运价规则和趟次新建通过完整运输维护入口办理。</CardDescription></CardHeader><CardContent className="space-y-2">{vehiclesForProject.length ? vehiclesForProject.map(vehicle => <div key={vehicle.id} className="rounded-xl border border-slate-100 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{vehicle.plateNo}</p><BusinessStatusBadge status={vehicle.status} /></div><Badge variant="outline">理论 {vehicle.theoreticalVolumeCubicMeters} m³</Badge></div><p className="mt-1 text-xs text-slate-500">{vehicle.vehicleType} · 所属人：{vehicle.ownerName || "未登记"} · 货厢 {vehicle.boxLengthMeters} × {vehicle.boxWidthMeters} × {vehicle.boxHeightMeters} m · 载重 {vehicle.payloadTons ?? "—"} t</p></div>) : <EmptyState text="当前项目尚无真实运输车辆台账。" />}</CardContent></Card>
              <Card><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">运输趟次</CardTitle><CardDescription>每条记录的运价和参数取自创建时的服务端快照，历史金额不会被后续运价规则修改。</CardDescription></div><div className="min-w-[170px]"><Label htmlFor="transport-date">运输日期</Label><Input id="transport-date" className="mt-1" type="date" value={transportDate} onChange={event => setTransportDate(event.target.value)} /></div></CardHeader><CardContent className="space-y-2">{trips.length ? trips.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{item.tripNo}</p><BusinessStatusBadge status={item.status} />{item.anomalies.length ? <Badge className="bg-amber-50 text-amber-700">{item.anomalies.length} 项提示</Badge> : null}</div><p className="mt-1 text-xs text-slate-500">{displayDate(item.startAt)} · 车辆 #{item.vehicleId} · 距离 {item.actualDistanceKm ?? "—"} km · 方量 {item.volumeCubicMeters ?? "—"} m³ · 运费 ¥{displayMoney(item.calculatedAmount)}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `运输趟次明细 · ${item.tripNo}`, description: "此为 PC 后台的运输趟次快照。金额、状态和异常均以服务端记录为准。", fields: [{ label: "状态", value: <BusinessStatusBadge status={item.status} /> }, { label: "车辆编号", value: `#${item.vehicleId}` }, { label: "开始时间", value: displayDate(item.startAt) }, { label: "实际距离", value: item.actualDistanceKm === null ? "未记录" : `${item.actualDistanceKm} km` }, { label: "方量", value: item.volumeCubicMeters === null ? "未记录" : `${item.volumeCubicMeters} m³` }, { label: "重量", value: item.weightTons === null ? "未记录" : `${item.weightTons} t` }, { label: "结算金额", value: `¥ ${displayMoney(item.calculatedAmount)}` }, { label: "异常提示", value: item.anomalies.length ? item.anomalies.join("；") : "无" }] })}>查看明细</Button>{item.status === "draft" ? <Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "submitted" })} disabled={transitionTransportTrip.isPending}>提交</Button> : null}{item.status === "submitted" ? <><Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "verified" })} disabled={transitionTransportTrip.isPending}>核验</Button><Button size="sm" variant="outline" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionTransportTrip.isPending}>作废</Button></> : null}{item.status === "verified" ? <><Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "settled" })} disabled={transitionTransportTrip.isPending}>确认结算</Button><Button size="sm" variant="outline" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionTransportTrip.isPending}>作废</Button></> : null}</div></div>) : <EmptyState text={transportDate ? "当前项目和日期尚无真实运输趟次。" : "当前项目尚无真实运输趟次。"} />}</CardContent></Card>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderRfidManagement = () => {
    if (!hasBusinessWorkspaceProject) return null;
    const writerDevices = rfidWriterDevices.data ?? [];
    const cards = vehicleRfidCards.data ?? [];
    return (
      <div className="space-y-5">
        <Card className="border-[#d8e3e0] bg-[#f8fcfb]">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><p className="text-sm font-medium text-[#203c48]">射频写卡 · 受控预留</p><CardTitle className="mt-1 text-base">车辆卡绑定与写卡任务</CardTitle><CardDescription className="mt-1 max-w-3xl">系统生成并审计车辆、车型、货厢、司机与联系电话载荷；当前不伪造 USB/串口直连，现场需使用已登记写卡器完成物理写入后再确认结果。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM); setRfidWriterDialogOpen(true); }}>登记写卡器</Button><Button size="sm" onClick={() => { setRfidCardForm({ ...EMPTY_RFID_CARD_FORM, vehicleId: transportVehicleLedger.data?.[0] ? String(transportVehicleLedger.data[0].id) : "", writerDeviceId: writerDevices[0] ? String(writerDevices[0].id) : "" }); setRfidCardDialogOpen(true); }} disabled={!transportVehicleLedger.data?.length}>绑定车辆卡</Button></div></CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
            <div className="space-y-2"><p className="text-sm font-medium text-slate-800">写卡器设备</p>{writerDevices.length ? writerDevices.map(device => <div key={device.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{device.displayName}</p><BusinessStatusBadge status={device.status} /></div><p className="mt-1 text-xs text-slate-500">编号 {device.deviceCode} · 型号 {device.model || "待采购/未登记"} · {device.connectionMode === "manual_placeholder" ? "人工确认模式" : device.connectionMode}</p></div>) : <EmptyState text="尚未登记写卡器。可先登记编号和型号，硬件协议后续再受控接入。" />}</div>
            <div className="space-y-2"><p className="text-sm font-medium text-slate-800">车辆射频卡</p>{cards.length ? cards.map(card => <div key={card.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{card.plateNo}</p><BusinessStatusBadge status={card.status} /><Badge variant="outline">卡 {card.cardUidMasked}</Badge></div><p className="mt-1 text-xs text-slate-500">司机电话 {card.driverPhoneMasked || "未登记"} · 写卡器 {card.writerName || "未指定"}{card.writerModel ? `（${card.writerModel}）` : ""} · 最近写入 {displayDate(card.lastWrittenAt)}</p></div><Button size="sm" onClick={() => prepareRfidCardWrite.mutate({ cardId: Number(card.id), projectId: workspaceProjectId, writerDeviceId: card.writerDeviceId ?? null, action: card.lastWrittenAt ? "rewrite" : "issue" })} disabled={prepareRfidCardWrite.isPending || card.status !== "active"}>{prepareRfidCardWrite.isPending ? "生成中…" : card.lastWrittenAt ? "生成补写任务" : "生成写卡任务"}</Button></div></div>) : <EmptyState text="尚未绑定车辆射频卡。请先登记车辆和司机，再读取卡 UID 完成绑定。" />}</div>
          </CardContent>
        </Card>

        <Dialog open={rfidWriterDialogOpen} onOpenChange={setRfidWriterDialogOpen}><DialogContent><DialogHeader><DialogTitle>登记射频写卡器</DialogTitle><DialogDescription>目前先记录写卡器型号与使用状态；未接入设备适配器前，系统只允许生成并人工确认写卡任务。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><Field label="设备编号"><Input value={rfidWriterDeviceForm.deviceCode} placeholder="例如 RFID-W-001" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, deviceCode: event.target.value }))} /></Field><Field label="显示名称"><Input value={rfidWriterDeviceForm.displayName} placeholder="装土点写卡器" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, displayName: event.target.value }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="型号（预留）"><Input value={rfidWriterDeviceForm.model} placeholder="采购后填写" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, model: event.target.value }))} /></Field><Field label="连接方式"><Select value={rfidWriterDeviceForm.connectionMode} onValueChange={value => setRfidWriterDeviceForm(current => ({ ...current, connectionMode: value as RfidWriterDeviceForm["connectionMode"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual_placeholder">人工确认（当前）</SelectItem><SelectItem value="usb">USB（预留）</SelectItem><SelectItem value="serial">串口（预留）</SelectItem><SelectItem value="network">网络（预留）</SelectItem></SelectContent></Select></Field></div><Field label="备注"><Input value={rfidWriterDeviceForm.remarks} onChange={event => setRfidWriterDeviceForm(current => ({ ...current, remarks: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setRfidWriterDialogOpen(false)}>取消</Button><Button disabled={!rfidWriterDeviceForm.deviceCode.trim() || !rfidWriterDeviceForm.displayName.trim() || saveRfidWriterDevice.isPending} onClick={() => saveRfidWriterDevice.mutate({ projectId: workspaceProjectId, deviceCode: rfidWriterDeviceForm.deviceCode, displayName: rfidWriterDeviceForm.displayName, model: rfidWriterDeviceForm.model || null, connectionMode: rfidWriterDeviceForm.connectionMode, status: rfidWriterDeviceForm.status, remarks: rfidWriterDeviceForm.remarks || null })}>{saveRfidWriterDevice.isPending ? "保存中…" : "保存设备"}</Button></DialogFooter></DialogContent></Dialog>

        <Dialog open={rfidCardDialogOpen} onOpenChange={setRfidCardDialogOpen}><DialogContent><DialogHeader><DialogTitle>绑定车辆射频卡</DialogTitle><DialogDescription>卡 UID 和司机电话仅用于本次绑定；服务端只保存 UID 指纹、电话密文和掩码。请勿将身份证、银行卡或结算金额写入卡片。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><Field label="车辆"><Select value={rfidCardForm.vehicleId} onValueChange={value => setRfidCardForm(current => ({ ...current, vehicleId: value }))}><SelectTrigger><SelectValue placeholder="选择车辆" /></SelectTrigger><SelectContent>{transportVehicleLedger.data?.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select></Field><Field label="写卡器（可选）"><Select value={rfidCardForm.writerDeviceId || "UNASSIGNED"} onValueChange={value => setRfidCardForm(current => ({ ...current, writerDeviceId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择写卡器" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不指定</SelectItem>{writerDevices.filter(device => device.status === "active").map(device => <SelectItem key={device.id} value={String(device.id)}>{device.displayName} · {device.deviceCode}</SelectItem>)}</SelectContent></Select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="读取的卡 UID"><Input value={rfidCardForm.cardUid} placeholder="仅本次输入，保存后不回显" onChange={event => setRfidCardForm(current => ({ ...current, cardUid: event.target.value }))} /></Field><Field label="司机联系电话"><Input value={rfidCardForm.driverPhone} placeholder="仅本次输入，保存后加密" onChange={event => setRfidCardForm(current => ({ ...current, driverPhone: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setRfidCardDialogOpen(false)}>取消</Button><Button disabled={!rfidCardForm.vehicleId || !rfidCardForm.cardUid.trim() || !rfidCardForm.driverPhone.trim() || saveVehicleRfidCard.isPending} onClick={() => saveVehicleRfidCard.mutate({ projectId: workspaceProjectId, vehicleId: Number(rfidCardForm.vehicleId), writerDeviceId: rfidCardForm.writerDeviceId ? Number(rfidCardForm.writerDeviceId) : null, cardUid: rfidCardForm.cardUid, driverPhone: rfidCardForm.driverPhone, status: rfidCardForm.status })}>{saveVehicleRfidCard.isPending ? "保存中…" : "保存绑定"}</Button></DialogFooter></DialogContent></Dialog>

        <Dialog open={Boolean(rfidWritePreview)} onOpenChange={open => { if (!open) setRfidWritePreview(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>受控写卡载荷 · {rfidWritePreview?.jobNo}</DialogTitle><DialogDescription>请将下列载荷写入已绑定物理卡。写入成功后再确认；此处内容不保存到数据库，关闭窗口后需重新生成任务。</DialogDescription></DialogHeader><pre className="max-h-[45vh] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-emerald-100">{rfidWritePreview ? JSON.stringify(rfidWritePreview.payload, null, 2) : ""}</pre><DialogFooter><Button variant="outline" onClick={() => rfidWritePreview && confirmRfidCardWrite.mutate({ id: rfidWritePreview.jobId, projectId: workspaceProjectId, success: false, failureReason: "现场未完成物理写卡" })} disabled={confirmRfidCardWrite.isPending}>记录写卡失败</Button><Button onClick={() => rfidWritePreview && confirmRfidCardWrite.mutate({ id: rfidWritePreview.jobId, projectId: workspaceProjectId, success: true })} disabled={confirmRfidCardWrite.isPending}>{confirmRfidCardWrite.isPending ? "确认中…" : "已完成物理写卡"}</Button></DialogFooter></DialogContent></Dialog>
      </div>
    );
  };

  const renderBusiness = () => (
    <div className="space-y-6" id="business-governance-report">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[#203c48]">全业务治理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">业务模块、统计与安全备份</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">超级管理员可从本页进入各业务模块维护真实数据。原有审批、状态流转、项目范围与敏感字段保护仍由服务端执行，不因后台入口而放宽。</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => businessStatistics.refetch()} disabled={businessStatistics.isFetching}>刷新统计</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />打印当前页</Button>
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="business-project-filter">统计项目</Label>
            <Select value={businessFilter.projectId} onValueChange={projectId => setBusinessFilter(current => ({ ...current, projectId }))}>
              <SelectTrigger id="business-project-filter" className="mt-1"><SelectValue placeholder="选择项目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目</SelectItem>
                {(projects.data ?? []).filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label htmlFor="business-period-filter">统计期间</Label>
            <Input id="business-period-filter" className="mt-1" type="month" value={businessFilter.period} onChange={event => setBusinessFilter(current => ({ ...current, period: event.target.value }))} />
          </div>
          <Button className="print:hidden" size="sm" variant="outline" onClick={() => setBusinessFilter({ projectId: "all", period: "" })} disabled={businessFilter.projectId === "all" && !businessFilter.period}>清除筛选</Button>
          <p className="w-full text-xs text-slate-500">当前统计与打印口径：{businessFilterLabel}。基础档案按创建时间、业务单据按发生日期或结算期间统计。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全业务管理入口</CardTitle>
          <CardDescription>每个入口均跳转至已部署的真实业务工作台；超级管理员可维护记录，普通人员仍会受到角色、部门与项目范围限制。</CardDescription>
        </CardHeader>
        <CardContent>
          {!isAuthenticated ? <EmptyState text="请先登录超级管理员账号后读取真实业务统计。" /> : businessStatistics.isLoading ? <EmptyState text="正在汇总真实业务记录…" /> : businessStatistics.isError ? <EmptyState text="暂无法读取全业务统计，请确认当前账号具有超级管理员权限。" /> : businessStatistics.data?.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {businessStatistics.data.map(module => (
                <div key={module.code} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{module.name}</p><p className="mt-1 text-xs text-slate-500">当前真实记录</p></div><Badge variant="secondary">{module.recordCount} 条</Badge></div>
                  <Button className="mt-4 w-full print:hidden" size="sm" variant="outline" onClick={() => setLocation(ADMIN_BUSINESS_ROUTE_BY_MODULE[module.code] ?? module.route)}><ExternalLink className="mr-1.5 h-4 w-4" />进入维护</Button>
                </div>
              ))}
            </div>
          ) : <EmptyState text="暂无业务模块统计结果。" />}
        </CardContent>
      </Card>

      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">业务数据逻辑备份</CardTitle>
            <CardDescription>创建只包含业务数据与关联元数据的 JSON 快照；不包含口令摘要、接口密钥、敏感系统配置、审计日志或影像文件本体。在线恢复未开放，防止误覆盖生产数据。</CardDescription>
          </div>
          <Button className="shrink-0 print:hidden" size="sm" onClick={() => createBackup.mutate()} disabled={createBackup.isPending}><DatabaseBackup className="mr-1.5 h-4 w-4" />{createBackup.isPending ? "正在归档…" : "创建备份"}</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAuthenticated ? <EmptyState text="请先登录超级管理员账号后读取已归档备份。" /> : backups.isLoading ? <EmptyState text="正在读取已归档备份…" /> : backups.isError ? <EmptyState text="暂无法读取备份目录，请稍后重试。" /> : backups.data?.length ? backups.data.map(backup => (
            <div key={backup.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{backup.fileName}</p><p className="mt-1 text-xs text-slate-500">{displayDate(backup.createdAt)} · {backup.recordCount} 条 · SHA-256：{backup.sha256.slice(0, 12)}… · 范围 {backup.scopeVersion}</p></div>
              <Button className="print:hidden" size="sm" variant="outline" onClick={() => downloadBackup.mutate({ id: Number(backup.id) })} disabled={downloadBackup.isPending}>下载</Button>
            </div>
          )) : <EmptyState text="尚无已归档备份。首次创建备份前不会生成任何示例文件。" />}
        </CardContent>
      </Card>
    </div>
  );

  const renderFinance = () => (
    <div className="space-y-5">
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader><CardTitle className="text-base">审计级财务管理</CardTitle><CardDescription>按项目和会计期间读取真实费用、成本、应收应付及发票状态。发票台账不重复计入成本；每日日结生成不可变快照，供会计审核与凭证装订打印。</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <Select value={financeProjectId} onValueChange={setFinanceProjectId}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select>
          <Input type="month" value={financePeriod} onChange={event => setFinancePeriod(event.target.value)} aria-label="会计期间" />
          <Button variant="outline" onClick={() => { void financeSummary.refetch(); void financeInvoices.refetch(); }}>刷新统计</Button>
        </CardContent>
      </Card>
      {!financeProjectId ? <EmptyState text="请选择项目后读取真实费用、成本和发票审计台账。" /> : <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="确认收入" value={financeSummary.data?.incomeAmount} description="不含重复回款口径" icon={BarChart3} />
          <MetricCard title="项目成本/开支" value={financeSummary.data?.expenseAmount} description="已登记支出流水" icon={ScrollText} />
          <MetricCard title="已开票金额" value={financeInvoices.data?.summary.totalAmount} description="不含作废与红冲" icon={ScrollText} />
          <MetricCard title="待认证发票" value={financeInvoices.data?.summary.pendingAmount} description="须会计复核" icon={ScrollText} />
        </div>
        <Card><CardHeader><CardTitle className="text-base">发票与成本审计台账</CardTitle><CardDescription>费用明细与发票按项目范围管理；认证、作废和红冲需由会计或财务负责人通过服务端状态机执行。</CardDescription></CardHeader><CardContent>{financeInvoices.isLoading ? <EmptyState text="正在读取发票台账…" /> : financeInvoices.data?.invoices.length ? <div className="space-y-2">{financeInvoices.data.invoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><div><p className="text-sm font-medium text-slate-800">{invoice.invoiceNo} · {invoice.counterpartyName}</p><p className="mt-1 text-xs text-slate-500">{displayDate(invoice.issuedAt)} · {invoice.invoiceType} · 税额 ¥ {displayMoney(invoice.taxAmount)}</p></div><div className="flex items-center gap-2"><BusinessStatusBadge status={invoice.status} /><span className="font-medium text-slate-800">¥ {displayMoney(invoice.amount)}</span></div></div>)}</div> : <EmptyState text="当前期间暂无发票，财务岗位可通过发票台账接口登记真实凭证。" />}</CardContent></Card>
        <Card className="print:border-0 print:shadow-none"><CardHeader><CardTitle className="text-base">后勤每日开支会计日结与打印</CardTitle><CardDescription>日结时由服务端重新汇总当日流水与发票，生成 SHA-256 快照；封存后不可重复日结，可作为每日凭证装订页打印。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap items-end gap-3"><div className="grid gap-1.5"><Label>日结日期</Label><Input type="date" value={financeClosingDate} onChange={event => setFinanceClosingDate(event.target.value)} /></div><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={closeDailyAccount.isPending} onClick={() => closeDailyAccount.mutate({ projectId: Number(financeProjectId), closingDate: financeClosingDate })}>{closeDailyAccount.isPending ? "正在日结…" : "执行日结并封存"}</Button><Button variant="outline" disabled={!dailyAccountingReport.data} onClick={() => window.print()}>打印日结装订页</Button></div>{dailyAccountingReport.data ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium text-slate-900">日结单：{dailyAccountingReport.data.closure.closingNo}</p><p className="mt-1 text-xs text-slate-500">封存日期：{financeClosingDate} · 快照指纹：{dailyAccountingReport.data.closure.snapshotHash.slice(0, 16)}…</p></div><div className="text-right text-sm"><p>收入：¥ {displayMoney(dailyAccountingReport.data.closure.totalIncome)}</p><p>开支：¥ {displayMoney(dailyAccountingReport.data.closure.totalExpense)}</p><p>发票：{dailyAccountingReport.data.closure.invoiceCount} 张 · ¥ {displayMoney(dailyAccountingReport.data.closure.invoiceAmount)}</p></div></div></div> : <p className="text-sm text-slate-500">尚未封存该日期，执行日结后将显示可打印的审计快照。</p>}</CardContent></Card>
      </>}
    </div>
  );

  const renderLegacyBroadcast = () => {
    const scopeOptions = broadcastForm.audienceType === "project" ? (broadcastOptions.data?.projects ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` })) : broadcastForm.audienceType === "organization" ? (broadcastOptions.data?.organizations ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` })) : (broadcastOptions.data?.roles ?? []).map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }));
    const scopeTitle = broadcastForm.audienceType === "project" ? "收件项目" : broadcastForm.audienceType === "organization" ? "收件组织" : "收件岗位";
    const describeBroadcastScope = (item: NonNullable<typeof broadcasts.data>[number]) => item.audienceType === "project" ? (broadcastOptions.data?.projects ?? []).find(project => project.id === item.projectId)?.name ?? "项目范围" : item.audienceType === "organization" ? (broadcastOptions.data?.organizations ?? []).find(organization => organization.id === item.organizationId)?.name ?? "组织范围" : (broadcastOptions.data?.roles ?? []).find(role => role.code === item.roleCode)?.name ?? "岗位范围";
    const editBroadcast = (item: NonNullable<typeof broadcasts.data>[number]) => setBroadcastForm({ id: Number(item.id), title: item.title, content: item.content, deepLink: item.deepLink ?? "", audienceType: item.audienceType, scopeValue: item.audienceType === "project" ? String(item.projectId ?? "") : item.audienceType === "organization" ? String(item.organizationId ?? "") : item.roleCode ?? "" });
    return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">认证服务号通知中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">受控群发设置与发布</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">群发必须限定到单一项目、组织或岗位范围，先预览已绑定收件人数，再经审批发布。投递审计仅展示收件人姓名、职务、授权范围、确认状态和脱敏失败原因，不展示 OpenID 或内部编号。</p></div><Button variant="outline" size="sm" onClick={() => { setBroadcastForm(EMPTY_BROADCAST_FORM); setSelectedBroadcastId(undefined); }}>新建草稿</Button></div>
      <Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="text-base">群发草稿与范围预览</CardTitle><CardDescription>所有范围和收件人均在服务端重新核验；未关注或未绑定服务号的人员会被统计但不会被强行投递。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2"><div><Label>通知标题</Label><Input className="mt-1" value={broadcastForm.title} maxLength={80} placeholder="例如：本周施工计划调整通知" onChange={event => setBroadcastForm(current => ({ ...current, title: event.target.value }))} /></div><div><Label>系统跳转地址（可选）</Label><Input className="mt-1" value={broadcastForm.deepLink} placeholder="/mobile/messages" onChange={event => setBroadcastForm(current => ({ ...current, deepLink: event.target.value }))} /></div></div><div><Label>通知内容</Label><textarea className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" value={broadcastForm.content} maxLength={1000} placeholder="请填写不含身份证、银行卡、完整电话号码或其他敏感个人信息的业务通知。" onChange={event => setBroadcastForm(current => ({ ...current, content: event.target.value }))} /></div><div className="grid gap-4 lg:grid-cols-2"><div><Label>收件范围类型</Label><Select value={broadcastForm.audienceType} onValueChange={value => setBroadcastForm(current => ({ ...current, audienceType: value as BroadcastAudienceType, scopeValue: "" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">按项目</SelectItem><SelectItem value="organization">按组织及下级组织</SelectItem><SelectItem value="role">按岗位</SelectItem></SelectContent></Select></div><div><Label>{scopeTitle}</Label><Select value={broadcastForm.scopeValue || undefined} onValueChange={value => setBroadcastForm(current => ({ ...current, scopeValue: value }))} disabled={broadcastOptions.isLoading || !scopeOptions.length}><SelectTrigger className="mt-1"><SelectValue placeholder={broadcastOptions.isLoading ? "正在读取范围选项…" : `选择${scopeTitle}`} /></SelectTrigger><SelectContent>{scopeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">范围内有效人员</p><p className="mt-1 text-xl font-semibold text-slate-800">{validBroadcastScope ? broadcastAudiencePreview.data?.qualifiedCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">已绑定可投递</p><p className="mt-1 text-xl font-semibold text-emerald-700">{validBroadcastScope ? broadcastAudiencePreview.data?.boundRecipientCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">未绑定/不会投递</p><p className="mt-1 text-xl font-semibold text-amber-700">{validBroadcastScope ? broadcastAudiencePreview.data?.unboundCount ?? "—" : "—"}</p></div></div>{broadcastAudiencePreview.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">范围预览失败：{broadcastAudiencePreview.error.message}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBroadcastForm(EMPTY_BROADCAST_FORM)}>清空</Button><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!broadcastForm.title.trim() || !broadcastForm.content.trim() || !validBroadcastScope || saveBroadcastDraft.isPending} onClick={() => saveBroadcastDraft.mutate({ id: broadcastForm.id, title: broadcastForm.title.trim(), content: broadcastForm.content.trim(), deepLink: broadcastForm.deepLink.trim() || null, ...getBroadcastAudienceInput(broadcastForm) })}>{saveBroadcastDraft.isPending ? "保存中…" : broadcastForm.id ? "更新草稿" : "保存草稿"}</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">发布审批与投递审计</CardTitle><CardDescription>审批通过后才能发布。发布时按当前有效范围重新解析实际绑定收件人，并对每个收件人使用独立幂等键，防止重复投递。</CardDescription></CardHeader><CardContent>{broadcasts.isLoading ? <EmptyState text="正在读取群发台账…" /> : broadcasts.isError ? <EmptyState text="无法读取群发台账，请确认当前账号具有超级管理员权限。" /> : broadcasts.data?.length ? <div className="space-y-3">{broadcasts.data.map(item => <div key={item.id} className={`rounded-xl border p-4 ${selectedBroadcastId === Number(item.id) ? "border-[#203c48] bg-[#f5f9f8]" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.title}</p><BusinessStatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{item.broadcastNo} · 创建于 {displayDate(item.createdAt)} · 范围：{item.audienceType === "project" ? `项目 #${item.projectId}` : item.audienceType === "organization" ? `组织 #${item.organizationId}` : `岗位 ${item.roleCode}`}</p><p className="mt-2 max-w-3xl text-sm text-slate-700">{item.content}</p>{item.reviewNote ? <p className="mt-2 text-xs text-amber-800">审批说明：{item.reviewNote}</p> : null}</div><div className="text-right text-xs text-slate-500"><p>计划收件：{item.recipientCount}</p><p className="mt-1 text-emerald-700">成功：{item.deliveredCount}</p><p className="mt-1 text-rose-700">失败：{item.failedCount}</p><p className="mt-1 text-amber-700">跳过：{item.skippedCount}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedBroadcastId(Number(item.id))}>查看投递审计</Button>{["draft", "rejected"].includes(item.status) ? <><Button size="sm" variant="outline" onClick={() => editBroadcast(item)}>编辑</Button><Button size="sm" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "submit", reviewNote: null })} disabled={reviewBroadcast.isPending}>提交审批</Button></> : null}{item.status === "submitted" ? <><Button size="sm" className="bg-[#47754d] hover:bg-[#355c3c]" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "approve", reviewNote: "已核对内容与收件范围" })} disabled={reviewBroadcast.isPending}>审批通过</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "reject", reviewNote: "请补充或修正通知内容与收件范围" })} disabled={reviewBroadcast.isPending}>退回修改</Button></> : null}{item.status === "approved" ? <Button size="sm" className="bg-[#8b3f20] hover:bg-[#6d3421]" onClick={() => publishBroadcast.mutate({ id: Number(item.id) })} disabled={publishBroadcast.isPending}>发布服务号通知</Button> : null}{["draft", "submitted", "approved", "rejected"].includes(item.status) ? <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "cancel", reviewNote: null })} disabled={reviewBroadcast.isPending}>取消</Button> : null}</div></div>)}</div> : <EmptyState text="尚无群发记录。请先建立范围明确的群发草稿，再预览、审批和发布。" />}</CardContent></Card>
      {selectedBroadcastId ? <Card><CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-base">逐收件人投递与确认审计</CardTitle><CardDescription>显示姓名、岗位、授权范围、投递结果和“收到”确认时间；不展示内部用户编号、OpenID、手机号或密钥。</CardDescription></div><Button size="sm" variant="outline" onClick={() => broadcastDeliveries.refetch()} disabled={broadcastDeliveries.isFetching}>刷新</Button></CardHeader><CardContent>{broadcastDeliveries.isLoading ? <EmptyState text="正在读取投递审计…" /> : broadcastDeliveries.data?.length ? <div className="space-y-2">{broadcastDeliveries.data.map(delivery => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{delivery.recipientName}</p><p className="mt-1 text-xs text-slate-600">{delivery.recipientRole ?? "岗位信息待同步"} · {delivery.recipientScope ?? "授权范围待同步"}</p><p className="mt-1 text-xs text-slate-500">最近尝试：{displayDate(delivery.attemptedAt)}{delivery.deliveryReason ? ` · 失败原因：${delivery.deliveryReason}${delivery.failureCode ? `（微信码 ${delivery.failureCode}）` : ""}` : ""}</p><p className="mt-1 text-xs text-[#80543d]">确认状态：{delivery.acknowledgementStatus === "acknowledged" ? `已确认收到（${displayDate(delivery.acknowledgedAt)}）` : delivery.acknowledgementStatus === "pending" ? "待确认收到" : "无需确认"}</p></div><BusinessStatusBadge status={delivery.deliveryStatus} /></div>)}</div> : <EmptyState text="该群发单尚未生成逐收件人投递记录。" />}</CardContent></Card> : null}
    </div>;
  };

  const renderBroadcast = () => {
    const scopeOptions = broadcastForm.audienceType === "project"
      ? (broadcastOptions.data?.projects ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` }))
      : broadcastForm.audienceType === "organization"
        ? (broadcastOptions.data?.organizations ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` }))
        : (broadcastOptions.data?.roles ?? []).map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }));
    const scopeTitle = broadcastForm.audienceType === "project" ? "收件项目" : broadcastForm.audienceType === "organization" ? "收件组织" : "收件岗位";
    const describeScope = (item: NonNullable<typeof broadcasts.data>[number]) => item.audienceType === "project"
      ? (broadcastOptions.data?.projects ?? []).find(project => project.id === item.projectId)?.name ?? "项目范围"
      : item.audienceType === "organization"
        ? (broadcastOptions.data?.organizations ?? []).find(organization => organization.id === item.organizationId)?.name ?? "组织范围"
        : (broadcastOptions.data?.roles ?? []).find(role => role.code === item.roleCode)?.name ?? "岗位范围";
    const directSendable = (status: string) => ["draft", "rejected", "submitted", "approved"].includes(status);
    return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">范围通知与确认中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">范围内站内通知</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">获授权管理员选择单一项目、组织或岗位范围后，可直接向系统消息中心发送通知。此功能不发送微信服务号消息；微信服务号仅用于具体业务事件的合规即时提醒。</p></div><Button variant="outline" size="sm" onClick={() => { setBroadcastForm(EMPTY_BROADCAST_FORM); setSelectedBroadcastId(undefined); }}>新建通知</Button></div>
      <Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="text-base">站内通知内容与发送范围</CardTitle><CardDescription>保存后即向当前授权范围的系统消息中心投递，并可要求收件人“确认收到”。本页的成功数量不代表微信服务号已送达。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2"><div><Label>通知标题</Label><Input className="mt-1" value={broadcastForm.title} maxLength={80} placeholder="例如：本周施工计划调整通知" onChange={event => setBroadcastForm(current => ({ ...current, title: event.target.value }))} /></div><div><Label>系统跳转地址（可选）</Label><Input className="mt-1" value={broadcastForm.deepLink} placeholder="/mobile/messages" onChange={event => setBroadcastForm(current => ({ ...current, deepLink: event.target.value }))} /></div></div><div><Label>通知内容</Label><textarea className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" value={broadcastForm.content} maxLength={1000} placeholder="请填写不含身份证、银行卡、完整电话号码或其他敏感个人信息的业务通知。" onChange={event => setBroadcastForm(current => ({ ...current, content: event.target.value }))} /></div><div className="grid gap-4 lg:grid-cols-2"><div><Label>范围类型</Label><Select value={broadcastForm.audienceType} onValueChange={value => setBroadcastForm(current => ({ ...current, audienceType: value as BroadcastAudienceType, scopeValue: "" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">按项目</SelectItem><SelectItem value="organization">按组织及下级组织</SelectItem><SelectItem value="role">按岗位</SelectItem></SelectContent></Select></div><div><Label>{scopeTitle}</Label><Select value={broadcastForm.scopeValue || undefined} onValueChange={value => setBroadcastForm(current => ({ ...current, scopeValue: value }))} disabled={broadcastOptions.isLoading || !scopeOptions.length}><SelectTrigger className="mt-1"><SelectValue placeholder={broadcastOptions.isLoading ? "正在读取范围选项…" : `选择${scopeTitle}`} /></SelectTrigger><SelectContent>{scopeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">范围内有效人员</p><p className="mt-1 text-xl font-semibold text-slate-800">{validBroadcastScope ? broadcastAudiencePreview.data?.qualifiedCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">已绑定服务号</p><p className="mt-1 text-xl font-semibold text-emerald-700">{validBroadcastScope ? broadcastAudiencePreview.data?.boundRecipientCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">未绑定服务号</p><p className="mt-1 text-xl font-semibold text-amber-700">{validBroadcastScope ? broadcastAudiencePreview.data?.unboundCount ?? "—" : "—"}</p></div></div>{broadcastAudiencePreview.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">范围预览失败：{broadcastAudiencePreview.error.message}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBroadcastForm(EMPTY_BROADCAST_FORM)}>清空</Button><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!broadcastForm.title.trim() || !broadcastForm.content.trim() || !validBroadcastScope || saveBroadcastDraft.isPending || publishBroadcast.isPending} onClick={() => saveBroadcastDraft.mutate({ id: broadcastForm.id, title: broadcastForm.title.trim(), content: broadcastForm.content.trim(), deepLink: broadcastForm.deepLink.trim() || null, ...getBroadcastAudienceInput(broadcastForm) })}>{saveBroadcastDraft.isPending || publishBroadcast.isPending ? "正在发送…" : "保存并发送站内通知"}</Button></div></CardContent></Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">站内通知台账与确认状态</CardTitle>
          <CardDescription>历史记录保留审计；新通知会按最新有效范围写入系统消息中心，并使用独立幂等键防止重复。微信服务号投递状态不会在此处计入成功数。</CardDescription>
        </CardHeader>
        <CardContent>
          {broadcasts.isLoading ? <EmptyState text="正在读取范围通知台账…" /> : broadcasts.isError ? <EmptyState text="无法读取范围通知台账，请确认当前账号具有超级管理员权限。" /> : broadcasts.data?.length ? <div className="space-y-3">
            {broadcasts.data.map(item => {
              const isExpanded = isInlineBroadcastDeliveryExpanded(selectedBroadcastId, Number(item.id));
              return <div key={item.id} className={`rounded-xl border p-4 ${isExpanded ? "border-[#203c48] bg-[#f5f9f8]" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.title}</p><BusinessStatusBadge status={item.status} /><Badge variant="outline">站内通知</Badge></div>
                    <p className="mt-1 text-xs text-slate-500">{item.broadcastNo} · 创建于 {displayDate(item.createdAt)} · 范围：{describeScope(item)}</p>
                    <p className="mt-2 max-w-3xl text-sm text-slate-700">{item.content}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500"><p>计划收件：{item.recipientCount}</p><p className="mt-1 text-emerald-700">站内已送达：{item.deliveredCount}</p><p className="mt-1 text-rose-700">站内失败：{item.failedCount}</p><p className="mt-1 text-amber-700">跳过：{item.skippedCount}</p><p className="mt-1 text-[#80543d]">已确认：{item.acknowledgedCount ?? 0}</p><p className="mt-1 text-slate-400">微信服务号：未在此范围通知中发送</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedBroadcastId(isExpanded ? undefined : Number(item.id))}>{isExpanded ? "收起投递明细" : "查看投递明细"}</Button>
                  {directSendable(item.status) ? <Button size="sm" className="bg-[#8b3f20] hover:bg-[#6d3421]" onClick={() => publishBroadcast.mutate({ id: Number(item.id) })} disabled={publishBroadcast.isPending}>按当前范围发送站内通知</Button> : null}
                </div>
                {isExpanded ? <div className="mt-4 border-t border-[#c9dbd6] pt-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">投递明细与确认状态</p><p className="mt-1 text-xs text-slate-500">显示姓名、岗位、授权范围、投递结果、失败原因和“收到”确认时间；不展示内部编号或敏感身份信息。</p></div><Button size="sm" variant="outline" onClick={() => broadcastDeliveries.refetch()} disabled={broadcastDeliveries.isFetching}>{broadcastDeliveries.isFetching ? "正在刷新…" : "刷新明细"}</Button></div>
                  {broadcastDeliveries.isLoading ? <EmptyState text="正在读取投递明细…" /> : broadcastDeliveries.data?.length ? <div className="space-y-2">{broadcastDeliveries.data.map(delivery => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{delivery.recipientName}</p><p className="mt-1 text-xs text-slate-600">{delivery.recipientRole ?? "岗位信息待同步"} · {delivery.recipientScope ?? "授权范围待同步"}</p><p className="mt-1 text-xs text-slate-500">最近尝试：{displayDate(delivery.attemptedAt)}{delivery.deliveryReason ? ` · 原因：${delivery.deliveryReason}` : ""}</p>{delivery.failureGuidance ? <p className="mt-1 text-xs text-amber-800">处理建议：{delivery.failureGuidance}</p> : null}<p className="mt-1 text-xs text-[#80543d]">确认状态：{delivery.acknowledgementStatus === "acknowledged" ? `已确认收到（${displayDate(delivery.acknowledgedAt)}）` : delivery.acknowledgementStatus === "pending" ? "待确认收到" : "无需确认"}</p></div><BusinessStatusBadge status={delivery.deliveryStatus} /></div>)}</div> : <EmptyState text="该通知尚未生成逐收件人投递记录。" />}
                </div> : null}
              </div>;
            })}
          </div> : <EmptyState text="尚无范围通知记录。填写通知内容并选择范围后可发送站内通知。" />}
        </CardContent>
      </Card>
    </div>;
  };

  const content = activeSection === "organization" ? renderOrganization() : activeSection === "vehicles" ? renderVehicles() : activeSection === "construction" ? renderConstruction() : activeSection === "labor" ? renderLabor() : activeSection === "machinery" ? renderMachinery() : activeSection === "transport" ? <>{renderTransport()}{renderRfidManagement()}</> : activeSection === "permission" ? renderPermissions() : activeSection === "finance" ? renderFinance() : activeSection === "broadcast" ? renderBroadcast() : activeSection === "wechat-login" ? renderWechatLogin() : activeSection === "business" ? renderBusiness() : activeSection === "settings" ? renderSettings() : activeSection === "audit" ? renderAudit() : renderOverview();

  return (
    <DashboardLayout title="工程云管 · 管理后台" menuItems={ADMIN_MENU}>
      <div className="mx-auto max-w-7xl space-y-6 py-3">
        <Tabs value={activeSection} onValueChange={value => setLocation(value === "overview" ? "/admin" : `/admin/${value}`)} className="lg:hidden">
          <TabsList className="w-full overflow-x-auto"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="organization">组织</TabsTrigger><TabsTrigger value="vehicles">车辆</TabsTrigger><TabsTrigger value="construction">施工</TabsTrigger><TabsTrigger value="labor">劳务</TabsTrigger><TabsTrigger value="machinery">机械</TabsTrigger><TabsTrigger value="transport">运输</TabsTrigger><TabsTrigger value="permission">权限</TabsTrigger><TabsTrigger value="finance">财务</TabsTrigger><TabsTrigger value="broadcast">群发</TabsTrigger><TabsTrigger value="wechat-login">微信登录</TabsTrigger><TabsTrigger value="business">业务治理</TabsTrigger><TabsTrigger value="settings">设置</TabsTrigger><TabsTrigger value="audit">审计</TabsTrigger></TabsList>
        </Tabs>
        {content}
        <AlertDialog open={Boolean(masterDataDeleteTarget)} onOpenChange={open => { if (!open) setMasterDataDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{masterDataDeleteTarget?.resource === "role_assignment" ? "确认撤销角色授权？" : "确认删除主数据？"}</AlertDialogTitle>
              <AlertDialogDescription>{masterDataDeleteTarget?.description ?? "系统将在服务端校验关联业务数据。仍被引用的记录将被拒绝删除，并提示改为停用或归档。"}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeMasterData.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!masterDataDeleteTarget || removeMasterData.isPending} onClick={() => { if (masterDataDeleteTarget) removeMasterData.mutate({ resource: masterDataDeleteTarget.resource, id: masterDataDeleteTarget.id }); }}>{masterDataDeleteTarget?.resource === "role_assignment" ? "确认撤销" : "确认删除"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={Boolean(desktopRecordDetail)} onOpenChange={open => { if (!open) setDesktopRecordDetail(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{desktopRecordDetail?.title}</DialogTitle><DialogDescription>{desktopRecordDetail?.description}</DialogDescription></DialogHeader><dl className="grid gap-3 py-2 sm:grid-cols-2">{desktopRecordDetail?.fields.map(field => <div key={field.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><dt className="text-xs text-slate-500">{field.label}</dt><dd className="mt-1 text-sm font-medium text-slate-800">{field.value}</dd></div>)}</dl>{desktopRecordDetail?.note ? <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">{desktopRecordDetail.note}</p> : null}<DialogFooter><Button onClick={() => setDesktopRecordDetail(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={machineDialogOpen} onOpenChange={open => { if (!open) { setMachineDialogOpen(false); setMachineForm(EMPTY_MACHINE_FORM); } }}>
          <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
            <DialogHeader><DialogTitle>{machineForm.id ? "维护机械档案" : "新建机械档案"}</DialogTitle><DialogDescription>项目、操作员、产权/租赁、资产标识与状态均由超级管理后台受控维护；已退役机械仅改变状态，不物理删除历史成本与责任记录。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMachine.mutate({ id: machineForm.id, projectId: Number(machineForm.projectId), operatorUserId: machineForm.operatorUserId ? Number(machineForm.operatorUserId) : null, code: machineForm.code.trim(), name: machineForm.name.trim(), model: machineForm.model.trim() || null, ownership: machineForm.ownership, supplierName: machineForm.supplierName.trim() || null, plateOrAssetNo: machineForm.plateOrAssetNo.trim() || null, status: machineForm.status, leaseTerms: machineForm.ownership === "leased" ? { billingType: machineForm.leaseBillingType, rate: Number(machineForm.leaseRate), effectiveFrom: machineForm.leaseStartDate, effectiveTo: machineForm.leaseEndDate || null } : null }); }}>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="所属项目"><Select value={machineForm.projectId || "UNASSIGNED"} onValueChange={value => setMachineForm(current => ({ ...current, projectId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></Field><Field label="机械状态"><Select value={machineForm.status} onValueChange={value => setMachineForm(current => ({ ...current, status: value as MachineStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="idle">闲置</SelectItem><SelectItem value="working">作业中</SelectItem><SelectItem value="repairing">维修中</SelectItem><SelectItem value="offsite">场外</SelectItem><SelectItem value="retired">已退役</SelectItem></SelectContent></Select></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="机械编号"><Input value={machineForm.code} placeholder="例如 EXC-001" onChange={event => setMachineForm(current => ({ ...current, code: event.target.value.toUpperCase() }))} /></Field><Field label="机械名称"><Input value={machineForm.name} placeholder="例如 挖掘机" onChange={event => setMachineForm(current => ({ ...current, name: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="型号"><Input value={machineForm.model} placeholder="可选" onChange={event => setMachineForm(current => ({ ...current, model: event.target.value }))} /></Field><Field label="资产编号 / 车牌"><Input value={machineForm.plateOrAssetNo} placeholder="可选" onChange={event => setMachineForm(current => ({ ...current, plateOrAssetNo: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="产权类型"><Select value={machineForm.ownership} onValueChange={value => setMachineForm(current => ({ ...current, ownership: value as MachineOwnership }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">自有</SelectItem><SelectItem value="leased">外租</SelectItem></SelectContent></Select></Field><Field label="供应商 / 出租方"><Input value={machineForm.supplierName} placeholder="自有可不填" onChange={event => setMachineForm(current => ({ ...current, supplierName: event.target.value }))} /></Field><Field label="操作员"><Select value={machineForm.operatorUserId || "UNASSIGNED"} onValueChange={value => setMachineForm(current => ({ ...current, operatorUserId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不分配</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></Field></div>
              {machineForm.ownership === "leased" ? <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div><p className="text-sm font-semibold text-amber-950">外租合同与租金</p><p className="mt-1 text-xs text-amber-800">保存台账时会同步建立或更新当前机械的有效租赁规则，供月度结算直接使用。</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="计费方式"><Select value={machineForm.leaseBillingType} onValueChange={value => setMachineForm(current => ({ ...current, leaseBillingType: value as LeaseBillingType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></Field><Field label="租金（元）"><Input type="number" min="0.01" step="0.01" value={machineForm.leaseRate} placeholder="外租必填" onChange={event => setMachineForm(current => ({ ...current, leaseRate: event.target.value }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="起租日期"><Input type="date" value={machineForm.leaseStartDate} onChange={event => setMachineForm(current => ({ ...current, leaseStartDate: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" min={machineForm.leaseStartDate || undefined} value={machineForm.leaseEndDate} onChange={event => setMachineForm(current => ({ ...current, leaseEndDate: event.target.value }))} /></Field></div></section> : null}
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setMachineDialogOpen(false); setMachineForm(EMPTY_MACHINE_FORM); }}>取消</Button><Button type="submit" disabled={!machineForm.projectId || machineForm.code.trim().length < 2 || machineForm.name.trim().length < 2 || (machineForm.ownership === "leased" && (!machineForm.supplierName || !machineForm.leaseRate || !machineForm.leaseStartDate)) || saveMachine.isPending}>{saveMachine.isPending ? "正在保存…" : machineForm.id ? "保存机械档案" : "建立机械档案"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={machineCostDialogOpen} onOpenChange={open => { if (!open) { setMachineCostDialogOpen(false); setMachineCostForm(EMPTY_MACHINE_COST_FORM); } }}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>录入机械成本</DialogTitle><DialogDescription>成本金额仅由服务端按数量乘单价计算，保存后先进入草稿状态，再由受权岗位审核、结算或作废。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMachineCost.mutate({ machineId: Number(machineCostForm.machineId), projectId: Number(machineCostForm.projectId), costType: machineCostForm.costType, quantity: Number(machineCostForm.quantity), unitPrice: Number(machineCostForm.unitPrice), occurredAt: new Date(machineCostForm.occurredAt).toISOString(), evidenceId: null }); }}>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="机械"><Input value={selectedMachineForDialog ? `${selectedMachineForDialog.name}（${selectedMachineForDialog.code}）` : ""} disabled /></Field><Field label="发生时间"><Input type="datetime-local" value={machineCostForm.occurredAt} onChange={event => setMachineCostForm(current => ({ ...current, occurredAt: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="成本类别"><Select value={machineCostForm.costType} onValueChange={value => setMachineCostForm(current => ({ ...current, costType: value as MachineCostType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fuel">油料</SelectItem><SelectItem value="repair">维修</SelectItem><SelectItem value="overtime">加班</SelectItem><SelectItem value="mobilization">进退场</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></Field><Field label="数量"><Input type="number" min="0" step="0.001" value={machineCostForm.quantity} onChange={event => setMachineCostForm(current => ({ ...current, quantity: event.target.value }))} /></Field><Field label="单价（元）"><Input type="number" min="0" step="0.01" value={machineCostForm.unitPrice} onChange={event => setMachineCostForm(current => ({ ...current, unitPrice: event.target.value }))} /></Field></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setMachineCostDialogOpen(false); setMachineCostForm(EMPTY_MACHINE_COST_FORM); }}>取消</Button><Button type="submit" disabled={!machineCostForm.machineId || !machineCostForm.projectId || !machineCostForm.occurredAt || !Number.isFinite(Number(machineCostForm.quantity)) || Number(machineCostForm.quantity) < 0 || !Number.isFinite(Number(machineCostForm.unitPrice)) || Number(machineCostForm.unitPrice) < 0 || saveMachineCost.isPending}>{saveMachineCost.isPending ? "正在保存…" : "保存成本草稿"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
