import DysmsapiClient, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import * as OpenApi from "@alicloud/openapi-client";
import { inArray } from "drizzle-orm";
import { auditLogs, systemSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

export const SMS_EVENT_CODES = [
  "transport_load_completed",
  "transport_unload_completed",
  "transport_scan_exception",
  "diesel_refuel_completed",
] as const;

export type SmsEventCode = (typeof SMS_EVENT_CODES)[number];
export type SmsEventTemplate = { eventCode: SmsEventCode; templateCode: string; enabled: boolean };
export type SmsNotificationModule = "transport" | "diesel";
export type SmsReadinessReason = "ready" | "database_unavailable" | "disabled" | "provider_not_aliyun" | "module_disabled" | "template_unavailable" | "credentials_incomplete" | "configuration_invalid";

const SMS_SETTING_KEYS = [
  "SMS_NOTIFICATION_ENABLED",
  "SMS_NOTIFICATION_PROVIDER",
  "SMS_NOTIFICATION_MODULES",
  "SMS_EVENT_TEMPLATE_CONFIGS",
  "SMS_ALIYUN_ACCESS_KEY_ID",
  "SMS_ALIYUN_ACCESS_KEY_SECRET",
  "SMS_ALIYUN_SIGN_NAME",
] as const;

const smsTestRateLimitByUser = new Map<number, number>();
const SMS_TEST_COOLDOWN_MS = 60_000;

export function normalizeSmsEventTemplates(value: unknown): SmsEventTemplate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SmsEventCode>();
  return value.flatMap((item): SmsEventTemplate[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { eventCode?: unknown; templateCode?: unknown; enabled?: unknown };
    if (typeof candidate.eventCode !== "string" || !SMS_EVENT_CODES.includes(candidate.eventCode as SmsEventCode) || seen.has(candidate.eventCode as SmsEventCode)) return [];
    seen.add(candidate.eventCode as SmsEventCode);
    return [{
      eventCode: candidate.eventCode as SmsEventCode,
      templateCode: typeof candidate.templateCode === "string" ? candidate.templateCode.trim().slice(0, 128) : "",
      enabled: candidate.enabled === true,
    }];
  });
}

export function selectSmsEventTemplate(templates: SmsEventTemplate[], eventCode: SmsEventCode) {
  const template = templates.find(item => item.eventCode === eventCode);
  return template?.enabled && template.templateCode ? template : null;
}

export function getSmsEventModule(eventCode: SmsEventCode): SmsNotificationModule {
  return eventCode === "diesel_refuel_completed" ? "diesel" : "transport";
}

function normalizeRecipientPhone(phone: string) {
  const normalized = phone.trim().replace(/[\s()\-]/g, "");
  return /^\+?[0-9]{6,20}$/.test(normalized) ? normalized : null;
}

function formatChinaSmsTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value).replace(/\//g, "-");
}

type AliyunSmsDispatchConfiguration = {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
};

type AliyunSmsDispatchResolution =
  | { ready: true; configuration: AliyunSmsDispatchConfiguration }
  | { ready: false; reason: Exclude<SmsReadinessReason, "ready">; db: NonNullable<Awaited<ReturnType<typeof getDb>>> | null };

