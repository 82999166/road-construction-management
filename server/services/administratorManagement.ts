import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  auditLogs,
  organizations,
  projects,
  systemPermissions,
  systemRoles,
  userPermissions,
  userProfiles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createLocalManagerOpenId,
  createLocalManagerPasswordHash,
  isValidLocalManagerUsername,
  normalizeLocalManagerUsername,
} from "../localAuth";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export const administratorAccountInput = z.object({
  username: z.string().trim().min(1, "请输入登录手机号").max(32),
  displayName: z.string().trim().min(2, "姓名至少 2 个字符").max(128),
  status: z.enum(["active", "disabled"]),
  loginMode: z.enum(["pc", "mobile", "both"]),
});
const assignmentInput = z
  .object({
    id: z.number().int().positive().optional(),
    roleId: z.number().int().positive(),
    organizationId: z.number().int().positive().nullable().optional(),
    projectId: z.number().int().positive().nullable().optional(),
    validFrom: z.string().datetime({ offset: true }).nullable().optional(),
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export const administratorAuthorizationInput = z
  .object({
    userId: z.number().int().positive(),
    revision: z.string().regex(/^[a-f0-9]{64}$/, "授权版本无效，请刷新后重试"),
    assignments: z.array(assignmentInput).max(500),
    permissionIds: z.array(z.number().int().positive()).max(1000),
  })
  .strict();

type AccountInput = z.infer<typeof administratorAccountInput>;
type AuthorizationInput = z.infer<typeof administratorAuthorizationInput>;

/** Only these existing catalog modules/actions can be assigned by this account editor. */
export const ADMINISTRATOR_PERMISSION_MODULES = [
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
] as const;
const allowedActions = new Set([
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
]);
const allowedModules = new Set<string>(ADMINISTRATOR_PERMISSION_MODULES);
const excludedRoleCodes = new Set(["SUPER_ADMIN", "DRIVER"]);

function fail(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  return db;
}
function normalizedUsername(value: string) {
  const username = normalizeLocalManagerUsername(value);
  if (!isValidLocalManagerUsername(username))
    fail("请输入有效的中国大陆手机号码（11 位）");
  return username;
}
function isDuplicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: string; errno?: number; cause?: unknown };
  return (
    detail.code === "ER_DUP_ENTRY" ||
    detail.errno === 1062 ||
    (detail.cause !== error && isDuplicate(detail.cause))
  );
}
/** Do not propagate database SQL/parameters (which may include credential hashes) to callers. */
async function atomic<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await database();
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (isDuplicate(error))
      throw new TRPCError({
        code: "CONFLICT",
        message: "该手机号已被使用，请使用其他手机号",
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "保存失败，所有变更已回滚，请稍后重试",
    });
  }
}
const targetFields = {
  id: users.id,
  role: users.role,
  loginMethod: users.loginMethod,
  // Auth refreshes lastSignedIn/updatedAt on every request; these are not authorization facts.
  localAccountStatus: users.localAccountStatus,
};
async function lockTarget(tx: Transaction, userId: number) {
  const [target] = await tx
    .select(targetFields)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!target || target.loginMethod !== "local_manager") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "该普通管理员账号不存在",
    });
  }
  if (target.role !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "超级管理员账号在此仅可查看，不可编辑、重置或配置授权",
    });
  }
  const superRoles = await tx
    .select({ id: systemRoles.id })
    .from(systemRoles)
    .where(eq(systemRoles.code, "SUPER_ADMIN"));
  if (superRoles.length) {
    const superAssignments = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.userId, userId),
          eq(userRoleAssignments.status, "active"),
          inArray(
            userRoleAssignments.roleId,
            superRoles.map(row => row.id)
          )
        )
      )
      .limit(1)
      .for("update");
    if (superAssignments.length)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "该账号含超级管理员授权，不可通过普通管理员入口维护",
      });
  }
  return target;
}
async function checkUsernameOwner(
  tx: Transaction,
  username: string,
  userId?: number
) {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.localUsername, username))
    .limit(1);
  if (owner && owner.id !== userId)
    throw new TRPCError({
      code: "CONFLICT",
      message: "该手机号已被使用，请使用其他手机号",
    });
}
function accountAudit(
  tx: Transaction,
  adminId: number,
  userId: number,
  action: string,
  summary: string,
  module = "permission"
) {
  return tx
    .insert(auditLogs)
    .values({
      userId: adminId,
      module,
      action,
      targetType: "user",
      targetId: String(userId),
      summary,
    });
}

