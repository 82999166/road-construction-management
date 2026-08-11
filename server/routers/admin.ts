import { and, count, desc, eq, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  attendanceRecords,
  configPublishLogs,
  constructionDailyReports,
  departmentBusinessScopes,
  evidenceRecords,
  inventoryTransactions,
  laborWorkers,
  machines,
  measurementClaims,
  notificationRecords,
  organizations,
  positions,
  payrollStatements,
  purchaseOrders,
  purchaseRequests,
  projects,
  rolePermissions,
  systemPermissions,
  systemRoles,
  systemSettings,
  transportTrips,
  transportVehicles,
  userProfiles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import { DEPARTMENT_BUSINESS_MODULES } from "../../shared/department";
import { calculateTheoreticalVolume } from "../../shared/domain";
import { evaluateRealDataReadiness } from "../../shared/realDataReadiness";
import { assertSuperAdmin, getSuperAdminAccess, listLoginUsers, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { createBusinessDataBackup, getBusinessDataBackupDownload, getBusinessModuleStatistics, listBusinessDataBackups } from "../services/adminBusinessBackup";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { ensureFoundationData } from "../services/foundationData";
import { inspectPublishedOfficialAccountTemplateCapability, testPublishedOfficialAccountConfiguration } from "../services/officialAccountNotifier";
import { decryptSecret, encryptSecret, maskSecret } from "../services/secretVault";
import { IDENTITY_PROVIDER_RECOVERY_URL_KEY, normalizeIdentityRecoveryUrl } from "../identityRecovery";
import { createLocalManagerOpenId, createLocalManagerPasswordHash, isValidLocalManagerUsername, normalizeLocalManagerUsername } from "../localAuth";
import { protectedProcedure, router } from "../_core/trpc";
import { createInAppMessage } from "./messages";

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

/** 超级管理后台维护的车辆主数据；尺寸和装载系数仍是运输趟次理论方量计算的权威输入。 */
const vehicleManagementInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable().optional(),
  plateNo: z.string().trim().min(4, "请填写车牌号").max(32).transform(value => value.toUpperCase()),
  vehicleType: z.enum(["dump_truck", "tractor", "mixer", "flatbed", "other"]),
  ownerName: z.string().trim().max(128).nullable().optional(),
  driverUserId: z.number().int().positive().nullable().optional(),
  boxLengthMeters: z.number().gt(0).max(100),
  boxWidthMeters: z.number().gt(0).max(20),
  boxHeightMeters: z.number().gt(0).max(20),
  loadFactor: z.number().gt(0).max(1.5).default(1),
  payloadTons: z.number().gt(0).max(9999).nullable().optional(),
  status: z.enum(["active", "suspended", "disabled"]),
});

const roleInput = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(128),
  category: z.enum(["system", "business"]).default("business"),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["active", "disabled"]).default("active"),
});

/** 部门业务范围配置仅允许使用系统定义的业务模块编码。 */
const departmentBusinessScopeInput = z.object({
  organizationId: z.number().int().positive(),
  module: z.enum(["CONSTRUCTION", "LABOR", "MACHINERY", "TRANSPORT", "PURCHASING", "MEASUREMENT", "FINANCE", "EVIDENCE"]),
  status: z.enum(["active", "disabled"]).default("active"),
});

/** 超级管理员只能创建普通本地账号，初始密码仅在本次请求中用于生成不可逆摘要。 */
const localManagerAccountInput = z.object({
  username: z.string().trim().min(3).max(48),
  displayName: z.string().trim().min(2).max(128),
  initialPassword: z.string().min(6, "初始密码至少 6 位").max(128),
  status: z.enum(["active", "disabled"]).default("active"),
});

const localManagerStatusInput = z.object({
  userId: z.number().int().positive(),
  status: z.enum(["active", "disabled"]),
});

/** 编辑账号资料时仅允许维护本地登录标识、展示资料和状态，角色与数据范围仍须通过独立授权流程配置。 */
const localManagerAccountUpdateInput = z.object({
  userId: z.number().int().positive(),
  username: z.string().trim().min(3).max(48),
  displayName: z.string().trim().min(2).max(128),
  status: z.enum(["active", "disabled"]),
});

/** 管理员重置密码不校验旧密码，但口令只在本次请求内生成不可逆摘要。 */
const localManagerPasswordResetInput = z.object({
  userId: z.number().int().positive(),
  newPassword: z.string().min(6, "新密码至少 6 位").max(128),
});

const localManagerDeleteInput = z.object({ userId: z.number().int().positive() });

/** 删除配置必须携带当前版本，防止管理员基于旧页面误删已被他人修订的配置。 */
const settingDeleteInput = z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().positive() });

/** 后台主数据删除统一走受控入口；角色授权仅撤销，不物理删除可追溯历史。 */
const masterDataRemoveInput = z.object({
  resource: z.enum(["organization", "position", "project", "vehicle", "role", "department_scope", "role_assignment"]),
  id: z.number().int().positive(),
});

/** 全业务治理统计仅支持已校验的项目和自然月筛选，避免模糊日期或越权项目参数进入聚合查询。 */
const businessStatisticsInput = z.object({
  projectId: z.number().int().positive().optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "统计期间须为 YYYY-MM").optional(),
}).optional();

/** API 密钥、令牌和密码类配置必须使用服务端加密托管，避免被当作普通参数保存。 */
function requiresSecretStorage(settingKey: string) {
  return /(TOKEN|SECRET|API_KEY|APP_KEY|PRIVATE_KEY|PASSWORD|CREDENTIAL|WEBHOOK)/.test(settingKey);
}

const OFFICIAL_ACCOUNT_APP_SECRET_KEY = "WECHAT_OFFICIAL_APP_SECRET";
const OFFICIAL_ACCOUNT_PUBLIC_SETTING_KEYS = new Set([
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_TEMPLATE_ID",
  "WECHAT_OFFICIAL_TEMPLATE_FIELDS",
  "WECHAT_OFFICIAL_APP_URL",
]);
const RETIRED_NOTIFICATION_SETTING_KEYS = new Set(["WECHAT_WORK_WEBHOOK"]);

/** 用户已确认系统统一使用认证服务号，禁止旧企业微信机器人配置重新进入任何可生效流程。 */
function assertSupportedSettingKey(settingKey: string) {
  if (RETIRED_NOTIFICATION_SETTING_KEYS.has(settingKey)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "企业微信 Webhook 通道已退役，系统通知仅支持认证服务号" });
  }
}

/**
 * 认证服务号配置在数据库中与其他系统设置共用版本治理，但字段敏感级别必须固定：
 * AppSecret 只允许密文托管，其余四项为发布后的受控公开参数，避免因误标敏感导致运行时无法读取。
 */
