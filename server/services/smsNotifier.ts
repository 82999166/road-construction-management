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

const SMS_SETTING_KEYS = [
  "SMS_NOTIFICATION_ENABLED",
  "SMS_NOTIFICATION_PROVIDER",
  "SMS_NOTIFICATION_MODULES",
  "SMS_EVENT_TEMPLATE_CONFIGS",
  "SMS_ALIYUN_ACCESS_KEY_ID",
  "SMS_ALIYUN_ACCESS_KEY_SECRET",
  "SMS_ALIYUN_SIGN_NAME",
] as const;

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
  const db = await getDb();
  if (!db) return { sent: false, reason: "database_unavailable" as const };
  const phone = input.recipientPhone ? normalizeRecipientPhone(input.recipientPhone) : null;
  if (!phone) return { sent: false, reason: "recipient_phone_unavailable" as const };
  try {
    const rows = await db.select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson, secretEncrypted: systemSettings.secretEncrypted }).from(systemSettings).where(inArray(systemSettings.settingKey, [...SMS_SETTING_KEYS]));
    const byKey = new Map(rows.map(row => [row.settingKey, row]));
    if (byKey.get("SMS_NOTIFICATION_ENABLED")?.valueJson !== "true") return { sent: false, reason: "disabled" as const };
    if (byKey.get("SMS_NOTIFICATION_PROVIDER")?.valueJson !== "aliyun") return { sent: false, reason: "provider_not_aliyun" as const };
    const modules = JSON.parse(byKey.get("SMS_NOTIFICATION_MODULES")?.valueJson ?? "[]") as unknown;
    if (!Array.isArray(modules) || !modules.includes(input.module)) return { sent: false, reason: "module_disabled" as const };
    const templates = normalizeSmsEventTemplates(JSON.parse(byKey.get("SMS_EVENT_TEMPLATE_CONFIGS")?.valueJson ?? "[]"));
    const template = selectSmsEventTemplate(templates, input.eventCode);
    if (!template) return { sent: false, reason: "template_unavailable" as const };
    const accessKeyId = byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")?.secretEncrypted ? decryptSecret(byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")!.secretEncrypted!) : "";
    const accessKeySecret = byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")?.secretEncrypted ? decryptSecret(byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")!.secretEncrypted!) : "";
    const signName = byKey.get("SMS_ALIYUN_SIGN_NAME")?.valueJson?.trim() ?? "";
    if (!accessKeyId || !accessKeySecret || !signName) return { sent: false, reason: "credentials_incomplete" as const };

    const clientConfig = new OpenApi.Config({ accessKeyId, accessKeySecret });
    clientConfig.endpoint = "dysmsapi.aliyuncs.com";
    const client = new DysmsapiClient(clientConfig);
    const request = new SendSmsRequest({ phoneNumbers: phone, signName, templateCode: template.templateCode, templateParam: JSON.stringify(input.templateParams) });
    const response = await client.sendSms(request);
    const accepted = response.body?.code === "OK";
    await db.insert(auditLogs).values({
      userId: input.actorUserId,
      module: input.module,
      action: accepted ? "aliyun_sms_accepted" : "aliyun_sms_rejected",
      targetType: input.targetType,
      targetId: input.targetId,
      summary: accepted ? `阿里云短信已受理：${input.eventCode}` : `阿里云短信未受理：${input.eventCode}（服务商返回 ${response.body?.code ?? "未知状态"}）`,
    });
    return { sent: accepted, reason: accepted ? "accepted" as const : "provider_rejected" as const };
  } catch (error) {
    await db.insert(auditLogs).values({
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
