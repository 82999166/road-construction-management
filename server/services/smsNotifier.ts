import * as DysmsapiSdk from "@alicloud/dysmsapi20170525";
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
  "machine_refuel_completed",
  "vehicle_expense_recorded",
  "machine_expense_recorded",
] as const;

export type SmsEventCode = (typeof SMS_EVENT_CODES)[number];
export type SmsEventTemplate = {
  eventCode: SmsEventCode;
  templateCode: string;
  enabled: boolean;
};
export type SmsNotificationModule = "transport" | "diesel" | "machinery";
export type SmsReadinessReason =
  | "ready"
  | "database_unavailable"
  | "disabled"
  | "provider_not_aliyun"
  | "module_disabled"
  | "template_unavailable"
  | "credentials_incomplete"
  | "configuration_invalid";
export type SmsTemplateVerificationReason =
  | "verified"
  | "configuration_not_ready"
  | "provider_rejected"
  | "template_not_approved"
  | "template_content_unavailable"
  | "variable_contract_invalid"
  | "provider_request_failed";

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
    const candidate = item as {
      eventCode?: unknown;
      templateCode?: unknown;
      enabled?: unknown;
    };
    if (
      typeof candidate.eventCode !== "string" ||
      !SMS_EVENT_CODES.includes(candidate.eventCode as SmsEventCode) ||
      seen.has(candidate.eventCode as SmsEventCode)
    )
      return [];
    seen.add(candidate.eventCode as SmsEventCode);
    return [
      {
        eventCode: candidate.eventCode as SmsEventCode,
        templateCode:
          typeof candidate.templateCode === "string"
            ? candidate.templateCode.trim().slice(0, 128)
            : "",
        enabled: candidate.enabled === true,
      },
    ];
  });
}

export function selectSmsEventTemplate(
  templates: SmsEventTemplate[],
  eventCode: SmsEventCode
) {
  const template = templates.find(item => item.eventCode === eventCode);
  return template?.enabled && template.templateCode ? template : null;
}

export function getSmsEventModule(
  eventCode: SmsEventCode
): SmsNotificationModule {
  if (eventCode === "diesel_refuel_completed") return "diesel";
  if (
    eventCode === "machine_refuel_completed" ||
    eventCode === "machine_expense_recorded"
  )
    return "machinery";
  return "transport";
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
  })
    .format(value)
    .replace(/\//g, "-");
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
  | {
      ready: false;
      reason: Exclude<SmsReadinessReason, "ready">;
      db: NonNullable<Awaited<ReturnType<typeof getDb>>> | null;
    };

/**
 * 阿里云 SDK 的包入口为 CommonJS：默认导入在生产打包后会变成模块对象，
 * 必须从命名空间的 default 导出取得 Client 构造器，避免 `is not a constructor`。
 */
export function createAliyunSmsClient(
  accessKeyId: string,
  accessKeySecret: string
) {
  const clientConfig = new OpenApi.Config({ accessKeyId, accessKeySecret });
  clientConfig.endpoint = "dysmsapi.aliyuncs.com";
  const directDefault = DysmsapiSdk.default as unknown;
  const clientConstructor: typeof DysmsapiSdk.default | null =
    typeof directDefault === "function"
      ? (directDefault as typeof DysmsapiSdk.default)
      : directDefault &&
          typeof (directDefault as { default?: unknown }).default === "function"
        ? (directDefault as { default: typeof DysmsapiSdk.default }).default
        : null;
  if (!clientConstructor)
    throw Object.assign(
      new Error("Aliyun SMS SDK client constructor is unavailable"),
      { code: "SMS_SDK_CLIENT_CONSTRUCTOR_UNAVAILABLE" }
    );
  return new clientConstructor(clientConfig);
}

function createAliyunSmsRequest(input: {
  phone: string;
  signName: string;
  templateCode: string;
  templateParams: Record<string, string | number>;
}) {
  return new DysmsapiSdk.SendSmsRequest({
    phoneNumbers: input.phone,
    signName: input.signName,
    templateCode: input.templateCode,
    templateParam: JSON.stringify(input.templateParams),
  });
}

/** 仅保留 SDK/服务商的短错误码，绝不记录异常消息、请求对象、手机号、密钥、签名或模板内容。 */
export function extractSafeAliyunSmsErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "SDK_REQUEST_FAILED";
  const candidate = error as {
    code?: unknown;
    Code?: unknown;
    name?: unknown;
    data?: { code?: unknown; Code?: unknown };
  };
  const code =
    candidate.code ??
    candidate.Code ??
    candidate.data?.code ??
    candidate.data?.Code ??
    candidate.name;
  if (typeof code !== "string") return "SDK_REQUEST_FAILED";
  const normalized = code.trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(normalized)
    ? normalized
    : "SDK_REQUEST_FAILED";
}

