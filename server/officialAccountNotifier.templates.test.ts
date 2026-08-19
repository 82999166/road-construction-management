import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildSingleFieldSummary, normalizeTemplateFieldValue, OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX, requestOfficialAccountApi, usesSingleFieldSummaryCompatibility } from "./services/officialAccountNotifier";

describe("服务号业务通知模板矩阵", () => {
  it("覆盖采购、柴油、合同、施工、运输、财务、计量、劳务、机械与安全消息", () => {
    const modules = new Set(OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX.map(item => item.module));
    expect(modules).toEqual(new Set(["construction", "purchasing", "diesel", "transport", "finance", "measurement", "labor", "machinery", "contract", "security"]));
  });

  it("每类通知均有事件、跳转地址与最小模板字段需求", () => {
    for (const item of OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX) {
      expect(item.events.length).toBeGreaterThan(0);
      expect(item.deepLink).toMatch(/^\/(mobile|admin)\//);
      expect(item.requiredVariables).toContain("title");
      expect(item.requiredVariables).toContain("content");
    }
  });

  it("包含小额采购、运输司机刷卡和施工日报修改等关键闭环事件", () => {
    const eventCodes = new Set(OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX.flatMap(item => item.events));
    expect(eventCodes.has("purchase_order_small_direct_submitted")).toBe(true);
    expect(eventCodes.has("transport_load_driver_notice")).toBe(true);
    expect(eventCodes.has("transport_unload_driver_notice")).toBe(true);
    expect(eventCodes.has("construction_daily_report_updated")).toBe(true);
    expect(eventCodes.has("diesel_price_alert")).toBe(true);
    expect(eventCodes.has("outsource_contract_created")).toBe(true);
  });

  it("对仅有一个可填字段的私有模板启用摘要兼容，保留标题、内容和事件语义", () => {
    expect(usesSingleFieldSummaryCompatibility({ keyword1: "{targetType} #{targetId}" })).toBe(true);
    expect(usesSingleFieldSummaryCompatibility({ first: "{title}", remark: "{content}" })).toBe(false);

    const summary = buildSingleFieldSummary({ title: "施工日报待审核", content: "项目部已提交日报", eventCode: "construction_daily_report_submitted" });
    expect(summary).toContain("施工日报待审核");
    expect(summary).toContain("项目部已提交日报");
    expect(summary).toContain("construction_daily_report_submitted");
  });

  it("按微信关键词类型规范化模板字段，避免 47003 参数格式错误", () => {
    expect(normalizeTemplateFieldValue("thing4", "设备维护审核结果通知\n项目部")).toBe("设备维护审核结果通知 项目部");
    expect(normalizeTemplateFieldValue("thing4", "一二三四五六七八九十一二三四五六七八九十一")).toHaveLength(20);
    expect(normalizeTemplateFieldValue("character_string1", "123456789012345678901234567890123456")).toHaveLength(32);
    expect(normalizeTemplateFieldValue("time3", "2026-08-16 04:00:00")).toBe("2026-08-16 04:00:00");
    expect(normalizeTemplateFieldValue("time3", "not-a-time")).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}/);
  });

  it("固定出口仅将微信 API 相对请求经签名网关转发，未配置时保留直接请求降级", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await requestOfficialAccountApi(
      { appId: "wx-test", appSecret: "secret", appUrl: "https://road.example.com", egressUrl: "https://wechat-egress.example.com", egressSharedSecret: "shared-secret" },
      "https://api.weixin.qq.com/cgi-bin/token?appid=wx-test",
      { method: "GET" },
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://wechat-egress.example.com/v1/wechat");
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((options.headers as Record<string, string>)["x-egress-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(String(options.body)).toContain("/cgi-bin/token?appid=wx-test");
    await expect(requestOfficialAccountApi(
      { appId: "wx-test", appSecret: "secret", appUrl: null, egressUrl: null, egressSharedSecret: null },
      "https://example.com/not-wechat",
      { method: "GET" },
    )).rejects.toThrow("invalid_wechat_upstream");
    vi.unstubAllGlobals();
  });
});
