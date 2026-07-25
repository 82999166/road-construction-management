import { describe, expect, it } from "vitest";
import { createIdentityRecoveryAuditPayload, normalizeIdentityRecoveryUrl } from "./identityRecovery";

describe("企业身份账号恢复地址", () => {
  it("仅保留公开 HTTPS 地址并移除浏览器片段", () => {
    expect(normalizeIdentityRecoveryUrl("https://id.example.com/recover?tenant=road#temporary-code")).toBe("https://id.example.com/recover?tenant=road");
  });

  it("拒绝携带凭据、本机、内网、链路本地和内部主机名地址", () => {
    expect(() => normalizeIdentityRecoveryUrl("https://user:password@id.example.com/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://localhost/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://portal.local/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://192.168.10.20/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://169.254.169.254/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://[::1]/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://[fe80::1]/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("https://[fc00::1]/recover")).toThrow();
    expect(() => normalizeIdentityRecoveryUrl("http://id.example.com/recover")).toThrow();
  });

  it("为入口访问生成最小化审计负载，不携带恢复地址、令牌、密码、IP 或用户身份", () => {
    const payload = createIdentityRecoveryAuditPayload("redirected");
    expect(payload).toEqual({
      module: "security",
      action: "identity_recovery_redirected",
      targetType: "identity_recovery",
      summary: "用户通过受控入口前往企业身份平台进行账号恢复",
    });
    expect(Object.keys(payload)).not.toContain("url");
    expect(Object.keys(payload)).not.toContain("token");
    expect(Object.keys(payload)).not.toContain("userId");
  });
});
