import { TRPCError } from "@trpc/server";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { auditLogs } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import * as db from "./db";

/** 临时管理员只用于初始化；普通管理人员由超级管理员在后台创建，二者不共享身份。 */
const TEMPORARY_ADMIN_OPEN_ID = "local-temporary-super-admin";
const TEMPORARY_ADMIN_NAME = "临时超级管理员";
const TEMPORARY_ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const LOCAL_MANAGER_SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;
const LOCAL_MANAGER_OPEN_ID_PREFIX = "local-manager:";
const LOCAL_DRIVER_OPEN_ID_PREFIX = "local-driver:";

type AttemptState = { failedAttemptTimes: number[]; lockedUntil: number };
type LoginAuditAction =
  | "temporary_admin_login_success"
  | "temporary_admin_login_failed"
  | "temporary_admin_login_locked"
  | "temporary_admin_login_disabled"
  | "local_manager_login_success"
  | "local_manager_login_failed"
  | "local_manager_login_locked"
  | "local_manager_password_changed"
  | "local_driver_login_success"
  | "local_driver_login_failed"
  | "local_driver_login_locked"
  | "local_driver_password_changed";

let temporaryAdminAttempts: AttemptState = { failedAttemptTimes: [], lockedUntil: 0 };
const localManagerAttempts = new Map<string, AttemptState>();

function toDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 使用等长摘要的固定时间比较，避免依据口令前缀产生可观察的比较时序。 */
function safelyMatches(left: string, right: string) {
  return timingSafeEqual(toDigest(left), toDigest(right));
}

function normalizeAttemptState(state: AttemptState, now: number) {
  state.failedAttemptTimes = state.failedAttemptTimes.filter(attemptTime => now - attemptTime < LOGIN_FAILURE_WINDOW_MS);
  if (state.lockedUntil <= now) state.lockedUntil = 0;
  return state;
}

function registerFailure(state: AttemptState, now: number) {
  normalizeAttemptState(state, now);
  state.failedAttemptTimes.push(now);
  if (state.failedAttemptTimes.length >= MAX_FAILURES_PER_WINDOW) state.lockedUntil = now + LOGIN_FAILURE_WINDOW_MS;
  return state.lockedUntil > now;
}

function isTemporarilyLocked(state: AttemptState, now: number) {
  return normalizeAttemptState(state, now).lockedUntil > now;
}

function resetAttemptState(state: AttemptState) {
  state.failedAttemptTimes = [];
  state.lockedUntil = 0;
}

function loginAttemptSubjectHash(scope: "temporary_admin" | "local_manager" | "local_driver", subject: string) {
  return createHash("sha256").update(`${scope}:${subject}`, "utf8").digest("hex");
}

async function isPersistentlyLocked(scope: "temporary_admin" | "local_manager" | "local_driver", subjectHash: string, now: number) {
  const state = await db.getLoginRateLimitState(scope, subjectHash);
  return Boolean(state?.lockedUntil && state.lockedUntil.getTime() > now);
}

async function registerPersistentFailure(scope: "temporary_admin" | "local_manager" | "local_driver", subjectHash: string, now: number) {
  const result = await db.recordLoginRateLimitFailure({
    scope,
    subjectHash,
    now: new Date(now),
    windowMs: LOGIN_FAILURE_WINDOW_MS,
    maxFailures: MAX_FAILURES_PER_WINDOW,
  });
  return result?.locked ?? false;
}

async function clearPersistentFailures(scope: "temporary_admin" | "local_manager" | "local_driver", subjectHash: string) {
  await db.clearLoginRateLimitState(scope, subjectHash);
}

function getLocalManagerAttemptState(username: string) {
  const existing = localManagerAttempts.get(username);
  if (existing) return existing;
  const fresh = { failedAttemptTimes: [], lockedUntil: 0 };
  localManagerAttempts.set(username, fresh);
  return fresh;
}

