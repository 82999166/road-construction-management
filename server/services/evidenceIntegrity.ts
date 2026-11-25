import { TRPCError } from "@trpc/server";
import { and, asc, eq, getTableColumns, getTableName, inArray, is, like, or, sql } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";

/** 必须传入业务事务；锁序统一为项目→证据 ID 升序→父单/引用→审计。 */
export type EvidenceTransaction = { select: (...args: any[]) => any };
export type EvidenceRow = typeof schema.evidenceRecords.$inferSelect;
export const GENERAL_EVIDENCE_SOURCES = ["site_photo", "safety", "transport", "attendance", "purchase", "diesel_receipt", "other"] as const;
export type EvidenceReference = { category: string; sensitive: boolean };

const ownLifecycleActions = ["upload", "soft_delete", "ocr", "ocr_failed"];
const sensitiveTable = /^(?:financial_|settlement_payment_|employee_|personnel_|payroll_|tax_|contract_tax_|cross_region_|outsource_contracts|subcontract_payment_|daily_accounting_)/;
const sensitiveModule = /finance|financial|payroll|labor|personnel|employee|tax|contract|settlement[_-]?payment/i;
const pointerKey = /evidence|attachment|photo|avatar|proof|影像|证据|凭证|附件|照片/i;
const textReferenceColumn = /json|snapshot|remarks|notes|evidence|attachment|photo|avatar|proof|sourceId|content|constructionPlan|reviewReply|summary|url|file|payload|detail|reason/i;

/** 从真实 schema 自动登记所有 evidenceId/二级 EvidenceId；不按业务状态过滤历史引用。 */
export const EVIDENCE_REFERENCE_REGISTRY = (Object.values(schema) as unknown[])
  .filter((value): value is MySqlTable => is(value, MySqlTable))
  .filter(table => table !== schema.evidenceRecords)
  .map(table => {
    const columns = getTableColumns(table);
    const direct = Object.entries(columns).filter(([name]) => /(?:^evidenceId$|EvidenceId$)/.test(name));
    const text = Object.entries(columns).filter(([name, column]) =>
      column.dataType === "json" || (column.dataType === "string" && textReferenceColumn.test(name)));
    return { table, name: getTableName(table), direct, text, sensitive: sensitiveTable.test(getTableName(table)) };
  })
  .filter(entry => entry.direct.length || entry.text.length);

function escapeLike(value: string) { return value.replace(/[\\%_]/g, "\\$&"); }
function fileTokens(evidence: EvidenceRow): string[] {
  return Array.from(new Set([evidence.fileKey, encodeURI(evidence.fileKey), encodeURIComponent(evidence.fileKey)].filter(Boolean)));
}

