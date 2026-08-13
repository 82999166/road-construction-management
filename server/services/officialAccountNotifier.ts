import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, notificationRecords, officialAccountBindings, organizations, systemRoles, systemSettings, userProfiles, userRoleAssignments } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

const OFFICIAL_ACCOUNT_CONFIG_KEYS = [
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_APP_SECRET",
  "WECHAT_OFFICIAL_TEMPLATE_ID",
  "WECHAT_OFFICIAL_TEMPLATE_FIELDS",
  "WECHAT_OFFICIAL_APP_URL",
  "WECHAT_OFFICIAL_EVENT_TOKEN",
  "WECHAT_OFFICIAL_EVENT_AES_KEY",
] as const;

type OfficialAccountConfigKey = (typeof OFFICIAL_ACCOUNT_CONFIG_KEYS)[number];
export type OfficialAccountConfig = { appId: string; appSecret: string; templateId: string; templateFields: Record<string, string>; appUrl: string | null };
export type OfficialAccountCredentialConfig = { appId: string; appSecret: string; appUrl: string | null };
export type OfficialAccountEventConfig = OfficialAccountCredentialConfig & { eventToken: string; eventAesKey: string };
export type OfficialAccountPrivateTemplate = {
  templateId: string;
  title: string;
  content: string;
  fieldMapping: Record<string, string>;
};

export type OfficialAccountNotificationResult = {
  delivered: boolean;
  reason: "sent" | "duplicate" | "not_bound" | "not_configured" | "disabled" | "invalid_config" | "delivery_failed" | "database_unavailable";
  providerMessageId?: string;
};

export type OfficialAccountBusinessEvent = {
  userId: number;
  recipientUserIds?: number[];
  /** 可选业务范围，用于将项目或组织内的管理岗位纳入上级主管收件人。 */
  projectId?: number;
  organizationId?: number;
  module: "purchasing" | "measurement" | "finance" | "machinery" | "transport" | "security" | "labor" | "construction";
  eventCode: string;
  targetType: string;
  targetId: string;
  title: string;
  content?: string;
  deepLink?: string;
};

export type OfficialAccountNotificationTemplateCoverage = {
  module: OfficialAccountBusinessEvent["module"];
  name: string;
  events: string[];
  deepLink: string;
  purpose: string;
  requiredVariables: Array<"title" | "content" | "eventCode" | "targetType" | "targetId">;
};

