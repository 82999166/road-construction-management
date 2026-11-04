import { formatChinaDateTime, toChinaDateInput } from "@/lib/businessTime";

export type AuthorizationAssignment = {
  id?: number;
  roleId: number;
  organizationId?: number | null;
  projectId?: number | null;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
};
export type AuthorizationSnapshot = {
  assignments: AuthorizationAssignment[];
  permissionIds: number[];
  revision: string;
};
export type AuthorizationDraft = {
  assignments: Array<
    Omit<AuthorizationAssignment, "validFrom" | "validTo"> & {
      validFrom: string | null;
      validTo: string | null;
    }
  >;
  permissionIds: number[];
};
export type AuthorizationRole = {
  id: number;
  code: string;
  name: string;
  category: string;
  isSystem: boolean;
  status: string;
};
export type AuthorizationOrganization = {
  id: number;
  name: string;
  type: string;
  status: string;
};
export type AuthorizationProject = { id: number; name: string; status: string };
export type AuthorizationPermission = {
  id: number;
  name: string;
  module: string;
  action: string;
};
export type AuthorizationCatalog = {
  roles: AuthorizationRole[];
  organizations: AuthorizationOrganization[];
  projects: AuthorizationProject[];
  permissions: AuthorizationPermission[];
};
const MODULE_LABELS: Record<string, string> = {
  admin: "后台治理",
  mobile: "移动工作台",
  construction: "施工日报",
  labor: "劳务与工资",
  machinery: "机械资源",
  transport: "运输调度",
  purchase: "采购仓储",
  measurement: "工程计量",
  finance: "财务成本",
  diesel: "柴油管理",
  evidence: "影像取证",
  message: "消息中心",
  contract: "外包合同",
};
const ACTION_LABELS: Record<string, string> = {
  read: "查询",
  create: "新增",
  edit: "修改",
  update: "修改",
  submit: "提交",
  review: "审核",
  approve: "审批",
  settle: "结算 / 付款",
  pay: "付款",
  payment: "付款",
  void: "作废 / 归档",
  export: "导出",
  print: "打印",
  manage: "全量办理",
  publish: "发布",
  rollback: "回滚",
  test: "测试",
  menu: "菜单",
};
export const authorizationModuleLabel = (module: string) =>
  MODULE_LABELS[module] ?? "其他业务模块";
export const authorizationActionLabel = (action: string) =>
  ACTION_LABELS[action] ?? "业务操作";
export const authorizationDisplayName = (
  name: string | undefined,
  fallback: string
) => (name && /[\u3400-\u9fff]/.test(name) ? name : fallback);
export const isAssignableRole = (role: AuthorizationRole) =>
  role.status === "active" &&
  !["SUPER_ADMIN", "DRIVER"].includes(role.code) &&
  role.category === "business";
export const isAssignablePermission = (permission: AuthorizationPermission) =>
  [
    "construction",
    "labor",
    "machinery",
    "transport",
    "purchase",
    "measurement",
    "contract",
    "finance",
    "diesel",
    "evidence",
    "mobile",
    "message",
  ].includes(permission.module) &&
  [
    "read",
    "create",
    "edit",
    "manage",
    "submit",
    "review",
    "settle",
    "void",
    "export",
    "print",
  ].includes(permission.action);
export const isAssignableOrganization = (
  organization: AuthorizationOrganization
) =>
  organization.status === "active" &&
  ["department", "project_department"].includes(organization.type);
export const isAssignableProject = (project: AuthorizationProject) =>
  project.status !== "archived";
const originalTime = (value: string | Date | null | undefined) =>
  value instanceof Date ? value.toISOString() : (value ?? null);
