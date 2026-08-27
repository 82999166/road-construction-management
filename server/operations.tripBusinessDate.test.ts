import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输台账中国业务日期", () => {
  it("按中国标准时间而非 UTC 零点筛选直拍在途运单", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("function getChinaBusinessDateRange");
    expect(source).toContain('new Date(`${value}T00:00:00+08:00`)');
    expect(source).toContain("formatChinaBusinessDate(new Date(trip.startAt))");
    expect(source).toContain("getChinaBusinessDateRange(input.date)");
  });
});
