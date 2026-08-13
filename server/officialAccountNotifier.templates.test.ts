import { describe, expect, it } from "vitest";
import { buildSingleFieldSummary, OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX, usesSingleFieldSummaryCompatibility } from "./services/officialAccountNotifier";

describe("服务号业务通知模板矩阵", () => {
  it("覆盖采购、施工、运输、财务、计量、劳务、机械与安全消息", () => {
    const modules = new Set(OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX.map(item => item.module));
    expect(modules).toEqual(new Set(["construction", "purchasing", "transport", "finance", "measurement", "labor", "machinery", "security"]));
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
  });

  it("对仅有一个可填字段的私有模板启用摘要兼容，保留标题、内容和事件语义", () => {
    expect(usesSingleFieldSummaryCompatibility({ keyword1: "{targetType} #{targetId}" })).toBe(true);
    expect(usesSingleFieldSummaryCompatibility({ first: "{title}", remark: "{content}" })).toBe(false);

    const summary = buildSingleFieldSummary({ title: "施工日报待审核", content: "项目部已提交日报", eventCode: "construction_daily_report_submitted" });
    expect(summary).toContain("施工日报待审核");
    expect(summary).toContain("项目部已提交日报");
    expect(summary).toContain("construction_daily_report_submitted");
  });
});
