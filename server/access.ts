import { and, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { departmentBusinessScopes, officialAccountBindings, organizations, projects, rolePermissions, systemPermissions, systemRoles, userPermissions, userProfiles, userRoleAssignments, users } from "../drizzle/schema";
import { DEPARTMENT_BUSINESS_MODULES, type DepartmentBusinessModule, getDepartmentBusinessModuleName } from "../shared/department";
import { MOBILE_MENU_CATALOG } from "../shared/domain";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

type DepartmentScopedContext = TrpcContext & { departmentModule?: DepartmentBusinessModule };
type DataScope = { userId: number; hasAllProjects: boolean; projectIds: number[]; organizationIds: number[] };

/** 角色详细授权按业务域与动作拆分；未配置详细权限的历史角色继续沿用既有岗位授权，避免升级时误锁业务。 */
export type BusinessOperationAction = "read" | "create" | "edit" | "manage" | "submit" | "review" | "settle" | "void" | "export" | "print";

const OPERATION_PERMISSION_MODULE_BY_DEPARTMENT: Record<DepartmentBusinessModule, string> = {
  CONSTRUCTION: "construction",
  LABOR: "labor",
  MACHINERY: "machinery",
  TRANSPORT: "transport",
  PURCHASING: "purchase",
  MEASUREMENT: "measurement",
  CONTRACT: "contract",
  FINANCE: "finance",
  DIESEL: "diesel",
  EVIDENCE: "evidence",
};

const DEPARTMENT_MODULE_BY_OPERATION_PERMISSION = Object.fromEntries(
  Object.entries(OPERATION_PERMISSION_MODULE_BY_DEPARTMENT).map(([departmentModule, permissionModule]) => [permissionModule, departmentModule as DepartmentBusinessModule]),
) as Record<string, DepartmentBusinessModule | undefined>;

/** 兼容旧版“manage”总授权；管理员一旦为角色配置细粒度项，未勾选的动作将被明确拒绝。 */
export function isRoleOperationGranted(grantedActions: readonly string[], requestedAction: BusinessOperationAction) {
  if (grantedActions.length === 0) return true;
  return grantedActions.includes("manage") || grantedActions.includes(requestedAction);
}

export type RoleOperationPermissionDecision = { hasDetailedPermissions: boolean; allowed: boolean };

export async function getRoleOperationPermissionDecision(ctx: TrpcContext, module: DepartmentBusinessModule, action: BusinessOperationAction, knownNonSuperAdmin = false): Promise<RoleOperationPermissionDecision> {
  const user = requireAuthenticatedUser(ctx);
  if (!knownNonSuperAdmin) {
    const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
    if (isSuperAdmin) return { hasDetailedPermissions: true, allowed: true };
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const now = new Date();
  const permissionModule = OPERATION_PERMISSION_MODULE_BY_DEPARTMENT[module];
  const userRows = await db
    .select({ action: systemPermissions.action })
    .from(userPermissions)
    .innerJoin(systemPermissions, eq(userPermissions.permissionId, systemPermissions.id))
    .where(and(eq(userPermissions.userId, user.id), eq(systemPermissions.module, permissionModule)));
  const userGrantedActions = Array.from(new Set(userRows.map(row => row.action)));
  // 具体用户在某业务模块配置过专属权限后，该模块不再回退角色矩阵，确保管理员可收窄或扩展单人权限。
  if (userGrantedActions.length > 0) {
    return { hasDetailedPermissions: true, allowed: isRoleOperationGranted(userGrantedActions, action) };
  }
  const rows = await db
    .select({ action: systemPermissions.action })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, systemRoles.id))
    .innerJoin(systemPermissions, eq(rolePermissions.permissionId, systemPermissions.id))
    .where(and(
      eq(userRoleAssignments.userId, user.id),
      eq(userRoleAssignments.status, "active"),
      eq(systemRoles.status, "active"),
      eq(systemPermissions.module, permissionModule),
      or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
      or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
    ));
  const grantedActions = Array.from(new Set(rows.map(row => row.action)));
  return { hasDetailedPermissions: grantedActions.length > 0, allowed: isRoleOperationGranted(grantedActions, action) };
}

export async function assertRoleOperationPermission(ctx: TrpcContext, module: DepartmentBusinessModule, action: BusinessOperationAction, knownNonSuperAdmin = false) {
  const decision = await getRoleOperationPermissionDecision(ctx, module, action, knownNonSuperAdmin);
  if (!decision.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `当前账号未被授予“${getDepartmentBusinessModuleName(module)}”的“${action}”操作权限，请联系超级管理员调整用户或角色权限矩阵`,
    });
  }
  return decision;
}

