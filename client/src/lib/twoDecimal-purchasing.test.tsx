import { describe, expect, it } from "vitest";
import { formatAmount, formatBusinessDecimal, formatQuantity } from "@shared/numberFormat";

describe("purchasing two-decimal presentation", () => {
  it("formats amounts and physical quantities to exactly two decimals", () => {
    expect(formatAmount(3)).toBe("3.00");
    expect(formatAmount("430.432")).toBe("430.43");
    expect(formatQuantity("0")).toBe("0.00");
    expect(formatQuantity("12.5")).toBe("12.50");
  });

  it("keeps null and unknown-value semantics without mutating source values", () => {
    const source = "7.125";
    expect(formatBusinessDecimal(null)).toBe("0.00");
    expect(formatBusinessDecimal(undefined)).toBe("0.00");
    expect(formatBusinessDecimal("not-a-number")).toBe("—");
    expect(source).toBe("7.125");
  });
});
