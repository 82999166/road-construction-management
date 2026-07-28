import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
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

/** 仅更新本地普通账号的口令摘要与首次改密标记，避免 OAuth 同步覆盖本地认证字段。 */
export async function updateLocalManagerPassword(userId: number, localPasswordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用");
  await db
    .update(users)
    .set({ localPasswordHash, localPasswordChangeRequired: false })
    .where(and(eq(users.id, userId), eq(users.loginMethod, "local_manager")));
}

// TODO: add feature queries here as your schema grows.
