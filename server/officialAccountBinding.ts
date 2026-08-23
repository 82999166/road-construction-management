import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { auditLogs, officialAccountBindingRequests, officialAccountBindings, users } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { createOfficialAccountDriverBindingRequest, buildWechatTextReplyXml, isDriverBindingKeyword, parseWechatPlainTextMessage, verifyOfficialAccountEventSignature } from "./services/officialAccountDriverBinding";
import { fingerprintOfficialAccountOpenId, getOfficialAccountAccessToken, loadPublishedOfficialAccountCredentials, loadPublishedOfficialAccountEventConfig, requestOfficialAccountApi } from "./services/officialAccountNotifier";
import { encryptSecret } from "./services/secretVault";

const BINDING_STATE_MAX_AGE_MS = 10 * 60 * 1_000;
type BindingState = { userId: number; issuedAt: number; nonce: string };
type LoginState = { returnTo: string; issuedAt: number; nonce: string };
type DriverBindingEntryState = { issuedAt: number; nonce: string };

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

/** 微信登录只接受站内相对路径，避免 OAuth 回调成为开放跳转入口。 */
export function normalizeWechatLoginReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/mobile";
  return value.startsWith("/admin") || value.startsWith("/mobile") ? value.slice(0, 240) : "/mobile";
}

function createLoginState(returnTo: string) {
  const state: LoginState = { returnTo: normalizeWechatLoginReturnTo(returnTo), issuedAt: Date.now(), nonce: randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signBindingStatePayload(payload)}`;
}

function verifyLoginState(rawState: string): LoginState | null {
  const [payload, receivedSignature] = rawState.split(".");
  if (!payload || !receivedSignature) return null;
  const expectedSignature = signBindingStatePayload(payload);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<LoginState>;
    if (typeof parsed.returnTo !== "string" || typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt) || typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    if (Math.abs(Date.now() - parsed.issuedAt) > BINDING_STATE_MAX_AGE_MS) return null;
    return { returnTo: normalizeWechatLoginReturnTo(parsed.returnTo), issuedAt: parsed.issuedAt, nonce: parsed.nonce };
  } catch {
    return null;
  }
}

function createDriverBindingEntryState() {
  const state: DriverBindingEntryState = { issuedAt: Date.now(), nonce: randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signBindingStatePayload(payload)}`;
}