/** 当前认证服务号使用已发布的业务模板承载多类受控提醒；矩阵定义每类事件的消息语义与字段需求。 */
export const OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX: OfficialAccountNotificationTemplateCoverage[] = [
  { module: "construction", name: "施工日报与现场审核", events: ["construction_daily_report_created", "construction_daily_report_updated", "construction_daily_report_submitted", "construction_daily_report_approved", "construction_daily_report_rejected", "construction_daily_report_locked"], deepLink: "/mobile/construction", purpose: "施工日报录入、修改、审核和归档提醒", requiredVariables: ["title", "content", "eventCode"] },
  { module: "purchasing", name: "采购申请与订单审核", events: ["purchase_request_submitted", "purchase_request_approved", "purchase_request_rejected", "purchase_order_small_direct_submitted", "purchase_order_confirmed", "purchase_order_received", "purchase_order_settlement"], deepLink: "/mobile/purchasing", purpose: "常规采购申请、小额免申请订单、收货和结算提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "transport", name: "运输刷卡与趟次闭环", events: ["transport_card_event_exception", "transport_load_card_confirmed", "transport_unload_card_confirmed", "transport_load_driver_notice", "transport_unload_driver_notice", "transport_trip_confirmed", "transport_trip_completed"], deepLink: "/mobile/transport", purpose: "装土、卸土刷卡、司机通知、异常复核和趟次状态提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "finance", name: "财务流水与审计处理", events: ["financial_income", "financial_expense", "financial_voided", "financial_reversed"], deepLink: "/mobile/finance", purpose: "项目收支登记、作废和冲销提醒", requiredVariables: ["title", "content", "eventCode"] },
  { module: "measurement", name: "收方、计量与回款", events: ["takeoff_submitted", "takeoff_reviewed", "takeoff_approved", "takeoff_locked", "measurement_submitted", "measurement_approved", "measurement_payment"], deepLink: "/mobile/measurement", purpose: "项目收方、工程计量、审核锁定及回款提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "labor", name: "劳务实名、证照与工资", events: ["labor_identity_verified", "labor_certificate_archived", "payroll_submitted", "payroll_paid", "payroll_voided"], deepLink: "/mobile/labor", purpose: "实名核验、证照归档、工资审核与发放提醒", requiredVariables: ["title", "content", "eventCode"] },
  { module: "machinery", name: "机械成本审核", events: ["machine_cost_submitted", "machine_cost_approved", "machine_cost_rejected", "machine_cost_locked"], deepLink: "/mobile/machinery", purpose: "机械成本登记和审核提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "security", name: "系统安全与连接告警", events: ["system_connector_test_failed", "role_permissions_updated"], deepLink: "/admin/settings", purpose: "权限变更和外部连接失败提醒", requiredVariables: ["title", "content", "eventCode"] },
];

let tokenCache: { appId: string; token: string; expiresAt: number } | null = null;

function buildDeepLink(appUrl: string | null, deepLink: string | undefined) {
  if (!appUrl || !deepLink || !deepLink.startsWith("/") || deepLink.startsWith("//")) return undefined;
  try {
    const base = new URL(appUrl);
    if (base.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(base.hostname)) return undefined;
    return new URL(deepLink, base).toString();
  } catch {
    return undefined;
  }
}

function parseTemplateFields(rawValue: string | null) {
  if (!rawValue?.trim()) return { first: "{title}", keyword1: "{targetType} #{targetId}", keyword2: "{content}", remark: "点击查看系统详情" };
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    const values = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string");
    if (!values.length || values.length > 12) throw new Error("invalid fields");
    return Object.fromEntries(values.map(([key, value]) => [key.slice(0, 64), value.slice(0, 180)]));
  } catch {
    throw new Error("服务号模板字段映射必须是 JSON 对象");
  }
}

function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{(title|content|eventCode|targetType|targetId)\}/g, (_match, key: string) => variables[key] ?? "");
}

/**
 * 有些服务号私有模板只有一个可填字段。对此类模板将业务标题、摘要和事件编码压缩到同一字段，
 * 既避免向微信提交空字段，也避免后台把可安全投递的模板错误标注为“字段缺失”。
 */
export function usesSingleFieldSummaryCompatibility(templateFields: Record<string, string>) {
  return Object.keys(templateFields).length === 1;
}

export function buildSingleFieldSummary(variables: Record<string, string>) {
  return `${variables.title}｜${variables.content}｜${variables.eventCode}`.slice(0, 200);
}

export async function loadPublishedOfficialAccountConfig(): Promise<{ config?: OfficialAccountConfig; reason?: OfficialAccountNotificationResult["reason"] }> {
  const db = await getDb();
  if (!db) return { reason: "database_unavailable" };
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, [...OFFICIAL_ACCOUNT_CONFIG_KEYS])));
  const settings = new Map<OfficialAccountConfigKey, (typeof rows)[number]>();
  for (const row of rows) if ((OFFICIAL_ACCOUNT_CONFIG_KEYS as readonly string[]).includes(row.settingKey)) settings.set(row.settingKey as OfficialAccountConfigKey, row);
  const appId = settings.get("WECHAT_OFFICIAL_APP_ID")?.valueJson?.trim();
  const appSecretEncrypted = settings.get("WECHAT_OFFICIAL_APP_SECRET")?.secretEncrypted;
  const templateId = settings.get("WECHAT_OFFICIAL_TEMPLATE_ID")?.valueJson?.trim();
  if (!appId || !appSecretEncrypted || !templateId) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    return {
      config: {
        appId,
        appSecret: decryptSecret(appSecretEncrypted),
        templateId,
        templateFields: parseTemplateFields(settings.get("WECHAT_OFFICIAL_TEMPLATE_FIELDS")?.valueJson ?? null),
        appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null,
      },
    };
  } catch {
    return { reason: "invalid_config" };
  }
}