/** 判断用户是否在指定业务域拥有显式专属操作权限；用于兼容业务路由历史岗位白名单，不能替代项目范围校验。 */
export async function hasUserSpecificOperationPermission(ctx: TrpcContext, module: DepartmentBusinessModule, action: BusinessOperationAction) {
  const user = requireAuthenticatedUser(ctx);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const rows = await db
    .select({ action: systemPermissions.action })
    .from(userPermissions)
    .innerJoin(systemPermissions, eq(userPermissions.permissionId, systemPermissions.id))
    .where(and(eq(userPermissions.userId, user.id), eq(systemPermissions.module, OPERATION_PERMISSION_MODULE_BY_DEPARTMENT[module])));
  const grantedActions = Array.from(new Set(rows.map(row => row.action)));
  return grantedActions.length > 0 && isRoleOperationGranted(grantedActions, action);
}

/** 用户专属权限中拥有查看或总办理授权的业务域，可作为移动菜单投影候选；仍需绑定一个有效项目范围。 */
async function getUserSpecificMenuModulesForUser(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const rows = await db
    .select({ module: systemPermissions.module, action: systemPermissions.action })
    .from(userPermissions)
    .innerJoin(systemPermissions, eq(userPermissions.permissionId, systemPermissions.id))
    .where(eq(userPermissions.userId, userId));
  const actionsByModule = new Map<string, Set<string>>();
  for (const row of rows) {
    const actions = actionsByModule.get(row.module) ?? new Set<string>();
    actions.add(row.action);
    actionsByModule.set(row.module, actions);
  }
  return Array.from(actionsByModule.entries())
    .filter(([, actions]) => actions.has("read") || actions.has("manage"))
    .map(([permissionModule]) => DEPARTMENT_MODULE_BY_OPERATION_PERMISSION[permissionModule])
    .filter((module): module is DepartmentBusinessModule => Boolean(module));
}

/** 角色细分权限可补充旧岗位菜单目录，但只能在该角色既有部门或项目范围内生效。 */
async function getRoleDetailedMenuModulesByRole(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  roleCodes: readonly string[],
) {
  const result = new Map<string, Set<DepartmentBusinessModule>>();
  const distinctRoleCodes = Array.from(new Set(roleCodes.filter(Boolean)));
  if (!distinctRoleCodes.length) return result;
  const rows = await db
    .select({ roleCode: systemRoles.code, permissionModule: systemPermissions.module, action: systemPermissions.action })
    .from(rolePermissions)
    .innerJoin(systemRoles, eq(rolePermissions.roleId, systemRoles.id))
    .innerJoin(systemPermissions, eq(rolePermissions.permissionId, systemPermissions.id))
    .where(inArray(systemRoles.code, distinctRoleCodes));
  for (const row of rows) {
    if (row.action !== "read" && row.action !== "manage") continue;
    const departmentModule = DEPARTMENT_MODULE_BY_OPERATION_PERMISSION[row.permissionModule];
    if (!departmentModule) continue;
    const modules = result.get(row.roleCode) ?? new Set<DepartmentBusinessModule>();
    modules.add(departmentModule);
    result.set(row.roleCode, modules);
  }
  return result;
}

/** 供工作台展示“已按用户专属权限开放”的业务模块；不得单独用于放宽项目数据范围。 */
export async function getCurrentUserSpecificMenuModules(ctx: TrpcContext) {
  const user = requireAuthenticatedUser(ctx);
  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (isSuperAdmin) return [] as DepartmentBusinessModule[];
  const db = await getDb();
  if (!db) return [] as DepartmentBusinessModule[];
  return getUserSpecificMenuModulesForUser(db, user.id);
}

/** 岗位必须能够办理目标模块；`ALL` 菜单表示任一已授权业务岗位均可使用该通用模块。 */
function canRoleHandleDepartmentModule(roleCode: string, module: DepartmentBusinessModule) {
  const menu = MOBILE_MENU_CATALOG.find(item => item.code === module);
  if (!menu) return false;
  const permittedRoles = menu.roles as readonly string[];
  return permittedRoles.includes("ALL") || permittedRoles.includes(roleCode);
}

