import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  evidenceRecords,
  freightRateRules,
  machineCostRecords,
  machineLeaseRules,
  machines,
  projects,
  rfidCardWriteJobs,
  rfidWriterDevices,
  transportCardEvents,
  transportTrips,
  transportVehicleRfidCards,
  transportVehicles,
  users,
} from "../../drizzle/schema";
import {
  assertMachineCostStatusTransition,
  assertTransportTripStatusTransition,
  calculateMachineSettlement,
  calculateTheoreticalVolume,
  calculateTieredFreightAmount,
  ConstructionDomainError,
} from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { decryptSecret, encryptSecret, maskSecret } from "../services/secretVault";

/** 月度结算期间固定使用 YYYY-MM，防止客户端时区影响日历月统计。 */
const settlementPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "结算期间格式应为 YYYY-MM");
const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");
const isoDateTimeSchema = z.string().datetime({ offset: true, message: "时间必须使用 ISO 8601 格式" });

/** 机械台账写入输入。项目不可为空，避免无归属设备绕开数据范围控制。 */
const machineInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  operatorUserId: z.number().int().positive().nullable().optional(),
  code: z.string().trim().min(2, "请填写机械编号").max(64),
  name: z.string().trim().min(2, "请填写机械名称").max(128),
  model: z.string().trim().max(128).nullable().optional(),
  ownership: z.enum(["owned", "leased"]),
  supplierName: z.string().trim().max(200).nullable().optional(),
  plateOrAssetNo: z.string().trim().max(64).nullable().optional(),
  status: z.enum(["idle", "working", "repairing", "offsite", "retired"]),
});

/** 机械合同计价规则由后台录入，所有金额最终仅在服务端参与核算。 */
const machineLeaseRuleInput = z.object({
  id: z.number().int().positive().optional(),
  machineId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
  rate: z.number().min(0).max(999999999999.99),
  overtimeHourlyRate: z.number().min(0).max(999999999999.99).default(0),
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable().optional(),
  status: z.enum(["active", "disabled"]),
}).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "计价规则截止日期不得早于生效日期",
  path: ["effectiveTo"],
});

/** 机械成本金额通过数量乘单价服务端计算，客户端不允许直接写入应结金额。 */
const machineCostInput = z.object({
  machineId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  costType: z.enum(["fuel", "repair", "overtime", "mobilization", "other"]),
  quantity: z.number().min(0).max(999999999.999),
  unitPrice: z.number().min(0).max(999999999999.99),
  occurredAt: isoDateTimeSchema,
  evidenceId: z.number().int().positive().nullable().optional(),
});

/** 运输车辆档案以货厢尺寸和装载系数为权威输入，理论方量由服务端计算。 */
const vehicleInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  plateNo: z.string().trim().min(4, "请填写车牌号").max(32).transform(value => value.toUpperCase()),
  ownerName: z.string().trim().max(128).nullable().optional(),
  driverUserId: z.number().int().positive().nullable().optional(),
  boxLengthMeters: z.number().gt(0).max(100),
  boxWidthMeters: z.number().gt(0).max(20),
  boxHeightMeters: z.number().gt(0).max(20),
  loadFactor: z.number().gt(0).max(1.5).default(1),
  payloadTons: z.number().gt(0).max(9999).nullable().optional(),
  status: z.enum(["active", "suspended", "disabled"]),
});

/** 阶梯运价规则。每 500 米的步长可按合同调整，基础价格按结算单位而非趟次硬编码。 */
const freightRuleInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  materialName: z.string().trim().max(128).nullable().optional(),
  settlementUnit: z.enum(["cubic_meter", "ton", "trip"]),
  startDistanceKm: z.number().min(0).max(9999),
  basePricePerUnit: z.number().min(0).max(999999999999.99),
  stepMeters: z.number().int().min(1).max(100000).default(500),
  stepIncreasePerUnit: z.number().min(0).max(999999999999.99).default(0),
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable().optional(),
  status: z.enum(["draft", "active", "disabled"]),
}).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "运价规则截止日期不得早于生效日期",
  path: ["effectiveTo"],
});

/** 趟次录入只接收原始里程与载货参数，单价和金额必须由规则快照在服务端计算。 */
const tripInput = z.object({
  tripNo: z.string().trim().min(4, "请填写趟次编号").max(64).optional(),
  vehicleId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  freightRuleId: z.number().int().positive(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema.nullable().optional(),
  actualDistanceKm: z.number().min(0).max(9999),
  volumeCubicMeters: z.number().gt(0).max(999999).nullable().optional(),
  weightTons: z.number().gt(0).max(999999).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  startLatitude: z.number().min(-90).max(90).nullable().optional(),
  startLongitude: z.number().min(-180).max(180).nullable().optional(),
  endLatitude: z.number().min(-90).max(90).nullable().optional(),
  endLongitude: z.number().min(-180).max(180).nullable().optional(),
}).refine(value => !value.endAt || new Date(value.endAt).getTime() >= new Date(value.startAt).getTime(), {
  message: "结束时间不得早于开始时间",
  path: ["endAt"],
});

/** 读卡设备只上传不可逆卡片指纹；服务端以幂等键和载荷摘要识别重传或冲突重放。 */
const transportCardEventInput = z.object({
  tripId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  deviceId: z.string().trim().min(1).max(128).optional(),
  cardFingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/, "卡片标识必须是 SHA-256 指纹").optional(),
  occurredAt: isoDateTimeSchema,
});

/** 写卡器型号先以台账方式预留，未接入硬件协议时仅允许生成并人工确认受控写卡任务。 */
const rfidWriterDeviceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  deviceCode: z.string().trim().min(2, "请填写写卡器编号").max(64).transform(value => value.toUpperCase()),
  displayName: z.string().trim().min(2, "请填写写卡器名称").max(128),
  model: z.string().trim().max(128).nullable().optional(),
  connectionMode: z.enum(["manual_placeholder", "usb", "serial", "network"]).default("manual_placeholder"),
  status: z.enum(["active", "disabled", "maintenance"]).default("active"),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 原始卡 UID 与司机电话仅在本次绑定请求中出现；持久化后分别只保留指纹/密文与掩码。 */
const rfidCardBindingInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  cardUid: z.string().trim().min(4, "请读取有效射频卡 UID").max(128),
  driverPhone: z.string().trim().regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机联系电话"),
  status: z.enum(["active", "suspended", "revoked"]).default("active"),
});

const rfidWritePrepareInput = z.object({
  cardId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  action: z.enum(["issue", "rewrite", "revoke"]).default("issue"),
});

const rfidWriteConfirmInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  success: z.boolean(),
  failureReason: z.string().trim().max(500).nullable().optional(),
});

/** 统一将前端日期解释为 UTC 业务日零点，避免月结边界受浏览器时区影响。 */
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 返回左闭右开的月度区间，确保月结查询不重复计入跨月数据。 */
function getMonthRange(period: string) {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: toBusinessDate(`${period}-01`),
    endExclusive: toBusinessDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`),
  };
}

/** 金额一律保留两位小数，避免浮点误差进入结算与审计记录。 */
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 自动生成带日期与随机后缀的趟次编号，避免并发录入仅依赖毫秒时间戳发生冲突。 */
function createTransportTripNo(projectId: number) {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TR-${projectId}-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * 运输异常仅由服务端按已固化的趟次快照计算，前端只负责展示；
 * 这避免司机通过修改浏览器状态规避核验提示。
 */
type TransportAnomaly = {
  code: "MISSING_EVIDENCE" | "MISSING_GPS" | "MISSING_END_TIME" | "ABNORMAL_DISTANCE" | "ABNORMAL_VOLUME" | "ABNORMAL_DURATION" | "CARD_EVENT_EXCEPTION";
  severity: "warning" | "notice";
  label: string;
};

function getRouteSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function calculateTransportAnomalies(trip: {
  evidenceId: number | null;
  startAt: Date;
  endAt: Date | null;
  actualDistanceKm: string | null;
  volumeCubicMeters: string | null;
  routeSnapshot: unknown;
  exceptionStatus?: "none" | "open" | "resolved";
}): TransportAnomaly[] {
  const snapshot = getRouteSnapshot(trip.routeSnapshot);
  const hasStartGps = typeof snapshot.startLatitude === "number" && typeof snapshot.startLongitude === "number";
  const hasEndGps = typeof snapshot.endLatitude === "number" && typeof snapshot.endLongitude === "number";
  const anomalies: TransportAnomaly[] = [];
  if (!trip.evidenceId) anomalies.push({ code: "MISSING_EVIDENCE", severity: "notice", label: "未关联现场影像" });
  if (!hasStartGps || !hasEndGps) anomalies.push({ code: "MISSING_GPS", severity: "notice", label: "GPS 定位信息不完整" });
  if (!trip.endAt) anomalies.push({ code: "MISSING_END_TIME", severity: "notice", label: "未填写收工时间" });
  if (Number(trip.actualDistanceKm ?? 0) <= 0.1) anomalies.push({ code: "ABNORMAL_DISTANCE", severity: "warning", label: "申报里程过低，请核对" });
  const theoreticalVolume = Number(snapshot.theoreticalVolumeCubicMeters ?? 0);
  if (theoreticalVolume > 0 && Number(trip.volumeCubicMeters ?? 0) > theoreticalVolume * 1.1) {
    anomalies.push({ code: "ABNORMAL_VOLUME", severity: "warning", label: "申报方量高于理论方量 10%" });
  }
  if (trip.endAt && trip.endAt.getTime() - trip.startAt.getTime() < 2 * 60 * 1000) {
    anomalies.push({ code: "ABNORMAL_DURATION", severity: "warning", label: "运输时长不足 2 分钟，请核验" });
  }
  if (trip.exceptionStatus === "open") anomalies.push({ code: "CARD_EVENT_EXCEPTION", severity: "warning", label: "刷卡事件存在待复核异常" });
  return anomalies;
}

/** 将领域异常转换为移动端可显示的标准业务错误，避免原始堆栈泄露。 */
function throwDomainAsBadRequest(error: unknown): never {
  if (error instanceof ConstructionDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/**
 * 状态迁移必须同时校验读取时的旧状态，避免两名用户基于同一旧状态提交不同流转而发生后写覆盖。
 * MySQL 驱动返回 0 个受影响行时，说明记录已经被其他请求更新；此时不得继续记录审计或投递通知。
 */
function assertConditionalStatusWrite(result: unknown, recordName: string) {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: `${recordName}状态已被其他用户更新，请刷新后重试` });
  }
}

function didConditionalWriteApply(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return !(header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0);
}

function createCardEventPayloadFingerprint(input: { tripId: number; projectId: number; idempotencyKey: string; deviceId?: string; cardFingerprint?: string; occurredAt: string }, eventType: "load" | "unload") {
  return createHash("sha256").update(JSON.stringify({ eventType, tripId: input.tripId, projectId: input.projectId, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId ?? null, cardFingerprint: input.cardFingerprint ?? null, occurredAt: new Date(input.occurredAt).toISOString() })).digest("hex");
}

/** 卡 UID 只用于本次绑定并立即派生不可逆指纹，避免原始设备标识进入数据库或审计记录。 */
function fingerprintRfidCardUid(cardUid: string) {
  return createHash("sha256").update(`road-rfid-card:v1:${cardUid.trim().toUpperCase()}`).digest("hex");
}

function maskRfidCardUid(cardUid: string) {
  const normalized = cardUid.trim().toUpperCase();
  return normalized.length <= 4 ? "****" : `${"*".repeat(Math.min(12, normalized.length - 4))}${normalized.slice(-4)}`;
}

function createRfidWriteJobNo(projectId: number) {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `CARD-${projectId}-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 写卡模型与运费模型均只能由运输负责人、项目负责人、财务或系统管理员维护。 */
function assertCanManageTransportResources(roleCodes: readonly string[]) {
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => ["TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权维护射频写卡设备或车辆卡绑定" });
  }
}

