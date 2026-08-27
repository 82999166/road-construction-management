import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TransportVehicleSettlementManager.tsx", import.meta.url), "utf8");

describe("车辆运输结算中文化与日期展示", () => {
  it("将支付方式和未知结算状态投影为中文，同时保持原始状态机枚举用于操作判断", () => {
    expect(source).toContain("const paymentMethodDisplay");
    expect(source).toContain('?? "其他方式"');
    expect(source).toContain("const settlementStatusDisplay");
    expect(source).toContain("{settlementStatusDisplay(item.status)}");
    expect(source).not.toContain("{settlementStatusLabel[item.status] ?? item.status}");
    expect(source).toContain('item.status === "approved"');
  });

  it("以统一中国日期格式展示结算期间和付款日期", () => {
    expect(source).toContain("formatChinaDate(item.periodStart)");
    expect(source).toContain("formatChinaDate(item.paymentDate)");
    expect(source).not.toContain("String(item.paymentDate).slice(0, 10)");
  });
});
