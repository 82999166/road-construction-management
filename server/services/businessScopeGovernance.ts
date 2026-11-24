import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, departmentBusinessScopes, organizations, projects, systemRoles, userRoleAssignments } from "../../drizzle/schema";
import type { DepartmentBusinessModule } from "../../shared/department";
import type { GovernanceDb, GovernanceTx } from "./projectDeletionGuard";

type ScopeRow = typeof departmentBusinessScopes.$inferSelect;
type ScopeTarget = { scopeType: "project" | "organization"; scopeId: number };

export function scopeIdentity(row: Pick<ScopeRow, "id" | "projectId" | "organizationId" | "module">) {
  const isProject = row.projectId !== null;
  const scopeId = isProject ? row.projectId : row.organizationId;
  if (scopeId === null || (isProject && row.organizationId !== null)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "业务范围身份异常，请先核对项目/组织归属" });
  return { scopeType: isProject ? "project" as const : "organization" as const, scopeId, scopeRecordId: row.id, module: row.module };
}

async function lockTarget(tx: GovernanceTx, input: ScopeTarget, enabling: boolean) {
  if (input.scopeType === "project") {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.scopeId)).limit(1).for("update");
    if (!project || (enabling && project.status === "archived")) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择未归档的有效项目配置启用业务范围" });
  } else {
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, input.scopeId)).limit(1).for("update");
    if (!organization || (enabling && (organization.status !== "active" || !["department", "project_department"].includes(organization.type)))) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择启用中的有效部门或项目部节点配置业务范围" });
  }
}

async function auditScope(tx: GovernanceTx, actorId: number, action: string, before: ScopeRow | null, after: ScopeRow | null, reason: string) {
  const identity = scopeIdentity((after ?? before)!);
  await tx.insert(auditLogs).values({
    userId: actorId, module: "department", action, targetType: "department_business_scope",
    targetId: `${identity.scopeType}:${identity.scopeId}:${identity.module}`,
    summary: `${identity.scopeType === "project" ? "项目" : "部门"}业务范围${action === "enable_business_scope" ? "启用" : "收回"}：${identity.module}；${reason}`,
    beforeJson: JSON.stringify({ ...identity, reason, configurationMode: identity.scopeType === "project" ? "explicit-allowlist" : "organization-explicit", snapshot: before }),
    afterJson: JSON.stringify({ ...identity, reason, configurationMode: identity.scopeType === "project" ? "explicit-allowlist" : "organization-explicit", snapshot: after }),
  });
}

function affectedRows(result: unknown) {
  return Number((result as Array<{ affectedRows?: number }>)?.[0]?.affectedRows);
}

export async function saveBusinessScope(db: GovernanceDb, actorId: number, input: ScopeTarget & {
  module: DepartmentBusinessModule; status: "active" | "disabled"; expectedStatus?: "active" | "disabled" | "absent";
  confirmReactivate?: boolean; reason?: string;
}) {
  return db.transaction(async tx => {
    await lockTarget(tx, input, input.status === "active");
    const predicate = input.scopeType === "project" ? eq(departmentBusinessScopes.projectId, input.scopeId) : eq(departmentBusinessScopes.organizationId, input.scopeId);
    const [before] = await tx.select().from(departmentBusinessScopes).where(and(predicate, eq(departmentBusinessScopes.module, input.module))).limit(1).for("update");
    if (input.expectedStatus !== undefined && input.expectedStatus !== (before?.status ?? "absent")) throw new TRPCError({ code: "CONFLICT", message: "业务范围配置已变化，请刷新后重试" });
    if (before?.status === "disabled" && input.status === "active" && (!input.confirmReactivate || !input.reason?.trim())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "重新启用已收回模块须明确确认并填写原因；收回不会恢复历史继承授权" });
    const reason = input.reason?.trim() || (input.status === "active" ? "超级管理员显式启用模块" : "超级管理员收回模块，保留配置身份");
    if (before) {
      scopeIdentity(before);
      const result = await tx.update(departmentBusinessScopes).set({ status: input.status, configuredBy: actorId }).where(eq(departmentBusinessScopes.id, before.id));
      if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "业务范围更新未命中，请刷新后重试" });
    } else {
      await tx.insert(departmentBusinessScopes).values({ organizationId: input.scopeType === "organization" ? input.scopeId : null, projectId: input.scopeType === "project" ? input.scopeId : null, module: input.module, status: input.status, configuredBy: actorId });
    }
    const [after] = await tx.select().from(departmentBusinessScopes).where(and(predicate, eq(departmentBusinessScopes.module, input.module))).limit(1);
    if (!after) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "业务范围保存后未找到记录" });
    await auditScope(tx, actorId, input.status === "active" ? "enable_business_scope" : "disable_business_scope", before ?? null, after, reason);
    return { success: true };
  });
}