export async function listAdministrators() {
  const db = await database();
  return db
    .select({
      id: users.id,
      name: users.name,
      localUsername: users.localUsername,
      localAccountStatus: users.localAccountStatus,
      localLoginMode: users.localLoginMode,
      role: users.role,
      lastSignedIn: users.lastSignedIn,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.loginMethod, "local_manager"))
    .orderBy(desc(users.createdAt), desc(users.id));
}

export async function createAdministrator(
  adminId: number,
  input: AccountInput & { initialPassword: string }
) {
  const username = normalizedUsername(input.username);
  const hash = createLocalManagerPasswordHash(input.initialPassword);
  return atomic(async tx => {
    await checkUsernameOwner(tx, username);
    await tx.insert(users).values({
      openId: createLocalManagerOpenId(username),
      name: input.displayName,
      loginMethod: "local_manager",
      role: "user",
      localUsername: username,
      localPasswordHash: hash,
      localAccountStatus: input.status,
      localLoginMode: input.loginMode,
      localPasswordChangeRequired: false,
      lastSignedIn: new Date(),
    });
    const [created] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.localUsername, username))
      .limit(1);
    if (!created)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "账号创建失败，所有变更已回滚",
      });
    await tx
      .insert(userProfiles)
      .values({
        userId: created.id,
        status: input.status === "active" ? "pending" : "disabled",
      });
    await accountAudit(
      tx,
      adminId,
      created.id,
      "create_local_manager_account",
      "创建普通管理员账号"
    );
    return { success: true, userId: created.id } as const;
  });
}

export async function updateAdministrator(
  adminId: number,
  input: AccountInput & { userId: number }
) {
  const username = normalizedUsername(input.username);
  return atomic(async tx => {
    const target = await lockTarget(tx, input.userId);
    await checkUsernameOwner(tx, username, target.id);
    const [profile] = await tx
      .select({ id: userProfiles.id, status: userProfiles.status })
      .from(userProfiles)
      .where(eq(userProfiles.userId, target.id))
      .limit(1)
      .for("update");
    const profileStatus =
      input.status === "disabled"
        ? "disabled"
        : target.localAccountStatus === "disabled"
          ? "pending"
          : (profile?.status ?? "pending");
    // openId is a stable identity key used by OAuth/bindings/sessions: never derive a new one on phone edit.
    await tx
      .update(users)
      .set({
        localUsername: username,
        name: input.displayName,
        localAccountStatus: input.status,
        localLoginMode: input.loginMode,
      })
      .where(
        and(
          eq(users.id, target.id),
          eq(users.role, "user"),
          eq(users.loginMethod, "local_manager")
        )
      );
    if (profile)
      await tx
        .update(userProfiles)
        .set({ status: profileStatus })
        .where(eq(userProfiles.id, profile.id));
    else
      await tx
        .insert(userProfiles)
        .values({ userId: target.id, status: profileStatus });
    await accountAudit(
      tx,
      adminId,
      target.id,
      "update_local_manager_account",
      "更新普通管理员账号资料和登录策略"
    );
    return { success: true } as const;
  });
}

export async function resetAdministratorPassword(
  adminId: number,
  input: { userId: number; newPassword: string }
) {
  const hash = createLocalManagerPasswordHash(input.newPassword);
  return atomic(async tx => {
    const target = await lockTarget(tx, input.userId);
    await tx
      .update(users)
      .set({ localPasswordHash: hash, localPasswordChangeRequired: false })
      .where(
        and(
          eq(users.id, target.id),
          eq(users.role, "user"),
          eq(users.loginMethod, "local_manager")
        )
      );
    await accountAudit(
      tx,
      adminId,
      target.id,
      "reset_local_manager_password",
      "重置普通管理员密码（现有会话不会自动撤销）",
      "security"
    );
    return { success: true } as const;
  });
}