function loginAuditSummary(action: LoginAuditAction) {
  const summaries: Record<LoginAuditAction, string> = {
    temporary_admin_login_success: "临时超级管理员登录成功",
    temporary_admin_login_failed: "临时超级管理员登录失败",
    temporary_admin_login_locked: "临时超级管理员登录尝试受限",
    temporary_admin_login_disabled: "临时超级管理员入口已被安全收口",
    local_manager_login_success: "普通管理人员本地账号登录成功",
    local_manager_login_failed: "普通管理人员本地账号登录失败",
    local_manager_login_locked: "普通管理人员本地账号登录尝试受限",
    local_manager_password_changed: "普通管理人员本地账号已完成密码更新",
    local_driver_login_success: "司机手机号账号登录成功",
    local_driver_login_failed: "司机手机号账号登录失败",
    local_driver_login_locked: "司机手机号账号登录尝试受限",
    local_driver_password_changed: "司机手机号账号已完成密码更新",
  };
  return summaries[action];
}

/** 审计只记录固定安全事件；用户名、口令、摘要、Cookie 与令牌均不写入日志。 */
async function recordLoginAudit(action: LoginAuditAction, userId: number | null) {
  try {
    const database = await db.getDb();
    if (!database) return;
    await database.insert(auditLogs).values({
      userId,
      module: "security",
      action,
      targetType: "account",
      targetId: userId ? String(userId) : null,
      summary: loginAuditSummary(action),
    });
  } catch {
    // 审计写入异常不得泄露凭据，也不得改变认证失败的对外语义。
  }
}

function ensureTemporaryAdminConfiguration() {
  const username = ENV.tempAdminUsername.trim();
  const password = ENV.tempAdminPassword;
  if (!username || !password) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "临时管理账号尚未配置" });
  return { username, password };
}

/**
 * 生产环境一旦已存在非临时的正式管理员，初始化入口必须默认关闭；避免长期保留可预测的
 * 高权限登录面。仅在受控应急恢复时，服务器管理员才可显式设置 `TEMP_ADMIN_ENABLED=true`
 * 暂时保留该入口；显式 `false` 在任意环境下均关闭。
 */
export function shouldBlockTemporaryAdminLogin(input: {
  isProduction: boolean;
  configuredOverride: string;
  hasPermanentAdministrator: boolean;
}) {
  const override = input.configuredOverride.trim().toLowerCase();
  if (override === "false") return true;
  if (override === "true") return false;
  return input.isProduction && input.hasPermanentAdministrator;
}

/**
 * 普通本地账号统一以中国大陆手机号登录。允许管理员按常见格式输入空格、短横线或国家码，
 * 保存与认证时收敛为 11 位号码，以保持唯一性和内部 openId 的稳定性。
 */
export function normalizeLocalManagerUsername(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  return compact.replace(/^(?:\+86|0086|86)(?=1[3-9]\d{9}$)/, "");
}

export function isValidLocalManagerUsername(value: string) {
  return /^1[3-9]\d{9}$/.test(value);
}

export function createLocalManagerOpenId(localUsername: string) {
  return `${LOCAL_MANAGER_OPEN_ID_PREFIX}${normalizeLocalManagerUsername(localUsername)}`;
}

/** 司机手机号账号与普通管理人员使用独立 OpenID 命名空间，避免手机号相同或后续治理时身份串联。 */
export function createLocalDriverOpenId(localUsername: string) {
  return `${LOCAL_DRIVER_OPEN_ID_PREFIX}${normalizeLocalManagerUsername(localUsername)}`;
}

/** 为普通本地账号生成带随机盐的 scrypt 不可逆口令摘要。 */
export function createLocalManagerPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function verifyLocalManagerPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;
  const [algorithm, salt, encodedDigest] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedDigest) return false;
  try {
    const actualDigest = scryptSync(password, salt, 64);
    const expectedDigest = Buffer.from(encodedDigest, "hex");
    return expectedDigest.length === actualDigest.length && timingSafeEqual(expectedDigest, actualDigest);
  } catch {
    return false;
  }
}

