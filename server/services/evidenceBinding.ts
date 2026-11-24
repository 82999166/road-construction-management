import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { evidenceRecords } from "../../drizzle/schema";
import { lockEvidenceProject, type EvidenceTransaction, type EvidenceRow } from "./evidenceIntegrity";
import { appendIntegrityProtectedAudit } from "./auditIntegrity";

type Binding = { field: string; id?: number | null; allowedSourceTypes: readonly string[]; sourceId?: string; sourcePattern?: RegExp };
export function evidencePointerIds(value: unknown): number[] {
  if (typeof value === "string") { try { return evidencePointerIds(JSON.parse(value)); } catch { return []; } }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (/(?:^evidenceId$|EvidenceId$)/.test(key) && typeof item === "number" && item > 0) return [item];
    if (/(?:^evidenceIds$|EvidenceIds$)/.test(key) && Array.isArray(item)) return item.filter((id): id is number => typeof id === "number" && id > 0);
    return evidencePointerIds(item);
  });
}
/** 仅在真实业务事务中调用：项目→旧/新证据升序→父业务当前读→业务写→retain审计。
 * 历史已删旧指针只保全，不作为新的绑定授权；不能用父单hint替代锁后重查。
 */
export async function lockBusinessEvidenceBindings(tx: EvidenceTransaction, input: {
  projectId: number | null; bindings: Binding[]; parent?: { table: any; id: number; column?: any };
  oldPointers?: unknown;
  retainedPointers?: unknown;
  resource?: { table: any; id: number; column?: any };
  actorId: number; module: string; targetType: string; targetId: string;
}) {
  if (input.projectId !== null) await lockEvidenceProject(tx, input.projectId);
  const parent = input.parent;
  const [hint] = parent ? await tx.select().from(parent.table).where(eq(parent.column ?? parent.table.id, parent.id)).limit(1) : [];
  if (parent && (!hint || hint.projectId !== input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目业务单据" });
  const oldIds = Array.from(new Set([...evidencePointerIds(hint), ...evidencePointerIds(input.oldPointers)])).sort((a, b) => a - b);
  // 仅原外部关联可声明继续保留；替换字段仍按真实patch计算，不复活被移除的旧附件。
  const retainedIds = evidencePointerIds(input.retainedPointers);
  if (retainedIds.some(id => !oldIds.includes(id))) throw new TRPCError({ code: "BAD_REQUEST", message: "保留指针必须来自原业务附件快照" });
  const newIds = input.bindings.flatMap(binding => binding.id ? [binding.id] : []);
  const ids = Array.from(new Set([...oldIds, ...newIds])).sort((a, b) => a - b);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "附件编号无效" });
  const rows: EvidenceRow[] = ids.length ? await tx.select().from(evidenceRecords).where(inArray(evidenceRecords.id, ids)).orderBy(asc(evidenceRecords.id)).for("update") : [];
  // 原证据缺失也不能悄悄丢弃原ID；历史fileKey仍由父单原快照保留。
  for (const binding of input.bindings) {
    if (!binding.id) continue;
    const row = rows.find(row => row.id === binding.id);
    if (!row || row.status !== "active" || row.projectId !== input.projectId || !binding.allowedSourceTypes.includes(row.sourceType) || binding.sourceId !== undefined && row.sourceId !== binding.sourceId || binding.sourcePattern && !binding.sourcePattern.test(row.sourceId ?? "")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "附件不存在、已删除、来源类型或原所属业务不符，不能借用其他项目或模块附件" });
    }
  }
  if (input.resource) {
    const resource = input.resource;
    const [currentResource] = await tx.select().from(resource.table).where(eq(resource.column ?? resource.table.id, resource.id)).limit(1).for("update");
    if (!currentResource || currentResource.projectId !== input.projectId) throw new TRPCError({ code: "CONFLICT", message: "所属业务资源已变化，请刷新后重试" });
  }
  const [current] = parent ? await tx.select().from(parent.table).where(eq(parent.column ?? parent.table.id, parent.id)).limit(1).for("update") : [];
  if (parent && (!current || current.projectId !== input.projectId || JSON.stringify(evidencePointerIds(current)) !== JSON.stringify(evidencePointerIds(hint)))) throw new TRPCError({ code: "CONFLICT", message: "原附件指针已变化，请刷新后重试" });
  const pointers = (values: number[]) => Array.from(new Set(values)).sort((a, b) => a - b).map(id => ({ evidenceId: id, fileKey: rows.find(row => row.id === id)?.fileKey ?? null }));
  const beforeJson = JSON.stringify({ evidencePointers: pointers(oldIds) });
  const replacePointer = (value: any, field: string, id: number | null): any => {
    if (typeof value === "string") { try { return replacePointer(JSON.parse(value), field, id); } catch { return value; } }
    if (Array.isArray(value)) return value.map(item => replacePointer(item, field, id));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === field ? id : replacePointer(item, field, id)]));
  };
  let effective = { ...(current ?? {}) };
  for (const binding of input.bindings) if (binding.id !== undefined) {
    effective = replacePointer(effective, binding.field, binding.id);
    effective[binding.field] = binding.id;
  }
  const afterJson = JSON.stringify({ evidencePointers: pointers([...evidencePointerIds(effective), ...newIds, ...retainedIds]) });
  return { parent: current, rows, beforeJson, afterJson, retain: async (targetId = input.targetId) => {
    if (ids.length) await appendIntegrityProtectedAudit(tx as any, { userId: input.actorId, module: input.module, action: "retain_evidence_binding_pointers", targetType: input.targetType, targetId, summary: "保留业务附件原指针及本次受控关联依据", beforeJson, afterJson });
  } };
}
/** sourceId只接受空标记、本所属pending或同一父单，不能覆盖别人的parent。 */
export function assertEvidenceSourceOwner(row: EvidenceRow, expected: string, pending: RegExp) {
  if (row.sourceId && row.sourceId !== expected && !pending.test(row.sourceId)) throw new TRPCError({ code: "CONFLICT", message: "附件已属于其他来源业务，不能覆盖原来源标记" });
}
