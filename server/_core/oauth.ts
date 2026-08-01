import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { auditLogs } from "../../drizzle/schema";
import * as db from "../db";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF guard: the nonce in `state` must match the one-time cookie that
    // startLogin set in the browser that began this login. An attacker can
    // forge `state`, but cannot plant this cookie in the victim's browser.
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      /** 登录审计只使用内部用户 ID 和固定摘要，绝不记录授权码、令牌、邮箱、Cookie 或来源 IP。 */
      try {
        const userRecord = await db.getUserByOpenId(userInfo.openId);
        const database = await db.getDb();
        if (userRecord && database) {
          await database.insert(auditLogs).values({
            userId: userRecord.id,
            module: "security",
            action: "oauth_login_success",
            targetType: "account",
            targetId: String(userRecord.id),
            summary: "企业统一身份登录成功",
          });
          void notifyOfficialAccountBusinessEventSafely({
            userId: userRecord.id,
            module: "security",
            eventCode: "oauth_login_success",
            targetType: "account",
            targetId: String(userRecord.id),
            title: "账号安全提醒：已完成统一身份登录",
            deepLink: "/mobile/profile",
          }).catch(() => undefined);
        }
      } catch {
        // 审计或外部通知异常不得阻断已验证的登录会话。
      }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      try {
        const database = await db.getDb();
        if (database) {
          await database.insert(auditLogs).values({
            userId: null,
            module: "security",
            action: "oauth_login_failed",
            targetType: "oauth_callback",
            targetId: null,
            summary: "企业统一身份登录回调失败",
          });
        }
      } catch {
        // 失败审计不能覆盖原始认证失败响应。
      }
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