function canRoleHandleModuleWithDetailedPermission(
  roleCode: string,
  module: DepartmentBusinessModule,
  detailedModulesByRole: ReadonlyMap<string, ReadonlySet<DepartmentBusinessModule>>,
) {
  return canRoleHandleDepartmentModule(roleCode, module) || detailedModulesByRole.get(roleCode)?.has(module) === true;
}

/** 项目级角色授权沿用同一移动菜单目录推导可办理模块，避免前后端维护两套岗位规则。 */
function getRoleDepartmentModules(roleCode: string): DepartmentBusinessModule[] {
  return DEPARTMENT_BUSINESS_MODULES
    .filter(item => canRoleHandleDepartmentModule(roleCode, item.code))
    .map(item => item.code);
}

/**
 * 没有部门归属但明确限定到具体项目的有效业务角色授权。
 * 该查询绝不产生全项目范围，且归档项目会被排除。
 */
async function getProjectScopedRoleAssignments(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  now: Date,
) {
  return db
    .select({ projectId: userRoleAssignments.projectId, roleId: systemRoles.id, roleCode: systemRoles.code })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .innerJoin(projects, eq(userRoleAssignments.projectId, projects.id))
    .where(
      and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        isNull(userRoleAssignments.organizationId),
        ne(projects.status, "archived"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );
}

/**
 * 项目直接授权已有角色菜单是历史兼容基线；未配置项目范围时完全保持旧行为。
 * 一旦项目存在任一业务范围记录，该项目以启用模块为白名单；白名单仍只能收紧既有角色菜单，
 * 绝不能通过菜单配置给用户增加项目、角色或具体操作权限。
 */
async function getProjectScopedModuleRows(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  assignments: Array<{ projectId: number | null; roleCode: string }>,
  detailedModulesByRole: ReadonlyMap<string, ReadonlySet<DepartmentBusinessModule>>,
  userSpecificModuleCodes: readonly DepartmentBusinessModule[],
) {
  const projectIds = Array.from(
    new Set(
      assignments
        .map(assignment => assignment.projectId)
        .filter((projectId): projectId is number => Number.isInteger(projectId))
    )
  );
  if (!projectIds.length) return [] as Array<{ projectId: number; roleCode: string; module: DepartmentBusinessModule }>;

  const configuredRows = await db
    .select({
      projectId: departmentBusinessScopes.projectId,
      module: departmentBusinessScopes.module,
      status: departmentBusinessScopes.status,
    })
    .from(departmentBusinessScopes)
    .where(inArray(departmentBusinessScopes.projectId, projectIds));
  const statusByProjectAndModule = new Map<string, "active" | "disabled">();
  const configuredProjectIds = new Set<number>();
  for (const row of configuredRows) {
    if (row.projectId !== null) {
      configuredProjectIds.add(row.projectId);
      statusByProjectAndModule.set(
        `${row.projectId}:${row.module}`,
        row.status
      );
    }
  }

  const result: Array<{
    projectId: number;
    roleCode: string;
    module: DepartmentBusinessModule;
  }> = [];
  for (const assignment of assignments) {
    const projectId = assignment.projectId;
    if (typeof projectId !== "number" || !Number.isInteger(projectId)) continue;
    const candidateModules = new Set<DepartmentBusinessModule>([
      ...getRoleDepartmentModules(assignment.roleCode),
      ...Array.from(detailedModulesByRole.get(assignment.roleCode) ?? []),
      ...userSpecificModuleCodes,
    ]);
    for (const module of Array.from(candidateModules)) {
      // 未配置项目级开关时保持既有直接项目授权；已配置时必须显式启用当前模块。
      if (
        configuredProjectIds.has(projectId) &&
        statusByProjectAndModule.get(`${projectId}:${module}`) !== "active"
      ) continue;
      result.push({ projectId, roleCode: assignment.roleCode, module });
    }
  }
  return result;
}

/** 将角色授权记录安全收敛为项目与组织数据范围；空集合始终表示无数据访问权。 */
function toDataScope(userId: number, rows: Array<{ projectId: number | null; organizationId: number | null }>, hasAllProjects = false): DataScope {
  return {
    userId,
    hasAllProjects,
    projectIds: Array.from(new Set(rows.flatMap(row => (row.projectId ? [row.projectId] : [])))),
    organizationIds: Array.from(new Set(rows.flatMap(row => (row.organizationId ? [row.organizationId] : [])))),
  };
}

/** 由部门业务过程写入的内部模块标识，仅服务端中间件可设置，客户端请求不可伪造。 */
function getRequestedDepartmentModule(ctx: TrpcContext) {
  return (ctx as DepartmentScopedContext).departmentModule;
}

/**
 * 校验用户已登录。业务路由和后台路由均应先调用此函数，
 * 避免仅靠前端隐藏菜单造成越权访问。
 */
export function requireAuthenticatedUser(ctx: TrpcContext) {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再继续操作" });
  }
  if (["local_manager", "local_driver"].includes(ctx.user.loginMethod ?? "") && ctx.user.localAccountStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: ctx.user.loginMethod === "local_driver" ? "该司机手机号账号已停用，请联系管理员" : "该普通管理人员账号已停用，请联系超级管理员" });
  }
  if (ctx.user.loginMethod === "deleted_local_manager") {
    throw new TRPCError({ code: "FORBIDDEN", message: "该普通管理人员账号已删除，请联系超级管理员" });
  }
  return ctx.user;
}

