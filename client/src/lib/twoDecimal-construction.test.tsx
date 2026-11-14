import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatBusinessDecimal,
  formatQuantity,
} from "@shared/numberFormat";

describe("construction 两位小数展示回归", () => {
  it("金额和物理数量固定保留两位并正确舍入，不改变未知值语义", () => {
    expect(formatAmount(3)).toBe("3.00");
    expect(formatAmount("430.432")).toBe("430.43");
    expect(formatAmount(1234567)).toBe("1,234,567.00");
    expect(formatQuantity("0")).toBe("0.00");
    expect(formatQuantity(null)).toBe("0.00");
    expect(formatBusinessDecimal("not-a-number")).toBe("—");
  });

  it("施工结果展示接入共享金额和数量格式化，不触碰百分比规则", () => {
    const toolbox = readFileSync(
      new URL("../components/ConstructionToolbox.tsx", import.meta.url),
      "utf8"
    );
    const settlement = readFileSync(
      new URL("../components/SettlementTemplateCalculator.tsx", import.meta.url),
      "utf8"
    );
    expect(toolbox).toContain("formatAmount(machineCost)");
    expect(toolbox).toContain("formatAmount(transportPrice)");
    expect(toolbox).toContain("formatQuantity(value, true)");
    expect(settlement).toContain("const money = (value: number) => `¥${formatAmount(value)}`");
    expect(settlement).toContain("const quantity = (value: number) => formatQuantity(value)");
    expect(settlement).toContain("marginRate.toFixed(1)");
  });
});