function assertOfficialAccountSettingContract(input: { settingKey: string; value: string; isSensitive: boolean }) {
  if (input.settingKey === OFFICIAL_ACCOUNT_APP_SECRET_KEY && !input.isSensitive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "认证服务号 AppSecret 必须使用加密托管" });
  }
  if (OFFICIAL_ACCOUNT_PUBLIC_SETTING_KEYS.has(input.settingKey) && input.isSensitive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "认证服务号 AppID、模板和跳转地址必须作为受控公开参数保存，不得标记为密钥" });
  }
  if (input.settingKey === "WECHAT_OFFICIAL_APP_URL" && input.value.trim()) {
    try {
      assertSafeIntegrationUrl(input.value.trim());
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "公众号业务跳转地址必须是公开 HTTPS 地址，且不得指向内网或本机" });
    }
  }
  if (input.settingKey === "WECHAT_OFFICIAL_TEMPLATE_FIELDS" && input.value.trim()) {
    try {
      const templateFields = JSON.parse(input.value) as unknown;
      if (!templateFields || Array.isArray(templateFields) || typeof templateFields !== "object") throw new Error("not-object");
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "公众号模板字段映射必须为 JSON 对象" });
    }
  }
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
 * 配置被删除后，历史记录仅保留版本治理所需的对象标识；不再保留配置值、密文或可恢复预览。
 * 审计索引独立保留“谁、何时、删除了哪个配置”，兼顾可追溯性与敏感信息最小化。
 */
function redactDeletedConfigSnapshot(snapshotJson: string | null) {
  if (!snapshotJson) return null;
  try {
    const snapshot = JSON.parse(snapshotJson) as Record<string, unknown>;
    delete snapshot.valueJson;
    delete snapshot.secretEncrypted;
    snapshot.valuePreview = "[已删除]";
    return JSON.stringify(snapshot);
  } catch {
    return null;
  }
}

/**
 * 安全类通知不得阻断已经完成的权限或配置写入。
 * 调用方仅传递角色、用户、配置等最小化业务标识，通知服务自身负责记录投递结果审计。
 */
function dispatchOfficialAccountSecurityNotification(event: Parameters<typeof notifyOfficialAccountBusinessEventSafely>[0]) {
  void notifyOfficialAccountBusinessEventSafely(event).catch(() => undefined);
}

/** 站内安全提醒采用幂等键，投递故障只留待后续重试，不允许回滚既有授权和配置操作。 */
function dispatchInAppSecurityNotification(input: Parameters<typeof createInAppMessage>[0]) {
  void createInAppMessage(input).catch(() => undefined);
}

/**
 * 配置版本既是已发布版本的展示编号，也是后台治理操作的乐观锁令牌。
 * 草稿、发布、停用和回滚都会递增版本，避免两个管理员基于同一旧版本互相覆盖。
 */
function assertExpectedSettingVersion(actualVersion: number, expectedVersion: number) {
  if (actualVersion !== expectedVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "配置已被其他管理员更新，请刷新后基于最新版本再次操作" });
  }
}

