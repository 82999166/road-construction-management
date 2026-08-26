import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("通知通道配置与服务号合规拦截", () => {
  it("仅允许超级管理员保存双服务商密钥和模块开关", () => {
    const source = readFileSync(new URL("./routers/admin.ts", import.meta.url), "utf8");
    expect(source).toContain("notificationChannelConfigurationInput");
    expect(source).toContain('z.enum(["none", "aliyun", "tencent"])');
    expect(source).toContain("saveNotificationChannelConfiguration");
    expect(source).toContain("仅服务端 AES-GCM 加密托管");
    expect(source).toContain("发送失败不回滚业务");
  });

  it("服务号通道必须同时满足总开关、模块开关和即时事件限制", () => {
    const source = readFileSync(new URL("./services/officialAccountNotifier.ts", import.meta.url), "utf8");
    expect(source).toContain("WECHAT_OFFICIAL_NOTIFICATION_ENABLED");
    expect(source).toContain("WECHAT_OFFICIAL_NOTIFICATION_MODULES");
    expect(source).toContain('input.eventCode === "user_login_success"');
    expect(source).toContain("official_event_not_immediate");
  });
});
