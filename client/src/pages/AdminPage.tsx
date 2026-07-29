import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardMenuItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  BarChart3,
  DatabaseBackup,
  ExternalLink,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Printer,
  ScrollText,
  Settings2,
  ShieldCheck,
  Truck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * PC 端为独立的超级管理后台入口。菜单只负责界面导航，服务端仍会对每个后台接口执行超级管理员校验。
 */
const ADMIN_MENU: DashboardMenuItem[] = [
  { icon: LayoutDashboard, label: "运营概览", path: "/admin" },
  { icon: Building2, label: "组织与项目", path: "/admin/organization" },
  { icon: Truck, label: "车辆与资源", path: "/admin/vehicles" },
  { icon: UsersRound, label: "人员与权限", path: "/admin/permission" },
  { icon: BarChart3, label: "业务治理与备份", path: "/admin/business" },
  { icon: Settings2, label: "系统设置", path: "/admin/settings" },
  { icon: ScrollText, label: "发布与审计", path: "/admin/audit" },
];

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
type VehicleForm = { id?: number; projectId: string; organizationId: string; plateNo: string; vehicleType: VehicleType; ownerName: string; driverUserId: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; status: VehicleStatus };

const EMPTY_ORGANIZATION_FORM: OrganizationForm = { parentId: "", code: "", name: "", type: "department", managerUserId: "", costCenterCode: "", sortOrder: "0", status: "active" };
const EMPTY_PROJECT_FORM: ProjectForm = { parentId: "", organizationId: "", code: "", name: "", nodeType: "项目", projectType: "highway", status: "planning", startDate: "", endDate: "", costCenterCode: "", sortOrder: "0" };
const EMPTY_POSITION_FORM: PositionForm = { code: "", name: "", category: "业务岗位", description: "", status: "active" };
const EMPTY_VEHICLE_FORM: VehicleForm = { projectId: "", organizationId: "", plateNo: "", vehicleType: "dump_truck", ownerName: "", driverUserId: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", status: "active" };

/** 兼容 API 返回 Date 或字符串的时间展示方法。 */
function displayDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
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
  const isPermission = activeSection === "permission";
  const isBusiness = activeSection === "business";
  const isSettings = activeSection === "settings";
  const isAudit = activeSection === "audit";
  const needsOrganizations = isOrganization || isVehicle || isPermission;
  const needsProjects = isOrganization || isVehicle || isPermission || isBusiness;
  const needsUsers = isOrganization || isVehicle || isPermission;

  const overview = trpc.admin.overview.useQuery(undefined, { enabled: canQuery && isOverview });
  const organizations = trpc.admin.organization.list.useQuery(undefined, { enabled: canQuery && needsOrganizations });
  const positions = trpc.admin.position.list.useQuery(undefined, { enabled: canQuery && isOrganization });
  const projects = trpc.admin.project.list.useQuery(undefined, { enabled: canQuery && needsProjects });
  const roles = trpc.admin.role.list.useQuery(undefined, { enabled: canQuery && isPermission });
  const permissions = trpc.admin.role.permissions.useQuery(undefined, { enabled: canQuery && isPermission });
  const users = trpc.admin.personnel.listUsers.useQuery(undefined, { enabled: canQuery && needsUsers });
  const assignments = trpc.admin.personnel.listAssignments.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentScopes = trpc.admin.department.listScopes.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentModules = trpc.admin.department.modules.useQuery(undefined, { enabled: canQuery && isPermission });
  const settings = trpc.admin.settings.list.useQuery(undefined, { enabled: canQuery && isSettings });
  const audits = trpc.admin.audit.list.useQuery(undefined, { enabled: canQuery && isAudit });
  const realDataReadiness = trpc.admin.acceptance.realDataReadiness.useQuery(undefined, { enabled: canQuery && isOverview });
  const vehicles = trpc.admin.vehicle.list.useQuery(undefined, { enabled: canQuery && isVehicle });
  const [businessFilter, setBusinessFilter] = useState({ projectId: "all", period: "" });
  const businessStatisticsInput = useMemo(() => ({
    projectId: businessFilter.projectId === "all" ? undefined : Number(businessFilter.projectId),
    period: businessFilter.period || undefined,
  }), [businessFilter.period, businessFilter.projectId]);
  const businessStatistics = trpc.admin.business.statistics.useQuery(businessStatisticsInput, { enabled: canQuery && isBusiness });
  const backups = trpc.admin.backup.list.useQuery(undefined, { enabled: canQuery && isBusiness });

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
  const [roleForm, setRoleForm] = useState({ code: "", name: "", description: "" });
  const [assignmentForm, setAssignmentForm] = useState({ userId: "", roleId: "", organizationId: "", projectId: "", validFrom: "", validTo: "" });
  const [localAccountForm, setLocalAccountForm] = useState({ username: "", displayName: "", initialPassword: "", wecomUserId: "", status: "active" as "active" | "disabled" });
  const [departmentScopeForm, setDepartmentScopeForm] = useState<{ organizationId: string; module: DepartmentModuleCode | "" }>({ organizationId: "", module: "" });
  const [settingForm, setSettingForm] = useState({
    category: "企业微信",
    settingKey: "",
    displayName: "",
    value: "",
    isSensitive: true,
    remarks: "",
  });

  // 首次加载后默认选中第一个角色；角色切换后以服务端真实权限回显编辑矩阵。
  useEffect(() => {
    if (!selectedRoleId && roles.data?.[0]) setSelectedRoleId(roles.data[0].id);
  }, [roles.data, selectedRoleId]);
  useEffect(() => {
    setDraftPermissionIds(rolePermissionIds.data ?? []);
  }, [rolePermissionIds.data]);
  // 默认选中第一条配置，方便管理员直接查看其发布历史和回滚入口。
  useEffect(() => {
    if (!selectedSettingId && settings.data?.[0]) setSelectedSettingId(settings.data[0].id);
  }, [selectedSettingId, settings.data]);
  const selectedSetting = settings.data?.find(item => item.id === selectedSettingId);
  const selectedBusinessProject = projects.data?.find(project => String(project.id) === businessFilter.projectId);
  const businessFilterLabel = `${selectedBusinessProject?.name ?? "全部项目"}${businessFilter.period ? ` · ${businessFilter.period}` : " · 全部期间"}`;

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
  const saveRole = trpc.admin.role.save.useMutation({
    onSuccess: async () => {
      toast.success("角色已保存");
      setRoleForm({ code: "", name: "", description: "" });
      await roles.refetch();
      await overview.refetch();
    },
  });
  const saveAssignment = trpc.admin.personnel.saveAssignment.useMutation({
    onSuccess: async () => {
      toast.success("人员授权已保存");
      setAssignmentForm({ userId: "", roleId: "", organizationId: "", projectId: "", validFrom: "", validTo: "" });
      await Promise.all([assignments.refetch(), audits.refetch(), users.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const createLocalUser = trpc.admin.personnel.createLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号已创建，请继续配置角色、部门和项目范围");
      setLocalAccountForm({ username: "", displayName: "", initialPassword: "", wecomUserId: "", status: "active" });
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
  const saveDepartmentScope = trpc.admin.department.saveScope.useMutation({
    onSuccess: async () => {
      toast.success("部门业务范围已保存，相关人员下次请求将按新范围校验");
      setDepartmentScopeForm({ organizationId: "", module: "" });
      await departmentScopes.refetch();
    },
  });
  const saveSetting = trpc.admin.settings.saveDraft.useMutation({
    onSuccess: async () => {
      toast.success("配置草稿已安全保存");
      setSettingForm({ category: "企业微信", settingKey: "", displayName: "", value: "", isSensitive: true, remarks: "" });
      await settings.refetch();
      await overview.refetch();
    },
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
  const disableSetting = trpc.admin.settings.disable.useMutation({
    onSuccess: async result => {
      toast.success(`配置已停用并记录为 v${result.version}`);
      await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
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
  const assignmentRequiresBusinessScope = Boolean(selectedAssignmentRole && selectedAssignmentRole.code !== "SUPER_ADMIN");
  const assignmentHasScope = Boolean(assignmentForm.organizationId || assignmentForm.projectId);
  const assignmentReady = Boolean(assignmentForm.userId && selectedAssignmentRole && (!assignmentRequiresBusinessScope || assignmentHasScope));

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#203c48]">超级管理后台</p>
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
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">03 系统设置</b><p className="mt-1 text-xs leading-5">配置企业微信及外部 API，校验后发布。</p></div>
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
              <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!organizationForm.code || !organizationForm.name || saveOrganization.isPending} onClick={submitOrganization}>{organizationForm.id ? "保存组织变更" : "保存组织节点"}</Button>
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
              <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!projectForm.code || !projectForm.name || !projectForm.nodeType || saveProject.isPending} onClick={submitProject}>{projectForm.id ? "保存项目变更" : "保存项目节点"}</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{positionForm.id ? "维护岗位" : "新增岗位"}</CardTitle>{positionForm.id ? <Button size="sm" variant="ghost" onClick={() => setPositionForm(EMPTY_POSITION_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3"><div><Label>岗位编码</Label><Input value={positionForm.code} placeholder="例如 TRANSPORT_MANAGER" onChange={event => setPositionForm({ ...positionForm, code: event.target.value.toUpperCase() })} /></div><div><Label>岗位名称</Label><Input value={positionForm.name} placeholder="例如 运输主管" onChange={event => setPositionForm({ ...positionForm, name: event.target.value })} /></div><div><Label>岗位分类</Label><Input value={positionForm.category} placeholder="例如 业务岗位" onChange={event => setPositionForm({ ...positionForm, category: event.target.value })} /></div><div><Label>职责说明</Label><Input value={positionForm.description} placeholder="可选" onChange={event => setPositionForm({ ...positionForm, description: event.target.value })} /></div><div><Label>状态</Label><Select value={positionForm.status} onValueChange={(value: OrganizationStatus) => setPositionForm({ ...positionForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div><Button variant="outline" className="w-full" disabled={!positionForm.code || !positionForm.name || !positionForm.category || savePosition.isPending} onClick={submitPosition}>{positionForm.id ? "保存岗位变更" : "保存岗位"}</Button></CardContent>
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
      saveVehicle.mutate({
        id: vehicleForm.id,
        projectId: Number(vehicleForm.projectId),
        organizationId: vehicleForm.organizationId ? Number(vehicleForm.organizationId) : null,
        plateNo: vehicleForm.plateNo.trim(),
        vehicleType: vehicleForm.vehicleType,
        ownerName: vehicleForm.ownerName.trim() || null,
        driverUserId: vehicleForm.driverUserId ? Number(vehicleForm.driverUserId) : null,
        boxLengthMeters: Number(vehicleForm.boxLengthMeters),
        boxWidthMeters: Number(vehicleForm.boxWidthMeters),
        boxHeightMeters: Number(vehicleForm.boxHeightMeters),
        loadFactor: Number(vehicleForm.loadFactor || 1),
        payloadTons: vehicleForm.payloadTons ? Number(vehicleForm.payloadTons) : null,
        status: vehicleForm.status,
      });
    };
    const openVehicle = (item: NonNullable<typeof vehicles.data>[number]) => setVehicleForm({
      id: item.id,
      projectId: String(item.projectId),
      organizationId: item.organizationId ? String(item.organizationId) : "",
      plateNo: item.plateNo,
      vehicleType: item.vehicleType,
      ownerName: item.ownerName ?? "",
      driverUserId: item.driverUserId ? String(item.driverUserId) : "",
      boxLengthMeters: String(item.boxLengthMeters),
      boxWidthMeters: String(item.boxWidthMeters),
      boxHeightMeters: String(item.boxHeightMeters),
      loadFactor: String(item.loadFactor),
      payloadTons: item.payloadTons ? String(item.payloadTons) : "",
      status: item.status,
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
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><div><CardTitle className="text-base">{vehicleForm.id ? "维护车辆档案" : "新增车辆档案"}</CardTitle><CardDescription>车牌全局唯一，理论方量由服务端计算。</CardDescription></div>{vehicleForm.id ? <Button size="sm" variant="ghost" onClick={() => setVehicleForm(EMPTY_VEHICLE_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3"><div><Label>车牌号</Label><Input value={vehicleForm.plateNo} placeholder="例如 粤A12345" onChange={event => setVehicleForm({ ...vehicleForm, plateNo: event.target.value.toUpperCase() })} /></div><div><Label>车辆类型</Label><Select value={vehicleForm.vehicleType} onValueChange={(value: VehicleType) => setVehicleForm({ ...vehicleForm, vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dump_truck">渣土车</SelectItem><SelectItem value="tractor">牵引车</SelectItem><SelectItem value="mixer">搅拌车</SelectItem><SelectItem value="flatbed">平板车</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div></div>
              <div><Label>归属项目</Label><Select value={vehicleForm.projectId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, projectId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue placeholder="选择有效项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>所属单位</Label><Select value={vehicleForm.organizationId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{organizations.data?.filter(item => item.status === "active").map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>产权/所属人</Label><Input value={vehicleForm.ownerName} placeholder="可选" onChange={event => setVehicleForm({ ...vehicleForm, ownerName: event.target.value })} /></div><div><Label>绑定司机</Label><Select value={vehicleForm.driverUserId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, driverUserId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不分配</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>货厢长(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxLengthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxLengthMeters: event.target.value })} /></div><div><Label>货厢宽(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxWidthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxWidthMeters: event.target.value })} /></div><div><Label>货厢高(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxHeightMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxHeightMeters: event.target.value })} /></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>装载系数</Label><Input type="number" min="0.001" max="1.5" step="0.001" value={vehicleForm.loadFactor} onChange={event => setVehicleForm({ ...vehicleForm, loadFactor: event.target.value })} /></div><div><Label>核定载重(t)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.payloadTons} placeholder="可选" onChange={event => setVehicleForm({ ...vehicleForm, payloadTons: event.target.value })} /></div><div><Label>调度状态</Label><Select value={vehicleForm.status} onValueChange={(value: VehicleStatus) => setVehicleForm({ ...vehicleForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div></div>
              <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!vehicleForm.projectId || !vehicleForm.plateNo || !vehicleForm.boxLengthMeters || !vehicleForm.boxWidthMeters || !vehicleForm.boxHeightMeters || saveVehicle.isPending} onClick={submitVehicle}>{vehicleForm.id ? "保存车辆变更" : "保存车辆档案"}</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderPermissions = () => (
    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <section className="space-y-4">
        <div><p className="text-sm font-medium text-[#203c48]">人员与授权</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">角色权限矩阵</h1><p className="mt-2 text-sm text-slate-500">角色、菜单、操作和项目数据范围均在后台维护；超级管理员拥有独立 PC 入口。</p></div>
        <Card>
          <CardHeader><CardTitle className="text-base">角色列表</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {roles.data?.map(role => <button key={role.id} className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedRoleId === role.id ? "border-[#203c48] bg-[#edf4f1]" : "border-slate-100 hover:bg-slate-50"}`} onClick={() => setSelectedRoleId(role.id)}><p className="text-sm font-medium">{role.name}</p><p className="mt-0.5 text-xs text-slate-500">{role.code} · {role.category === "system" ? "系统角色" : "业务角色"}</p></button>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">新增业务角色</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input value={roleForm.code} placeholder="角色编码，例如 CONTRACT_MANAGER" onChange={event => setRoleForm({ ...roleForm, code: event.target.value.toUpperCase() })} />
            <Input value={roleForm.name} placeholder="角色名称" onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} />
            <Input value={roleForm.description} placeholder="职责说明（可选）" onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} />
            <Button variant="outline" className="w-full" disabled={!roleForm.code || !roleForm.name || saveRole.isPending} onClick={() => saveRole.mutate({ ...roleForm, category: "business" })}>保存角色</Button>
          </CardContent>
        </Card>
      </section>
      <section className="space-y-4">
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
              <Select value={departmentScopeForm.organizationId} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, organizationId: value })}><SelectTrigger><SelectValue placeholder="选择部门或项目部" /></SelectTrigger><SelectContent>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select>
              <Select value={departmentScopeForm.module} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, module: value as DepartmentModuleCode })}><SelectTrigger><SelectValue placeholder="选择业务模块" /></SelectTrigger><SelectContent>{departmentModules.data?.map(module => <SelectItem key={module.code} value={module.code}>{module.name}</SelectItem>)}</SelectContent></Select>
              <Button disabled={!departmentScopeForm.organizationId || !departmentScopeForm.module || saveDepartmentScope.isPending} onClick={() => { if (departmentScopeForm.module) saveDepartmentScope.mutate({ organizationId: Number(departmentScopeForm.organizationId), module: departmentScopeForm.module, status: "active" }); }}>启用业务</Button>
            </div>
            {departmentScopes.data?.length ? <div className="space-y-2">{departmentScopes.data.map(scope => {
              const module = departmentModules.data?.find(item => item.code === scope.module);
              return <div key={scope.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-medium text-slate-800">{scope.organizationName} · {module?.name ?? scope.module}</p><p className="mt-0.5 text-xs text-slate-500">{module?.description ?? "部门业务模块"} · 最后更新：{displayDate(scope.updatedAt)}</p></div><Button size="sm" variant="outline" disabled={saveDepartmentScope.isPending} onClick={() => saveDepartmentScope.mutate({ organizationId: scope.organizationId, module: scope.module, status: scope.status === "active" ? "disabled" : "active" })}>{scope.status === "active" ? "停用" : "启用"}</Button></div>;
            })}</div> : <EmptyState text="尚未配置部门可办理业务。请先建立部门节点，再按实际职责启用业务模块。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">新增普通管理人员账号</CardTitle><CardDescription>在此创建本地登录账号。初始密码只会在本次安全请求中生成不可逆摘要，不能查看、导出或在审计中回显；创建后须继续授予角色、部门与项目范围。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="local-account-username">登录账号</Label><Input id="local-account-username" autoComplete="off" value={localAccountForm.username} onChange={event => setLocalAccountForm({ ...localAccountForm, username: event.target.value })} placeholder="例如：zhangsan" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-name">显示姓名</Label><Input id="local-account-name" value={localAccountForm.displayName} onChange={event => setLocalAccountForm({ ...localAccountForm, displayName: event.target.value })} placeholder="例如：张三" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-password">初始密码</Label><Input id="local-account-password" type="password" autoComplete="new-password" value={localAccountForm.initialPassword} onChange={event => setLocalAccountForm({ ...localAccountForm, initialPassword: event.target.value })} placeholder="至少 12 位，含字母和数字" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-wecom">企业微信员工标识（可选）</Label><Input id="local-account-wecom" value={localAccountForm.wecomUserId} onChange={event => setLocalAccountForm({ ...localAccountForm, wecomUserId: event.target.value })} placeholder="企业微信 UserID" /></div>
              <div className="grid gap-1.5"><Label>初始状态</Label><Select value={localAccountForm.status} onValueChange={value => setLocalAccountForm({ ...localAccountForm, status: value as "active" | "disabled" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
              <div className="flex items-end"><Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!localAccountForm.username || !localAccountForm.displayName || !localAccountForm.initialPassword || createLocalUser.isPending} onClick={() => createLocalUser.mutate({ ...localAccountForm, wecomUserId: localAccountForm.wecomUserId.trim() || null })}>{createLocalUser.isPending ? "正在创建…" : "创建普通管理人员"}</Button></div>
            </div>
            {users.data?.some(user => user.loginMethod === "local_manager") ? <div className="space-y-2">{users.data.filter(user => user.loginMethod === "local_manager").map(user => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-medium text-slate-800">{user.name || `用户 #${user.id}`} <span className="ml-1 font-mono text-xs text-slate-500">{user.localUsername}</span></p><p className="mt-0.5 text-xs text-slate-500">{user.localPasswordChangeRequired ? "待首次改密" : "密码已激活"} · 最近登录：{displayDate(user.lastSignedIn)}</p></div><div className="flex items-center gap-2"><Badge variant={user.localAccountStatus === "active" ? "secondary" : "outline"}>{user.localAccountStatus === "active" ? "已启用" : "已停用"}</Badge><Button size="sm" variant="outline" disabled={setLocalUserStatus.isPending} onClick={() => setLocalUserStatus.mutate({ userId: user.id, status: user.localAccountStatus === "active" ? "disabled" : "active" })}>{user.localAccountStatus === "active" ? "停用" : "启用"}</Button></div></div>)}</div> : <EmptyState text="尚未创建普通管理人员本地账号。创建后请在下方继续配置其角色与数据范围。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">管理人员角色授权</CardTitle><CardDescription>业务角色可以绑定已启用的所属部门/项目部，或直接绑定一个具体项目。两种方式均由服务端校验；项目级授权绝不扩大为全部项目权限。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {assignmentRequiresBusinessScope && !assignmentHasScope ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">请为业务角色至少选择一个所属部门/项目部或一个具体项目范围；未选择时不会提交授权。</div> : null}
            {!departmentNodes.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900"><span>当前未配置可用部门或项目部。您仍可直接按具体项目授权；如需部门级范围，请先建立项目部并启用对应业务模块。</span><Button size="sm" variant="outline" onClick={() => setLocation("/admin/organization")}>配置组织与项目</Button></div> : null}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid gap-1.5"><Label>管理人员</Label><Select value={assignmentForm.userId} onValueChange={value => setAssignmentForm({ ...assignmentForm, userId: value })}><SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger><SelectContent>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}{user.localUsername ? `（${user.localUsername}）` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>业务角色</Label><Select value={assignmentForm.roleId} onValueChange={value => setAssignmentForm({ ...assignmentForm, roleId: value })}><SelectTrigger><SelectValue placeholder="选择角色" /></SelectTrigger><SelectContent>{roles.data?.map(role => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>所属部门 / 项目部</Label><Select value={assignmentForm.organizationId || "UNASSIGNED"} onValueChange={value => setAssignmentForm({ ...assignmentForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue placeholder="选择所属部门" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">不设置（可改用具体项目范围）</SelectItem>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>具体项目范围</Label><Select value={assignmentForm.projectId || "ALL"} onValueChange={value => setAssignmentForm({ ...assignmentForm, projectId: value === "ALL" ? "" : value })}><SelectTrigger><SelectValue placeholder="项目范围（可选）" /></SelectTrigger><SelectContent><SelectItem value="ALL">不设置项目范围</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-from">授权生效时间</Label><Input id="assignment-valid-from" type="datetime-local" value={assignmentForm.validFrom} onChange={event => setAssignmentForm({ ...assignmentForm, validFrom: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-to">授权失效时间</Label><Input id="assignment-valid-to" type="datetime-local" value={assignmentForm.validTo} onChange={event => setAssignmentForm({ ...assignmentForm, validTo: event.target.value })} /></div>
            </div>
            <Button className="min-w-40 bg-[#203c48] hover:bg-[#17313b]" disabled={!assignmentReady || saveAssignment.isPending} onClick={() => saveAssignment.mutate({ userId: Number(assignmentForm.userId), roleId: Number(assignmentForm.roleId), organizationId: assignmentForm.organizationId ? Number(assignmentForm.organizationId) : null, projectId: assignmentForm.projectId ? Number(assignmentForm.projectId) : null, validFrom: assignmentForm.validFrom ? new Date(assignmentForm.validFrom).toISOString() : null, validTo: assignmentForm.validTo ? new Date(assignmentForm.validTo).toISOString() : null })}>{saveAssignment.isPending ? "正在授权…" : "授权"}</Button>
          </CardContent>
          <CardContent className="pt-0">
            {assignments.data?.length ? <div className="space-y-2">{assignments.data.slice(0, 8).map(item => <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>用户 #{item.userId} · 角色 #{item.roleId} · 部门 {item.organizationId ? organizationNameById.get(item.organizationId) ?? `#${item.organizationId}` : "未设置"} · 项目 {item.projectId || "全部"}</span><Badge variant="outline">{item.status}</Badge></div>)}</div> : <EmptyState text="暂无角色授权记录。" />}
          </CardContent>
        </Card>
      </section>
    </div>
  );

  const renderSettings = () => (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="space-y-6">
        <div><p className="text-sm font-medium text-[#203c48]">系统设置中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">接口、密钥与业务参数</h1><p className="mt-2 text-sm text-slate-500">企业微信是唯一通知通道；地图、OCR、定位、油卡和地磅等连接均在此处加密托管并经过发布流程。</p></div>
        <Card>
          <CardHeader><CardTitle className="text-base">配置项清单</CardTitle><CardDescription>敏感值仅以掩码展示。发布后生成版本与审计日志；不提供明文导出。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {settings.data?.length ? settings.data.map(item => (
              <div key={item.id} className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${selectedSettingId === item.id ? "border-[#203c48] bg-[#f7faf9]" : "border-slate-100"}`}>
                <button className="text-left" onClick={() => setSelectedSettingId(item.id)}><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.displayName}</p>{item.isSensitive ? <Badge variant="outline">加密托管</Badge> : null}<Badge variant={item.status === "published" ? "secondary" : "outline"}>{item.status === "published" ? "已发布" : item.status === "draft" ? "草稿" : "已禁用"}</Badge></div><p className="mt-1 text-xs text-slate-500">{item.category} · {item.settingKey} · v{item.version} · {item.valuePreview || "未设置值"}</p></button>
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={item.status === "published" || publishSetting.isPending} onClick={() => publishSetting.mutate({ id: item.id, expectedVersion: item.version })}>发布</Button><Button size="sm" variant="outline" disabled={testSetting.isPending} onClick={() => testSetting.mutate({ id: item.id })}>{item.settingKey === "WECHAT_WORK_WEBHOOK" ? "发送测试消息" : "校验 / 测试"}</Button>{item.status !== "disabled" ? <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800" disabled={disableSetting.isPending} onClick={() => { if (window.confirm(`确认停用“${item.displayName}”？停用后将保留密文和历史版本，但不再参与业务调用。`)) disableSetting.mutate({ id: item.id, expectedVersion: item.version }); }}>停用</Button> : null}</div>
              </div>
            )) : <EmptyState text="暂无配置项，请在右侧创建企业微信、消息模板或外部 API 配置草稿。" />}
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
            {["基础品牌与多语言", "账号安全与密码策略", "企业微信与消息模板", "地图 / OCR / 定位连接器", "油卡 / 地磅 / 外部 API", "业务参数与编号规则", "文档影像与归档规则", "运行监控与审计", "发布、回滚与版本"].map(item => <div key={item} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">{item}</div>)}
          </CardContent>
        </Card>
      </section>
      <aside className="space-y-4">
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">企业微信机器人快速配置</CardTitle><CardDescription>仅支持企业微信官方 HTTPS Webhook。地址会被 AES-GCM 加密保存，列表与审计日志只显示掩码。</CardDescription></CardHeader>
          <CardContent><Button variant="outline" className="w-full border-[#203c48] text-[#203c48]" onClick={() => setSettingForm({ category: "企业微信", settingKey: "WECHAT_WORK_WEBHOOK", displayName: "企业微信机器人 Webhook", value: "", isSensitive: true, remarks: "用于工程业务节点通知；保存后请先发布，再由超级管理员主动发送测试消息。" })}>填入企业微信机器人模板</Button></CardContent>
        </Card>
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">企业身份账号恢复</CardTitle><CardDescription>仅配置身份提供方公开 HTTPS 恢复页面。系统不保存企业密码，登录页和个人中心将通过受控端点跳转至该地址。</CardDescription></CardHeader>
          <CardContent><Button variant="outline" className="w-full border-[#203c48] text-[#203c48]" onClick={() => setSettingForm({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份平台账号恢复地址", value: "", isSensitive: false, remarks: "仅限企业统一身份提供方的账号找回或密码重置页面；保存草稿后需发布才会对用户生效。" })}>填入身份恢复地址模板</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">新建配置草稿</CardTitle><CardDescription>该表单仅创建新的配置项；既有配置通过版本化发布、停用或回滚操作维护，密钥类内容会在服务端立即进行 AES-GCM 加密且不会回传明文。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>配置分类</Label><Select value={settingForm.category} onValueChange={value => setSettingForm({ ...settingForm, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="账号安全">账号安全与身份平台</SelectItem><SelectItem value="企业微信">企业微信接入</SelectItem><SelectItem value="企业微信消息模板">企业微信消息模板</SelectItem><SelectItem value="外部API">外部 API 连接器</SelectItem><SelectItem value="业务参数">业务参数与计价规则</SelectItem><SelectItem value="文档影像">文档影像与归档</SelectItem></SelectContent></Select></div>
            <div><Label>配置键</Label><Input value={settingForm.settingKey} placeholder="WECOM:CORP_ID" onChange={event => setSettingForm({ ...settingForm, settingKey: event.target.value.toUpperCase() })} /></div>
            <div><Label>显示名称</Label><Input value={settingForm.displayName} placeholder="企业微信企业 ID" onChange={event => setSettingForm({ ...settingForm, displayName: event.target.value })} /></div>
            <div><Label>配置值</Label><Input value={settingForm.value} type={settingForm.isSensitive ? "password" : "text"} placeholder="输入值或密钥" onChange={event => setSettingForm({ ...settingForm, value: event.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><Checkbox checked={settingForm.isSensitive} onCheckedChange={checked => setSettingForm({ ...settingForm, isSensitive: Boolean(checked) })} />按敏感密钥加密托管</label>
            <div><Label>备注</Label><Input value={settingForm.remarks} placeholder="用途、回调地址或维护说明" onChange={event => setSettingForm({ ...settingForm, remarks: event.target.value })} /></div>
            <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!settingForm.settingKey || !settingForm.displayName || !settingForm.value || saveSetting.isPending} onClick={() => saveSetting.mutate(settingForm)}>保存草稿</Button>
          </CardContent>
        </Card>
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
                  <Button className="mt-4 w-full print:hidden" size="sm" variant="outline" onClick={() => setLocation(module.route)}><ExternalLink className="mr-1.5 h-4 w-4" />进入维护</Button>
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

  const content = activeSection === "organization" ? renderOrganization() : activeSection === "vehicles" ? renderVehicles() : activeSection === "permission" ? renderPermissions() : activeSection === "business" ? renderBusiness() : activeSection === "settings" ? renderSettings() : activeSection === "audit" ? renderAudit() : renderOverview();

  return (
    <DashboardLayout title="工程云管 · 超级后台" menuItems={ADMIN_MENU}>
      <div className="mx-auto max-w-7xl space-y-6 py-3">
        <Tabs value={activeSection} onValueChange={value => setLocation(value === "overview" ? "/admin" : `/admin/${value}`)} className="lg:hidden">
          <TabsList className="w-full overflow-x-auto"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="organization">组织</TabsTrigger><TabsTrigger value="vehicles">车辆</TabsTrigger><TabsTrigger value="permission">权限</TabsTrigger><TabsTrigger value="business">业务治理</TabsTrigger><TabsTrigger value="settings">设置</TabsTrigger><TabsTrigger value="audit">审计</TabsTrigger></TabsList>
        </Tabs>
        {content}
      </div>
    </DashboardLayout>
  );
}
