import { createHash } from "node:crypto";
import { createHmac } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, notificationRecords, officialAccountBindings, organizations, systemRoles, systemSettings, userProfiles, userRoleAssignments } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

const OFFICIAL_ACCOUNT_CONFIG_KEYS = [
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_APP_SECRET",
  "WECHAT_OFFICIAL_TEMPLATE_ID",
  "WECHAT_OFFICIAL_TEMPLATE_FIELDS",
  "WECHAT_OFFICIAL_MODULE_TEMPLATE_MAPPINGS",
  "WECHAT_OFFICIAL_APP_URL",
  "WECHAT_OFFICIAL_EGRESS_URL",
  "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET",
  "WECHAT_OFFICIAL_EVENT_TOKEN",
  "WECHAT_OFFICIAL_EVENT_AES_KEY",
] as const;

type OfficialAccountConfigKey = (typeof OFFICIAL_ACCOUNT_CONFIG_KEYS)[number];
type OfficialAccountEgressConfig = { egressUrl?: string; egressSharedSecret?: string };
export type OfficialAccountModule = "purchasing" | "measurement" | "finance" | "machinery" | "transport" | "security" | "labor" | "construction" | "diesel" | "contract";
type OfficialAccountTemplateBinding = { templateId: string; title: string; templateFields: Record<string, string> };
export type OfficialAccountConfig = { appId: string; appSecret: string; appUrl: string | null; moduleTemplates: Partial<Record<OfficialAccountModule, OfficialAccountTemplateBinding>>; fallbackTemplate?: OfficialAccountTemplateBinding } & OfficialAccountEgressConfig;
export type OfficialAccountCredentialConfig = { appId: string; appSecret: string; appUrl: string | null } & OfficialAccountEgressConfig;
export type OfficialAccountEventConfig = OfficialAccountCredentialConfig & { eventToken: string; eventAesKey: string };
export type OfficialAccountPrivateTemplate = {
  templateId: string;
  title: string;
  content: string;
  fieldMapping: Record<string, string>;
  persistentBusinessEligible?: boolean;
  eligibilityMessage?: string;
};

export type OfficialAccountNotificationResult = {
  delivered: boolean;
  reason: "sent" | "duplicate" | "not_bound" | "not_configured" | "disabled" | "invalid_config" | "delivery_failed" | "database_unavailable";
  providerMessageId?: string;
};

/** 关注状态只能由微信用户信息接口的明确 subscribe 结果确认；投递错误本身不足以直接判定用户已取关。 */
export type OfficialAccountFollowVerification = {
  status: "active" | "unsubscribed" | "unbound" | "unavailable" | "verification_failed" | "disabled";
  failureCode?: string;
};

