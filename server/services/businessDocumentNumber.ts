import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  businessDocumentNumberAllocations,
  businessDocumentNumberCounters,
} from "../../drizzle/schema";
import {
  BUSINESS_DOCUMENT_MODULES,
  BUSINESS_DOCUMENT_NUMBER_CONTRACT,
  isBusinessDocumentNumber,
  type BusinessDocumentActor,
  type BusinessDocumentModule,
} from "../../shared/businessDocumentNumber";
import type { getDb } from "../db";

export type BusinessDocumentNumberDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type BusinessDocumentNumberTransaction = Parameters<
  Parameters<BusinessDocumentNumberDatabase["transaction"]>[0]
>[0];

export type BusinessDocumentNumberInput = {
  module: BusinessDocumentModule;
  actor: BusinessDocumentActor;
  /** 可信业务范围，例如 project:17:purchase-order；不得仅使用不分业务的客户端键。 */
  scope: string;
  /** 重试保持不变的请求键，或已持锁来源的稳定键。只用于幂等，不出现在单号中。 */
  requestKey: string;
};

export type BusinessDocumentNumberAllocation = {
  number: string;
  reused: boolean;
};

export class BusinessDocumentNumberError extends Error {
  constructor(
    public readonly code: "INVALID_INPUT" | "TRANSACTION_REQUIRED" | "SEQUENCE_EXHAUSTED" | "INTEGRITY_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "BusinessDocumentNumberError";
  }
}

function hash(value: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 只规范可信 ctx.user.id/触发userId；不查询名字/角色，也不把后台任务冒充管理员。 */
export function businessDocumentActorKey(actor: BusinessDocumentActor): string {
  if (!actor || typeof actor !== "object") {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "必须明确真实操作人或 SYS 后台身份");
  }
  if (actor.kind === "system") return "SYS";
  if (actor.kind !== "user" || !["number", "string", "bigint"].includes(typeof actor.userId)) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "操作人编号无效");
  }
  if (typeof actor.userId === "number" && !Number.isSafeInteger(actor.userId)) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "操作人编号不是安全整数");
  }
  const raw = String(actor.userId);
  if (!/^[1-9]\d{0,15}$/.test(raw)) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "操作人编号须为正整数，最长16位，不截断编号");
  }
  return raw.padStart(4, "0");
}

