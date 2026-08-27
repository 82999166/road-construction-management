import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("短信与服务号通知通道设置", () => {
  it("内置阿里云和腾讯云配置，并保留模块级开关与密钥托管提示", () => {
    const source = readFileSync(new URL("./NotificationChannelSettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("阿里云短信");
    expect(source).toContain("腾讯云短信");
    expect(source).toContain("密钥仅加密托管");
    expect(source).toContain("短信通知模块");
    expect(source).toContain("服务号即时通知");
    expect(source).toContain("持续状态、日结、绑定后推送与范围提醒会自动降级");
  });
});