export function createAuthorizationDraft(
  snapshot: AuthorizationSnapshot
): AuthorizationDraft {
  return {
    assignments: snapshot.assignments.map(item => ({
      ...item,
      validFrom: originalTime(item.validFrom),
      validTo: originalTime(item.validTo),
    })),
    permissionIds: [...snapshot.permissionIds],
  };
}
/** 显示按 businessTime 的北京时间；未编辑的 UTC 值不经输入格式重新序列化。 */
export function toAuthorizationTimeInput(value: string | null) {
  if (!value) return "";
  const date = toChinaDateInput(value);
  const time = formatChinaDateTime(value, "").split(" ")[1];
  return date && time ? `${date}T${time}` : "";
}
export function fromAuthorizationTimeInput(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return value;
  const date = new Date(`${value}+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  const result = date.toISOString();
  const roundTrip = toAuthorizationTimeInput(result);
  return roundTrip.startsWith(value) ? result : value;
}
export function authorizationAssignmentIssues(
  assignment: AuthorizationDraft["assignments"][number],
  catalog: AuthorizationCatalog
) {
  const issues: string[] = [];
  const role = catalog.roles.find(item => item.id === assignment.roleId);
  if (!role || !isAssignableRole(role))
    issues.push("岗位已停用或不可用，请重新选择或撤销此授予");
  if (!assignment.organizationId && !assignment.projectId)
    issues.push("请选择部门 / 项目部或具体项目范围");
  if (assignment.organizationId && assignment.projectId)
    issues.push("范围需选择部门或项目之一，不能同时授予");
  if (assignment.organizationId) {
    const organization = catalog.organizations.find(
      item => item.id === assignment.organizationId
    );
    if (!organization || !isAssignableOrganization(organization))
      issues.push("部门已停用或不可用，请重新选择或撤销此授予");
  }
  if (assignment.projectId) {
    const project = catalog.projects.find(
      item => item.id === assignment.projectId
    );
    if (!project || !isAssignableProject(project))
      issues.push("项目已归档或不可用，请重新选择或撤销此授予");
  }
  const times = [assignment.validFrom, assignment.validTo];
  if (
    times.some(
      value =>
        value &&
        (Number.isNaN(new Date(value).getTime()) ||
          !/Z$|[+-]\d{2}:\d{2}$/.test(value))
    )
  ) {
    issues.push("请输入有效的北京时间起止时间");
  } else if (
    assignment.validFrom &&
    assignment.validTo &&
    new Date(assignment.validFrom) >= new Date(assignment.validTo)
  ) {
    issues.push("结束时间必须晚于开始时间");
  }
  return issues;
}
export function authorizationDraftIssues(
  draft: AuthorizationDraft,
  catalog: AuthorizationCatalog
) {
  const issues = draft.assignments.flatMap((item, index) =>
    authorizationAssignmentIssues(item, catalog).map(
      message => `第 ${index + 1} 项：${message}`
    )
  );
  if (
    draft.permissionIds.some(
      id =>
        !catalog.permissions.some(
          item => item.id === id && isAssignablePermission(item)
        )
    )
  ) {
    issues.push("存在不可用的专属权限，请明确移除后再保存");
  }
  return issues;
}
export function buildAuthorizationInput(
  userId: number,
  revision: string,
  draft: AuthorizationDraft
) {
  return {
    userId,
    revision,
    assignments: draft.assignments.map(item => ({ ...item })),
    permissionIds: [...draft.permissionIds],
  };
}
export function assignmentIsCurrent(
  assignment: AuthorizationDraft["assignments"][number],
  now = Date.now()
) {
  return (
    (!assignment.validFrom ||
      new Date(assignment.validFrom).getTime() <= now) &&
    (!assignment.validTo || new Date(assignment.validTo).getTime() > now)
  );
}
export function modulePermissionIds(
  module: string,
  permissions: AuthorizationPermission[]
) {
  return permissions
    .filter(item => item.module === module)
    .map(item => item.id);
}
/** 无专属配置时沿用该模块岗位权限，而不是显式拒绝全部。 */
export function effectiveModulePermissionIds(
  module: string,
  permissions: AuthorizationPermission[],
  explicitIds: number[],
  roleIds: number[]
) {
  const ids = modulePermissionIds(module, permissions);
  const explicit = explicitIds.filter(id => ids.includes(id));
  return explicit.length ? explicit : roleIds.filter(id => ids.includes(id));
}
