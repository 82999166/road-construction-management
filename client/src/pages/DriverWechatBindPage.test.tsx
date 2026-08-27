import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("微信司机车辆绑定页面", () => {
  it("要求同时填写车牌、司机手机号和首次密码，以安全开通手机号司机账号", () => {
    const source = readFileSync(new URL("./DriverWechatBindPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("司机手机号（校验）");
    expect(source).toContain("driverPhone");
    expect(source).toContain("手机号仅用于本次匹配校验");
    expect(source).toContain("设置司机登录密码");
    expect(source).toContain("initialPassword");
    expect(source).toContain("开通账号并绑定车辆");
    expect(source).toContain("bind.mutate({ token, plateNo, driverPhone, initialPassword })");
    expect(source).toContain("用手机号登录司机工作台");
  });
});
