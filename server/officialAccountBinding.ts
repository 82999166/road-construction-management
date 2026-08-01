import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { auditLogs, officialAccountBindings, users } from "../drizzle/schema";
import { getDb } from "./db";
import { fingerprintOfficialAccountOpenId, loadPublishedOfficialAccountConfig } from "./services/officialAccountNotifier";
import { encryptSecret } from "./services/secretVault";

const BINDING_STATE_MAX_AGE_MS = 10 * 60 * 1_000;
type BindingState = { userId: number; issuedAt: number; nonce: string };

function getStateSigningKey() {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error("系统未配置绑定状态签名密钥");
  return key;
}

function signBindingStatePayload(payload: string) {
  return createHmac("sha256", getStateSigningKey()).update(payload, "utf8").digest("base64url");
}

function createBindingState(userId: number) {
  const state: BindingState = { userId, issuedAt: Date.now(), nonce: randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signBindingStatePayload(payload)}`;
}

function verifyBindingState(rawState: string): BindingState | null {
  const [payload, receivedSignature] = rawState.split(".");
  if (!payload || !receivedSignature) return null;
  const expectedSignature = signBindingStatePayload(payload);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<BindingState>;
    if (!Number.isInteger(parsed.userId) || (parsed.userId ?? 0) <= 0 || typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt) || typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    if (Math.abs(Date.now() - parsed.issuedAt) > BINDING_STATE_MAX_AGE_MS) return null;
    return { userId: parsed.userId!, issuedAt: parsed.issuedAt, nonce: parsed.nonce };
  } catch {
    return null;
  }
}

function getSafeAppUrl(appUrl: string | null) {
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function callbackError(res: Response, appUrl: URL | null, result: "failed" | "conflict") {
  if (appUrl) {
    const returnUrl = new URL("/mobile/profile", appUrl);
    returnUrl.searchParams.set("officialAccount", result);
    res.redirect(302, returnUrl.toString());
    return;
  }
  res.status(400).send("公众号绑定未完成，请返回系统后重试。");
}

/** 生成仅在微信内打开的服务号 OAuth 绑定地址；状态签名绑定到当前登录员工且十分钟后失效。 */
export async function createOfficialAccountBindingUrl(userId: number) {
  const configResult = await loadPublishedOfficialAccountConfig();
  const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
  if (!configResult.config || !appUrl) return { url: null, reason: "not_configured" as const };
  const callbackUrl = new URL("/api/official-account/bind/callback", appUrl).toString();
  const authorizeUrl = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  authorizeUrl.searchParams.set("appid", configResult.config.appId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "snsapi_base");
  authorizeUrl.searchParams.set("state", createBindingState(userId));
  return { url: `${authorizeUrl.toString()}#wechat_redirect`, reason: null };
}

export async function getOfficialAccountBindingStatus(userId: number) {
  const db = await getDb();
  if (!db) return { status: "unavailable" as const, boundAt: null, lastVerifiedAt: null, lastFailureAt: null };
  const [binding] = await db.select({ status: officialAccountBindings.status, boundAt: officialAccountBindings.boundAt, lastVerifiedAt: officialAccountBindings.lastVerifiedAt, lastFailureAt: officialAccountBindings.lastFailureAt }).from(officialAccountBindings).where(eq(officialAccountBindings.userId, userId)).limit(1);
  return binding ?? { status: "unbound" as const, boundAt: null, lastVerifiedAt: null, lastFailureAt: null };
}

async function persistBinding(userId: number, openId: string) {
  const db = await getDb();
  if (!db) return "database_unavailable" as const;
  const [user] = await db.select({ id: users.id, accountStatus: users.localAccountStatus }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountStatus === "disabled") return "invalid_user" as const;
  const fingerprint = fingerprintOfficialAccountOpenId(openId);
  const [ownedByAnother] = await db.select({ userId: officialAccountBindings.userId }).from(officialAccountBindings).where(and(eq(officialAccountBindings.openIdFingerprint, fingerprint), eq(officialAccountBindings.status, "active"))).limit(1);
  if (ownedByAnother && ownedByAnother.userId !== userId) return "already_bound" as const;
  const encryptedOpenId = encryptSecret(openId);
  const now = new Date();
  const [existing] = await db.select({ id: officialAccountBindings.id }).from(officialAccountBindings).where(eq(officialAccountBindings.userId, userId)).limit(1);
  if (existing) {
    await db.update(officialAccountBindings).set({ openIdEncrypted: encryptedOpenId, openIdFingerprint: fingerprint, bindingSource: "wechat_oauth", status: "active", boundAt: now, lastVerifiedAt: now, lastFailureAt: null, failureCount: 0 }).where(eq(officialAccountBindings.id, existing.id));
  } else {
    await db.insert(officialAccountBindings).values({ userId, openIdEncrypted: encryptedOpenId, openIdFingerprint: fingerprint, bindingSource: "wechat_oauth", status: "active", boundAt: now, lastVerifiedAt: now, failureCount: 0 });
  }
  try {
    await db.insert(auditLogs).values({ userId, module: "security", action: "official_account_bound", targetType: "official_account_binding", targetId: String(userId), summary: "微信公众号通知身份已完成绑定" });
  } catch {
    // 审计失败不能撤销已成功保存的绑定。
  }
  return "bound" as const;
}

/** 微信 OAuth 回调只处理签名状态与 OpenID 绑定，绝不输出授权码、令牌或 OpenID。 */
export function registerOfficialAccountBindingRoutes(app: Express) {
  app.get("/api/official-account/bind/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const rawState = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = rawState ? verifyBindingState(rawState) : null;
    const configResult = await loadPublishedOfficialAccountConfig();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    if (!code || !state || !configResult.config || !appUrl) {
      callbackError(res, appUrl, "failed");
      return;
    }
    try {
      const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
      tokenUrl.searchParams.set("appid", configResult.config.appId);
      tokenUrl.searchParams.set("secret", configResult.config.appSecret);
      tokenUrl.searchParams.set("code", code);
      tokenUrl.searchParams.set("grant_type", "authorization_code");
      const tokenResponse = await fetch(tokenUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
      const payload = await tokenResponse.json().catch(() => null) as { openid?: string } | null;
      const openId = payload?.openid?.trim();
      if (!tokenResponse.ok || !openId || openId.length > 128) {
        callbackError(res, appUrl, "failed");
        return;
      }
      const result = await persistBinding(state.userId, openId);
      if (result !== "bound") {
        callbackError(res, appUrl, result === "already_bound" ? "conflict" : "failed");
        return;
      }
      const returnUrl = new URL("/mobile/profile", appUrl);
      returnUrl.searchParams.set("officialAccount", "bound");
      res.redirect(302, returnUrl.toString());
    } catch {
      callbackError(res, appUrl, "failed");
    }
  });
}
