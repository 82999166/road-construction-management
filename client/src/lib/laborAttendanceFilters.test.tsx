import { describe, expect, it } from "vitest";
import { filterAttendanceRows, getAttendanceTeams } from "./laborAttendanceFilters";

const workers = new Map([[1, { id: 1, realName: "王工", workerCategory: "company_admin" }], [2, { id: 2, realName: "赵师傅", workerCategory: "labor_team" }]]);
const rows = [{ workerId: 1, workerName: "王工", teamName: "管理组", status: "confirmed" }, { workerId: 2, workerName: "赵师傅", teamName: null, status: "locked" }];

describe("laborAttendanceFilters", () => {
  it("按姓名、班组、人员类型和状态叠加筛选考勤行", () => {
    expect(filterAttendanceRows(rows, workers, { workerName: "王", team: "管理组", category: "company_admin", status: "confirmed" })).toEqual([rows[0]]);
    expect(filterAttendanceRows(rows, workers, { workerName: "", team: "未设置班组", category: "labor_team", status: "locked" })).toEqual([rows[1]]);
  });
  it("统一生成未设置班组候选", () => expect(getAttendanceTeams(rows)).toEqual(expect.arrayContaining(["管理组", "未设置班组"])));
});
