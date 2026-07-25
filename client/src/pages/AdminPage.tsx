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
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings2,
  ShieldCheck,
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
  { icon: UsersRound, label: "人员与权限", path: "/admin/permission" },
  { icon: Settings2, label: "系统设置", path: "/admin/settings" },
  { icon: ScrollText, label: "发布与审计", path: "/admin/audit" },
];

type OrganizationType = "group" | "company" | "project_department" | "department" | "team";

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

  // 未登录时不触发受保护接口；DashboardLayout 负责登录引导，服务端负责真正的超级管理员鉴权。
  const queryOptions = { enabled: isAuthenticated };
  const overview = trpc.admin.overview.useQuery(undefined, queryOptions);
  const organizations = trpc.admin.organization.list.useQuery(undefined, queryOptions);
  const positions = trpc.admin.position.list.useQuery(undefined, queryOptions);
  const projects = trpc.admin.project.list.useQuery(undefined, queryOptions);
  const roles = trpc.admin.role.list.useQuery(undefined, queryOptions);
  const permissions = trpc.admin.role.permissions.useQuery(undefined, queryOptions);
  const users = trpc.admin.personnel.listUsers.useQuery(undefined, queryOptions);
  const assignments = trpc.admin.personnel.listAssignments.useQuery(undefined, queryOptions);
  const settings = trpc.admin.settings.list.useQuery(undefined, queryOptions);
  const audits = trpc.admin.audit.list.useQuery(undefined, queryOptions);

  const [selectedRoleId, setSelectedRoleId] = useState<number>();
  const [selectedSettingId, setSelectedSettingId] = useState<number>();
  const settingHistory = trpc.admin.settings.history.useQuery(
    { settingId: selectedSettingId ?? 0 },
    { enabled: isAuthenticated && selectedSettingId !== undefined },
  );
  const rolePermissionIds = trpc.admin.role.permissionIds.useQuery(
    { roleId: selectedRoleId ?? 0 },
    { enabled: isAuthenticated && selectedRoleId !== undefined },
  );
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);

  const [organizationForm, setOrganizationForm] = useState<{ code: string; name: string; type: OrganizationType }>({
    code: "",
    name: "",
    type: "department",
  });
  const [projectForm, setProjectForm] = useState({
    code: "",
    name: "",
    nodeType: "项目",
    projectType: "highway" as const,
  });
  const [roleForm, setRoleForm] = useState({ code: "", name: "", description: "" });
  const [assignmentForm, setAssignmentForm] = useState({ userId: "", roleId: "", projectId: "", validFrom: "", validTo: "" });
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

  /** 配置版本冲突后强制刷新列表与历史，避免管理员继续在旧版本上操作。 */
  const refreshAfterSettingConflict = async () => {
    toast.error("配置已被其他管理员更新，已刷新为最新版本，请确认后重试");
    await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
  };

  const saveOrganization = trpc.admin.organization.save.useMutation({
    onSuccess: async () => {
      toast.success("组织节点已保存");
      setOrganizationForm({ code: "", name: "", type: "department" });
      await organizations.refetch();
      await overview.refetch();
    },
  });
  const saveProject = trpc.admin.project.save.useMutation({
    onSuccess: async () => {
      toast.success("项目节点已保存");
      setProjectForm({ code: "", name: "", nodeType: "项目", projectType: "highway" });
      await projects.refetch();
      await overview.refetch();
    },
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
      setAssignmentForm({ userId: "", roleId: "", projectId: "", validFrom: "", validTo: "" });
      await assignments.refetch();
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

  // 按功能模块分组展示权限，避免管理员在长列表中难以辨识业务归属。
  const permissionGroups = useMemo(() => {
    const grouped: Record<string, Array<NonNullable<typeof permissions.data>[number]>> = {};
    for (const permission of permissions.data ?? []) {
      (grouped[permission.module] ??= []).push(permission);
    }
    return Object.entries(grouped);
  }, [permissions.data]);

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
    </div>
  );

  const renderOrganization = () => (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">基础主数据</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">组织、岗位与项目层级</h1>
          <p className="mt-2 text-sm text-slate-500">PC 后台可维护组织、部门、岗位和项目树；修改会保留审计日志。</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">组织架构</CardTitle><CardDescription>支持集团、公司、部门、项目部和班组层级。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {organizations.data?.length ? organizations.data.map(item => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                <div><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · {item.type} · 成本中心：{item.costCenterCode || "未设置"}</p></div>
                <Badge variant={item.status === "active" ? "secondary" : "outline"}>{item.status === "active" ? "启用" : "停用"}</Badge>
              </div>
            )) : <EmptyState text="暂无组织节点，请在右侧新增后开始维护。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">岗位字典</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {positions.data?.length ? positions.data.map(item => <Badge key={item.id} variant="outline" className="bg-white px-2.5 py-1.5">{item.name}<span className="ml-1 text-slate-400">{item.category}</span></Badge>) : <EmptyState text="暂无自定义岗位；系统角色可在权限页面维护。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">项目层级</CardTitle><CardDescription>推荐“项目 → 标段/工区 → 单位工程 → 施工段/作业面”。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {projects.data?.length ? projects.data.map(item => <div key={item.id} className="rounded-lg border border-slate-100 px-3 py-2.5"><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · {item.nodeType} · {item.projectType || "未设置类型"}</p></div>) : <EmptyState text="暂无项目层级，请在右侧新增项目或项目节点。" />}
          </CardContent>
        </Card>
      </section>
      <aside className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">新增组织节点</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>组织编码</Label><Input value={organizationForm.code} placeholder="例如 DEPT_FIN" onChange={event => setOrganizationForm({ ...organizationForm, code: event.target.value.toUpperCase() })} /></div>
            <div><Label>组织名称</Label><Input value={organizationForm.name} placeholder="例如 财务部" onChange={event => setOrganizationForm({ ...organizationForm, name: event.target.value })} /></div>
            <div>
              <Label>节点类型</Label>
              <Select value={organizationForm.type} onValueChange={(value: OrganizationType) => setOrganizationForm({ ...organizationForm, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="group">集团</SelectItem><SelectItem value="company">公司</SelectItem><SelectItem value="department">部门</SelectItem><SelectItem value="project_department">项目部</SelectItem><SelectItem value="team">班组</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!organizationForm.code || !organizationForm.name || saveOrganization.isPending} onClick={() => saveOrganization.mutate(organizationForm)}>保存组织节点</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">新增项目节点</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>项目编码</Label><Input value={projectForm.code} placeholder="例如 GZ-GS-01" onChange={event => setProjectForm({ ...projectForm, code: event.target.value.toUpperCase() })} /></div>
            <div><Label>项目名称</Label><Input value={projectForm.name} placeholder="例如 GZ 高速一标段" onChange={event => setProjectForm({ ...projectForm, name: event.target.value })} /></div>
            <div><Label>层级名称</Label><Input value={projectForm.nodeType} onChange={event => setProjectForm({ ...projectForm, nodeType: event.target.value })} /></div>
            <Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!projectForm.code || !projectForm.name || saveProject.isPending} onClick={() => saveProject.mutate(projectForm)}>保存项目节点</Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );

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
          <CardHeader><CardTitle className="text-base">管理人员角色授权</CardTitle><CardDescription>可为登录用户授予角色、组织/项目数据范围及生效期限；账号敏感字段不在此界面展示。</CardDescription></CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-3">
            <Select value={assignmentForm.userId} onValueChange={value => setAssignmentForm({ ...assignmentForm, userId: value })}><SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger><SelectContent>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select>
            <Select value={assignmentForm.roleId} onValueChange={value => setAssignmentForm({ ...assignmentForm, roleId: value })}><SelectTrigger><SelectValue placeholder="选择角色" /></SelectTrigger><SelectContent>{roles.data?.map(role => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}</SelectContent></Select>
            <Select value={assignmentForm.projectId || "ALL"} onValueChange={value => setAssignmentForm({ ...assignmentForm, projectId: value === "ALL" ? "" : value })}><SelectTrigger><SelectValue placeholder="项目范围（可选）" /></SelectTrigger><SelectContent><SelectItem value="ALL">全部项目（按角色权限）</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select>
            <Input type="datetime-local" aria-label="授权生效时间" value={assignmentForm.validFrom} onChange={event => setAssignmentForm({ ...assignmentForm, validFrom: event.target.value })} />
            <Input type="datetime-local" aria-label="授权失效时间" value={assignmentForm.validTo} onChange={event => setAssignmentForm({ ...assignmentForm, validTo: event.target.value })} />
            <Button disabled={!assignmentForm.userId || !assignmentForm.roleId || saveAssignment.isPending} onClick={() => saveAssignment.mutate({ userId: Number(assignmentForm.userId), roleId: Number(assignmentForm.roleId), projectId: assignmentForm.projectId ? Number(assignmentForm.projectId) : null, validFrom: assignmentForm.validFrom ? new Date(assignmentForm.validFrom).toISOString() : null, validTo: assignmentForm.validTo ? new Date(assignmentForm.validTo).toISOString() : null })}>授权</Button>
          </CardContent>
          <CardContent className="pt-0">
            {assignments.data?.length ? <div className="space-y-2">{assignments.data.slice(0, 8).map(item => <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>用户 #{item.userId} · 角色 #{item.roleId} · 项目 {item.projectId || "全部"}</span><Badge variant="outline">{item.status}</Badge></div>)}</div> : <EmptyState text="暂无角色授权记录。" />}
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
        <Card>
          <CardHeader><CardTitle className="text-base">新建配置草稿</CardTitle><CardDescription>该表单仅创建新的配置项；既有配置通过版本化发布、停用或回滚操作维护，密钥类内容会在服务端立即进行 AES-GCM 加密且不会回传明文。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>配置分类</Label><Select value={settingForm.category} onValueChange={value => setSettingForm({ ...settingForm, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="企业微信">企业微信接入</SelectItem><SelectItem value="企业微信消息模板">企业微信消息模板</SelectItem><SelectItem value="外部API">外部 API 连接器</SelectItem><SelectItem value="业务参数">业务参数与计价规则</SelectItem><SelectItem value="文档影像">文档影像与归档</SelectItem></SelectContent></Select></div>
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

  const content = activeSection === "organization" ? renderOrganization() : activeSection === "permission" ? renderPermissions() : activeSection === "settings" ? renderSettings() : activeSection === "audit" ? renderAudit() : renderOverview();

  return (
    <DashboardLayout title="工程云管 · 超级后台" menuItems={ADMIN_MENU}>
      <div className="mx-auto max-w-7xl space-y-6 py-3">
        <Tabs value={activeSection} onValueChange={value => setLocation(value === "overview" ? "/admin" : `/admin/${value}`)} className="lg:hidden">
          <TabsList className="w-full overflow-x-auto"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="organization">组织</TabsTrigger><TabsTrigger value="permission">权限</TabsTrigger><TabsTrigger value="settings">设置</TabsTrigger><TabsTrigger value="audit">审计</TabsTrigger></TabsList>
        </Tabs>
        {content}
      </div>
    </DashboardLayout>
  );
}
