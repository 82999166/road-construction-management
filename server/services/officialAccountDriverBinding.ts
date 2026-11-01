import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { auditLogs, dieselRefuelRecords, officialAccountBindings, officialAccountDriverBindingRequests, officialAccountDriverBindings, officialAccountDriverNotificationRecords, projects, systemRoles, transportSites, transportTrips, transportVehicleSettlements, transportVehicles, userRoleAssignments, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createLocalDriverOpenId, createLocalManagerPasswordHash } from "../localAuth";
import { ensureFoundationData } from "./foundationData";
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
  today: { businessDate: string; tripCount: number; grossFreightAmount: number; fuelDeductionAmount: number };
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
  dieselRecords: Array<{ recordNo: string; refueledAt: Date; liters: number; amount: number; status: string; supplyMethod: string; deductFromFreight: boolean; meterReading: number | null; receiptNo: string | null; stationOrSupplierName: string | null; remarks: string | null }>;
  recentTrips: Array<{ tripNo: string; startAt: Date; endAt: Date | null; status: string; invoiceMode: string; routeLabel: string; actualDistanceKm: number | null; volumeCubicMeters: number | null; grossFreightAmount: number; fuelDeductionAmount: number; netSettlementAmount: number | null }>;
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

/** 司机门户的“当日”按中国业务日聚合，避免服务器 UTC 日期与现场日期错位。 */
function chinaBusinessDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
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

/** 司机绑定手机号仅接受中国大陆手机号；可输入空格、短横线或 +86 前缀，服务端统一归一化后再比较。 */
export function normalizeDriverPhone(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  const withoutCountryCode = digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
  return /^1[3-9]\d{9}$/.test(withoutCountryCode) ? withoutCountryCode : "";
}