/** 后台仅显示字段覆盖结论和业务语义，不返回 AppSecret、OpenID 或模板敏感配置。 */
export async function getOfficialAccountNotificationTemplateCoverage() {
  const result = await loadPublishedOfficialAccountConfig();
  const fieldValues = result.config ? Object.values(result.config.templateFields) : [];
  const variables = new Set(fieldValues.flatMap(value => Array.from(value.matchAll(/\{(title|content|eventCode|targetType|targetId)\}/g)).map(match => match[1])));
  const singleFieldSummaryCompatibility = Boolean(result.config && usesSingleFieldSummaryCompatibility(result.config.templateFields));
  return {
    configured: Boolean(result.config),
    reason: result.reason ?? null,
    matrix: OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX.map(item => ({
      ...item,
      missingVariables: singleFieldSummaryCompatibility ? [] : item.requiredVariables.filter(variable => !variables.has(variable)),
      ready: Boolean(result.config) && (singleFieldSummaryCompatibility || item.requiredVariables.every(variable => variables.has(variable))),
      compatibilityMode: singleFieldSummaryCompatibility ? "single_field_summary" as const : null,
    })),
  };
}

/**
 * 新版微信开发者平台将 AppID/AppSecret 管理与消息模板能力分离。
 * 网页 OAuth 绑定和凭据连通性校验只需要已发布的 AppID、AppSecret 与 HTTPS 站点地址；
 * 业务模板通知仍由 loadPublishedOfficialAccountConfig 额外要求模板 ID。
 */
export async function loadPublishedOfficialAccountCredentials(): Promise<{ config?: OfficialAccountCredentialConfig; reason?: OfficialAccountNotificationResult["reason"] }> {
  const db = await getDb();
  if (!db) return { reason: "database_unavailable" };
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_APP_URL"])));
  const settings = new Map<string, (typeof rows)[number]>();
  for (const row of rows) settings.set(row.settingKey, row);
  const appId = settings.get("WECHAT_OFFICIAL_APP_ID")?.valueJson?.trim();
  const appSecretEncrypted = settings.get("WECHAT_OFFICIAL_APP_SECRET")?.secretEncrypted;
  if (!appId || !appSecretEncrypted) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    return { config: { appId, appSecret: decryptSecret(appSecretEncrypted), appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null } };
  } catch {
    return { reason: "invalid_config" };
  }
}

/** 消息与事件推送回调只读取后台已发布的敏感配置，避免 Token 和 AESKey 进入前端或环境变量。 */
export async function loadPublishedOfficialAccountEventConfig(): Promise<{ config?: OfficialAccountEventConfig; reason?: OfficialAccountNotificationResult["reason"] }> {
  const db = await getDb();
  if (!db) return { reason: "database_unavailable" };
  const keys = ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_APP_URL", "WECHAT_OFFICIAL_EVENT_TOKEN", "WECHAT_OFFICIAL_EVENT_AES_KEY"];
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, keys)));
  const settings = new Map<string, (typeof rows)[number]>();
  for (const row of rows) settings.set(row.settingKey, row);
  const appId = settings.get("WECHAT_OFFICIAL_APP_ID")?.valueJson?.trim();
  const appSecretEncrypted = settings.get("WECHAT_OFFICIAL_APP_SECRET")?.secretEncrypted;
  const tokenEncrypted = settings.get("WECHAT_OFFICIAL_EVENT_TOKEN")?.secretEncrypted;
  const aesEncrypted = settings.get("WECHAT_OFFICIAL_EVENT_AES_KEY")?.secretEncrypted;
  if (!appId || !appSecretEncrypted || !tokenEncrypted || !aesEncrypted) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    const eventToken = decryptSecret(tokenEncrypted);
    const eventAesKey = decryptSecret(aesEncrypted);
    if (!/^[A-Za-z0-9]{3,32}$/.test(eventToken) || !/^[A-Za-z0-9]{43}$/.test(eventAesKey)) return { reason: "invalid_config" };
    return { config: { appId, appSecret: decryptSecret(appSecretEncrypted), appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null, eventToken, eventAesKey } };
  } catch {
    return { reason: "invalid_config" };
  }
}

