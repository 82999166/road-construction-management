import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { businessDocumentCreationReceipts, projects } from "../../drizzle/schema";
import type { BusinessDocumentActor, BusinessDocumentModule } from "../../shared/businessDocumentNumber";
import { allocateBusinessDocumentNumber, type BusinessDocumentNumberDatabase, type BusinessDocumentNumberTransaction } from "./businessDocumentNumber";

const creationContext = new AsyncLocalStorage<{ effects: Array<() => unknown>; requestKey: string; db?: BusinessDocumentNumberDatabase & BusinessDocumentNumberTransaction }>();
/** 深层helper复用真实事务，不读取未提交的根连接或独立写入。 */
export function businessDocumentCreationDatabase() { return creationContext.getStore()?.db; }
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function stableRequestKey(input: unknown) {
  const data = input as Record<string, unknown> | null;
  const key = data?.documentRequestKey ?? data?.idempotencyKey ?? data?.requestKey;
  if (key !== undefined && (typeof key !== "string" || !key.trim() || key.length > 256)) throw new TRPCError({ code: "BAD_REQUEST", message: "业务请求键无效" });
  return key === undefined ? undefined : `key:${digest(key)}`;
}
/** 只有真实documentRequestKey/既有事件幂等键/可信来源键具有重试含义。
 * 缺键旧客户端使用本次创建内部随机请求身份，不能将相同payload永久判为同一业务。
 * 该UUID不出现在正式单号，也不修改既有事件requestId。 */
export function businessCreationRequestKey(input: unknown, suffix = "") {
  const key = stableRequestKey(input) ?? creationContext.getStore()?.requestKey ?? `attempt:${randomUUID()}`;
  return `${key}${suffix ? `:${suffix}` : ""}`;
}
/** 仅新建insert分支调用；旧号/外部号由调用方保留，编辑分支不分配。 */
export async function newBusinessDocumentNumber(tx: BusinessDocumentNumberTransaction, module: BusinessDocumentModule, actor: BusinessDocumentActor, projectId: number | null | undefined, input: unknown, suffix = "") {
  return (await allocateBusinessDocumentNumber(tx, { module, actor, scope: `project:${projectId ?? "global"}:${module}`, requestKey: businessCreationRequestKey(input, suffix) })).number;
}
/** 提交后才执行真实通知；失败/回执重放均不执行副作用。非编号路径行为保持原样。 */
export function afterBusinessDocumentCommit<T extends (...args: any[]) => any>(effect: T): T {
  return ((...args: Parameters<T>) => {
    const context = creationContext.getStore();
    if (!context) return effect(...args);
    context.effects.push(() => effect(...args));
    return Promise.resolve(undefined);
  }) as T;
}
/** 业务、来源、审计、号码同一事务；已有内层transaction合并到当前事务。
 * 仅真实稳定键新建保存回执；缺键不新增去重规则；编辑每次仍执行原状态/版本CAS。 */
export async function runBusinessDocumentCreation<T>(db: BusinessDocumentNumberDatabase, options: { actorId: number; scope: string; projectId?: number | null; input: unknown; revalidate?: () => Promise<unknown>; replayDuplicate?: boolean }, write: (tx: BusinessDocumentNumberTransaction & BusinessDocumentNumberDatabase) => Promise<T>): Promise<T> {
  const stableKey = stableRequestKey(options.input);
  const requestKey = stableKey ?? `attempt:${randomUUID()}`;
  const inputHash = digest(options.input);
  const requestHash = digest(["business-creation-v1", options.actorId, options.scope, options.projectId ?? "global", requestKey]);
  const effects: Array<() => unknown> = [];
  const editing = Boolean((options.input as Record<string, unknown>)?.id) && options.scope !== "finance:reverseRecord";
  const result = await db.transaction(async transaction => creationContext.run({ effects, requestKey }, async () => {
    // 项目锁等待后再次复核角色、模块操作与项目授权，然后才读取回执。
    if (options.projectId) await transaction.select({ id: projects.id }).from(projects).where(eq(projects.id, options.projectId)).limit(1).for("update");
    const tx = new Proxy(transaction, { get(target, key) { if (key === "transaction") return async (callback: (tx: typeof target) => Promise<unknown>) => callback(tx); const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } }) as Parameters<typeof write>[0];
    creationContext.getStore()!.db = tx;
    await options.revalidate?.();
    if (editing || !stableKey) return write(tx);
    if (!options.revalidate) throw new Error("稳定请求回执缺少锁后权限复核，禁止重放");
    await transaction.insert(businessDocumentCreationReceipts).values({ requestHash, inputHash, scope: options.scope, actorId: options.actorId }).onDuplicateKeyUpdate({ set: { requestHash } });
    const [receipt] = await transaction.select().from(businessDocumentCreationReceipts).where(and(eq(businessDocumentCreationReceipts.requestHash, requestHash), eq(businessDocumentCreationReceipts.actorId, options.actorId))).limit(1).for("update");
    if (!receipt || receipt.inputHash !== inputHash || receipt.scope !== options.scope) throw new TRPCError({ code: "CONFLICT", message: "该业务请求键已用于不同内容，请刷新并使用新的请求键" });
    // 非项目范围也可能等待回执锁；等待结束后不能沿用锁前的角色/范围判断。
    await options.revalidate();
    if (receipt.resultJson !== null) {
      const value = superjson.parse<T>(receipt.resultJson);
      // 仅明确声明的事件接口转换重放展示标志；号码、金额、原持久回执及写入函数不变。
      if (!options.replayDuplicate) return value;
      if (!value || typeof value !== "object" || typeof (value as { duplicate?: unknown }).duplicate !== "boolean") throw new Error("事件回执缺少真实重复标志，禁止伪造重放结果");
      return Object.assign({}, value, { duplicate: true });
    }
    const value = await write(tx);
    const updated = await transaction.update(businessDocumentCreationReceipts).set({ resultJson: superjson.stringify(value) }).where(eq(businessDocumentCreationReceipts.requestHash, requestHash));
    if (Number(updated[0]?.affectedRows) !== 1) throw new Error("业务回执保存失败，必须回滚");
    return value;
  }));
  for (const effect of effects) { try { await effect(); } catch (error) { console.warn("[BusinessDocumentCreation] committed notification failed", error instanceof Error ? error.name : "unknown"); } }
  return result;
}
