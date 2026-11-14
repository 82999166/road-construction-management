import { describe, expect, it } from "vitest";
import {
  buildBackfillPlan,
  assertMatchingFuelRecord,
  preservedCostSnapshot,
  machineFuelRecordNo,
  backfillMachineFuelLedger,
} from "../scripts/backfill-machine-fuel-ledger.mjs";
const cost = {
  id: 13,
  machineId: 2,
  projectId: 3,
  costType: "fuel",
  costName: "柴油",
  quantity: "126.117",
  unitPrice: "8.61",
  amount: "1085.87",
  occurredAt: "2026-11-12 12:00:00",
  evidenceId: null,
  remarks: "真实记录",
  status: "settled",
  createdAt: "2026-11-12 12:01:00",
  dieselRefuelRecordId: null,
};
const fuel = {
  id: 42,
  recordNo: "DS-MC-13",
  projectId: 3,
  assetType: "machine",
  machineId: 2,
  vehicleId: null,
  transportTripId: null,
  supplyMethod: "project_supply",
  liters: cost.quantity,
  appliedUnitPrice: cost.unitPrice,
  amount: cost.amount,
  refueledAt: cost.occurredAt,
  status: "settled",
  deductFromFreight: 0,
};
describe("历史机械柴油统一归集计划", () => {
  it("仅增加原费用的柴油关联，保留三位升数与已结算金额不重算", () => {
    const plan = buildBackfillPlan([cost], [], new Map([[13, 9]]));
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      recordNo: "DS-MC-13",
      createdBy: 9,
      cost: { quantity: "126.117", amount: "1085.87", status: "settled" },
    });
    expect(plan.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.totalFuelCosts).toBe(1);
  });
  it("缺少真实操作人不冒充当前超级管理员", () => {
    expect(buildBackfillPlan([cost], []).candidates[0].createdBy).toBe(0);
  });
  it("已关联记录不再创建；已有确定单号只补关联", () => {
    expect(
      buildBackfillPlan([{ ...cost, dieselRefuelRecordId: 42 }], [fuel])
        .candidates
    ).toEqual([]);
    expect(
      buildBackfillPlan([cost], [fuel]).candidates[0].existingRecordId
    ).toBe(42);
  });
  it.each([
    { amount: "1.00" },
    { status: "approved" },
    { projectId: 4 },
    { machineId: 4 },
    { refueledAt: "2026-11-13 12:00:00" },
    { assetType: "vehicle" },
    { deductFromFreight: 1 },
    { transportTripId: 2 },
  ])("关联内容不符停止而不猜测覆盖 %s", override => {
    expect(() =>
      assertMatchingFuelRecord(cost, { ...fuel, ...override })
    ).toThrow("不一致");
  });
  it("不存在的关联或重复关联拒绝，以防重复费用被消失", () => {
    expect(() =>
      buildBackfillPlan([{ ...cost, dieselRefuelRecordId: 42 }], [])
    ).toThrow();
    expect(() =>
      buildBackfillPlan(
        [
          { ...cost, dieselRefuelRecordId: 42 },
          { ...cost, id: 14, dieselRefuelRecordId: 42 },
        ],
        [fuel]
      )
    ).toThrow("重复关联");
  });
  it("任何原金额、状态、时点或关联变化都会使预览摘要变化", () => {
    const before = buildBackfillPlan([cost], []).digest;
    for (const override of [
      { amount: "1085.88" },
      { status: "void" },
      { occurredAt: "2026-11-13 12:00:00" },
    ])
      expect(buildBackfillPlan([{ ...cost, ...override }], []).digest).not.toBe(
        before
      );
  });
  it("不允许非油料或非法主键，原字段快照不包含新关联与自动更新时间", () => {
    expect(() =>
      buildBackfillPlan([{ ...cost, costType: "repair" }], [])
    ).toThrow();
    expect(() => machineFuelRecordNo(0)).toThrow();
    expect(
      preservedCostSnapshot({ ...cost, updatedAt: "later" })
    ).not.toHaveProperty("dieselRefuelRecordId");
    expect(preservedCostSnapshot(cost)).toHaveProperty("amount", "1085.87");
  });
  it("预览后记录变化时事务回滚，零写入", async () => {
    const executed: string[] = [];
    let rolledBack = false;
    const connection = {
      query: async (sql: string) => {
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
        if (sql.includes("machine_cost_records")) return [[cost]];
        return [[]];
      },
      execute: async (sql: string) => {
        executed.push(sql);
        return [{ affectedRows: 1 }];
      },
      beginTransaction: async () => {},
      rollback: async () => {
        rolledBack = true;
      },
      commit: async () => {
        throw Error("must not commit");
      },
    };
    await expect(
      backfillMachineFuelLedger(connection, {
        apply: true,
        expectedDigest: "wrong",
      })
    ).rejects.toThrow("已变化");
    expect(rolledBack).toBe(true);
    expect(executed).toEqual([]);
  });
});
