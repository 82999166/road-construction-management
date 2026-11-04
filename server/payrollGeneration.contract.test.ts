import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const payrollService = readFileSync(
  new URL("./services/payrollGeneration.ts", import.meta.url),
  "utf8"
);
const domain = readFileSync(
  new URL("../shared/domain.ts", import.meta.url),
  "utf8"
);
const heartbeat = readFileSync(
  new URL("./payrollGenerationHeartbeat.ts", import.meta.url),
  "utf8"
);
const laborRouter = readFileSync(
  new URL("./routers/labor.ts", import.meta.url),
  "utf8"
);
const machineryRouter = readFileSync(
  new URL("./routers/operations.ts", import.meta.url),
  "utf8"
);

describe("payroll draft generation safeguards", () => {
  it("以项目、期间、员工唯一工资条防止重试重复写入，并且只创建草稿", () => {
    expect(
      payrollService.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "duplicate|unique".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      payrollService.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'status: "draft"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      payrollService.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "已有同项目同期间工资条".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(domain.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "计件工资尚未关联经审核的工程量"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("月度任务只通过平台签发task UID定位调度配置", () => {
    expect(heartbeat.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "/api/scheduled/monthly-payroll-draft-generation"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(heartbeat.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "user.isCron".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(heartbeat.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "user.taskUid".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      payrollService.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "scheduleCronTaskUid".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("在工资条提交审核时才锁定已纳入期间的确认考勤", () => {
    expect(
      laborRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "工资草稿提交至会计审核队列"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      laborRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'set({ status: "locked" })'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      laborRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'eq(attendanceRecords.status, "confirmed")'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});

describe("machine contract cost details", () => {
  it("单机分析返回月租、日租折算与日作业和独立成本的加班费用", () => {
    expect(
      machineryRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain("dailyRate".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      machineryRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "overtimeOperationAmount".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      machineryRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "overtimeCostRecordAmount".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      machineryRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "overtime: { hours: overtimeHours"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