/**
 * 模板管理员或被分配 SUPER_ADMIN 角色的用户，才可以访问 PC 超级管理后台。
 */
export async function assertSuperAdmin(ctx: TrpcContext) {
  const { user, canAccess } = await getSuperAdminAccess(ctx);

  if (!canAccess) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可访问 PC 管理后台" });
  }
  return user;
}

/**
 * 已有业务记录的修改、状态流转和结算属于高影响动作。
 * 该断言供使用自然键幂等写入的业务过程调用，避免没有 `id` 的更新绕过统一 RPC 中间件。
 */
export async function assertExistingBusinessRecordChangeAccess(ctx: TrpcContext) {
  const { user, canAccess } = await getSuperAdminAccess(ctx);
  if (!canAccess) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "普通管理人员仅可在已授权业务范围内新增和查看数据；修改既有业务记录仅限超级管理员",
    });
  }
  return user;
}

/**
 * 返回当前用户是否具备 PC 超级管理后台访问资格。
 * 此方法不抛出无权异常，供前端路由守卫在进入后台前完成友好重定向；
 * 真正的业务接口仍必须调用 assertSuperAdmin 作为服务端兜底。
 */
export async function getSuperAdminAccess(ctx: TrpcContext) {
  const user = requireAuthenticatedUser(ctx);
  if (user.role === "admin") return { user, canAccess: true };

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

  const now = new Date();
  const assignments = await db
    .select({ roleCode: systemRoles.code })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.code, "SUPER_ADMIN"),
        eq(systemRoles.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    )
    .limit(1);
  return { user, canAccess: assignments.length > 0 };
}

/**
 * 获取当前用户的有效业务角色代码。管理员使用 ALL 标记，
 * 以保证移动端菜单与后台设置均能覆盖全部业务模块。
 */
export async function getEffectiveRoleCodes(ctx: TrpcContext): Promise<string[]> {
  const user = requireAuthenticatedUser(ctx);
  if (user.role === "admin") return ["ALL", "SUPER_ADMIN"];

  // 通过系统角色授予的超级管理员，与模板管理员拥有相同的全局业务模块语义。
  // 不能只在 PC 后台放行，否则该账号会错误地在业务路由中落入普通部门范围。
  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (isSuperAdmin) return ["ALL", "SUPER_ADMIN"];

  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const rows = await db
    .select({ roleCode: systemRoles.code })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );
  return rows.map(row => row.roleCode);
}

/**
 * 解析登录人员通过有效角色授权所归属的部门，以及这些部门启用的业务模块。
 * 未配置部门或部门模块时返回空集合，遵循默认拒绝原则，避免旧角色被误解为跨部门业务授权。
 */
