import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatBusinessDecimal,
  formatQuantity,
} from "@shared/numberFormat";
import { vehicleMoney } from "./vehicleManagementWorkspace";

describe("vehicle two-decimal presentation", () => {
  it("formats amounts and quantities to exactly two decimals without changing inputs", () => {
    const source = 430.432;
    expect(formatAmount(3)).toBe("3.00");
    expect(formatAmount(source)).toBe("430.43");
    expect(formatQuantity("12.5")).toBe("12.50");
    expect(source).toBe(430.432);
  });

  it("preserves zero and unknown-value display semantics", () => {
    expect(formatBusinessDecimal(0)).toBe("0.00");
    expect(formatQuantity(0)).toBe("0.00");
    expect(formatBusinessDecimal(null)).toBe("0.00");
    expect(formatBusinessDecimal(undefined)).toBe("0.00");
    expect(vehicleMoney(null)).toBe("未提供");
  });
});
