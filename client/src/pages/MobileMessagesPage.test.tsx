import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MOBILE_BOTTOM_NAVIGATION } from "./MobileMessagesPage";

/**
 * 消息中心的底部导航必须停留在移动端路由域，不能跳转到后台或通用个人页面。
 */
describe("消息中心移动端导航", () => {
  it("将工作台和个人中心指向受保护的移动端页面", () => {
    expect(MOBILE_BOTTOM_NAVIGATION.workbench).toBe("/mobile");
    expect(MOBILE_BOTTOM_NAVIGATION.profile).toBe("/mobile/profile");
  });

  it("通知的到达与接收时间统一使用中国时区格式化", () => {
    const source = readFileSync(new URL("./MobileMessagesPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(source).toContain("return formatChinaDateTime(value);");
    expect(source).not.toContain('date.toLocaleString("zh-CN"');
  });
});
