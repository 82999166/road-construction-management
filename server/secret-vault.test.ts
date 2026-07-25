import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "./services/secretVault";

describe("服务端密钥托管", () => {
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = "unit-test-only-root-key";
  });

  afterEach(() => {
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  it("使用带随机 IV 的 AES-GCM 密文保存敏感值，且密文不包含原文", () => {
    const plainText = "map-provider-live-secret";
    const first = encryptSecret(plainText);
    const second = encryptSecret(plainText);

    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first).not.toContain(plainText);
    expect(second).not.toBe(first);
    expect(decryptSecret(first)).toBe(plainText);
  });

  it("拒绝损坏密文与空敏感值，并始终以掩码而非原文返回预览", () => {
    expect(() => encryptSecret("   ")).toThrow("敏感配置内容不能为空");
    expect(() => decryptSecret("v1.invalid")).toThrow("密文格式无效");
    expect(maskSecret("abcdef123456")).toBe("********3456");
    expect(maskSecret("abcd")).toBe("****");
  });
});