export type OfficialAccountBusinessEvent = {
  userId: number;
  recipientUserIds?: number[];
  /** 可选业务范围，用于将项目或组织内的管理岗位纳入上级主管收件人。 */
  projectId?: number;
  organizationId?: number;
  module: OfficialAccountModule;
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
  { module: "diesel", name: "柴油领用与价格核验", events: ["diesel_refuel_recorded", "diesel_refuel_updated", "diesel_refuel_voided", "diesel_price_alert"], deepLink: "/admin/diesel", purpose: "柴油直接记账、作废和现金价格异常核验提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "transport", name: "运输刷卡、日结与费用结算", events: ["transport_card_event_exception", "transport_load_card_confirmed", "transport_unload_card_confirmed", "transport_load_driver_notice", "transport_unload_driver_notice", "transport_trip_confirmed", "transport_trip_completed", "transport_daily_vehicle_settlement_summary", "transport_vehicle_settlement_submit", "transport_vehicle_settlement_approve", "transport_vehicle_settlement_pay", "transport_vehicle_settlement_void"], deepLink: "/mobile/transport", purpose: "装土、卸土刷卡、司机通知、异常复核、按车牌日结和渣土车付款状态提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "finance", name: "财务流水与审计处理", events: ["financial_income", "financial_expense", "financial_voided", "financial_reversed"], deepLink: "/mobile/finance", purpose: "项目收支登记、作废和冲销提醒", requiredVariables: ["title", "content", "eventCode"] },
  { module: "measurement", name: "收方、计量与回款", events: ["takeoff_submitted", "takeoff_reviewed", "takeoff_approved", "takeoff_locked", "measurement_submitted", "measurement_approved", "measurement_payment"], deepLink: "/mobile/measurement", purpose: "项目收方、工程计量、审核锁定及回款提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "labor", name: "劳务实名、证照与工资", events: ["labor_identity_verified", "labor_certificate_archived", "payroll_submitted", "payroll_paid", "payroll_voided"], deepLink: "/mobile/labor", purpose: "实名核验、证照归档、工资审核与发放提醒", requiredVariables: ["title", "content", "eventCode"] },
  { module: "machinery", name: "机械成本与付款结算", events: ["machine_cost_submitted", "machine_cost_approved", "machine_cost_rejected", "machine_cost_locked", "machine_monthly_statement_submitted", "machine_monthly_statement_approved", "machine_payment_settlement_submit", "machine_payment_settlement_approve", "machine_payment_settlement_pay", "machine_payment_settlement_void"], deepLink: "/mobile/machinery", purpose: "机械成本登记、月结审核、外租机械付款结算与付款状态提醒", requiredVariables: ["title", "content", "targetId"] },
  { module: "contract", name: "外包合同办理", events: ["outsource_contract_created", "outsource_contract_updated", "outsource_contract_active", "outsource_contract_suspended", "outsource_contract_closed", "outsource_contract_void"], deepLink: "/admin/contracts", purpose: "外包合同草案、启用、暂停、关闭和作废提醒", requiredVariables: ["title", "content", "targetId"] },
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

function parseModuleTemplateMappings(rawValue: string | null): Partial<Record<OfficialAccountModule, OfficialAccountTemplateBinding>> {
  if (!rawValue?.trim()) return {};
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const allowedModules = new Set<OfficialAccountModule>(["purchasing", "measurement", "finance", "machinery", "transport", "security", "labor", "construction", "diesel", "contract"]);
    const result: Partial<Record<OfficialAccountModule, OfficialAccountTemplateBinding>> = {};
    for (const [module, binding] of Object.entries(parsed)) {
      if (!allowedModules.has(module as OfficialAccountModule) || !binding || typeof binding !== "object" || Array.isArray(binding)) continue;
      const candidate = binding as Record<string, unknown>;
      if (typeof candidate.templateId !== "string" || typeof candidate.title !== "string" || !candidate.templateId.trim() || !candidate.title.trim()) continue;
      const rawFields = candidate.templateFields;
      const templateFields = parseTemplateFields(rawFields && typeof rawFields === "object" && !Array.isArray(rawFields) ? JSON.stringify(rawFields) : null);
      result[module as OfficialAccountModule] = { templateId: candidate.templateId.trim().slice(0, 128), title: candidate.title.trim().slice(0, 160), templateFields };
    }
    return result;
  } catch {
    return {};
  }
}

function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{(title|content|eventCode|targetType|targetId|operationTime)\}/g, (_match, key: string) => variables[key] ?? "");
}

function formatWechatTemplateTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeWechatConstValue(value: string) {
  const compact = value.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "").slice(0, 20);
  if (!compact) return "已处理";
  if (compact.length <= 8) return compact;
  if (/异常|预警|告警|失败|错误/.test(compact)) return "异常";
  if (/拒绝|驳回|退回|作废/.test(compact)) return "未通过";
  if (/成功|完成|通过|正常|测试/.test(compact)) return "正常";
  return "已处理";
}

