import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import * as schema from "../drizzle/schema";
import { BusinessDocumentCreationMockDb } from "./services/businessDocumentCreation.mockDb";
import { afterBusinessDocumentCommit, newBusinessDocumentNumber, runBusinessDocumentCreation } from "./services/businessDocumentCreation";

let db: BusinessDocumentCreationMockDb;
beforeEach(() => {
  db = new BusinessDocumentCreationMockDb();
  db.seed(schema.projects, { id: 3, code: "REPLAY-P3", name: "合成回执项目", nodeType: "project", status: "active" });
});
afterEach(() => db.close());

function scenario(transformReplay: boolean) {
  const notify = vi.fn();
  const revalidate = vi.fn(async () => undefined);
  const input = { projectId: 3, idempotencyKey: "synthetic-replay-key", amount: 10 };
  const write = vi.fn(async (tx: any) => {
    const recordNo = await newBusinessDocumentNumber(tx, "FR", { kind: "user", userId: 9 }, 3, input);
    await tx.insert(schema.financialRecords).values({ projectId: 3, recordNo, direction: "expense", category: "合成回执费用", amount: "10", occurredAt: new Date("2026-11-24T08:00:00Z"), settlementStatus: "unpaid" });
    await afterBusinessDocumentCommit(notify)();
    return { duplicate: false, recordNo, amount: 10, occurredAt: new Date("2026-11-24T08:00:00Z") };
  });
  const options = { actorId: 9, scope: "synthetic:event-replay", projectId: 3, input, revalidate, ...(transformReplay ? { replayDuplicate: true } : {}) };
  return { notify, revalidate, write, options };
}

describe("明确事件回执重放展示契约（真实分号、SQL、unique；非MySQL锁压测）", () => {
  it("首次false、重放true，保留原号金额时间，业务与通知各一次且不改原持久回执", async () => {
    const fixture = scenario(true);
    const first = await runBusinessDocumentCreation(db as any, fixture.options, fixture.write);
    const replay = await runBusinessDocumentCreation(db as any, fixture.options, fixture.write);
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ ...first, duplicate: true });
    expect(replay.occurredAt).toBeInstanceOf(Date);
    expect(first.recordNo).toMatch(/^FR\d{14}0009\d{4}$/);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
    expect(db.rows(schema.financialRecords)).toHaveLength(1);
    expect(db.rows(schema.businessDocumentNumberAllocations)).toHaveLength(1);
    const receipts = db.rows(schema.businessDocumentCreationReceipts);
    expect(receipts).toHaveLength(1);
    expect(superjson.parse<any>(receipts[0].resultJson).duplicate).toBe(false);
  });
  it("未明确声明转换的普通创建回执仍原样重放", async () => {
    const fixture = scenario(false);
    const first = await runBusinessDocumentCreation(db as any, fixture.options, fixture.write);
    expect(await runBusinessDocumentCreation(db as any, fixture.options, fixture.write)).toEqual(first);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
  });
  it("回执重放前权限收回仍拒绝，不能调用转换获取旧结果", async () => {
    const fixture = scenario(true);
    await runBusinessDocumentCreation(db as any, fixture.options, fixture.write);
    fixture.revalidate.mockRejectedValue(new Error("权限已收回"));
    await expect(runBusinessDocumentCreation(db as any, fixture.options, fixture.write)).rejects.toThrow("权限已收回");
    expect(db.rows(schema.businessDocumentCreationReceipts)).toHaveLength(1);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
  });
  it("同稳定键不同内容先拒绝，不转换、不新增、不通知", async () => {
    const fixture = scenario(true);
    await runBusinessDocumentCreation(db as any, fixture.options, fixture.write);
    await expect(runBusinessDocumentCreation(db as any, { ...fixture.options, input: { ...fixture.options.input, amount: 11 } }, fixture.write)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.rows(schema.businessDocumentCreationReceipts)).toHaveLength(1);
    expect(db.rows(schema.financialRecords)).toHaveLength(1);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
  });
});
