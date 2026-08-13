import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs,
  notificationRecords,
  officialAccountBindings,
  officialAccountBroadcastDeliveries,
  officialAccountBroadcasts,
  organizations,
  projects,
  systemRoles,
  users,
  userRoleAssignments,
} from "../../drizzle/schema";
import { assertSuperAdmin, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { sendOfficialAccountNotification } from "../services/officialAccountNotifier";

/** 群发范围三选一；范围值由服务端再次核验是否为现有项目、组织或启用岗位。 */
const broadcastAudienceInput = z.discriminatedUnion("audienceType", [
  z.object({ audienceType: z.literal("project"), projectId: z.number().int().positive() }),
  z.object({ audienceType: z.literal("organization"), organizationId: z.number().int().positive() }),
  z.object({ audienceType: z.literal("role"), roleCode: z.string().trim().min(2).max(64) }),
]);

const deepLinkSchema = z.string().trim().max(512).nullable().optional().refine(value => value === null || value === undefined || value === "" || (/^\/(?!\/)/.test(value)), "跳转地址必须以单个 / 开头");
const broadcastContentInput = z.object({
  title: z.string().trim().min(2, "请填写群发标题").max(80),
  content: z.string().trim().min(2, "请填写群发内容").max(1000),
  deepLink: deepLinkSchema,
});
const saveBroadcastInput = z.intersection(z.object({ id: z.number().int().positive().optional() }).merge(broadcastContentInput), broadcastAudienceInput);

type BroadcastAudience = z.infer<typeof broadcastAudienceInput>;
type BroadcastRecipient = { userId: number; name: string; roleSummary: string; scopeSummary: string };
type AudienceResolution = { qualifiedUserIds: number[]; recipientUserIds: number[]; unboundCount: number; recipients: BroadcastRecipient[] };

function createBroadcastNo() {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `BC-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function isActiveInPeriod(validFrom: Date | null, validTo: Date | null, now: Date) {
  return (!validFrom || validFrom <= now) && (!validTo || validTo > now);
}

/**
 * 解析群发的合格人员与已绑定服务号的实际收件人。OpenID 始终留在绑定表密文中，
 * 本函数只返回内部用户 ID，用于后续调用已有的单人模板消息投递服务。
 */
async function resolveBroadcastAudience(audience: BroadcastAudience): Promise<AudienceResolution> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const now = new Date();
  const [roleRows, assignmentRows, projectRows, organizationRows] = await Promise.all([
    db.select({ code: systemRoles.code, status: systemRoles.status }).from(systemRoles),
    db.select({ userId: userRoleAssignments.userId, projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId, validFrom: userRoleAssignments.validFrom, validTo: userRoleAssignments.validTo, assignmentStatus: userRoleAssignments.status, roleCode: systemRoles.code, roleName: systemRoles.name, roleStatus: systemRoles.status })
      .from(userRoleAssignments)
      .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id)),
    db.select({ id: projects.id, code: projects.code, name: projects.name, organizationId: projects.organizationId, status: projects.status }).from(projects),
    db.select({ id: organizations.id, code: organizations.code, name: organizations.name, parentId: organizations.parentId, status: organizations.status }).from(organizations),
  ]);

  const activeAssignments = assignmentRows.filter(item => item.assignmentStatus === "active" && item.roleStatus === "active" && isActiveInPeriod(item.validFrom, item.validTo, now));
  const qualified = new Set<number>();
  if (audience.audienceType === "project") {
    const project = projectRows.find(item => item.id === audience.projectId && item.status === "active");
    if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择启用状态的项目作为群发范围" });
    for (const assignment of activeAssignments) {
      if (assignment.projectId === project.id || (project.organizationId !== null && assignment.organizationId === project.organizationId)) qualified.add(assignment.userId);
    }
  } else if (audience.audienceType === "organization") {
    const organization = organizationRows.find(item => item.id === audience.organizationId && item.status === "active");
    if (!organization) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择启用状态的组织作为群发范围" });
    const descendantIds = new Set<number>([organization.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const item of organizationRows) {
        if (item.status === "active" && item.parentId !== null && descendantIds.has(item.parentId) && !descendantIds.has(item.id)) { descendantIds.add(item.id); changed = true; }
      }
    }
    const projectIds = new Set(projectRows.filter(item => item.status === "active" && item.organizationId !== null && descendantIds.has(item.organizationId)).map(item => item.id));
    for (const assignment of activeAssignments) {
      if ((assignment.organizationId !== null && descendantIds.has(assignment.organizationId)) || (assignment.projectId !== null && projectIds.has(assignment.projectId))) qualified.add(assignment.userId);
    }
  } else {
    if (!roleRows.some(role => role.code === audience.roleCode && role.status === "active")) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择启用状态的岗位作为群发范围" });
    for (const assignment of activeAssignments) if (assignment.roleCode === audience.roleCode) qualified.add(assignment.userId);
  }

  const qualifiedUserIds = Array.from(qualified).sort((left, right) => left - right);
  if (!qualifiedUserIds.length) return { qualifiedUserIds, recipientUserIds: [], unboundCount: 0, recipients: [] };
  const bindings = await db.select({ userId: officialAccountBindings.userId }).from(officialAccountBindings).where(and(inArray(officialAccountBindings.userId, qualifiedUserIds), eq(officialAccountBindings.status, "active")));
  const recipientUserIds = Array.from(new Set(bindings.map(item => item.userId))).sort((left, right) => left - right);
  const userRows = recipientUserIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, recipientUserIds)) : [];
  const userNameById = new Map(userRows.map(item => [item.id, item.name?.trim() || "未命名成员"]));
  const projectNameById = new Map(projectRows.map(item => [item.id, item.name ?? item.code]));
  const organizationNameById = new Map(organizationRows.map(item => [item.id, item.name ?? item.code]));
  const recipients = recipientUserIds.map(userId => {
    const assignments = activeAssignments.filter(item => item.userId === userId);
    const roleSummary = Array.from(new Set(assignments.map(item => item.roleName).filter(Boolean))).join("、") || "未配置岗位";
    const scopeSummary = Array.from(new Set(assignments.map(item => item.projectId ? `项目：${projectNameById.get(item.projectId) ?? "已授权项目"}` : item.organizationId ? `部门：${organizationNameById.get(item.organizationId) ?? "已授权部门"}` : "全局授权"))).join("；") || "授权范围待同步";
    return { userId, name: userNameById.get(userId) ?? "未命名成员", roleSummary: roleSummary.slice(0, 300), scopeSummary: scopeSummary.slice(0, 500) };
  });
  return { qualifiedUserIds, recipientUserIds, unboundCount: qualifiedUserIds.length - recipientUserIds.length, recipients };
}

function toAudience(row: { audienceType: "project" | "organization" | "role"; projectId: number | null; organizationId: number | null; roleCode: string | null }): BroadcastAudience {
  if (row.audienceType === "project" && row.projectId) return { audienceType: "project", projectId: row.projectId };
  if (row.audienceType === "organization" && row.organizationId) return { audienceType: "organization", organizationId: row.organizationId };
  if (row.audienceType === "role" && row.roleCode) return { audienceType: "role", roleCode: row.roleCode };
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "群发范围数据不完整，无法发布" });
}

function toAudienceValues(audience: BroadcastAudience) {
  return { audienceType: audience.audienceType, projectId: audience.audienceType === "project" ? audience.projectId : null, organizationId: audience.audienceType === "organization" ? audience.organizationId : null, roleCode: audience.audienceType === "role" ? audience.roleCode : null };
}

function normalizeDeepLink(value: string | null | undefined) {
  return value?.trim() || null;
}

/** 管理后台专用：服务号群发必须经过草稿、范围预览、提交审批、发布和逐人审计。 */
export const broadcastRouter = router({
  formOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return { projects: [], organizations: [], roles: [] };
    const [projectRows, organizationRows, roleRows] = await Promise.all([
      db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(eq(projects.status, "active")).orderBy(projects.sortOrder, projects.id),
      db.select({ id: organizations.id, name: organizations.name, code: organizations.code, type: organizations.type }).from(organizations).where(eq(organizations.status, "active")).orderBy(organizations.sortOrder, organizations.id),
      db.select({ code: systemRoles.code, name: systemRoles.name }).from(systemRoles).where(eq(systemRoles.status, "active")).orderBy(systemRoles.name),
    ]);
    return { projects: projectRows, organizations: organizationRows, roles: roleRows };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(officialAccountBroadcasts).orderBy(desc(officialAccountBroadcasts.updatedAt), desc(officialAccountBroadcasts.id)).limit(100);
  }),

  getDeliveries: protectedProcedure.input(z.object({ broadcastId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: officialAccountBroadcastDeliveries.id,
      recipientName: sql<string>`COALESCE(NULLIF(${officialAccountBroadcastDeliveries.recipientNameSnapshot}, ''), NULLIF(${users.name}, ''), '未命名成员')`,
      recipientRole: officialAccountBroadcastDeliveries.recipientRoleSnapshot,
      recipientScope: officialAccountBroadcastDeliveries.recipientScopeSnapshot,
      deliveryStatus: officialAccountBroadcastDeliveries.deliveryStatus,
      deliveryReason: officialAccountBroadcastDeliveries.deliveryReason,
      failureCode: notificationRecords.failureCode,
      attemptedAt: officialAccountBroadcastDeliveries.attemptedAt,
      deliveredAt: officialAccountBroadcastDeliveries.deliveredAt,
      acknowledgementStatus: officialAccountBroadcastDeliveries.acknowledgementStatus,
      acknowledgedAt: officialAccountBroadcastDeliveries.acknowledgedAt,
    }).from(officialAccountBroadcastDeliveries)
      .leftJoin(users, eq(users.id, officialAccountBroadcastDeliveries.recipientUserId))
      .leftJoin(notificationRecords, eq(notificationRecords.id, officialAccountBroadcastDeliveries.notificationRecordId))
      .where(eq(officialAccountBroadcastDeliveries.broadcastId, input.broadcastId))
      .orderBy(desc(officialAccountBroadcastDeliveries.updatedAt));
  }),

  previewAudience: protectedProcedure.input(broadcastAudienceInput).query(async ({ ctx, input }) => {
    await assertSuperAdmin(ctx);
    const resolved = await resolveBroadcastAudience(input);
    return { qualifiedCount: resolved.qualifiedUserIds.length, boundRecipientCount: resolved.recipientUserIds.length, unboundCount: resolved.unboundCount };
  }),

  /** 当前收件人只能读取属于自己的、已成功投递且仍待确认的群发通知。 */
  myPendingAcknowledgements: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthenticatedUser(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select({
      deliveryId: officialAccountBroadcastDeliveries.id,
      broadcastId: officialAccountBroadcasts.id,
      title: officialAccountBroadcasts.title,
      content: officialAccountBroadcasts.content,
      deliveredAt: officialAccountBroadcastDeliveries.deliveredAt,
      acknowledgementStatus: officialAccountBroadcastDeliveries.acknowledgementStatus,
    }).from(officialAccountBroadcastDeliveries)
      .innerJoin(officialAccountBroadcasts, eq(officialAccountBroadcasts.id, officialAccountBroadcastDeliveries.broadcastId))
      .where(and(eq(officialAccountBroadcastDeliveries.recipientUserId, user.id), eq(officialAccountBroadcastDeliveries.deliveryStatus, "sent"), eq(officialAccountBroadcastDeliveries.acknowledgementStatus, "pending")))
      .orderBy(desc(officialAccountBroadcastDeliveries.deliveredAt))
      .limit(50);
  }),

  /** “收到/确定”只能由实际收件人主动确认；状态条件更新防止重复确认与跨账号冒认。 */
  acknowledgeReceipt: protectedProcedure.input(z.object({ deliveryId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [delivery] = await db.select({ broadcastId: officialAccountBroadcastDeliveries.broadcastId, deliveryStatus: officialAccountBroadcastDeliveries.deliveryStatus, acknowledgementStatus: officialAccountBroadcastDeliveries.acknowledgementStatus, requiresAcknowledgement: officialAccountBroadcasts.requiresAcknowledgement, title: officialAccountBroadcasts.title })
      .from(officialAccountBroadcastDeliveries)
      .innerJoin(officialAccountBroadcasts, eq(officialAccountBroadcasts.id, officialAccountBroadcastDeliveries.broadcastId))
      .where(and(eq(officialAccountBroadcastDeliveries.id, input.deliveryId), eq(officialAccountBroadcastDeliveries.recipientUserId, user.id)))
      .limit(1);
    if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "未找到属于您的群发通知" });
    if (!delivery.requiresAcknowledgement || delivery.deliveryStatus !== "sent") throw new TRPCError({ code: "CONFLICT", message: "该通知当前无需确认或尚未成功送达" });
    if (delivery.acknowledgementStatus === "acknowledged") return { success: true, alreadyAcknowledged: true };
    const now = new Date();
    await db.transaction(async tx => {
      const updated = await tx.update(officialAccountBroadcastDeliveries).set({ acknowledgementStatus: "acknowledged", acknowledgedAt: now }).where(and(eq(officialAccountBroadcastDeliveries.id, input.deliveryId), eq(officialAccountBroadcastDeliveries.recipientUserId, user.id), eq(officialAccountBroadcastDeliveries.acknowledgementStatus, "pending")));
      const affectedRows = Array.isArray(updated) ? Number((updated[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 1) : 1;
      if (affectedRows === 0) throw new TRPCError({ code: "CONFLICT", message: "该通知已被确认，请刷新后查看" });
      const [countRow] = await tx.select({ count: sql<number>`count(*)` }).from(officialAccountBroadcastDeliveries).where(and(eq(officialAccountBroadcastDeliveries.broadcastId, delivery.broadcastId), eq(officialAccountBroadcastDeliveries.acknowledgementStatus, "acknowledged")));
      await tx.update(officialAccountBroadcasts).set({ acknowledgedCount: Number(countRow?.count ?? 0) }).where(eq(officialAccountBroadcasts.id, delivery.broadcastId));
      await tx.insert(auditLogs).values({ userId: user.id, module: "notification", action: "broadcast_receipt_acknowledged", targetType: "official_account_broadcast_delivery", targetId: String(input.deliveryId), summary: `确认收到群发通知：${delivery.title}`.slice(0, 500) });
    });
    return { success: true, alreadyAcknowledged: false };
  }),

  saveDraft: protectedProcedure.input(saveBroadcastInput).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await resolveBroadcastAudience(input);
    const values = { ...toAudienceValues(input), title: input.title, content: input.content, deepLink: normalizeDeepLink(input.deepLink) };
    let broadcastId = input.id;
    if (input.id) {
      const [existing] = await db.select().from(officialAccountBroadcasts).where(eq(officialAccountBroadcasts.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定群发草稿" });
      if (!["draft", "rejected"].includes(existing.status)) throw new TRPCError({ code: "CONFLICT", message: "已提交审批或已发布的群发单不可直接修改" });
      await db.update(officialAccountBroadcasts).set({ ...values, status: "draft", reviewNote: null, reviewedBy: null, reviewedAt: null }).where(and(eq(officialAccountBroadcasts.id, existing.id), eq(officialAccountBroadcasts.status, existing.status)));
    } else {
      const broadcastNo = createBroadcastNo();
      await db.insert(officialAccountBroadcasts).values({ broadcastNo, ...values, status: "draft", createdBy: user.id });
      const [created] = await db.select({ id: officialAccountBroadcasts.id }).from(officialAccountBroadcasts).where(eq(officialAccountBroadcasts.broadcastNo, broadcastNo)).limit(1);
      broadcastId = created?.id;
    }
    if (!broadcastId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "群发草稿保存失败" });
    await db.insert(auditLogs).values({ userId: user.id, module: "notification", action: input.id ? "update_broadcast_draft" : "create_broadcast_draft", targetType: "official_account_broadcast", targetId: String(broadcastId), summary: `${input.id ? "维护" : "新建"}服务号群发草稿` });
    return { success: true, broadcastId };
  }),

  review: protectedProcedure.input(z.object({ id: z.number().int().positive(), action: z.enum(["submit", "approve", "reject", "cancel"]), reviewNote: z.string().trim().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(officialAccountBroadcasts).where(eq(officialAccountBroadcasts.id, input.id)).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定群发单" });
    const transitions: Record<typeof existing.status, Partial<Record<typeof input.action, typeof existing.status>>> = {
      draft: { submit: "submitted", cancel: "cancelled" }, submitted: { approve: "approved", reject: "rejected", cancel: "cancelled" }, approved: { cancel: "cancelled" }, rejected: { submit: "submitted", cancel: "cancelled" }, publishing: {}, published: {}, partial: {}, failed: {}, cancelled: {},
    };
    const nextStatus = transitions[existing.status][input.action];
    if (!nextStatus) throw new TRPCError({ code: "CONFLICT", message: "当前群发单状态不允许该操作" });
    if (input.action === "reject" && !input.reviewNote?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "退回群发单必须填写修改说明" });
    const patch: Partial<typeof officialAccountBroadcasts.$inferInsert> = { status: nextStatus, reviewNote: input.reviewNote?.trim() || null };
    if (["approve", "reject"].includes(input.action)) { patch.reviewedBy = user.id; patch.reviewedAt = new Date(); }
    const result = await db.update(officialAccountBroadcasts).set(patch).where(and(eq(officialAccountBroadcasts.id, existing.id), eq(officialAccountBroadcasts.status, existing.status)));
    const affectedRows = Array.isArray(result) ? Number((result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 1) : 1;
    if (affectedRows === 0) throw new TRPCError({ code: "CONFLICT", message: "群发单已被其他管理员更新，请刷新后重试" });
    await db.insert(auditLogs).values({ userId: user.id, module: "notification", action: `broadcast_${input.action}`, targetType: "official_account_broadcast", targetId: String(existing.id), summary: `服务号群发单状态变更为：${nextStatus}` });
    return { success: true, status: nextStatus };
  }),

  publish: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [broadcast] = await db.select().from(officialAccountBroadcasts).where(eq(officialAccountBroadcasts.id, input.id)).limit(1);
    if (!broadcast) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定群发单" });
    if (broadcast.status !== "approved") throw new TRPCError({ code: "CONFLICT", message: "仅已审批通过的群发单可发布" });
    const lockingResult = await db.update(officialAccountBroadcasts).set({ status: "publishing", publishedBy: user.id }).where(and(eq(officialAccountBroadcasts.id, broadcast.id), eq(officialAccountBroadcasts.status, "approved")));
    const affectedRows = Array.isArray(lockingResult) ? Number((lockingResult[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 1) : 1;
    if (affectedRows === 0) throw new TRPCError({ code: "CONFLICT", message: "群发单已进入发布流程，请勿重复提交" });

    try {
      const audience = toAudience(broadcast);
      const resolved = await resolveBroadcastAudience(audience);
      const snapshot = JSON.stringify({ audience, qualifiedCount: resolved.qualifiedUserIds.length, boundRecipientCount: resolved.recipientUserIds.length, unboundCount: resolved.unboundCount, recipients: resolved.recipients.map(({ name, roleSummary, scopeSummary }) => ({ name, roleSummary, scopeSummary })), resolvedAt: new Date().toISOString() });
      const results = await Promise.all(resolved.recipients.map(async recipient => {
        const recipientUserId = recipient.userId;
        try {
          const acknowledgementLink = `/mobile/messages?broadcast=${broadcast.id}`;
          const delivery = await sendOfficialAccountNotification({ eventCode: "official_account_broadcast", idempotencyKey: `oa:broadcast:${broadcast.id}:${recipientUserId}`, recipientUserId, title: broadcast.title, content: `${broadcast.content} 请进入系统确认收到。`.slice(0, 1000), deepLink: acknowledgementLink });
          const [notification] = await db.select({ id: notificationRecords.id, failureCode: notificationRecords.failureCode }).from(notificationRecords).where(eq(notificationRecords.idempotencyKey, `oa:broadcast:${broadcast.id}:${recipientUserId}`)).limit(1);
          const status = delivery.delivered ? "sent" : delivery.reason === "not_bound" || delivery.reason === "duplicate" ? "skipped" : "failed";
          const deliveryReason = delivery.delivered ? null : notification?.failureCode ?? delivery.reason;
          const acknowledgementStatus = delivery.delivered && broadcast.requiresAcknowledgement ? "pending" : "not_required" as const;
          await db.insert(officialAccountBroadcastDeliveries).values({ broadcastId: broadcast.id, recipientUserId, recipientNameSnapshot: recipient.name, recipientRoleSnapshot: recipient.roleSummary, recipientScopeSnapshot: recipient.scopeSummary, notificationRecordId: notification?.id ?? null, deliveryStatus: status, deliveryReason, providerMessageId: delivery.providerMessageId ?? null, attemptedAt: new Date(), deliveredAt: delivery.delivered ? new Date() : null, acknowledgementStatus }).onDuplicateKeyUpdate({ set: { recipientNameSnapshot: recipient.name, recipientRoleSnapshot: recipient.roleSummary, recipientScopeSnapshot: recipient.scopeSummary, notificationRecordId: notification?.id ?? null, deliveryStatus: status, deliveryReason, providerMessageId: delivery.providerMessageId ?? null, attemptedAt: new Date(), deliveredAt: delivery.delivered ? new Date() : null, acknowledgementStatus } });
          if (delivery.delivered && broadcast.requiresAcknowledgement) {
            await db.insert(notificationRecords).values({ eventCode: "official_account_broadcast_acknowledgement", idempotencyKey: `inapp:broadcast:${broadcast.id}:${recipientUserId}`, recipientUserId, title: broadcast.title, content: `${broadcast.content} 请点击“确认收到”完成通知回执。`.slice(0, 1000), deepLink: acknowledgementLink, status: "sent", sentAt: new Date(), channel: "in_app" }).onDuplicateKeyUpdate({ set: { title: broadcast.title, content: `${broadcast.content} 请点击“确认收到”完成通知回执。`.slice(0, 1000), deepLink: acknowledgementLink } });
          }
          return status;
        } catch {
          await db.insert(officialAccountBroadcastDeliveries).values({ broadcastId: broadcast.id, recipientUserId, recipientNameSnapshot: recipient.name, recipientRoleSnapshot: recipient.roleSummary, recipientScopeSnapshot: recipient.scopeSummary, deliveryStatus: "failed", deliveryReason: "unexpected_error", attemptedAt: new Date(), acknowledgementStatus: "not_required" }).onDuplicateKeyUpdate({ set: { recipientNameSnapshot: recipient.name, recipientRoleSnapshot: recipient.roleSummary, recipientScopeSnapshot: recipient.scopeSummary, deliveryStatus: "failed", deliveryReason: "unexpected_error", attemptedAt: new Date(), acknowledgementStatus: "not_required" } });
          return "failed" as const;
        }
      }));
      const deliveredCount = results.filter(result => result === "sent").length;
      const failedCount = results.filter(result => result === "failed").length;
      const skippedCount = results.filter(result => result === "skipped").length + resolved.unboundCount;
      const status = failedCount > 0 ? "partial" : "published";
      await db.update(officialAccountBroadcasts).set({ status, publishedAt: new Date(), recipientCount: resolved.recipientUserIds.length, deliveredCount, failedCount, skippedCount, audienceSnapshotJson: snapshot }).where(eq(officialAccountBroadcasts.id, broadcast.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "notification", action: "publish_broadcast", targetType: "official_account_broadcast", targetId: String(broadcast.id), summary: `服务号群发已发布：收件人 ${resolved.recipientUserIds.length}，成功 ${deliveredCount}，失败 ${failedCount}，未绑定 ${resolved.unboundCount}` });
      return { success: true, status, recipientCount: resolved.recipientUserIds.length, deliveredCount, failedCount, skippedCount };
    } catch (error) {
      await db.update(officialAccountBroadcasts).set({ status: "failed", publishedAt: new Date() }).where(eq(officialAccountBroadcasts.id, broadcast.id));
      await db.insert(auditLogs).values({ userId: user.id, module: "notification", action: "broadcast_publish_failed", targetType: "official_account_broadcast", targetId: String(broadcast.id), summary: "服务号群发发布流程失败，未影响其他业务单据" });
      throw error instanceof TRPCError ? error : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "群发发布失败，请查看投递审计后重试" });
    }
  }),
});