/** 仅纯格式化；正式分配不接受客户端时间或业务发生时间参数。 */
export function businessDocumentBeijingSecond(serverNow: Date): string {
  if (!(serverNow instanceof Date) || !Number.isFinite(serverNow.getTime())) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "服务端生成时刻无效");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_DOCUMENT_NUMBER_CONTRACT.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(serverNow);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const second = `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
  if (!/^\d{14}$/.test(second)) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "生成时刻超出业务单号日期范围");
  }
  return second;
}

function normalizeInput(input: BusinessDocumentNumberInput) {
  if (!input || !Object.values(BUSINESS_DOCUMENT_MODULES).includes(input.module)) {
    throw new BusinessDocumentNumberError("INVALID_INPUT", "未登记的业务编号版块");
  }
  const actorKey = businessDocumentActorKey(input.actor);
  for (const [label, value, maximum] of [
    ["业务范围", input.scope, 256], ["幂等请求键", input.requestKey, 256],
  ] as const) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maximum) {
      throw new BusinessDocumentNumberError("INVALID_INPUT", `${label}须为非空且无首尾空白的字符串，最长${maximum}字`);
    }
  }
  return {
    moduleCode: input.module,
    actorKey,
    scopeHash: hash([input.scope]),
    requestHash: hash(["business-document-number-v1", input.module, actorKey, input.scope, input.requestKey]),
  };
}

function assertSingleWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (!header || typeof header !== "object" || !("affectedRows" in header) || Number(header.affectedRows) !== 1) {
    throw new BusinessDocumentNumberError("INTEGRITY_CONFLICT", "单号事务写入冲突，必须回滚后重试整个业务事务");
  }
}

/** 明确 adapter：必须接收 getDb() 所用 MySQL2 Drizzle 的真实 tx，不允许根db/autocommit。
 * request upsert 仅有一个主键；重复键 no-op UPDATE 在DB上取得排他锁。
 * 后续锁定读为 current read，避免 REPEATABLE READ 等待后的旧快照。
 */
export function createDrizzleBusinessDocumentNumberAdapter(tx: BusinessDocumentNumberTransaction) {
  if (!tx || typeof tx.rollback !== "function") {
    throw new BusinessDocumentNumberError("TRANSACTION_REQUIRED", "单号分配必须与业务写入共用数据库事务");
  }
  return {
    async lockRequest(identity: ReturnType<typeof normalizeInput>) {
      await tx.insert(businessDocumentNumberAllocations).values(identity).onDuplicateKeyUpdate({
        set: { requestHash: identity.requestHash },
      });
      const [row] = await tx.select().from(businessDocumentNumberAllocations)
        .where(eq(businessDocumentNumberAllocations.requestHash, identity.requestHash)).limit(1).for("update");
      if (!row || row.moduleCode !== identity.moduleCode || row.actorKey !== identity.actorKey || row.scopeHash !== identity.scopeHash) {
        throw new BusinessDocumentNumberError("INTEGRITY_CONFLICT", "单号请求登记异常，必须回滚");
      }
      return row;
    },
    async nextSequence(prefix: string) {
      await tx.insert(businessDocumentNumberCounters).values({ prefix, lastSequence: 0 }).onDuplicateKeyUpdate({
        set: { prefix },
      });
      const [counter] = await tx.select().from(businessDocumentNumberCounters)
        .where(eq(businessDocumentNumberCounters.prefix, prefix)).limit(1).for("update");
      if (!counter || !Number.isInteger(counter.lastSequence) || counter.lastSequence < 0) {
        throw new BusinessDocumentNumberError("INTEGRITY_CONFLICT", "单号计数器异常，必须回滚");
      }
      if (counter.lastSequence >= BUSINESS_DOCUMENT_NUMBER_CONTRACT.sequenceMaximum) {
        throw new BusinessDocumentNumberError("SEQUENCE_EXHAUSTED", "该版块/操作人/北京时间秒的四位序号已用尽，禁止循环；请稍后重试");
      }
      const sequence = counter.lastSequence + 1;
      const result = await tx.update(businessDocumentNumberCounters).set({ lastSequence: sequence }).where(and(
        eq(businessDocumentNumberCounters.prefix, prefix),
        eq(businessDocumentNumberCounters.lastSequence, counter.lastSequence)
      ));
      assertSingleWrite(result);
      return sequence;
    },
    async completeRequest(requestHash: string, prefix: string, sequence: number, number: string) {
      const result = await tx.update(businessDocumentNumberAllocations).set({ prefix, sequence, number })
        .where(eq(businessDocumentNumberAllocations.requestHash, requestHash));
      assertSingleWrite(result);
    },
  };
}

/** 固定锁序：调用方先取得业务/项目/来源锁 -> 请求占位锁 -> 计数桶锁。
 * 必须在所有授权、状态、封账、防重与现有记录检查后分配；异常不得被吞掉继续提交事务。
 * 预览不调用此函数。编辑直接保留原表No；同请求重试返回原号，业务侧仍须返回原回执，
 * 本函数只保证编号幂等，不等同于已完成业务插入/通知幂等。
 */
export async function allocateBusinessDocumentNumber(
  tx: BusinessDocumentNumberTransaction,
  input: BusinessDocumentNumberInput
): Promise<BusinessDocumentNumberAllocation> {
  const identity = normalizeInput(input);
  const adapter = createDrizzleBusinessDocumentNumberAdapter(tx);
  const existing = await adapter.lockRequest(identity);
  if (existing.number !== null) {
    if (!existing.prefix || !Number.isInteger(existing.sequence) ||
        existing.sequence! < 1 || existing.sequence! > BUSINESS_DOCUMENT_NUMBER_CONTRACT.sequenceMaximum ||
        !isBusinessDocumentNumber(existing.number) ||
        !existing.prefix.startsWith(identity.moduleCode) || !existing.prefix.endsWith(identity.actorKey) ||
        existing.number !== `${existing.prefix}${String(existing.sequence).padStart(4, "0")}`) {
      throw new BusinessDocumentNumberError("INTEGRITY_CONFLICT", "原单号登记不完整，禁止重编号，请核对持久来源");
    }
    return { number: existing.number, reused: true };
  }
  if (existing.prefix !== null || existing.sequence !== null) {
    throw new BusinessDocumentNumberError("INTEGRITY_CONFLICT", "原单号请求占位不完整，必须回滚并核对");
  }
  const prefix = `${identity.moduleCode}${businessDocumentBeijingSecond(new Date())}${identity.actorKey}`;
  const sequence = await adapter.nextSequence(prefix);
  const number = `${prefix}${String(sequence).padStart(4, "0")}`;
  await adapter.completeRequest(identity.requestHash, prefix, sequence, number);
  return { number, reused: false };
}

/** 独立新建路径可用本API统一事务；已有业务事务直接使用 allocate，不要嵌套另开连接。
 * 回调负责写业务记录、来源ID、审计，并处理 allocation.reused 的原回执查询。
 * 不自动重试回调，以免重发通知等非事务副作用；通知放在提交之后。
 */
export async function withBusinessDocumentNumber<T>(
  db: BusinessDocumentNumberDatabase,
  input: BusinessDocumentNumberInput,
  write: (tx: BusinessDocumentNumberTransaction, allocation: BusinessDocumentNumberAllocation) => Promise<T>
): Promise<T> {
  return db.transaction(async tx => write(tx, await allocateBusinessDocumentNumber(tx, input)));
}
