import { describe, expect, it } from "vitest";
import { canAdjustFinancialRecord, getFinancialRecordAdjustmentAction } from "./MobileFinanceAdjustmentActions";

describe("移动端财务流水调整边界", () => {
  it("仅会计、财务负责人和系统应急角色可见调整入口", () => {
    expect(canAdjustFinancialRecord(["FINANCE_MANAGER"])).toBe(true);
    expect(canAdjustFinancialRecord(["ACCOUNTANT"])).toBe(true);
    expect(canAdjustFinancialRecord(["ALL"])).toBe(true);
    expect(canAdjustFinancialRecord(["CASHIER"])).toBe(false);
  });

  it("自动来源与已作废流水不展示入口，人工未支付作废、已支付冲销", () => {
    expect(getFinancialRecordAdjustmentAction({ sourceType: "measurement_payment", settlementStatus: "paid" })).toBeNull();
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "void" })).toBeNull();
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "unpaid" })).toBe("void");
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "partial" })).toBe("void");
    expect(getFinancialRecordAdjustmentAction({ sourceType: null, settlementStatus: "paid" })).toBe("reverse");
  });
});