export async function revokeBusinessScope(db: GovernanceDb, actorId: number, id: number, reason = "超级管理员删除入口收回模块") {
  return db.transaction(async tx => {
    // Read identity before parent lock, then re-read the scope under parent lock. Parent-first lock
    // order matches saveScope/project status transitions and serializes governed configuration writers.
    const [candidate] = await tx.select().from(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, id)).limit(1);
    if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "部门业务范围不存在或已删除" });
    const identity = scopeIdentity(candidate);
    await lockTarget(tx, identity, false);
    const [before] = await tx.select().from(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, id)).limit(1).for("update");
    if (!before || JSON.stringify(scopeIdentity(before)) !== JSON.stringify(identity)) throw new TRPCError({ code: "CONFLICT", message: "业务范围已变化，请刷新后重试" });
    if (identity.scopeType === "project") {
      if (before.status !== "disabled") {
        const result = await tx.update(departmentBusinessScopes).set({ status: "disabled", configuredBy: actorId }).where(eq(departmentBusinessScopes.id, id));
        if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "业务范围收回未命中" });
      }
      const [after] = await tx.select().from(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, id)).limit(1);
      await auditScope(tx, actorId, "revoke_business_scope", before, after, reason);
      return { success: true, operation: "disabled" as const };
    }
    // Organization scopes never had the no-config legacy fallback. Preserve that boundary/semantics.
    const result = await tx.delete(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, id));
    if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "部门业务范围删除未命中" });
    await auditScope(tx, actorId, "delete_business_scope", before, null, reason);
    return { success: true, operation: "deleted" as const };
  });
}

/** Caller must already hold projects FOR UPDATE. Archive/restore never re-enables stale direct
 * assignments or modules. Organization-level scope semantics are intentionally not changed.
 */
export async function revokeProjectDirectAccess(tx: GovernanceTx, actorId: number, projectId: number, reason: string) {
  const scopes = await tx.select().from(departmentBusinessScopes).where(eq(departmentBusinessScopes.projectId, projectId)).for("update");
  for (const before of scopes) {
    if (before.status !== "active") continue;
    const result = await tx.update(departmentBusinessScopes).set({ status: "disabled", configuredBy: actorId }).where(eq(departmentBusinessScopes.id, before.id));
    if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "项目业务范围收回未命中" });
    const [after] = await tx.select().from(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, before.id)).limit(1);
    await auditScope(tx, actorId, "revoke_business_scope", before, after, reason);
  }
  const assignments = await tx.select().from(userRoleAssignments).where(and(eq(userRoleAssignments.projectId, projectId), eq(userRoleAssignments.status, "active"))).for("update");
  for (const before of assignments) {
    const [role] = await tx.select({ code: systemRoles.code }).from(systemRoles).where(eq(systemRoles.id, before.roleId)).limit(1);
    // SUPER_ADMIN is global at this baseline even when a legacy assignment carries projectId.
    // Project governance must not revoke global governance authority or alter that role ceiling.
    if (role?.code === "SUPER_ADMIN") continue;
    const result = await tx.update(userRoleAssignments).set({ status: "revoked", grantedBy: actorId }).where(eq(userRoleAssignments.id, before.id));
    if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "项目授权收回未命中" });
    await tx.insert(auditLogs).values({ userId: actorId, module: "permission", action: "revoke_assignment", targetType: "user_role_assignment", targetId: String(before.id), summary: `项目 #${projectId} 状态纠错收回直接授权 #${before.id}；${reason}`, beforeJson: JSON.stringify({ projectId, scopeType: "project", reason, snapshot: before }), afterJson: JSON.stringify({ projectId, scopeType: "project", reason, snapshot: { ...before, status: "revoked", grantedBy: actorId } }) });
  }
}
