import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { auditLogs, dieselRefuelRecords, officialAccountDriverBindingRequests, officialAccountDriverBindings, officialAccountDriverNotificationRecords, projects, transportTrips, transportVehicleSettlements, transportVehicles } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret, encryptSecret } from "./secretVault";
import { buildSingleFieldSummary, fingerprintOfficialAccountOpenId, getOfficialAccountAccessToken, getOfficialAccountTemplateSemanticMismatch, loadPublishedOfficialAccountConfig, loadPublishedOfficialAccountCredentials, normalizeTemplateFieldValue, requestOfficialAccountApi, usesSingleFieldSummaryCompatibility } from "./officialAccountNotifier";

const DRIVER_BINDING_REQUEST_TTL_MS = 30 * 60 * 1_000;
const DRIVER_PORTAL_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

export type DriverBindingRequestStatus =
  | { status: "ready"; expiresAt: Date }
  | { status: "invalid" | "expired" | "used" | "unavailable" };

export type DriverPortalSummaryStatus =
  | { status: "ready"; summary: DriverPortalSummary }
  | { status: "invalid" | "expired" | "unbound" | "unavailable" };

export type DriverPortalSummary = {
  vehicle: { id: number; plateNo: string; driverName: string | null; driverPhoneMasked: string | null; projectName: string | null };
  totals: {
    tripCount: number;
    grossFreightAmount: number;
    settledFuelDeductionAmount: number;
    pendingFuelDeductionAmount: number;
    netPayableAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    pendingTripAmount: number;
  };
  settlements: Array<{ settlementNo: string; status: string; periodStart: string; periodEnd: string; tripCount: number; grossFreightAmount: number; fuelDeductionAmount: number; netPayableAmount: number; paidAt: Date | null; paymentDate: string | null }>;
  dieselRecords: Array<{ recordNo: string; refueledAt: Date; liters: number; amount: number; status: string; supplyMethod: string; deductFromFreight: boolean }>;
  recentTrips: Array<{ tripNo: string; startAt: Date; status: string; grossFreightAmount: number; fuelDeductionAmount: number; netSettlementAmount: number | null }>;
};

type DriverPortalSession = { bindingId: number; vehicleId: number; issuedAt: number; expiresAt: number; nonce: string };

function fingerprintDriverBindingToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function getDriverPortalSigningKey() {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error("系统未配置司机端访问签名密钥");
  return key;
}

function signDriverPortalPayload(payload: string) {
  return createHmac("sha256", getDriverPortalSigningKey()).update(payload, "utf8").digest("base64url");
}

