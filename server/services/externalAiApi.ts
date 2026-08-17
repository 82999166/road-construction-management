import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { isIP } from "node:net";
import { systemSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

export const EXTERNAL_AI_SETTING_KEYS = {
  baseUrl: "AI_EXTERNAL_API_BASE_URL",
  apiKey: "AI_EXTERNAL_API_KEY",
  model: "AI_EXTERNAL_MODEL",
  enabled: "AI_EXTERNAL_ENABLED",
} as const;

export type ExternalAiConfiguration = {
  baseUrl: string;
  model: string;
  enabled: boolean;
  apiKey: string;
};

const blockedIpv4 = (host: string) => {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
};

/** 外部 AI 仅允许公开 HTTPS 地址，阻止明显的回环、私有网段和内网宿主名。 */
export function normalizeExternalAiBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "AI API 基础地址格式无效" });
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "::1" || isIP(hostname) === 6 || blockedIpv4(hostname)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "AI API 仅支持公开 HTTPS 地址，不能使用本机或内网地址" });
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeExternalAiModel(value: string) {
  const model = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(model)) throw new TRPCError({ code: "BAD_REQUEST", message: "AI 模型名称仅支持字母、数字、点、下划线、连字符和冒号" });
  return model;
}

const appendPath = (baseUrl: string, pathname: string) => `${baseUrl.replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;

/** 仅从已发布配置读取并解密 API Key；任何前端或列表接口都不返回该字段。 */
export async function getPublishedExternalAiConfiguration(): Promise<ExternalAiConfiguration | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, Object.values(EXTERNAL_AI_SETTING_KEYS))));
  const byKey = new Map(rows.map(item => [item.settingKey, item]));
  const baseUrl = byKey.get(EXTERNAL_AI_SETTING_KEYS.baseUrl)?.valueJson;
  const model = byKey.get(EXTERNAL_AI_SETTING_KEYS.model)?.valueJson;
  const enabled = byKey.get(EXTERNAL_AI_SETTING_KEYS.enabled)?.valueJson === "true";
  const encryptedKey = byKey.get(EXTERNAL_AI_SETTING_KEYS.apiKey)?.secretEncrypted;
  if (!baseUrl || !model || !encryptedKey) return null;
  return { baseUrl: normalizeExternalAiBaseUrl(baseUrl), model: normalizeExternalAiModel(model), enabled, apiKey: decryptSecret(encryptedKey) };
}

export async function getExternalAiConfigurationStatus() {
  const configuration = await getPublishedExternalAiConfiguration();
  if (!configuration) return { configured: false, enabled: false, baseUrl: null, model: null };
  return { configured: true, enabled: configuration.enabled, baseUrl: configuration.baseUrl, model: configuration.model };
}

export async function testExternalAiConnection(configuration: Pick<ExternalAiConfiguration, "baseUrl" | "apiKey">) {
  const response = await fetch(appendPath(configuration.baseUrl, "models"), {
    headers: { Authorization: `Bearer ${configuration.apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new TRPCError({ code: "BAD_REQUEST", message: `AI API 连接校验失败（HTTP ${response.status}）${body ? `：${body}` : ""}` });
  }
  return { success: true as const };
}

type ExternalAiResponseMode = "json_schema" | "json_object" | "prompt_json";
type ExternalAiMessageContent = string | Array<{ type?: string; text?: string }> | null | undefined;
type ExternalAiCompletionPayload = { model?: string; choices?: Array<{ message?: { content?: ExternalAiMessageContent } }> };

function normalizeExternalAiContent(content: ExternalAiMessageContent) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(part => typeof part.text === "string" ? part.text : "").join("").trim();
  return "";
}

function shouldTryNextResponseMode(status: number) {
  return status === 400 || status === 404 || status === 415 || status === 422;
}

/**
 * 通过兼容 OpenAI 的 Chat Completions API 请求 JSON 管理摘要。
 * 不同供应商对 response_format 的支持不一致，因此按 JSON Schema、JSON Object、提示词 JSON 逐级回退；
 * 这三种尝试均只传入脱敏摘要，错误信息不会包含 API Key、请求正文或模型原始响应。
 */
export async function invokeExternalAiJson(input: { configuration: ExternalAiConfiguration; system: string; prompt: string; schemaName: string; schema: Record<string, unknown>; maxTokens: number }) {
  const attempts: Array<{ mode: ExternalAiResponseMode; responseFormat?: Record<string, unknown>; systemSuffix?: string }> = [
    { mode: "json_schema", responseFormat: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } } },
    { mode: "json_object", responseFormat: { type: "json_object" } },
    { mode: "prompt_json", systemSuffix: "必须仅输出一个合法 JSON 对象，不要使用 Markdown 代码块或解释文字。" },
  ];
  let lastFailure = "external_ai_request_failed";
  for (const attempt of attempts) {
    const response = await fetch(appendPath(input.configuration.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.configuration.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: input.configuration.model,
        temperature: 0.1,
        max_tokens: input.maxTokens,
        ...(attempt.responseFormat ? { response_format: attempt.responseFormat } : {}),
        messages: [{ role: "system", content: `${input.system}${attempt.systemSuffix ? `\n${attempt.systemSuffix}` : ""}` }, { role: "user", content: input.prompt }],
      }),
    });
    if (!response.ok) {
      lastFailure = `external_ai_http_${response.status}`;
      if (shouldTryNextResponseMode(response.status)) continue;
      throw new Error(lastFailure);
    }
    const payload = await response.json() as ExternalAiCompletionPayload;
    const content = normalizeExternalAiContent(payload.choices?.[0]?.message?.content);
    if (content) return { model: payload.model || input.configuration.model, content, mode: attempt.mode };
    lastFailure = "external_ai_empty_response";
  }
  throw new Error(lastFailure);
}
