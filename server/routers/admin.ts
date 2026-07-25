import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  configPublishLogs,
  organizations,
  positions,
  projects,
  rolePermissions,
  systemPermissions,
  systemRoles,
  systemSettings,
  userRoleAssignments,
} from "../../drizzle/schema";
import { assertSuperAdmin, getSuperAdminAccess, listLoginUsers, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { ensureFoundationData } from "../services/foundationData";
import { decryptSecret, encryptSecret, maskSecret } from "../services/secretVault";
import { protectedProcedure, router } from "../_core/trpc";

/** 后台组织节点输入。父级为空表示顶级节点。 */
const organizationInput = z.object({
  id: z.number().int().positive().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  type: z.enum(["group", "company", "project_department", "department", "team"]),
  managerUserId: z.number().int().positive().nullable().optional(),
  costCenterCode: z.string().trim().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(99999).default(0),
  status: z.enum(["active", "disabled"]).default("active"),
});

const roleInput = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  category: z.enum(["system", "business"]).default("business"),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["active", "disabled"]).default("active"),
});

/** API 密钥、令牌和密码类配置必须使用服务端加密托管，避免被当作普通参数保存。 */
function requiresSecretStorage(settingKey: string) {
  return /(TOKEN|SECRET|API_KEY|APP_KEY|PRIVATE_KEY|PASSWORD|CREDENTIAL|WEBHOOK)/.test(settingKey);
}

/** 只允许测试公开 HTTPS 地址，防止系统设置被误用为内网探测器。 */
function assertSafeIntegrationUrl(rawValue: string) {
  const url = new URL(rawValue);
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (url.protocol !== "https:" || blockedHosts.includes(url.hostname) || /(^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\.)/.test(url.hostname)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "接口测试仅允许公开 HTTPS 地址，禁止内网或本机地址" });
  }
  return url;
}

/** 企业微信机器人只允许官方 webhook 地址，避免配置被误用为任意外部请求或 SSRF 跳板。 */
function assertWecomWebhookUrl(rawValue: string) {
  const url = assertSafeIntegrationUrl(rawValue);
  if (url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== "/cgi-bin/webhook/send" || !url.searchParams.get("key")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "企业微信机器人地址必须为 qyapi.weixin.qq.com/cgi-bin/webhook/send 且包含 key 参数" });
  }
  return url;
}

/** 仅在超级管理员主动点击测试时发送不含业务敏感数据的企业微信连通性消息。 */
async function testWecomWebhook(rawValue: string) {
  const url = assertWecomWebhookUrl(rawValue);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: "【道路施工承包管理系统】企业微信机器人连通性测试。该消息由超级管理员在后台主动发起，不含业务敏感数据。" } }),
      signal: AbortSignal.timeout(6_000),
    });
    let payload: { errcode?: number; errmsg?: string } | null = null;
    try { payload = await response.json() as { errcode?: number; errmsg?: string }; } catch { payload = null; }
    if (response.ok && payload?.errcode === 0) return { success: true, message: "企业微信机器人连通性测试成功", statusCode: response.status };
    return { success: false, message: "企业微信机器人未确认接收测试消息，请检查机器人密钥和群聊状态", statusCode: response.status };
  } catch {
    return { success: false, message: "未能在 6 秒内向企业微信建立安全连接，请检查网络或机器人地址" };
  }
}