export async function getOfficialAccountAccessToken(config: OfficialAccountConfig | (OfficialAccountCredentialConfig & { templateId?: string; templateFields?: Record<string, string> })) {
  if (tokenCache && tokenCache.appId === config.appId && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);
  const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string } | null;
  if (!response.ok || !payload?.access_token) {
    const code = String(payload?.errcode ?? response.status).slice(0, 24);
    const detail = typeof payload?.errmsg === "string" ? payload.errmsg.replace(/[\r\n]+/g, " ").slice(0, 220) : "";
    throw new Error(`token_${code}${detail ? `:${detail}` : ""}`);
  }
  tokenCache = { appId: config.appId, token: payload.access_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 7200) - 120) * 1_000 };
  return tokenCache.token;
}

async function resolveSupervisorRecipientIds(event: OfficialAccountBusinessEvent) {
  const db = await getDb();
  if (!db) return [];
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, event.userId)).limit(1);
  const originOrganizationId = event.organizationId ?? profile?.organizationId ?? null;
  const recipientIds = new Set<number>();
  const organizationIds = new Set<number>();
  if (originOrganizationId) {
    const rows = await db.select({ id: organizations.id, parentId: organizations.parentId, managerUserId: organizations.managerUserId, status: organizations.status }).from(organizations);
    const byId = new Map(rows.map(row => [row.id, row]));
    let currentId: number | null = originOrganizationId;
    for (let depth = 0; currentId && depth < 16; depth += 1) {
      const organization = byId.get(currentId);
      if (!organization) break;
      organizationIds.add(organization.id);
      if (organization.status === "active" && organization.managerUserId) recipientIds.add(organization.managerUserId);
      currentId = organization.parentId;
    }
  }
  const now = new Date();
  const managementRoleCodes = ["PROJECT_MANAGER", "FINANCE_MANAGER", "TRANSPORT_MANAGER", "CONSTRUCTION_MANAGER", "SUPER_ADMIN"];
  const assignments = await db
    .select({ userId: userRoleAssignments.userId, projectId: userRoleAssignments.projectId, organizationId: userRoleAssignments.organizationId, validFrom: userRoleAssignments.validFrom, validTo: userRoleAssignments.validTo, roleCode: systemRoles.code })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
    .where(and(eq(userRoleAssignments.status, "active"), eq(systemRoles.status, "active"), inArray(systemRoles.code, managementRoleCodes)));
  for (const assignment of assignments) {
    const isEffective = (!assignment.validFrom || assignment.validFrom <= now) && (!assignment.validTo || assignment.validTo > now);
    const isScopeMatch = assignment.roleCode === "SUPER_ADMIN" ||
      (event.projectId !== undefined && assignment.projectId === event.projectId) ||
      (assignment.organizationId !== null && organizationIds.has(assignment.organizationId));
    if (isEffective && isScopeMatch) recipientIds.add(assignment.userId);
  }
  recipientIds.delete(event.userId);
  return Array.from(recipientIds);
}

async function writeAudit(userId: number, event: OfficialAccountBusinessEvent, recipientUserId: number, reason: OfficialAccountNotificationResult["reason"]) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values({ userId, module: event.module, action: "official_account_delivery", targetType: event.targetType, targetId: event.targetId, summary: `公众号通知 ${event.eventCode} -> 用户 #${recipientUserId}：${reason}` });
  } catch {
    // 投递审计失败不能反向影响已完成的主业务。
  }
}