const assignmentFields = {
  id: userRoleAssignments.id,
  roleId: userRoleAssignments.roleId,
  organizationId: userRoleAssignments.organizationId,
  projectId: userRoleAssignments.projectId,
  validFrom: userRoleAssignments.validFrom,
  validTo: userRoleAssignments.validTo,
};
async function authorizationFacts(
  tx: Transaction,
  target: Awaited<ReturnType<typeof lockTarget>>
) {
  // Current/locking reads avoid a stale repeatable-read snapshot after waiting for the account row mutex.
  const assignmentRows = await tx
    .select({
      ...assignmentFields,
      status: userRoleAssignments.status,
      grantedBy: userRoleAssignments.grantedBy,
      createdAt: userRoleAssignments.createdAt,
      updatedAt: userRoleAssignments.updatedAt,
    })
    .from(userRoleAssignments)
    .where(eq(userRoleAssignments.userId, target.id))
    .orderBy(userRoleAssignments.id)
    .for("update");
  const permissionRows = await tx
    .select({
      id: userPermissions.id,
      permissionId: userPermissions.permissionId,
      grantedBy: userPermissions.grantedBy,
      createdAt: userPermissions.createdAt,
      updatedAt: userPermissions.updatedAt,
    })
    .from(userPermissions)
    .where(eq(userPermissions.userId, target.id))
    .orderBy(userPermissions.permissionId)
    .for("update");
  // Audit anchor prevents ABA/empty-to-empty saves from reusing a revision even at MySQL second precision.
  const [lastAudit] = await tx
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetType, "user"),
        eq(auditLogs.targetId, String(target.id)),
        eq(auditLogs.action, "save_administrator_authorization")
      )
    )
    .orderBy(desc(auditLogs.id))
    .limit(1)
    .for("update");
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        target,
        assignmentRows,
        permissionRows,
        auditId: lastAudit?.id ?? null,
      })
    )
    .digest("hex");
  const assignments = assignmentRows
    .filter(row => row.status === "active")
    .map(({ id, roleId, organizationId, projectId, validFrom, validTo }) => ({
      id,
      roleId,
      organizationId,
      projectId,
      validFrom,
      validTo,
    }));
  return {
    assignments,
    permissionIds: Array.from(
      new Set(permissionRows.map(row => row.permissionId))
    ),
    revision,
  };
}

export function getAdministratorAuthorization(userId: number) {
  return atomic(async tx =>
    authorizationFacts(tx, await lockTarget(tx, userId))
  );
}

async function validateAuthorization(
  tx: Transaction,
  input: AuthorizationInput,
  current: Awaited<ReturnType<typeof authorizationFacts>>
) {
  const currentIds = new Set(current.assignments.map(row => row.id));
  const submittedIds = input.assignments.flatMap(row =>
    row.id === undefined ? [] : [row.id]
  );
  if (new Set(submittedIds).size !== submittedIds.length)
    fail("授权记录不能重复提交");
  if (submittedIds.some(id => !currentIds.has(id)))
    fail("授权记录不属于该用户或已经撤销，请刷新后重试");
  const roleIds = Array.from(new Set(input.assignments.map(row => row.roleId)));
  const roleRows = roleIds.length
    ? await tx
        .select({
          id: systemRoles.id,
          code: systemRoles.code,
          category: systemRoles.category,
          status: systemRoles.status,
        })
        .from(systemRoles)
        .where(inArray(systemRoles.id, roleIds))
        .for("update")
    : [];
  const roleById = new Map(roleRows.map(row => [row.id, row]));
  const normalized = input.assignments.map(row => {
    const role = roleById.get(row.roleId);
    if (role?.code === "SUPER_ADMIN")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "普通管理员账号不得被授予超级管理员权限",
      });
    if (
      !role ||
      role.status !== "active" ||
      role.category !== "business" ||
      excludedRoleCodes.has(role.code)
    )
      fail("请选择启用中的普通业务岗位，本入口不配置司机或系统治理岗位");
    if (!row.organizationId && !row.projectId)
      fail("业务岗位必须选择启用中的部门、项目部或具体项目范围");
    const validFrom = row.validFrom ? new Date(row.validFrom) : null;
    const validTo = row.validTo ? new Date(row.validTo) : null;
    if (
      (validFrom && !Number.isFinite(validFrom.getTime())) ||
      (validTo && !Number.isFinite(validTo.getTime()))
    )
      fail("授权有效期无效");
    if (validFrom && validTo && validTo <= validFrom)
      fail("授权失效时间必须晚于生效时间");
    return {
      ...row,
      projectId: row.projectId ?? null,
      organizationId: row.projectId ? null : (row.organizationId ?? null),
      validFrom,
      validTo,
    };
  });
  // Validate every requested scope (including a redundant organization) before canonicalizing to the smallest project scope.
  const organizationIds = Array.from(
    new Set(
      input.assignments.flatMap(row =>
        row.organizationId ? [row.organizationId] : []
      )
    )
  );
  const organizationRows = organizationIds.length
    ? await tx
        .select({
          id: organizations.id,
          type: organizations.type,
          status: organizations.status,
        })
        .from(organizations)
        .where(inArray(organizations.id, organizationIds))
        .for("update")
    : [];
  if (
    organizationRows.length !== organizationIds.length ||
    organizationRows.some(
      row =>
        row.status !== "active" ||
        !["department", "project_department"].includes(row.type)
    )
  )
    fail("所属部门必须是启用中的部门或项目部节点");
  const projectIds = Array.from(
    new Set(normalized.flatMap(row => (row.projectId ? [row.projectId] : [])))
  );
  const projectRows = projectIds.length
    ? await tx
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(inArray(projects.id, projectIds))
        .for("update")
    : [];
  if (
    projectRows.length !== projectIds.length ||
    projectRows.some(row => row.status === "archived")
  )
    fail("授权项目必须是未归档的有效项目节点");
  const signatures = normalized.map(
    ({ roleId, organizationId, projectId, validFrom, validTo }) =>
      JSON.stringify([roleId, organizationId, projectId, validFrom, validTo])
  );
  if (new Set(signatures).size !== signatures.length)
    fail("同岗位、范围和有效期的授权不能重复");
  const permissionIds = Array.from(new Set(input.permissionIds)).sort(
    (a, b) => a - b
  );
  const permissionRows = permissionIds.length
    ? await tx
        .select({
          id: systemPermissions.id,
          module: systemPermissions.module,
          action: systemPermissions.action,
        })
        .from(systemPermissions)
        .where(inArray(systemPermissions.id, permissionIds))
        .for("update")
    : [];
  if (
    permissionRows.length !== permissionIds.length ||
    permissionRows.some(
      row => !allowedModules.has(row.module) || !allowedActions.has(row.action)
    )
  )
    fail("权限配置包含无效或不适用于普通管理员的权限点，请刷新后重试");
  if (permissionIds.length && !normalized.length)
    fail("专属操作权限必须依托岗位和部门或项目范围，不可单独授予");
  return { assignments: normalized, permissionIds };
}