export async function getCurrentDepartmentAccess(ctx: TrpcContext) {
  const user = requireAuthenticatedUser(ctx);
  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (isSuperAdmin) {
    return {
      departments: [] as Array<{ id: number; name: string; type: "department" | "project_department" }>,
      moduleCodes: ["CONSTRUCTION", "LABOR", "MACHINERY", "TRANSPORT", "PURCHASING", "MEASUREMENT", "CONTRACT", "FINANCE", "DIESEL", "EVIDENCE"] as DepartmentBusinessModule[],
      hasAllDepartments: true,
    };
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

  const now = new Date();
  const rows = await db
    .select({ organizationId: organizations.id, organizationName: organizations.name, organizationType: organizations.type, roleId: systemRoles.id, roleCode: systemRoles.code, module: departmentBusinessScopes.module })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .innerJoin(organizations, eq(userRoleAssignments.organizationId, organizations.id))
    .innerJoin(departmentBusinessScopes, eq(organizations.id, departmentBusinessScopes.organizationId))
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        eq(organizations.status, "active"),
        or(eq(organizations.type, "department"), eq(organizations.type, "project_department")),
        eq(departmentBusinessScopes.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );

  const projectScopedRows = await getProjectScopedRoleAssignments(db, user.id, now);
  const detailedModulesByRole = await getRoleDetailedMenuModulesByRole(db, [...rows.map(row => row.roleCode), ...projectScopedRows.map(row => row.roleCode)]);
  const authorizedRows = rows.filter(row => canRoleHandleModuleWithDetailedPermission(row.roleCode, row.module as DepartmentBusinessModule, detailedModulesByRole));
  // 用户专属权限只能复用其既有的直接项目范围，不能在无项目角色授权时凭空扩大数据边界。
  const userSpecificModuleCodes = projectScopedRows.length > 0 ? await getUserSpecificMenuModulesForUser(db, user.id) : [];
  const projectModuleRows = await getProjectScopedModuleRows(
    db,
    projectScopedRows,
    detailedModulesByRole,
    userSpecificModuleCodes
  );
  const departmentMap = new Map<number, { id: number; name: string; type: "department" | "project_department" }>();
  for (const row of authorizedRows) {
    // 查询条件已限制为两类部门节点；显式保护让未来扩展组织枚举时仍不会放宽部门边界。
    if (row.organizationType === "department" || row.organizationType === "project_department") {
      departmentMap.set(row.organizationId, { id: row.organizationId, name: row.organizationName, type: row.organizationType });
    }
  }
  return {
    departments: Array.from(departmentMap.values()),
    moduleCodes: Array.from(new Set([
      ...authorizedRows.map(row => row.module),
      ...projectModuleRows.map(row => row.module),
    ])) as DepartmentBusinessModule[],
    hasAllDepartments: false,
  };
}

/** 当前用户是否可代表其已配置部门办理指定业务；角色、部门业务范围及已配置的详细操作权限均必须有效。 */
export async function assertDepartmentBusinessAccess(ctx: TrpcContext, module: DepartmentBusinessModule, action: BusinessOperationAction = "read") {
  const access = await getCurrentDepartmentAccess(ctx);
  if (access.hasAllDepartments || access.moduleCodes.includes(module)) {
    if (!access.hasAllDepartments) await assertRoleOperationPermission(ctx, module, action, true);
    // 上下文仅存在于当前服务端请求内；客户端无法注入该字段。
    (ctx as DepartmentScopedContext).departmentModule = module;
    return access;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: `当前账号所属部门未获授权办理“${getDepartmentBusinessModuleName(module)}”业务` });
}

/** 返回某个已授权部门业务域下的项目与组织范围；管理员始终拥有完整范围。 */
async function getCurrentDepartmentModuleDataScope(ctx: TrpcContext, module: DepartmentBusinessModule): Promise<DataScope> {
  const user = requireAuthenticatedUser(ctx);
  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (isSuperAdmin) return toDataScope(user.id, [], true);

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

  const now = new Date();
  const rows = await db
    .select({ projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId, roleCode: systemRoles.code, module: departmentBusinessScopes.module })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .innerJoin(organizations, eq(userRoleAssignments.organizationId, organizations.id))
    .innerJoin(departmentBusinessScopes, eq(organizations.id, departmentBusinessScopes.organizationId))
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        eq(organizations.status, "active"),
        or(eq(organizations.type, "department"), eq(organizations.type, "project_department")),
        eq(departmentBusinessScopes.module, module),
        eq(departmentBusinessScopes.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );
  const projectScopedRows = await getProjectScopedRoleAssignments(db, user.id, now);
  const detailedModulesByRole = await getRoleDetailedMenuModulesByRole(db, [...rows.map(row => row.roleCode), ...projectScopedRows.map(row => row.roleCode)]);
  const departmentScopedRows = rows.filter(row => canRoleHandleModuleWithDetailedPermission(row.roleCode, row.module as DepartmentBusinessModule, detailedModulesByRole));
  const userSpecificModuleCodes = projectScopedRows.length > 0 ? await getUserSpecificMenuModulesForUser(db, user.id) : [];
  const projectModuleRows = await getProjectScopedModuleRows(
    db,
    projectScopedRows,
    detailedModulesByRole,
    userSpecificModuleCodes
  );
  const directProjectRows = projectModuleRows
    .filter(row => row.module === module)
    .map(row => ({ projectId: row.projectId, organizationId: null }));
  return toDataScope(user.id, [...departmentScopedRows, ...directProjectRows]);
}

