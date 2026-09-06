import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("运输与柴油短信模板接线", () => {
  it("运输装土、卸土和柴油加油均使用独立事件编码，且投递仍以非阻塞方式执行", () => {
    const operations = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const admin = readFileSync(new URL("./routers/admin.ts", import.meta.url), "utf8");
    expect(operations).toContain("transport_load_completed");
    expect(operations).toContain("transport_unload_completed");
    expect(operations).toContain("void notifyAliyunSmsSafely");
    expect(admin).toContain("diesel_refuel_completed");
    expect(admin).toContain("SMS_EVENT_TEMPLATE_CONFIGS");
    expect(admin).toContain("同一业务事件只能配置一个短信模板");
    expect(admin).toContain("inspectAliyunSmsNotificationReadiness");
    expect(admin).toContain("sendAliyunSmsNotificationTest");
    expect(admin).toContain("请输入合法的中国大陆测试手机号");
  });
});