function createDriverPortalSessionToken(input: { bindingId: number; vehicleId: number }) {
  const issuedAt = Date.now();
  const session: DriverPortalSession = { bindingId: input.bindingId, vehicleId: input.vehicleId, issuedAt, expiresAt: issuedAt + DRIVER_PORTAL_SESSION_TTL_MS, nonce: randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signDriverPortalPayload(payload)}`;
}

function verifyDriverPortalSessionToken(token: string): DriverPortalSession | null {
  const [payload, receivedSignature] = token.split(".");
  if (!payload || !receivedSignature) return null;
  const expectedSignature = signDriverPortalPayload(payload);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DriverPortalSession>;
    if (!Number.isInteger(parsed.bindingId) || !Number.isInteger(parsed.vehicleId) || typeof parsed.issuedAt !== "number" || typeof parsed.expiresAt !== "number" || typeof parsed.nonce !== "string") return null;
    if (parsed.expiresAt < Date.now()) return { bindingId: parsed.bindingId!, vehicleId: parsed.vehicleId!, issuedAt: parsed.issuedAt, expiresAt: parsed.expiresAt, nonce: parsed.nonce };
    return { bindingId: parsed.bindingId!, vehicleId: parsed.vehicleId!, issuedAt: parsed.issuedAt, expiresAt: parsed.expiresAt, nonce: parsed.nonce };
  } catch {
    return null;
  }
}

function isDriverPortalSessionExpired(session: DriverPortalSession) {
  return session.expiresAt < Date.now();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
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
  let bindingId: number | null = null;
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
    const [createdBinding] = await tx.select({ id: officialAccountDriverBindings.id }).from(officialAccountDriverBindings).where(and(eq(officialAccountDriverBindings.vehicleId, vehicle.id), eq(officialAccountDriverBindings.openIdFingerprint, request.openIdFingerprint), eq(officialAccountDriverBindings.status, "active"))).orderBy(desc(officialAccountDriverBindings.id)).limit(1);
    bindingId = createdBinding ? Number(createdBinding.id) : null;
    await tx.update(officialAccountDriverBindingRequests).set({ consumedAt: now }).where(eq(officialAccountDriverBindingRequests.id, request.id));
    await tx.insert(auditLogs).values({ userId: null, module: "transport", action: "driver_wechat_bound", targetType: "transport_vehicle", targetId: String(vehicle.id), summary: `外部司机通过服务号自助绑定车辆 ${vehicle.plateNo}` });
  });
  const portalToken = bindingId ? createDriverPortalSessionToken({ bindingId, vehicleId: vehicle.id }) : null;
  const credentials = await loadPublishedOfficialAccountCredentials();
  const appUrl = getSafeDriverBindingAppUrl(credentials.config?.appUrl ?? null);
  const portalUrl = appUrl && portalToken ? new URL(`/driver-portal?token=${encodeURIComponent(portalToken)}`, appUrl).toString() : null;
  return { success: true as const, vehicleId: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? null, portalUrl };
}

export async function createOfficialAccountDriverPortalSession(openId: string) {
  const db = await getDb();
  const credentials = await loadPublishedOfficialAccountCredentials();
  const appUrl = getSafeDriverBindingAppUrl(credentials.config?.appUrl ?? null);
  if (!db || !credentials.config || !appUrl) return { success: false as const, reason: "not_configured" as const };
  const fingerprint = fingerprintOfficialAccountOpenId(openId);
  const [binding] = await db.select().from(officialAccountDriverBindings).where(and(eq(officialAccountDriverBindings.openIdFingerprint, fingerprint), eq(officialAccountDriverBindings.status, "active"))).orderBy(desc(officialAccountDriverBindings.id)).limit(1);
  if (!binding) return { success: false as const, reason: "unbound" as const };
  const token = createDriverPortalSessionToken({ bindingId: Number(binding.id), vehicleId: binding.vehicleId });
  const url = new URL("/driver-portal", appUrl);
  url.searchParams.set("token", token);
  return { success: true as const, url: url.toString(), token };
}

export async function getOfficialAccountDriverPortalSummary(token: string): Promise<DriverPortalSummaryStatus> {
  if (!token || token.length < 16 || token.length > 512) return { status: "invalid" };
  const session = verifyDriverPortalSessionToken(token);
  if (!session) return { status: "invalid" };
  if (isDriverPortalSessionExpired(session)) return { status: "expired" };
  const db = await getDb();
  if (!db) return { status: "unavailable" };
  const [binding] = await db.select().from(officialAccountDriverBindings).where(and(eq(officialAccountDriverBindings.id, session.bindingId), eq(officialAccountDriverBindings.vehicleId, session.vehicleId), eq(officialAccountDriverBindings.status, "active"))).limit(1);
  if (!binding) return { status: "unbound" };
  const [vehicle] = await db.select({ id: transportVehicles.id, projectId: transportVehicles.projectId, plateNo: transportVehicles.plateNo, driverName: transportVehicles.driverName, driverPhoneMasked: transportVehicles.driverPhoneMasked, status: transportVehicles.status }).from(transportVehicles).where(eq(transportVehicles.id, binding.vehicleId)).limit(1);
  if (!vehicle || vehicle.status !== "active") return { status: "unbound" };
  const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, vehicle.projectId)).limit(1);
  const [trips, settlements, dieselRows] = await Promise.all([
    db.select().from(transportTrips).where(and(eq(transportTrips.projectId, vehicle.projectId), eq(transportTrips.vehicleId, vehicle.id))).orderBy(desc(transportTrips.startAt)),
    db.select().from(transportVehicleSettlements).where(and(eq(transportVehicleSettlements.projectId, vehicle.projectId), eq(transportVehicleSettlements.vehicleId, vehicle.id))).orderBy(desc(transportVehicleSettlements.createdAt)),
    db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, vehicle.projectId), eq(dieselRefuelRecords.vehicleId, vehicle.id), eq(dieselRefuelRecords.assetType, "vehicle"))).orderBy(desc(dieselRefuelRecords.refueledAt)),
  ]);
  const validTrips = trips.filter(item => item.status !== "void");
  const validSettlements = settlements.filter(item => item.status !== "void");
  const deductibleDiesel = dieselRows.filter(item => item.status !== "void" && item.deductFromFreight);
  const paidAmount = roundMoney(validSettlements.filter(item => item.status === "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0));
  const unpaidAmount = roundMoney(validSettlements.filter(item => item.status !== "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0));
  const settledFuelDeductionAmount = roundMoney(validSettlements.reduce((sum, item) => sum + toNumber(item.fuelDeductionAmount), 0));
  const pendingFuelDeductionAmount = roundMoney(deductibleDiesel.filter(item => item.status === "approved").reduce((sum, item) => sum + toNumber(item.amount), 0));
  const pendingTripAmount = roundMoney(validTrips.filter(item => ["verified"].includes(item.status)).reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0));
  const summary: DriverPortalSummary = {
    vehicle: { id: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? binding.driverNameSnapshot ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? binding.driverPhoneMaskedSnapshot ?? null, projectName: project?.name ?? null },
    totals: {
      tripCount: validTrips.length,
      grossFreightAmount: roundMoney(validTrips.reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0)),
      settledFuelDeductionAmount,
      pendingFuelDeductionAmount,
      netPayableAmount: roundMoney(validSettlements.reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0)),
      paidAmount,
      unpaidAmount,
      pendingTripAmount,
    },
    settlements: validSettlements.slice(0, 20).map(item => ({ settlementNo: item.settlementNo, status: item.status, periodStart: String(item.periodStart), periodEnd: String(item.periodEnd), tripCount: item.tripCount, grossFreightAmount: toNumber(item.grossFreightAmount), fuelDeductionAmount: toNumber(item.fuelDeductionAmount), netPayableAmount: toNumber(item.netPayableAmount), paidAt: item.paidAt ?? null, paymentDate: item.paymentDate ? String(item.paymentDate) : null })),
    dieselRecords: dieselRows.filter(item => item.status !== "void").slice(0, 20).map(item => ({ recordNo: item.recordNo, refueledAt: item.refueledAt, liters: toNumber(item.liters), amount: toNumber(item.amount), status: item.status, supplyMethod: item.supplyMethod, deductFromFreight: item.deductFromFreight })),
    recentTrips: validTrips.slice(0, 20).map(item => ({ tripNo: item.tripNo, startAt: item.startAt, status: item.status, grossFreightAmount: toNumber(item.calculatedAmount), fuelDeductionAmount: toNumber(item.fuelDeductionAmount), netSettlementAmount: item.netSettlementAmount === null ? null : toNumber(item.netSettlementAmount) })),
  };
  return { status: "ready", summary };
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
export async function sendOfficialAccountDriverNotification(input: { vehicleId: number; projectId: number; module: "transport" | "diesel"; eventCode: string; idempotencyKey: string; title: string; content: string; deepLink?: string }) {
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
      body: JSON.stringify({ touser: openId, template_id: template.templateId, url: buildDriverDeepLink(configResult.config.appUrl, input.deepLink ?? "/api/official-account/driver-portal/start"), data }),
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