function signInUser(ctx: TrpcContext, openId: string, name: string, expiresInMs: number) {
  return sdk.createSessionToken(openId, { name, expiresInMs }).then(sessionToken => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: expiresInMs });
  });
}

/** 终端策略基于请求 User-Agent 服务端判定；客户端不能通过隐藏按钮绕过策略。 */
function requestTerminal(ctx: TrpcContext) {
  const userAgent = String(ctx.req.headers?.["user-agent"] ?? "");
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent) ? "mobile" as const : "pc" as const;
}

/** 普通本地账号的登录方式限制同时作用于登录和后续受保护接口，避免已有 Cookie 跨端复用。 */
export function assertLocalManagerTerminalAccess(ctx: TrpcContext, user = ctx.user) {
  if (!user || !["local_manager", "local_driver"].includes(user.loginMethod ?? "")) return;
  const terminal = requestTerminal(ctx);
  if (user.loginMethod === "local_driver" && terminal !== "mobile") throw new TRPCError({ code: "FORBIDDEN", message: "司机手机号账号仅允许在手机端登录" });
  if (user.localLoginMode === "pc" && terminal !== "pc") throw new TRPCError({ code: "FORBIDDEN", message: "该账号仅允许在 PC 端登录和办理业务" });
  if (user.localLoginMode === "mobile" && terminal !== "mobile") throw new TRPCError({ code: "FORBIDDEN", message: "该账号仅允许在手机端登录和办理业务" });
}

/** 临时本地登录仅限初始化期间的超级管理员，成功后仍复用既有签名会话与权限守卫。 */
export async function loginTemporaryAdmin(ctx: TrpcContext, input: { username: string; password: string }) {
  const hasPermanentAdministrator = await db.hasPermanentAdministrator();
  if (shouldBlockTemporaryAdminLogin({
    isProduction: ENV.isProduction,
    configuredOverride: ENV.tempAdminEnabled,
    hasPermanentAdministrator,
  })) {
    await recordLoginAudit("temporary_admin_login_disabled", null);
    throw new TRPCError({ code: "FORBIDDEN", message: "临时超级管理员入口已关闭，请使用正式管理员账号登录" });
  }

  const { username: configuredUsername, password: configuredPassword } = ensureTemporaryAdminConfiguration();
  const now = Date.now();
  const subjectHash = loginAttemptSubjectHash("temporary_admin", configuredUsername);
  if (isTemporarilyLocked(temporaryAdminAttempts, now) || await isPersistentlyLocked("temporary_admin", subjectHash, now)) {
    await recordLoginAudit("temporary_admin_login_locked", null);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "登录尝试次数过多，请 15 分钟后再试" });
  }

  if (!safelyMatches(input.username.trim(), configuredUsername) || !safelyMatches(input.password, configuredPassword)) {
    const locked = registerFailure(temporaryAdminAttempts, now) || await registerPersistentFailure("temporary_admin", subjectHash, now);
    await recordLoginAudit(locked ? "temporary_admin_login_locked" : "temporary_admin_login_failed", null);
    throw new TRPCError({ code: locked ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED", message: locked ? "登录尝试次数过多，请 15 分钟后再试" : "账号或密码错误" });
  }

  resetAttemptState(temporaryAdminAttempts);
  await clearPersistentFailures("temporary_admin", subjectHash);
  const signedInAt = new Date();
  await db.upsertUser({ openId: TEMPORARY_ADMIN_OPEN_ID, name: TEMPORARY_ADMIN_NAME, loginMethod: "temporary_local", role: "admin", lastSignedIn: signedInAt });
  const user = await db.getUserByOpenId(TEMPORARY_ADMIN_OPEN_ID);
  if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "临时管理账号初始化失败，请稍后重试" });

  await recordLoginAudit("temporary_admin_login_success", user.id);
  await signInUser(ctx, TEMPORARY_ADMIN_OPEN_ID, TEMPORARY_ADMIN_NAME, TEMPORARY_ADMIN_SESSION_MS);
  return { success: true, expiresInMs: TEMPORARY_ADMIN_SESSION_MS, mustChangePassword: false } as const;
}

