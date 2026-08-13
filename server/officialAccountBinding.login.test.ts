import { describe, expect, it } from "vitest";
import { normalizeWechatLoginReturnTo } from "./officialAccountBinding";

describe("微信授权登录回跳路径", () => {
  it("仅接受系统内后台和移动端路径", () => {
    expect(normalizeWechatLoginReturnTo("/mobile/profile")).toBe("/mobile/profile");
    expect(normalizeWechatLoginReturnTo("/admin/settings")).toBe("/admin/settings");
  });

  it("拒绝站外、协议相对和无效回跳地址", () => {
    expect(normalizeWechatLoginReturnTo("https://unsafe.example")).toBe("/mobile");
    expect(normalizeWechatLoginReturnTo("//unsafe.example")).toBe("/mobile");
    expect(normalizeWechatLoginReturnTo("/login")).toBe("/mobile");
    expect(normalizeWechatLoginReturnTo(undefined)).toBe("/mobile");
  });
});