/**
 * 获取指定部门业务模块的独立项目范围。工作台聚合多个模块时必须使用此函数，
 * 禁止将劳务、财务等不同模块的项目范围混合后用于单个模块的统计或查询。
 */
export async function getDepartmentModuleDataScope(ctx: TrpcContext, module: DepartmentBusinessModule) {
  await assertDepartmentBusinessAccess(ctx, module);
  return getCurrentDepartmentModuleDataScope(ctx, module);
}

/**
 * 计算当前用户在业务数据查询中可访问的组织和项目范围。
 * 项目范围为空且 hasAllProjects 为 false 时表示无项目数据访问权，业务路由不得将其误解为全部项目。
 */
export async function getCurrentDataScope(ctx: TrpcContext) {
  const user = requireAuthenticatedUser(ctx);
  const departmentModule = getRequestedDepartmentModule(ctx);
  if (departmentModule) return getCurrentDepartmentModuleDataScope(ctx, departmentModule);
  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (isSuperAdmin) {
    return toDataScope(user.id, [], true);
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

  const now = new Date();
  const rows = await db
    .select({ projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId, roleCode: systemRoles.code, module: departmentBusinessScopes.module })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .innerJoin(organizations, eq(userRoleAssignments.organizationId, organizations.id))
    .innerJoin(departmentBusinessScopes, eq(organizations.id, departmentBusinessScopes.organizationId))
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        eq(systemRoles.status, "active"),
        eq(organizations.status, "active"),
        or(eq(organizations.type, "department"), eq(organizations.type, "project_department")),
        eq(departmentBusinessScopes.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );

  const projectScopedRows = await getProjectScopedRoleAssignments(db, user.id, now);
  const detailedModulesByRole = await getRoleDetailedMenuModulesByRole(db, [...rows.map(row => row.roleCode), ...projectScopedRows.map(row => row.roleCode)]);
  const authorizedRows = rows.filter(row => canRoleHandleModuleWithDetailedPermission(row.roleCode, row.module as DepartmentBusinessModule, detailedModulesByRole));
  const directProjectRows = projectScopedRows.map(row => ({ projectId: row.projectId, organizationId: null }));
  return toDataScope(user.id, [...authorizedRows, ...directProjectRows]);
}

/**
 * 供后续业务查询统一调用的项目范围校验。调用方在按 projectId 查询、创建或审批单据前必须执行。
 */
export async function assertProjectInCurrentScope(ctx: TrpcContext, projectId: number) {
  const scope = await getCurrentDataScope(ctx);
  if (scope.hasAllProjects || scope.projectIds.includes(projectId)) {
    return scope;
  }

  // 组织范围授权可覆盖该组织直接归属的项目；未经此查询不能把“无项目 ID”误解为全部项目。
  if (scope.organizationIds.length > 0) {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const rows = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (rows[0]?.organizationId && scope.organizationIds.includes(rows[0].organizationId)) {
      return scope;
    }
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未获授权访问该项目数据" });
}

/**
 * 字段脱敏的统一工具。身份证、银行卡、手机号等敏感值只能在服务端按权限投影，
 * 业务接口不得把原始密文或明文透传给移动端与普通管理人员。
 */
export function maskSensitiveValue(value: string | null | undefined, visibleTail = 4) {
  if (!value) return null;
  if (value.length <= visibleTail) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(4, value.length - visibleTail))}${value.slice(-visibleTail)}`;
}

/** 供后台人员管理页使用的安全用户概览查询。 */
export async function listLoginUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    name: users.name,
    role: users.role,
    loginMethod: users.loginMethod,
    localUsername: users.localUsername,
    localAccountStatus: users.localAccountStatus,
    localLoginMode: users.localLoginMode,
    localPasswordChangeRequired: users.localPasswordChangeRequired,
    lastSignedIn: users.lastSignedIn,
    profileStatus: userProfiles.status,
    officialAccountBindingStatus: officialAccountBindings.status,
    officialAccountLastVerifiedAt: officialAccountBindings.lastVerifiedAt,
  }).from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .leftJoin(officialAccountBindings, eq(officialAccountBindings.userId, users.id));
}
