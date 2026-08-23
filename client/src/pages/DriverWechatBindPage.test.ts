import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("client/src/pages/DriverWechatBindPage.tsx", "utf8");
const adminSource = readFileSync("client/src/pages/AdminPage.tsx", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");

describe("司机微信绑定前端入口", () => {
  it("提供公开司机绑定页面且不要求后台登录", () => {
    expect(appSource).toContain("/driver-wechat-bind");
    expect(pageSource).toContain("driverBindingStatus");
    expect(pageSource).toContain("completeDriverBinding");
    expect(pageSource).toContain("司机不会获得后台登录权限");
  });

  it("后台车辆台账展示司机微信绑定状态并提供解绑入口", () => {
    expect(adminSource).toContain("司机微信绑定");
    expect(adminSource).toContain("微信已绑定");
    expect(adminSource).toContain("微信未绑定");
    expect(adminSource).toContain("revokeDriverWechatBinding");
    expect(adminSource).toContain("解绑微信");
  });
});