/** 向一个已绑定人员发送服务号模板通知；失败只落审计和站内记录，不回滚业务。 */
export async function sendOfficialAccountNotification(input: { eventCode: string; idempotencyKey: string; recipientUserId: number; title: string; content: string; deepLink?: string }): Promise<OfficialAccountNotificationResult> {
  const db = await getDb();
  if (!db) return { delivered: false, reason: "database_unavailable" };
  const idempotencyKey = input.idempotencyKey.slice(0, 160);
  const [existing] = await db.select({ id: notificationRecords.id, status: notificationRecords.status }).from(notificationRecords).where(eq(notificationRecords.idempotencyKey, idempotencyKey)).limit(1);
  if (existing?.status === "sent" || existing?.status === "pending" || existing?.status === "read") return { delivered: false, reason: "duplicate" };
  if (existing) {
    await db.update(notificationRecords).set({
      status: "pending",
      retryCount: sql`${notificationRecords.retryCount} + 1`,
      failureCode: null,
      lastAttemptedAt: new Date(),
      title: input.title.slice(0, 200),
      content: input.content.slice(0, 1500),
      deepLink: input.deepLink?.slice(0, 512) ?? null,
    }).where(eq(notificationRecords.id, existing.id));
  } else {
    try {
      await db.insert(notificationRecords).values({
        eventCode: input.eventCode.slice(0, 128), idempotencyKey, recipientUserId: input.recipientUserId,
        title: input.title.slice(0, 200), content: input.content.slice(0, 1500), deepLink: input.deepLink?.slice(0, 512) ?? null,
        channel: "official_account", status: "pending", lastAttemptedAt: new Date(),
      });
    } catch {
      return { delivered: false, reason: "duplicate" };
    }
  }
  const update = async (result: OfficialAccountNotificationResult, values: Record<string, unknown>) => {
    await db.update(notificationRecords).set(values).where(eq(notificationRecords.idempotencyKey, idempotencyKey));
    return result;
  };
  const [binding] = await db.select().from(officialAccountBindings).where(and(eq(officialAccountBindings.userId, input.recipientUserId), eq(officialAccountBindings.status, "active"))).limit(1);
  if (!binding) return update({ delivered: false, reason: "not_bound" }, { status: "skipped", failureCode: "not_bound" });
  const configResult = await loadPublishedOfficialAccountConfig();
  if (!configResult.config) return update({ delivered: false, reason: configResult.reason ?? "not_configured" }, { status: "failed", failureCode: configResult.reason ?? "not_configured" });
  try {
    const openId = decryptSecret(binding.openIdEncrypted);
    const token = await getOfficialAccountAccessToken(configResult.config);
    const variables = { title: input.title.slice(0, 120), content: input.content.slice(0, 160), eventCode: input.eventCode.slice(0, 64), targetType: "业务事项", targetId: input.eventCode.slice(0, 64) };
    const singleFieldSummaryCompatibility = usesSingleFieldSummaryCompatibility(configResult.config.templateFields);
    const data = Object.fromEntries(Object.entries(configResult.config.templateFields).map(([key, value]) => [key, {
      value: (singleFieldSummaryCompatibility ? buildSingleFieldSummary(variables) : renderTemplate(value, variables)).slice(0, 200),
    }]));
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ touser: openId, template_id: configResult.config.templateId, url: buildDeepLink(configResult.config.appUrl, input.deepLink), data }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as { errcode?: number; msgid?: number | string } | null;
    if (!response.ok || payload?.errcode !== 0) {
      const failureCode = String(payload?.errcode ?? response.status).slice(0, 64);
      await db.update(officialAccountBindings).set({ lastFailureAt: new Date(), failureCount: binding.failureCount + 1 }).where(eq(officialAccountBindings.id, binding.id));
      return update({ delivered: false, reason: "delivery_failed" }, { status: "failed", failureCode });
    }
    await db.update(officialAccountBindings).set({ lastVerifiedAt: new Date(), failureCount: 0 }).where(eq(officialAccountBindings.id, binding.id));
    return update({ delivered: true, reason: "sent", providerMessageId: payload.msgid ? String(payload.msgid) : undefined }, { status: "sent", sentAt: new Date(), providerMessageId: payload.msgid ? String(payload.msgid) : null, failureCode: null });
  } catch {
    return update({ delivered: false, reason: "delivery_failed" }, { status: "failed", failureCode: "request_failed" });
  }
}

