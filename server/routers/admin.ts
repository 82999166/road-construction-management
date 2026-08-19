import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assetMaintenanceRecords,
  auditLogs,
  attendanceDeviceBindings,
  attendanceRecords,
  configPublishLogs,
  constructionDailyReports,
  departmentBusinessScopes,
  dieselGuidelinePrices,
  dieselPriceAlertRules,
  dieselRefuelRecords,
  employeeInsurancePolicies,
  employeeProfiles,
  evidenceRecords,
  inventoryTransactions,
  laborWorkers,
  machineCostRecords,
  machines,
  measurementClaims,
  notificationRecords,
  officialAccountBindings,
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
  transportVehicleLeaseRules,
  transportVehicles,
  userPermissions,
  userProfiles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import { DEPARTMENT_BUSINESS_MODULES } from "../../shared/department";
import { calculateTheoreticalVolume } from "../../shared/domain";
import { normalizeEvidenceWatermarkTemplate, WATERMARK_TEMPLATE_SETTING_KEY } from "../../shared/watermarkTemplate";
import { INDUSTRY_ROLE_TEMPLATES } from "../../shared/industryRoleTemplates";
import { evaluateRealDataReadiness } from "../../shared/realDataReadiness";
import { assertSuperAdmin, getSuperAdminAccess, listLoginUsers, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { createBusinessDataBackup, getBusinessDataBackupDownload, getBusinessModuleStatistics, listBusinessDataBackups } from "../services/adminBusinessBackup";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { ensureFoundationData } from "../services/foundationData";
import { getOfficialAccountNotificationTemplateCoverage, getPersistentBusinessTemplateEligibilityMessage, inspectPublishedOfficialAccountTemplateCapability, isPersistentBusinessTemplateEligible, listPublishedOfficialAccountPrivateTemplates, testPublishedOfficialAccountConfiguration } from "../services/officialAccountNotifier";
import { EXTERNAL_AI_SETTING_KEYS, getExternalAiConfigurationStatus, getPublishedExternalAiConfiguration, normalizeExternalAiBaseUrl, normalizeExternalAiModel, testExternalAiConnection } from "../services/externalAiApi";
import { decryptSecret, encryptSecret, maskSecret } from "../services/secretVault";
import { IDENTITY_PROVIDER_RECOVERY_URL_KEY, normalizeIdentityRecoveryUrl } from "../identityRecovery";
import { createLocalManagerOpenId, createLocalManagerPasswordHash, isValidLocalManagerUsername, normalizeLocalManagerUsername } from "../localAuth";
import { storageGetSignedUrl } from "../storage";
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
  vehicleType: z.enum(["dump_truck", "tractor", "mixer", "flatbed", "pickup", "suv", "other"]),
  ownership: z.enum(["owned", "leased"]).default("owned"),
  ownerName: z.string().trim().max(128).nullable().optional(),
  driverUserId: z.number().int().positive().nullable().optional(),
  driverName: z.string().trim().max(128).nullable().optional(),
  driverPhone: z.string().trim().regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机手机号").nullable().optional(),
  boxLengthMeters: z.number().gt(0).max(100),
  boxWidthMeters: z.number().gt(0).max(20),
  boxHeightMeters: z.number().gt(0).max(20),
  loadFactor: z.number().gt(0).max(1.5).default(1),
  payloadTons: z.number().gt(0).max(9999).nullable().optional(),
  fuelTankCapacityLiters: z.number().gt(0).max(99999).nullable().optional(),
  status: z.enum(["active", "suspended", "disabled"]),
  leaseTerms: z.object({
    billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
    rate: z.number().gt(0, "租金必须大于 0").max(999999999999.99),
    effectiveFrom: z.string().date("租赁起租日期格式应为 YYYY-MM-DD"),
    effectiveTo: z.string().date("租赁截止日期格式应为 YYYY-MM-DD").nullable().optional(),
  }).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "租赁截止日期不得早于起租日期", path: ["effectiveTo"] }).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.ownership !== "leased") return;
  if (!value.ownerName?.trim()) ctx.addIssue({ code: "custom", path: ["ownerName"], message: "外租车辆必须填写出租方" });
  if (!value.leaseTerms) ctx.addIssue({ code: "custom", path: ["leaseTerms"], message: "外租车辆必须填写租金、计费方式和租赁起止时间" });
});

/** 柴油指导价按项目和生效期维护；项目部供油记录必须采用当期有效价格。 */
const dieselGuidelinePriceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  pricePerLiter: z.number().gt(0, "柴油指导单价必须大于 0").max(9999.99),
  effectiveFrom: z.string().date("生效日期格式应为 YYYY-MM-DD"),
  effectiveTo: z.string().date("截止日期格式应为 YYYY-MM-DD").nullable().optional(),
  status: z.enum(["draft", "active", "disabled"]),
  remarks: z.string().trim().max(500).nullable().optional(),
}).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "截止日期不得早于生效日期", path: ["effectiveTo"] });

const dieselRefuelInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  assetType: z.enum(["vehicle", "machine"]),
  vehicleId: z.number().int().positive().nullable().optional(),
  machineId: z.number().int().positive().nullable().optional(),
  transportTripId: z.number().int().positive().nullable().optional(),
  supplyMethod: z.enum(["project_supply", "external_station"]),
  stationOrSupplierName: z.string().trim().max(160).nullable().optional(),
  liters: z.number().gt(0, "加油量必须大于 0").max(999999.999),
  actualUnitPrice: z.number().gt(0, "加油站实际单价必须大于 0").max(9999.99).nullable().optional(),
  deductFromFreight: z.boolean().default(false),
  refueledAt: z.string().datetime("加油时间格式错误"),
  meterReading: z.number().min(0).max(999999999).nullable().optional(),
  receiptNo: z.string().trim().max(64).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["draft", "approved", "void"]),
}).superRefine((value, ctx) => {
  if (value.assetType === "vehicle" && !value.vehicleId) ctx.addIssue({ code: "custom", path: ["vehicleId"], message: "车辆供油必须选择车辆" });
  if (value.assetType === "machine" && !value.machineId) ctx.addIssue({ code: "custom", path: ["machineId"], message: "机械供油必须选择机械" });
  if (value.assetType === "machine" && value.deductFromFreight) ctx.addIssue({ code: "custom", path: ["deductFromFreight"], message: "机械油料不得扣减运输运费" });
  if (value.deductFromFreight && !value.transportTripId) ctx.addIssue({ code: "custom", path: ["transportTripId"], message: "扣减运费必须关联具体运输趟次" });
  if (value.supplyMethod === "external_station" && !value.actualUnitPrice) ctx.addIssue({ code: "custom", path: ["actualUnitPrice"], message: "加油站加油必须填写实际单价" });
});

const dieselPriceAlertRuleInput = z.object({
  projectId: z.number().int().positive(),
  thresholdPercent: z.number().gt(0, "预警阈值必须大于 0").max(1000, "预警阈值不能超过 1000%").default(10),
  enabled: z.boolean().default(true),
});

type DieselRefuelRow = typeof dieselRefuelRecords.$inferSelect;

/** 柴油领用不走上级审批：除受控作废外，任何保存都立即作为有效成本和结算依据。 */
export function normalizeDieselRefuelStatus(status: "draft" | "approved" | "void") {
  return status === "void" ? "void" as const : "approved" as const;
}

/**
 * 现金加油以同项目、同供应商上一笔有效价格作为比较基准。该函数只计算展示/审计标记，
 * 不会改写已保存的油价或金额快照，避免历史口径被后续阈值调整影响。
 */
function calculateDieselPriceAlert(row: DieselRefuelRow, allRows: DieselRefuelRow[], rule?: { thresholdPercent: number | string; enabled: boolean } | null) {
  const thresholdPercent = rule ? Number(rule.thresholdPercent) : null;
  const base = { isAlert: false, referenceUnitPrice: null as number | null, deviationPercent: null as number | null, thresholdPercent };
  if (row.supplyMethod !== "external_station" || !rule?.enabled || !row.stationOrSupplierName || row.status === "void") return base;
  const rowTime = new Date(row.refueledAt).getTime();
  const previous = allRows
    .filter(item => item.id !== row.id && item.projectId === row.projectId && item.supplyMethod === "external_station" && item.status !== "void" && item.stationOrSupplierName === row.stationOrSupplierName && new Date(item.refueledAt).getTime() < rowTime)
    .sort((a, b) => new Date(b.refueledAt).getTime() - new Date(a.refueledAt).getTime())[0];
  if (!previous || Number(previous.appliedUnitPrice) <= 0 || !thresholdPercent) return base;
  const referenceUnitPrice = Number(previous.appliedUnitPrice);
  const deviationPercent = Number((Math.abs((Number(row.appliedUnitPrice) - referenceUnitPrice) / referenceUnitPrice) * 100).toFixed(2));
  return { isAlert: deviationPercent >= thresholdPercent, referenceUnitPrice, deviationPercent, thresholdPercent };
}

const employeeProfileInput = z.object({
  id: z.number().int().positive().optional(),
  userId: z.number().int().positive().nullable().optional(),
  laborWorkerId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().nullable().optional(),
  employeeType: z.enum(["management", "operator", "construction_worker"]),
  teamName: z.string().trim().max(128).nullable().optional(),
  employmentStatus: z.enum(["active", "suspended", "left"]),
  joinedAt: z.string().date().nullable().optional(),
  leftAt: z.string().date().nullable().optional(),
  salaryBasis: z.enum(["monthly", "daily", "hourly", "piecework"]),
  baseSalary: z.number().min(0).max(999999999999.99).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.userId ? 1 : 0) + (value.laborWorkerId ? 1 : 0) !== 1) ctx.addIssue({ code: "custom", path: ["userId"], message: "员工档案必须且只能关联一名管理人员/操作员或一条劳务工人档案" });
  if (value.leftAt && value.joinedAt && value.leftAt < value.joinedAt) ctx.addIssue({ code: "custom", path: ["leftAt"], message: "离职日期不得早于入职日期" });
});

