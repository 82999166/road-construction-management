import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("useLaborWorkspaceFilters", () => {
  it("集中管理工资条与考勤的本地筛选状态，不包含项目范围或服务端查询实现", () => {
    const source = readFileSync(new URL("./useLaborWorkspaceFilters.ts", import.meta.url), "utf8");
    expect(source).toContain("laborPeriod");
    expect(source).toContain("laborAttendanceDate");
    expect(source).toContain("laborPayrollSearch");
    expect(source).toContain("laborAttendanceFilter");
    expect(source).not.toContain("trpc.");
  });
});
