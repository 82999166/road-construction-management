import { and, eq } from "drizzle-orm";
import type { Express } from "express";
import { auditLogs, systemSettings } from "../drizzle/schema";
import { getDb } from "./db";

/** 身份提供方恢复页面由超级管理员配置；本系统绝不接收或保存企业密码。 */
export const IDENTITY_PROVIDER_RECOVERY_URL_KEY = "IDENTITY_PROVIDER_RECOVERY_URL";

type IdentityRecoveryAuditEvent = "redirected" | "unavailable";

/**
 * 登录前的恢复入口不解析会话，也不记录地址、查询参数、令牌、IP 或用户身份。
 * 该最小化负载仅用于证明受控入口被调用，审计写入失败不得阻断账号恢复。
 */
export function createIdentityRecoveryAuditPayload(event: IdentityRecoveryAuditEvent) {
  return {
    module: "security",
    action: event === "redirected" ? "identity_recovery_redirected" : "identity_recovery_unavailable",
    targetType: "identity_recovery",
    summary: event === "redirected" ? "用户通过受控入口前往企业身份平台进行账号恢复" : "用户访问账号恢复入口，但企业身份平台恢复地址尚未发布",
  };
}

async function recordIdentityRecoveryAccess(event: IdentityRecoveryAuditEvent) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values(createIdentityRecoveryAuditPayload(event));
  } catch {
    // 审计基础设施不可用时，仍允许用户前往已发布的身份恢复页，避免安全记录故障放大为账号恢复阻断。
  }
}

function isBlockedIdentityRecoveryHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [first, second, third, fourth] = ipv4.slice(1).map(Number);
    if ([first, second, third, fourth].some(part => part > 255)) return true;
    return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19)) || first >= 224;
  }
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1" || host.includes("::ffff:")) return true;
  const firstHextet = Number.parseInt(host.split(":").find(Boolean) ?? "0", 16);
  return Number.isFinite(firstHextet) && ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80);
}

/**
 * 仅允许公开 HTTPS 身份平台地址，拒绝携带凭据、内网和本机地址。
 * 该地址只用于浏览器跳转，仍执行与外部连接器一致的地址安全约束。
 */
export function normalizeIdentityRecoveryUrl(rawValue: string) {
  const url = new URL(rawValue.trim());
  if (url.protocol !== "https:" || !url.hostname || isBlockedIdentityRecoveryHost(url.hostname) || url.username || url.password) {
    throw new Error("身份恢复地址必须是公开 HTTPS 地址，且不得包含账号、密码、内网或本机地址");
  }
  // 片段不会提交给身份平台，移除后避免管理员误将敏感短码保存在配置中。
  url.hash = "";
  return url.toString();
}

/** 只读取已发布的非敏感恢复地址；配置失效时安全降级为未配置。 */
export async function getPublishedIdentityRecoveryUrl() {
  const db = await getDb();
  if (!db) return null;
  const [setting] = await db
    .select({ valueJson: systemSettings.valueJson, isSensitive: systemSettings.isSensitive })
    .from(systemSettings)
    .where(and(eq(systemSettings.settingKey, IDENTITY_PROVIDER_RECOVERY_URL_KEY), eq(systemSettings.status, "published")))
    .limit(1);
  if (!setting?.valueJson || setting.isSensitive) return null;
  try {
    return normalizeIdentityRecoveryUrl(setting.valueJson);
  } catch {
    return null;
  }
}

/**
 * 账号恢复始终在身份提供方完成。本端点不识别用户、不会写入密码或令牌，
 * 仅在管理员已发布公开恢复地址时执行一次浏览器 302 跳转。
 */
export function registerIdentityRecoveryRoute(app: Express) {
  app.get("/api/identity-recovery", async (_req, res) => {
    const recoveryUrl = await getPublishedIdentityRecoveryUrl();
    if (!recoveryUrl) {
      await recordIdentityRecoveryAccess("unavailable");
      res.status(503).type("html").send("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>账号恢复暂不可用</title><body><h1>账号恢复暂不可用</h1><p>企业身份平台恢复地址尚未由系统管理员发布。请联系系统管理员核查账号状态与项目授权。</p></body></html>");
      return;
    }
    await recordIdentityRecoveryAccess("redirected");
    res.redirect(302, recoveryUrl);
  });
}