/** 默认收件人为发起人的直属主管；审核人、司机等可由调用方明确传入。 */
export async function notifyOfficialAccountBusinessEvent(event: OfficialAccountBusinessEvent) {
  const resolved = event.recipientUserIds?.length ? event.recipientUserIds : await resolveSupervisorRecipientIds(event);
  const recipients = Array.from(new Set((resolved.length ? resolved : [event.userId]).filter(Number.isInteger)));
  const content = (event.content || `${event.title}，请进入系统查看。`).replace(/[\r\n]+/g, " ").slice(0, 180);
  return Promise.all(recipients.map(async recipientUserId => {
    const result = await sendOfficialAccountNotification({ eventCode: event.eventCode, idempotencyKey: `oa:${event.eventCode}:${event.targetType}:${event.targetId}:${recipientUserId}`, recipientUserId, title: event.title, content, deepLink: event.deepLink });
    await writeAudit(event.userId, event, recipientUserId, result.reason);
    return { recipientUserId, ...result };
  }));
}

/** 后台测试只验证已发布服务号凭据可换取令牌，不向员工推送任何测试消息。 */
export async function testPublishedOfficialAccountConfiguration() {
  const credentialResult = await loadPublishedOfficialAccountCredentials();
  if (!credentialResult.config) return { success: false, message: credentialResult.reason === "not_configured" ? "尚未发布 AppID 与 AppSecret；请在微信开发者平台启用 AppSecret 后保存并发布" : "AppID 或 AppSecret 未发布、已冻结或格式无效" };
  try {
    await getOfficialAccountAccessToken(credentialResult.config);
    const messageConfig = await loadPublishedOfficialAccountConfig();
    return { success: true, message: messageConfig.config ? "服务号凭据校验通过，模板消息已配置；未向任何人员发送测试消息" : "服务号凭据校验通过；模板消息尚未配置，员工绑定可继续，业务通知将在模板配置发布后启用" };
  } catch (error) {
    const providerError = error instanceof Error ? error.message.match(/^token_([^:]+)(?::(.+))?$/) : null;
    const code = providerError?.[1];
    const detail = providerError?.[2]?.replace(/[\r\n]+/g, " ").slice(0, 220);
    if (code === "40164") return { success: false, message: `微信返回 40164：当前调用出口不在 API IP 白名单。${detail ? `微信诊断：${detail}。` : ""}请将提示中的实际 IP 追加到“微信开发者平台 → 我的业务 → 服务号 → 基础信息 → 开发密钥 → API IP 白名单”。` };
    if (code === "40243") return { success: false, message: "微信返回 40243：AppSecret 当前处于冻结状态。请在微信开发者平台 → 我的业务 → 服务号 → 基础信息 → 开发密钥中解冻，等待约 10 分钟后再校验。" };
    if (code) return { success: false, message: `微信拒绝 access_token 请求（错误码 ${code}${detail ? `，${detail}` : ""}）。请核对 AppSecret 是否已启用、未被重置，并检查 API IP 白名单。` };
    return { success: false, message: "无法连接微信 access_token 接口。请检查网络、AppSecret 启用状态和 API IP 白名单后重试。" };
  }
}