export function normalizeTemplateFieldValue(fieldKey: string, value: string) {
  const compact = value.replace(/[\r\n]+/g, " ").trim();
  if (/^time\d*$/i.test(fieldKey)) {
    const timePattern = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
    const match = compact.match(timePattern);
    if (match) {
      const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`.slice(0, 32);
    }
    return formatWechatTemplateTime();
  }
  if (/^thing\d*$/i.test(fieldKey)) {
    const thing = compact.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "").slice(0, 20);
    return thing || "系统测试";
  }
  if (/^const\d*$/i.test(fieldKey)) return normalizeWechatConstValue(compact);
  if (/^character_string\d*$/i.test(fieldKey)) {
    const ascii = compact.replace(/[^A-Za-z0-9_\-./:]/g, "").slice(0, 32);
    return ascii || "SYSTEMTEST";
  }
  if (/^amount\d*$/i.test(fieldKey)) {
    const match = compact.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
    return match ? `¥${Number(match[0]).toFixed(2)}` : "¥0.00";
  }
  if (/^phone_number\d*$/i.test(fieldKey)) return compact.slice(0, 17);
  if (/^car_number\d*$/i.test(fieldKey)) return compact.slice(0, 8);
  return compact.slice(0, 200);
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

/**
 * 微信新版后台会将“订阅模板消息”占位条目列入私有模板库，但该项目的实测接口对它返回 40037。
 * 它不能承载持续的施工、采购、审批及群发提醒，必须等待管理员选用另一条可下发的合规模板。
 */
export function isPersistentBusinessTemplateEligible(template: Pick<OfficialAccountPrivateTemplate, "title" | "fieldMapping">) {
  return !(template.title.trim() === "订阅模板消息" && Object.keys(template.fieldMapping).length <= 1);
}

export function getPersistentBusinessTemplateEligibilityMessage(template: Pick<OfficialAccountPrivateTemplate, "title" | "fieldMapping">) {
  return isPersistentBusinessTemplateEligible(template)
    ? null
    : "该“订阅模板消息”占位模板实测会被微信返回 40037，不能用于持续业务群发。请在微信服务号后台添加可下发的合规业务模板后重新读取模板库。";
}

function normalizeTemplateTitleForSemanticCheck(title: string) {
  return title.replace(/[\s·・_\-—，,。.!！?？:：；;（）()【】\[\]{}]+/g, "").trim();
}

function isTransportSettlementEvent(eventCode: string) {
  return /^transport_(daily_vehicle_settlement|vehicle_settlement_)/.test(eventCode);
}

/**
 * 服务号模板必须和业务模块语义相符。宁可跳过服务号投递并保留站内通知，
 * 也不能把运输刷卡、装土发票等消息套用“转账成功通知”等财务模板。
 */
export function getOfficialAccountTemplateSemanticMismatch(input: { module: OfficialAccountModule; eventCode: string; templateTitle: string }) {
  const title = normalizeTemplateTitleForSemanticCheck(input.templateTitle);
  if (!title) return "template_title_missing";
  if (input.module === "transport") {
    const settlementEvent = isTransportSettlementEvent(input.eventCode);
    const financeOnlyTitle = /(转账|回款|到账|工资|打款|付款)/.test(title) && !/(运输|运单|车辆|渣土|趟次|结算|费用)/.test(title);
    if (!settlementEvent && financeOnlyTitle) return "transport_template_finance_title_mismatch";
    const required = settlementEvent ? /(运输|运单|车辆|渣土|趟次|结算|费用|付款)/ : /(运输|运单|车辆|渣土|趟次|装土|卸土|刷卡|发票|开票)/;
    if (!required.test(title)) return "transport_template_title_mismatch";
  }
  return null;
}

/** 仅保留网络故障类别，禁止把 URL、令牌、OpenID 或响应正文写入业务投递审计。 */
function classifyDeliveryRequestFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code.toUpperCase()
    : null;
  if (causeCode && /^[A-Z0-9_]{3,64}$/.test(causeCode)) {
    return `network_${causeCode.toLowerCase()}`.slice(0, 64);
  }
  return "request_failed";
}

/**
 * 固定出口网关只接收 api.weixin.qq.com 的相对请求路径。签名覆盖时间戳、方法、路径与正文，
 * 防止其退化为任意 HTTP 代理；网关未配置时保留现有直连，避免配置发布前中断业务通知。
 */
export async function requestOfficialAccountApi(config: OfficialAccountCredentialConfig, url: URL | string, init: RequestInit) {
  const upstream = new URL(url.toString());
  if (upstream.protocol !== "https:" || upstream.hostname !== "api.weixin.qq.com") throw new Error("invalid_wechat_upstream");
  if (!config.egressUrl || !config.egressSharedSecret) return fetch(upstream, init);
  const gateway = new URL(config.egressUrl);
  if (gateway.protocol !== "https:" || gateway.hostname === "api.weixin.qq.com") throw new Error("invalid_egress_gateway");
  const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : null;
  const relayPayload = JSON.stringify({ method: (init.method ?? "GET").toUpperCase(), path: `${upstream.pathname}${upstream.search}`, body });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", config.egressSharedSecret).update(`${timestamp}.${relayPayload}`).digest("hex");
  return fetch(new URL("/v1/wechat", gateway), {
    method: "POST",
    redirect: "error",
    signal: init.signal,
    headers: { "content-type": "application/json", "x-egress-timestamp": timestamp, "x-egress-signature": signature },
    body: relayPayload,
  });
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
  const moduleTemplates = parseModuleTemplateMappings(settings.get("WECHAT_OFFICIAL_MODULE_TEMPLATE_MAPPINGS")?.valueJson ?? null);
  const fallbackTemplate = templateId ? { templateId, title: "旧版通用业务通知模板", templateFields: parseTemplateFields(settings.get("WECHAT_OFFICIAL_TEMPLATE_FIELDS")?.valueJson ?? null) } : undefined;
  if (!appId || !appSecretEncrypted || (!fallbackTemplate && !Object.keys(moduleTemplates).length)) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    return {
      config: {
        appId,
        appSecret: decryptSecret(appSecretEncrypted),
        moduleTemplates,
        ...(fallbackTemplate ? { fallbackTemplate } : {}),
        appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null,
        ...(() => {
          const egressUrl = settings.get("WECHAT_OFFICIAL_EGRESS_URL")?.valueJson?.trim();
          const encryptedSecret = settings.get("WECHAT_OFFICIAL_EGRESS_SHARED_SECRET")?.secretEncrypted;
          return egressUrl && encryptedSecret ? { egressUrl, egressSharedSecret: decryptSecret(encryptedSecret) } : {};
        })(),
      },
    };
  } catch {
    return { reason: "invalid_config" };
  }
}

/** 后台仅显示字段覆盖结论和业务语义，不返回 AppSecret、OpenID 或模板敏感配置。 */
export async function getOfficialAccountNotificationTemplateCoverage() {
  const result = await loadPublishedOfficialAccountConfig();
  return {
    configured: Boolean(result.config),
    reason: result.reason ?? null,
    matrix: OFFICIAL_ACCOUNT_NOTIFICATION_TEMPLATE_MATRIX.map(item => {
      const binding = result.config?.moduleTemplates[item.module] ?? result.config?.fallbackTemplate;
      return {
        ...item,
        missingVariables: [],
        ready: Boolean(binding) && !item.events.some(eventCode => binding ? getOfficialAccountTemplateSemanticMismatch({ module: item.module, eventCode, templateTitle: binding.title }) : true),
        compatibilityMode: binding ? (usesSingleFieldSummaryCompatibility(binding.templateFields) ? "single_field_summary" as const : "module_template" as const) : null,
        templateTitle: binding?.title ?? null,
        semanticMismatch: binding ? item.events.map(eventCode => getOfficialAccountTemplateSemanticMismatch({ module: item.module, eventCode, templateTitle: binding.title })).find(Boolean) ?? null : null,
      };
    }),
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
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_APP_URL", "WECHAT_OFFICIAL_EGRESS_URL", "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET"])));
  const settings = new Map<string, (typeof rows)[number]>();
  for (const row of rows) settings.set(row.settingKey, row);
  const appId = settings.get("WECHAT_OFFICIAL_APP_ID")?.valueJson?.trim();
  const appSecretEncrypted = settings.get("WECHAT_OFFICIAL_APP_SECRET")?.secretEncrypted;
  if (!appId || !appSecretEncrypted) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    return {
      config: {
        appId,
        appSecret: decryptSecret(appSecretEncrypted),
        appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null,
        ...(() => {
          const egressUrl = settings.get("WECHAT_OFFICIAL_EGRESS_URL")?.valueJson?.trim();
          const encryptedSecret = settings.get("WECHAT_OFFICIAL_EGRESS_SHARED_SECRET")?.secretEncrypted;
          return egressUrl && encryptedSecret ? { egressUrl, egressSharedSecret: decryptSecret(encryptedSecret) } : {};
        })(),
      },
    };
  } catch {
    return { reason: "invalid_config" };
  }
}

/** 消息与事件推送回调只读取后台已发布的敏感配置，避免 Token 和 AESKey 进入前端或环境变量；明文模式只要求 Token。 */
export async function loadPublishedOfficialAccountEventConfig(): Promise<{ config?: OfficialAccountEventConfig; reason?: OfficialAccountNotificationResult["reason"] }> {
  const db = await getDb();
  if (!db) return { reason: "database_unavailable" };
  const keys = ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_APP_URL", "WECHAT_OFFICIAL_EGRESS_URL", "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET", "WECHAT_OFFICIAL_EVENT_TOKEN", "WECHAT_OFFICIAL_EVENT_AES_KEY"];
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, keys)));
  const settings = new Map<string, (typeof rows)[number]>();
  for (const row of rows) settings.set(row.settingKey, row);
  const appId = settings.get("WECHAT_OFFICIAL_APP_ID")?.valueJson?.trim();
  const appSecretEncrypted = settings.get("WECHAT_OFFICIAL_APP_SECRET")?.secretEncrypted;
  const tokenEncrypted = settings.get("WECHAT_OFFICIAL_EVENT_TOKEN")?.secretEncrypted;
  const aesEncrypted = settings.get("WECHAT_OFFICIAL_EVENT_AES_KEY")?.secretEncrypted;
  if (!appId || !appSecretEncrypted || !tokenEncrypted) return { reason: rows.length ? "disabled" : "not_configured" };
  try {
    const eventToken = decryptSecret(tokenEncrypted);
    const eventAesKey = aesEncrypted ? decryptSecret(aesEncrypted) : "";
    if (!/^[A-Za-z0-9]{3,32}$/.test(eventToken) || (eventAesKey && !/^[A-Za-z0-9]{43}$/.test(eventAesKey))) return { reason: "invalid_config" };
    return {
      config: {
        appId,
        appSecret: decryptSecret(appSecretEncrypted),
        appUrl: settings.get("WECHAT_OFFICIAL_APP_URL")?.valueJson?.trim() || null,
        ...(() => {
          const egressUrl = settings.get("WECHAT_OFFICIAL_EGRESS_URL")?.valueJson?.trim();
          const encryptedSecret = settings.get("WECHAT_OFFICIAL_EGRESS_SHARED_SECRET")?.secretEncrypted;
          return egressUrl && encryptedSecret ? { egressUrl, egressSharedSecret: decryptSecret(encryptedSecret) } : {};
        })(),
        eventToken,
        eventAesKey,
      },
    };
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
  const response = await requestOfficialAccountApi(config, url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string } | null;
  if (!response.ok || !payload?.access_token) {
    const code = String(payload?.errcode ?? response.status).slice(0, 24);
    const detail = typeof payload?.errmsg === "string" ? payload.errmsg.replace(/[\r\n]+/g, " ").slice(0, 220) : "";
    throw new Error(`token_${code}${detail ? `:${detail}` : ""}`);
  }
  tokenCache = { appId: config.appId, token: payload.access_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 7200) - 120) * 1_000 };
  return tokenCache.token;
}

/**
 * 重新从微信用户信息接口核验一个已绑定身份是否仍关注当前服务号。
 * 只有 subscribe 明确为 0 才会写入 unsubscribed；网络、配置、令牌或接口异常一律保留原绑定状态，避免误伤已关注人员。
 */
export async function verifyOfficialAccountBindingFollowStatus(userId: number): Promise<OfficialAccountFollowVerification> {
  const db = await getDb();
  if (!db) return { status: "unavailable", failureCode: "database_unavailable" };
  const [binding] = await db.select().from(officialAccountBindings).where(eq(officialAccountBindings.userId, userId)).limit(1);
  if (!binding) return { status: "unbound" };
  if (binding.status === "disabled" || binding.status === "revoked") return { status: "disabled" };
  const credentialResult = await loadPublishedOfficialAccountCredentials();
  if (!credentialResult.config) return { status: "unavailable", failureCode: credentialResult.reason ?? "not_configured" };
  try {
    const accessToken = await getOfficialAccountAccessToken(credentialResult.config);
    const endpoint = new URL("https://api.weixin.qq.com/cgi-bin/user/info");
    endpoint.searchParams.set("access_token", accessToken);
    endpoint.searchParams.set("openid", decryptSecret(binding.openIdEncrypted));
    endpoint.searchParams.set("lang", "zh_CN");
    const response = await requestOfficialAccountApi(credentialResult.config, endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
    const payload = await response.json().catch(() => null) as { subscribe?: number; errcode?: number } | null;
    if (!response.ok || (payload?.subscribe !== 0 && payload?.subscribe !== 1)) {
      return { status: "verification_failed", failureCode: String(payload?.errcode ?? response.status).slice(0, 64) };
    }
    const now = new Date();
    if (payload.subscribe === 1) {
      await db.update(officialAccountBindings).set({ status: "active", lastVerifiedAt: now, lastFailureAt: null, failureCount: 0 }).where(eq(officialAccountBindings.id, binding.id));
      try {
        await db.insert(auditLogs).values({ userId, module: "security", action: "official_account_follow_verified", targetType: "official_account_binding", targetId: String(binding.id), summary: "微信用户信息接口确认仍关注服务号，已恢复通知身份" });
      } catch {
        // 审计写入不应扩大为关注状态核验失败。
      }
      return { status: "active" };
    }
    await db.update(officialAccountBindings).set({ status: "unsubscribed", lastVerifiedAt: now, lastFailureAt: now, failureCount: binding.failureCount + 1 }).where(eq(officialAccountBindings.id, binding.id));
    return { status: "unsubscribed" };
  } catch (error) {
    return { status: "verification_failed", failureCode: classifyDeliveryRequestFailure(error) };
  }
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
export async function sendOfficialAccountNotification(input: { module: OfficialAccountModule; eventCode: string; idempotencyKey: string; recipientUserId: number; title: string; content: string; deepLink?: string }): Promise<OfficialAccountNotificationResult> {
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
  const template = configResult.config.moduleTemplates[input.module] ?? configResult.config.fallbackTemplate;
  if (!template) return update({ delivered: false, reason: "disabled" }, { status: "skipped", failureCode: "module_template_not_bound" });
  const semanticMismatch = getOfficialAccountTemplateSemanticMismatch({ module: input.module, eventCode: input.eventCode, templateTitle: template.title });
  if (semanticMismatch) return update({ delivered: false, reason: "disabled" }, { status: "skipped", failureCode: semanticMismatch });
  try {
    const openId = decryptSecret(binding.openIdEncrypted);
    const token = await getOfficialAccountAccessToken(configResult.config);
    const variables = { title: input.title.slice(0, 120), content: input.content.slice(0, 160), eventCode: input.eventCode.slice(0, 64), targetType: "业务事项", targetId: input.eventCode.slice(0, 64), operationTime: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) };
    const singleFieldSummaryCompatibility = usesSingleFieldSummaryCompatibility(template.templateFields);
    const data = Object.fromEntries(Object.entries(template.templateFields).map(([key, value]) => [key, {
      value: normalizeTemplateFieldValue(key, singleFieldSummaryCompatibility ? buildSingleFieldSummary(variables) : renderTemplate(value, variables)),
    }]));
    let response = await requestOfficialAccountApi(configResult.config, `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ touser: openId, template_id: template.templateId, url: buildDeepLink(configResult.config.appUrl, input.deepLink), data }),
      signal: AbortSignal.timeout(8_000),
    });
    let payload = await response.json().catch(() => null) as { errcode?: number; msgid?: number | string } | null;
    /**
     * 新版服务号后台的“订阅模板消息”会在传统模板接口返回 40037。
     * 该错误确认请求尚未送达，因此可安全尝试一次官方订阅通知接口，避免把接口类型错配误记为收件人失败。
     */
    if (payload?.errcode === 40037) {
      response = await requestOfficialAccountApi(configResult.config, `https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend?access_token=${encodeURIComponent(token)}`, {
        method: "POST", redirect: "error", headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser: openId, template_id: template.templateId, data, miniprogram_state: "formal", lang: "zh_CN" }),
        signal: AbortSignal.timeout(8_000),
      });
      payload = await response.json().catch(() => null) as { errcode?: number; msgid?: number | string } | null;
    }
    if (!response.ok || payload?.errcode !== 0) {
      const failureCode = String(payload?.errcode ?? response.status).slice(0, 64);
      const followVerification = failureCode === "43004" ? await verifyOfficialAccountBindingFollowStatus(input.recipientUserId) : null;
      await db.update(officialAccountBindings).set({
        lastFailureAt: new Date(),
        failureCount: binding.failureCount + 1,
        ...(followVerification?.status === "unsubscribed" ? { status: "unsubscribed" as const } : {}),
      }).where(eq(officialAccountBindings.id, binding.id));
      return update({ delivered: false, reason: "delivery_failed" }, { status: "failed", failureCode });
    }
    await db.update(officialAccountBindings).set({ lastVerifiedAt: new Date(), failureCount: 0 }).where(eq(officialAccountBindings.id, binding.id));
    return update({ delivered: true, reason: "sent", providerMessageId: payload.msgid ? String(payload.msgid) : undefined }, { status: "sent", sentAt: new Date(), providerMessageId: payload.msgid ? String(payload.msgid) : null, failureCode: null });
  } catch (error) {
    return update({ delivered: false, reason: "delivery_failed" }, { status: "failed", failureCode: classifyDeliveryRequestFailure(error) });
  }
}