/** MySQL 驱动会返回受影响行数；0 行意味着条件版本锁未命中，必须停止后续审计与发布日志写入。 */
function assertVersionedSettingWrite(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "配置版本已变化，未执行覆盖写入，请刷新后重试" });
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
      if (input.id && input.parentId === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "组织节点不能选择自身作为上级节点" });
      }
      if (input.parentId) {
        const [parent] = await db.select({ id: organizations.id, parentId: organizations.parentId, status: organizations.status }).from(organizations).where(eq(organizations.id, input.parentId)).limit(1);
        if (!parent || parent.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "上级组织必须是已启用的有效节点" });
        }
        const visited = new Set<number>([parent.id]);
        let ancestorId = parent.parentId;
        while (ancestorId) {
          if (input.id && ancestorId === input.id) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "组织层级不能形成循环引用" });
          }
          if (visited.has(ancestorId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "上级组织层级存在循环引用，请先修正历史数据" });
          }
          visited.add(ancestorId);
          const [ancestor] = await db.select({ id: organizations.id, parentId: organizations.parentId, status: organizations.status }).from(organizations).where(eq(organizations.id, ancestorId)).limit(1);
          if (!ancestor || ancestor.status !== "active") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "上级组织层级包含无效或已停用节点" });
          }
          ancestorId = ancestor.parentId;
        }
      }
      if (input.managerUserId) {
        const [manager] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.managerUserId)).limit(1);
        if (!manager) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已存在的组织负责人账号" });
      }
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

  /** 部门业务范围由超级管理员统一配置，普通人员不能通过客户端自行增加业务入口。 */
  department: router({
    listScopes: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({ id: departmentBusinessScopes.id, organizationId: organizations.id, organizationCode: organizations.code, organizationName: organizations.name, organizationType: organizations.type, module: departmentBusinessScopes.module, status: departmentBusinessScopes.status, updatedAt: departmentBusinessScopes.updatedAt })
        .from(departmentBusinessScopes)
        .innerJoin(organizations, eq(departmentBusinessScopes.organizationId, organizations.id))
        .orderBy(organizations.sortOrder, organizations.id, departmentBusinessScopes.module);
      return rows.filter(row => row.organizationType === "department" || row.organizationType === "project_department");
    }),
    saveScope: protectedProcedure.input(departmentBusinessScopeInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [department] = await db.select({ id: organizations.id, type: organizations.type }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
      if (!department || (department.type !== "department" && department.type !== "project_department")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的部门或项目部节点配置业务范围" });
      }
      const currentScopes = await db.select({ id: departmentBusinessScopes.id, module: departmentBusinessScopes.module }).from(departmentBusinessScopes).where(eq(departmentBusinessScopes.organizationId, input.organizationId));
      const existing = currentScopes.find(item => item.module === input.module);
      if (existing) {
        await db.update(departmentBusinessScopes).set({ status: input.status, configuredBy: admin.id }).where(eq(departmentBusinessScopes.id, existing.id));
      } else {
        await db.insert(departmentBusinessScopes).values({ ...input, configuredBy: admin.id });
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "department", action: input.status === "active" ? "enable_business_scope" : "disable_business_scope", targetType: "department_business_scope", targetId: `${input.organizationId}:${input.module}`, summary: `维护部门业务范围：${input.module}` });
      return { success: true };
    }),
    /** 将模块目录由服务端统一返回，确保管理端不依赖硬编码选项。 */
    modules: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      return DEPARTMENT_BUSINESS_MODULES;
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
        if (input.id && input.parentId === input.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "项目节点不能选择自身作为上级节点" });
        }
        if (input.parentId) {
          const [parent] = await db.select({ id: projects.id, parentId: projects.parentId, status: projects.status }).from(projects).where(eq(projects.id, input.parentId)).limit(1);
          if (!parent || parent.status === "archived") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "上级项目必须是未归档的有效节点" });
          }
          const visited = new Set<number>([parent.id]);
          let ancestorId = parent.parentId;
          while (ancestorId) {
            if (input.id && ancestorId === input.id) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "项目层级不能形成循环引用" });
            }
            if (visited.has(ancestorId)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "上级项目层级存在循环引用，请先修正历史数据" });
            }
            visited.add(ancestorId);
            const [ancestor] = await db.select({ id: projects.id, parentId: projects.parentId, status: projects.status }).from(projects).where(eq(projects.id, ancestorId)).limit(1);
            if (!ancestor || ancestor.status === "archived") {
              throw new TRPCError({ code: "BAD_REQUEST", message: "上级项目层级包含无效或已归档节点" });
            }
            ancestorId = ancestor.parentId;
          }
        }
        if (input.organizationId) {
          const [organization] = await db.select({ id: organizations.id, status: organizations.status }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
          if (!organization || organization.status !== "active") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "项目归属组织必须是已启用的有效节点" });
          }
        }
        if (input.startDate && input.endDate && input.endDate < input.startDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "项目结束日期不得早于开始日期" });
        }
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

  vehicle: router({
    /** 超级管理员从唯一的运输车辆台账读取全局资源，理论方量始终由货厢参数实时计算。 */
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(transportVehicles).orderBy(desc(transportVehicles.updatedAt));
      return rows.map(vehicle => ({
        ...vehicle,
        theoreticalVolumeCubicMeters: calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)),
      }));
    }),
    save: protectedProcedure.input(vehicleManagementInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

      const [project] = await db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (!project || project.status === "archived") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "车辆必须归属未归档的有效项目节点" });
      }
      if (input.organizationId) {
        const [organization] = await db.select({ id: organizations.id, status: organizations.status }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
        if (!organization || organization.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "车辆所属单位必须是已启用的组织节点" });
        }
      }
      if (input.driverUserId) {
        const [driver] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.driverUserId)).limit(1);
        if (!driver) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已存在的司机账号" });
      }
      const plateMatches = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(eq(transportVehicles.plateNo, input.plateNo));
      if (plateMatches.some(vehicle => vehicle.id !== input.id)) {
        throw new TRPCError({ code: "CONFLICT", message: "该车牌已存在，不能重复建档" });
      }

      let existing: typeof transportVehicles.$inferSelect | undefined;
      if (input.id) {
        [existing] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "运输车辆不存在" });
        if (input.status === "disabled" && existing.status !== "disabled") {
          const openTrips = await db.select({ id: transportTrips.id, status: transportTrips.status }).from(transportTrips).where(eq(transportTrips.vehicleId, input.id));
          if (openTrips.some(trip => ["draft", "submitted", "verified"].includes(trip.status))) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "车辆存在未结算趟次，不能直接停用；请先完成或作废相关趟次" });
          }
        }
      }

      const values = {
        projectId: input.projectId,
        organizationId: input.organizationId ?? null,
        plateNo: input.plateNo,
        vehicleType: input.vehicleType,
        ownerName: input.ownerName ?? null,
        driverUserId: input.driverUserId ?? null,
        boxLengthMeters: String(input.boxLengthMeters),
        boxWidthMeters: String(input.boxWidthMeters),
        boxHeightMeters: String(input.boxHeightMeters),
        loadFactor: String(input.loadFactor),
        payloadTons: input.payloadTons === null || input.payloadTons === undefined ? null : String(input.payloadTons),
        status: input.status,
      };
      if (existing) await db.update(transportVehicles).set(values).where(eq(transportVehicles.id, existing.id));
      else await db.insert(transportVehicles).values(values);
      await db.insert(auditLogs).values({
        userId: admin.id,
        module: "transport",
        action: input.id ? "admin_update_vehicle" : "admin_create_vehicle",
        targetType: "transport_vehicle",
        targetId: String(input.id ?? input.plateNo),
        summary: `${input.id ? "维护" : "新建"}车辆台账：${input.plateNo}`,
      });
      return {
        success: true,
        theoreticalVolumeCubicMeters: calculateTheoreticalVolume(input.boxLengthMeters, input.boxWidthMeters, input.boxHeightMeters, input.loadFactor),
      };
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
      dispatchOfficialAccountSecurityNotification({
        userId: admin.id,
        module: "security",
        eventCode: "role_permissions_updated",
        targetType: "role",
        targetId: String(input.roleId),
        title: "角色权限集合已更新",
        deepLink: "/admin/permission",
      });
      return { success: true };
    }),
  }),

  /**
   * 所有配置型主数据统一从此入口删除。任何仍被组织层级、人员、授权或业务单据引用的对象均不可物理删除，
   * 管理员应改为停用或归档；角色授权仅撤销以确保历史责任可追溯。
   */
  masterData: router({
    remove: protectedProcedure.input(masterDataRemoveInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");

      if (input.resource === "organization") {
        const [existing] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "组织节点不存在或已删除" });
        const dependencies = await Promise.all([
          db.select({ id: organizations.id }).from(organizations).where(eq(organizations.parentId, input.id)).limit(1),
          db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, input.id)).limit(1),
          db.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.organizationId, input.id)).limit(1),
          db.select({ id: transportVehicles.id }).from(transportVehicles).where(eq(transportVehicles.organizationId, input.id)).limit(1),
          db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(eq(userRoleAssignments.organizationId, input.id)).limit(1),
          db.select({ id: departmentBusinessScopes.id }).from(departmentBusinessScopes).where(eq(departmentBusinessScopes.organizationId, input.id)).limit(1),
        ]);
        if (dependencies.some(rows => rows.length > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "该组织仍被下级节点、项目、人员、车辆、授权或部门业务范围引用，不能删除；请先迁移关联数据或将其停用" });
        await db.delete(organizations).where(eq(organizations.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "organization", action: "delete", targetType: "organization", targetId: String(input.id), summary: `删除未被引用的组织节点：${existing.name}` });
        return { success: true, operation: "deleted" as const };
      }

      if (input.resource === "position") {
        const [existing] = await db.select({ id: positions.id, name: positions.name }).from(positions).where(eq(positions.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "岗位不存在或已删除" });
        const profiles = await db.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.positionId, input.id)).limit(1);
        if (profiles.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该岗位仍被人员档案引用，不能删除；请先调整人员岗位或将岗位停用" });
        await db.delete(positions).where(eq(positions.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "position", action: "delete", targetType: "position", targetId: String(input.id), summary: `删除未被引用的岗位：${existing.name}` });
        return { success: true, operation: "deleted" as const };
      }

      if (input.resource === "project") {
        const [existing] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "项目节点不存在或已删除" });
        const dependencies = await Promise.all([
          db.select({ id: projects.id }).from(projects).where(eq(projects.parentId, input.id)).limit(1),
          db.select({ id: transportVehicles.id }).from(transportVehicles).where(eq(transportVehicles.projectId, input.id)).limit(1),
          db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(eq(userRoleAssignments.projectId, input.id)).limit(1),
          db.select({ id: constructionDailyReports.id }).from(constructionDailyReports).where(eq(constructionDailyReports.projectId, input.id)).limit(1),
          db.select({ id: transportTrips.id }).from(transportTrips).where(eq(transportTrips.projectId, input.id)).limit(1),
          db.select({ id: laborWorkers.id }).from(laborWorkers).where(eq(laborWorkers.projectId, input.id)).limit(1),
          db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(eq(attendanceRecords.projectId, input.id)).limit(1),
          db.select({ id: payrollStatements.id }).from(payrollStatements).where(eq(payrollStatements.projectId, input.id)).limit(1),
          db.select({ id: purchaseRequests.id }).from(purchaseRequests).where(eq(purchaseRequests.projectId, input.id)).limit(1),
          db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.projectId, input.id)).limit(1),
          db.select({ id: measurementClaims.id }).from(measurementClaims).where(eq(measurementClaims.projectId, input.id)).limit(1),
          db.select({ id: inventoryTransactions.id }).from(inventoryTransactions).where(eq(inventoryTransactions.projectId, input.id)).limit(1),
          db.select({ id: evidenceRecords.id }).from(evidenceRecords).where(eq(evidenceRecords.projectId, input.id)).limit(1),
          db.select({ id: machines.id }).from(machines).where(eq(machines.projectId, input.id)).limit(1),
        ]);
        if (dependencies.some(rows => rows.length > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "该项目仍被下级项目、授权、资源或业务单据引用，不能删除；请先归档或迁移关联数据" });
        await db.delete(projects).where(eq(projects.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "project", action: "delete", targetType: "project", targetId: String(input.id), summary: `删除未被引用的项目节点：${existing.name}` });
        return { success: true, operation: "deleted" as const };
      }

      if (input.resource === "vehicle") {
        const [existing] = await db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "车辆不存在或已删除" });
        const trips = await db.select({ id: transportTrips.id }).from(transportTrips).where(eq(transportTrips.vehicleId, input.id)).limit(1);
        if (trips.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆已有运输趟次记录，不能删除；请改为停用以保留运输责任链" });
        await db.delete(transportVehicles).where(eq(transportVehicles.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "transport", action: "delete_vehicle", targetType: "transport_vehicle", targetId: String(input.id), summary: `删除未被引用的车辆台账：${existing.plateNo}` });
        return { success: true, operation: "deleted" as const };
      }

      if (input.resource === "role") {
        const [existing] = await db.select({ id: systemRoles.id, name: systemRoles.name, isSystem: systemRoles.isSystem }).from(systemRoles).where(eq(systemRoles.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在或已删除" });
        if (existing.isSystem) throw new TRPCError({ code: "FORBIDDEN", message: "系统内置角色不可删除；如需停止使用，请在角色维护中停用" });
        const assignments = await db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(eq(userRoleAssignments.roleId, input.id)).limit(1);
        if (assignments.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该角色已有授权历史，不能删除；请停用角色并撤销现有授权" });
        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, input.id));
        await db.delete(systemRoles).where(eq(systemRoles.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "role", action: "delete", targetType: "role", targetId: String(input.id), summary: `删除未被授权的自定义角色：${existing.name}` });
        return { success: true, operation: "deleted" as const };
      }

      if (input.resource === "department_scope") {
        const [existing] = await db.select({ id: departmentBusinessScopes.id, organizationId: departmentBusinessScopes.organizationId, module: departmentBusinessScopes.module }).from(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "部门业务范围不存在或已删除" });
        await db.delete(departmentBusinessScopes).where(eq(departmentBusinessScopes.id, input.id));
        await db.insert(auditLogs).values({ userId: admin.id, module: "department", action: "delete_business_scope", targetType: "department_business_scope", targetId: `${existing.organizationId}:${existing.module}`, summary: `删除部门业务范围：${existing.module}` });
        return { success: true, operation: "deleted" as const };
      }

      const [existing] = await db.select({ id: userRoleAssignments.id, userId: userRoleAssignments.userId, roleId: userRoleAssignments.roleId, status: userRoleAssignments.status }).from(userRoleAssignments).where(eq(userRoleAssignments.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "角色授权不存在或已撤销" });
      if (existing.status !== "revoked") await db.update(userRoleAssignments).set({ status: "revoked", grantedBy: admin.id }).where(eq(userRoleAssignments.id, input.id));
      await db.insert(auditLogs).values({ userId: admin.id, module: "permission", action: "revoke_assignment", targetType: "user_role_assignment", targetId: String(existing.id), summary: `撤销用户 #${existing.userId} 的角色授权 #${existing.roleId}` });
      return { success: true, operation: "revoked" as const };
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
    createLocalUser: protectedProcedure.input(localManagerAccountInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const localUsername = normalizeLocalManagerUsername(input.username);
      if (!isValidLocalManagerUsername(localUsername)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "账号须以字母开头，只能包含小写字母、数字、点、下划线或连字符，长度为 3—48 位" });
      }
      const existing = await database.select({ id: users.id }).from(users).where(eq(users.localUsername, localUsername)).limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "该本地账号已存在" });

      await database.insert(users).values({
        openId: createLocalManagerOpenId(localUsername),
        name: input.displayName,
        loginMethod: "local_manager",
        role: "user",
        localUsername,
        localPasswordHash: createLocalManagerPasswordHash(input.initialPassword),
        localAccountStatus: input.status,
        localPasswordChangeRequired: false,
        lastSignedIn: new Date(),
      });
      const [createdUser] = await database.select({ id: users.id }).from(users).where(eq(users.localUsername, localUsername)).limit(1);
      if (!createdUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "普通管理人员账号创建失败，请稍后重试" });

      await database.insert(userProfiles).values({
        userId: createdUser.id,
        status: input.status === "active" ? "pending" : "disabled",
      });
      await database.insert(auditLogs).values({
        userId: admin.id,
        module: "permission",
        action: "create_local_manager_account",
        targetType: "user",
        targetId: String(createdUser.id),
        summary: `创建普通管理人员本地账号：${input.displayName}`,
      });
      return { success: true, userId: createdUser.id };
    }),
    setLocalUserStatus: protectedProcedure.input(localManagerStatusInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const [target] = await database.select({ id: users.id, name: users.name, loginMethod: users.loginMethod }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.loginMethod !== "local_manager") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅可启用或停用由后台创建的普通本地账号" });
      }
      await database.update(users).set({ localAccountStatus: input.status }).where(eq(users.id, target.id));
      await database.update(userProfiles).set({ status: input.status === "active" ? "pending" : "disabled" }).where(eq(userProfiles.userId, target.id));
      await database.insert(auditLogs).values({
        userId: admin.id,
        module: "permission",
        action: input.status === "active" ? "enable_local_manager_account" : "disable_local_manager_account",
        targetType: "user",
        targetId: String(target.id),
        summary: `${input.status === "active" ? "启用" : "停用"}普通管理人员本地账号：${target.name || `用户 #${target.id}`}`,
      });
      return { success: true };
    }),
    updateLocalUser: protectedProcedure.input(localManagerAccountUpdateInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const localUsername = normalizeLocalManagerUsername(input.username);
      if (!isValidLocalManagerUsername(localUsername)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "账号须以字母开头，只能包含小写字母、数字、点、下划线或连字符，长度为 3—48 位" });
      }
      const [target] = await database.select({ id: users.id, name: users.name, localAccountStatus: users.localAccountStatus, loginMethod: users.loginMethod }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.loginMethod !== "local_manager") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅可编辑由后台创建的普通本地账号" });
      }
      const [usernameOwner] = await database.select({ id: users.id }).from(users).where(eq(users.localUsername, localUsername)).limit(1);
      if (usernameOwner && usernameOwner.id !== target.id) {
        throw new TRPCError({ code: "CONFLICT", message: "该本地账号已存在" });
      }
      const [profile] = await database.select({ id: userProfiles.id, status: userProfiles.status }).from(userProfiles).where(eq(userProfiles.userId, target.id)).limit(1);
      const profileStatus = input.status === "disabled" ? "disabled" : target.localAccountStatus === "disabled" ? "pending" : profile?.status ?? "pending";
      await database.update(users).set({
        openId: createLocalManagerOpenId(localUsername),
        localUsername,
        name: input.displayName,
        localAccountStatus: input.status,
      }).where(and(eq(users.id, target.id), eq(users.loginMethod, "local_manager")));
      if (profile) {
        await database.update(userProfiles).set({ status: profileStatus }).where(eq(userProfiles.id, profile.id));
      } else {
        await database.insert(userProfiles).values({ userId: target.id, status: profileStatus });
      }
      await database.insert(auditLogs).values({
        userId: admin.id,
        module: "permission",
        action: "update_local_manager_account",
        targetType: "user",
        targetId: String(target.id),
        summary: `编辑普通管理人员本地账号：${input.displayName}`,
      });
      return { success: true };
    }),
    resetLocalUserPassword: protectedProcedure.input(localManagerPasswordResetInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const [target] = await database.select({ id: users.id, name: users.name, loginMethod: users.loginMethod }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.loginMethod !== "local_manager") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅可重置由后台创建的普通本地账号密码" });
      }
      await database.update(users).set({ localPasswordHash: createLocalManagerPasswordHash(input.newPassword), localPasswordChangeRequired: false }).where(and(eq(users.id, target.id), eq(users.loginMethod, "local_manager")));
      await database.insert(auditLogs).values({
        userId: admin.id,
        module: "security",
        action: "reset_local_manager_password",
        targetType: "user",
        targetId: String(target.id),
        summary: `重置普通管理人员账号密码：${target.name || `用户 #${target.id}`}`,
      });
      return { success: true };
    }),
    deleteLocalUser: protectedProcedure.input(localManagerDeleteInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const [target] = await database.select({ id: users.id, name: users.name, loginMethod: users.loginMethod }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.loginMethod !== "local_manager") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅可删除由后台创建的普通本地账号" });
      }
      const [roleAssignments, managedOrganizations, operatedMachines, drivenVehicles, dailyReports, laborVerifications, payrolls, purchaseRequestsByUser, purchaseOrdersByUser, inventoryOperations, measurementClaimsByUser, evidenceUploads] = await Promise.all([
        database.select({ total: count() }).from(userRoleAssignments).where(eq(userRoleAssignments.userId, target.id)),
        database.select({ total: count() }).from(organizations).where(eq(organizations.managerUserId, target.id)),
        database.select({ total: count() }).from(machines).where(eq(machines.operatorUserId, target.id)),
        database.select({ total: count() }).from(transportVehicles).where(eq(transportVehicles.driverUserId, target.id)),
        database.select({ total: count() }).from(constructionDailyReports).where(or(eq(constructionDailyReports.createdBy, target.id), eq(constructionDailyReports.reviewedBy, target.id))),
        database.select({ total: count() }).from(laborWorkers).where(eq(laborWorkers.identityVerifiedBy, target.id)),
        database.select({ total: count() }).from(payrollStatements).where(or(eq(payrollStatements.submittedBy, target.id), eq(payrollStatements.accountantId, target.id))),
        database.select({ total: count() }).from(purchaseRequests).where(or(eq(purchaseRequests.requesterId, target.id), eq(purchaseRequests.approvedBy, target.id), eq(purchaseRequests.stockedBy, target.id))),
        database.select({ total: count() }).from(purchaseOrders).where(or(eq(purchaseOrders.createdBy, target.id), eq(purchaseOrders.confirmedBy, target.id))),
        database.select({ total: count() }).from(inventoryTransactions).where(eq(inventoryTransactions.operatorId, target.id)),
        database.select({ total: count() }).from(measurementClaims).where(or(eq(measurementClaims.submittedBy, target.id), eq(measurementClaims.reviewedBy, target.id), eq(measurementClaims.accountantId, target.id))),
        database.select({ total: count() }).from(evidenceRecords).where(eq(evidenceRecords.uploadedBy, target.id)),
      ]);
      const blockers = [
        ["组织负责人", managedOrganizations[0]?.total],
        ["机械操作员", operatedMachines[0]?.total],
        ["车辆驾驶员", drivenVehicles[0]?.total],
        ["施工日报", dailyReports[0]?.total],
        ["劳务实名核验", laborVerifications[0]?.total],
        ["工资审核或提交", payrolls[0]?.total],
        ["采购申请", purchaseRequestsByUser[0]?.total],
        ["采购订单", purchaseOrdersByUser[0]?.total],
        ["库存流水", inventoryOperations[0]?.total],
        ["计量申报", measurementClaimsByUser[0]?.total],
        ["影像证据", evidenceUploads[0]?.total],
      ].filter(([, total]) => Number(total ?? 0) > 0).map(([label, total]) => `${label} ${total} 条`);
      if (blockers.length > 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `该账号仍关联业务记录或资源责任：${blockers.join("、")}。请先完成交接或改派后再删除。` });
      }
      await database.update(userRoleAssignments).set({ status: "revoked" }).where(and(eq(userRoleAssignments.userId, target.id), eq(userRoleAssignments.status, "active")));
      await database.delete(userProfiles).where(eq(userProfiles.userId, target.id));
      await database.update(users).set({
        openId: `deleted-local-manager:${target.id}:${Date.now()}`,
        name: `已删除账号 #${target.id}`,
        loginMethod: "deleted_local_manager",
        localUsername: null,
        localPasswordHash: null,
        localAccountStatus: "disabled",
        localPasswordChangeRequired: false,
      }).where(and(eq(users.id, target.id), eq(users.loginMethod, "local_manager")));
      await database.insert(auditLogs).values({
        userId: admin.id,
        module: "permission",
        action: "delete_local_manager_account",
        targetType: "user",
        targetId: String(target.id),
        summary: `删除普通管理人员本地账号并撤销 ${Number(roleAssignments[0]?.total ?? 0)} 项角色授权：${target.name || `用户 #${target.id}`}`,
      });
      return { success: true, revokedAssignmentCount: Number(roleAssignments[0]?.total ?? 0) };
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
        const [targetUser] = await db.select({ id: users.id, loginMethod: users.loginMethod }).from(users).where(eq(users.id, input.userId)).limit(1);
        if (!targetUser) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的管理人员账号" });
        const [assignedRole] = await db.select({ code: systemRoles.code }).from(systemRoles).where(eq(systemRoles.id, input.roleId)).limit(1);
        if (!assignedRole) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的系统角色" });
        if (targetUser.loginMethod === "local_manager" && assignedRole.code === "SUPER_ADMIN") {
          throw new TRPCError({ code: "FORBIDDEN", message: "普通管理人员账号不得被授予超级管理员权限" });
        }
        if (assignedRole.code !== "SUPER_ADMIN" && !input.organizationId && !input.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "业务角色至少须选择所属部门/项目部或具体项目范围" });
        }
        if (input.organizationId) {
          const [department] = await db.select({ type: organizations.type, status: organizations.status }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
          if (!department || (department.type !== "department" && department.type !== "project_department") || department.status !== "active") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "所属部门必须是启用中的部门或项目部节点" });
          }
        }
        if (input.projectId) {
          const [project] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
          if (!project || project.status === "archived") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "授权项目必须是未归档的有效项目节点" });
          }
        }
        // 具体项目是最小范围。保存时主动清空部门字段，避免“部门 + 项目”历史组合被运行时误判为部门级授权。
        const projectId = input.projectId ?? null;
        const organizationId = projectId ? null : input.organizationId ?? null;
        const values = { ...input, organizationId, projectId, validFrom, validTo, grantedBy: admin.id };
        if (input.id) await db.update(userRoleAssignments).set(values).where(eq(userRoleAssignments.id, input.id));
        else await db.insert(userRoleAssignments).values(values);
        await db.insert(auditLogs).values({ userId: admin.id, module: "permission", action: input.id ? "update_assignment" : "grant_role", targetType: "user", targetId: String(input.userId), summary: projectId ? `维护用户角色与具体项目范围 #${projectId}` : "维护用户角色与部门数据范围" });
        const assignmentEventCode = input.status === "revoked" ? "user_access_revoked" : "user_access_updated";
        dispatchInAppSecurityNotification({
          eventCode: assignmentEventCode,
          idempotencyKey: `${assignmentEventCode}:${input.id ?? "new"}:${input.userId}:${input.roleId}:${Date.now()}`,
          recipientUserId: input.userId,
          title: input.status === "revoked" ? "您的业务授权已被撤销" : "您的业务授权已更新",
          content: input.status === "revoked" ? "管理员已调整您的系统授权。请重新打开工作台以同步最新权限。" : "管理员已更新您的岗位或数据范围。请重新打开工作台以同步最新权限。",
          deepLink: "/mobile/profile",
        });
        dispatchOfficialAccountSecurityNotification({
          userId: admin.id,
          module: "security",
          eventCode: assignmentEventCode,
          targetType: "user",
          targetId: String(input.userId),
          title: input.status === "revoked" ? "用户业务授权已撤销" : "用户业务授权已更新",
          deepLink: "/admin/permission",
        });
        return { success: true };
      }),
  }),

  settings: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const settings = await db.select({ id: systemSettings.id, category: systemSettings.category, settingKey: systemSettings.settingKey, displayName: systemSettings.displayName, valueJson: systemSettings.valueJson, valuePreview: systemSettings.valuePreview, isSensitive: systemSettings.isSensitive, status: systemSettings.status, version: systemSettings.version, publishedAt: systemSettings.publishedAt, updatedAt: systemSettings.updatedAt, remarks: systemSettings.remarks }).from(systemSettings).orderBy(systemSettings.category, systemSettings.settingKey);
      return settings.filter(setting => !RETIRED_NOTIFICATION_SETTING_KEYS.has(setting.settingKey));
    }),
    saveDraft: protectedProcedure
      .input(z.object({ id: z.number().int().positive().optional(), expectedVersion: z.number().int().positive().optional(), category: z.string().min(2).max(64), settingKey: z.string().regex(/^[A-Z0-9_:.\-]+$/), displayName: z.string().min(2).max(128), value: z.string().max(50000), isSensitive: z.boolean(), remarks: z.string().max(2000).nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const admin = await assertSuperAdmin(ctx);
        const db = await getDb();
        if (!db) throw new Error("数据库连接暂不可用");
        assertSupportedSettingKey(input.settingKey);
        if (requiresSecretStorage(input.settingKey) && !input.isSensitive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "API 密钥、令牌和密码类配置必须勾选“加密托管”" });
        }
        assertOfficialAccountSettingContract(input);
        if (input.settingKey === IDENTITY_PROVIDER_RECOVERY_URL_KEY && input.isSensitive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "身份恢复地址必须以公开 HTTPS 配置保存，不得作为密码或密钥加密托管" });
        }

        const hasSubmittedValue = input.value.trim().length > 0;
        if (input.id) {
          if (!input.expectedVersion) throw new TRPCError({ code: "BAD_REQUEST", message: "编辑既有配置必须携带当前版本号" });
          const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "配置项不存在" });
          assertExpectedSettingVersion(existing.version, input.expectedVersion);
          if (existing.settingKey !== input.settingKey) throw new TRPCError({ code: "BAD_REQUEST", message: "既有配置键不允许直接修改；如需变更标识，请新建配置后删除旧项" });
          if (existing.isSensitive !== input.isSensitive) throw new TRPCError({ code: "BAD_REQUEST", message: "既有配置的敏感等级不允许直接变更；请新建替代配置后删除旧项" });

          const preserveExistingSecret = existing.isSensitive && !hasSubmittedValue;
          if (!preserveExistingSecret && !hasSubmittedValue) throw new TRPCError({ code: "BAD_REQUEST", message: "请填写配置值；敏感配置仅可在保留现有密文时留空" });
          if (preserveExistingSecret && !existing.secretEncrypted) throw new TRPCError({ code: "BAD_REQUEST", message: "现有敏感配置缺少可用密文，请重新输入完整配置值" });
          let normalizedValue = input.value;
          if (input.settingKey === IDENTITY_PROVIDER_RECOVERY_URL_KEY && !preserveExistingSecret) {
            try {
              normalizedValue = normalizeIdentityRecoveryUrl(input.value);
            } catch {
              throw new TRPCError({ code: "BAD_REQUEST", message: "身份恢复地址必须是公开 HTTPS 地址，且不得包含账号、密码、内网或本机地址" });
            }
          }
          const payload = {
            category: input.category,
            settingKey: input.settingKey,
            displayName: input.displayName,
            valueJson: input.isSensitive ? null : normalizedValue,
            secretEncrypted: input.isSensitive ? (preserveExistingSecret ? existing.secretEncrypted : encryptSecret(normalizedValue)) : null,
            valuePreview: input.isSensitive ? (preserveExistingSecret ? existing.valuePreview : maskSecret(normalizedValue)) : normalizedValue.slice(0, 256),
            isSensitive: input.isSensitive,
            status: "draft" as const,
            remarks: input.remarks ?? null,
            updatedBy: admin.id,
          };
          const nextVersion = existing.version + 1;
          const writeResult = await db.update(systemSettings).set({ ...payload, version: nextVersion }).where(and(eq(systemSettings.id, input.id), eq(systemSettings.version, input.expectedVersion)));
          assertVersionedSettingWrite(writeResult);
          const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
          await db.insert(configPublishLogs).values({ settingId: input.id, operation: "update", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
          await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_draft", targetType: "setting", targetId: input.settingKey, summary: `保存配置草稿：${input.displayName}（v${nextVersion}）` });
          return { success: true, version: nextVersion };
        }

        if (!hasSubmittedValue) throw new TRPCError({ code: "BAD_REQUEST", message: "新建配置必须填写配置值" });
        let normalizedValue = input.value;
        if (input.settingKey === IDENTITY_PROVIDER_RECOVERY_URL_KEY) {
          try {
            normalizedValue = normalizeIdentityRecoveryUrl(input.value);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "身份恢复地址必须是公开 HTTPS 地址，且不得包含账号、密码、内网或本机地址" });
          }
        }
        await db.insert(systemSettings).values({
          category: input.category,
          settingKey: input.settingKey,
          displayName: input.displayName,
          valueJson: input.isSensitive ? null : normalizedValue,
          secretEncrypted: input.isSensitive ? encryptSecret(normalizedValue) : null,
          valuePreview: input.isSensitive ? maskSecret(normalizedValue) : normalizedValue.slice(0, 256),
          isSensitive: input.isSensitive,
          status: "draft",
          remarks: input.remarks ?? null,
          updatedBy: admin.id,
        });
        await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_draft", targetType: "setting", targetId: input.settingKey, summary: `保存配置草稿：${input.displayName}` });
        return { success: true };
      }),
    publish: protectedProcedure.input(z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const existing = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (existing.length === 0) throw new Error("配置项不存在");
      assertSupportedSettingKey(existing[0]!.settingKey);
      assertExpectedSettingVersion(existing[0]!.version, input.expectedVersion);
      const nextVersion = existing[0]!.version + 1;
      const writeResult = await db.update(systemSettings).set({ status: "published", version: nextVersion, publishedAt: new Date(), updatedBy: admin.id }).where(and(eq(systemSettings.id, input.id), eq(systemSettings.version, input.expectedVersion)));
      assertVersionedSettingWrite(writeResult);
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
    disable: protectedProcedure.input(z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "配置项不存在" });
      assertExpectedSettingVersion(existing.version, input.expectedVersion);
      const nextVersion = existing.version + 1;
      const writeResult = await db.update(systemSettings).set({ status: "disabled", version: nextVersion, updatedBy: admin.id }).where(and(eq(systemSettings.id, input.id), eq(systemSettings.version, input.expectedVersion)));
      assertVersionedSettingWrite(writeResult);
      const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
      await db.insert(configPublishLogs).values({ settingId: existing.id, operation: "disable", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "disable", targetType: "setting", targetId: String(existing.id), summary: `停用配置：${existing.displayName}` });
      return { success: true, version: nextVersion };
    }),
    /**
     * 受控删除仅允许使用当前版本执行。删除会抹除活动记录与全部历史快照中的值和密文；
     * 审计索引只保留操作者、时间和配置标识，避免被删除的密钥或业务参数被重新恢复。
     */
    remove: protectedProcedure.input(settingDeleteInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "配置项不存在或已删除" });
        assertExpectedSettingVersion(existing.version, input.expectedVersion);
        const deleteResult = await tx.delete(systemSettings).where(and(eq(systemSettings.id, input.id), eq(systemSettings.version, input.expectedVersion)));
        assertVersionedSettingWrite(deleteResult);
        const histories = await tx.select({ id: configPublishLogs.id, snapshotJson: configPublishLogs.snapshotJson }).from(configPublishLogs).where(eq(configPublishLogs.settingId, input.id));
        for (const history of histories) {
          await tx.update(configPublishLogs).set({ snapshotJson: redactDeletedConfigSnapshot(history.snapshotJson) }).where(eq(configPublishLogs.id, history.id));
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "delete", targetType: "setting", targetId: existing.settingKey, summary: `删除配置：${existing.displayName}；已清除配置值及历史快照中的可恢复内容` });
        return { success: true };
      });
    }),
    /** 验证密钥是否能在服务端安全解密，或验证公开 HTTPS 连接器的基础可达性。 */
    test: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const setting = await db.select().from(systemSettings).where(eq(systemSettings.id, input.id)).limit(1);
      if (!setting[0]) throw new TRPCError({ code: "NOT_FOUND", message: "待测试配置不存在" });
      assertSupportedSettingKey(setting[0].settingKey);
      let result: { success: boolean; message: string; statusCode?: number };
      if (setting[0].settingKey.startsWith("WECHAT_OFFICIAL_")) {
        result = await testPublishedOfficialAccountConfiguration();
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
      if (!result.success) {
        // 不带入地址、密钥或返回报文；操作者可在后台审计中查看受控的失败上下文。
        dispatchInAppSecurityNotification({
          eventCode: "system_connector_test_failed",
          idempotencyKey: `system_connector_test_failed:${input.id}:${Date.now()}`,
          recipientUserId: admin.id,
          title: "系统连接配置测试失败",
          content: "系统检测到一项连接配置未通过安全连通性测试，请在系统设置与审计记录中核查。",
          deepLink: "/admin/settings",
        });
        dispatchOfficialAccountSecurityNotification({
          userId: admin.id,
          module: "security",
          eventCode: "system_connector_test_failed",
          targetType: "setting",
          targetId: String(input.id),
          title: "系统连接配置测试失败",
          deepLink: "/admin/settings",
        });
      }
      return result;
    }),
    /** 供新版服务号向导独立检测模板消息插件和私有模板库，不依赖管理员预先填入模板 ID。 */
    checkOfficialAccountTemplateCapability: protectedProcedure.mutation(async ({ ctx }) => {
      const admin = await assertSuperAdmin(ctx);
      const result = await inspectPublishedOfficialAccountTemplateCapability();
      const db = await getDb();
      if (db) await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "official_account_template_capability_check", targetType: "official_account", targetId: "template_capability", summary: `检测服务号模板消息能力：${result.success ? "通过" : "未通过"}` });
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
    rollback: protectedProcedure.input(z.object({ settingId: z.number().int().positive(), publishLogId: z.number().int().positive(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.id, input.settingId)).limit(1);
      const [log] = await db.select().from(configPublishLogs).where(and(eq(configPublishLogs.id, input.publishLogId), eq(configPublishLogs.settingId, input.settingId))).limit(1);
      if (!setting || !log?.snapshotJson) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可回滚的配置版本" });
      assertSupportedSettingKey(setting.settingKey);
      assertExpectedSettingVersion(setting.version, input.expectedVersion);
      let snapshot: Record<string, unknown>;
      try { snapshot = JSON.parse(log.snapshotJson) as Record<string, unknown>; } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "历史配置快照已损坏，无法回滚" }); }
      const requiredKeys = ["category", "settingKey", "displayName", "isSensitive"];
      if (!requiredKeys.every(key => key in snapshot)) throw new TRPCError({ code: "BAD_REQUEST", message: "历史版本不完整，无法安全回滚" });
      const nextVersion = setting.version + 1;
      const writeResult = await db.update(systemSettings).set({
        category: String(snapshot.category), settingKey: String(snapshot.settingKey), displayName: String(snapshot.displayName),
        valueJson: typeof snapshot.valueJson === "string" ? snapshot.valueJson : null,
        secretEncrypted: typeof snapshot.secretEncrypted === "string" ? snapshot.secretEncrypted : null,
        valuePreview: typeof snapshot.valuePreview === "string" ? snapshot.valuePreview : null,
        isSensitive: Boolean(snapshot.isSensitive), remarks: typeof snapshot.remarks === "string" ? snapshot.remarks : null,
        status: "published", version: nextVersion, publishedAt: new Date(), updatedBy: admin.id,
      }).where(and(eq(systemSettings.id, input.settingId), eq(systemSettings.version, input.expectedVersion)));
      assertVersionedSettingWrite(writeResult);
      await db.insert(configPublishLogs).values({ settingId: input.settingId, operation: "rollback", version: nextVersion, operatorId: admin.id, snapshotJson: log.snapshotJson });
      await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "rollback", targetType: "setting", targetId: String(input.settingId), summary: `回滚配置：${setting.displayName} 至历史版本 ${log.version}` });
      return { success: true, version: nextVersion };
    }),
  }),

  acceptance: router({
    /** 仅返回汇总计数和就绪状态，供超级管理员安排真实项目复测，不暴露人员或财务明细。 */
    realDataReadiness: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "数据库连接暂不可用，无法执行真实数据验收预检" });
      const [[organization], [project], [roleAssignment], [departmentScope], [laborWorker], [attendance], [payroll]] = await Promise.all([
        db.select({ total: count() }).from(organizations),
        db.select({ total: count() }).from(projects),
        db.select({ total: count() }).from(userRoleAssignments),
        db.select({ total: count() }).from(departmentBusinessScopes),
        db.select({ total: count() }).from(laborWorkers),
        db.select({ total: count() }).from(attendanceRecords),
        db.select({ total: count() }).from(payrollStatements),
      ]);
      return evaluateRealDataReadiness({
        organizations: Number(organization?.total ?? 0),
        projects: Number(project?.total ?? 0),
        roleAssignments: Number(roleAssignment?.total ?? 0),
        departmentScopes: Number(departmentScope?.total ?? 0),
        laborWorkers: Number(laborWorker?.total ?? 0),
        attendanceRecords: Number(attendance?.total ?? 0),
        payrollStatements: Number(payroll?.total ?? 0),
      });
    }),
  }),

  /** 超级管理员总览：统计只提供真实业务记录数量，具体明细继续由各业务模块的服务端权限控制。 */
  business: router({
    statistics: protectedProcedure.input(businessStatisticsInput).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      return getBusinessModuleStatistics(input ?? {});
    }),
  }),

  /** 业务数据逻辑备份只允许超级管理员发起；不提供在线恢复，避免误覆盖生产数据。 */
  backup: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      return listBusinessDataBackups();
    }),
    create: protectedProcedure.mutation(async ({ ctx }) => {
      const admin = await assertSuperAdmin(ctx);
      try {
        const backup = await createBusinessDataBackup(admin.id);
        const db = await getDb();
        if (db) await db.insert(auditLogs).values({ userId: admin.id, module: "backup", action: "create", targetType: "business_data_backup", targetId: String(backup.id), summary: `创建业务数据逻辑备份：${backup.fileName}（${backup.recordCount} 条）` });
        return backup;
      } catch (error) {
        const message = error instanceof Error ? error.message : "创建业务数据备份失败";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),
    download: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      try {
        const backup = await getBusinessDataBackupDownload(input.id);
        const db = await getDb();
        if (db) await db.insert(auditLogs).values({ userId: admin.id, module: "backup", action: "download", targetType: "business_data_backup", targetId: String(input.id), summary: `下载业务数据逻辑备份：${backup.fileName}` });
        return backup;
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取业务数据备份失败";
        throw new TRPCError({ code: "NOT_FOUND", message });
      }
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