function isSameDriverPhone(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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

export async function completeOfficialAccountDriverVehicleBinding(input: { token: string; plateNo: string; driverPhone: string; initialPassword: string }) {
  const normalizedPlateNo = normalizeDriverPlateNo(input.plateNo);
  if (!normalizedPlateNo) return { success: false as const, reason: "invalid_plate" as const, message: "请填写完整车牌号。" };
  const normalizedDriverPhone = normalizeDriverPhone(input.driverPhone);
  if (!normalizedDriverPhone) return { success: false as const, reason: "invalid_driver_phone" as const, message: "请填写司机本人登记的11位手机号。" };
  if (input.initialPassword.length < 6 || input.initialPassword.length > 128) return { success: false as const, reason: "invalid_initial_password" as const, message: "请设置 6 至 128 位的司机登录密码。" };
  const db = await getDb();
  if (!db) return { success: false as const, reason: "database_unavailable" as const, message: "系统暂时无法连接数据库，请稍后再试。" };
  const [request] = await db.select().from(officialAccountDriverBindingRequests).where(and(eq(officialAccountDriverBindingRequests.tokenFingerprint, fingerprintDriverBindingToken(input.token)), gt(officialAccountDriverBindingRequests.expiresAt, new Date()))).orderBy(desc(officialAccountDriverBindingRequests.id)).limit(1);
  if (!request || request.consumedAt) return { success: false as const, reason: "invalid_or_used" as const, message: "绑定链接已失效或已使用，请在服务号重新发送“绑定”获取新链接。" };
  const vehicles = await db.select().from(transportVehicles).where(eq(transportVehicles.status, "active"));
  const matchedVehicles = vehicles.filter(vehicle => normalizeDriverPlateNo(vehicle.plateNo) === normalizedPlateNo);
  if (matchedVehicles.length !== 1) return { success: false as const, reason: "vehicle_not_found" as const, message: "没有找到这台可调度车辆，请核对车牌号，或联系管理员先在车辆台账录入。" };
  const vehicle = matchedVehicles[0];
  let verifiedDriverPhone = "";
  try {
    verifiedDriverPhone = vehicle.driverPhoneEncrypted ? normalizeDriverPhone(decryptSecret(vehicle.driverPhoneEncrypted)) : "";
  } catch {
    verifiedDriverPhone = "";
  }
  if (!verifiedDriverPhone || !isSameDriverPhone(verifiedDriverPhone, normalizedDriverPhone)) {
    await db.insert(auditLogs).values({ userId: null, module: "transport", action: "driver_wechat_binding_phone_mismatch", targetType: "transport_vehicle", targetId: String(vehicle.id), summary: "外部司机微信车辆绑定手机号校验失败" });
    return { success: false as const, reason: "driver_phone_mismatch" as const, message: "车牌与司机手机号未匹配，请核对登记手机号；如车辆台账未登记手机号，请联系管理员补充后再绑定。" };
  }
  const [existingLocalAccount] = await db.select({ id: users.id, loginMethod: users.loginMethod, localAccountStatus: users.localAccountStatus }).from(users).where(eq(users.localUsername, normalizedDriverPhone)).limit(1);
  if (existingLocalAccount && existingLocalAccount.loginMethod !== "local_driver") {
    return { success: false as const, reason: "phone_account_conflict" as const, message: "该手机号已被其他系统账号使用，请联系管理员处理后再绑定。" };
  }
  if (existingLocalAccount?.localAccountStatus === "disabled") {
    return { success: false as const, reason: "driver_account_disabled" as const, message: "该司机手机号账号已停用，请联系管理员启用后再登录。" };
  }
  if (existingLocalAccount) {
    const assignedToOtherVehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.driverUserId, existingLocalAccount.id), ne(transportVehicles.id, vehicle.id))).limit(1);
    if (assignedToOtherVehicles[0]) return { success: false as const, reason: "driver_account_vehicle_conflict" as const, message: "该司机手机号账号已关联其他车辆，请联系管理员调整车辆后再绑定。" };
  }
  if (vehicle.driverUserId && vehicle.driverUserId !== existingLocalAccount?.id) {
    return { success: false as const, reason: "vehicle_account_conflict" as const, message: "该车辆已关联其他司机系统账号，请联系管理员核验后处理。" };
  }
  const [openIdOwner] = await db.select({ userId: officialAccountBindings.userId }).from(officialAccountBindings).where(and(eq(officialAccountBindings.openIdFingerprint, request.openIdFingerprint), eq(officialAccountBindings.status, "active"))).limit(1);
  if (openIdOwner && openIdOwner.userId !== existingLocalAccount?.id) {
    return { success: false as const, reason: "wechat_account_conflict" as const, message: "当前微信已关联其他系统账号，请联系管理员处理后再绑定。" };
  }
  await ensureFoundationData(db);
  const [driverRole] = await db.select({ id: systemRoles.id }).from(systemRoles).where(and(eq(systemRoles.code, "DRIVER"), eq(systemRoles.status, "active"))).limit(1);
  if (!driverRole) return { success: false as const, reason: "driver_role_unavailable" as const, message: "司机角色暂不可用，请联系管理员后重试。" };
  const now = new Date();
  let bindingId: number | null = null;
  let driverUserId = existingLocalAccount?.id ?? null;
  let accountProvisioned = false;
  await db.transaction(async tx => {
    if (!driverUserId) {
      await tx.insert(users).values({
        openId: createLocalDriverOpenId(normalizedDriverPhone),
        name: vehicle.driverName || "司机",
        loginMethod: "local_driver",
        role: "user",
        localUsername: normalizedDriverPhone,
        localPasswordHash: createLocalManagerPasswordHash(input.initialPassword),
        localAccountStatus: "active",
        localLoginMode: "mobile",
        localPasswordChangeRequired: false,
        lastSignedIn: now,
      });
      const [createdUser] = await tx.select({ id: users.id }).from(users).where(and(eq(users.localUsername, normalizedDriverPhone), eq(users.loginMethod, "local_driver"))).limit(1);
      if (!createdUser) throw new Error("司机手机号账号创建失败");
      driverUserId = createdUser.id;
      accountProvisioned = true;
    }
    if (!driverUserId) throw new Error("司机手机号账号不可用");
    await tx.update(transportVehicles).set({ driverUserId }).where(and(eq(transportVehicles.id, vehicle.id), or(isNull(transportVehicles.driverUserId), eq(transportVehicles.driverUserId, driverUserId))));
    const [vehicleAccount] = await tx.select({ driverUserId: transportVehicles.driverUserId }).from(transportVehicles).where(eq(transportVehicles.id, vehicle.id)).limit(1);
    if (vehicleAccount?.driverUserId !== driverUserId) throw new Error("车辆司机账号关联冲突");
    const [activeDriverAssignment] = await tx.select({ id: userRoleAssignments.id }).from(userRoleAssignments).where(and(eq(userRoleAssignments.userId, driverUserId), eq(userRoleAssignments.roleId, driverRole.id), eq(userRoleAssignments.projectId, vehicle.projectId), eq(userRoleAssignments.status, "active"))).limit(1);
    if (!activeDriverAssignment) await tx.insert(userRoleAssignments).values({ userId: driverUserId, roleId: driverRole.id, projectId: vehicle.projectId, organizationId: null, status: "active", grantedBy: null });
    const [userWechatBinding] = await tx.select({ id: officialAccountBindings.id }).from(officialAccountBindings).where(eq(officialAccountBindings.userId, driverUserId)).limit(1);
    if (userWechatBinding) {
      await tx.update(officialAccountBindings).set({ openIdEncrypted: request.openIdEncrypted, openIdFingerprint: request.openIdFingerprint, bindingSource: "wechat_oauth", status: "active", boundAt: now, lastVerifiedAt: now, lastFailureAt: null, failureCount: 0 }).where(eq(officialAccountBindings.id, userWechatBinding.id));
    } else {
      await tx.insert(officialAccountBindings).values({ userId: driverUserId, openIdEncrypted: request.openIdEncrypted, openIdFingerprint: request.openIdFingerprint, bindingSource: "wechat_oauth", status: "active", boundAt: now, lastVerifiedAt: now, failureCount: 0 });
    }
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
    if (accountProvisioned) await tx.insert(auditLogs).values({ userId: driverUserId, module: "security", action: "driver_mobile_account_provisioned", targetType: "user", targetId: String(driverUserId), summary: "司机手机号移动端账号已开通并关联微信身份" });
  });
  const portalToken = bindingId ? createDriverPortalSessionToken({ bindingId, vehicleId: vehicle.id }) : null;
  const credentials = await loadPublishedOfficialAccountCredentials();
  const appUrl = getSafeDriverBindingAppUrl(credentials.config?.appUrl ?? null);
  const portalUrl = appUrl && portalToken ? new URL(`/driver-portal?token=${encodeURIComponent(portalToken)}`, appUrl).toString() : null;
  return { success: true as const, vehicleId: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? null, portalUrl, mobileLoginUrl: "/login?returnTo=%2Fmobile", accountProvisioned };
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
  const [trips, settlements, dieselRows, sites] = await Promise.all([
    db.select().from(transportTrips).where(and(eq(transportTrips.projectId, vehicle.projectId), eq(transportTrips.vehicleId, vehicle.id))).orderBy(desc(transportTrips.startAt)),
    db.select().from(transportVehicleSettlements).where(and(eq(transportVehicleSettlements.projectId, vehicle.projectId), eq(transportVehicleSettlements.vehicleId, vehicle.id))).orderBy(desc(transportVehicleSettlements.createdAt)),
    db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, vehicle.projectId), eq(dieselRefuelRecords.vehicleId, vehicle.id), eq(dieselRefuelRecords.assetType, "vehicle"))).orderBy(desc(dieselRefuelRecords.refueledAt)),
    db.select({ id: transportSites.id, name: transportSites.name }).from(transportSites).where(eq(transportSites.projectId, vehicle.projectId)),
  ]);
  const validTrips = trips.filter(item => item.status !== "void");
  const validSettlements = settlements.filter(item => item.status !== "void");
  const deductibleDiesel = dieselRows.filter(item => item.status !== "void" && item.deductFromFreight);
  const today = chinaBusinessDate(new Date());
  const todayTrips = validTrips.filter(item => chinaBusinessDate(item.startAt) === today);
  const todayDiesel = deductibleDiesel.filter(item => chinaBusinessDate(item.refueledAt) === today);
  const siteNameById = new Map(sites.map(item => [item.id, item.name]));
  const paidAmount = roundMoney(validSettlements.filter(item => item.status === "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0));
  const unpaidAmount = roundMoney(validSettlements.filter(item => item.status !== "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0));
  const settledFuelDeductionAmount = roundMoney(validSettlements.reduce((sum, item) => sum + toNumber(item.fuelDeductionAmount), 0));
  const pendingFuelDeductionAmount = roundMoney(deductibleDiesel.filter(item => item.status === "approved").reduce((sum, item) => sum + toNumber(item.amount), 0));
  const pendingTripAmount = roundMoney(validTrips.filter(item => ["verified"].includes(item.status)).reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0));
  const summary: DriverPortalSummary = {
    vehicle: { id: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? binding.driverNameSnapshot ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? binding.driverPhoneMaskedSnapshot ?? null, projectName: project?.name ?? null },
    today: {
      businessDate: today,
      tripCount: todayTrips.length,
      grossFreightAmount: roundMoney(todayTrips.reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0)),
      fuelDeductionAmount: roundMoney(todayDiesel.reduce((sum, item) => sum + toNumber(item.amount), 0)),
    },
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
    dieselRecords: dieselRows.filter(item => item.status !== "void").slice(0, 20).map(item => ({ recordNo: item.recordNo, refueledAt: item.refueledAt, liters: toNumber(item.liters), amount: toNumber(item.amount), status: item.status, supplyMethod: item.supplyMethod, deductFromFreight: item.deductFromFreight, meterReading: item.meterReading === null ? null : toNumber(item.meterReading), receiptNo: item.receiptNo ?? null, stationOrSupplierName: item.stationOrSupplierName ?? null, remarks: item.remarks ?? null })),
    recentTrips: validTrips.slice(0, 20).map(item => ({ tripNo: item.tripNo, startAt: item.startAt, endAt: item.endAt ?? null, status: item.status, invoiceMode: item.invoiceMode, routeLabel: `${item.loadSiteId ? siteNameById.get(item.loadSiteId) ?? "装土点未记录" : "装土点未记录"} → ${item.unloadSiteId ? siteNameById.get(item.unloadSiteId) ?? "卸土点未记录" : "卸土点未记录"}`, actualDistanceKm: item.actualDistanceKm === null ? null : toNumber(item.actualDistanceKm), volumeCubicMeters: item.volumeCubicMeters === null ? null : toNumber(item.volumeCubicMeters), grossFreightAmount: toNumber(item.calculatedAmount), fuelDeductionAmount: toNumber(item.fuelDeductionAmount), netSettlementAmount: item.netSettlementAmount === null ? null : toNumber(item.netSettlementAmount) })),
  };
  return { status: "ready", summary };
}

/**
 * 手机号司机账号的站内账单入口。车辆必须仍明确绑定给当前用户；该方法不接受车辆ID，
 * 从而避免司机通过客户端参数探测或查看其他车辆。
 */
export async function getLocalDriverPortalSummary(userId: number): Promise<DriverPortalSummaryStatus> {
  const db = await getDb();
  if (!db) return { status: "unavailable" };
  const [vehicle] = await db
    .select({ id: transportVehicles.id, projectId: transportVehicles.projectId, plateNo: transportVehicles.plateNo, driverName: transportVehicles.driverName, driverPhoneMasked: transportVehicles.driverPhoneMasked, status: transportVehicles.status })
    .from(transportVehicles)
    .where(and(eq(transportVehicles.driverUserId, userId), eq(transportVehicles.status, "active")))
    .orderBy(desc(transportVehicles.updatedAt))
    .limit(1);
  if (!vehicle) return { status: "unbound" };
  const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, vehicle.projectId)).limit(1);
  const [trips, settlements, dieselRows, sites] = await Promise.all([
    db.select().from(transportTrips).where(and(eq(transportTrips.projectId, vehicle.projectId), eq(transportTrips.vehicleId, vehicle.id))).orderBy(desc(transportTrips.startAt)),
    db.select().from(transportVehicleSettlements).where(and(eq(transportVehicleSettlements.projectId, vehicle.projectId), eq(transportVehicleSettlements.vehicleId, vehicle.id))).orderBy(desc(transportVehicleSettlements.createdAt)),
    db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, vehicle.projectId), eq(dieselRefuelRecords.vehicleId, vehicle.id), eq(dieselRefuelRecords.assetType, "vehicle"))).orderBy(desc(dieselRefuelRecords.refueledAt)),
    db.select({ id: transportSites.id, name: transportSites.name }).from(transportSites).where(eq(transportSites.projectId, vehicle.projectId)),
  ]);
  const validTrips = trips.filter(item => item.status !== "void");
  const validSettlements = settlements.filter(item => item.status !== "void");
  const deductibleDiesel = dieselRows.filter(item => item.status !== "void" && item.deductFromFreight);
  const today = chinaBusinessDate(new Date());
  const todayTrips = validTrips.filter(item => chinaBusinessDate(item.startAt) === today);
  const todayDiesel = deductibleDiesel.filter(item => chinaBusinessDate(item.refueledAt) === today);
  const siteNameById = new Map(sites.map(item => [item.id, item.name]));
  const paidAmount = roundMoney(validSettlements.filter(item => item.status === "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0));
  const summary: DriverPortalSummary = {
    vehicle: { id: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? null, driverPhoneMasked: vehicle.driverPhoneMasked ?? null, projectName: project?.name ?? null },
    today: { businessDate: today, tripCount: todayTrips.length, grossFreightAmount: roundMoney(todayTrips.reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0)), fuelDeductionAmount: roundMoney(todayDiesel.reduce((sum, item) => sum + toNumber(item.amount), 0)) },
    totals: {
      tripCount: validTrips.length,
      grossFreightAmount: roundMoney(validTrips.reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0)),
      settledFuelDeductionAmount: roundMoney(validSettlements.reduce((sum, item) => sum + toNumber(item.fuelDeductionAmount), 0)),
      pendingFuelDeductionAmount: roundMoney(deductibleDiesel.filter(item => item.status === "approved").reduce((sum, item) => sum + toNumber(item.amount), 0)),
      netPayableAmount: roundMoney(validSettlements.reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0)),
      paidAmount,
      unpaidAmount: roundMoney(validSettlements.filter(item => item.status !== "paid").reduce((sum, item) => sum + toNumber(item.netPayableAmount), 0)),
      pendingTripAmount: roundMoney(validTrips.filter(item => item.status === "verified").reduce((sum, item) => sum + toNumber(item.calculatedAmount), 0)),
    },
    settlements: validSettlements.slice(0, 20).map(item => ({ settlementNo: item.settlementNo, status: item.status, periodStart: String(item.periodStart), periodEnd: String(item.periodEnd), tripCount: item.tripCount, grossFreightAmount: toNumber(item.grossFreightAmount), fuelDeductionAmount: toNumber(item.fuelDeductionAmount), netPayableAmount: toNumber(item.netPayableAmount), paidAt: item.paidAt ?? null, paymentDate: item.paymentDate ? String(item.paymentDate) : null })),
    dieselRecords: dieselRows.filter(item => item.status !== "void").slice(0, 20).map(item => ({ recordNo: item.recordNo, refueledAt: item.refueledAt, liters: toNumber(item.liters), amount: toNumber(item.amount), status: item.status, supplyMethod: item.supplyMethod, deductFromFreight: item.deductFromFreight, meterReading: item.meterReading === null ? null : toNumber(item.meterReading), receiptNo: item.receiptNo ?? null, stationOrSupplierName: item.stationOrSupplierName ?? null, remarks: item.remarks ?? null })),
    recentTrips: validTrips.slice(0, 20).map(item => ({ tripNo: item.tripNo, startAt: item.startAt, endAt: item.endAt ?? null, status: item.status, invoiceMode: item.invoiceMode, routeLabel: `${item.loadSiteId ? siteNameById.get(item.loadSiteId) ?? "装土点未记录" : "装土点未记录"} → ${item.unloadSiteId ? siteNameById.get(item.unloadSiteId) ?? "卸土点未记录" : "卸土点未记录"}`, actualDistanceKm: item.actualDistanceKm === null ? null : toNumber(item.actualDistanceKm), volumeCubicMeters: item.volumeCubicMeters === null ? null : toNumber(item.volumeCubicMeters), grossFreightAmount: toNumber(item.calculatedAmount), fuelDeductionAmount: toNumber(item.fuelDeductionAmount), netSettlementAmount: item.netSettlementAmount === null ? null : toNumber(item.netSettlementAmount) })),
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
