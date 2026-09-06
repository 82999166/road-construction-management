import { describe, expect, it } from "vitest";
import { normalizeSmsEventTemplates, selectSmsEventTemplate } from "./smsNotifier";

describe("业务事件短信模板配置", () => {
  it("仅保留受支持事件、去除重复项，并允许先保存未填写编码的待审核条目", () => {
    const templates = normalizeSmsEventTemplates([
      { eventCode: "transport_load_completed", templateCode: "", enabled: false },
      { eventCode: "transport_load_completed", templateCode: "SMS_DUPLICATE", enabled: true },
      { eventCode: "diesel_refuel_completed", templateCode: "SMS_DIESEL", enabled: true },
      { eventCode: "unknown", templateCode: "SMS_UNKNOWN", enabled: true },
    ]);
    expect(templates).toEqual([
      { eventCode: "transport_load_completed", templateCode: "", enabled: false },
      { eventCode: "diesel_refuel_completed", templateCode: "SMS_DIESEL", enabled: true },
    ]);
  });

  it("只选择已启用且已填写编码的当前事件模板，绝不把柴油模板错用于运输", () => {
    const templates = normalizeSmsEventTemplates([
      { eventCode: "transport_load_completed", templateCode: "SMS_LOAD", enabled: true },
      { eventCode: "transport_unload_completed", templateCode: "", enabled: true },
      { eventCode: "diesel_refuel_completed", templateCode: "SMS_DIESEL", enabled: true },
    ]);
    expect(selectSmsEventTemplate(templates, "transport_load_completed")?.templateCode).toBe("SMS_LOAD");
    expect(selectSmsEventTemplate(templates, "transport_unload_completed")).toBeNull();
    expect(selectSmsEventTemplate(templates, "diesel_refuel_completed")?.templateCode).toBe("SMS_DIESEL");
  });
});
