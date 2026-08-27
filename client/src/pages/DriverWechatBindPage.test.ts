import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("client/src/pages/DriverWechatBindPage.tsx", "utf8");
const adminSource = readFileSync("client/src/pages/AdminPage.tsx", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");

describe("司机微信绑定前端入口", () => {
  it("提供公开司机绑定页面且不要求后台登录", () => {
    expect(appSource).toContain("/driver-wechat-bind");
    expect(appSource).toContain("/driver-portal");
    expect(pageSource).toContain("driverBindingStatus");
    expect(pageSource).toContain("completeDriverBinding");
    expect(pageSource).toContain("司机不会获得后台登录权限");
    expect(pageSource).toContain("查看我的运费账单");
  });

  it("后台车辆台账展示司机微信绑定状态并提供解绑入口", () => {
    expect(adminSource).toContain("司机微信绑定");
    expect(adminSource).toContain("微信已绑定");
    expect(adminSource).toContain("微信未绑定");
    expect(adminSource).toContain("revokeDriverWechatBinding");
    expect(adminSource).toContain("解绑微信");
  });

  it("司机端账单展示柴油、已付费用和未付费用", () => {
    const portalSource = readFileSync("client/src/pages/DriverPortalPage.tsx", "utf8");
    expect(portalSource).toContain("driverPortalSummary");
    expect(portalSource).toContain("司机运费账单");
    expect(portalSource).toContain("已付费用");
    expect(portalSource).toContain("未付费用");
    expect(portalSource).toContain("柴油扣款明细");
    expect(portalSource).toContain("待结算运费");
  });
});
