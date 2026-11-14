import { describe, expect, it } from "vitest";
import { formatAmount, formatQuantity } from "@shared/numberFormat";

describe("transport two-decimal presentation", () => {
  it("formats amounts and physical quantities to exactly two decimals without changing source values", () => {
    const amount = "430.432";
    const quantity = 3;
    expect(formatAmount(amount)).toBe("430.43");
    expect(formatQuantity(quantity)).toBe("3.00");
    expect(amount).toBe("430.432");
    expect(quantity).toBe(3);
  });

  it("preserves zero and unknown-value semantics for display", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatQuantity(0)).toBe("0.00");
    expect(formatQuantity(null)).toBe("0.00");
    expect(formatQuantity(undefined)).toBe("0.00");
  });
});