/** 仅解析已发布配置；返回值绝不包含 AccessKey、签名、模板编码或收件人。 */
async function resolveAliyunSmsDispatch(
  eventCode: SmsEventCode,
  module: SmsNotificationModule
): Promise<AliyunSmsDispatchResolution> {
  const db = await getDb();
  if (!db) return { ready: false, reason: "database_unavailable", db: null };
  try {
    const rows = await db
      .select({
        settingKey: systemSettings.settingKey,
        valueJson: systemSettings.valueJson,
        secretEncrypted: systemSettings.secretEncrypted,
      })
      .from(systemSettings)
      .where(inArray(systemSettings.settingKey, [...SMS_SETTING_KEYS]));
    const byKey = new Map(rows.map(row => [row.settingKey, row]));
    if (byKey.get("SMS_NOTIFICATION_ENABLED")?.valueJson !== "true")
      return { ready: false, reason: "disabled", db };
    if (byKey.get("SMS_NOTIFICATION_PROVIDER")?.valueJson !== "aliyun")
      return { ready: false, reason: "provider_not_aliyun", db };
    const modules = JSON.parse(
      byKey.get("SMS_NOTIFICATION_MODULES")?.valueJson ?? "[]"
    ) as unknown;
    if (!Array.isArray(modules) || !modules.includes(module))
      return { ready: false, reason: "module_disabled", db };
    const templates = normalizeSmsEventTemplates(
      JSON.parse(byKey.get("SMS_EVENT_TEMPLATE_CONFIGS")?.valueJson ?? "[]")
    );
    const template = selectSmsEventTemplate(templates, eventCode);
    if (!template) return { ready: false, reason: "template_unavailable", db };
    const accessKeyId = byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")?.secretEncrypted
      ? decryptSecret(byKey.get("SMS_ALIYUN_ACCESS_KEY_ID")!.secretEncrypted!)
      : "";
    const accessKeySecret = byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")
      ?.secretEncrypted
      ? decryptSecret(
          byKey.get("SMS_ALIYUN_ACCESS_KEY_SECRET")!.secretEncrypted!
        )
      : "";
    const signName = byKey.get("SMS_ALIYUN_SIGN_NAME")?.valueJson?.trim() ?? "";
    if (!accessKeyId || !accessKeySecret || !signName)
      return { ready: false, reason: "credentials_incomplete", db };
    return {
      ready: true,
      configuration: {
        db,
        accessKeyId,
        accessKeySecret,
        signName,
        templateCode: template.templateCode,
      },
    };
  } catch {
    return { ready: false, reason: "configuration_invalid", db };
  }
}

/** 用于后台预检：只告知当前事件是否可发送和拦截类型，不验证或回显密钥。 */
export async function inspectAliyunSmsReadiness(eventCode: SmsEventCode) {
  const resolution = await resolveAliyunSmsDispatch(
    eventCode,
    getSmsEventModule(eventCode)
  );
  return {
    ready: resolution.ready,
    reason: resolution.ready ? ("ready" as const) : resolution.reason,
  };
}