/** 仅解析已发布配置；返回值绝不包含 AccessKey、签名、模板编码或收件人。 */
async function resolveAliyunSmsDispatch(eventCode: SmsEventCode, module: SmsNotificationModule): Promise<AliyunSmsDispatchResolution> {
  const db = await getDb();
  if (!db) return { ready: false, reason: "database_unavailable", db: null };
  try {
    const rows = await db.select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson, secretEncrypted: systemSettings.secretEncrypted }).from(systemSettings).where(inArray(systemSettings.settingKey, [...SMS_SETTING_KEYS]));
    const byKey = new Map(rows.map(row => [row.settingKey, row]));
    if (byKey.get("SMS_NOTIFICATION_ENABLED")?.valueJson !== "true") return { ready: false, reason: "disabled", db };
    if (byKey.get("SMS_NOTIFICATION_PROVIDER")?.valueJson !== "aliyun") return { ready: false, reason: "provider_not_aliyun", db };
    const modules = JSON.parse(byKey.get("SMS_NOTIFICATION_MODULES")?.valueJson ?? "[]") as unknown;
    if (!Array.isArray(modules) || !modules.includes(module)) return { ready: false, reason: "module_disabled", db };
    const templates = normalizeSmsEventTemplates(JSON.parse(byKey.get("SMS_EVENT_TEMPLATE_CONFIGS")?.valueJson ?? "[]"));
    const template = selectSmsEventTemplate(templates, eventCode);
    if (!template) return { ready: false, reason: "template_unavailable", db };
    const accessKeyId = byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")?.secretEncrypted ? decryptSecret(byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")!.secretEncrypted!) : "";
    const accessKeySecret = byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")?.secretEncrypted ? decryptSecret(byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")!.secretEncrypted!) : "";
    const signName = byKey.get("SMS_ALIYUN_SIGN_NAME")?.valueJson?.trim() ?? "";
    if (!accessKeyId || !accessKeySecret || !signName) return { ready: false, reason: "credentials_incomplete", db };
    return { ready: true, configuration: { db, accessKeyId, accessKeySecret, signName, templateCode: template.templateCode } };
  } catch {
    return { ready: false, reason: "configuration_invalid", db };
  }
}

/** 用于后台预检：只告知当前事件是否可发送和拦截类型，不验证或回显密钥。 */
export async function inspectAliyunSmsReadiness(eventCode: SmsEventCode) {
  const resolution = await resolveAliyunSmsDispatch(eventCode, getSmsEventModule(eventCode));
  return { ready: resolution.ready, reason: resolution.ready ? "ready" as const : resolution.reason };
}

function buildTestTemplateParams(eventCode: SmsEventCode) {
  const time = formatChinaSmsTime(new Date());
  if (eventCode === "diesel_refuel_completed") return { vehicle: "湘A12345", quantity: "100", amount: "100.00", time };
  if (eventCode === "transport_scan_exception") return { vehicle: "湘A12345", time };
  return { vehicle: "湘A12345", place: "测试运输现场", time };
}

async function writeSmsTestAudit(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: { userId: number; action: string; eventCode: SmsEventCode; summary: string }) {
  const [created] = await db.insert(auditLogs).values({ userId: input.userId, module: getSmsEventModule(input.eventCode), action: input.action, targetType: "sms_notification_test", targetId: input.eventCode, summary: input.summary }).$returningId();
  return Number(created?.id ?? 0) || null;
}

/**
 * 仅由超级管理员测试按钮调用。每次调用只向一个明确输入的合法手机号发送一条短信；
 * 服务商返回仅回传安全状态码，手机号、密钥、签名和变量值均不会回显或进入审计。
 */
