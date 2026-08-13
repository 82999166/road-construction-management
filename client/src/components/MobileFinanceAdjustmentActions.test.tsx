import { describe, expect, it } from "vitest";
import { canReverseFinancialRecord, canVoidFinancialRecord, getFinancialRecordAdjustmentAction, getPermittedFinancialRecordAdjustmentAction } from "./MobileFinanceAdjustmentActions";

describe("移动端财务流水调整边界", () => {
  it("会计可作废待支付流水，财务负责人可冲销已支付凭证，出纳无调整权", () => {
    expect(canVoidFinancialRecord(["FINANCE_MANAGER"])).toBe(true);
    expect(canVoidFinancialRecord(["ACCOUNTANT"])).toBe(true);
    expect(canReverseFinancialRecord(["FINANCE_MANAGER"])).toBe(true);
    expect(canReverseFinancialRecord(["ACCOUNTANT"])).toBe(false);
    expect(canVoidFinancialRecord(["CASHIER"])).toBe(false);
  });

  it("自动来源与已作废流水不展示入口，人工未支付作废、已支付冲销", () => {
    expect(getFinancialRecordAdjustmentAction({ sourceType: "measurement_payment", settlementStatus: "paid" })).toBeNull();
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "void" })).toBeNull();
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "unpaid" })).toBe("void");
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "partial" })).toBe("void");
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "paid" })).toBe("reverse");
    expect(getPermittedFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "paid" }, ["ACCOUNTANT"])).toBeNull();
    expect(getPermittedFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "paid" }, ["FINANCE_MANAGER"])).toBe("reverse");
    expect(getPermittedFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "unpaid" }, ["ACCOUNTANT"])).toBe("void");
  });
});