const employeeInsuranceInput = z.object({
  id: z.number().int().positive().optional(),
  employeeProfileId: z.number().int().positive(),
  insuranceType: z.enum(["work_injury", "accident", "medical", "employer_liability", "other"]),
  providerName: z.string().trim().max(128).nullable().optional(),
  policyReference: z.string().trim().max(128).nullable().optional(),
  purchasedAt: z.string().date(),
  expiresAt: z.string().date(),
  status: z.enum(["active", "expired", "cancelled"]),
  remarks: z.string().trim().max(500).nullable().optional(),
}).refine(value => value.expiresAt >= value.purchasedAt, { message: "保险到期日期不得早于购买日期", path: ["expiresAt"] });

const assetMaintenanceInput = z.object({
  id: z.number().int().positive().optional(),
  assetType: z.enum(["vehicle", "machine"]),
  assetId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  costCategory: z.enum(["maintenance", "repair"]),
  amount: z.number().gt(0).max(999999999999.99),
  occurredAt: z.string().datetime({ offset: true }),
  serviceProvider: z.string().trim().max(160).nullable().optional(),
  meterReading: z.number().min(0).max(999999999999.99).nullable().optional(),
  nextDueAt: z.string().date().nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["draft", "approved", "settled", "void"]),
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
  module: z.enum(["CONSTRUCTION", "LABOR", "MACHINERY", "TRANSPORT", "PURCHASING", "MEASUREMENT", "CONTRACT", "FINANCE", "EVIDENCE"]),
  status: z.enum(["active", "disabled"]).default("active"),
});

/** 超级管理员只能创建普通本地账号，初始密码仅在本次请求中用于生成不可逆摘要。 */
const localManagerAccountInput = z.object({
  username: z.string().trim().min(1, "请输入登录手机号").max(32),
  displayName: z.string().trim().min(2).max(128),
  initialPassword: z.string().min(6, "初始密码至少 6 位").max(128),
  status: z.enum(["active", "disabled"]).default("active"),
  loginMode: z.enum(["pc", "mobile", "both"]).default("both"),
});

const localManagerStatusInput = z.object({
  userId: z.number().int().positive(),
  status: z.enum(["active", "disabled"]),
});

/** 编辑账号资料时仅允许维护本地登录标识、展示资料和状态，角色与数据范围仍须通过独立授权流程配置。 */
const localManagerAccountUpdateInput = z.object({
  userId: z.number().int().positive(),
  username: z.string().trim().min(1, "请输入登录手机号").max(32),
  displayName: z.string().trim().min(2).max(128),
  status: z.enum(["active", "disabled"]),
  loginMode: z.enum(["pc", "mobile", "both"]).default("both"),
});

/** 管理员重置密码不校验旧密码，但口令只在本次请求内生成不可逆摘要。 */
const localManagerPasswordResetInput = z.object({
  userId: z.number().int().positive(),
  newPassword: z.string().min(6, "新密码至少 6 位").max(128),
});

/** 服务号基础接入一次性保存：两项密钥允许在后续修订时留空以保留原有密文。 */
const officialAccountConfigurationInput = z.object({
  appId: z.string().trim().min(1, "请填写服务号 AppID").max(256),
  appSecret: z.string().max(2048),
  appUrl: z.string().trim().min(1, "请填写公众号业务跳转地址").max(1024),
  egressUrl: z.string().trim().min(1, "请填写微信 API 固定出口网关地址").max(1024),
  egressSigningSecret: z.string().max(2048),
});

/** 兼容 OpenAI Chat Completions 的外部 AI 配置；密钥后续修订留空表示保留既有密文。 */
const externalAiApiConfigurationInput = z.object({
  baseUrl: z.string().trim().min(1, "请填写 AI API 基础地址").max(1024),
  apiKey: z.string().max(4096),
  model: z.string().trim().min(1, "请填写模型名称").max(128),
  enabled: z.boolean().default(false),
});

const localManagerDeleteInput = z.object({ userId: z.number().int().positive() });
const wechatBindingUserInput = z.object({ userId: z.number().int().positive() });

/** 删除配置必须携带当前版本，防止管理员基于旧页面误删已被他人修订的配置。 */
const settingDeleteInput = z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().positive() });

