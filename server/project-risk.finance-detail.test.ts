import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});

import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { projectRiskRouter } from "./routers/projectRisk";

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "finance-detail-test-user",
      email: "finance-detail-test@example.com",
      name: "财务测试人员",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

/** 兼容 Drizzle 的 `where().limit()` 与直接 `await where()` 两种只读查询形式。 */
function createSequentialSelectDb(...responses: unknown[][]) {
  let index = 0;
  return {
    select: vi.fn(() => {
      const rows = responses[index++] ?? [];
      const result = {
        limit: vi.fn(async () => rows),
        then: <TResult1 = unknown, TResult2 = never>(resolve?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise.resolve(rows).then(resolve, reject),
      };
      return { from: vi.fn(() => ({ where: vi.fn(() => result) })) };
    }),
  };
}

describe("财务支出分类下钻", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createContext().user);
  });

  it("按分类仅返回同一期间内、未作废且未重复计入的真实支出单据", async () => {
    vi.mocked(getDb).mockResolvedValue(createSequentialSelectDb(
      [{ id: 10, name: "测试项目", organizationId: 1, status: "active" }],
      [
        { id: 1, recordNo: "FIN-001", category: "生活餐费", sourceType: null, amount: "120.00", settlementStatus: "paid", occurredAt: new Date("2026-10-16T02:00:00.000Z"), remarks: "现场后勤" },
        { id: 2, recordNo: "FIN-002", category: "采购结算", sourceType: "purchase_order_settlement", amount: "500.00", settlementStatus: "paid", occurredAt: new Date("2026-10-16T02:00:00.000Z"), remarks: "不可重复计入" },
        { id: 3, recordNo: "FIN-003", category: "已作废餐费", sourceType: null, amount: "80.00", settlementStatus: "void", occurredAt: new Date("2026-10-16T02:00:00.000Z"), remarks: null },
      ],
      [], [], [], [], [], [], [], [],
    ) as never);

    const result = await projectRiskRouter.createCaller(createContext()).financeCategoryDetails({ projectId: 10, period: "2026-10", category: "living" });

    expect(result.summary).toEqual({ count: 1, amount: 120 });
    expect(result.records).toEqual([expect.objectContaining({ category: "living", source: "finance_record", documentNo: "FIN-001", subcategory: "生活餐费", amount: 120, status: "paid" })]);
    expect(result.records.some(item => item.documentNo === "FIN-002")).toBe(false);
    expect(result.records.some(item => item.documentNo === "FIN-003")).toBe(false);
    expect(assertSuperAdmin).toHaveBeenCalledTimes(1);
  });
});