/** ID 必须带证据语义，不能因为审计金额/日期/业务主键碰巧相同就认作附件引用。 */
export function valueReferencesEvidence(value: unknown, evidence: EvidenceRow, pointerContext = false): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return pointerContext && value === evidence.id;
  if (Array.isArray(value)) return value.some(item => valueReferencesEvidence(item, evidence, pointerContext));
  if (typeof value === "object") return Object.entries(value).some(([key, item]) =>
    valueReferencesEvidence(item, evidence, pointerKey.test(key) || (pointerContext && /^(?:id|ids|oldId|newId|originalId|previousId|current|original|old|new|before|after|previous)$/i.test(key))));
  if (typeof value !== "string") return false;
  if (pointerContext && value.trim() === String(evidence.id)) return true;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* 历史自由文本可能含裸百分号。 */ }
  if (fileTokens(evidence).some(token => value.includes(token)) || (evidence.fileKey && decoded.includes(evidence.fileKey))) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") return valueReferencesEvidence(parsed, evidence, pointerContext);
  } catch {
    // 损坏的历史 JSON 无法证明未引用；数组/嵌套对象中后续 ID 同样保守保全。
    if (/^\s*[\[{]/.test(decoded) && pointerKey.test(decoded) && new RegExp(`(?:^|[^0-9])${evidence.id}(?:[^0-9]|$)`).test(decoded)) return true;
  }
  return new RegExp(`(?:evidence(?:Id|Ids)?|attachment(?:EvidenceId)?|photo(?:EvidenceId)?|avatar(?:EvidenceId)?|proof|影像|证据|凭证|附件|照片)[^0-9]{0,80}${evidence.id}(?:[^0-9]|$)`, "i").test(decoded);
}

/** 批量查询匹配候选，不扫描返回整张表，不截断匹配历史；delete 使用 locking read 重核。 */
export async function collectEvidenceReferences(tx: EvidenceTransaction, evidences: EvidenceRow[], lock = false): Promise<Map<number, EvidenceReference[]>> {
  const result = new Map(evidences.map(row => [row.id, [] as EvidenceReference[]]));
  if (!evidences.length) return result;
  for (const entry of EVIDENCE_REFERENCE_REGISTRY) {
    const predicates = entry.direct.map(([, column]) => inArray(column, evidences.map(row => row.id)));
    const idPattern = `(?:evidence|attachment|photo|avatar|proof|影像|证据|凭证|附件|照片)[^0-9]{0,80}(${evidences.map(row => row.id).join("|")})([^0-9]|$)`;
    for (const [, column] of entry.text) {
      predicates.push(sql`${column} REGEXP ${idPattern}`);
      // JSON 数组/嵌套对象不能仅靠 regex 找到第一个 ID；候选再由语义解析精确复核。
      predicates.push(and(sql`${column} REGEXP ${`(^|[^0-9])(${evidences.map(row => row.id).join("|")})([^0-9]|$)`}`, sql`${column} REGEXP 'evidence|attachment|photo|avatar|proof|影像|证据|凭证|附件|照片'`)!);
      for (const token of Array.from(new Set(evidences.flatMap(fileTokens)))) predicates.push(like(column, `%${escapeLike(token)}%`));
    }
    const projection = Object.fromEntries([...entry.direct, ...entry.text]);
    const columns = getTableColumns(entry.table);
    if (columns.sourceType && columns.sourceId) {
      Object.assign(projection, { sourceType: columns.sourceType, sourceId: columns.sourceId });
      predicates.push(and(inArray(columns.sourceId, evidences.map(row => String(row.id))), sql`${columns.sourceType} REGEXP 'evidence|attachment|photo|avatar|proof'`)!);
    }
    if (entry.table === schema.auditLogs) {
      Object.assign(projection, { module: schema.auditLogs.module, action: schema.auditLogs.action, targetType: schema.auditLogs.targetType, targetId: schema.auditLogs.targetId });
      predicates.push(and(eq(schema.auditLogs.targetType, "evidence"), inArray(schema.auditLogs.targetId, evidences.map(row => String(row.id))))!);
    }
    let condition = or(...predicates)!;
    if (entry.table === schema.auditLogs) {
      // 自己上传/OCR/软删除的生命周期日志并非业务绑定；替换、解绑和补证审计仍保留。
      condition = and(condition, sql`NOT (COALESCE(${schema.auditLogs.targetType}, '') = 'evidence' AND COALESCE(${schema.auditLogs.targetId}, '') IN (${sql.join(evidences.map(row => sql`${String(row.id)}`), sql`, `)}) AND ${schema.auditLogs.action} IN (${sql.join(ownLifecycleActions.map(action => sql`${action}`), sql`, `)}))`)!;
    }
    const query = tx.select(projection).from(entry.table).where(condition);
    const rows: Record<string, unknown>[] = await (lock ? query.for("update") : query);
    for (const evidence of evidences) {
      const matched = rows.filter(row => {
        if (entry.table === schema.auditLogs && row.targetType === "evidence" && String(row.targetId) === String(evidence.id) && ownLifecycleActions.includes(String(row.action))) return false;
        if (entry.table === schema.auditLogs && row.targetType === "evidence" && String(row.targetId) === String(evidence.id)) return true;
        if (pointerKey.test(String(row.sourceType ?? "")) && String(row.sourceId) === String(evidence.id)) return true;
        return entry.direct.some(([name]) => Number(row[name]) === evidence.id) || entry.text.some(([name]) => valueReferencesEvidence(row[name], evidence));
      });
      if (matched.length) result.get(evidence.id)!.push({ category: entry.name, sensitive: entry.sensitive || (entry.table === schema.auditLogs && matched.some(row => sensitiveModule.test(`${row.module} ${row.targetType} ${row.action}`))) });
    }
  }
  return result;
}

/** 已绑定 sourceId 也是原指针；自由文本仅能保守阻断删除，不能当作父单已验证。 */
export function evidenceDeleteBlockedReason(evidence: EvidenceRow, references: EvidenceReference[]): string | null {
  if (references.length) return "该影像已关联当前或历史业务单据（含库存、税务、付款或替换审计），不能删除；请在原业务模块补证或更正关联";
  if (evidence.sourceId?.trim()) return "该影像带有来源标记，尚不能证明为未使用误上传，不能删除；请在来源业务模块核验或补证，影像仍予保留";
  if (evidence.retentionUntil && new Date(evidence.retentionUntil).getTime() > Date.now()) return "该影像尚在保留期限内，不能删除";
  return null;
}

/** EVIDENCE 不是工资/付款/人员/税务/合同附件授权。other 复用有引用时不外露。 */
export function isGeneralEvidenceVisible(evidence: EvidenceRow, references: EvidenceReference[]): boolean {
  if (evidence.status !== "active" || !GENERAL_EVIDENCE_SOURCES.includes(evidence.sourceType as typeof GENERAL_EVIDENCE_SOURCES[number])) return false;
  if (references.some(ref => ref.sensitive)) return false;
  // 收方专属待关联产物只能由收方岗位在原表单继续使用；不改变历史 takeoff-<id> 兼容。
  if (/^takeoff-pending(?:-|$)/i.test(evidence.sourceId ?? "")) return false;
  if (/^(?:payroll|salary|settlement[-_]payment|financial|personnel|employee|insurance|tax|contract)[-_:]/i.test(evidence.sourceId ?? "")) return false;
  if (/^(?:settlement-proofs|financial-invoices|personnel-private|personnel|labor-certificates|employee-insurance|payroll|tax-documents)\//i.test(evidence.fileKey)) return false;
  if (evidence.sourceType === "other") {
    if (references.length) return false;
    if (evidence.sourceId?.trim()) {
      try { return JSON.parse(evidence.watermarkJson ?? "null")?.genericEvidenceUpload === true; } catch { return false; }
    }
  }
  return true;
}

export async function lockEvidenceProject(tx: EvidenceTransaction, projectId: number) {
  const [project] = await tx.select({ id: schema.projects.id, status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1).for("update");
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "附件所属项目不存在，请刷新后重试" });
  return project as { id: number; status: string };
}

/** 其他业务 bind 必须在同一事务先调用本 helper，再写业务指针和替换审计；不接受 deleted。 */
export async function lockActiveEvidenceForBinding(tx: EvidenceTransaction, input: { projectId: number; evidenceIds: number[]; allowedSourceTypes?: readonly string[]; sourceId?: string }) {
  await lockEvidenceProject(tx, input.projectId);
  const ids = Array.from(new Set(input.evidenceIds)).sort((a, b) => a - b);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "附件编号无效" });
  if (!ids.length) return [] as EvidenceRow[];
  const rows: EvidenceRow[] = await tx.select().from(schema.evidenceRecords).where(inArray(schema.evidenceRecords.id, ids)).orderBy(asc(schema.evidenceRecords.id)).for("update");
  if (rows.length !== ids.length || rows.some(row => row.status !== "active" || row.projectId !== input.projectId || (input.allowedSourceTypes && !input.allowedSourceTypes.includes(row.sourceType)) || (input.sourceId !== undefined && row.sourceId !== input.sourceId))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "附件不存在、已删除、来源不符或不属于当前项目，请重新选择" });
  }
  return rows;
}

export function assertEvidenceConditionalWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object" || !("affectedRows" in header) || Number((header as { affectedRows?: unknown }).affectedRows) !== 1) {
    throw new TRPCError({ code: "CONFLICT", message: "影像状态已变化，本次操作未生效，请刷新后重试" });
  }
}
