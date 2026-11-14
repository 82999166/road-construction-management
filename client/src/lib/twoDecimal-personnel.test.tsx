import { describe, expect, it } from "vitest";
import { formatAmount, formatQuantity } from "@shared/numberFormat";

describe("personnel business decimal presentation", () => {
  it("formats payroll amounts to exactly two decimal places", () => {
    expect(formatAmount(3)).toBe("3.00");
    expect(formatAmount("430.432")).toBe("430.43");
    expect(formatAmount(1234.5)).toBe("1,234.50");
  });

  it("formats work-hour and daily-quantity copies without changing source values", () => {
    const workHours = 8.125;
    const attendanceDays = 3;
    expect(formatQuantity(workHours)).toBe("8.13");
    expect(formatQuantity(attendanceDays)).toBe("3.00");
    expect(workHours).toBe(8.125);
    expect(attendanceDays).toBe(3);
  });

  it("keeps zero and unknown-value display semantics explicit", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatQuantity("0")).toBe("0.00");
    expect(formatAmount(null)).toBe("0.00");
    expect(formatQuantity(undefined)).toBe("0.00");
    expect(formatAmount("not-a-number")).toBe("—");
  });
});