async function recordTransportCardEvent(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof transportCardEventInput>, eventType: "load" | "unload") {
  const user = requireAuthenticatedUser(ctx);
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [trip] = await db.select().from(transportTrips).where(eq(transportTrips.id, input.tripId)).limit(1);
  if (!trip || trip.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "运输趟次不存在或不属于当前项目" });
  const { vehicle } = await getScopedVehicle(ctx, trip.vehicleId, input.projectId, roleCodes);
  const occurredAt = new Date(input.occurredAt);
  const payloadFingerprint = createCardEventPayloadFingerprint(input, eventType);
  const [existing] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) {
    if (existing.tripId !== input.tripId || existing.eventType !== eventType || existing.payloadFingerprint !== payloadFingerprint) {
      throw new TRPCError({ code: "CONFLICT", message: "该刷卡幂等键已用于其他事件，已拒绝重复写入" });
    }
    return { success: existing.validationStatus === "accepted" || existing.validationStatus === "duplicate", duplicate: true, needsReview: existing.validationStatus === "needs_review", eventId: existing.id, validationStatus: existing.validationStatus, reason: existing.validationReason ?? undefined, driverNotificationQueued: Boolean(vehicle.driverUserId) };
  }
  try {
    await db.insert(transportCardEvents).values({
      tripId: input.tripId,
      vehicleId: trip.vehicleId,
      projectId: input.projectId,
      eventType,
      source: "card_reader",
      idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId ?? null,
      cardFingerprint: input.cardFingerprint ?? null,
      payloadFingerprint,
      occurredAt,
      validationStatus: "accepted",
    });
  } catch {
    const [concurrent] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
    if (concurrent && concurrent.tripId === input.tripId && concurrent.eventType === eventType && concurrent.payloadFingerprint === payloadFingerprint) {
      return { success: concurrent.validationStatus === "accepted" || concurrent.validationStatus === "duplicate", duplicate: true, needsReview: concurrent.validationStatus === "needs_review", eventId: concurrent.id, validationStatus: concurrent.validationStatus, reason: concurrent.validationReason ?? undefined, driverNotificationQueued: Boolean(vehicle.driverUserId) };
    }
    throw new TRPCError({ code: "CONFLICT", message: "刷卡事件写入冲突，请使用新的读卡事件重试" });
  }
  const [event] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
  if (!event) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "刷卡事件审计记录创建失败" });

  const markNeedsReview = async (reason: string) => {
    await db.update(transportCardEvents).set({ validationStatus: "needs_review", validationReason: reason }).where(eq(transportCardEvents.id, event.id));
    await db.update(transportTrips).set({ exceptionStatus: "open" }).where(eq(transportTrips.id, trip.id));
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "record_card_event_needs_review", targetType: "transport_card_event", targetId: String(event.id), summary: `运输${eventType === "load" ? "装土" : "卸土"}刷卡事件进入人工复核：${reason}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: "transport_card_event_exception", targetType: "transport_card_event", targetId: String(event.id), title: "运输刷卡异常待复核", content: `一笔运输${eventType === "load" ? "装土" : "卸土"}刷卡事件需要人工复核。`, deepLink: "/mobile/transport" }).catch(() => undefined);
    return { success: false, duplicate: false, needsReview: true, eventId: event.id, validationStatus: "needs_review" as const, reason, driverNotificationQueued: false };
  };

  if (input.cardFingerprint) {
    const [boundCard] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards).where(and(eq(transportVehicleRfidCards.vehicleId, trip.vehicleId), eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.cardUidFingerprint, input.cardFingerprint), eq(transportVehicleRfidCards.status, "active"))).limit(1);
    if (!boundCard) return markNeedsReview("读取的射频卡未与当前车辆完成有效绑定，或该卡已被停用/挂失");
  }

  if (trip.status === "void" || trip.status === "settled") return markNeedsReview("趟次已关闭，不能再确认刷卡事件");
  if (eventType === "load" && trip.unloadConfirmedAt) return markNeedsReview("检测到卸土已确认后的装土刷卡，疑似乱序事件");
  if (eventType === "load" && trip.loadConfirmedAt) return markNeedsReview("该趟次已存在装土确认，疑似重复刷卡事件");
  if (eventType === "unload" && !trip.loadConfirmedAt) return markNeedsReview("卸土刷卡早于装土确认，疑似乱序事件");
  if (eventType === "unload" && trip.unloadConfirmedAt) return markNeedsReview("该趟次已存在卸土确认，疑似重复刷卡事件");

  const updateResult = eventType === "load"
    ? await db.update(transportTrips).set({ loadConfirmedAt: occurredAt, loadEventId: event.id }).where(and(eq(transportTrips.id, trip.id), isNull(transportTrips.loadConfirmedAt), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")))
    : await db.update(transportTrips).set({ unloadConfirmedAt: occurredAt, unloadEventId: event.id }).where(and(eq(transportTrips.id, trip.id), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")));
  if (!didConditionalWriteApply(updateResult)) return markNeedsReview("趟次已被其他刷卡事件更新，请人工核验事件顺序");

  await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: `record_${eventType}_card_event`, targetType: "transport_card_event", targetId: String(event.id), summary: `运输${eventType === "load" ? "装土" : "卸土"}刷卡确认成功` });
  const eventLabel = eventType === "load" ? "装土" : "卸土";
  const tripFinancialSummary = `车辆 ${vehicle.plateNo}，${eventLabel}刷卡已确认；里程 ${trip.actualDistanceKm ? `${Number(trip.actualDistanceKm).toFixed(3)} km` : "待补录"}，运费 ${trip.calculatedAmount ? `¥${Number(trip.calculatedAmount).toFixed(2)}` : "待核算"}。`;
  void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: `transport_${eventType}_card_confirmed`, targetType: "transport_card_event", targetId: String(event.id), title: `运输${eventLabel}刷卡已确认`, content: `${tripFinancialSummary} ${eventType === "load" ? "请按调度前往卸土点。" : "运输闭环已记录，等待后续核验。"}`, deepLink: "/mobile/transport" }).catch(() => undefined);
  if (vehicle.driverUserId) {
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, recipientUserIds: [vehicle.driverUserId], projectId: input.projectId, module: "transport", eventCode: `transport_${eventType}_driver_notice`, targetType: "transport_card_event", targetId: String(event.id), title: `${eventLabel}刷卡成功`, content: `${tripFinancialSummary} ${eventType === "load" ? "请按流程前往卸土点。" : "本次运输已完成卸土刷卡，闭环记录已生成。"}`, deepLink: "/mobile/transport" }).catch(() => undefined);
  }
  return { success: true, duplicate: false, needsReview: false, eventId: event.id, validationStatus: "accepted" as const, driverNotificationQueued: Boolean(vehicle.driverUserId) };
}

/** 返回用户有权访问的项目选项，项目/组织范围均以服务端授权记录为准。 */
async function listScopedProjects(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  const scope = await getCurrentDataScope(ctx);
  const db = await getDb();
  if (!db) return [];
  const allProjects = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status, organizationId: projects.organizationId })
    .from(projects)
    .orderBy(projects.sortOrder, projects.id);
  if (scope.hasAllProjects) return allProjects;
  return allProjects.filter(project => scope.projectIds.includes(project.id) || (project.organizationId !== null && scope.organizationIds.includes(project.organizationId)));
}

/** 机械模块允许的岗位；管理员角色对应 ALL，可覆盖初始化和应急处置。 */
async function assertMachineryAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "MACHINERY");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["MACHINERY_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获机械管理数据访问授权" });
  }
  return roleCodes;
}

/** 运输模块允许的岗位；司机角色只可操作分配给本人的车辆及趟次。 */
async function assertTransportAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "TRANSPORT");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["TRANSPORT_MANAGER", "DRIVER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获运输管理数据访问授权" });
  }
  return roleCodes;
}

/** 结算状态变更仅由机械/运输负责人、项目负责人、财务或系统管理员处理。 */
function canManageSettlement(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["MACHINERY_MANAGER", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
}

/** 财务结算确认只能由财务负责人、会计或系统管理员完成。 */
function canSettleFinancialRecord(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER") || roleCodes.includes("ACCOUNTANT");
}

/** 按项目读取机械并校验数据范围；防止客户端以机械 ID 越权修改别的项目台账。 */
async function getScopedMachine(ctx: Parameters<typeof requireAuthenticatedUser>[0], machineId: number, projectId: number) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [machine] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!machine || machine.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的机械台账" });
  }
  return { db, machine };
}

/** 读取并校验车辆归属项目，司机还需满足本人被绑定到该车辆的最小权限要求。 */
async function getScopedVehicle(ctx: Parameters<typeof requireAuthenticatedUser>[0], vehicleId: number, projectId: number, roleCodes: readonly string[]) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [vehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, vehicleId)).limit(1);
  if (!vehicle || vehicle.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的运输车辆" });
  }
  const user = requireAuthenticatedUser(ctx);
  const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
  if (isDriverOnly && vehicle.driverUserId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "司机仅可操作分配给本人的运输车辆" });
  }
  return { db, vehicle };
}

/** 机械台账、租赁计价、成本记录和月度结算预览。 */
export const machineryRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertMachineryAccess(ctx);
    return listScopedProjects(ctx);
  }),

  listMachines: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(machines).where(eq(machines.projectId, input.projectId)).orderBy(desc(machines.updatedAt));
  }),

  /** 新建或维护机械台账；跨项目编辑时需同时校验原项目和目标项目授权。 */
  saveMachine: protectedProcedure.input(machineInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = {
      projectId: input.projectId,
      operatorUserId: input.operatorUserId ?? null,
      code: input.code,
      name: input.name,
      model: input.model ?? null,
      ownership: input.ownership,
      supplierName: input.supplierName ?? null,
      plateOrAssetNo: input.plateOrAssetNo ?? null,
      status: input.status,
    };
    if (input.id) {
      const [existing] = await db.select().from(machines).where(eq(machines.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "机械台账不存在" });
      if (existing.projectId) await assertProjectInCurrentScope(ctx, existing.projectId);
      await db.update(machines).set(values).where(eq(machines.id, input.id));
    } else {
      await db.insert(machines).values(values);
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: input.id ? "update_machine" : "create_machine", targetType: "machine", targetId: String(input.id ?? input.code), summary: `${input.id ? "维护" : "新建"}机械台账：${input.name}` });
    return { success: true };
  }),

  listLeaseRules: protectedProcedure.input(z.object({ machineId: z.number().int().positive(), projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    const { db } = await getScopedMachine(ctx, input.machineId, input.projectId);
    return db.select().from(machineLeaseRules).where(and(eq(machineLeaseRules.machineId, input.machineId), eq(machineLeaseRules.projectId, input.projectId))).orderBy(desc(machineLeaseRules.effectiveFrom));
  }),

  /** 保存外租机械的月租、日租、小时或台班合同规则，规则本身不包含实际成本。 */
  saveLeaseRule: protectedProcedure.input(machineLeaseRuleInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    const { db } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const values = {
      machineId: input.machineId,
      projectId: input.projectId,
      billingType: input.billingType,
      rate: String(roundMoney(input.rate)),
      overtimeHourlyRate: String(roundMoney(input.overtimeHourlyRate)),
      effectiveFrom: toBusinessDate(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? toBusinessDate(input.effectiveTo) : null,
      status: input.status,
    };
    if (input.id) {
      const [existing] = await db.select().from(machineLeaseRules).where(eq(machineLeaseRules.id, input.id)).limit(1);
      if (!existing || existing.machineId !== input.machineId || existing.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "机械计价规则不存在或不属于当前机械" });
      }
      await db.update(machineLeaseRules).set(values).where(eq(machineLeaseRules.id, input.id));
    } else {
      await db.insert(machineLeaseRules).values(values);
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: input.id ? "update_lease_rule" : "create_lease_rule", targetType: "machine_lease_rule", targetId: String(input.id ?? input.machineId), summary: `维护机械计价规则：${input.billingType}` });
    return { success: true };
  }),

  listCosts: protectedProcedure.input(z.object({ machineId: z.number().int().positive(), projectId: z.number().int().positive(), period: settlementPeriodSchema.optional() })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    const { db } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const range = input.period ? getMonthRange(input.period) : null;
    const predicates = [eq(machineCostRecords.machineId, input.machineId), eq(machineCostRecords.projectId, input.projectId)];
    if (range) predicates.push(gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive));
    return db.select().from(machineCostRecords).where(and(...predicates)).orderBy(desc(machineCostRecords.occurredAt));
  }),

  /** 录入油料、维修、加班、进退场等成本；金额始终由服务端计算。 */
  saveCost: protectedProcedure.input(machineCostInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    const { db } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const amount = roundMoney(input.quantity * input.unitPrice);
    await db.insert(machineCostRecords).values({
      machineId: input.machineId,
      projectId: input.projectId,
      costType: input.costType,
      quantity: String(input.quantity),
      unitPrice: String(roundMoney(input.unitPrice)),
      amount: String(amount),
      occurredAt: new Date(input.occurredAt),
      evidenceId: input.evidenceId ?? null,
      status: "draft",
    });
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: "create_cost", targetType: "machine_cost", targetId: `${input.machineId}:${input.occurredAt}`, summary: `录入机械${input.costType}成本，金额由系统核算` });
    return { success: true, amount };
  }),

  /** 审批、结算或作废机械成本；已结算记录不可回退，结算操作限定财务岗位。 */
  transitionCost: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), nextStatus: z.enum(["approved", "settled", "void"]) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (!canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权处理机械成本状态" });
    if (input.nextStatus === "settled" && !canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅财务负责人或会计可确认机械成本结算" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(machineCostRecords).where(eq(machineCostRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械成本记录不存在" });
    try { assertMachineCostStatusTransition(record.status, input.nextStatus); } catch (error) { throwDomainAsBadRequest(error); }
    const updateResult = await db.update(machineCostRecords)
      .set({ status: input.nextStatus })
      .where(and(eq(machineCostRecords.id, input.id), eq(machineCostRecords.status, record.status)));
    assertConditionalStatusWrite(updateResult, "机械成本记录");
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: "transition_cost", targetType: "machine_cost", targetId: String(input.id), summary: `机械成本状态变更为：${input.nextStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "machinery", eventCode: `machine_cost_${input.nextStatus}`, targetType: "machine_cost", targetId: String(input.id), title: `机械成本已${input.nextStatus}`, deepLink: "/mobile/machinery" }).catch(() => undefined);
    return { success: true };
  }),

  /**
   * 生成月度机械结算预览。租赁用量由管理人员输入，油料、加班、维修和进退场费均来自不可篡改的成本记录。
   * 本接口仅预览，不自动改变任何成本记录状态；最终结算必须逐笔经过状态流转。
   */
  settlementPreview: protectedProcedure.input(z.object({ machineId: z.number().int().positive(), projectId: z.number().int().positive(), period: settlementPeriodSchema, leaseUsageUnits: z.number().min(0).max(100000).default(1), deductionAmount: z.number().min(0).max(999999999999.99).default(0) })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    const { db, machine } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const range = getMonthRange(input.period);
    const rules = await db.select().from(machineLeaseRules).where(and(eq(machineLeaseRules.machineId, input.machineId), eq(machineLeaseRules.projectId, input.projectId), eq(machineLeaseRules.status, "active"))).orderBy(desc(machineLeaseRules.effectiveFrom));
    const selectedRule = rules.find(rule => new Date(rule.effectiveFrom).getTime() < range.endExclusive.getTime() && (!rule.effectiveTo || new Date(rule.effectiveTo).getTime() >= range.start.getTime()));
    if (!selectedRule) throw new TRPCError({ code: "BAD_REQUEST", message: "当前结算期间未找到生效的机械计价规则" });
    const costs = await db.select().from(machineCostRecords).where(and(eq(machineCostRecords.machineId, input.machineId), eq(machineCostRecords.projectId, input.projectId), ne(machineCostRecords.status, "void"), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive)));
    const sumByType = (type: typeof machineCostRecords.$inferSelect["costType"]) => costs.filter(item => item.costType === type).reduce((sum, item) => sum + Number(item.amount), 0);
    const fuelRows = costs.filter(item => item.costType === "fuel");
    const overtimeRows = costs.filter(item => item.costType === "overtime");
    const fuelQuantity = fuelRows.reduce((sum, item) => sum + Number(item.quantity), 0);
    const fuelAmount = sumByType("fuel");
    const overtimeHours = overtimeRows.reduce((sum, item) => sum + Number(item.quantity), 0);
    const overtimeAmount = sumByType("overtime");
    const leaseAmount = selectedRule.billingType === "monthly" ? Number(selectedRule.rate) : roundMoney(Number(selectedRule.rate) * input.leaseUsageUnits);
    let settlement;
    try {
      settlement = calculateMachineSettlement({
        leaseAmount,
        dieselLiters: fuelQuantity,
        dieselUnitPrice: fuelQuantity > 0 ? fuelAmount / fuelQuantity : 0,
        overtimeHours,
        overtimeHourlyRate: overtimeHours > 0 ? overtimeAmount / overtimeHours : Number(selectedRule.overtimeHourlyRate),
        repairAmount: sumByType("repair"),
        mobilizationAmount: sumByType("mobilization"),
        deductionAmount: input.deductionAmount,
        otherAmount: sumByType("other"),
      });
    } catch (error) { throwDomainAsBadRequest(error); }
    return {
      machine: { id: machine.id, code: machine.code, name: machine.name, ownership: machine.ownership },
      period: input.period,
      rule: { id: selectedRule.id, billingType: selectedRule.billingType, rate: Number(selectedRule.rate), overtimeHourlyRate: Number(selectedRule.overtimeHourlyRate) },
      leaseUsageUnits: input.leaseUsageUnits,
      costRecordCount: costs.length,
      costBreakdown: { fuelAmount: roundMoney(fuelAmount), overtimeAmount: roundMoney(overtimeAmount), repairAmount: roundMoney(sumByType("repair")), mobilizationAmount: roundMoney(sumByType("mobilization")), otherAmount: roundMoney(sumByType("other")), deductionAmount: roundMoney(input.deductionAmount) },
      settlement,
    };
  }),
});

