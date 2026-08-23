import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { auditLogs, officialAccountDriverBindingRequests, officialAccountDriverBindings, officialAccountDriverNotificationRecords, transportVehicles } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret, encryptSecret } from "./secretVault";
import { buildSingleFieldSummary, fingerprintOfficialAccountOpenId, getOfficialAccountAccessToken, getOfficialAccountTemplateSemanticMismatch, loadPublishedOfficialAccountConfig, loadPublishedOfficialAccountCredentials, normalizeTemplateFieldValue, requestOfficialAccountApi, usesSingleFieldSummaryCompatibility } from "./officialAccountNotifier";

const DRIVER_BINDING_REQUEST_TTL_MS = 30 * 60 * 1_000;

export type DriverBindingRequestStatus =
  | { status: "ready"; expiresAt: Date }
  | { status: "invalid" | "expired" | "used" | "unavailable" };

function fingerprintDriverBindingToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function getSafeDriverBindingAppUrl(appUrl: string | null) {
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeDriverPlateNo(value: string) {
  return value.trim().toUpperCase().replace(/[\s·・.\-_]+/g, "").slice(0, 32);
}

export function isDriverBindingKeyword(content: string) {
  const compact = content.trim().replace(/\s+/g, "");
  return ["绑定", "绑定车辆", "车辆绑定", "司机绑定", "司机车辆绑定"].includes(compact);
}

export function verifyOfficialAccountEventSignature(input: { token: string; timestamp: string; nonce: string; signature: string }) {
  const expected = createHash("sha1").update([input.token, input.timestamp, input.nonce].sort().join(""), "utf8").digest("hex");
  const received = Buffer.from(input.signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

function extractXmlTag(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tagName}>|<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

export function parseWechatPlainTextMessage(xml: string) {
  return {
    toUserName: extractXmlTag(xml, "ToUserName"),
    fromUserName: extractXmlTag(xml, "FromUserName"),
    msgType: extractXmlTag(xml, "MsgType"),
    event: extractXmlTag(xml, "Event"),
    eventKey: extractXmlTag(xml, "EventKey"),
    content: extractXmlTag(xml, "Content"),
  };
}

function escapeCdata(value: string) {
  return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

export function buildWechatTextReplyXml(input: { toUserName: string; fromUserName: string; content: string }) {
  return `<xml><ToUserName><![CDATA[${escapeCdata(input.toUserName)}]]></ToUserName><FromUserName><![CDATA[${escapeCdata(input.fromUserName)}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${escapeCdata(input.content.slice(0, 600))}]]></Content></xml>`;
}

export async function createOfficialAccountDriverBindingRequest(openId: string) {
  const db = await getDb();
  const credentials = await loadPublishedOfficialAccountCredentials();
  const appUrl = getSafeDriverBindingAppUrl(credentials.config?.appUrl ?? null);
  if (!db || !credentials.config || !appUrl) return { success: false as const, reason: "not_configured" as const };
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + DRIVER_BINDING_REQUEST_TTL_MS);
  await db.insert(officialAccountDriverBindingRequests).values({
    tokenFingerprint: fingerprintDriverBindingToken(token),
    openIdEncrypted: encryptSecret(openId),
    openIdFingerprint: fingerprintOfficialAccountOpenId(openId),
    expiresAt,
  });
  const url = new URL("/driver-wechat-bind", appUrl);
  url.searchParams.set("token", token);
  return { success: true as const, url: url.toString(), expiresAt };
}

export async function getOfficialAccountDriverBindingRequestStatus(token: string): Promise<DriverBindingRequestStatus> {
  if (!token || token.length < 16 || token.length > 160) return { status: "invalid" };
  const db = await getDb();
  if (!db) return { status: "unavailable" };
  const [request] = await db.select().from(officialAccountDriverBindingRequests).where(eq(officialAccountDriverBindingRequests.tokenFingerprint, fingerprintDriverBindingToken(token))).orderBy(desc(officialAccountDriverBindingRequests.id)).limit(1);
  if (!request) return { status: "invalid" };
  if (request.consumedAt) return { status: "used" };
  if (request.expiresAt.getTime() < Date.now()) return { status: "expired" };
  return { status: "ready", expiresAt: request.expiresAt };
}

export async function completeOfficialAccountDriverVehicleBinding(input: { token: string; plateNo: string }) {
  const normalizedPlateNo = normalizeDriverPlateNo(input.plateNo);
  if (!normalizedPlateNo) return { success: false as const, reason: "invalid_plate" as const, message: "请填写完整车牌号。" };
  const db = await getDb();
  if (!db) return { success: false as const, reason: "database_unavailable" as const, message: "系统暂时无法连接数据库，请稍后再试。" };
  const [request] = await db.select().from(officialAccountDriverBindingRequests).where(and(eq(officialAccountDriverBindingRequests.tokenFingerprint, fingerprintDriverBindingToken(input.token)), gt(officialAccountDriverBindingRequests.expiresAt, new Date()))).orderBy(desc(officialAccountDriverBindingRequests.id)).limit(1);
  if (!request || request.consumedAt) return { success: false as const, reason: "invalid_or_used" as const, message: "绑定链接已失效或已使用，请在服务号重新发送“绑定”获取新链接。" };
  const vehicles = await db.select().from(transportVehicles).where(eq(transportVehicles.status, "active"));
  const matchedVehicles = vehicles.filter(vehicle => normalizeDriverPlateNo(vehicle.plateNo) === normalizedPlateNo);
  if (matchedVehicles.length !== 1) return { success: false as const, reason: "vehicle_not_found" as const, message: "没有找到这台可调度车辆，请核对车牌号，或联系管理员先在车辆台账录入。" };
  const vehicle = matchedVehicles[0];
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(officialAccountDriverBindings).set({ status: "revoked", updatedAt: now }).where(and(eq(officialAccountDriverBindings.openIdFingerprint, request.openIdFingerprint), eq(officialAccountDriverBindings.status, "active"), ne(officialAccountDriverBindings.vehicleId, vehicle.id)));
    await tx.update(officialAccountDriverBindings).set({ status: "revoked", updatedAt: now }).where(and(eq(officialAccountDriverBindings.vehicleId, vehicle.id), eq(officialAccountDriverBindings.status, "active")));
    await tx.insert(officialAccountDriverBindings).values({
      vehicleId: vehicle.id,
      projectId: vehicle.projectId,
      plateNoSnapshot: vehicle.plateNo,
      driverNameSnapshot: vehicle.driverName,
      driverPhoneMaskedSnapshot: vehicle.driverPhoneMasked,
      openIdEncrypted: request.openIdEncrypted,
      openIdFingerprint: request.openIdFingerprint,
      status: "active",
      boundAt: now,
      lastVerifiedAt: now,
      failureCount: 0,
    });
    await tx.update(officialAccountDriverBindingRequests).set({ consumedAt: now }).where(eq(officialAccountDriverBindingRequests.id, request.id));
    await tx.insert(auditLogs).values({ userId: null, module: "transport", action: "driver_wechat_bound", targetType: "transport_vehicle", targetId: String(vehicle.id), summary: `外部司机通过服务号自助绑定车辆 ${vehicle.plateNo}` });
  });
  return { success: true as const, vehicleId: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? null };
}

export async function revokeOfficialAccountDriverVehicleBinding(input: { vehicleId: number; operatorUserId: number }) {
  const db = await getDb();
  if (!db) return { success: false as const, reason: "database_unavailable" as const };
  const now = new Date();
  await db.update(officialAccountDriverBindings).set({ status: "revoked", updatedAt: now }).where(and(eq(officialAccountDriverBindings.vehicleId, input.vehicleId), eq(officialAccountDriverBindings.status, "active")));
  await db.insert(auditLogs).values({ userId: input.operatorUserId, module: "transport", action: "driver_wechat_binding_revoked", targetType: "transport_vehicle", targetId: String(input.vehicleId), summary: "管理员已解除该车辆的外部司机微信绑定" });
  return { success: true as const };
}

function renderDriverTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{(title|content|eventCode|targetType|targetId|operationTime)\}/g, (_match, key: string) => variables[key] ?? "");
}

