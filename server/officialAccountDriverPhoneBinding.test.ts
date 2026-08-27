import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDriverPhone } from "./services/officialAccountDriverBinding";

describe("微信司机车辆绑定手机号二次校验", () => {
  it("仅接受规范化后的中国大陆手机号", () => {
    expect(normalizeDriverPhone("138 0013 8000")).toBe("13800138000");
    expect(normalizeDriverPhone("+86-13800138000")).toBe("13800138000");
    expect(normalizeDriverPhone("12800138000")).toBe("");
    expect(normalizeDriverPhone("1380013800")).toBe("");
  });

  it("绑定服务只比较车辆手机号密文，不将手机号写入审计或返回值", () => {
    const source = readFileSync(new URL("./services/officialAccountDriverBinding.ts", import.meta.url), "utf8");

    expect(source).toContain("driverPhone: string");
    expect(source).toContain("decryptSecret(vehicle.driverPhoneEncrypted)");
    expect(source).toContain("isSameDriverPhone");
    expect(source).toContain('action: "driver_wechat_binding_phone_mismatch"');
    expect(source).toContain("车牌与司机手机号未匹配");
    expect(source).not.toContain("summary: `外部司机微信车辆绑定手机号");
  });

  it("仅在已验证的微信车牌手机号流程中开通移动端司机账号，并收敛到当前车辆和项目", () => {
    const source = readFileSync(new URL("./services/officialAccountDriverBinding.ts", import.meta.url), "utf8");

    expect(source).toContain('loginMethod: "local_driver"');
    expect(source).toContain("createLocalDriverOpenId(normalizedDriverPhone)");
    expect(source).toContain("createLocalManagerPasswordHash(input.initialPassword)");
    expect(source).toContain('localLoginMode: "mobile"');
    expect(source).toContain('eq(systemRoles.code, "DRIVER")');
    expect(source).toContain("projectId: vehicle.projectId");
    expect(source).toContain("driver_account_vehicle_conflict");
    expect(source).toContain("officialAccountBindings");
    expect(source).toContain("driver_mobile_account_provisioned");
  });
});
