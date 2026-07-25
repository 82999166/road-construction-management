import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { projects, systemRoles, userRoleAssignments, users } from "../drizzle/schema";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

/**
 * 校验用户已登录。业务路由和后台路由均应先调用此函数，
 * 避免仅靠前端隐藏菜单造成越权访问。
 */
export function requireAuthenticatedUser(ctx: TrpcContext) {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再继续操作" });
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
 * 计算当前用户在业务数据查询中可访问的组织和项目范围。
 * 项目范围为空且 hasAllProjects 为 false 时表示无项目数据访问权，业务路由不得将其误解为全部项目。
 */
export async function getCurrentDataScope(ctx: TrpcContext) {
  const user = requireAuthenticatedUser(ctx);
  if (user.role === "admin") {
    return { userId: user.id, hasAllProjects: true, projectIds: [] as number[], organizationIds: [] as number[] };
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

  const now = new Date();
  const rows = await db
    .select({ projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId })
    .from(userRoleAssignments)
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.status, "active"),
        or(isNull(userRoleAssignments.validFrom), lte(userRoleAssignments.validFrom, now)),
        or(isNull(userRoleAssignments.validTo), gt(userRoleAssignments.validTo, now)),
      ),
    );

  return {
    userId: user.id,
    hasAllProjects: rows.some(row => row.projectId === null && row.organizationId === null),
    projectIds: Array.from(new Set(rows.flatMap(row => (row.projectId ? [row.projectId] : [])))),
    organizationIds: Array.from(new Set(rows.flatMap(row => (row.organizationId ? [row.organizationId] : [])))),
  };
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
  return db.select({ id: users.id, name: users.name, role: users.role, lastSignedIn: users.lastSignedIn }).from(users);
}
