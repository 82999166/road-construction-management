import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./routers/labor.ts", import.meta.url), "utf8");

describe("考勤中国业务日期口径", () => {
  it("以中国自然日对应的上班时间区间统一匹配状态、下班衔接和后台台账", () => {
    expect(source).toContain("function getChinaBusinessDateRange");
    expect(source).toContain("function attendanceCheckInDateRangeFilter");
    expect(source).toContain("attendanceCheckInDateRangeFilter(businessDateText)");
    expect(source).toContain("attendanceCheckInDateRangeFilter(businessDate)");
    expect(source).toContain("const filters = [attendanceCheckInDateRangeFilter(businessDateText)]");
  });

  it("不再以会受数据库时区序列化影响的 businessDate Date 等值比较来读取当天打卡", () => {
    expect(source).not.toContain("eq(attendanceCheckIns.businessDate, toBusinessDate(businessDate))");
    expect(source).not.toContain("eq(attendanceCheckIns.businessDate, businessDate))).limit(1)");
  });
});
