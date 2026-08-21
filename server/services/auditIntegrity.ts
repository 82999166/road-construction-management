import { createHash } from "node:crypto";
import { asc, eq, isNull } from "drizzle-orm";
import { auditLogChainState, auditLogIntegrityEvents, auditLogs, sensitiveDataAccessLogs } from "../../drizzle/schema";

type AuditEntryInput = {
  userId?: number | null;
  module: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  beforeJson?: string | null;
  afterJson?: string | null;
  ipAddress?: string | null;
};

type TransactionClient = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

function buildAuditChainHash(previousHash: string, auditLogId: number, input: AuditEntryInput, createdAt: Date) {
  const payload = [previousHash, auditLogId, input.userId ?? "", input.module, input.action, input.targetType ?? "", input.targetId ?? "", input.summary, input.beforeJson ?? "", input.afterJson ?? "", input.ipAddress ?? "", createdAt.toISOString()].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

async function appendAuditLogChainEntry(tx: TransactionClient, auditLogId: number, input: AuditEntryInput, createdAt: Date) {
  const [state] = await tx.select().from(auditLogChainState).where(eq(auditLogChainState.id, 1)).limit(1);
  if (!state) throw new Error("审计链锚点不存在，已拒绝写入关键业务审计事件");
  const sequenceNo = Number(state.lastSequence) + 1;
  const entryHash = buildAuditChainHash(state.lastHash, auditLogId, input, createdAt);
  await tx.insert(auditLogIntegrityEvents).values({ auditLogId, sequenceNo, previousHash: state.lastHash, entryHash, integrityVersion: "audit-chain-v1" });
  const result = await tx.update(auditLogChainState).set({ lastSequence: sequenceNo, lastHash: entryHash }).where(eq(auditLogChainState.id, 1));
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) throw new Error("审计链并发推进冲突，请重试");
  return { sequenceNo, entryHash };
}

/**
 * 仅供包含关键财务、敏感访问、定位争议与证据删除的事务调用。
 * 业务端没有更新或删除审计日志的接口；本服务用条件写推进单行链状态，冲突即回滚整个业务事务。
 */
export async function appendIntegrityProtectedAudit(tx: TransactionClient, input: AuditEntryInput) {
  const createdAt = new Date();
  const [created] = await tx.insert(auditLogs).values({ ...input, createdAt }).$returningId();
  const auditLogId = Number(created?.id ?? 0);
  if (!auditLogId) throw new Error("审计事件写入失败，未返回标识");
  const chain = await appendAuditLogChainEntry(tx, auditLogId, input, createdAt);
  return { auditLogId, ...chain };
}

/**
 * 对迁移前历史日志及仍使用旧写入点的新增日志进行追加式补链。
 * 只写入链条事件和链末锚点，绝不更新或删除任何审计主日志。
 */
export async function sealUnchainedAuditLogs(db: { transaction: (callback: (tx: TransactionClient) => Promise<{ sealedCount: number; mayHaveMore: boolean }>) => Promise<{ sealedCount: number; mayHaveMore: boolean }> }, limit = 2_000) {
  return db.transaction(async tx => {
    const rows = await tx.select({ log: auditLogs }).from(auditLogs).leftJoin(auditLogIntegrityEvents, eq(auditLogIntegrityEvents.auditLogId, auditLogs.id)).where(isNull(auditLogIntegrityEvents.id)).orderBy(asc(auditLogs.id)).limit(limit);
    for (const row of rows as Array<{ log: typeof auditLogs.$inferSelect }>) {
      const log = row.log;
      await appendAuditLogChainEntry(tx, Number(log.id), log, new Date(log.createdAt));
    }
    return { sealedCount: rows.length, mayHaveMore: rows.length === limit };
  });
}

/** 校验序号连续性、前序哈希和末端锚点；不自动修复任何异常，避免覆盖审计证据。 */
export async function verifyAuditIntegrityChain(db: TransactionClient) {
  const [state, events] = await Promise.all([
    db.select().from(auditLogChainState).where(eq(auditLogChainState.id, 1)).limit(1).then((rows: any[]) => rows[0] ?? null),
    db.select({ event: auditLogIntegrityEvents, log: auditLogs }).from(auditLogIntegrityEvents).innerJoin(auditLogs, eq(auditLogIntegrityEvents.auditLogId, auditLogs.id)).orderBy(asc(auditLogIntegrityEvents.sequenceNo)),
  ]);
  const genesisHash = createHash("sha256").update("audit-chain-v1:genesis:2026-08-21").digest("hex");
  let previousHash = genesisHash;
  let expectedSequence = 1;
  const errors: string[] = [];
  for (const row of events as Array<{ event: typeof auditLogIntegrityEvents.$inferSelect; log: typeof auditLogs.$inferSelect }>) {
    const log = row.log;
    const expectedHash = buildAuditChainHash(previousHash, Number(log.id), log, new Date(log.createdAt));
    if (Number(row.event.sequenceNo) !== expectedSequence) errors.push(`序号不连续：期望 ${expectedSequence}，实际 ${row.event.sequenceNo}`);
    if (row.event.previousHash !== previousHash) errors.push(`第 ${row.event.sequenceNo} 条前序哈希不匹配`);
    if (row.event.entryHash !== expectedHash) errors.push(`第 ${row.event.sequenceNo} 条内容哈希不匹配`);
    previousHash = row.event.entryHash;
    expectedSequence += 1;
  }
  if (!state) errors.push("审计链锚点不存在");
  else {
    if (Number(state.lastSequence) !== events.length) errors.push(`链末序号与事件数不一致：锚点 ${state.lastSequence}，事件 ${events.length}`);
    if (state.lastHash !== previousHash) errors.push("链末哈希与最后事件不匹配");
  }
  return { valid: errors.length === 0, eventCount: events.length, lastSequence: state ? Number(state.lastSequence) : 0, lastHash: state?.lastHash ?? null, errors };
}

/**
 * 记录敏感数据的实际利用。完整账户和原始坐标不应仅因具备角色而静默返回；
 * 访问利用日志与不可回退审计链一同写入，失败时调用方不应返回敏感数据。
 */
export async function recordSensitiveDataAccess(db: { transaction: (callback: (tx: TransactionClient) => Promise<void>) => Promise<unknown> }, input: {
  userId: number;
  projectId?: number | null;
  module: string;
  dataCategory: "full_payment_account" | "raw_location_coordinate" | "identity_document" | "other";
  accessPurpose: string;
  targetType?: string | null;
  targetId?: string | null;
  recordCount: number;
  result?: "granted" | "denied" | "exported" | "reviewed";
}) {
  await db.transaction(async tx => {
    await tx.insert(sensitiveDataAccessLogs).values({ ...input, result: input.result ?? "granted" });
    await appendIntegrityProtectedAudit(tx, { userId: input.userId, module: input.module, action: `sensitive_access_${input.dataCategory}`, targetType: input.targetType ?? null, targetId: input.targetId ?? null, summary: `受控访问敏感数据：${input.dataCategory} · ${input.accessPurpose.slice(0, 160)}`, afterJson: JSON.stringify({ projectId: input.projectId ?? null, recordCount: input.recordCount, result: input.result ?? "granted" }) });
  });
}