/** 工程水印模板仅允许维护展示字段与文案，实际时间、人员、项目、定位仍由取证端和服务端产生。 */
const evidenceWatermarkTemplateInput = z.object({
  title: z.string().trim().min(2, "请填写水印标题").max(24),
  organizationLabel: z.string().trim().min(2, "请填写施工单位").max(48),
  footerLabel: z.string().trim().min(2, "请填写底部防伪文案").max(48),
  fields: z.array(z.enum(["capturedAt", "principal", "weather", "location", "coordinates", "organization", "project", "antiCounterfeit"])).min(2, "至少保留两项水印信息").max(8),
}).transform(value => normalizeEvidenceWatermarkTemplate(value));

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
const OFFICIAL_ACCOUNT_EVENT_SECRET_KEYS = new Set([
  "WECHAT_OFFICIAL_EVENT_TOKEN",
  "WECHAT_OFFICIAL_EVENT_AES_KEY",
]);
const OFFICIAL_ACCOUNT_EGRESS_SECRET_KEY = "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET";
const OFFICIAL_ACCOUNT_PUBLIC_SETTING_KEYS = new Set([
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_TEMPLATE_ID",
  "WECHAT_OFFICIAL_TEMPLATE_FIELDS",
  "WECHAT_OFFICIAL_MODULE_TEMPLATE_MAPPINGS",
  "WECHAT_OFFICIAL_APP_URL",
  "WECHAT_OFFICIAL_EGRESS_URL",
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
  if ((input.settingKey === OFFICIAL_ACCOUNT_APP_SECRET_KEY || input.settingKey === OFFICIAL_ACCOUNT_EGRESS_SECRET_KEY || OFFICIAL_ACCOUNT_EVENT_SECRET_KEYS.has(input.settingKey)) && !input.isSensitive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "认证服务号 AppSecret 必须使用加密托管" });
  }
  if (OFFICIAL_ACCOUNT_PUBLIC_SETTING_KEYS.has(input.settingKey) && input.isSensitive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "认证服务号 AppID、模板和跳转地址必须作为受控公开参数保存，不得标记为密钥" });
  }
  if ((input.settingKey === "WECHAT_OFFICIAL_APP_URL" || input.settingKey === "WECHAT_OFFICIAL_EGRESS_URL") && input.value.trim()) {
    try {
      assertSafeIntegrationUrl(input.value.trim());
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: input.settingKey === "WECHAT_OFFICIAL_EGRESS_URL" ? "固定出口网关地址必须是公开 HTTPS 地址，且不得指向内网或本机" : "公众号业务跳转地址必须是公开 HTTPS 地址，且不得指向内网或本机" });
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

  employee: router({
    options: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { users: [], laborWorkers: [] };
      const [accountRows, workerRows] = await Promise.all([
        db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
        db.select({ id: laborWorkers.id, realName: laborWorkers.realName, teamName: laborWorkers.teamName, projectId: laborWorkers.projectId }).from(laborWorkers).orderBy(asc(laborWorkers.realName)),
      ]);
      return { users: accountRows, laborWorkers: workerRows };
    }),
    listProfiles: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(employeeProfiles).orderBy(desc(employeeProfiles.updatedAt));
      return Promise.all(rows.map(async profile => {
        const [user] = profile.userId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, profile.userId)).limit(1) : [];
        const [worker] = profile.laborWorkerId ? await db.select({ id: laborWorkers.id, realName: laborWorkers.realName, teamName: laborWorkers.teamName, projectId: laborWorkers.projectId }).from(laborWorkers).where(eq(laborWorkers.id, profile.laborWorkerId)).limit(1) : [];
        const policies = await db.select().from(employeeInsurancePolicies).where(eq(employeeInsurancePolicies.employeeProfileId, profile.id)).orderBy(desc(employeeInsurancePolicies.expiresAt));
        const today = new Date().toISOString().slice(0, 10);
        const expiringCutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const activePolicies = policies.filter(policy => policy.status === "active");
        const insuranceStatus = activePolicies.some(policy => policy.expiresAt < new Date(`${today}T00:00:00Z`)) ? "expired" : activePolicies.some(policy => policy.expiresAt <= new Date(`${expiringCutoff}T00:00:00Z`)) ? "expiring" : activePolicies.length ? "active" : "missing";
        return { ...profile, displayName: user?.name ?? worker?.realName ?? "未命名员工", localUsername: null, laborTeamName: worker?.teamName ?? null, policies, insuranceStatus };
      }));
    }),
    saveProfile: protectedProcedure.input(employeeProfileInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      if (input.userId) {
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
        if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: "关联的管理人员或机械操作员账号不存在" });
      }
      if (input.laborWorkerId) {
        const [worker] = await db.select({ id: laborWorkers.id, projectId: laborWorkers.projectId }).from(laborWorkers).where(eq(laborWorkers.id, input.laborWorkerId)).limit(1);
        if (!worker) throw new TRPCError({ code: "BAD_REQUEST", message: "关联的施工队工人档案不存在" });
        if (input.projectId && worker.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "施工队工人的归属项目必须与劳务实名档案一致" });
      }
      if (input.projectId) {
        const [project] = await db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
        if (!project || project.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "员工归属项目必须是未归档的有效项目" });
      }
      const values = { userId: input.userId ?? null, laborWorkerId: input.laborWorkerId ?? null, projectId: input.projectId ?? null, employeeType: input.employeeType, teamName: input.teamName ?? null, employmentStatus: input.employmentStatus, joinedAt: input.joinedAt ? new Date(`${input.joinedAt}T00:00:00Z`) : null, leftAt: input.leftAt ? new Date(`${input.leftAt}T00:00:00Z`) : null, salaryBasis: input.salaryBasis, baseSalary: input.baseSalary === null || input.baseSalary === undefined ? null : String(input.baseSalary), remarks: input.remarks ?? null };
      if (input.id) {
        const [existing] = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "员工档案不存在" });
        await db.update(employeeProfiles).set(values).where(eq(employeeProfiles.id, input.id));
      } else await db.insert(employeeProfiles).values(values);
      await db.insert(auditLogs).values({ userId: admin.id, module: "personnel", action: input.id ? "update_employee_profile" : "create_employee_profile", targetType: "employee_profile", targetId: String(input.id ?? input.userId ?? input.laborWorkerId), summary: `${input.id ? "维护" : "新建"}${input.employeeType === "management" ? "管理人员" : input.employeeType === "operator" ? "机械操作员" : "施工队工人"}员工档案` });
      return { success: true };
    }),
    saveInsurance: protectedProcedure.input(employeeInsuranceInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const [profile] = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.id, input.employeeProfileId)).limit(1);
      if (!profile) throw new TRPCError({ code: "BAD_REQUEST", message: "请先建立有效员工档案" });
      const values = { employeeProfileId: input.employeeProfileId, insuranceType: input.insuranceType, providerName: input.providerName ?? null, policyReference: input.policyReference ?? null, purchasedAt: new Date(`${input.purchasedAt}T00:00:00Z`), expiresAt: new Date(`${input.expiresAt}T00:00:00Z`), status: input.status, remarks: input.remarks ?? null };
      if (input.id) await db.update(employeeInsurancePolicies).set(values).where(eq(employeeInsurancePolicies.id, input.id));
      else await db.insert(employeeInsurancePolicies).values(values);
      await db.insert(auditLogs).values({ userId: admin.id, module: "personnel", action: input.id ? "update_employee_insurance" : "create_employee_insurance", targetType: "employee_insurance", targetId: String(input.id ?? input.employeeProfileId), summary: `${input.id ? "维护" : "登记"}员工保险：${input.insuranceType}` });
      return { success: true };
    }),
  }),

  assetMaintenance: router({
    list: protectedProcedure.input(z.object({ assetType: z.enum(["vehicle", "machine"]).optional(), projectId: z.number().int().positive().optional(), assetId: z.number().int().positive().optional(), status: z.enum(["draft", "approved", "settled", "void"]).optional() }).optional()).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(assetMaintenanceRecords).orderBy(desc(assetMaintenanceRecords.occurredAt));
      const filtered = rows.filter(row => (!input?.assetType || row.assetType === input.assetType) && (!input?.projectId || row.projectId === input.projectId) && (!input?.assetId || row.assetId === input.assetId) && (!input?.status || row.status === input.status));
      return Promise.all(filtered.map(async row => {
        const [asset] = row.assetType === "vehicle" ? await db.select({ name: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.id, row.assetId)).limit(1) : await db.select({ name: machines.name, code: machines.code }).from(machines).where(eq(machines.id, row.assetId)).limit(1);
        return { ...row, assetName: asset ? ("code" in asset && asset.code ? `${asset.name} · ${asset.code}` : asset.name) : `资源 #${row.assetId}` };
      }));
    }),
    summary: protectedProcedure.input(z.object({ projectId: z.number().int().positive().optional(), assetType: z.enum(["vehicle", "machine"]).optional(), assetId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { vehicleMaintenanceAmount: 0, vehicleRepairAmount: 0, machineMaintenanceAmount: 0, machineRepairAmount: 0, machineOperatingCostAmount: 0, totalAmount: 0 };
      const records = (await db.select().from(assetMaintenanceRecords)).filter(row => row.status !== "void" && (!input?.projectId || row.projectId === input.projectId) && (!input?.assetType || row.assetType === input.assetType) && (!input?.assetId || row.assetId === input.assetId));
      const amountOf = (assetType: "vehicle" | "machine", costCategory: "maintenance" | "repair") => records.filter(row => row.assetType === assetType && row.costCategory === costCategory).reduce((sum, row) => sum + Number(row.amount), 0);
      const machineCosts = (await db.select().from(machineCostRecords)).filter(row => row.status !== "void" && (!input?.projectId || row.projectId === input.projectId) && (!input?.assetType || input.assetType === "machine") && (!input?.assetId || row.machineId === input.assetId));
      const machineOperatingCostAmount = machineCosts.reduce((sum, row) => sum + Number(row.amount), 0);
      const vehicleMaintenanceAmount = amountOf("vehicle", "maintenance");
      const vehicleRepairAmount = amountOf("vehicle", "repair");
      const machineMaintenanceAmount = amountOf("machine", "maintenance");
      const machineRepairAmount = amountOf("machine", "repair");
      return { vehicleMaintenanceAmount, vehicleRepairAmount, machineMaintenanceAmount, machineRepairAmount, machineOperatingCostAmount, totalAmount: vehicleMaintenanceAmount + vehicleRepairAmount + machineMaintenanceAmount + machineRepairAmount + machineOperatingCostAmount };
    }),
    save: protectedProcedure.input(assetMaintenanceInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const [asset] = input.assetType === "vehicle" ? await db.select({ id: transportVehicles.id, projectId: transportVehicles.projectId }).from(transportVehicles).where(eq(transportVehicles.id, input.assetId)).limit(1) : await db.select({ id: machines.id, projectId: machines.projectId }).from(machines).where(eq(machines.id, input.assetId)).limit(1);
      if (!asset || asset.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "维修保养资源必须属于所选项目" });
      const values = { assetType: input.assetType, assetId: input.assetId, projectId: input.projectId, costCategory: input.costCategory, amount: String(input.amount), occurredAt: new Date(input.occurredAt), serviceProvider: input.serviceProvider ?? null, meterReading: input.meterReading === null || input.meterReading === undefined ? null : String(input.meterReading), nextDueAt: input.nextDueAt ? new Date(`${input.nextDueAt}T00:00:00Z`) : null, remarks: input.remarks ?? null, status: input.status };
      if (input.id) await db.update(assetMaintenanceRecords).set(values).where(eq(assetMaintenanceRecords.id, input.id));
      else await db.insert(assetMaintenanceRecords).values(values);
      await db.insert(auditLogs).values({ userId: admin.id, module: input.assetType === "vehicle" ? "transport" : "machinery", action: input.id ? "update_asset_maintenance" : "create_asset_maintenance", targetType: `${input.assetType}_maintenance`, targetId: String(input.id ?? input.assetId), summary: `${input.assetType === "vehicle" ? "车辆" : "机械"}${input.costCategory === "maintenance" ? "保养" : "维修"}费用：¥${input.amount}` });
      return { success: true };
    }),
  }),

  /** 柴油价格、领用、运输扣款与每日汇总均由超级管理后台受控维护。 */
  diesel: router({
    listGuidelinePrices: protectedProcedure.input(z.object({ projectId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(dieselGuidelinePrices).orderBy(desc(dieselGuidelinePrices.effectiveFrom));
      return rows.filter(row => !input?.projectId || row.projectId === input.projectId);
    }),
    saveGuidelinePrice: protectedProcedure.input(dieselGuidelinePriceInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const [project] = await db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (!project || project.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "柴油指导价必须归属有效项目" });
      const values = { projectId: input.projectId, pricePerLiter: String(input.pricePerLiter), effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null, status: input.status, remarks: input.remarks ?? null, createdBy: admin.id };
      if (input.id) {
        const [existing] = await db.select({ id: dieselGuidelinePrices.id }).from(dieselGuidelinePrices).where(eq(dieselGuidelinePrices.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "柴油指导价不存在" });
        await db.update(dieselGuidelinePrices).set(values).where(eq(dieselGuidelinePrices.id, input.id));
      } else await db.insert(dieselGuidelinePrices).values(values);
      await db.insert(auditLogs).values({ userId: admin.id, module: "diesel", action: input.id ? "update_guideline_price" : "create_guideline_price", targetType: "diesel_guideline_price", targetId: String(input.id ?? input.projectId), summary: `${input.id ? "维护" : "新增"}柴油指导价：¥${input.pricePerLiter}/L` });
      return { success: true };
    }),
    getPriceAlertRule: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { thresholdPercent: 10, enabled: true, configured: false };
      const [rule] = await db.select().from(dieselPriceAlertRules).where(eq(dieselPriceAlertRules.projectId, input.projectId)).limit(1);
      return rule ? { id: rule.id, thresholdPercent: Number(rule.thresholdPercent), enabled: rule.enabled, configured: true } : { thresholdPercent: 10, enabled: true, configured: false };
    }),
    savePriceAlertRule: protectedProcedure.input(dieselPriceAlertRuleInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      const [project] = await db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (!project || project.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "柴油预警规则必须归属有效项目" });
      const [existing] = await db.select({ id: dieselPriceAlertRules.id }).from(dieselPriceAlertRules).where(eq(dieselPriceAlertRules.projectId, input.projectId)).limit(1);
      const values = { projectId: input.projectId, thresholdPercent: String(input.thresholdPercent), enabled: input.enabled, createdBy: admin.id };
      if (existing) await db.update(dieselPriceAlertRules).set(values).where(eq(dieselPriceAlertRules.id, existing.id));
      else await db.insert(dieselPriceAlertRules).values(values);
      await db.insert(auditLogs).values({ userId: admin.id, module: "diesel", action: "save_price_alert_rule", targetType: "diesel_price_alert_rule", targetId: String(input.projectId), summary: `柴油现金油价预警阈值：${input.enabled ? `${input.thresholdPercent}%` : "已停用"}` });
      return { success: true };
    }),
    supplierReconciliation: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "期间格式应为 YYYY-MM") })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const [rule] = await db.select().from(dieselPriceAlertRules).where(eq(dieselPriceAlertRules.projectId, input.projectId)).limit(1);
      const allRows = await db.select().from(dieselRefuelRecords).orderBy(desc(dieselRefuelRecords.refueledAt));
      const rows = allRows.filter(row => row.projectId === input.projectId && row.supplyMethod === "external_station" && row.status !== "void" && new Date(row.refueledAt).toISOString().slice(0, 7) === input.period);
      const groups = new Map<string, { supplierName: string; recordCount: number; liters: number; amount: number; receiptCount: number; alertCount: number; minUnitPrice: number; maxUnitPrice: number }>();
      rows.forEach(row => {
        const supplierName = row.stationOrSupplierName?.trim() || "未登记供应商";
        const group = groups.get(supplierName) ?? { supplierName, recordCount: 0, liters: 0, amount: 0, receiptCount: 0, alertCount: 0, minUnitPrice: Number(row.appliedUnitPrice), maxUnitPrice: Number(row.appliedUnitPrice) };
        const unitPrice = Number(row.appliedUnitPrice);
        group.recordCount += 1;
        group.liters += Number(row.liters);
        group.amount += Number(row.amount);
        group.receiptCount += row.receiptNo || row.evidenceId ? 1 : 0;
        group.alertCount += calculateDieselPriceAlert(row, allRows, rule).isAlert ? 1 : 0;
        group.minUnitPrice = Math.min(group.minUnitPrice, unitPrice);
        group.maxUnitPrice = Math.max(group.maxUnitPrice, unitPrice);
        groups.set(supplierName, group);
      });
      return Array.from(groups.values()).map(group => ({ ...group, averageUnitPrice: group.liters ? Number((group.amount / group.liters).toFixed(2)) : 0, priceSpread: Number((group.maxUnitPrice - group.minUnitPrice).toFixed(2)) })).sort((a, b) => b.amount - a.amount);
    }),
    listRefuelRecords: protectedProcedure.input(z.object({
      projectId: z.number().int().positive().optional(),
      assetType: z.enum(["vehicle", "machine"]).optional(),
      assetId: z.number().int().positive().optional(),
      status: z.enum(["draft", "approved", "settled", "void"]).optional(),
      /** 保留单日参数以兼容既有调用；新界面优先使用日期区间。 */
      date: z.string().date().optional(),
      dateFrom: z.string().date().optional(),
      dateTo: z.string().date().optional(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月份格式应为 YYYY-MM").optional(),
      supplyMethod: z.enum(["project_supply", "external_station"]).optional(),
      plateNo: z.string().trim().max(32).optional(),
      supplierName: z.string().trim().max(160).optional(),
    }).refine(input => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, { message: "加油结束日期不得早于开始日期", path: ["dateTo"] }).optional()).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(dieselRefuelRecords).orderBy(desc(dieselRefuelRecords.refueledAt));
      const dateFrom = input?.dateFrom ?? input?.date;
      const dateTo = input?.dateTo ?? input?.date;
      const plateKeyword = input?.plateNo?.trim().toUpperCase();
      const matchingVehicleIds = new Set(plateKeyword ? (await db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo }).from(transportVehicles)).filter(vehicle => vehicle.plateNo.toUpperCase().includes(plateKeyword)).map(vehicle => vehicle.id) : []);
      const supplierKeyword = input?.supplierName?.trim().toLowerCase();
      const filtered = rows.filter(row => {
        const refueledDate = new Date(row.refueledAt).toISOString().slice(0, 10);
        return (!input?.projectId || row.projectId === input.projectId)
          && (!input?.assetType || row.assetType === input.assetType)
          && (!input?.status || row.status === input.status)
          && (!input?.assetId || (row.assetType === "vehicle" ? row.vehicleId === input.assetId : row.machineId === input.assetId))
          && (!dateFrom || refueledDate >= dateFrom)
          && (!dateTo || refueledDate <= dateTo)
          && (!input?.month || refueledDate.slice(0, 7) === input.month)
          && (!input?.supplyMethod || row.supplyMethod === input.supplyMethod)
          && (!plateKeyword || (row.assetType === "vehicle" && Boolean(row.vehicleId) && matchingVehicleIds.has(Number(row.vehicleId))))
          && (!supplierKeyword || (row.stationOrSupplierName ?? "").toLowerCase().includes(supplierKeyword));
      });
      const [alertRule] = input?.projectId ? await db.select().from(dieselPriceAlertRules).where(eq(dieselPriceAlertRules.projectId, input.projectId)).limit(1) : [];
      return Promise.all(filtered.map(async row => {
        const [asset] = row.assetType === "vehicle" && row.vehicleId ? await db.select({ name: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.id, row.vehicleId)).limit(1) : row.assetType === "machine" && row.machineId ? await db.select({ name: machines.name, code: machines.code }).from(machines).where(eq(machines.id, row.machineId)).limit(1) : [];
        const [trip] = row.transportTripId ? await db.select({ tripNo: transportTrips.tripNo, calculatedAmount: transportTrips.calculatedAmount }).from(transportTrips).where(eq(transportTrips.id, row.transportTripId)).limit(1) : [];
        const [evidence] = row.evidenceId ? await db.select({ fileName: evidenceRecords.fileName, fileKey: evidenceRecords.fileKey, mimeType: evidenceRecords.mimeType }).from(evidenceRecords).where(eq(evidenceRecords.id, row.evidenceId)).limit(1) : [];
        const receiptImageUrl = evidence ? await storageGetSignedUrl(evidence.fileKey) : null;
        return { ...row, assetName: asset ? ("code" in asset && asset.code ? `${asset.name} · ${asset.code}` : asset.name) : "未关联资源", tripNo: trip?.tripNo ?? null, grossFreightAmount: trip?.calculatedAmount ?? null, receiptEvidence: evidence ? { ...evidence, url: receiptImageUrl } : null, priceAlert: calculateDieselPriceAlert(row, rows, alertRule) };
      }));
    }),
    dailySummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: z.string().date() })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { totalLiters: 0, totalAmount: 0, projectSupplyLiters: 0, stationLiters: 0, vehicleLiters: 0, machineLiters: 0, deductibleAmount: 0, records: [] };
      const rows = (await db.select().from(dieselRefuelRecords)).filter(row => row.projectId === input.projectId && row.status !== "void" && new Date(row.refueledAt).toISOString().slice(0, 10) === input.date);
      const sum = (predicate: (row: typeof rows[number]) => boolean, field: "liters" | "amount") => rows.filter(predicate).reduce((total, row) => total + Number(row[field]), 0);
      return {
        totalLiters: sum(() => true, "liters"),
        totalAmount: sum(() => true, "amount"),
        projectSupplyLiters: sum(row => row.supplyMethod === "project_supply", "liters"),
        stationLiters: sum(row => row.supplyMethod === "external_station", "liters"),
        vehicleLiters: sum(row => row.assetType === "vehicle", "liters"),
        machineLiters: sum(row => row.assetType === "machine", "liters"),
        deductibleAmount: sum(row => row.deductFromFreight, "amount"),
        records: rows,
      };
    }),
    saveRefuelRecord: protectedProcedure.input(dieselRefuelInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
      if (input.assetType === "vehicle" && !input.vehicleId) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆柴油领用必须关联车辆" });
      if (input.assetType === "machine" && !input.machineId) throw new TRPCError({ code: "BAD_REQUEST", message: "机械柴油领用必须关联机械" });
      if (input.supplyMethod === "external_station" && (!input.stationOrSupplierName?.trim() || !input.actualUnitPrice || input.actualUnitPrice <= 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "加油站加油必须填写加油站/供应商和实际单价" });
      }
      if (input.deductFromFreight && (input.assetType !== "vehicle" || !input.transportTripId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "运费扣油必须关联车辆和未结算运输趟次" });
      }
      const [project] = await db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (!project || project.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "柴油记录必须归属有效项目" });
      if (input.evidenceId) {
        const [evidence] = await db.select({ id: evidenceRecords.id, projectId: evidenceRecords.projectId }).from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1);
        if (!evidence || evidence.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "现金小票影像必须归属所选项目" });
      }
      if (input.assetType === "vehicle") {
        const [vehicle] = await db.select({ id: transportVehicles.id, projectId: transportVehicles.projectId }).from(transportVehicles).where(eq(transportVehicles.id, input.vehicleId!)).limit(1);
        if (!vehicle || vehicle.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆必须归属所选项目" });
      } else {
        const [machine] = await db.select({ id: machines.id, projectId: machines.projectId }).from(machines).where(eq(machines.id, input.machineId!)).limit(1);
        if (!machine || machine.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "机械必须归属所选项目" });
      }
      if (input.transportTripId) {
        const [trip] = await db.select({ id: transportTrips.id, projectId: transportTrips.projectId, vehicleId: transportTrips.vehicleId, status: transportTrips.status }).from(transportTrips).where(eq(transportTrips.id, input.transportTripId)).limit(1);
        if (!trip || trip.projectId !== input.projectId || trip.vehicleId !== input.vehicleId) throw new TRPCError({ code: "BAD_REQUEST", message: "运输趟次必须属于所选项目和车辆" });
        if (trip.status === "settled" || trip.status === "void") throw new TRPCError({ code: "BAD_REQUEST", message: "已结算或已作废趟次不得新增柴油扣款" });
      }
      const refuelDate = input.refueledAt.slice(0, 10);
      let appliedUnitPrice = input.actualUnitPrice ?? 0;
      if (input.supplyMethod === "project_supply") {
        const prices = await db.select().from(dieselGuidelinePrices).where(eq(dieselGuidelinePrices.projectId, input.projectId)).orderBy(desc(dieselGuidelinePrices.effectiveFrom));
        const activePrice = prices.find(price => price.status === "active" && new Date(price.effectiveFrom).toISOString().slice(0, 10) <= refuelDate && (!price.effectiveTo || new Date(price.effectiveTo).toISOString().slice(0, 10) >= refuelDate));
        if (!activePrice) throw new TRPCError({ code: "BAD_REQUEST", message: "项目部供油前请先维护当日有效的柴油指导单价" });
        appliedUnitPrice = Number(activePrice.pricePerLiter);
      }
      const amount = Number((input.liters * appliedUnitPrice).toFixed(2));
      const allRefuelRows = input.supplyMethod === "external_station" ? await db.select().from(dieselRefuelRecords).orderBy(desc(dieselRefuelRecords.refueledAt)) : [];
      const [alertRule] = input.supplyMethod === "external_station" ? await db.select().from(dieselPriceAlertRules).where(eq(dieselPriceAlertRules.projectId, input.projectId)).limit(1) : [];
      const effectiveStatus = normalizeDieselRefuelStatus(input.status);
      const values = { projectId: input.projectId, assetType: input.assetType, vehicleId: input.assetType === "vehicle" ? input.vehicleId ?? null : null, machineId: input.assetType === "machine" ? input.machineId ?? null : null, transportTripId: input.transportTripId ?? null, supplyMethod: input.supplyMethod, stationOrSupplierName: input.stationOrSupplierName ?? null, liters: String(input.liters), actualUnitPrice: input.actualUnitPrice === null || input.actualUnitPrice === undefined ? null : String(input.actualUnitPrice), appliedUnitPrice: String(appliedUnitPrice), amount: String(amount), deductFromFreight: input.assetType === "vehicle" ? input.deductFromFreight : false, refueledAt: new Date(input.refueledAt), meterReading: input.meterReading === null || input.meterReading === undefined ? null : String(input.meterReading), receiptNo: input.receiptNo ?? null, evidenceId: input.evidenceId ?? null, remarks: input.remarks ?? null, status: effectiveStatus, createdBy: admin.id, approvedBy: effectiveStatus === "approved" ? admin.id : null, approvedAt: effectiveStatus === "approved" ? new Date() : null };
      let recordId = input.id;
      if (input.id) {
        const [existing] = await db.select({ id: dieselRefuelRecords.id, status: dieselRefuelRecords.status }).from(dieselRefuelRecords).where(eq(dieselRefuelRecords.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "柴油领用记录不存在" });
        if (existing.status === "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "已结算柴油记录不得修改或作废" });
        await db.update(dieselRefuelRecords).set(values).where(eq(dieselRefuelRecords.id, input.id));
      } else {
        const recordNo = `DS${input.projectId}${Date.now().toString().slice(-8)}`;
        await db.insert(dieselRefuelRecords).values({ ...values, recordNo });
        const [created] = await db.select({ id: dieselRefuelRecords.id }).from(dieselRefuelRecords).where(eq(dieselRefuelRecords.recordNo, recordNo)).limit(1);
        recordId = created?.id;
      }
      if (!recordId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "柴油记录保存后无法确认编号" });
      const alertCandidate: DieselRefuelRow = { ...values, id: recordId, recordNo: `DS${recordId}`, createdAt: new Date(), updatedAt: new Date() };
      const priceAlert = input.supplyMethod === "external_station" ? calculateDieselPriceAlert(alertCandidate, allRefuelRows, alertRule) : calculateDieselPriceAlert(alertCandidate, [], null);
      if (input.assetType === "machine") {
        const [existingCost] = await db.select({ id: machineCostRecords.id }).from(machineCostRecords).where(eq(machineCostRecords.dieselRefuelRecordId, recordId)).limit(1);
        const costValues = { machineId: input.machineId!, projectId: input.projectId, costType: "fuel" as const, quantity: String(input.liters), unitPrice: String(appliedUnitPrice), amount: String(amount), dieselRefuelRecordId: recordId, occurredAt: new Date(input.refueledAt), evidenceId: input.evidenceId ?? null, status: effectiveStatus === "void" ? "void" as const : "approved" as const };
        if (existingCost) await db.update(machineCostRecords).set(costValues).where(eq(machineCostRecords.id, existingCost.id));
        else if (input.status !== "void") await db.insert(machineCostRecords).values(costValues);
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "diesel", action: input.id ? "update_refuel" : "create_refuel", targetType: "diesel_refuel", targetId: String(recordId), summary: `${input.assetType === "vehicle" ? "车辆" : "机械"}${input.supplyMethod === "project_supply" ? "项目部供油" : "加油站加油"}：${input.liters}L，¥${amount}${effectiveStatus === "void" ? "，已作废" : "，直接记账生效"}${input.deductFromFreight ? "，结算扣油" : ""}` });
      if (priceAlert.isAlert) {
        await db.insert(auditLogs).values({ userId: admin.id, module: "diesel", action: "price_alert", targetType: "diesel_refuel", targetId: String(recordId), summary: `现金柴油价格异常：¥${appliedUnitPrice}/L，相对${input.stationOrSupplierName}上一笔 ¥${priceAlert.referenceUnitPrice}/L 波动 ${priceAlert.deviationPercent}%（阈值 ${priceAlert.thresholdPercent}%）` });
      }
      return { success: true, id: recordId, amount, appliedUnitPrice, priceAlert };
    }),
  }),

  vehicle: router({
    /** 超级管理员从唯一的运输车辆台账读取全局资源，理论方量始终由货厢参数实时计算。 */
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(transportVehicles).orderBy(desc(transportVehicles.updatedAt));
      return Promise.all(rows.map(async vehicle => {
        const rules = vehicle.ownership === "leased" ? await db.select().from(transportVehicleLeaseRules).where(eq(transportVehicleLeaseRules.vehicleId, vehicle.id)).orderBy(desc(transportVehicleLeaseRules.updatedAt)) : [];
        const activeRule = rules.find(rule => rule.projectId === vehicle.projectId && rule.status === "active");
        return {
          ...vehicle,
          theoreticalVolumeCubicMeters: calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)),
          leaseTerms: activeRule ? { billingType: activeRule.billingType, rate: activeRule.rate, effectiveFrom: activeRule.effectiveFrom, effectiveTo: activeRule.effectiveTo } : null,
        };
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
        ownership: input.ownership,
        ownerName: input.ownerName ?? null,
        driverUserId: input.driverUserId ?? null,
        driverName: input.driverName ?? null,
        driverPhoneEncrypted: input.driverPhone === undefined ? existing?.driverPhoneEncrypted ?? null : input.driverPhone ? encryptSecret(input.driverPhone) : null,
        driverPhoneMasked: input.driverPhone === undefined ? existing?.driverPhoneMasked ?? null : input.driverPhone ? maskSecret(input.driverPhone) : null,
        boxLengthMeters: String(input.boxLengthMeters),
        boxWidthMeters: String(input.boxWidthMeters),
        boxHeightMeters: String(input.boxHeightMeters),
        loadFactor: String(input.loadFactor),
        payloadTons: input.payloadTons === null || input.payloadTons === undefined ? null : String(input.payloadTons),
        fuelTankCapacityLiters: input.fuelTankCapacityLiters === null || input.fuelTankCapacityLiters === undefined ? null : String(input.fuelTankCapacityLiters),
        status: input.status,
      };
      let vehicleId = input.id;
      if (existing) await db.update(transportVehicles).set(values).where(eq(transportVehicles.id, existing.id));
      else {
        await db.insert(transportVehicles).values(values);
        const [created] = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(eq(transportVehicles.plateNo, input.plateNo)).limit(1);
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "车辆台账保存后未找到记录" });
        vehicleId = created.id;
      }
      if (!vehicleId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "车辆台账标识无效" });
      const existingRules = await db.select().from(transportVehicleLeaseRules).where(eq(transportVehicleLeaseRules.vehicleId, vehicleId)).orderBy(desc(transportVehicleLeaseRules.updatedAt));
      const activeRule = existingRules.find(rule => rule.projectId === input.projectId && rule.status === "active");
      if (input.ownership === "leased" && input.leaseTerms) {
        const leaseValues = { vehicleId, projectId: input.projectId, billingType: input.leaseTerms.billingType, rate: String(input.leaseTerms.rate), effectiveFrom: new Date(`${input.leaseTerms.effectiveFrom}T00:00:00Z`), effectiveTo: input.leaseTerms.effectiveTo ? new Date(`${input.leaseTerms.effectiveTo}T00:00:00Z`) : null, status: "active" as const };
        if (activeRule) await db.update(transportVehicleLeaseRules).set(leaseValues).where(eq(transportVehicleLeaseRules.id, activeRule.id));
        else await db.insert(transportVehicleLeaseRules).values(leaseValues);
      } else if (activeRule) {
        await db.update(transportVehicleLeaseRules).set({ status: "disabled" }).where(eq(transportVehicleLeaseRules.id, activeRule.id));
      }
      await db.insert(auditLogs).values({
        userId: admin.id,
        module: "transport",
        action: input.id ? "admin_update_vehicle" : "admin_create_vehicle",
        targetType: "transport_vehicle",
        targetId: String(vehicleId),
        summary: `${input.id ? "维护" : "新建"}车辆台账：${input.plateNo}${input.ownership === "leased" ? "，已维护外租租金与租期" : ""}`,
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
    /** 简洁授权页只消费此受控岗位目录；实际角色状态与主键仍以系统角色表为准。 */
    templates: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      await ensureFoundationData(db);
      const roles = await db.select({ id: systemRoles.id, code: systemRoles.code, status: systemRoles.status }).from(systemRoles);
      const roleByCode = new Map(roles.map(role => [role.code, role]));
      return INDUSTRY_ROLE_TEMPLATES.map(template => {
        const role = roleByCode.get(template.code);
        return { ...template, roleId: role?.id ?? null, roleStatus: role?.status ?? "disabled", available: Boolean(role && role.status === "active") };
      });
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
      const [roleRows, permissionRows] = await Promise.all([
        db.select({ id: systemRoles.id, name: systemRoles.name }).from(systemRoles).where(eq(systemRoles.id, input.roleId)).limit(1),
        db.select({ id: systemPermissions.id }).from(systemPermissions),
      ]);
      if (!roleRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在或已被删除" });
      const uniquePermissionIds = Array.from(new Set(input.permissionIds));
      const validPermissionIds = new Set(permissionRows.map(permission => permission.id));
      if (uniquePermissionIds.some(permissionId => !validPermissionIds.has(permissionId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "权限配置中包含无效权限点，请刷新后重新设置" });
      }
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, input.roleId));
      if (uniquePermissionIds.length > 0) {
        await db.insert(rolePermissions).values(uniquePermissionIds.map(permissionId => ({ roleId: input.roleId, permissionId })));
      }
      await db.insert(auditLogs).values({ userId: admin.id, module: "role", action: "assign_permissions", targetType: "role", targetId: String(input.roleId), summary: `更新角色“${roleRows[0].name}”的详细操作权限，共 ${uniquePermissionIds.length} 项` });
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
      return db.select({
        id: userRoleAssignments.id,
        userId: userRoleAssignments.userId,
        roleId: userRoleAssignments.roleId,
        organizationId: userRoleAssignments.organizationId,
        projectId: userRoleAssignments.projectId,
        validFrom: userRoleAssignments.validFrom,
        validTo: userRoleAssignments.validTo,
        status: userRoleAssignments.status,
        grantedBy: userRoleAssignments.grantedBy,
        createdAt: userRoleAssignments.createdAt,
        userName: users.name,
        localUsername: users.localUsername,
        localAccountStatus: users.localAccountStatus,
        roleName: systemRoles.name,
        roleCode: systemRoles.code,
        roleStatus: systemRoles.status,
        organizationName: organizations.name,
        projectName: projects.name,
      }).from(userRoleAssignments)
        .innerJoin(users, eq(userRoleAssignments.userId, users.id))
        .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
        .leftJoin(organizations, eq(userRoleAssignments.organizationId, organizations.id))
        .leftJoin(projects, eq(userRoleAssignments.projectId, projects.id))
        .orderBy(desc(userRoleAssignments.createdAt));
    }),
    /** 某用户已配置的专属操作权限；按业务模块存在专属授权时会覆盖其角色权限矩阵。 */
    userPermissionIds: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({ permissionId: userPermissions.permissionId }).from(userPermissions).where(eq(userPermissions.userId, input.userId));
      return rows.map(row => row.permissionId);
    }),
    setUserPermissions: protectedProcedure.input(z.object({ userId: z.number().int().positive(), permissionIds: z.array(z.number().int().positive()) })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      await ensureFoundationData(db);
      const [targetUsers, permissionRows] = await Promise.all([
        db.select({ id: users.id, name: users.name, role: users.role, loginMethod: users.loginMethod, localAccountStatus: users.localAccountStatus }).from(users).where(eq(users.id, input.userId)).limit(1),
        db.select({ id: systemPermissions.id }).from(systemPermissions),
      ]);
      const target = targetUsers[0];
      if (!target || target.loginMethod === "deleted_local_manager") throw new TRPCError({ code: "NOT_FOUND", message: "该用户不存在或已删除" });
      if (target.role === "admin") throw new TRPCError({ code: "FORBIDDEN", message: "超级管理员默认拥有全量权限，无需配置用户专属操作权限" });
      if (target.localAccountStatus === "disabled") throw new TRPCError({ code: "BAD_REQUEST", message: "请先启用该用户账号后再配置专属操作权限" });
      const activeAssignments = await db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(and(eq(userRoleAssignments.userId, target.id), eq(userRoleAssignments.status, "active"))).limit(1);
      if (!activeAssignments[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "请先为该用户分配有效的岗位、部门或项目范围，再配置专属操作权限" });
      const uniquePermissionIds = Array.from(new Set(input.permissionIds));
      const validPermissionIds = new Set(permissionRows.map(permission => permission.id));
      if (uniquePermissionIds.some(permissionId => !validPermissionIds.has(permissionId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "权限配置中包含无效权限点，请刷新后重新设置" });
      }
      await db.delete(userPermissions).where(eq(userPermissions.userId, target.id));
      if (uniquePermissionIds.length) await db.insert(userPermissions).values(uniquePermissionIds.map(permissionId => ({ userId: target.id, permissionId, grantedBy: admin.id })));
      await db.insert(auditLogs).values({ userId: admin.id, module: "permission", action: "assign_user_permissions", targetType: "user", targetId: String(target.id), summary: `更新用户“${target.name || `用户 #${target.id}`}”的专属操作权限，共 ${uniquePermissionIds.length} 项` });
      dispatchInAppSecurityNotification({
        eventCode: "user_operation_permissions_updated",
        idempotencyKey: `user_operation_permissions_updated:${target.id}:${Date.now()}`,
        recipientUserId: target.id,
        title: "您的专属操作权限已更新",
        content: "管理员已更新您的业务操作权限。请重新打开工作台以同步最新授权。",
        deepLink: "/mobile/profile",
      });
      dispatchOfficialAccountSecurityNotification({ userId: admin.id, module: "security", eventCode: "user_operation_permissions_updated", targetType: "user", targetId: String(target.id), title: "用户专属操作权限已更新", deepLink: "/admin/permission" });
      return { success: true };
    }),
    createLocalUser: protectedProcedure.input(localManagerAccountInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const database = await getDb();
      if (!database) throw new Error("数据库连接暂不可用");
      const localUsername = normalizeLocalManagerUsername(input.username);
      if (!isValidLocalManagerUsername(localUsername)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请输入有效的中国大陆手机号码（11 位）" });
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
        localLoginMode: input.loginMode,
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
        throw new TRPCError({ code: "BAD_REQUEST", message: "请输入有效的中国大陆手机号码（11 位）" });
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
        localLoginMode: input.loginMode,
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
      await database.delete(userPermissions).where(eq(userPermissions.userId, target.id));
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

  /**
   * 微信授权登录管理只向超级管理员开放。查询结果禁止包含 OpenID、授权码、令牌、密钥和设备原始指纹；
   * 账号主键仅供受控解除绑定操作使用，前端不展示。
   */
  wechatLogin: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return [];
      const [bindings, assignments, devices] = await Promise.all([
        db.select({
          userId: officialAccountBindings.userId,
          displayName: users.name,
          localUsername: users.localUsername,
          localAccountStatus: users.localAccountStatus,
          loginMode: users.localLoginMode,
          profileStatus: userProfiles.status,
          positionName: positions.name,
          bindingStatus: officialAccountBindings.status,
          bindingSource: officialAccountBindings.bindingSource,
          boundAt: officialAccountBindings.boundAt,
          lastVerifiedAt: officialAccountBindings.lastVerifiedAt,
          lastFailureAt: officialAccountBindings.lastFailureAt,
          failureCount: officialAccountBindings.failureCount,
          lastSignedIn: users.lastSignedIn,
        }).from(officialAccountBindings)
          .innerJoin(users, eq(officialAccountBindings.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .leftJoin(positions, eq(userProfiles.positionId, positions.id))
          .orderBy(desc(officialAccountBindings.updatedAt)),
        db.select({
          userId: userRoleAssignments.userId,
          roleName: systemRoles.name,
          organizationName: organizations.name,
          projectName: projects.name,
        }).from(userRoleAssignments)
          .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
          .leftJoin(organizations, eq(userRoleAssignments.organizationId, organizations.id))
          .leftJoin(projects, eq(userRoleAssignments.projectId, projects.id))
          .where(eq(userRoleAssignments.status, "active")),
        db.select({
          userId: attendanceDeviceBindings.userId,
          deviceLabel: attendanceDeviceBindings.deviceLabel,
          status: attendanceDeviceBindings.status,
          lastUsedAt: attendanceDeviceBindings.lastUsedAt,
        }).from(attendanceDeviceBindings).where(eq(attendanceDeviceBindings.status, "active")),
      ]);
      const roleMap = new Map<number, string[]>();
      const scopeMap = new Map<number, string[]>();
      for (const assignment of assignments) {
        if (assignment.roleName) roleMap.set(assignment.userId, [...(roleMap.get(assignment.userId) ?? []), assignment.roleName]);
        const scope = assignment.projectName ?? assignment.organizationName;
        if (scope) scopeMap.set(assignment.userId, [...(scopeMap.get(assignment.userId) ?? []), scope]);
      }
      const deviceMap = new Map<number, { label: string | null; lastUsedAt: Date | null }>();
      for (const device of devices) {
        const current = deviceMap.get(device.userId);
        if (!current || (device.lastUsedAt?.getTime() ?? 0) > (current.lastUsedAt?.getTime() ?? 0)) {
          deviceMap.set(device.userId, { label: device.deviceLabel, lastUsedAt: device.lastUsedAt });
        }
      }
      return bindings.map(binding => ({
        ...binding,
        roleNames: Array.from(new Set(roleMap.get(binding.userId) ?? [])),
        scopeNames: Array.from(new Set(scopeMap.get(binding.userId) ?? [])),
        deviceLabel: deviceMap.get(binding.userId)?.label ?? null,
        deviceLastUsedAt: deviceMap.get(binding.userId)?.lastUsedAt ?? null,
      }));
    }),
    revoke: protectedProcedure.input(wechatBindingUserInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const [binding] = await db.select({ id: officialAccountBindings.id, status: officialAccountBindings.status, userId: officialAccountBindings.userId, displayName: users.name })
        .from(officialAccountBindings).innerJoin(users, eq(officialAccountBindings.userId, users.id))
        .where(eq(officialAccountBindings.userId, input.userId)).limit(1);
      if (!binding) throw new TRPCError({ code: "NOT_FOUND", message: "该人员尚未完成微信授权绑定" });
      if (binding.status !== "revoked") {
        await db.update(officialAccountBindings).set({ status: "revoked", lastFailureAt: new Date() }).where(eq(officialAccountBindings.id, binding.id));
        await db.insert(auditLogs).values({
          userId: admin.id,
          module: "security",
          action: "wechat_oauth_binding_revoked",
          targetType: "official_account_binding",
          targetId: String(binding.userId),
          summary: `解除微信授权登录绑定：${binding.displayName || "未命名人员"}；该人员须重新微信授权后方可恢复服务号身份关联`,
        });
      }
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
    /**
     * 服务号接入的五项参数作为一个原子配置组保存并发布，避免管理员逐项草稿/发布造成半配置状态。
     * 敏感字段在后续修订时允许留空，表示保留既有密文；接口永不返回密钥明文。
     */
    saveOfficialAccountConfiguration: protectedProcedure.input(officialAccountConfigurationInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const definitions = [
        { settingKey: "WECHAT_OFFICIAL_APP_ID", displayName: "微信公众号服务号 AppID", value: input.appId, isSensitive: false, remarks: "服务号 AppID；用于员工微信身份绑定和业务通知。" },
        { settingKey: OFFICIAL_ACCOUNT_APP_SECRET_KEY, displayName: "微信公众号服务号 AppSecret", value: input.appSecret, isSensitive: true, remarks: "服务号 AppSecret；仅服务端 AES-GCM 加密托管。" },
        { settingKey: "WECHAT_OFFICIAL_APP_URL", displayName: "公众号业务跳转地址", value: input.appUrl, isSensitive: false, remarks: "正式 HTTPS 站点根地址；用于模板消息跳转和员工 OAuth 绑定回调。" },
        { settingKey: "WECHAT_OFFICIAL_EGRESS_URL", displayName: "微信 API 固定出口网关地址", value: input.egressUrl, isSensitive: false, remarks: "服务端访问微信 API 的固定出口地址。" },
        { settingKey: OFFICIAL_ACCOUNT_EGRESS_SECRET_KEY, displayName: "固定出口网关签名密钥", value: input.egressSigningSecret, isSensitive: true, remarks: "固定出口网关签名密钥；仅服务端 AES-GCM 加密托管。" },
      ] as const;
      const keys = definitions.map(item => item.settingKey);
      const existingRows = await db.select().from(systemSettings).where(inArray(systemSettings.settingKey, keys));
      const existingByKey = new Map(existingRows.map(item => [item.settingKey, item]));

      await db.transaction(async tx => {
        for (const definition of definitions) {
          const existing = existingByKey.get(definition.settingKey);
          const submittedValue = definition.value.trim();
          const preserveExistingSecret = definition.isSensitive && !submittedValue;
          if (!definition.isSensitive && !submittedValue) throw new TRPCError({ code: "BAD_REQUEST", message: `请填写${definition.displayName}` });
          if (preserveExistingSecret && !existing?.secretEncrypted) throw new TRPCError({ code: "BAD_REQUEST", message: `首次配置必须填写${definition.displayName}` });
          assertOfficialAccountSettingContract({ settingKey: definition.settingKey, value: submittedValue, isSensitive: definition.isSensitive });
          const nextValue = submittedValue;
          if (existing) {
            const nextVersion = existing.version + 1;
            const writeResult = await tx.update(systemSettings).set({
              category: "微信公众号服务号",
              displayName: definition.displayName,
              valueJson: definition.isSensitive ? null : nextValue,
              secretEncrypted: definition.isSensitive ? (preserveExistingSecret ? existing.secretEncrypted : encryptSecret(nextValue)) : null,
              valuePreview: definition.isSensitive ? (preserveExistingSecret ? existing.valuePreview : maskSecret(nextValue)) : nextValue.slice(0, 256),
              isSensitive: definition.isSensitive,
              status: "published",
              version: nextVersion,
              publishedAt: new Date(),
              remarks: definition.remarks,
              updatedBy: admin.id,
            }).where(and(eq(systemSettings.id, existing.id), eq(systemSettings.version, existing.version)));
            assertVersionedSettingWrite(writeResult);
            const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
            await tx.insert(configPublishLogs).values({ settingId: existing.id, operation: "publish", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
          } else {
            await tx.insert(systemSettings).values({
              category: "微信公众号服务号",
              settingKey: definition.settingKey,
              displayName: definition.displayName,
              valueJson: definition.isSensitive ? null : nextValue,
              secretEncrypted: definition.isSensitive ? encryptSecret(nextValue) : null,
              valuePreview: definition.isSensitive ? maskSecret(nextValue) : nextValue.slice(0, 256),
              isSensitive: definition.isSensitive,
              status: "published",
              publishedAt: new Date(),
              remarks: definition.remarks,
              updatedBy: admin.id,
            });
          }
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_official_account_configuration", targetType: "official_account", targetId: "configuration_bundle", summary: "一次性保存并发布服务号五项基础配置" });
      });
      const validation = await testPublishedOfficialAccountConfiguration();
      return { success: validation.success, message: validation.message };
    }),
    getExternalAiConfiguration: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { configured: false, enabled: false, baseUrl: "", model: "", apiKeyConfigured: false, apiKeyPreview: null };
      const rows = await db.select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson, valuePreview: systemSettings.valuePreview, secretEncrypted: systemSettings.secretEncrypted, status: systemSettings.status }).from(systemSettings).where(inArray(systemSettings.settingKey, Object.values(EXTERNAL_AI_SETTING_KEYS)));
      const byKey = new Map(rows.map(item => [item.settingKey, item]));
      const baseUrl = byKey.get(EXTERNAL_AI_SETTING_KEYS.baseUrl)?.valueJson ?? "";
      const model = byKey.get(EXTERNAL_AI_SETTING_KEYS.model)?.valueJson ?? "";
      const apiKey = byKey.get(EXTERNAL_AI_SETTING_KEYS.apiKey);
      return { configured: Boolean(baseUrl && model && apiKey?.secretEncrypted), enabled: byKey.get(EXTERNAL_AI_SETTING_KEYS.enabled)?.valueJson === "true", baseUrl, model, apiKeyConfigured: Boolean(apiKey?.secretEncrypted), apiKeyPreview: apiKey?.valuePreview ?? null };
    }),
    saveExternalAiConfiguration: protectedProcedure.input(externalAiApiConfigurationInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const baseUrl = normalizeExternalAiBaseUrl(input.baseUrl);
      const model = normalizeExternalAiModel(input.model);
      const definitions = [
        { settingKey: EXTERNAL_AI_SETTING_KEYS.baseUrl, displayName: "外部 AI API 基础地址", value: baseUrl, isSensitive: false, remarks: "兼容 OpenAI Chat Completions 的公开 HTTPS API 基础地址。" },
        { settingKey: EXTERNAL_AI_SETTING_KEYS.apiKey, displayName: "外部 AI API Key", value: input.apiKey.trim(), isSensitive: true, remarks: "外部 AI API Key；仅服务端 AES-GCM 加密托管。" },
        { settingKey: EXTERNAL_AI_SETTING_KEYS.model, displayName: "外部 AI 模型名称", value: model, isSensitive: false, remarks: "风险管理摘要使用的兼容 OpenAI 模型名称。" },
        { settingKey: EXTERNAL_AI_SETTING_KEYS.enabled, displayName: "启用外部 AI", value: input.enabled ? "true" : "false", isSensitive: false, remarks: "启用时风险管理摘要优先调用外部 AI；失败自动回退。" },
      ] as const;
      const existingRows = await db.select().from(systemSettings).where(inArray(systemSettings.settingKey, definitions.map(item => item.settingKey)));
      const existingByKey = new Map(existingRows.map(item => [item.settingKey, item]));
      const existingSecret = existingByKey.get(EXTERNAL_AI_SETTING_KEYS.apiKey)?.secretEncrypted;
      if (!input.apiKey.trim() && !existingSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "首次配置必须填写外部 AI API Key" });
      await db.transaction(async tx => {
        for (const definition of definitions) {
          const existing = existingByKey.get(definition.settingKey);
          const preserveExistingSecret = definition.isSensitive && !definition.value;
          const secretEncrypted = definition.isSensitive ? (preserveExistingSecret ? existing?.secretEncrypted : encryptSecret(definition.value)) : null;
          if (definition.isSensitive && !secretEncrypted) throw new TRPCError({ code: "BAD_REQUEST", message: "AI API Key 配置不完整" });
          if (existing) {
            const nextVersion = existing.version + 1;
            const writeResult = await tx.update(systemSettings).set({ category: "AI 服务", displayName: definition.displayName, valueJson: definition.isSensitive ? null : definition.value, secretEncrypted, valuePreview: definition.isSensitive ? (preserveExistingSecret ? existing.valuePreview : maskSecret(definition.value)) : definition.value.slice(0, 256), isSensitive: definition.isSensitive, status: "published", version: nextVersion, publishedAt: new Date(), remarks: definition.remarks, updatedBy: admin.id }).where(and(eq(systemSettings.id, existing.id), eq(systemSettings.version, existing.version)));
            assertVersionedSettingWrite(writeResult);
            await tx.insert(configPublishLogs).values({ settingId: existing.id, operation: "publish", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify({ category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks }) });
          } else {
            await tx.insert(systemSettings).values({ category: "AI 服务", settingKey: definition.settingKey, displayName: definition.displayName, valueJson: definition.isSensitive ? null : definition.value, secretEncrypted, valuePreview: definition.isSensitive ? maskSecret(definition.value) : definition.value.slice(0, 256), isSensitive: definition.isSensitive, status: "published", publishedAt: new Date(), remarks: definition.remarks, updatedBy: admin.id });
          }
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_external_ai_configuration", targetType: "external_ai", targetId: "configuration_bundle", summary: `外部 AI API 配置已保存：${input.enabled ? "启用" : "停用"}，模型 ${model}` });
      });
      return { success: true };
    }),
    testExternalAiConfiguration: protectedProcedure.mutation(async ({ ctx }) => {
      const admin = await assertSuperAdmin(ctx);
      const configuration = await getPublishedExternalAiConfiguration();
      if (!configuration) throw new TRPCError({ code: "BAD_REQUEST", message: "请先完整保存外部 AI API 地址、密钥和模型" });
      await testExternalAiConnection(configuration);
      const db = await getDb();
      if (db) await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "test_external_ai_configuration", targetType: "external_ai", targetId: "configuration_bundle", summary: `外部 AI API 连接校验通过：${configuration.baseUrl}，模型 ${configuration.model}` });
      return { success: true, message: "已成功连接 AI API 的模型目录端点；未发送任何项目业务数据。" };
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
    /** 显示所有已接入业务通知场景的模板字段覆盖，不回传服务号密钥、OpenID 或模板原始敏感配置。 */
    officialAccountTemplateCoverage: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      return getOfficialAccountNotificationTemplateCoverage();
    }),
    /** 仅读取服务号私有模板库，供超级管理员在本系统中选择合规模板；不返回 AppSecret 或任何用户标识。 */
    listOfficialAccountTemplates: protectedProcedure.mutation(async ({ ctx }) => {
      const admin = await assertSuperAdmin(ctx);
      const result = await listPublishedOfficialAccountPrivateTemplates();
      const db = await getDb();
      if (db) await db.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "official_account_template_list", targetType: "official_account", targetId: "private_templates", summary: `读取服务号私有模板库：${result.success ? `${result.templates.length} 个` : "失败"}` });
      return result;
    }),
    /**
     * 将微信已核验的私有模板写入模板草稿。模板配置采用唯一键，因此在已有配置时会先把旧值
     * 写入可回退历史，再以草稿状态替换当前值；AppID/AppSecret 等服务号凭据不参与本操作。
     */
    createOfficialAccountTemplateDraft: protectedProcedure.input(z.object({ templateId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const discovered = await listPublishedOfficialAccountPrivateTemplates();
      if (!discovered.success) throw new TRPCError({ code: "BAD_REQUEST", message: discovered.message });
      const selected = discovered.templates.find(template => template.templateId === input.templateId);
      if (!selected) throw new TRPCError({ code: "NOT_FOUND", message: "所选模板不在当前服务号私有模板库中，请重新读取模板列表后再选择。" });
      if (!isPersistentBusinessTemplateEligible(selected)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: getPersistentBusinessTemplateEligibilityMessage(selected) ?? "所选模板不可用于持续业务通知。" });
      }
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const keys = ["WECHAT_OFFICIAL_TEMPLATE_ID", "WECHAT_OFFICIAL_TEMPLATE_FIELDS"];
      const existing = await db.select().from(systemSettings).where(inArray(systemSettings.settingKey, keys));
      const existingByKey = new Map(existing.map(setting => [setting.settingKey, setting]));
      const fieldMappingJson = JSON.stringify(selected.fieldMapping);
      const nextDrafts = [
        { settingKey: "WECHAT_OFFICIAL_TEMPLATE_ID", displayName: "公众号业务通知模板 ID", valueJson: selected.templateId, valuePreview: selected.templateId.slice(0, 256), remarks: `由服务号私有模板库自动选择：${selected.title}`.slice(0, 2000) },
        { settingKey: "WECHAT_OFFICIAL_TEMPLATE_FIELDS", displayName: "公众号模板字段映射", valueJson: fieldMappingJson, valuePreview: fieldMappingJson.slice(0, 256), remarks: "由服务号模板正文中的 .DATA 字段自动生成；发布前请核对字段含义与合规性。" },
      ] as const;
      await db.transaction(async tx => {
        for (const draft of nextDrafts) {
          const current = existingByKey.get(draft.settingKey);
          if (!current) {
            await tx.insert(systemSettings).values({ category: "公众号消息模板", ...draft, isSensitive: false, status: "draft", updatedBy: admin.id });
            continue;
          }
          const nextVersion = current.version + 1;
          const writeResult = await tx.update(systemSettings).set({ category: "公众号消息模板", ...draft, isSensitive: false, status: "draft", publishedAt: null, version: nextVersion, updatedBy: admin.id }).where(and(eq(systemSettings.id, current.id), eq(systemSettings.version, current.version)));
          assertVersionedSettingWrite(writeResult);
          const snapshot = { category: current.category, settingKey: current.settingKey, displayName: current.displayName, valueJson: current.valueJson, secretEncrypted: current.secretEncrypted, valuePreview: current.valuePreview, isSensitive: current.isSensitive, remarks: current.remarks };
          await tx.insert(configPublishLogs).values({ settingId: current.id, operation: "update", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "official_account_template_draft", targetType: "official_account_template", targetId: selected.templateId, summary: `从服务号私有模板库生成模板配置草稿：${selected.title}；安全替换 ${existing.length} 项旧模板配置` });
      });
      return { success: true, replacedExisting: existing.length > 0, message: existing.length ? "新模板草稿已生成；旧模板值已写入可回退历史。请在配置清单核对后发布模板 ID 与字段映射。草稿期间业务模板通知会暂停，避免新旧模板混用。" : "模板 ID 与字段映射草稿已生成。请在配置清单核对后分别发布，业务通知才会启用。" };
    }),
    /** 将已核验的私有模板直接绑定到一个业务模块；字段映射由模板 .DATA 字段自动生成并立即发布。 */
    bindOfficialAccountModuleTemplate: protectedProcedure.input(z.object({
      templateId: z.string().min(1).max(128),
      module: z.enum(["purchasing", "measurement", "finance", "machinery", "transport", "security", "labor", "construction"]),
    })).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const discovered = await listPublishedOfficialAccountPrivateTemplates();
      if (!discovered.success) throw new TRPCError({ code: "BAD_REQUEST", message: discovered.message });
      const selected = discovered.templates.find(template => template.templateId === input.templateId);
      if (!selected) throw new TRPCError({ code: "NOT_FOUND", message: "所选模板不在当前服务号私有模板库中，请重新读取模板列表后再选择。" });
      if (!isPersistentBusinessTemplateEligible(selected)) throw new TRPCError({ code: "BAD_REQUEST", message: getPersistentBusinessTemplateEligibilityMessage(selected) ?? "所选模板不可用于持续业务通知。" });
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const settingKey = "WECHAT_OFFICIAL_MODULE_TEMPLATE_MAPPINGS";
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, settingKey)).limit(1);
      let mappings: Record<string, { templateId: string; title: string; templateFields: Record<string, string> }> = {};
      if (existing?.valueJson) {
        try {
          const parsed = JSON.parse(existing.valueJson) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) mappings = parsed as typeof mappings;
        } catch { /* 损坏配置在本次安全替换时重建 */ }
      }
      mappings[input.module] = { templateId: selected.templateId, title: selected.title, templateFields: selected.fieldMapping };
      const valueJson = JSON.stringify(mappings);
      await db.transaction(async tx => {
        if (existing) {
          const nextVersion = existing.version + 1;
          const writeResult = await tx.update(systemSettings).set({
            category: "公众号消息模板", displayName: "公众号业务模块模板绑定", valueJson, valuePreview: `已绑定 ${Object.keys(mappings).length} 个业务模块`, isSensitive: false,
            status: "published", publishedAt: new Date(), version: nextVersion, remarks: "按业务模块自动选择私有模板并生成字段映射，无需手填内部占位符。", updatedBy: admin.id,
          }).where(and(eq(systemSettings.id, existing.id), eq(systemSettings.version, existing.version)));
          assertVersionedSettingWrite(writeResult);
          const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
          await tx.insert(configPublishLogs).values({ settingId: existing.id, operation: "publish", version: nextVersion, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
        } else {
          await tx.insert(systemSettings).values({ category: "公众号消息模板", settingKey, displayName: "公众号业务模块模板绑定", valueJson, valuePreview: `已绑定 1 个业务模块`, isSensitive: false, status: "published", publishedAt: new Date(), remarks: "按业务模块自动选择私有模板并生成字段映射，无需手填内部占位符。", updatedBy: admin.id });
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "official_account_module_template_bind", targetType: "official_account_template", targetId: `${input.module}:${selected.templateId}`, summary: `绑定服务号模板：${input.module} -> ${selected.title}` });
      });
      return { success: true, message: `已将“${selected.title}”绑定到${input.module}模块，系统已自动完成字段映射并发布。` };
    }),
    /** 读取已发布的工程水印模板；模板仅控制显示顺序和文案，不接收或保存现场人员输入。 */
    evidenceWatermarkTemplate: protectedProcedure.query(async ({ ctx }) => {
      await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) return { template: normalizeEvidenceWatermarkTemplate(null), version: 0, status: "default" as const };
      const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, WATERMARK_TEMPLATE_SETTING_KEY)).limit(1);
      let template = normalizeEvidenceWatermarkTemplate(null);
      try { template = normalizeEvidenceWatermarkTemplate(setting?.valueJson ? JSON.parse(setting.valueJson) : null); } catch { /* 安全降级到默认模板 */ }
      return { template, version: setting?.version ?? 0, status: setting?.status ?? "default" as const };
    }),
    /** 超级管理员保存并立即发布工程水印模板，同时生成可回滚的设置历史和操作审计。 */
    saveEvidenceWatermarkTemplate: protectedProcedure.input(evidenceWatermarkTemplateInput).mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      const db = await getDb();
      if (!db) throw new Error("数据库连接暂不可用");
      const valueJson = JSON.stringify(input);
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, WATERMARK_TEMPLATE_SETTING_KEY)).limit(1);
      let version = 1;
      await db.transaction(async tx => {
        if (existing) {
          version = existing.version + 1;
          const snapshot = { category: existing.category, settingKey: existing.settingKey, displayName: existing.displayName, valueJson: existing.valueJson, secretEncrypted: existing.secretEncrypted, valuePreview: existing.valuePreview, isSensitive: existing.isSensitive, remarks: existing.remarks };
          const writeResult = await tx.update(systemSettings).set({ category: "文档影像", displayName: "工程水印信息模板", valueJson, valuePreview: `${input.title} · ${input.fields.length} 项信息`, isSensitive: false, secretEncrypted: null, status: "published", version, publishedAt: new Date(), remarks: "控制工程水印信息卡的字段开关、顺序和展示文案；现场实际信息在采集时生成。", updatedBy: admin.id }).where(and(eq(systemSettings.id, existing.id), eq(systemSettings.version, existing.version)));
          assertVersionedSettingWrite(writeResult);
          await tx.insert(configPublishLogs).values({ settingId: existing.id, operation: "publish", version, operatorId: admin.id, snapshotJson: JSON.stringify(snapshot) });
        } else {
          await tx.insert(systemSettings).values({ category: "文档影像", settingKey: WATERMARK_TEMPLATE_SETTING_KEY, displayName: "工程水印信息模板", valueJson, valuePreview: `${input.title} · ${input.fields.length} 项信息`, isSensitive: false, status: "published", publishedAt: new Date(), remarks: "控制工程水印信息卡的字段开关、顺序和展示文案；现场实际信息在采集时生成。", updatedBy: admin.id });
        }
        await tx.insert(auditLogs).values({ userId: admin.id, module: "settings", action: "save_evidence_watermark_template", targetType: "setting", targetId: WATERMARK_TEMPLATE_SETTING_KEY, summary: `发布工程水印模板：${input.title}，启用 ${input.fields.length} 项信息` });
      });
      return { success: true, version };
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