/** 运输车辆、运价规则、趟次记录与日报结算。 */
export const transportRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertTransportAccess(ctx);
    return listScopedProjects(ctx);
  }),

  listVehicles: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const user = requireAuthenticatedUser(ctx);
    const rows = await db.select().from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)).orderBy(desc(transportVehicles.updatedAt));
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    const scopedRows = isDriverOnly ? rows.filter(vehicle => vehicle.driverUserId === user.id) : rows;
    return scopedRows.map(vehicle => ({ ...vehicle, theoreticalVolumeCubicMeters: calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)) }));
  }),

  /** 新建或维护运输车辆档案；司机角色不得修改车辆主数据。 */
  saveVehicle: protectedProcedure.input(vehicleInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    if (roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "司机无权维护运输车辆档案" });
    }
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { projectId: input.projectId, plateNo: input.plateNo, ownerName: input.ownerName ?? null, driverUserId: input.driverUserId ?? null, boxLengthMeters: String(input.boxLengthMeters), boxWidthMeters: String(input.boxWidthMeters), boxHeightMeters: String(input.boxHeightMeters), loadFactor: String(input.loadFactor), payloadTons: input.payloadTons === null || input.payloadTons === undefined ? null : String(input.payloadTons), status: input.status };
    if (input.id) {
      const [existing] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "运输车辆不存在" });
      await assertProjectInCurrentScope(ctx, existing.projectId);
      await db.update(transportVehicles).set(values).where(eq(transportVehicles.id, input.id));
    } else {
      await db.insert(transportVehicles).values(values);
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_vehicle" : "create_vehicle", targetType: "transport_vehicle", targetId: String(input.id ?? input.plateNo), summary: `${input.id ? "维护" : "新建"}运输车辆：${input.plateNo}` });
    return { success: true, theoreticalVolumeCubicMeters: calculateTheoreticalVolume(input.boxLengthMeters, input.boxWidthMeters, input.boxHeightMeters, input.loadFactor) };
  }),

  /** 写卡器台账仅为受控硬件适配预留；现场人员不可绕过后台直接登记或修改设备。 */
  listRfidWriterDevices: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) return [];
    return db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.projectId, input.projectId)).orderBy(desc(rfidWriterDevices.updatedAt));
  }),

  saveRfidWriterDevice: protectedProcedure.input(rfidWriterDeviceInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { projectId: input.projectId, deviceCode: input.deviceCode, displayName: input.displayName, model: input.model ?? null, connectionMode: input.connectionMode, status: input.status, remarks: input.remarks ?? null };
    if (input.id) {
      const [existing] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "写卡器不存在或不属于当前项目" });
      await db.update(rfidWriterDevices).set(values).where(eq(rfidWriterDevices.id, input.id));
    } else {
      await db.insert(rfidWriterDevices).values({ ...values, createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_rfid_writer_device" : "create_rfid_writer_device", targetType: "rfid_writer_device", targetId: String(input.id ?? input.deviceCode), summary: `${input.id ? "维护" : "登记"}射频写卡器：${input.displayName}（${input.deviceCode}）` });
    return { success: true };
  }),

  /** 卡列表永不返回原始 UID 或司机电话；仅管理员可查看掩码与写卡状态，司机仅可看到本人车辆是否已绑定。 */
  listVehicleRfidCards: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const user = requireAuthenticatedUser(ctx);
    const rows = await db.select({
      id: transportVehicleRfidCards.id,
      projectId: transportVehicleRfidCards.projectId,
      vehicleId: transportVehicleRfidCards.vehicleId,
      writerDeviceId: transportVehicleRfidCards.writerDeviceId,
      cardUidMasked: transportVehicleRfidCards.cardUidMasked,
      driverPhoneMasked: transportVehicleRfidCards.driverPhoneMasked,
      payloadVersion: transportVehicleRfidCards.payloadVersion,
      status: transportVehicleRfidCards.status,
      issuedAt: transportVehicleRfidCards.issuedAt,
      lastWrittenAt: transportVehicleRfidCards.lastWrittenAt,
      revokedAt: transportVehicleRfidCards.revokedAt,
      createdAt: transportVehicleRfidCards.createdAt,
      updatedAt: transportVehicleRfidCards.updatedAt,
      plateNo: transportVehicles.plateNo,
      vehicleType: transportVehicles.vehicleType,
      driverUserId: transportVehicles.driverUserId,
      writerName: rfidWriterDevices.displayName,
      writerModel: rfidWriterDevices.model,
    }).from(transportVehicleRfidCards)
      .innerJoin(transportVehicles, eq(transportVehicleRfidCards.vehicleId, transportVehicles.id))
      .leftJoin(rfidWriterDevices, eq(transportVehicleRfidCards.writerDeviceId, rfidWriterDevices.id))
      .where(eq(transportVehicleRfidCards.projectId, input.projectId))
      .orderBy(desc(transportVehicleRfidCards.updatedAt));
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    return isDriverOnly ? rows.filter(row => row.driverUserId === user.id) : rows;
  }),

  /** 为车辆绑定射频卡时，原始 UID 与电话仅在当前请求中使用，随后以指纹/密文和掩码保存。 */
  saveVehicleRfidCard: protectedProcedure.input(rfidCardBindingInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    const { db, vehicle } = await getScopedVehicle(ctx, input.vehicleId, input.projectId, roleCodes);
    if (!vehicle.driverUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "请先在车辆台账绑定司机，再创建射频卡绑定" });
    if (input.writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目可用的写卡器" });
    }
    const cardUidFingerprint = fingerprintRfidCardUid(input.cardUid);
    const [existingByUid] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.cardUidFingerprint, cardUidFingerprint)).limit(1);
    if (existingByUid && existingByUid.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "该射频卡已绑定其他车辆，请先挂失或解除原绑定" });
    const values = {
      projectId: input.projectId,
      vehicleId: input.vehicleId,
      writerDeviceId: input.writerDeviceId ?? null,
      cardUidFingerprint,
      cardUidMasked: maskRfidCardUid(input.cardUid),
      driverPhoneEncrypted: encryptSecret(input.driverPhone),
      driverPhoneMasked: maskSecret(input.driverPhone),
      status: input.status,
      revokedAt: input.status === "revoked" ? new Date() : null,
    };
    if (input.id) {
      const [existing] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "车辆射频卡绑定不存在或不属于当前项目" });
      await db.update(transportVehicleRfidCards).set(values).where(eq(transportVehicleRfidCards.id, input.id));
    } else {
      await db.insert(transportVehicleRfidCards).values({ ...values, createdBy: user.id, issuedAt: new Date() });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_vehicle_rfid_card" : "bind_vehicle_rfid_card", targetType: "transport_vehicle_rfid_card", targetId: String(input.id ?? input.vehicleId), summary: `${input.id ? "维护" : "绑定"}车辆 ${vehicle.plateNo} 的射频卡（${maskRfidCardUid(input.cardUid)}）` });
    return { success: true };
  }),

  /** 管理员准备一次写卡任务。返回的载荷只在本次受控响应中提供，数据库仅保存其摘要以防止卡片内容被静态导出。 */
  prepareRfidCardWrite: protectedProcedure.input(rfidWritePrepareInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, input.cardId)).limit(1);
    if (!card || card.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "车辆射频卡绑定不存在或不属于当前项目" });
    if (input.action !== "revoke" && card.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "仅已启用的车辆射频卡可写入或补写" });
    const { vehicle } = await getScopedVehicle(ctx, card.vehicleId, input.projectId, roleCodes);
    if (!vehicle.driverUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆未绑定司机，不能生成写卡载荷" });
    const [driver] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, vehicle.driverUserId)).limit(1);
    if (!driver) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆绑定司机不存在，不能生成写卡载荷" });
    const writerDeviceId = input.writerDeviceId ?? card.writerDeviceId;
    if (writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "写卡器不存在、未启用或不属于当前项目" });
    }
    const driverPhone = card.driverPhoneEncrypted ? decryptSecret(card.driverPhoneEncrypted) : "";
    if (!driverPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆射频卡未保存司机电话，不能生成完整写卡载荷" });
    const payload = {
      schema: "road-construction-rfid/v1",
      cardId: card.id,
      projectId: input.projectId,
      vehicle: {
        id: vehicle.id,
        plateNo: vehicle.plateNo,
        vehicleType: vehicle.vehicleType,
        cargoBox: { lengthMeters: Number(vehicle.boxLengthMeters), widthMeters: Number(vehicle.boxWidthMeters), heightMeters: Number(vehicle.boxHeightMeters), loadFactor: Number(vehicle.loadFactor) },
      },
      driver: { userId: driver.id, name: driver.name || "未命名司机", phone: driverPhone },
      payloadVersion: card.payloadVersion,
      issuedAt: new Date().toISOString(),
      action: input.action,
    };
    const payloadFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const jobNo = createRfidWriteJobNo(input.projectId);
    await db.insert(rfidCardWriteJobs).values({ jobNo, projectId: input.projectId, vehicleId: vehicle.id, cardId: card.id, writerDeviceId: writerDeviceId ?? null, action: input.action, payloadFingerprint, payloadVersion: card.payloadVersion, preparedBy: user.id });
    const [job] = await db.select({ id: rfidCardWriteJobs.id }).from(rfidCardWriteJobs).where(eq(rfidCardWriteJobs.jobNo, jobNo)).limit(1);
    if (!job) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "写卡任务创建失败" });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "prepare_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: `准备${input.action === "rewrite" ? "补写" : input.action === "revoke" ? "挂失" : "写入"}车辆 ${vehicle.plateNo} 的射频卡任务` });
    return { success: true, jobId: job.id, jobNo, payload, payloadFingerprint, hardwareMode: "manual_confirmation" as const };
  }),

  /** 物理写卡器接入前由现场管理员确认结果；失败和确认均保留任务审计，不能通过前端静默修改卡状态。 */
  confirmRfidCardWrite: protectedProcedure.input(rfidWriteConfirmInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [job] = await db.select().from(rfidCardWriteJobs).where(eq(rfidCardWriteJobs.id, input.id)).limit(1);
    if (!job || job.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "写卡任务不存在或不属于当前项目" });
    if (job.status !== "prepared") throw new TRPCError({ code: "CONFLICT", message: "该写卡任务已处理，请勿重复确认" });
    const now = new Date();
    await db.update(rfidCardWriteJobs).set({ status: input.success ? "confirmed" : "failed", failureReason: input.success ? null : input.failureReason ?? "现场写卡未成功", confirmedBy: user.id, confirmedAt: now }).where(and(eq(rfidCardWriteJobs.id, job.id), eq(rfidCardWriteJobs.status, "prepared")));
    if (input.success) {
      await db.update(transportVehicleRfidCards).set({ lastWrittenAt: now, status: job.action === "revoke" ? "revoked" : "active", revokedAt: job.action === "revoke" ? now : null }).where(eq(transportVehicleRfidCards.id, job.cardId));
      if (job.writerDeviceId) await db.update(rfidWriterDevices).set({ lastConfirmedAt: now }).where(eq(rfidWriterDevices.id, job.writerDeviceId));
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.success ? "confirm_rfid_card_write" : "fail_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: input.success ? "确认射频写卡任务成功" : "记录射频写卡任务失败" });
    return { success: true, status: input.success ? "confirmed" as const : "failed" as const };
  }),

  listFreightRules: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(freightRateRules).where(eq(freightRateRules.projectId, input.projectId)).orderBy(desc(freightRateRules.effectiveFrom));
  }),

  /** 保存项目运输阶梯运价。司机无权维护合同价格，以防绕过审核调整运费。 */
  saveFreightRule: protectedProcedure.input(freightRuleInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    if (roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "司机无权维护运输运价规则" });
    }
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { projectId: input.projectId, materialName: input.materialName ?? null, settlementUnit: input.settlementUnit, startDistanceKm: String(input.startDistanceKm), basePricePerUnit: String(roundMoney(input.basePricePerUnit)), stepMeters: input.stepMeters, stepIncreasePerUnit: String(roundMoney(input.stepIncreasePerUnit)), effectiveFrom: toBusinessDate(input.effectiveFrom), effectiveTo: input.effectiveTo ? toBusinessDate(input.effectiveTo) : null, status: input.status };
    if (input.id) {
      const [existing] = await db.select().from(freightRateRules).where(eq(freightRateRules.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "运输运价规则不存在" });
      await db.update(freightRateRules).set(values).where(eq(freightRateRules.id, input.id));
    } else {
      await db.insert(freightRateRules).values(values);
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_freight_rule" : "create_freight_rule", targetType: "freight_rate_rule", targetId: String(input.id ?? input.projectId), summary: `维护运输阶梯运价规则：${input.settlementUnit}` });
    return { success: true };
  }),

  listTrips: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema.optional() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const predicates = [eq(transportTrips.projectId, input.projectId)];
    if (input.date) {
      const start = toBusinessDate(input.date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      predicates.push(gte(transportTrips.startAt, start), lt(transportTrips.startAt, end));
    }
    let rows = await db.select().from(transportTrips).where(and(...predicates)).orderBy(desc(transportTrips.startAt));
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) {
      const vehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), eq(transportVehicles.driverUserId, user.id)));
      const vehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
      rows = rows.filter(trip => vehicleIds.has(trip.vehicleId));
    }
    return rows.map(trip => ({ ...trip, anomalies: calculateTransportAnomalies(trip) }));
  }),

  /** 录入运输趟次并把当时运价和原始载货参数写入快照，后续修改价格规则不影响历史金额。 */
  saveTrip: protectedProcedure.input(tripInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    const { db, vehicle } = await getScopedVehicle(ctx, input.vehicleId, input.projectId, roleCodes);
    if (vehicle.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆未处于可调度状态" });
    if (input.evidenceId) {
      const [evidence] = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1);
      if (!evidence || evidence.projectId !== input.projectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "现场影像不存在或不属于当前项目，不能关联到运输趟次" });
      }
    }
    const [rule] = await db.select().from(freightRateRules).where(eq(freightRateRules.id, input.freightRuleId)).limit(1);
    if (!rule || rule.projectId !== input.projectId || rule.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "未找到当前项目下可用的生效运价规则" });
    const tripStart = new Date(input.startAt);
    const ruleStart = new Date(rule.effectiveFrom);
    const ruleEnd = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
    if (tripStart.getTime() < ruleStart.getTime() || (ruleEnd && tripStart.getTime() > new Date(ruleEnd.getTime() + 24 * 60 * 60 * 1000).getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "趟次发生日期不在当前运价规则有效期内" });
    }
    let theoreticalVolume: number;
    try { theoreticalVolume = calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)); } catch (error) { throwDomainAsBadRequest(error); }
    const volume = input.volumeCubicMeters ?? theoreticalVolume;
    if (volume > theoreticalVolume * 1.5) throw new TRPCError({ code: "BAD_REQUEST", message: "申报方量超过车辆理论方量上限，请核对货厢尺寸或装载系数" });
    const settlementQuantity = rule.settlementUnit === "cubic_meter" ? volume : rule.settlementUnit === "ton" ? input.weightTons : 1;
    if (!settlementQuantity || settlementQuantity <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: rule.settlementUnit === "ton" ? "按吨结算必须填写有效载重" : "请填写有效结算数量" });
    let price;
    try {
      price = calculateTieredFreightAmount({ actualDistanceKm: input.actualDistanceKm, startDistanceKm: Number(rule.startDistanceKm), basePricePerUnit: Number(rule.basePricePerUnit), stepMeters: rule.stepMeters, stepIncreasePerUnit: Number(rule.stepIncreasePerUnit), settlementQuantity });
    } catch (error) { throwDomainAsBadRequest(error); }
    const tripNo = input.tripNo ?? createTransportTripNo(input.projectId);
    const routeSnapshot = { source: "mobile", settlementUnit: rule.settlementUnit, theoreticalVolumeCubicMeters: theoreticalVolume, billableSteps: price.billableSteps, startLatitude: input.startLatitude ?? null, startLongitude: input.startLongitude ?? null, endLatitude: input.endLatitude ?? null, endLongitude: input.endLongitude ?? null };
    await db.insert(transportTrips).values({
      tripNo,
      vehicleId: input.vehicleId,
      projectId: input.projectId,
      freightRuleId: input.freightRuleId,
      startAt: tripStart,
      endAt: input.endAt ? new Date(input.endAt) : null,
      actualDistanceKm: String(input.actualDistanceKm),
      volumeCubicMeters: String(volume),
      weightTons: input.weightTons === null || input.weightTons === undefined ? null : String(input.weightTons),
      calculatedUnitPrice: String(price.unitPrice),
      calculatedAmount: String(price.totalAmount),
      routeSnapshot,
      evidenceId: input.evidenceId ?? null,
      status: "draft",
    });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "create_trip", targetType: "transport_trip", targetId: tripNo, summary: "录入运输趟次，运费由合同规则快照计算" });
    const anomalies = calculateTransportAnomalies({ evidenceId: input.evidenceId ?? null, startAt: tripStart, endAt: input.endAt ? new Date(input.endAt) : null, actualDistanceKm: String(input.actualDistanceKm), volumeCubicMeters: String(volume), routeSnapshot });
    return { success: true, tripNo, unitPrice: price.unitPrice, amount: price.totalAmount, theoreticalVolumeCubicMeters: theoreticalVolume, anomalies };
  }),

  /** 装土读卡成功后确认趟次起始环节；重复上报按幂等键安全返回，乱序事件留痕进入人工复核。 */
  recordLoadEvent: protectedProcedure.input(transportCardEventInput).mutation(async ({ ctx, input }) => recordTransportCardEvent(ctx, input, "load")),

  /** 卸土读卡成功后确认运输闭环，并向已绑定服务号的司机发送即时提醒。 */
  recordUnloadEvent: protectedProcedure.input(transportCardEventInput).mutation(async ({ ctx, input }) => recordTransportCardEvent(ctx, input, "unload")),

  /** 提交、核验、结算或作废运输趟次，确保历史运价快照与已结算金额不可回退。 */
  transitionTrip: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), nextStatus: z.enum(["submitted", "verified", "settled", "void"]) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [trip] = await db.select().from(transportTrips).where(eq(transportTrips.id, input.id)).limit(1);
    if (!trip || trip.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "运输趟次不存在" });
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly && input.nextStatus !== "submitted") throw new TRPCError({ code: "FORBIDDEN", message: "司机仅可提交本人录入的运输趟次" });
    if (isDriverOnly) await getScopedVehicle(ctx, trip.vehicleId, input.projectId, roleCodes);
    if (["verified", "void"].includes(input.nextStatus) && !canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权核验或作废运输趟次" });
    if (input.nextStatus === "settled" && !canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅财务负责人或会计可确认运输结算" });
    try { assertTransportTripStatusTransition(trip.status, input.nextStatus); } catch (error) { throwDomainAsBadRequest(error); }
    const updateResult = await db.update(transportTrips)
      .set({ status: input.nextStatus })
      .where(and(eq(transportTrips.id, input.id), eq(transportTrips.status, trip.status)));
    assertConditionalStatusWrite(updateResult, "运输趟次");
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "transition_trip", targetType: "transport_trip", targetId: String(input.id), summary: `运输趟次状态变更为：${input.nextStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: `transport_trip_${input.nextStatus}`, targetType: "transport_trip", targetId: String(input.id), title: `运输趟次已${input.nextStatus}`, deepLink: "/mobile/transport" }).catch(() => undefined);
    return { success: true };
  }),

  /** 按自然日汇总趟次、方量、吨位和可结算运费，供日报与打印视图统一使用。 */
  dailySummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { tripCount: 0, submittedCount: 0, verifiedCount: 0, settledCount: 0, volumeCubicMeters: 0, weightTons: 0, amount: 0, alertTripCount: 0, alertCount: 0 };
    const start = toBusinessDate(input.date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    let rows = await db.select().from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), gte(transportTrips.startAt, start), lt(transportTrips.startAt, end)));
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) {
      const vehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), eq(transportVehicles.driverUserId, user.id)));
      const ownVehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
      rows = rows.filter(trip => ownVehicleIds.has(trip.vehicleId));
    }
    const activeRows = rows.filter(trip => trip.status !== "void");
    const anomalyMatrix = activeRows.map(trip => calculateTransportAnomalies(trip));
    return {
      tripCount: activeRows.length,
      submittedCount: activeRows.filter(trip => trip.status === "submitted").length,
      verifiedCount: activeRows.filter(trip => trip.status === "verified").length,
      settledCount: activeRows.filter(trip => trip.status === "settled").length,
      volumeCubicMeters: Math.round(activeRows.reduce((sum, trip) => sum + Number(trip.volumeCubicMeters ?? 0), 0) * 1000) / 1000,
      weightTons: Math.round(activeRows.reduce((sum, trip) => sum + Number(trip.weightTons ?? 0), 0) * 1000) / 1000,
      amount: roundMoney(activeRows.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0)),
      alertTripCount: anomalyMatrix.filter(items => items.length > 0).length,
      alertCount: anomalyMatrix.reduce((sum, items) => sum + items.length, 0),
    };
  }),
});
