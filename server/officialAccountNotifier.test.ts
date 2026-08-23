import { describe, expect, it } from "vitest";
import { normalizeTemplateFieldValue } from "./services/officialAccountNotifier";

describe("normalizeTemplateFieldValue", () => {
  it("为 character_string 字段移除中文和空格，避免微信模板参数 47003", () => {
    expect(normalizeTemplateFieldValue("character_string7", "系统测试 #SYSTEM-TEST")).toBe("SYSTEM-TEST");
    expect(normalizeTemplateFieldValue("character_string8", "纯中文字段")).toBe("SYSTEMTEST");
  });

  it("为 amount 字段生成金额格式，避免把业务摘要直接写入金额关键词", () => {
    expect(normalizeTemplateFieldValue("amount2", "本次金额 123.456 元")).toBe("¥123.45");
    expect(normalizeTemplateFieldValue("amount9", "这是一条系统测试")).toBe("¥0.00");
  });

  it("为 time 和 const 字段生成微信模板可接受的短值", () => {
    expect(normalizeTemplateFieldValue("time1", "系统测试 #SYSTEM-TEST")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(normalizeTemplateFieldValue("time2", "2026/8/3 7:05")).toBe("2026-08-03 07:05:00");
    expect(normalizeTemplateFieldValue("const2", "这是一条服务号通知通道系统测试，不代表真实业务订单。")).toBe("正常");
  });

  it("为 thing 字段移除井号、下划线和标点符号", () => {
    expect(normalizeTemplateFieldValue("thing4", "业务事项 #official_account_system_test")).toBe("业务事项officialaccounts");
  });
});
