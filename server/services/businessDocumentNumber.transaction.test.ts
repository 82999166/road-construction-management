import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateBusinessDocumentNumber, withBusinessDocumentNumber, type BusinessDocumentNumberInput } from "./businessDocumentNumber";
import { createBusinessDocumentNumberMockDatabase } from "./businessDocumentNumber.mockDb";

const input = (requestKey: string, extra: Partial<BusinessDocumentNumberInput> = {}): BusinessDocumentNumberInput => ({
  module: "PO", actor: { kind: "user", userId: 23 }, scope: "project:17:purchase-order", requestKey, ...extra,
});

describe("业务编号事务分配（真实Drizzle SQL，离线驱动）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T09:05:09.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("业务txn内分配0001，重试跨时刻/重建adapter不重编号或再耗号", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    const first = await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("request-a")));
    expect(first).toEqual({ number: "PO2026112417050900230001", reused: false });
    vi.setSystemTime(new Date("2026-11-25T09:05:09.000Z"));
    const retry = await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("request-a")));
    expect(retry).toEqual({ number: first.number, reused: true });
    expect(mock.storage.counters.size).toBe(1);
    expect(Array.from(mock.storage.counters.values())[0].lastSequence).toBe(1);
  });

  it("重试发现已提交登记损坏时拒绝，不重新编号或再耗序号", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("damaged")));
    Array.from(mock.storage.allocations.values())[0].sequence = null;
    await expect(mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("damaged")))).rejects.toMatchObject({ code: "INTEGRITY_CONFLICT" });
    expect(Array.from(mock.storage.counters.values())[0].lastSequence).toBe(1);
  });

  it("32个独立Drizzle连接/同秒请求产生不重号0001..0032（模拟DB全txn串行）", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    const results = await Promise.all(Array.from({ length: 32 }, (_, i) => mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input(`parallel-${i}`)))));
    expect(new Set(results.map(row => row.number)).size).toBe(32);
    expect(results.map(row => Number(row.number.slice(-4))).sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(mock.statements.filter(row => row.sql.startsWith("select ")).every(row => row.sql.endsWith("for update"))).toBe(true);
  });

  it("并发同请求键只分配一次，编号重用不等同于业务重复写入", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    const results = await Promise.all(Array.from({ length: 12 }, () => mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("same-request")))));
    expect(new Set(results.map(row => row.number)).size).toBe(1);
    expect(results.filter(row => !row.reused)).toHaveLength(1);
    expect(Array.from(mock.storage.counters.values())[0].lastSequence).toBe(1);
  });

  it("业务写入失败整体回滚，不提交计数与请求占位；重试仍0001", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await expect(withBusinessDocumentNumber(mock.makeDatabase(), input("rollback"), async () => { throw new Error("业务状态已变"); })).rejects.toThrow("业务状态已变");
    expect(mock.storage.allocations.size).toBe(0);
    expect(mock.storage.counters.size).toBe(0);
    const retry = await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("rollback")));
    expect(retry.number.endsWith("0001")).toBe(true);
  });

  it("同秒9999后拒绝不循环，整txn回滚请求占位；下一秒可重新分配", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("setup")));
    const bucket = Array.from(mock.storage.counters.values())[0];
    bucket.lastSequence = 9998;
    const final = await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("last")));
    expect(final.number.endsWith("9999")).toBe(true);
    await expect(mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("overflow")))).rejects.toMatchObject({ code: "SEQUENCE_EXHAUSTED" });
    expect(mock.storage.allocations.size).toBe(2);
    expect(Array.from(mock.storage.counters.values())[0].lastSequence).toBe(9999);
    vi.setSystemTime(new Date("2026-11-24T09:05:10.000Z"));
    const next = await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("overflow")));
    expect(next.number).toBe("PO2026112417051000230001");
  });

  it("计数异常拒绝并回滚，不绕过持久状态从id/COUNT推算", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("setup")));
    Array.from(mock.storage.counters.values())[0].lastSequence = -1;
    await expect(mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("broken")))).rejects.toMatchObject({ code: "INTEGRITY_CONFLICT" });
    expect(mock.storage.allocations.size).toBe(1);
  });

  it("DB唯一单号碰撞失败回滚推进，不随机改号或跳过来源校验", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("original")));
    Array.from(mock.storage.counters.values())[0].lastSequence = 0;
    await expect(mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("collision")))).rejects.toThrow();
    expect(mock.storage.allocations.size).toBe(1);
    expect(Array.from(mock.storage.counters.values())[0].lastSequence).toBe(0);
  });

  it("后台SYS、超4位actor和模块分桶；同请求在不同项目不串用", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    const allocate = (extra: Partial<BusinessDocumentNumberInput>) => mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("common-key", extra)));
    expect((await allocate({ actor: { kind: "system" }, module: "PY" })).number).toBe("PY20261124170509SYS0001");
    expect((await allocate({ actor: { kind: "user", userId: 123456 } })).number).toBe("PO202611241705091234560001");
    const a = await allocate({});
    const b = await allocate({ scope: "project:18:purchase-order" });
    expect(a.number).not.toBe(b.number);
    expect(b.number.endsWith("0002")).toBe(true);
  });

  it.each([{ requestKey: "" }, { scope: " " }, { module: "IMP" }, { actor: { kind: "user", userId: 0 } }])("无效输入在写入前拒绝%j", async extra => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await expect(mock.makeDatabase().transaction(tx => allocateBusinessDocumentNumber(tx, input("x", extra as never)))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mock.storage.allocations.size).toBe(0);
    expect(mock.statements.every(row => row.sql === "begin" || row.sql === "rollback")).toBe(true);
  });

  it("无计数器/分配查询的预览展示不耗号，根db被拒绝", async () => {
    const mock = createBusinessDocumentNumberMockDatabase();
    await expect(allocateBusinessDocumentNumber(mock.makeDatabase() as never, input("x"))).rejects.toMatchObject({ code: "TRANSACTION_REQUIRED" });
    expect(mock.statements).toHaveLength(0);
  });

  it("迁移仅新增两张表，唯一约束由DB持久维护，不修改旧号/无COUNT+1", () => {
    const migration = readFileSync(new URL("../../drizzle/0099_business_document_number.sql", import.meta.url), "utf8");
    expect((migration.match(/CREATE TABLE/g) ?? []).length).toBe(2);
    expect((migration.match(/ENGINE=InnoDB/g) ?? []).length).toBe(2);
    expect(migration).toContain("UNIQUE(`number`)");
    expect(migration).toContain("UNIQUE(`prefix`,`sequence`)");
    expect(migration).toContain("PRIMARY KEY(`requestHash`)");
    expect(migration).toContain("PRIMARY KEY(`prefix`)");
    expect(migration).not.toMatch(/ALTER|DROP|DELETE|TRUNCATE|INSERT|UPDATE\s+`/);
    const service = readFileSync(new URL("./businessDocumentNumber.ts", import.meta.url), "utf8");
    expect(service).not.toMatch(/Math\.random|randomUUID|COUNT\s*\(|MAX\s*\(/i);
    expect(service).toContain("businessDocumentBeijingSecond(new Date())");
  });
});
