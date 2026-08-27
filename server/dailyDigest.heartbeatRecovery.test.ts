import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("每日站内汇总 Heartbeat 重复创建恢复", () => {
  it("遇到 already_exists 时找回同名同回调任务并更新任务 UID", () => {
    const source = readFileSync(new URL("./routers/dailyDigest.ts", import.meta.url), "utf8");
    expect(source).toContain("listHeartbeatJobs");
    expect(source).toContain("isHeartbeatAlreadyExistsError");
    expect(source).toContain("DAILY_DIGEST_HEARTBEAT_NAME");
    expect(source).toContain("matchedJob.taskUid");
    expect(source).toContain("系统暂未读取到任务标识；请刷新页面后重试");
    expect(source).not.toContain('name: "daily-project-digest"');
  });
});
