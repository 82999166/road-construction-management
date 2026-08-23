import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOfficialAccountDriverBindingEntryUrl, normalizeWechatLoginReturnTo } from "./officialAccountBinding";

const originalJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = "unit-test-state-signing-secret";
});

afterEach(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

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

describe("司机微信固定绑定入口", () => {
  it("生成可放入公众号自动回复的服务号网页授权入口", () => {
    const url = createOfficialAccountDriverBindingEntryUrl({
      appId: "wx_test_app",
      appSecret: "secret_for_type_only",
      appUrl: "https://yx.maomaoyx.com",
      egressUrl: null,
      egressSharedSecret: null,
    });

    expect(url).toContain("https://open.weixin.qq.com/connect/oauth2/authorize");
    expect(url).toContain("appid=wx_test_app");
    expect(url).toContain("scope=snsapi_base");
    expect(url).toContain("%2Fapi%2Fofficial-account%2Fdriver-bind%2Fcallback");
    expect(url).toContain("#wechat_redirect");
  });

  it("拒绝非正式 HTTPS 域名作为司机绑定入口", () => {
    const url = createOfficialAccountDriverBindingEntryUrl({
      appId: "wx_test_app",
      appSecret: "secret_for_type_only",
      appUrl: "http://127.0.0.1:3000",
      egressUrl: null,
      egressSharedSecret: null,
    });

    expect(url).toBeNull();
  });
});
