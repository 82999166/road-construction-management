import { describe, expect, it } from "vitest";
import { formatAmount, formatBusinessDecimal, formatBusinessMetricValue, formatQuantity } from "../shared/numberFormat";

describe("business numeric presentation, never accounting arithmetic", () => {
  it.each([
    [3, "3.00"], [0, "0.00"], [3.5, "3.50"], [430.432, "430.43"], ["19.035", "19.04"],
    ["1.005", "1.01"], [1.005, "1.01"], [-1.005, "-1.01"], ["-0.004", "0.00"],
    ["-0.005", "-0.01"], ["00012.100", "12.10"], [".5", "0.50"], ["1e3", "1000.00"],
    ["1e-3", "0.00"], ["7.345e1", "73.45"], ["999.999", "1000.00"], [0.1 + 0.2, "0.30"],
    [null, "0.00"], [undefined, "0.00"], ["", "0.00"],
  ] as const)("formats %s to exactly two decimals (%s)", (raw, expected) => {
    expect(formatBusinessDecimal(raw)).toBe(expected);
    expect(formatQuantity(raw)).toBe(expected);
  });
  it("preserves grouping only when requested", () => {
    expect(formatAmount("3706.02")).toBe("3,706.02");
    expect(formatAmount("3706.02", false)).toBe("3706.02");
    expect(formatQuantity("1234.5", true)).toBe("1,234.50");
  });
  it.each([NaN, Infinity, -Infinity, "not-a-number", "1e999", " ", "1.2.3"])("does not turn invalid numeric value %s into valid zero", raw => {
    expect(formatAmount(raw)).toBe("—");
  });
  it("keeps large decimal string digits without Number conversion", () => {
    expect(formatAmount("9007199254740993.005", false)).toBe("9007199254740993.01");
  });
  it("does not change quantity, amount or financial snapshots", () => {
    const row = { liters: 430.432, unitPrice: 8.61, amount: "3706.02", id: "790820", status: "settled" };
    const before = JSON.stringify(row);
    formatQuantity(row.liters);
    formatAmount(row.amount);
    expect(JSON.stringify(row)).toBe(before);
    expect(row.liters).toBe(430.432);
  });
  it("chart amount and physical quantity series use 2 decimals including zero", () => {
    expect(formatBusinessMetricValue(0, "amount 金额")).toBe("0.00");
    expect(formatBusinessMetricValue(430.432, "liters 油量")).toBe("430.43");
    expect(formatBusinessMetricValue(1234.5, "value", "amount")).toBe("1,234.50");
  });
  it("keeps counts, IDs, percentage and coordinates outside this display policy", () => {
    expect(formatBusinessMetricValue(3, "vehicleCount 台数")).toBe("3");
    expect(formatBusinessMetricValue(3, "amountCount")).toBe("3");
    expect(formatBusinessMetricValue("15111443399", "phone")).toBe("15111443399");
    expect(formatBusinessMetricValue(12.345, "progressPercent")).toBe("12.345");
    expect(formatBusinessMetricValue("28.123456", "latitude")).toBe("28.123456");
    expect(formatBusinessMetricValue(3, "amount", "count")).toBe("3");
    expect(formatBusinessMetricValue(null, "amount")).toBe("—");
  });
});
