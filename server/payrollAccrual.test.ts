import { describe, expect, it } from "vitest";
import { calculateEmployeePayrollAccrual } from "../shared/domain";

describe("calculateEmployeePayrollAccrual", () => {
  it("按月薪30天口径仅核算已确认考勤天数", () => {
    expect(calculateEmployeePayrollAccrual({ salaryBasis: "monthly", baseSalary: 9000, confirmedAttendanceDays: 12, normalHours: 96, overtimeHours: 6 })).toMatchObject({ calculable: true, payableAmount: 3600, blockedReason: null });
  });

  it("按日薪及按时薪分别使用确认天数与确认工时", () => {
    expect(calculateEmployeePayrollAccrual({ salaryBasis: "daily", baseSalary: 260, confirmedAttendanceDays: 8, normalHours: 64, overtimeHours: 0 })).toMatchObject({ calculable: true, payableAmount: 2080 });
    expect(calculateEmployeePayrollAccrual({ salaryBasis: "hourly", baseSalary: 35, confirmedAttendanceDays: 8, normalHours: 64, overtimeHours: 6 })).toMatchObject({ calculable: true, payableAmount: 2450 });
  });

  it("没有计件验收数量时阻断自动工资草稿", () => {
    const result = calculateEmployeePayrollAccrual({ salaryBasis: "piecework", baseSalary: 12, confirmedAttendanceDays: 8, normalHours: 64, overtimeHours: 0 });
    expect(result.calculable).toBe(false);
    expect(result.payableAmount).toBeNull();
    expect(result.blockedReason).toContain("验收数量");
  });
});