function deriveTemplateFieldMapping(content: string) {
  const fields = Array.from(new Set(Array.from(content.matchAll(/\{\{([A-Za-z0-9_]+)\.DATA\}\}/g)).map(match => match[1]).filter((field): field is string => Boolean(field))));
  const fallbackFields = fields.length ? fields : ["first", "keyword1", "keyword2", "remark"];
  return Object.fromEntries(fallbackFields.map((field, index) => {
    if (field === "first") return [field, "{title}"];
    if (field === "remark") return [field, "点击查看系统详情"];
    if (index === 1) return [field, "{content}"];
    return [field, "{targetType} #{targetId}"];
  }));
}

/** 从已发布服务号的私有模板库读取可选模板；模板内容可由超级管理员查看，密钥和 OpenID 永不返回。 */
export async function listPublishedOfficialAccountPrivateTemplates(): Promise<{ success: boolean; message: string; templates: OfficialAccountPrivateTemplate[] }> {
  const credentialResult = await loadPublishedOfficialAccountCredentials();
  if (!credentialResult.config) return { success: false, message: "请先发布 AppID 与 AppSecret，再读取服务号私有模板库。", templates: [] };
  try {
    const token = await getOfficialAccountAccessToken(credentialResult.config);
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=${encodeURIComponent(token)}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as { errcode?: number; errmsg?: string; template_list?: Array<{ template_id?: string; title?: string; content?: string }> } | null;
    if (!response.ok || payload?.errcode) {
      const code = String(payload?.errcode ?? response.status).slice(0, 24);
      const detail = typeof payload?.errmsg === "string" ? payload.errmsg.replace(/[\r\n]+/g, " ").slice(0, 180) : "";
      if (code === "48001") return { success: false, message: "微信返回 48001：当前服务号尚未获得模板消息接口权限。请在服务号后台“功能 → 添加功能插件”申请并开通“模板消息”，完成服务类目设置后再检测。", templates: [] };
      return { success: false, message: `无法读取服务号模板消息能力（错误码 ${code}${detail ? `，${detail}` : ""}）。请检查模板消息功能插件、服务类目和接口权限。`, templates: [] };
    }
    const templates = (payload?.template_list ?? [])
      .filter((template): template is Required<Pick<typeof template, "template_id" | "title" | "content">> => Boolean(template.template_id && template.title && template.content))
      .slice(0, 25)
      .map(template => ({ templateId: template.template_id.slice(0, 128), title: template.title.slice(0, 160), content: template.content.slice(0, 1600), fieldMapping: deriveTemplateFieldMapping(template.content) }));
    return { success: true, message: templates.length ? `已读取 ${templates.length} 个私有模板；请选择符合施工业务通知场景的模板生成系统草稿。` : "模板消息功能已开通，但私有模板库暂无可用模板。请在服务号后台设置服务类目后，从公共模板库选用合规业务通知模板。", templates };
  } catch {
    return { success: false, message: "模板消息能力检测无法连接微信接口。请先执行“校验开发密钥”，确认 AppSecret 与 API IP 白名单已通过。", templates: [] };
  }
}

/**
 * 认证服务号新版后台中的“通知中心”只展示平台公告，模板消息能力须通过功能插件开通。
 * 本检测仅读取当前账号的私有模板列表，不发送消息、不返回任何密钥或 OpenID。
 */
export async function inspectPublishedOfficialAccountTemplateCapability() {
  const result = await listPublishedOfficialAccountPrivateTemplates();
  return { success: result.success, message: result.success && result.templates.length ? `模板消息功能已开通，当前私有模板库共有 ${result.templates.length} 个模板。请选择合规业务通知模板并将其模板 ID 填入系统。` : result.message };
}

/** OpenID 仅以该指纹进行去重查询，永不返回或展示原始值。 */
export function fingerprintOfficialAccountOpenId(openId: string) {
  return createHash("sha256").update(openId, "utf8").digest("hex");
}
