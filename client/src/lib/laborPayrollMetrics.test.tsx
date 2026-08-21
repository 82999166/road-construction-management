import { describe, expect, it } from "vitest";
import { summarizeLaborPayrollCategories, summarizePayrollAmounts } from "./laborPayrollMetrics";

describe("劳务工资统计口径", () => {
  const rows = [
    { workerId: 1, teamName: null, payableAmount: "100", deductionAmount: "10", actualAmount: "90", status: "paid" },
    { workerId: 2, teamName: "一队", payableAmount: "200", deductionAmount: "0", actualAmount: "200", status: "approved" },
    { workerId: 3, teamName: "一队", payableAmount: "50", deductionAmount: "0", actualAmount: "50", status: "reviewing" },
  ];

  it("汇总应发、扣款、实发、待付款和已付款金额", () => {
    expect(summarizePayrollAmounts(rows)).toEqual({ payable: 350, deduction: 10, actual: 340, approved: 200, paid: 90, pending: 50 });
  });

  it("按真实人员类别和劳务班组归集，不将临时或公司人员混入劳务队", () => {
    const categories = summarizeLaborPayrollCategories(rows, new Map([[1, "company_admin"], [2, "labor_team"], [3, "temporary_daily"] as const]));
    expect(categories.company.actual).toBe(90);
    expect(categories.laborTeam.actual).toBe(200);
    expect(categories.laborTeamRows).toEqual([{ teamName: "一队", summary: { payable: 200, deduction: 0, actual: 200, approved: 200, paid: 0, pending: 0 } }]);
  });
});
