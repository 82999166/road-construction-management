import { eq, getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { MySqlTable, type AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "../../drizzle/schema";
import type { getDb } from "../db";

export type GovernanceDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type GovernanceTx = Parameters<Parameters<GovernanceDb["transaction"]>[0]>[0];
export type IdentityKind = "project" | "organization";
export type IdentityReference = { table: MySqlTable; tableName: string; field: string; column: AnyMySqlColumn };

/** Enumerate actual schema tables, including fromProjectId, not a hand-maintained business-table list.
 * Any future numeric project/organization identity column joins the guard automatically.
 * Audit JSON is not reparsed as an authoritative foreign key; hard deletion remains closed regardless.
 */
export function enumerateIdentityReferences(kind: IdentityKind): IdentityReference[] {
  const result: IdentityReference[] = [];
  const suffix = kind === "project" ? /^(?:projectId|.*ProjectId)$/ : /^(?:organizationId|.*OrganizationId)$/;
  for (const table of Object.values(schema)) {
    if (!is(table, MySqlTable)) continue;
    const tableName = getTableName(table);
    for (const [field, column] of Object.entries(getTableColumns(table))) {
      if (suffix.test(field) && column.dataType === "number") result.push({ table, tableName, field, column });
    }
    // Parent identity fields cannot be identified by suffix alone.
    if (table === (kind === "project" ? schema.projects : schema.organizations)) {
      result.push({ table, tableName, field: "parentId", column: getTableColumns(table).parentId });
    }
  }
  return result.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.field.localeCompare(b.field));
}

export async function inspectIdentityReferences(db: GovernanceDb | GovernanceTx, kind: IdentityKind, id: number) {
  const references: Array<{ table: string; field: string; count: number }> = [];
  // Bounded, sequential queries: all statuses, including void/reversed/revoked/disabled/history, count.
  // No query failure is interpreted as an empty table (including a missing migration).
  for (const ref of enumerateIdentityReferences(kind)) {
    const [row] = await db.select({ total: sql<number>`count(*)` }).from(ref.table).where(eq(ref.column, id));
    const total = Number(row?.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "引用检查结果无效，已拒绝删除" });
    if (total) references.push({ table: ref.tableName, field: ref.field, count: total });
  }
  return references;
}

export async function previewIdentityDeletion(db: GovernanceDb | GovernanceTx, kind: IdentityKind, id: number) {
  const table = kind === "project" ? schema.projects : schema.organizations;
  const [existing] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: kind === "project" ? "项目节点不存在或已删除" : "组织节点不存在或已删除" });
  return {
    id, kind, name: existing.name, status: existing.status,
    references: await inspectIdentityReferences(db, kind, id),
    canHardDelete: false as const,
    policy: "identity-preservation-until-shared-reference-locks" as const,
    suggestedOperation: kind === "project" ? "archive" as const : "disable" as const,
  };
}

/** A parent-row lock on the deleting side does NOT stop unlocked business inserts.
 * No universal FK RESTRICT/shared reference-write lock exists at this baseline. Fail closed,
 * including an apparently empty mistaken project/organization; never delete business data to qualify.
 */
export async function refuseUnsafeIdentityDeletion(db: GovernanceDb, kind: IdentityKind, id: number): Promise<never> {
  return db.transaction(async tx => {
    const table = kind === "project" ? schema.projects : schema.organizations;
    const [existing] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: kind === "project" ? "项目节点不存在或已删除" : "组织节点不存在或已删除" });
    const references = await inspectIdentityReferences(tx, kind, id);
    if (references.length) throw new TRPCError({ code: "BAD_REQUEST", message: `该${kind === "project" ? "项目" : "组织"}仍有当前或历史引用（${references.slice(0, 4).map(ref => `${ref.table}.${ref.field}：${ref.count}`).join("；")}），不能删除；请${kind === "project" ? "归档" : "停用"}保留身份，不要清理业务历史以满足删除条件` });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `当前尚未具备所有引用写入口的共同锁或数据库引用约束，即使暂未发现引用也不能安全硬删除误建${kind === "project" ? "项目；请归档" : "组织；请停用"}` });
  });
}
