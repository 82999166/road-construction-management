import { describe, expect, it } from "vitest";
import { normalizeExternalAiBaseUrl, normalizeExternalAiModel } from "./services/externalAiApi";

describe("外部 AI API 安全配置", () => {
  it("接受公开 HTTPS 的兼容 OpenAI API 根地址并规范化末尾斜杠", () => {
    expect(normalizeExternalAiBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });

  it("拒绝 HTTP、回环、localhost 和 RFC1918 私有网段，避免服务端请求伪造", () => {
    for (const value of ["http://api.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.8/v1", "https://192.168.1.8/v1"]) {
      expect(() => normalizeExternalAiBaseUrl(value)).toThrow("AI API");
    }
  });

  it("仅接受安全模型标识，避免将模型字段作为任意命令或 URL 使用", () => {
    expect(normalizeExternalAiModel("gpt-4o-mini:production")).toBe("gpt-4o-mini:production");
    expect(() => normalizeExternalAiModel("gpt 4o")).toThrow("模型名称");
  });
});
