import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, notificationRecords } from "../../drizzle/schema";
import { requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/** 消息深链只能指向站内页面，防止消息内容被用于开放跳转。 */
const deepLinkSchema = z.string().max(512).refine(value => value.startsWith("/") && !value.startsWith("//"), "消息深链必须为站内相对路径");

/**
 * 站内消息中心路由。
 * 收件人条件始终绑定当前登录用户，调用方无法通过参数枚举或修改他人消息。
 */
export const messageRouter = router({
  /** 返回当前用户的近期消息，失败消息也会保留以便业务人员知晓投递异常。 */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: notificationRecords.id,
          eventCode: notificationRecords.eventCode,
          title: notificationRecords.title,
          content: notificationRecords.content,
          deepLink: notificationRecords.deepLink,
          status: notificationRecords.status,
          sentAt: notificationRecords.sentAt,
          readAt: notificationRecords.readAt,
          createdAt: notificationRecords.createdAt,
        })
        .from(notificationRecords)
        .where(eq(notificationRecords.recipientUserId, user.id))
        .orderBy(desc(notificationRecords.createdAt))
        .limit(input.limit);
    }),

  /** 返回当前会话的未读数量，供移动工作台和底部导航显示提醒。 */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthenticatedUser(ctx);
    const db = await getDb();
    if (!db) return { count: 0 };
    const rows = await db
      .select({ id: notificationRecords.id })
      .from(notificationRecords)
      .where(and(eq(notificationRecords.recipientUserId, user.id), ne(notificationRecords.status, "read")));
    return { count: rows.length };
  }),

  /** 只允许当前收件人将自己的消息标记为已读，并保留对应审计事件。 */
  markRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const rows = await db
      .select({ id: notificationRecords.id, status: notificationRecords.status })
      .from(notificationRecords)
      .where(and(eq(notificationRecords.id, input.id), eq(notificationRecords.recipientUserId, user.id)))
      .limit(1);
    const message = rows[0];
    if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在或无权操作" });
    if (message.status !== "read") {
      await db.update(notificationRecords).set({ status: "read", readAt: new Date() }).where(eq(notificationRecords.id, input.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "message", action: "mark_read", targetType: "notification", targetId: String(input.id), summary: "阅读站内业务消息" });
    }
    return { success: true };
  }),
});

/**
 * 写入站内消息的领域服务。
 * 本函数只接收已确定的收件人 ID；任何权限筛选、岗位筛选应由调用方在写入前完成。
 */
export async function createInAppMessage(input: {
  eventCode: string;
  idempotencyKey: string;
  recipientUserId: number;
  title: string;
  content: string;
  deepLink?: string | null;
}) {
  if (!input.eventCode.trim() || !input.idempotencyKey.trim() || !input.title.trim() || !input.content.trim()) {
    throw new Error("消息事件、幂等键、标题和内容不能为空");
  }
  if (input.deepLink) deepLinkSchema.parse(input.deepLink);
  const db = await getDb();
  if (!db) return { created: false, reason: "database_unavailable" as const };
  const existing = await db.select({ id: notificationRecords.id }).from(notificationRecords).where(eq(notificationRecords.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing[0]) return { created: false, reason: "duplicate" as const };
  await db.insert(notificationRecords).values({
    eventCode: input.eventCode.slice(0, 128),
    idempotencyKey: input.idempotencyKey.slice(0, 160),
    recipientUserId: input.recipientUserId,
    title: input.title.slice(0, 200),
    content: input.content,
    deepLink: input.deepLink ?? null,
    status: "sent",
    sentAt: new Date(),
  });
  return { created: true as const };
}
