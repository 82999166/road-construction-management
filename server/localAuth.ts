import { TRPCError } from "@trpc/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { auditLogs } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import * as db from "./db";

/** 临时管理员以固定内部身份复用既有的用户、角色和服务端数据范围校验，绝不在前端伪造管理员身份。 */
const TEMPORARY_ADMIN_OPEN_ID = "local-temporary-super-admin";
const TEMPORARY_ADMIN_NAME = "临时超级管理员";
const TEMPORARY_ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;

let failedAttemptTimes: number[] = [];
let lockedUntil = 0;

function toDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 使用等长摘要的固定时间比较，避免依据口令前缀产生可观察的比较时序。 */
function safelyMatches(left: string, right: string) {
  return timingSafeEqual(toDigest(left), toDigest(right));
}

function clearExpiredFailures(now: number) {
  failedAttemptTimes = failedAttemptTimes.filter(attemptTime => now - attemptTime < LOGIN_FAILURE_WINDOW_MS);
  if (lockedUntil <= now) lockedUntil = 0;
}

function registerFailure(now: number) {
  clearExpiredFailures(now);
  failedAttemptTimes.push(now);
  if (failedAttemptTimes.length >= MAX_FAILURES_PER_WINDOW) {
    lockedUntil = now + LOGIN_FAILURE_WINDOW_MS;
  }
  return lockedUntil > now;
}

function isTemporarilyLocked(now: number) {
  clearExpiredFailures(now);
  return lockedUntil > now;
}

async function recordTemporaryLoginAudit(
  action: "temporary_admin_login_success" | "temporary_admin_login_failed" | "temporary_admin_login_locked",
  userId: number | null,
) {
  try {
    const database = await db.getDb();
    if (!database) return;
    await database.insert(auditLogs).values({
      userId,
      module: "security",
      action,
      targetType: "account",
      targetId: userId ? String(userId) : null,
      summary:
        action === "temporary_admin_login_success"
          ? "临时超级管理员登录成功"
          : action === "temporary_admin_login_locked"
            ? "临时超级管理员登录尝试受限"
            : "临时超级管理员登录失败",
    });
  } catch {
    // 审计写入异常不得泄露口令，也不得改变认证失败的对外语义。
  }
}

function ensureTemporaryAdminConfiguration() {
  const username = ENV.tempAdminUsername.trim();
  const password = ENV.tempAdminPassword;
  if (!username || !password) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "临时管理账号尚未配置" });
  }
  return { username, password };
}

/**
 * 临时本地登录仅限初始化期间的一个超级管理员。口令仅存在于服务端受控环境变量，
 * 成功后签发既有签名会话 Cookie，因此后续访问仍经现有 tRPC 与服务端权限守卫。
 */
export async function loginTemporaryAdmin(
  ctx: TrpcContext,
  input: { username: string; password: string },
) {
  const { username: configuredUsername, password: configuredPassword } = ensureTemporaryAdminConfiguration();
  const now = Date.now();

  if (isTemporarilyLocked(now)) {
    await recordTemporaryLoginAudit("temporary_admin_login_locked", null);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "登录尝试次数过多，请 15 分钟后再试" });
  }

  const usernameMatches = safelyMatches(input.username.trim(), configuredUsername);
  const passwordMatches = safelyMatches(input.password, configuredPassword);
  if (!usernameMatches || !passwordMatches) {
    const locked = registerFailure(now);
    await recordTemporaryLoginAudit(locked ? "temporary_admin_login_locked" : "temporary_admin_login_failed", null);
    throw new TRPCError({
      code: locked ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED",
      message: locked ? "登录尝试次数过多，请 15 分钟后再试" : "账号或密码错误",
    });
  }

  failedAttemptTimes = [];
  lockedUntil = 0;

  const signedInAt = new Date();
  await db.upsertUser({
    openId: TEMPORARY_ADMIN_OPEN_ID,
    name: TEMPORARY_ADMIN_NAME,
    loginMethod: "temporary_local",
    role: "admin",
    lastSignedIn: signedInAt,
  });
  const user = await db.getUserByOpenId(TEMPORARY_ADMIN_OPEN_ID);
  if (!user) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "临时管理账号初始化失败，请稍后重试" });
  }

  await recordTemporaryLoginAudit("temporary_admin_login_success", user.id);
  const sessionToken = await sdk.createSessionToken(TEMPORARY_ADMIN_OPEN_ID, {
    name: TEMPORARY_ADMIN_NAME,
    expiresInMs: TEMPORARY_ADMIN_SESSION_MS,
  });
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: TEMPORARY_ADMIN_SESSION_MS });

  return { success: true, expiresInMs: TEMPORARY_ADMIN_SESSION_MS } as const;
}

/** 仅供 Vitest 在用例之间清理进程内限流状态，生产调用路径不会触发此方法。 */
export function resetTemporaryAdminLoginRateLimitForTests() {
  failedAttemptTimes = [];
  lockedUntil = 0;
}
