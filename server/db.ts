import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, ne, or } from "drizzle-orm";
import { InsertUser, loginRateLimitStates, systemRoles, userRoleAssignments, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** 仅供本地普通管理人员登录使用；调用方不得把口令摘要返回到 RPC 响应。 */
export async function getLocalManagerByUsername(localUsername: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get local manager: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(and(eq(users.localUsername, localUsername), eq(users.loginMethod, "local_manager")))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * 临时初始化入口不能长期替代正式管理员。只要已有非临时管理员或有效 SUPER_ADMIN 角色，
 * 生产环境即可默认收口该入口；查询本身不读取口令或将身份字段返回给调用端。
 */
export async function hasPermanentAdministrator() {
  const database = await getDb();
  if (!database) return false;

  const result = await database
    .select({ id: users.id })
    .from(users)
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .leftJoin(systemRoles, eq(systemRoles.id, userRoleAssignments.roleId))
    .where(and(
      ne(users.openId, "local-temporary-super-admin"),
      or(
        eq(users.role, "admin"),
        and(
          eq(userRoleAssignments.status, "active"),
          eq(systemRoles.code, "SUPER_ADMIN"),
          eq(systemRoles.status, "active"),
        ),
      ),
    ))
    .limit(1);
  return result.length > 0;
}

export type PersistedLoginRateLimitState = {
  failureCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

/** 只按不可逆主体摘要读取登录限流状态，调用方不得将摘要返回给客户端。 */
export async function getLoginRateLimitState(scope: string, subjectHash: string): Promise<PersistedLoginRateLimitState | undefined> {
  const database = await getDb();
  if (!database) return undefined;
  const [state] = await database
    .select({
      failureCount: loginRateLimitStates.failureCount,
      windowStartedAt: loginRateLimitStates.windowStartedAt,
      lockedUntil: loginRateLimitStates.lockedUntil,
    })
    .from(loginRateLimitStates)
    .where(and(eq(loginRateLimitStates.scope, scope), eq(loginRateLimitStates.subjectHash, subjectHash)))
    .limit(1);
  return state;
}

/**
 * 写入或刷新持久化失败计数。数据库不可用时返回 undefined，认证层会继续使用进程内保护，
 * 不会因限流存储暂时故障而绕过口令校验或签发会话。
 */
export async function recordLoginRateLimitFailure(input: {
  scope: string;
  subjectHash: string;
  now: Date;
  windowMs: number;
  maxFailures: number;
}) {
  const database = await getDb();
  if (!database) return undefined;

  const existing = await getLoginRateLimitState(input.scope, input.subjectHash);
  const withinWindow = Boolean(existing && input.now.getTime() - existing.windowStartedAt.getTime() < input.windowMs);
  const failureCount = withinWindow ? (existing?.failureCount ?? 0) + 1 : 1;
  const windowStartedAt = withinWindow && existing ? existing.windowStartedAt : input.now;
  const lockedUntil = failureCount >= input.maxFailures ? new Date(input.now.getTime() + input.windowMs) : null;

  await database
    .insert(loginRateLimitStates)
    .values({
      scope: input.scope,
      subjectHash: input.subjectHash,
      failureCount,
      windowStartedAt,
      lastFailureAt: input.now,
      lockedUntil,
    })
    .onDuplicateKeyUpdate({
      set: { failureCount, windowStartedAt, lastFailureAt: input.now, lockedUntil },
    });
  return { locked: Boolean(lockedUntil && lockedUntil.getTime() > input.now.getTime()) };
}

export async function clearLoginRateLimitState(scope: string, subjectHash: string) {
  const database = await getDb();
  if (!database) return;
  await database.delete(loginRateLimitStates).where(and(eq(loginRateLimitStates.scope, scope), eq(loginRateLimitStates.subjectHash, subjectHash)));
}

/** 仅更新本地普通账号的口令摘要；兼容字段统一保持为不强制首次改密，避免 OAuth 同步覆盖本地认证字段。 */
export async function updateLocalManagerPassword(userId: number, localPasswordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用");
  await db
    .update(users)
    .set({ localPasswordHash, localPasswordChangeRequired: false })
    .where(and(eq(users.id, userId), eq(users.loginMethod, "local_manager")));
}

// TODO: add feature queries here as your schema grows.