/** 发布日志返回给前端前必须删除敏感密文；配置历史同样不得泄露密钥。 */
function sanitizeConfigSnapshot(snapshotJson: string | null) {
  if (!snapshotJson) return null;
  try {
    const snapshot = JSON.parse(snapshotJson) as Record<string, unknown>;
    delete snapshot.secretEncrypted;
    if (snapshot.isSensitive) delete snapshot.valueJson;
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * PC 超级管理后台专用路由。
 * 每个过程先在服务端做超级管理员校验，前端路由限制只是额外体验层。
 */
export const adminRouter = router({
  /** 前端路由守卫的只读权限探测；业务管理接口仍以 assertSuperAdmin 做服务端兜底。 */
  access: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthenticatedUser(ctx);
    const { canAccess } = await getSuperAdminAccess(ctx);
    return { userId: user.id, canAccess };
  }),

  overview: protectedProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return { organizations: 0, projects: 0, roles: 0, settings: 0, messages: 0 };
    await ensureFoundationData(db);
    const [orgRows, projectRows, roleRows, settingRows] = await Promise.all([
      db.select({ id: organizations.id }).from(organizations),
      db.select({ id: projects.id }).from(projects),
      db.select({ id: systemRoles.id }).from(systemRoles),
      db.select({ id: systemSettings.id }).from(systemSettings),
    ]);
    return { organizations: orgRows.length, projects: projectRows.length, roles: roleRows.length, settings: settingRows.length, messages: 0 };
  }),

  organization: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select().from(organizations).orderBy(organizations.sortOrder, organizations.id);
    }),
    save: protectedProcedure.input(organizationInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const values = { ...input, parentId: input.parentId ?? null, managerUserId: input.managerUserId ?? null, costCenterCode: input.costCenterCode ?? null };
      if (input.id) {
        await db.update(organizations).set(values).where(eq(organizations.id, input.id));
      } else {
        await db.insert(organizations).values(values);
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "organization", action: input.id ? "update" : "create", targetType: "organization", targetId: String(input.id ?? input.code), summary: `维护组织节点：${input.name}` });
      return { success: true };
    }),
  }),

  position: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select().from(positions).orderBy(positions.category, positions.code);
    }),
    save: protectedProcedure
      .input(z.object({ id: z.number().int().positive().optional(), code: z.string().min(2).max(64), name: z.string().min(2).max(128), category: z.string().min(2).max(64), description: z.string().max(1000).nullable().optional(), status: z.enum(["active", "disabled"]).default("active") }))
      .mutation(async ({ ctx, input }) => {
        const admin = await assertSuperAdmin(ctx);
        const db = await getDb();
        if (!db) throw new Error("数据库连接暂不可用");
        const values = { ...input, description: input.description ?? null };
        if (input.id) await db.update(positions).set(values).where(eq(positions.id, input.id));
        else await db.insert(positions).values(values);
        await db.insert(auditLogs).values({ userId: admin.id, module: "position", action: input.id ? "update" : "create", targetType: "position", targetId: String(input.id ?? input.code), summary: `维护岗位：${input.name}` });
        return { success: true };
      }),
  }),

  project: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select().from(projects).orderBy(projects.sortOrder, projects.id);
    }),
    save: protectedProcedure
      .input(z.object({ id: z.number().int().positive().optional(), parentId: z.number().int().positive().nullable().optional(), organizationId: z.number().int().positive().nullable().optional(), code: z.string().min(2).max(64), name: z.string().min(2).max(200), nodeType: z.string().min(2).max(64), projectType: z.enum(["highway", "railway", "municipal", "other"]).nullable().optional(), status: z.enum(["planning", "active", "suspended", "completed", "archived"]).default("planning"), startDate: z.string().date().nullable().optional(), endDate: z.string().date().nullable().optional(), costCenterCode: z.string().max(64).nullable().optional(), sortOrder: z.number().int().min(0).default(0) }))
      .mutation(async ({ ctx, input }) => {
        const admin = await assertSuperAdmin(ctx);
        const db = await getDb();
        if (!db) throw new Error("数据库连接暂不可用");
        const values = {
          ...input,
          parentId: input.parentId ?? null,
          organizationId: input.organizationId ?? null,
          projectType: input.projectType ?? null,
          startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
          endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null,
          costCenterCode: input.costCenterCode ?? null,
        };
        if (input.id) await db.update(projects).set(values).where(eq(projects.id, input.id));
        else await db.insert(projects).values(values);
        await db.insert(auditLogs).values({ userId: admin.id, module: "project", action: input.id ? "update" : "create", targetType: "project", targetId: String(input.id ?? input.code), summary: `维护项目节点：${input.name}` });
        return { success: true };
      }),
  }),

  role: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      await ensureFoundationData(db);
      return db.select().from(systemRoles).orderBy(systemRoles.category, systemRoles.code);
    }),
    save: protectedProcedure.input(roleInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const values = { ...input, description: input.description ?? null };
      if (input.id) await db.update(systemRoles).set(values).where(eq(systemRoles.id, input.id));
      else await db.insert(systemRoles).values({ ...values, isSystem: false });
      await db.insert(auditLogs).values({ userId: admin.id, module: "role", action: input.id ? "update" : "create", targetType: "role", targetId: String(input.id ?? input.code), summary: `维护角色：${input.name}` });
      return { success: true };
    }),
    permissions: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      await ensureFoundationData(db);
      return db.select().from(systemPermissions).orderBy(systemPermissions.module, systemPermissions.code);
    }),
    /** 返回某角色已配置的权限标识，供后台权限矩阵编辑器进行回显。 */
    permissionIds: protectedProcedure.input(z.object({ roleId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({ permissionId: rolePermissions.permissionId }).from(rolePermissions).where(eq(rolePermissions.roleId, input.roleId));
      return rows.map(row => row.permissionId);
    }),
    setPermissions: protectedProcedure.input(z.object({ roleId: z.number().int().positive(), permissionIds: z.array(z.number().int().positive()) })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, input.roleId));
      if (input.permissionIds.length > 0) {
        await db.insert(rolePermissions).values(input.permissionIds.map(permissionId => ({ roleId: input.roleId, permissionId })));
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "role", action: "assign_permissions", targetType: "role", targetId: String(input.roleId), summary: "更新角色权限集合" });
      return { success: true };
    }),
  }),

  personnel: router({
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      return listLoginUsers();
    }),
    listAssignments: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select().from(userRoleAssignments).orderBy(desc(userRoleAssignments.createdAt));
    }),
    saveAssignment: protectedProcedure
      .input(z.object({ id: z.number().int().positive().optional(), userId: z.number().int().positive(), roleId: z.number().int().positive(), organizationId: z.number().int().positive().nullable().optional(), projectId: z.number().int().positive().nullable().optional(), validFrom: z.string().datetime().nullable().optional(), validTo: z.string().datetime().nullable().optional(), status: z.enum(["active", "revoked", "expired"]).default("active") }))
      .mutation(async ({ ctx, input }) => {
        const admin = await assertSuperAdmin(ctx);
        const db = await getDb();
        if (!db) throw new Error("数据库连接暂不可用");
        const validFrom = input.validFrom ? new Date(input.validFrom) : null;
        const validTo = input.validTo ? new Date(input.validTo) : null;
        if (validFrom && validTo && validTo <= validFrom) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "授权失效时间必须晚于生效时间" });
        }
        const values = { ...input, organizationId: input.organizationId ?? null, projectId: input.projectId ?? null, validFrom, validTo, grantedBy: admin.id };
        if (input.id) await db.update(userRoleAssignments).set(values).where(eq(userRoleAssignments.id, input.id));
        else await db.insert(userRoleAssignments).values(values);
        await db.insert(auditLogs).values({ userId: admin.id, module: "permission", action: input.id ? "update_assignment" : "grant_role", targetType: "user", targetId: String(input.userId), summary: "维护用户角色与数据范围" });
        return { success: true };
      }),
  }),

  settings: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select({ id: systemSettings.id, category: systemSettings.category, settingKey: systemSettings.settingKey, displayName: systemSettings.displayName, valueJson: systemSettings.valueJson, valuePreview: systemSettings.valuePreview, isSensitive: systemSettings.isSensitive, status: systemSettings.status, version: systemSettings.version, publishedAt: systemSettings.publishedAt, updatedAt: systemSettings.updatedAt, remarks: systemSettings.remarks }).from(systemSettings).orderBy(systemSettings.category, systemSettings.settingKey);
    }),
    saveDraft: protectedProcedure
      .input(z.object({ id: z.number().int().positive().optional(), category: z.string().min(2).max(64), settingKey: z.string().regex(/^[A-Z0-9_:.\-]+$/), displayName: z.string().min(2).max(128), value: z.string().max(50000), isSensitive: z.boolean(), remarks: z.string().max(2000).nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const admin = await assertSuperAdmin(ctx);
        const db = await getDb();
        if (!db) throw new Error("数据库连接暂不可用");
        if (requiresSecretStorage(input.settingKey) && !input.isSensitive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "API 密钥、令牌和密码类配置必须勾选“加密托管”" });
        }
        if (input.settingKey === "WECHAT_WORK_WEBHOOK") assertWecomWebhookUrl(input.value);
        const payload = {
          category: input.category,
          settingKey: input.settingKey,
          displayName: input.displayName,
          valueJson: input.isSensitive ? null : input.value,
          secretEncrypted: input.isSensitive ? encryptSecret(input.value) : null,
          valuePreview: input.isSensitive ? maskSecret(input.value) : input.value.slice(0, 256),
          isSensitive: input.isSensitive,
          status: "draft" as const,
          remarks: input.remarks ?? null,
          updatedBy: admin.id,
        };
        if (input.id) {
          // 保存草稿不改变已发布版本号；版本号仅在显式发布时递增。
          await db.update(systemSettings).set(payload).where(eq(systemSettings.id, input.id));
        } else {
          await db.insert(systemSettings).values(payload);
        }
        await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_draft", targetType: "setting", targetId: input.settingKey, summary: `保存配置草稿：${input.displayName}` });
        return { success: true };
      }),
    publish: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const existing = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (existing.length === 0) throw new Error("配置项不存在");
      const nextVersion = existing[0]!.version + 1;
      await db.update(systemSettings).set({ status: "published", version: nextVersion, publishedAt: new Date(), updatedBy: admin.id }).where(eq(systemSettings.id, input.id));
      // 发布快照仅供服务端回滚使用；敏感密文可在数据库中留存，但不会从任何接口回传。
      const snapshot = {
        category: existing[0]!.category, settingKey: existing[0]!.settingKey, displayName: existing[0]!.displayName,
        valueJson: existing[0]!.valueJson, secretEncrypted: existing[0]!.secretEncrypted, valuePreview: existing[0]!.valuePreview,
        isSensitive: existing[0]!.isSensitive, remarks: existing[0]!.remarks,
      };
      await db.insert(configPublishLogs).values({ settingId: input.id, operation: "publish", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "publish", targetType: "setting", targetId: String(input.id), summary: `发布配置：${existing[0]!.displayName}` });
      return { success: true, version: nextVersion };
    }),
    /** 显式停用配置而不删除密文和版本历史，支持紧急止损与后续可审计恢复。 */
    disable: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "配置项不存在" });
      const nextVersion = existing.version + 1;
      await db.update(systemSettings).set({ status: "disabled", version: nextVersion, updatedBy: admin.id }).where(eq(systemSettings.id, input.id));
      const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
      await db.insert(configPublishLogs).values({ settingId: existing.id, operation: "disable", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "disable", targetType: "setting", targetId: String(existing.id), summary: `停用配置：${existing.displayName}` });
      return { success: true, version: nextVersion };
    }),
    /** 验证密钥是否能在服务端安全解密，或验证公开 HTTPS 连接器的基础可达性。 */
    test: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const setting = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (!setting[0]) throw new TRPCError({ code: "NOT_FOUND", message: "待测试配置不存在" });
      let result: { success: boolean; message: string; statusCode?: number };
      if (setting[0].settingKey === "WECHAT_WORK_WEBHOOK") {
        result = await testWecomWebhook(decryptSecret(setting[0].secretEncrypted || ""));
      } else if (setting[0].isSensitive) {
        decryptSecret(setting[0].secretEncrypted || "");
        result = { success: true, message: "敏感配置加密完整性校验通过" };
      } else if (/(URL|BASE_URL|ENDPOINT)$/.test(setting[0].settingKey)) {
        const url = assertSafeIntegrationUrl(setting[0].valueJson || "");
        try {
          const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(3500) });
          result = { success: response.status < 500, message: response.status < 500 ? "外部地址可连通" : "外部地址返回服务端错误", statusCode: response.status };
        } catch {
          result = { success: false, message: "未能在 3.5 秒内建立安全连接，请检查地址、网络或服务状态" };
        }
      } else {
        result = { success: true, message: "配置格式校验通过；该类型无需发起远程连接" };
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "test", targetType: "setting", targetId: String(input.id), summary: `测试配置：${setting[0].displayName}，${result.message}` });
      return result;
    }),
    history: protectedProcedure.input(z.object({ settingId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const logs = await db.select().from(configPublishLogs).where(eq(configPublishLogs.settingId, input.settingId)).orderBy(desc(configPublishLogs.createdAt)).limit(30);
      // 使用解构彻底移除原始快照字段，避免即使值为 undefined 也被序列化工具或调用方枚举到。
      return logs.map(({ snapshotJson, ...log }) => ({ ...log, snapshot: sanitizeConfigSnapshot(snapshotJson) }));
    }),
    rollback: protectedProcedure.input(z.object({ settingId: z.number().int().positive(), publishLogId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.id, input.settingId)).limit(1);
      const [log] = await db.select().from(configPublishLogs).where(and(eq(configPublishLogs.id, input.publishLogId), eq(configPublishLogs.settingId, input.settingId))).limit(1);
      if (!setting || !log?.snapshotJson) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可回滚的配置版本" });
      let snapshot: Record<string, unknown>;
      try { snapshot = JSON.parse(log.snapshotJson) as Record<string, unknown>; } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "历史配置快照已损坏，无法回滚" }); }
      const requiredKeys = ["category", "settingKey", "displayName", "isSensitive"];
      if (!requiredKeys.every(key => key in snapshot)) throw new TRPCError({ code: "BAD_REQUEST", message: "历史版本不完整，无法安全回滚" });
      const nextVersion = setting.version + 1;
      await db.update(systemSettings).set({
        category: String(snapshot.category), settingKey: String(snapshot.settingKey), displayName: String(snapshot.displayName),
        valueJson: typeof snapshot.valueJson === "string" ? snapshot.valueJson : null,
        secretEncrypted: typeof snapshot.secretEncrypted === "string" ? snapshot.secretEncrypted : null,
        valuePreview: typeof snapshot.valuePreview === "string" ? snapshot.valuePreview : null,
        isSensitive: Boolean(snapshot.isSensitive), remarks: typeof snapshot.remarks === "string" ? snapshot.remarks : null,
        status: "published", version: nextVersion, publishedAt: new Date(), updatedBy: admin.id,
      }).where(eq(systemSettings.id, input.settingId));
      await db.insert(configPublishLogs).values({ settingId: input.settingId, operation: "rollback", version: nextVersion, operatorId: admin.id, snapshotJson: log.snapshotJson });
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "rollback", targetType: "setting", targetId: String(input.settingId), summary: `回滚配置：${setting.displayName} 至历史版本 ${log.version}` });
      return { success: true, version: nextVersion };
    }),
  }),

  audit: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
    }),
  }),
});