export function buildTestTemplateParams(
  eventCode: SmsEventCode
): Record<string, string> {
  const time = formatChinaSmsTime(new Date());
  if (eventCode === "diesel_refuel_completed")
    return { vehicle: "湘A12345", quantity: "100", amount: "100.00", time };
  if (eventCode === "machine_refuel_completed")
    return { vehicle: "挖机001", quantity: "100", amount: "100.00", time };
  if (eventCode === "vehicle_expense_recorded")
    return {
      vehicle: "湘A12345",
      category: "维修保养",
      amount: "100.00",
      time,
    };
  if (eventCode === "machine_expense_recorded")
    return { vehicle: "挖机001", category: "维修保养", amount: "100.00", time };
  if (eventCode === "transport_scan_exception")
    return { vehicle: "湘A12345", time };
  return { vehicle: "湘A12345", place: "测试运输现场", tripOrdinal: "1", time };
}

/**
 * 阿里云模板变量只能写成 ${name}。本函数只返回变量名，绝不向前端回传模板正文。
 * 例如 $vehicle$ 不会被阿里云当作变量，仍会原样出现在收件短信中。
 */
export function extractAliyunTemplateVariables(templateContent: string) {
  const variables = new Set<string>();
  templateContent.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, variable: string) => {
      variables.add(variable);
      return _match;
    }
  );
  return Array.from(variables).sort();
}

/** 识别最常见的旧式 $vehicle$ 写法，仅返回变量名以保护已审核模板正文。 */
export function extractAliyunLegacyDollarVariables(templateContent: string) {
  const variables = new Set<string>();
  templateContent.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)\$/g,
    (_match, variable: string) => {
      variables.add(variable);
      return _match;
    }
  );
  return Array.from(variables).sort();
}

/**
 * 系统可提供的变量允许模板按需选用；只有模板要求系统未提供的变量，或使用旧式 $name$
 * 占位符时才阻止发送。这样“只显示车牌和时间”的合规模板不会被误判。
 */
export function evaluateAliyunTemplateVariableContract(
  eventCode: SmsEventCode,
  templateContent: string
) {
  const expectedVariables = Object.keys(
    buildTestTemplateParams(eventCode)
  ).sort();
  const variables = extractAliyunTemplateVariables(templateContent);
  const legacyDollarVariables =
    extractAliyunLegacyDollarVariables(templateContent);
  const unusedEventVariables = expectedVariables.filter(
    variable => !variables.includes(variable)
  );
  const unsupportedVariables = variables.filter(
    variable => !expectedVariables.includes(variable)
  );
  return {
    expectedVariables,
    variables,
    unusedEventVariables,
    unsupportedVariables,
    legacyDollarVariables,
    verified: !legacyDollarVariables.length && !unsupportedVariables.length,
  };
}

/**
 * 只允许超级管理员主动核验当前已发布模板的审核与变量契约。
 * 返回内容不含模板正文、模板编码、签名、密钥、收件人及服务商异常详情。
 */
