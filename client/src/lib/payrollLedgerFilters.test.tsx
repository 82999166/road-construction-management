import { describe, expect, it } from "vitest";
import { filterPayrollRows, getPayrollTeams } from "./payrollLedgerFilters";

const rows = [{ workerName: "张三", teamName: "一队", period: "2026-08", status: "approved" }, { workerName: "李四", teamName: null, period: "2026-07", status: "paid" }];

describe("payrollLedgerFilters", () => {
  it("按名称、班组和状态叠加筛选真实工资条行", () => {
    expect(filterPayrollRows(rows, { search: "张", team: "一队", status: "approved" })).toEqual([rows[0]]);
    expect(filterPayrollRows(rows, { search: "", team: "未设置班组", status: "paid" })).toEqual([rows[1]]);
  });
  it("以统一未设置班组标签生成候选", () => expect(getPayrollTeams(rows)).toEqual(["一队", "未设置班组"]));
});