function verifyDriverBindingEntryState(rawState: string): DriverBindingEntryState | null {
  const [payload, receivedSignature] = rawState.split(".");
  if (!payload || !receivedSignature) return null;
  const expectedSignature = signBindingStatePayload(payload);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DriverBindingEntryState>;
    if (typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt) || typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    if (Math.abs(Date.now() - parsed.issuedAt) > BINDING_STATE_MAX_AGE_MS) return null;
    return { issuedAt: parsed.issuedAt, nonce: parsed.nonce };
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

function fingerprintBindingToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 创建十分钟有效的服务号带参数二维码；数据库只保存令牌指纹，扫码原码不会持久化。 */
export async function createOfficialAccountScanBindingRequest(userId: number) {
  const db = await getDb();
  const credentials = await loadPublishedOfficialAccountCredentials();
  if (!db || !credentials.config) return { reason: credentials.reason ?? "database_unavailable" as const };
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + BINDING_STATE_MAX_AGE_MS);
  await db.insert(officialAccountBindingRequests).values({ userId, tokenFingerprint: fingerprintBindingToken(token), expiresAt });
  try {
    const accessToken = await getOfficialAccountAccessToken(credentials.config);
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expire_seconds: Math.floor(BINDING_STATE_MAX_AGE_MS / 1000), action_name: "QR_STR_SCENE", action_info: { scene: { scene_str: `bind_${token}` } } }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as { ticket?: string; errcode?: number } | null;
    if (!response.ok || !payload?.ticket) throw new Error("qrcode_unavailable");
    return { reason: null, expiresAt, qrCodeUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(payload.ticket)}` };
  } catch {
    return { reason: "delivery_failed" as const };
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

function loginCallbackError(res: Response, appUrl: URL | null, reason: "failed" | "not_bound" | "disabled" | "terminal") {
  if (!appUrl) {
    res.status(400).send("微信授权登录未完成，请返回系统后重试。");
    return;
  }
  const returnUrl = new URL("/login", appUrl);
  returnUrl.searchParams.set("wechatLogin", reason);
  res.redirect(302, returnUrl.toString());
}

function driverBindingEntryError(res: Response, appUrl: URL | null, reason: "failed" | "not_configured") {
  if (!appUrl) {
    res.status(400).send("司机微信绑定入口暂未配置完成，请联系管理员检查服务号配置。");
    return;
  }
  const returnUrl = new URL("/driver-wechat-bind", appUrl);
  returnUrl.searchParams.set("driverBind", reason);
  res.redirect(302, returnUrl.toString());
}

function requestTerminal(req: Request) {
  const userAgent = String(req.headers["user-agent"] ?? "");
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent) ? "mobile" as const : "pc" as const;
}

async function exchangeWechatOAuthOpenId(config: NonNullable<Awaited<ReturnType<typeof loadPublishedOfficialAccountCredentials>>["config"]>, code: string) {
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.searchParams.set("appid", config.appId);
  tokenUrl.searchParams.set("secret", config.appSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  const tokenResponse = await requestOfficialAccountApi(config, tokenUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
  const payload = await tokenResponse.json().catch(() => null) as { openid?: string } | null;
  const openId = payload?.openid?.trim();
  return tokenResponse.ok && openId && openId.length <= 128 ? openId : null;
}

/** 微信仅验证既有绑定；绝不根据 OpenID 自动注册、启用或提升系统账号。 */
async function completeWechatLogin(req: Request, res: Response, appUrl: URL, openId: string, returnTo: string) {
  const database = await getDb();
  if (!database) return loginCallbackError(res, appUrl, "failed");
  const fingerprint = fingerprintOfficialAccountOpenId(openId);
  const [account] = await database.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    loginMethod: users.loginMethod,
    localAccountStatus: users.localAccountStatus,
    localLoginMode: users.localLoginMode,
  }).from(officialAccountBindings).innerJoin(users, eq(officialAccountBindings.userId, users.id)).where(and(eq(officialAccountBindings.openIdFingerprint, fingerprint), eq(officialAccountBindings.status, "active"))).limit(1);
  if (!account) return loginCallbackError(res, appUrl, "not_bound");
  if (account.localAccountStatus === "disabled") return loginCallbackError(res, appUrl, "disabled");
  const terminal = requestTerminal(req);
  if (account.loginMethod === "local_manager" && ((account.localLoginMode === "pc" && terminal !== "pc") || (account.localLoginMode === "mobile" && terminal !== "mobile"))) return loginCallbackError(res, appUrl, "terminal");
  await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, account.id));
  try {
    await database.insert(auditLogs).values({ userId: account.id, module: "security", action: "wechat_oauth_login_success", targetType: "account", targetId: String(account.id), summary: "已绑定微信身份完成授权登录" });
  } catch {
    // 审计异常不得扩大为登录失败，也不记录 OpenID、授权码或令牌。
  }
  const expiresInMs = 8 * 60 * 60 * 1_000;
  const sessionToken = await sdk.createSessionToken(account.openId, { name: account.name || "微信授权用户", expiresInMs });
  res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: expiresInMs });
  res.redirect(302, new URL(returnTo, appUrl).toString());
}

/** 生成仅在微信内打开的服务号 OAuth 绑定地址；状态签名绑定到当前登录员工且十分钟后失效。 */
export async function createOfficialAccountBindingUrl(userId: number) {
  const configResult = await loadPublishedOfficialAccountCredentials();
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

export function createOfficialAccountDriverBindingEntryUrl(config: NonNullable<Awaited<ReturnType<typeof loadPublishedOfficialAccountCredentials>>["config"]>) {
  const appUrl = getSafeAppUrl(config.appUrl);
  if (!appUrl) return null;
  const callbackUrl = new URL("/api/official-account/driver-bind/callback", appUrl).toString();
  const authorizeUrl = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  authorizeUrl.searchParams.set("appid", config.appId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "snsapi_base");
  authorizeUrl.searchParams.set("state", createDriverBindingEntryState());
  return `${authorizeUrl.toString()}#wechat_redirect`;
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
  app.get("/api/official-account/messages", async (req: Request, res: Response) => {
    const signature = typeof req.query.signature === "string" ? req.query.signature : "";
    const timestamp = typeof req.query.timestamp === "string" ? req.query.timestamp : "";
    const nonce = typeof req.query.nonce === "string" ? req.query.nonce : "";
    const echostr = typeof req.query.echostr === "string" ? req.query.echostr : "";
    const eventConfig = await loadPublishedOfficialAccountEventConfig();
    if (!eventConfig.config || !signature || !timestamp || !nonce || !verifyOfficialAccountEventSignature({ token: eventConfig.config.eventToken, timestamp, nonce, signature })) {
      res.status(403).type("text/plain").send("forbidden");
      return;
    }
    res.type("text/plain").send(echostr);
  });

  app.post("/api/official-account/messages", async (req: Request, res: Response) => {
    const signature = typeof req.query.signature === "string" ? req.query.signature : "";
    const timestamp = typeof req.query.timestamp === "string" ? req.query.timestamp : "";
    const nonce = typeof req.query.nonce === "string" ? req.query.nonce : "";
    const eventConfig = await loadPublishedOfficialAccountEventConfig();
    if (!eventConfig.config || !signature || !timestamp || !nonce || !verifyOfficialAccountEventSignature({ token: eventConfig.config.eventToken, timestamp, nonce, signature })) {
      res.status(403).type("text/plain").send("forbidden");
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
    const message = parseWechatPlainTextMessage(rawBody);
    const content = message.msgType === "event" && message.event.toLowerCase() === "subscribe" ? "绑定" : message.content;
    if (!message.fromUserName || !message.toUserName || !isDriverBindingKeyword(content)) {
      res.type("text/plain").send("success");
      return;
    }
    const request = await createOfficialAccountDriverBindingRequest(message.fromUserName);
    const reply = request.success
      ? `请点击以下链接绑定渣土车司机微信：\n${request.url}\n\n链接30分钟内有效。绑定时只需输入完整车牌号，司机不会获得后台登录权限。`
      : "司机绑定入口暂未配置完成，请联系管理员检查服务号业务跳转地址与事件推送 Token。";
    res.type("application/xml").send(buildWechatTextReplyXml({ toUserName: message.fromUserName, fromUserName: message.toUserName, content: reply }));
  });

  /** 固定司机绑定入口：用于放入公众号自动回复，点击后通过服务号网页授权识别当前司机微信。 */
  app.get("/api/official-account/driver-bind/start", async (_req: Request, res: Response) => {
    const configResult = await loadPublishedOfficialAccountCredentials();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    const authorizeUrl = configResult.config ? createOfficialAccountDriverBindingEntryUrl(configResult.config) : null;
    if (!configResult.config || !appUrl || !authorizeUrl) {
      driverBindingEntryError(res, appUrl, "not_configured");
      return;
    }
    res.redirect(302, authorizeUrl);
  });

  /** 固定司机绑定入口回调：生成一次性司机绑定令牌并跳转既有绑定页，不授予后台登录权限。 */
  app.get("/api/official-account/driver-bind/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const rawState = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = rawState ? verifyDriverBindingEntryState(rawState) : null;
    const configResult = await loadPublishedOfficialAccountCredentials();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    if (!code || !state || !configResult.config || !appUrl) {
      driverBindingEntryError(res, appUrl, "failed");
      return;
    }
    try {
      const openId = await exchangeWechatOAuthOpenId(configResult.config, code);
      if (!openId) {
        driverBindingEntryError(res, appUrl, "failed");
        return;
      }
      const request = await createOfficialAccountDriverBindingRequest(openId);
      if (!request.success) {
        driverBindingEntryError(res, appUrl, "failed");
        return;
      }
      res.redirect(302, request.url);
    } catch {
      driverBindingEntryError(res, appUrl, "failed");
    }
  });

  app.get("/api/official-account/bind/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const rawState = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = rawState ? verifyBindingState(rawState) : null;
    const configResult = await loadPublishedOfficialAccountCredentials();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    if (!code || !state || !configResult.config || !appUrl) {
      callbackError(res, appUrl, "failed");
      return;
    }
    try {
      const openId = await exchangeWechatOAuthOpenId(configResult.config, code);
      if (!openId) {
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

  /** 用户从登录页主动发起微信授权；必须是既有账号已绑定的微信身份才可进入系统。 */
  app.get("/api/official-account/login/start", async (req: Request, res: Response) => {
    const configResult = await loadPublishedOfficialAccountCredentials();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    if (!configResult.config || !appUrl) {
      loginCallbackError(res, appUrl, "failed");
      return;
    }
    const callbackUrl = new URL("/api/official-account/login/callback", appUrl).toString();
    const authorizeUrl = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    authorizeUrl.searchParams.set("appid", configResult.config.appId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "snsapi_base");
    authorizeUrl.searchParams.set("state", createLoginState(normalizeWechatLoginReturnTo(req.query.returnTo)));
    res.redirect(302, `${authorizeUrl.toString()}#wechat_redirect`);
  });

  app.get("/api/official-account/login/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const rawState = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = rawState ? verifyLoginState(rawState) : null;
    const configResult = await loadPublishedOfficialAccountCredentials();
    const appUrl = getSafeAppUrl(configResult.config?.appUrl ?? null);
    if (!code || !state || !configResult.config || !appUrl) {
      loginCallbackError(res, appUrl, "failed");
      return;
    }
    try {
      const openId = await exchangeWechatOAuthOpenId(configResult.config, code);
      if (!openId) return loginCallbackError(res, appUrl, "failed");
      await completeWechatLogin(req, res, appUrl, openId, state.returnTo);
    } catch {
      loginCallbackError(res, appUrl, "failed");
    }
  });
}
