import { describe, expect, it } from "vitest";
import { outstandingSettlementRows, settlementPaymentQueryPlan, type SettlementPaymentBoardRow } from "./SettlementPaymentFinancialBoard.helpers";

const row = (patch: Partial<SettlementPaymentBoardRow> = {}): SettlementPaymentBoardRow => ({
  sourceType: "transport_vehicle", sourceLabel: "车辆结算", settlementId: 1, settlementNo: "TS-1", periodLabel: "2026-11", direction: "expense", businessStatus: "approved", lifecycle: "ready", originalAmount: 100, paidOrRecoveredAmount: 0, offsetAmount: 0, remainingAmount: 100, counterpartyDisplay: "湘A测试", canRegisterSettlementPayment: true, legacyFinalized: false, ...patch,
});

describe("财务待付与待收分栏", () => {
  it.each(["payable", "receivable"] as const)("%s只读取待结看板，不加载无关月度付款明细", view => {
    expect(settlementPaymentQueryPlan(view, true, 1, "2026-11", "2026-11-10")).toEqual({ board: true, monthly: false });
    expect(settlementPaymentQueryPlan(view, false, 1, "2026-11", "2026-11-10")).toEqual({ board: false, monthly: false });
  });
  it("待付款保留部分付款，不含待审/作废/已结清/历史终态/补款", () => {
    const ready = row(), partial = row({ settlementId: 2, lifecycle: "partial", businessStatus: "partial", paidOrRecoveredAmount: 40, remainingAmount: 60 });
    const excluded = [row({ lifecycle: "approval_pending", businessStatus: "draft" }), row({ lifecycle: "approval_pending", businessStatus: "submitted" }), row({ lifecycle: "void", businessStatus: "void" }), row({ lifecycle: "completed", remainingAmount: 0 }), row({ legacyFinalized: true }), row({ direction: "income" })];
    expect(outstandingSettlementRows([ready, partial, ...excluded], "payable")).toEqual([ready, partial]);
  });
  it("待收补款保留未收及部分回收，只显示收入方向真实余额", () => {
    const receivable = row({ direction: "income", businessStatus: "receivable" }), partial = row({ settlementId: 2, direction: "income", lifecycle: "partial", remainingAmount: 30 });
    expect(outstandingSettlementRows([row(), receivable, partial, row({ direction: "income", lifecycle: "completed", remainingAmount: 0 })], "receivable")).toEqual([receivable, partial]);
  });
  it("投影不改变服务端余额、权限或原列表", () => {
    const readOnly = row({ canRegisterSettlementPayment: false });
    const values = [readOnly];const before = structuredClone(values);
    expect(outstandingSettlementRows(values, "payable")[0].canRegisterSettlementPayment).toBe(false);
    expect(values).toEqual(before);
  });
  it.each(["all", "board", "records", "reconciliation"] as const)("%s旧入口完整保留", view => {
    const values = [row(), row({ lifecycle: "approval_pending", businessStatus: "submitted" })];
    expect(outstandingSettlementRows(values, view)).toBe(values);
  });
  it("旧对账和付款记录查询计划不受待付子栏影响", () => {
    expect(settlementPaymentQueryPlan("records", true, 1, "2026-11", "2026-11-10")).toEqual({ board: false, monthly: true });
    expect(settlementPaymentQueryPlan("all", true, 1, "2026-11", "2026-11-10")).toEqual({ board: true, monthly: true });
  });
});