export function saveAdministratorAuthorization(
  adminId: number,
  input: AuthorizationInput
) {
  return atomic(async tx => {
    const target = await lockTarget(tx, input.userId);
    if (target.localAccountStatus !== "active")
      fail("请先启用该管理员账号后再配置授权");
    const current = await authorizationFacts(tx, target);
    if (input.revision !== current.revision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "授权已被其他管理员修改，请刷新后重新确认",
      });
    const next = await validateAuthorization(tx, input, current);
    const retainedIds = new Set(
      next.assignments.flatMap(row => (row.id === undefined ? [] : [row.id]))
    );
    const revokedIds = current.assignments
      .filter(row => !retainedIds.has(row.id))
      .map(row => row.id);
    if (revokedIds.length)
      await tx
        .update(userRoleAssignments)
        .set({ status: "revoked" })
        .where(
          and(
            eq(userRoleAssignments.userId, target.id),
            eq(userRoleAssignments.status, "active"),
            inArray(userRoleAssignments.id, revokedIds)
          )
        );
    for (const row of next.assignments) {
      const { id, ...grant } = row;
      const values = {
        ...grant,
        userId: target.id,
        status: "active" as const,
        grantedBy: adminId,
      };
      if (id !== undefined)
        await tx
          .update(userRoleAssignments)
          .set(values)
          .where(
            and(
              eq(userRoleAssignments.id, id),
              eq(userRoleAssignments.userId, target.id),
              eq(userRoleAssignments.status, "active")
            )
          );
      else await tx.insert(userRoleAssignments).values(values);
    }
    await tx
      .delete(userPermissions)
      .where(eq(userPermissions.userId, target.id));
    if (next.permissionIds.length)
      await tx
        .insert(userPermissions)
        .values(
          next.permissionIds.map(permissionId => ({
            userId: target.id,
            permissionId,
            grantedBy: adminId,
          }))
        );
    await tx.insert(auditLogs).values({
      userId: adminId,
      module: "permission",
      action: "save_administrator_authorization",
      targetType: "user",
      targetId: String(target.id),
      summary: `更新普通管理员授权：${next.assignments.length} 项岗位范围，${next.permissionIds.length} 项专属权限，撤销 ${revokedIds.length} 项授权`,
      beforeJson: JSON.stringify({
        assignments: current.assignments,
        permissionIds: current.permissionIds,
      }),
      afterJson: JSON.stringify(next),
    });
    return { success: true } as const;
  });
}
