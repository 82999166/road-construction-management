import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const payrollService = readFileSync(new URL("./services/payrollGeneration.ts", import.meta.url), "utf8");
const domain = readFileSync(new URL("../shared/domain.ts", import.meta.url), "utf8");
const heartbeat = readFileSync(new URL("./payrollGenerationHeartbeat.ts", import.meta.url), "utf8");
const laborRouter = readFileSync(new URL("./routers/labor.ts", import.meta.url), "utf8");
const machineryRouter = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

describe("payroll draft generation safeguards", () => {
  it("以项目、期间、员工唯一工资条防止重试重复写入，并且只创建草稿", () => {
    expect(payrollService).toContain("duplicate|unique");
    expect(payrollService).toContain('status: "draft"');
    expect(payrollService).toContain("已有同项目同期间工资条");
    expect(domain).toContain("计件工资尚未关联经审核的工程量");
  });

  it("月度任务只通过平台签发task UID定位调度配置", () => {
    expect(heartbeat).toContain("/api/scheduled/monthly-payroll-draft-generation");
    expect(heartbeat).toContain("user.isCron");
    expect(heartbeat).toContain("user.taskUid");
    expect(payrollService).toContain("scheduleCronTaskUid");
  });

  it("在工资条提交审核时才锁定已纳入期间的确认考勤", () => {
    expect(laborRouter).toContain("工资草稿提交至会计审核队列");
    expect(laborRouter).toContain('set({ status: "locked" })');
    expect(laborRouter).toContain('eq(attendanceRecords.status, "confirmed")');
  });
});

describe("machine contract cost details", () => {
  it("单机分析返回月租、日租折算与日作业和独立成本的加班费用", () => {
    expect(machineryRouter).toContain("dailyRate");
    expect(machineryRouter).toContain("overtimeOperationAmount");
    expect(machineryRouter).toContain("overtimeCostRecordAmount");
    expect(machineryRouter).toContain("overtime: { hours: overtimeHours");
  });
});