export async function inspectAliyunSmsTemplateVariableContract(
  eventCode: SmsEventCode
) {
  const resolution = await resolveAliyunSmsDispatch(
    eventCode,
    getSmsEventModule(eventCode)
  );
  const expectedVariables = Object.keys(
    buildTestTemplateParams(eventCode)
  ).sort();
  const base = { eventCode, expectedVariables };
  if (!resolution.ready) {
    return {
      ...base,
      verified: false,
      reason: "configuration_not_ready" as const,
      providerCode: null,
      templateStatus: null,
      variables: [] as string[],
      unusedEventVariables: expectedVariables,
      unsupportedVariables: [] as string[],
      legacyDollarVariables: [] as string[],
    };
  }
  try {
    const client = createAliyunSmsClient(
      resolution.configuration.accessKeyId,
      resolution.configuration.accessKeySecret
    );
    const response = await client.getSmsTemplate(
      new DysmsapiSdk.GetSmsTemplateRequest({
        templateCode: resolution.configuration.templateCode,
      })
    );
    const body = response.body;
    const providerCode =
      typeof body?.code === "string"
        ? extractSafeAliyunSmsErrorCode({ code: body.code })
        : "UNKNOWN";
    const templateStatus =
      typeof body?.templateStatus === "string" ? body.templateStatus : null;
    if (providerCode !== "OK") {
      return {
        ...base,
        verified: false,
        reason: "provider_rejected" as const,
        providerCode,
        templateStatus,
        variables: [] as string[],
        unusedEventVariables: expectedVariables,
        unsupportedVariables: [] as string[],
        legacyDollarVariables: [] as string[],
      };
    }
    if (templateStatus !== "1") {
      return {
        ...base,
        verified: false,
        reason: "template_not_approved" as const,
        providerCode,
        templateStatus,
        variables: [] as string[],
        unusedEventVariables: expectedVariables,
        unsupportedVariables: [] as string[],
        legacyDollarVariables: [] as string[],
      };
    }
    if (
      typeof body?.templateContent !== "string" ||
      !body.templateContent.trim()
    ) {
      return {
        ...base,
        verified: false,
        reason: "template_content_unavailable" as const,
        providerCode,
        templateStatus,
        variables: [] as string[],
        unusedEventVariables: expectedVariables,
        unsupportedVariables: [] as string[],
        legacyDollarVariables: [] as string[],
      };
    }
    const evaluation = evaluateAliyunTemplateVariableContract(
      eventCode,
      body.templateContent
    );
    return {
      ...base,
      verified: evaluation.verified,
      reason: evaluation.verified
        ? ("verified" as const)
        : ("variable_contract_invalid" as const),
      providerCode,
      templateStatus,
      variables: evaluation.variables,
      unusedEventVariables: evaluation.unusedEventVariables,
      unsupportedVariables: evaluation.unsupportedVariables,
      legacyDollarVariables: evaluation.legacyDollarVariables,
    };
  } catch (error) {
    return {
      ...base,
      verified: false,
      reason: "provider_request_failed" as const,
      providerCode: extractSafeAliyunSmsErrorCode(error),
      templateStatus: null,
      variables: [] as string[],
      unusedEventVariables: expectedVariables,
      unsupportedVariables: [] as string[],
      legacyDollarVariables: [] as string[],
    };
  }
}

async function writeSmsTestAudit(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: {
    userId: number;
    action: string;
    eventCode: SmsEventCode;
    summary: string;
  }
) {
  const [created] = await db
    .insert(auditLogs)
    .values({
      userId: input.userId,
      module: getSmsEventModule(input.eventCode),
      action: input.action,
      targetType: "sms_notification_test",
      targetId: input.eventCode,
      summary: input.summary,
    })
    .$returningId();
  return Number(created?.id ?? 0) || null;
}

/**
 * 仅由超级管理员测试按钮调用。每次调用只向一个明确输入的合法手机号发送一条短信；
 * 服务商返回仅回传安全状态码，手机号、密钥、签名和变量值均不会回显或进入审计。
 */
