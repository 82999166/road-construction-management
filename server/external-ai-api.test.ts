import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeExternalAiJson, normalizeExternalAiBaseUrl, normalizeExternalAiModel } from "./services/externalAiApi";

describe("外部 AI API 安全配置", () => {
  afterEach(() => vi.unstubAllGlobals());
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

  it("当供应商不支持 json_schema 时自动改用 json_object，不泄露请求内容", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported response_format" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "compatible-model", choices: [{ message: { content: '{"executiveSummary":"已生成","priorityActions":[],"watchItems":[],"disclaimer":"仅供辅助"}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeExternalAiJson({ configuration: { baseUrl: "https://api.example.com/v1", apiKey: "test-secret", model: "compatible-model", enabled: true }, system: "system", prompt: "summary", schemaName: "briefing", schema: { type: "object" }, maxTokens: 100 });

    expect(result.mode).toBe("json_object");
    expect(result.model).toBe("compatible-model");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveProperty("apiKey");
  });
});
