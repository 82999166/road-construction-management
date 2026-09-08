import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("短信与服务号通知通道设置", () => {
  it("内置阿里云和腾讯云配置，并保留模块级开关与密钥托管提示", () => {
    const source = readFileSync(new URL("./NotificationChannelSettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("阿里云短信");
    expect(source).toContain("腾讯云短信");
    expect(source).toContain("密钥仅加密托管");
    expect(source).toContain("短信通知模块");
    expect(source).toContain("业务事件模板编码");
    expect(source).toContain("新增模板");
    expect(source).toContain("阿里云新建并审核");
    expect(source).toContain("阿里云短信测试");
    expect(source).toContain("发送测试短信");
    expect(source).toContain("确认发送测试短信");
    expect(source).toContain("每 60 秒限发一次");
    expect(source).toContain("inspectAliyunSmsNotificationReadiness");
    expect(source).toContain("sendAliyunSmsNotificationTest");
    expect(source).toContain("transport_load_completed");
    expect(source).toContain("tripOrdinal（该车当日第几车）");
    expect(source).toContain("包含 ${\"${tripOrdinal}\"} 的模板");
    expect(source).toContain("diesel_refuel_completed");
    expect(source).toContain("服务号即时通知");
    expect(source).toContain("持续状态、日结、绑定后推送与范围提醒会自动降级");
  });
});
