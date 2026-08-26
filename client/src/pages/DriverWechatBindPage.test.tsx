import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("微信司机车辆绑定页面", () => {
  it("要求同时填写车牌和司机手机号，并说明手机号只用于校验", () => {
    const source = readFileSync(new URL("./DriverWechatBindPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("司机手机号（校验）");
    expect(source).toContain("driverPhone");
    expect(source).toContain("手机号仅用于本次匹配校验");
    expect(source).toContain("核验手机号并绑定车辆");
    expect(source).toContain("bind.mutate({ token, plateNo, driverPhone })");
  });
});