export async function sendAliyunSmsTest(input: { actorUserId: number; eventCode: SmsEventCode; recipientPhone: string }) {
  const phone = normalizeRecipientPhone(input.recipientPhone);
  if (!phone) return { accepted: false, reason: "recipient_phone_invalid" as const, providerCode: null, auditLogId: null };
  const now = Date.now();
  const lastSentAt = smsTestRateLimitByUser.get(input.actorUserId) ?? 0;
  if (now - lastSentAt < SMS_TEST_COOLDOWN_MS) return { accepted: false, reason: "test_rate_limited" as const, providerCode: null, auditLogId: null };
  const resolution = await resolveAliyunSmsDispatch(input.eventCode, getSmsEventModule(input.eventCode));
  if (!resolution.ready) {
    const auditLogId = resolution.db ? await writeSmsTestAudit(resolution.db, { userId: input.actorUserId, action: "aliyun_sms_test_blocked", eventCode: input.eventCode, summary: `阿里云短信测试未发送：${resolution.reason}` }).catch(() => null) : null;
    return { accepted: false, reason: resolution.reason, providerCode: null, auditLogId };
  }
  smsTestRateLimitByUser.set(input.actorUserId, now);
  try {
    const clientConfig = new OpenApi.Config({ accessKeyId: resolution.configuration.accessKeyId, accessKeySecret: resolution.configuration.accessKeySecret });
    clientConfig.endpoint = "dysmsapi.aliyuncs.com";
    const client = new DysmsapiClient(clientConfig);
    const request = new SendSmsRequest({ phoneNumbers: phone, signName: resolution.configuration.signName, templateCode: resolution.configuration.templateCode, templateParam: JSON.stringify(buildTestTemplateParams(input.eventCode)) });
    const response = await client.sendSms(request);
    const providerCode = response.body?.code ?? "UNKNOWN";
    const accepted = providerCode === "OK";
    const auditLogId = await writeSmsTestAudit(resolution.configuration.db, { userId: input.actorUserId, action: accepted ? "aliyun_sms_test_accepted" : "aliyun_sms_test_rejected", eventCode: input.eventCode, summary: accepted ? `阿里云短信测试已受理：${input.eventCode}` : `阿里云短信测试未受理：${input.eventCode}（服务商返回 ${providerCode}）` });
    return { accepted, reason: accepted ? "accepted" as const : "provider_rejected" as const, providerCode, auditLogId };
  } catch {
    const auditLogId = await writeSmsTestAudit(resolution.configuration.db, { userId: input.actorUserId, action: "aliyun_sms_test_failed", eventCode: input.eventCode, summary: `阿里云短信测试投递失败：${input.eventCode}` }).catch(() => null);
    return { accepted: false, reason: "delivery_failed" as const, providerCode: null, auditLogId };
  }
}

/**
 * 仅在后台发布了对应业务事件模板、模块开关、签名与密钥后投递阿里云通知短信。
 * 此函数绝不抛出到业务事务；短信失败只留下最小化审计，绝不暴露手机号、密钥或模板变量值。
 */
export async function notifyAliyunSmsSafely(input: {
  actorUserId: number;
  projectId: number;
  module: SmsNotificationModule;
  eventCode: SmsEventCode;
  recipientPhone: string | null | undefined;
  targetType: string;
  targetId: string;
  templateParams: Record<string, string | number>;
}) {
  const phone = input.recipientPhone ? normalizeRecipientPhone(input.recipientPhone) : null;
  if (!phone) return { sent: false, reason: "recipient_phone_unavailable" as const };
  const resolution = await resolveAliyunSmsDispatch(input.eventCode, input.module);
  if (!resolution.ready) return { sent: false, reason: resolution.reason };
  try {
    const clientConfig = new OpenApi.Config({ accessKeyId: resolution.configuration.accessKeyId, accessKeySecret: resolution.configuration.accessKeySecret });
    clientConfig.endpoint = "dysmsapi.aliyuncs.com";
    const client = new DysmsapiClient(clientConfig);
    const request = new SendSmsRequest({ phoneNumbers: phone, signName: resolution.configuration.signName, templateCode: resolution.configuration.templateCode, templateParam: JSON.stringify(input.templateParams) });
    const response = await client.sendSms(request);
    const accepted = response.body?.code === "OK";
    await resolution.configuration.db.insert(auditLogs).values({
      userId: input.actorUserId,
      module: input.module,
      action: accepted ? "aliyun_sms_accepted" : "aliyun_sms_rejected",
      targetType: input.targetType,
      targetId: input.targetId,
      summary: accepted ? `阿里云短信已受理：${input.eventCode}` : `阿里云短信未受理：${input.eventCode}（服务商返回 ${response.body?.code ?? "未知状态"}）`,
    });
    return { sent: accepted, reason: accepted ? "accepted" as const : "provider_rejected" as const };
  } catch {
    await resolution.configuration.db.insert(auditLogs).values({
      userId: input.actorUserId,
      module: input.module,
      action: "aliyun_sms_failed",
      targetType: input.targetType,
      targetId: input.targetId,
      summary: `阿里云短信投递失败：${input.eventCode}，已保留站内通知和业务审计`,
    }).catch(() => undefined);
    return { sent: false, reason: "delivery_failed" as const };
  }
}

export { formatChinaSmsTime };