/** 默认收件人为发起人的直属主管；审核人、司机等可由调用方明确传入。 */
export async function notifyOfficialAccountBusinessEvent(event: OfficialAccountBusinessEvent) {
  const resolved = event.recipientUserIds?.length ? event.recipientUserIds : await resolveSupervisorRecipientIds(event);
  const recipients = Array.from(new Set((resolved.length ? resolved : [event.userId]).filter(Number.isInteger)));
  const content = (event.content || `${event.title}，请进入系统查看。`).replace(/[\r\n]+/g, " ").slice(0, 180);
  return Promise.all(recipients.map(async recipientUserId => {
    const result = await sendOfficialAccountNotification({ module: event.module, eventCode: event.eventCode, idempotencyKey: `oa:${event.eventCode}:${event.targetType}:${event.targetId}:${recipientUserId}`, recipientUserId, title: event.title, content, deepLink: event.deepLink });
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
    const response = await requestOfficialAccountApi(credentialResult.config, `https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=${encodeURIComponent(token)}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as { errcode?: number; errmsg?: string; template_list?: Array<{ template_id?: string; title?: string; content?: string }> } | null;
    if (!response.ok || payload?.errcode) {
      const code = String(payload?.errcode ?? response.status).slice(0, 24);
      const detail = typeof payload?.errmsg === "string" ? payload.errmsg.replace(/[\r\n]+/g, " ").slice(0, 180) : "";
      if (code === "48001") return { success: false, message: "微信返回 48001：当前服务号尚未获得模板消息接口权限。请在服务号后台“功能 → 添加功能插件”申请并开通“模板消息”，完成服务类目设置后再检测。", templates: [] };
      return { success: false, message: `无法读取服务号模板消息能力（错误码 ${code}${detail ? `，${detail}` : ""}）。请检查模板消息功能插件、服务类目和接口权限。`, templates: [] };
    }
    const discoveredTemplates = (payload?.template_list ?? [])
      .filter((template): template is Required<Pick<typeof template, "template_id" | "title" | "content">> => Boolean(template.template_id && template.title && template.content))
      .slice(0, 25)
      .map(template => {
        const normalized = { templateId: template.template_id.slice(0, 128), title: template.title.slice(0, 160), content: template.content.slice(0, 1600), fieldMapping: deriveTemplateFieldMapping(template.content) };
        const eligibilityMessage = getPersistentBusinessTemplateEligibilityMessage(normalized);
        return eligibilityMessage ? { ...normalized, persistentBusinessEligible: false, eligibilityMessage } : normalized;
      });
    const templates = discoveredTemplates.filter(template => isPersistentBusinessTemplateEligible(template));
    const hiddenUnsupportedCount = discoveredTemplates.length - templates.length;
    if (!templates.length && hiddenUnsupportedCount > 0) {
      return {
        success: true,
        message: "模板消息功能已开通，但系统已隐藏不可下发的订阅占位模板；当前尚无可下发业务模板。请在服务号后台添加合规业务模板后重新读取。",
        templates,
      };
    }
    return { success: true, message: templates.length ? `已读取 ${templates.length} 个可下发私有模板；请选择符合施工业务通知场景的模板生成系统草稿。` : "模板消息功能已开通，但私有模板库暂无可用模板。请在服务号后台设置服务类目后，从公共模板库选用合规业务通知模板。", templates };
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
  if (!result.success) return { success: false, message: result.message };
  return { success: true, message: result.templates.length ? `模板消息功能已开通，当前可选业务模板共有 ${result.templates.length} 个。请选择合规模板并将其模板 ID 填入系统。` : result.message };
}

/** OpenID 仅以该指纹进行去重查询，永不返回或展示原始值。 */
export function fingerprintOfficialAccountOpenId(openId: string) {
  return createHash("sha256").update(openId, "utf8").digest("hex");
}