function buildDriverDeepLink(appUrl: string | null, deepLink: string | undefined) {
  if (!appUrl || !deepLink || !deepLink.startsWith("/") || deepLink.startsWith("//")) return undefined;
  try {
    const base = new URL(appUrl);
    if (base.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(base.hostname)) return undefined;
    return new URL(deepLink, base).toString();
  } catch {
    return undefined;
  }
}

function classifyDriverDeliveryFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code.toUpperCase()
    : null;
  if (causeCode && /^[A-Z0-9_]{3,64}$/.test(causeCode)) return `network_${causeCode.toLowerCase()}`.slice(0, 64);
  return "request_failed";
}

/** 向车辆外部司机微信发送服务号模板通知；司机不是系统账号，投递记录写入专用审计表。 */
export async function sendOfficialAccountDriverNotification(input: { vehicleId: number; projectId: number; module: "transport"; eventCode: string; idempotencyKey: string; title: string; content: string; deepLink?: string }) {
  const db = await getDb();
  if (!db) return { delivered: false as const, reason: "database_unavailable" as const };
  const idempotencyKey = input.idempotencyKey.slice(0, 180);
  const [existing] = await db.select({ id: officialAccountDriverNotificationRecords.id, status: officialAccountDriverNotificationRecords.status }).from(officialAccountDriverNotificationRecords).where(eq(officialAccountDriverNotificationRecords.idempotencyKey, idempotencyKey)).limit(1);
  if (existing?.status === "sent" || existing?.status === "pending") return { delivered: false as const, reason: "duplicate" as const };
  const [binding] = await db.select().from(officialAccountDriverBindings).where(and(eq(officialAccountDriverBindings.vehicleId, input.vehicleId), eq(officialAccountDriverBindings.status, "active"))).orderBy(desc(officialAccountDriverBindings.id)).limit(1);
  const upsertRecord = async (values: Partial<typeof officialAccountDriverNotificationRecords.$inferInsert>) => {
    if (existing) {
      await db.update(officialAccountDriverNotificationRecords).set({ ...values, retryCount: sql`${officialAccountDriverNotificationRecords.retryCount} + 1`, lastAttemptedAt: new Date() }).where(eq(officialAccountDriverNotificationRecords.id, existing.id));
      return;
    }
    await db.insert(officialAccountDriverNotificationRecords).values({
      eventCode: input.eventCode.slice(0, 128),
      idempotencyKey,
      driverBindingId: binding?.id ?? null,
      vehicleId: input.vehicleId,
      projectId: input.projectId,
      title: input.title.slice(0, 200),
      content: input.content.slice(0, 1500),
      deepLink: input.deepLink?.slice(0, 512) ?? null,
      status: values.status ?? "pending",
      providerMessageId: values.providerMessageId ?? null,
      failureCode: values.failureCode ?? null,
      sentAt: values.sentAt ?? null,
      lastAttemptedAt: new Date(),
    });
  };
  if (!binding) {
    await upsertRecord({ status: "skipped", failureCode: "driver_not_bound" });
    return { delivered: false as const, reason: "not_bound" as const };
  }
  const configResult = await loadPublishedOfficialAccountConfig();
  if (!configResult.config) {
    await upsertRecord({ status: "failed", failureCode: configResult.reason ?? "not_configured" });
    return { delivered: false as const, reason: configResult.reason ?? "not_configured" as const };
  }
  const template = configResult.config.moduleTemplates[input.module] ?? configResult.config.fallbackTemplate;
  if (!template) {
    await upsertRecord({ status: "skipped", failureCode: "module_template_not_bound" });
    return { delivered: false as const, reason: "disabled" as const };
  }
  const semanticMismatch = getOfficialAccountTemplateSemanticMismatch({ module: input.module, eventCode: input.eventCode, templateTitle: template.title });
  if (semanticMismatch) {
    await upsertRecord({ status: "skipped", failureCode: semanticMismatch });
    return { delivered: false as const, reason: "disabled" as const };
  }
  await upsertRecord({ status: "pending", failureCode: null });
  try {
    const openId = decryptSecret(binding.openIdEncrypted);
    const token = await getOfficialAccountAccessToken(configResult.config);
    const variables = { title: input.title.slice(0, 120), content: input.content.slice(0, 160), eventCode: input.eventCode.slice(0, 64), targetType: "运输车辆", targetId: binding.plateNoSnapshot.slice(0, 64), operationTime: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) };
    const singleFieldSummaryCompatibility = usesSingleFieldSummaryCompatibility(template.templateFields);
    const data = Object.fromEntries(Object.entries(template.templateFields).map(([key, value]) => [key, { value: normalizeTemplateFieldValue(key, singleFieldSummaryCompatibility ? buildSingleFieldSummary(variables) : renderDriverTemplate(value, variables)) }]));
    let response = await requestOfficialAccountApi(configResult.config, `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ touser: openId, template_id: template.templateId, url: buildDriverDeepLink(configResult.config.appUrl, input.deepLink), data }),
      signal: AbortSignal.timeout(8_000),
    });
    let payload = await response.json().catch(() => null) as { errcode?: number; msgid?: number | string } | null;
    if (payload?.errcode === 40037) {
      response = await requestOfficialAccountApi(configResult.config, `https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser: openId, template_id: template.templateId, data, miniprogram_state: "formal", lang: "zh_CN" }),
        signal: AbortSignal.timeout(8_000),
      });
      payload = await response.json().catch(() => null) as { errcode?: number; msgid?: number | string } | null;
    }
    if (!response.ok || payload?.errcode !== 0) {
      const failureCode = String(payload?.errcode ?? response.status).slice(0, 64);
      await db.update(officialAccountDriverBindings).set({ lastFailureAt: new Date(), failureCount: binding.failureCount + 1 }).where(eq(officialAccountDriverBindings.id, binding.id));
      await upsertRecord({ status: "failed", failureCode });
      return { delivered: false as const, reason: "delivery_failed" as const };
    }
    await db.update(officialAccountDriverBindings).set({ lastVerifiedAt: new Date(), failureCount: 0 }).where(eq(officialAccountDriverBindings.id, binding.id));
    await upsertRecord({ status: "sent", sentAt: new Date(), providerMessageId: payload.msgid ? String(payload.msgid) : null, failureCode: null });
    return { delivered: true as const, reason: "sent" as const, providerMessageId: payload.msgid ? String(payload.msgid) : undefined };
  } catch (error) {
    await upsertRecord({ status: "failed", failureCode: classifyDriverDeliveryFailure(error) });
    return { delivered: false as const, reason: "delivery_failed" as const };
  }
}