export async function sendAliyunSmsTest(input: {
  actorUserId: number;
  eventCode: SmsEventCode;
  recipientPhone: string;
}) {
  const phone = normalizeRecipientPhone(input.recipientPhone);
  if (!phone)
    return {
      accepted: false,
      reason: "recipient_phone_invalid" as const,
      providerCode: null,
      auditLogId: null,
    };
  const now = Date.now();
  const lastSentAt = smsTestRateLimitByUser.get(input.actorUserId) ?? 0;
  if (now - lastSentAt < SMS_TEST_COOLDOWN_MS)
    return {
      accepted: false,
      reason: "test_rate_limited" as const,
      providerCode: null,
      auditLogId: null,
    };
  const resolution = await resolveAliyunSmsDispatch(
    input.eventCode,
    getSmsEventModule(input.eventCode)
  );
  if (!resolution.ready) {
    const auditLogId = resolution.db
      ? await writeSmsTestAudit(resolution.db, {
          userId: input.actorUserId,
          action: "aliyun_sms_test_blocked",
          eventCode: input.eventCode,
          summary: `阿里云短信测试未发送：${resolution.reason}`,
        }).catch(() => null)
      : null;
    return {
      accepted: false,
      reason: resolution.reason,
      providerCode: null,
      auditLogId,
    };
  }
  smsTestRateLimitByUser.set(input.actorUserId, now);
  try {
    const client = createAliyunSmsClient(
      resolution.configuration.accessKeyId,
      resolution.configuration.accessKeySecret
    );
    const request = createAliyunSmsRequest({
      phone,
      signName: resolution.configuration.signName,
      templateCode: resolution.configuration.templateCode,
      templateParams: buildTestTemplateParams(input.eventCode),
    });
    const response = await client.sendSms(request);
    const providerCode = response.body?.code ?? "UNKNOWN";
    const accepted = providerCode === "OK";
    const auditLogId = await writeSmsTestAudit(resolution.configuration.db, {
      userId: input.actorUserId,
      action: accepted
        ? "aliyun_sms_test_accepted"
        : "aliyun_sms_test_rejected",
      eventCode: input.eventCode,
      summary: accepted
        ? `阿里云短信测试已受理：${input.eventCode}`
        : `阿里云短信测试未受理：${input.eventCode}（服务商返回 ${providerCode}）`,
    });
    return {
      accepted,
      reason: accepted ? ("accepted" as const) : ("provider_rejected" as const),
      providerCode,
      auditLogId,
    };
  } catch (error) {
    const providerCode = extractSafeAliyunSmsErrorCode(error);
    const auditLogId = await writeSmsTestAudit(resolution.configuration.db, {
      userId: input.actorUserId,
      action: "aliyun_sms_test_failed",
      eventCode: input.eventCode,
      summary: `阿里云短信测试投递失败：${input.eventCode}（服务商异常 ${providerCode}）`,
    }).catch(() => null);
    return {
      accepted: false,
      reason: "delivery_failed" as const,
      providerCode,
      auditLogId,
    };
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
  const phone = input.recipientPhone
    ? normalizeRecipientPhone(input.recipientPhone)
    : null;
  if (!phone)
    return { sent: false, reason: "recipient_phone_unavailable" as const };
  const resolution = await resolveAliyunSmsDispatch(
    input.eventCode,
    input.module
  );
  if (!resolution.ready) return { sent: false, reason: resolution.reason };
  try {
    const client = createAliyunSmsClient(
      resolution.configuration.accessKeyId,
      resolution.configuration.accessKeySecret
    );
    const request = createAliyunSmsRequest({
      phone,
      signName: resolution.configuration.signName,
      templateCode: resolution.configuration.templateCode,
      templateParams: input.templateParams,
    });
    const response = await client.sendSms(request);
    const accepted = response.body?.code === "OK";
    await resolution.configuration.db.insert(auditLogs).values({
      userId: input.actorUserId,
      module: input.module,
      action: accepted ? "aliyun_sms_accepted" : "aliyun_sms_rejected",
      targetType: input.targetType,
      targetId: input.targetId,
      summary: accepted
        ? `阿里云短信已受理：${input.eventCode}`
        : `阿里云短信未受理：${input.eventCode}（服务商返回 ${response.body?.code ?? "未知状态"}）`,
    });
    return {
      sent: accepted,
      reason: accepted ? ("accepted" as const) : ("provider_rejected" as const),
    };
  } catch (error) {
    const providerCode = extractSafeAliyunSmsErrorCode(error);
    await resolution.configuration.db
      .insert(auditLogs)
      .values({
        userId: input.actorUserId,
        module: input.module,
        action: "aliyun_sms_failed",
        targetType: input.targetType,
        targetId: input.targetId,
        summary: `阿里云短信投递失败：${input.eventCode}（服务商异常 ${providerCode}），已保留站内通知和业务审计`,
      })
      .catch(() => undefined);
    return { sent: false, reason: "delivery_failed" as const };
  }
}

export { formatChinaSmsTime };