/** 普通管理人员仅可使用后台创建、状态为启用且保存了有效摘要的本地账号登录。 */
export async function loginLocalManager(ctx: TrpcContext, input: { username: string; password: string }) {
  const username = normalizeLocalManagerUsername(input.username);
  const now = Date.now();
  const attempts = getLocalManagerAttemptState(username || "unknown");
  const subjectHash = loginAttemptSubjectHash("local_manager", username || "unknown");
  if (isTemporarilyLocked(attempts, now) || await isPersistentlyLocked("local_manager", subjectHash, now)) {
    await recordLoginAudit("local_manager_login_locked", null);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "登录尝试次数过多，请 15 分钟后再试" });
  }

  const user = isValidLocalManagerUsername(username) ? await db.getLocalManagerByUsername(username) : undefined;
  const isDriver = user?.loginMethod === "local_driver";
  const isSupportedLocalAccount = user?.loginMethod === "local_manager" || isDriver;
  const passwordMatches = verifyLocalManagerPassword(input.password, user?.localPasswordHash ?? null);
  if (!user || !isSupportedLocalAccount || user.localAccountStatus !== "active" || !passwordMatches) {
    const failureScope = "local_manager";
    const failureSubjectHash = loginAttemptSubjectHash(failureScope, username || "unknown");
    const locked = registerFailure(attempts, now) || await registerPersistentFailure(failureScope, failureSubjectHash, now);
    await recordLoginAudit(locked ? (isDriver ? "local_driver_login_locked" : "local_manager_login_locked") : (isDriver ? "local_driver_login_failed" : "local_manager_login_failed"), null);
    throw new TRPCError({ code: locked ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED", message: locked ? "登录尝试次数过多，请 15 分钟后再试" : "账号或密码错误" });
  }

  assertLocalManagerTerminalAccess(ctx, user);

  resetAttemptState(attempts);
  await clearPersistentFailures("local_manager", loginAttemptSubjectHash("local_manager", username || "unknown"));
  await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
  await recordLoginAudit(isDriver ? "local_driver_login_success" : "local_manager_login_success", user.id);
  await signInUser(ctx, user.openId, user.name || user.localUsername || (isDriver ? "司机" : "普通管理人员"), LOCAL_MANAGER_SESSION_MS);
  // 本地账号不再强制首次改密；口令仍仅以 scrypt 摘要保存，并保留失败限流与安全审计。
  return { success: true, expiresInMs: LOCAL_MANAGER_SESSION_MS, mustChangePassword: false } as const;
}

/** 改密要求当前受控会话与当前口令同时成立，避免仅凭被窃取的 Cookie 重置普通人员账号。 */
export async function changeLocalManagerPassword(ctx: TrpcContext, input: { currentPassword: string; newPassword: string }) {
  const user = ctx.user;
  if (!user || !["local_manager", "local_driver"].includes(user.loginMethod ?? "") || user.localAccountStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅启用中的手机号本地账号可修改密码" });
  }
  if (!verifyLocalManagerPassword(input.currentPassword, user.localPasswordHash)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "当前密码错误" });
  }
  await db.updateLocalManagerPassword(user.id, createLocalManagerPasswordHash(input.newPassword));
  await recordLoginAudit(user.loginMethod === "local_driver" ? "local_driver_password_changed" : "local_manager_password_changed", user.id);
  return { success: true } as const;
}

/** 仅供 Vitest 在用例之间清理进程内限流状态，生产调用路径不会触发此方法。 */
export function resetTemporaryAdminLoginRateLimitForTests() {
  resetAttemptState(temporaryAdminAttempts);
  localManagerAttempts.clear();
}
