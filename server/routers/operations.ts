import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assetMaintenanceRecords,
  auditLogs,
  dieselGuidelinePrices,
  dieselRefuelRecords,
  evidenceRecords,
  freightRateRules,
  machineCostRecords,
  machineDailyOperations,
  machineLeaseRules,
  machineMonthlyStatements,
  machinePaymentSettlements,
  machines,
  notificationRecords,
  projects,
  rfidCardWriteJobs,
  rfidWriterDevices,
  systemSettings,
  transportCardEvents,
  transportReaderDevices,
  transportRoutePresets,
  transportSites,
  transportTrips,
  transportVehicleLeaseRules,
  transportVehicleRfidCards,
  transportVehicleSettlementItems,
  transportVehicleSettlements,
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
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, getSuperAdminAccess, hasUserSpecificOperationPermission, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { makeRequest, type GeocodingResult } from "../_core/map";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { sendOfficialAccountDriverNotification } from "../services/officialAccountDriverBinding";
import { decryptSecret, encryptSecret, maskSecret } from "../services/secretVault";
import { buildTransportNfcCardPayload, buildTransportNfcDeepLink, verifyTransportNfcDeepLinkToken } from "../services/rfidCardPayload";
import { createRfidBridgeToken, hashRfidBridgeToken, RFID_BRIDGE_TOKEN_TTL_MS } from "../services/rfidBridge";
import { recordSensitiveDataAccess } from "../services/auditIntegrity";
import { storageGetSignedUrl } from "../storage";
import {
  assertNoOpenTransportTrip,
  assertVehicleMinimumNfcInvoiceInterval,
  calculateCoordinateDistanceMeters,
  completeNfcTripBySingleScan,
  createActiveVehicleTransitKey,
  didConditionalWriteApply,
  getChinaBusinessDate,
  getRouteSnapshot,
  throwIfDuplicateActiveVehicleTransit,
  triggerTransportRiskScan,
} from "../services/transportNfcSupport";

/** 月度结算期间固定使用 YYYY-MM，防止客户端时区影响日历月统计。 */
const settlementPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "结算期间格式应为 YYYY-MM");
const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");
const isoDateTimeSchema = z.string().datetime({ offset: true, message: "时间必须使用 ISO 8601 格式" });
const transportSettlementPaymentMethodSchema = z.enum(["bank_transfer", "corporate_account", "cash", "wechat", "alipay", "other"]);
const transportSettlementStatusSchema = z.enum(["draft", "submitted", "approved", "paid", "void"]);
const TRANSPORT_NFC_SINGLE_SCAN_CLOSE_KEY_PREFIX = "TRANSPORT_NFC_SINGLE_SCAN_CLOSE_PROJECT";

function getTransportNfcSingleScanCloseSettingKey(projectId: number) {
  return `${TRANSPORT_NFC_SINGLE_SCAN_CLOSE_KEY_PREFIX}:${projectId}`;
}

async function getTransportNfcSingleScanCloseEnabled(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: number) {
  const [setting] = await db.select({ valueJson: systemSettings.valueJson, status: systemSettings.status }).from(systemSettings).where(eq(systemSettings.settingKey, getTransportNfcSingleScanCloseSettingKey(projectId))).limit(1);
  return setting?.status === "published" && setting.valueJson === "true";
}

async function saveTransportNfcSingleScanCloseEnabled(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: { projectId: number; enabled: boolean; userId: number }) {
  const settingKey = getTransportNfcSingleScanCloseSettingKey(input.projectId);
  const valueJson = input.enabled ? "true" : "false";
  const valuePreview = input.enabled ? "开启：刷卡发票即完成整车运输闭环" : "关闭：仍需卸土刷卡或卸土确认完成闭环";
  const displayName = "刷卡发票即完成整车运输闭环";
  const remarks = "特殊运输场景使用。开启后，NFC 刷卡发票创建运单时直接完成装土与卸土闭环，但同车重复开票最小间隔仍按路线安全阈值硬拦截。";
  const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, settingKey)).limit(1);
  if (existing) {
    await db.update(systemSettings).set({ category: "运输管理", displayName, valueJson, valuePreview, isSensitive: false, status: "published", version: existing.version + 1, publishedAt: new Date(), remarks, updatedBy: input.userId }).where(eq(systemSettings.id, existing.id));
  } else {
    await db.insert(systemSettings).values({ category: "运输管理", settingKey, displayName, valueJson, valuePreview, isSensitive: false, status: "published", version: 1, publishedAt: new Date(), remarks, updatedBy: input.userId });
  }
  await db.insert(auditLogs).values({ userId: input.userId, module: "transport", action: "set_nfc_single_scan_close", targetType: "system_setting", targetId: settingKey, summary: input.enabled ? "开启刷卡发票即完成整车运输闭环" : "关闭刷卡发票即完成整车运输闭环，恢复卸土闭环要求" });
}

/** 业务人员维护中文详细地址；服务端仅为围栏计算解析并保存内部坐标，不向页面返回。 */
async function resolveTransportSiteAddress(address: string) {
  try {
    const result = await makeRequest<GeocodingResult>("/maps/api/geocode/json", { address, language: "zh-CN", region: "cn" });
    const first = result.results?.[0];
    if (result.status !== "OK" || !first) throw new Error(result.status || "ZERO_RESULTS");
    return { address: first.formatted_address, latitude: first.geometry.location.lat, longitude: first.geometry.location.lng };
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "未能定位该中文详细地址，请补充省、市、区县、道路/桩号或地标后重试" });
  }
}

/** 外租资源保存时必须同时记录可结算的租金、计费方式与租期。 */
const assetLeaseTermsInput = z.object({
  billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
  rate: z.number().gt(0, "租金必须大于 0").max(999999999999.99),
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable().optional(),
}).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "租赁截止日期不得早于起租日期",
  path: ["effectiveTo"],
});

/** 机械台账写入输入。项目不可为空，避免无归属设备绕开数据范围控制。 */
const machineInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  operatorUserId: z.number().int().positive().nullable().optional(),
  driverName: z.string().trim().max(128).nullable().optional(),
  driverPhone: z.string().trim().regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效驾驶员联系电话").nullable().optional(),
  code: z.string().trim().min(2, "请填写机械编号").max(64),
  name: z.string().trim().min(2, "请填写机械名称").max(128),
  model: z.string().trim().max(128).nullable().optional(),
  ownership: z.enum(["owned", "leased"]),
  supplierName: z.string().trim().max(200).nullable().optional(),
  plateOrAssetNo: z.string().trim().max(64).nullable().optional(),
  fuelTankCapacityLiters: z.number().gt(0).max(99999).nullable().optional(),
  status: z.enum(["idle", "working", "repairing", "offsite", "retired"]),
  leaseTerms: assetLeaseTermsInput.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.ownership !== "leased") return;
  if (!value.supplierName?.trim()) ctx.addIssue({ code: "custom", path: ["supplierName"], message: "外租机械必须填写出租方" });
  if (!value.leaseTerms) ctx.addIssue({ code: "custom", path: ["leaseTerms"], message: "外租机械必须填写租金、计费方式和租赁起止时间" });
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
  remarks: z.string().trim().max(500).nullable().optional(),
});

/**
 * 会计机械月度明细只接收模板中的原始考勤、工资和签字数据；产值、油耗、维修、总额和分成均由服务端生成快照。
 * 机械与司机出勤按会计模板使用 30 天月；加班工资按固定工资或固定月租 ÷ 30 ÷ 10 小时计算。
 */
const machineMonthlyStatementInput = z.object({
  machineId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  period: settlementPeriodSchema,
  driverUserId: z.number().int().positive().nullable().optional(),
  machineWorkDays: z.number().min(0).max(31),
  machineOvertimeHours: z.number().min(0).max(744),
  driverMonthlyWage: z.number().min(0).max(999999999999.99),
  driverWorkDays: z.number().min(0).max(31),
  driverOvertimeHours: z.number().min(0).max(744),
  signatureName: z.string().trim().max(128).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});

const machineMonthlyStatementTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  nextStatus: z.enum(["submitted", "approved", "settled", "void"]),
});

/** 单台机械日作业只保存原始产值、司机工资与工时，费用仍引用独立原始台账。 */
const machineDailyOperationInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  machineId: z.number().int().positive(),
  occurredOn: businessDateSchema,
  operatorUserId: z.number().int().positive().nullable().optional(),
  workHours: z.number().min(0).max(24),
  overtimeHours: z.number().min(0).max(24),
  outputAmount: z.number().min(0).max(999999999999.99),
  driverWageAmount: z.number().min(0).max(999999999999.99),
  remarks: z.string().trim().max(500).nullable().optional(),
});

const machineDailyOperationTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  nextStatus: z.enum(["submitted", "approved", "settled", "void"]),
});

/** 运输车辆档案以货厢尺寸和装载系数为权威输入，理论方量由服务端计算。 */
const vehicleInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  plateNo: z.string().trim().min(4, "请填写车牌号").max(32).transform(value => value.toUpperCase()),
  ownership: z.enum(["owned", "leased", "trip_settlement"]).default("owned"),
  ownerName: z.string().trim().max(128).nullable().optional(),
  driverUserId: z.number().int().positive().nullable().optional(),
  driverName: z.string().trim().max(128).nullable().optional(),
  driverPhone: z.string().trim().regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机手机号").nullable().optional(),
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
  freightRuleId: z.number().int().positive().optional(),
  routePresetId: z.number().int().positive().optional(),
  invoiceMode: z.enum(["nfc_card", "plate_photo"]).default("nfc_card"),
  loadSiteId: z.number().int().positive().nullable().optional(),
  unloadSiteId: z.number().int().positive().nullable().optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema.nullable().optional(),
  actualDistanceKm: z.number().min(0).max(9999).optional(),
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
  siteId: z.number().int().positive().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  deviceId: z.string().trim().min(1).max(128).optional(),
  cardFingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/, "卡片标识必须是 SHA-256 指纹").optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

/** 无 NFC 车辆卡时，直拍车牌票据由卸土现场人员以当前位置完成受控闭环。 */
const platePhotoUnloadConfirmationInput = z.object({
  tripId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  unloadEvidenceId: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  occurredAt: isoDateTimeSchema,
});

/** 现场读卡设备只提交已派生的卡片指纹；服务端根据设备绑定地点决定本次是装土发车还是卸土闭环。 */
const transportNfcReaderScanInput = z.object({
  projectId: z.number().int().positive(),
  readerDeviceCode: z.string().trim().min(2).max(128).transform(value => value.toUpperCase()),
  idempotencyKey: z.string().trim().min(8).max(160),
  cardFingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/, "卡片标识必须是 SHA-256 指纹"),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

const transportNfcLinkScanInput = z.object({
  token: z.string().trim().min(12).max(1024),
  readerDeviceCode: z.string().trim().min(2).max(128).transform(value => value.toUpperCase()),
  idempotencyKey: z.string().trim().min(8).max(160),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});
const mobileNfcInvoicePreviewInput = z.object({ token: z.string().trim().min(12).max(1024) });
const mobileNfcInvoiceConfirmInput = mobileNfcInvoicePreviewInput.extend({
  routePresetId: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

/** 装土点、卸土点及现场刷卡管理员由运输负责人或项目负责人维护。 */
const transportSiteInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  siteType: z.enum(["load", "unload"]),
  name: z.string().trim().min(2, "请填写地点名称").max(128),
  address: z.string().trim().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  administratorUserId: z.number().int().positive().nullable().optional(),
  minimumTransitMinutes: z.number().int().min(1, "最短运输时间至少 1 分钟").max(1440, "最短运输时间不能超过 24 小时").default(10),
  minimumTransitEnabled: z.boolean().default(true),
  unloadGeofenceMeters: z.number().int().min(30, "卸土点定位容差至少 30 米").max(5000, "卸土点定位容差不能超过 5000 米").default(300),
  unloadGeofenceEnabled: z.boolean().default(true),
  status: z.enum(["active", "disabled"]).default("active"),
});

/** 装卸点读卡设备须登记到具体地点；设备编号由现场终端稳定保存，用于双设备刷卡事件审计。 */
const transportReaderDeviceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  siteId: z.number().int().positive(),
  deviceCode: z.string().trim().min(2, "请填写读卡设备编号").max(128).transform(value => value.toUpperCase()),
  displayName: z.string().trim().min(2, "请填写读卡设备名称").max(128),
  status: z.enum(["active", "disabled", "maintenance"]).default("active"),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 项目路线将装卸点、预设公里数与生效的每方阶梯运价绑定，发票端不得手工覆盖。 */
const transportRoutePresetInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  loadSiteId: z.number().int().positive(),
  unloadSiteId: z.number().int().positive(),
  freightRuleId: z.number().int().positive(),
  presetDistanceKm: z.number().gt(0).max(9999),
  minimumTransitMinutes: z.number().int().min(1, "最短运输时间至少 1 分钟").max(1440, "最短运输时间不能超过 24 小时").default(10),
  minimumTransitEnabled: z.boolean().default(true),
  unloadGeofenceMeters: z.number().int().min(30, "卸土点定位容差至少 30 米").max(5000, "卸土点定位容差不能超过 5000 米").default(300),
  unloadGeofenceEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  status: z.enum(["active", "disabled"]),
}).refine(value => value.loadSiteId !== value.unloadSiteId, { message: "装土点和卸土点不能相同", path: ["unloadSiteId"] });

/** 渣土车按趟结算从已核验运单生成，金额只能由服务端快照汇总，浏览器不能传入金额。 */
const transportVehicleSettlementDraftInput = z.object({
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  periodStart: businessDateSchema,
  periodEnd: businessDateSchema,
  payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
  payeeAccount: z.string().trim().max(160).nullable().optional(),
  paymentMethod: transportSettlementPaymentMethodSchema.default("bank_transfer"),
  remarks: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, issue) => {
  if (value.periodEnd < value.periodStart) issue.addIssue({ code: "custom", path: ["periodEnd"], message: "结束日期不能早于开始日期" });
  if (["bank_transfer", "corporate_account", "wechat", "alipay"].includes(value.paymentMethod) && !value.payeeAccount?.trim()) issue.addIssue({ code: "custom", path: ["payeeAccount"], message: "该收款方式必须填写收款账户或收款账号" });
});

const transportVehicleSettlementActionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  action: z.enum(["submit", "approve", "pay", "void"]),
  paymentDate: businessDateSchema.optional(),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, issue) => {
  if (value.action === "pay" && !value.paymentDate) issue.addIssue({ code: "custom", path: ["paymentDate"], message: "登记付款必须填写付款日期" });
});

/** 外租机械只能从已审核的月结快照创建付款结算，金额由月结快照和受控扣款组成。 */
const machinePaymentSettlementDraftInput = z.object({
  projectId: z.number().int().positive(),
  monthlyStatementId: z.number().int().positive(),
  payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
  payeeAccount: z.string().trim().max(160).nullable().optional(),
  paymentMethod: transportSettlementPaymentMethodSchema.default("bank_transfer"),
  manualDeductionAmount: z.number().min(0).max(999999999999.99).default(0),
  remarks: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, issue) => {
  if (["bank_transfer", "corporate_account", "wechat", "alipay"].includes(value.paymentMethod) && !value.payeeAccount?.trim()) issue.addIssue({ code: "custom", path: ["payeeAccount"], message: "该收款方式必须填写收款账户或收款账号" });
});

const machinePaymentSettlementActionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  action: z.enum(["submit", "approve", "pay", "void"]),
  paymentDate: businessDateSchema.optional(),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, issue) => {
  if (value.action === "pay" && !value.paymentDate) issue.addIssue({ code: "custom", path: ["paymentDate"], message: "登记付款必须填写付款日期" });
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
  managementCode: z.string().trim().min(2, "请填写至少 2 位车辆卡管理编号").max(64, "车辆卡管理编号不能超过 64 位").transform(value => value.toUpperCase()).nullable().optional(),
  cardUid: z.string().trim().min(4, "请读取有效射频卡 UID").max(128),
  driverPhone: z.string().trim().regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机联系电话"),
  status: z.enum(["active", "suspended", "revoked"]).default("suspended"),
  reuseRevokedUnboundCard: z.boolean().optional().default(false),
});

function createRfidCardManagementCode() {
  return `RFID-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

const rfidWritePrepareInput = z.object({
  cardId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  action: z.enum(["issue", "rewrite", "revoke"]).default("issue"),
  executionMode: z.enum(["manual_confirmation", "pc_bridge"]).default("manual_confirmation"),
  /** 管理员显式确认后才允许作废仍有效的旧 PC 任务并生成新一次性令牌。 */
  replacePreparedPcBridgeJob: z.boolean().optional().default(false),
});

const rfidCardManagementInput = z.object({
  cardId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  reason: z.string().trim().max(200).nullable().optional(),
});

/**
 * Android Web NFC 不会向网页暴露 NTAG216 的物理 UID。因此首次发卡由服务端生成不可预测的
 * 逻辑卡绑定引用，实际装卸扫描继续只信任卡内受签名深链并由服务端转换为该绑定引用。
 */
const mobileNfcInitialIssueInput = z.object({
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
});

const rfidWriteConfirmInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  success: z.boolean(),
  failureReason: z.string().trim().max(500).nullable().optional(),
});

/** 本地环回桥接仅返回 UID 指纹；后台不接收或持久化测试卡的原始 UID。 */
const rfidHardwareTestInput = z.object({
  projectId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  success: z.boolean(),
  cardUidFingerprint: z.string().regex(/^[a-f0-9]{64}$/i, "卡 UID 指纹格式无效").nullable().optional(),
  failureReason: z.string().trim().max(500).nullable().optional(),
});

/** 统一将前端日期解释为 UTC 业务日零点，避免月结边界受浏览器时区影响。 */
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 运输现场日按中国标准时间划分；前端“2026-08-22”应覆盖北京时间当天零点至次日零点。 */
function getChinaBusinessDateRange(value: string) {
  const start = new Date(`${value}T00:00:00+08:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function formatChinaBusinessDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter(part => ["year", "month", "day"].includes(part.type)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/** 机械油料费用与柴油领用共用同一项目指导价口径，避免前端手填单价绕开有效期控制。 */
async function getEffectiveDieselGuidelinePrice(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: number, occurredAt: Date) {
  const businessDate = formatChinaBusinessDate(occurredAt);
  const prices = await db.select().from(dieselGuidelinePrices)
    .where(eq(dieselGuidelinePrices.projectId, projectId))
    .orderBy(desc(dieselGuidelinePrices.effectiveFrom));
  const price = prices.find(item => item.status === "active"
    && formatChinaBusinessDate(new Date(item.effectiveFrom)) <= businessDate
    && (!item.effectiveTo || formatChinaBusinessDate(new Date(item.effectiveTo)) >= businessDate));
  return { businessDate, price: price ? { id: price.id, pricePerLiter: Number(price.pricePerLiter), effectiveFrom: formatChinaBusinessDate(new Date(price.effectiveFrom)), effectiveTo: price.effectiveTo ? formatChinaBusinessDate(new Date(price.effectiveTo)) : null } : null };
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

/** 会计模板使用固定 30 天月、每天 10 小时的换算口径；所有派生金额均在服务端取两位小数。 */
function calculateMonthlyMachineStatement(input: {
  billingType: "monthly" | "daily" | "hourly" | "shift";
  rate: number;
  overtimeHourlyRate: number;
  machineWorkDays: number;
  machineOvertimeHours: number;
  driverMonthlyWage: number;
  driverWorkDays: number;
  driverOvertimeHours: number;
  repairAmount: number;
  fuelLiters: number;
  fuelAmount: number;
}) {
  const machineBaseOutput = input.billingType === "monthly"
    ? roundMoney((input.rate / 30) * input.machineWorkDays)
    : roundMoney(input.rate * input.machineWorkDays);
  const machineOvertimeRate = input.overtimeHourlyRate > 0
    ? input.overtimeHourlyRate
    : input.billingType === "monthly" ? input.rate / 30 / 10 : 0;
  const machineOvertimeOutput = roundMoney(machineOvertimeRate * input.machineOvertimeHours);
  const totalOutput = roundMoney(machineBaseOutput + machineOvertimeOutput);
  const driverBaseWage = roundMoney((input.driverMonthlyWage / 30) * input.driverWorkDays);
  const driverOvertimeWage = roundMoney((input.driverMonthlyWage / 30 / 10) * input.driverOvertimeHours);
  const driverTotalWage = roundMoney(driverBaseWage + driverOvertimeWage);
  /** 会计模板的“机械分成”口径不扣油费： (总产值 - 司机总工资 - 维修费) ÷ 2。油耗和油费单列审计。 */
  const shareBaseAmount = roundMoney(totalOutput - driverTotalWage - input.repairAmount);
  const machineShareAmount = roundMoney(shareBaseAmount / 2);
  const deductionAmount = roundMoney(driverTotalWage + input.repairAmount + input.fuelAmount);
  return { machineBaseOutput, machineOvertimeOutput, totalOutput, driverOvertimeWage, driverTotalWage, repairAmount: roundMoney(input.repairAmount), fuelLiters: roundMoney(input.fuelLiters), fuelAmount: roundMoney(input.fuelAmount), deductionAmount, shareBaseAmount, machineShareAmount };
}

/** 运单号以日期、时间、秒为主体；同一进程同秒并发时只追加短序号避免冲突。 */
let latestTripSecond = "";
let latestTripSecondSequence = 0;
function createTransportTripNo(projectId: number, occurredAt = new Date()) {
  const values = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .formatToParts(occurredAt)
    .reduce<Record<string, string>>((current, part) => ({ ...current, [part.type]: part.value }), {});
  const secondKey = `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
  latestTripSecondSequence = latestTripSecond === secondKey ? latestTripSecondSequence + 1 : 1;
  latestTripSecond = secondKey;
  return `TR-${projectId}-${secondKey}-${String(latestTripSecondSequence).padStart(2, "0")}`;
}

/** 渣土车结算号与运单号分离，避免付款单因重算或补审混同运输票据。 */
function createTransportVehicleSettlementNo(projectId: number, occurredAt = new Date()) {
  const date = getChinaBusinessDate(occurredAt).replaceAll("-", "");
  return `TS-${projectId}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 机械付款结算号独立于月结快照编号，区分已生成结算和实际付款终态。 */
function createMachinePaymentSettlementNo(projectId: number, occurredAt = new Date()) {
  const date = getChinaBusinessDate(occurredAt).replaceAll("-", "");
  return `MS-${projectId}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 非财务角色只查看账户尾号；付款执行与导出由财务角色读取完整受控账户信息。 */
function maskPaymentAccount(account: string | null) {
  if (!account) return null;
  const compact = account.replace(/\s/g, "");
  if (compact.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, compact.length - 4))}${compact.slice(-4)}`;
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

function createCardEventPayloadFingerprint(input: { tripId: number; projectId: number; siteId?: number | null; idempotencyKey: string; deviceId?: string; cardFingerprint?: string; latitude?: number | null; longitude?: number | null; occurredAt: string }, eventType: "load" | "unload") {
  return createHash("sha256").update(JSON.stringify({ eventType, tripId: input.tripId, projectId: input.projectId, siteId: input.siteId ?? null, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId ?? null, cardFingerprint: input.cardFingerprint ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, occurredAt: new Date(input.occurredAt).toISOString() })).digest("hex");
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

function notifyExternalDriverWechat(input: { vehicleId: number; projectId: number; eventCode: string; targetType: string; targetId: string; title: string; content: string; deepLink?: string }) {
  void sendOfficialAccountDriverNotification({
    vehicleId: input.vehicleId,
    projectId: input.projectId,
    module: "transport",
    eventCode: input.eventCode,
    idempotencyKey: `driver:${input.eventCode}:${input.targetType}:${input.targetId}:${input.vehicleId}`,
    title: input.title,
    content: input.content,
    deepLink: "/api/official-account/driver-portal/start",
  }).catch(() => undefined);
}

/**
 * 司机刷卡结果优先进入司机自己的系统消息中心。收件人只能取车辆已绑定的系统账号，
 * 并以运输卡事件与司机账号共同构造幂等键，避免同一次 NFC 重放或重试生成重复消息。
 */
async function notifyBoundDriverInApp(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, input: {
  driverUserId: number | null;
  eventCode: string;
  idempotencyKey: string;
  title: string;
  content: string;
  deepLink: string;
}) {
  if (!input.driverUserId || input.driverUserId <= 0) return false;
  const sentAt = new Date();
  const write = db.insert(notificationRecords).values({
    eventCode: input.eventCode,
    idempotencyKey: input.idempotencyKey,
    recipientUserId: input.driverUserId,
    title: input.title,
    content: input.content,
    deepLink: input.deepLink,
    status: "sent",
    sentAt,
    channel: "in_app",
  }) as unknown as { onDuplicateKeyUpdate?: (input: { set: { status: "sent"; sentAt: Date } }) => Promise<unknown> };
  if (typeof write.onDuplicateKeyUpdate === "function") {
    await write.onDuplicateKeyUpdate({ set: { status: "sent", sentAt } });
  } else {
    // 仅供单元测试中的最小数据库桩使用；真实 MySQL 分支始终使用上方唯一键更新。
    await (write as unknown as Promise<unknown>);
  }
  return true;
}

/** 装卸土点属于现场调度基础资料：运输负责人可维护，项目管理员也可通过明确的运输创建/编辑授权办理。 */
async function canManageTransportSites(ctx: Parameters<typeof requireAuthenticatedUser>[0], roleCodes: readonly string[]) {
  if (roleCodes.includes("ALL") || roleCodes.some(role => ["TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role))) return true;
  const [createDecision, editDecision] = await Promise.all([
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create"),
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit"),
  ]);
  return createDecision.allowed || editDecision.allowed;
}

/** 手机首次发卡可由超级管理员、运输管理岗位或具备明确运输新增/维护权限的项目管理员办理；只读专属权限不得签发车辆卡。 */
async function assertCanIssueMobileNfcCards(ctx: Parameters<typeof requireAuthenticatedUser>[0], roleCodes: readonly string[]) {
  if (roleCodes.includes("ALL") || roleCodes.some(role => ["TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role))) return;
  const [createDecision, editDecision] = await Promise.all([
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create"),
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit"),
  ]);
  if (createDecision.allowed || editDecision.allowed) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "当前账号仅有运输查看权限，未获车辆卡签发或维护授权" });
}

async function recordTransportCardEvent(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof transportCardEventInput>, eventType: "load" | "unload", options: { singleScanClose?: boolean } = {}) {
  const user = requireAuthenticatedUser(ctx);
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [trip] = await db.select().from(transportTrips).where(eq(transportTrips.id, input.tripId)).limit(1);
  if (!trip || trip.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "运输趟次不存在或不属于当前项目" });
  if ((trip.invoiceMode ?? "nfc_card") !== "nfc_card") throw new TRPCError({ code: "BAD_REQUEST", message: "拍照车牌发票不进入 NFC 刷卡流程，请由主管按影像和车辆信息核验" });
  const { vehicle } = await getScopedVehicle(ctx, trip.vehicleId, input.projectId, roleCodes);
  const occurredAt = new Date(input.occurredAt);
  const payloadFingerprint = createCardEventPayloadFingerprint(input, eventType);
  const expectedSiteId = eventType === "load" ? trip.loadSiteId : trip.unloadSiteId;
  let siteName: string | null = null;
  let siteAdministratorUserId: number | null = null;
  if (expectedSiteId || input.siteId) {
    if (!expectedSiteId || input.siteId !== expectedSiteId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${eventType === "load" ? "装土" : "卸土"}刷卡地点与运输票据不一致` });
    }
    const [site] = await db.select().from(transportSites).where(eq(transportSites.id, expectedSiteId)).limit(1);
    if (!site || site.projectId !== input.projectId || site.siteType !== eventType || site.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "现场地点不存在、已停用或地点类型不匹配" });
    }
    // 现场管理员仅作可选责任人留档；具备运输模块权限且在项目范围内的用户均可完成刷卡。
    siteName = site.name;
    siteAdministratorUserId = site.administratorUserId;
  }
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
      siteId: expectedSiteId ?? null,
      operatorUserId: user.id,
      source: "card_reader",
      idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId ?? null,
      latitude: input.latitude === null || input.latitude === undefined ? null : String(input.latitude),
      longitude: input.longitude === null || input.longitude === undefined ? null : String(input.longitude),
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
    const driverNotificationQueued = await notifyBoundDriverInApp(db, {
      driverUserId: vehicle.driverUserId,
      eventCode: "transport_card_event_exception",
      idempotencyKey: `inapp:transport-card-review:${event.id}:${vehicle.driverUserId ?? 0}`,
      title: "运输刷卡异常待复核",
      content: `车辆 ${vehicle.plateNo} 的${eventType === "load" ? "装土" : "卸土"}刷卡需要人工复核：${reason}`,
      deepLink: "/mobile/transport",
    });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: "transport_card_event_exception", targetType: "transport_card_event", targetId: String(event.id), title: "运输刷卡异常待复核", content: `一笔运输${eventType === "load" ? "装土" : "卸土"}刷卡事件需要人工复核。`, deepLink: "/mobile/transport" }).catch(() => undefined);
    return { success: false, duplicate: false, needsReview: true, eventId: event.id, validationStatus: "needs_review" as const, reason, driverNotificationQueued };
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
  if (eventType === "unload") {
    const routePresetId = Number((trip.routeSnapshot as { routePresetId?: number } | null)?.routePresetId || 0);
    if (!routePresetId) return markNeedsReview("当前运单缺少路线安全参数，不能直接确认卸土，请人工核验");
    const [[route], [unloadSite]] = await Promise.all([
      db.select().from(transportRoutePresets).where(eq(transportRoutePresets.id, routePresetId)).limit(1),
      expectedSiteId ? db.select().from(transportSites).where(eq(transportSites.id, expectedSiteId)).limit(1) : Promise.resolve([]),
    ]);
    if (!route || !unloadSite) return markNeedsReview("当前卸土路线或地点配置已失效，不能直接确认卸土，请人工核验");
    const safetyNotices: string[] = [];
    const transitStartAt = trip.loadConfirmedAt ?? trip.startAt;
    const elapsedMinutes = Math.max(0, Math.floor((occurredAt.getTime() - new Date(transitStartAt).getTime()) / 60_000));
    if (elapsedMinutes < unloadSite.minimumTransitMinutes) {
      const reason = `卸土异常：运途时间不符合。当前已运输 ${elapsedMinutes} 分钟，本卸土点最短运输时间为 ${unloadSite.minimumTransitMinutes} 分钟`;
      if (unloadSite.minimumTransitEnabled) return markNeedsReview(`${reason}；未达到时间不能完成卸土`);
      safetyNotices.push(`${reason}（最短运输时间拦截已关闭，已留待核验）`);
    }
    const hasMobileCoordinates = input.latitude !== null && input.latitude !== undefined && input.longitude !== null && input.longitude !== undefined;
    const hasUnloadSiteCoordinates = unloadSite.latitude !== null && unloadSite.latitude !== undefined && unloadSite.longitude !== null && unloadSite.longitude !== undefined;
    if (!hasMobileCoordinates || !hasUnloadSiteCoordinates) {
      const reason = !hasMobileCoordinates ? "卸土异常：未取得现场定位" : "卸土点中文详细地址尚未完成地图定位校验";
      if (unloadSite.unloadGeofenceEnabled) return markNeedsReview(`${reason}，不能直接确认卸土`);
      safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
    } else {
      const distanceMeters = Math.round(calculateCoordinateDistanceMeters(Number(input.latitude), Number(input.longitude), Number(unloadSite.latitude), Number(unloadSite.longitude)));
      if (distanceMeters > unloadSite.unloadGeofenceMeters) {
        const reason = `卸土异常：未达到卸土点，当前定位距卸土点约 ${distanceMeters} 米，允许偏差 ${unloadSite.unloadGeofenceMeters} 米`;
        if (unloadSite.unloadGeofenceEnabled) return markNeedsReview(`${reason}，不能完成卸土`);
        safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
      }
    }
    if (safetyNotices.length) {
      await db.update(transportCardEvents).set({ validationReason: safetyNotices.join("；") }).where(eq(transportCardEvents.id, event.id));
      await db.update(transportTrips).set({ exceptionStatus: "open" }).where(eq(transportTrips.id, trip.id));
    }
  }

  const updateResult = eventType === "load"
    ? await db.update(transportTrips).set({ loadConfirmedAt: occurredAt, loadEventId: event.id, loadConfirmedBy: user.id }).where(and(eq(transportTrips.id, trip.id), isNull(transportTrips.loadConfirmedAt), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")))
    : await db.update(transportTrips).set({ unloadConfirmedAt: occurredAt, unloadEventId: event.id, unloadConfirmedBy: user.id }).where(and(eq(transportTrips.id, trip.id), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")));
  if (!didConditionalWriteApply(updateResult)) return markNeedsReview("趟次已被其他刷卡事件更新，请人工核验事件顺序");

  await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: `record_${eventType}_card_event`, targetType: "transport_card_event", targetId: String(event.id), summary: `运输${eventType === "load" ? "装土" : "卸土"}刷卡确认成功${siteName ? `：${siteName}` : ""}` });
  const eventLabel = eventType === "load" ? "装土" : "卸土";
  const tripFinancialSummary = `车辆 ${vehicle.plateNo}${siteName ? `，${siteName}` : ""}，${eventLabel}刷卡已确认；里程 ${trip.actualDistanceKm ? `${Number(trip.actualDistanceKm).toFixed(3)} km` : "待补录"}，运费 ${trip.calculatedAmount ? `¥${Number(trip.calculatedAmount).toFixed(2)}` : "待核算"}。`;
  if (eventType === "unload") {
    // 站内通知只记录必要的闭环结果，不暴露定位坐标、司机电话或结算账户等敏感字段。
    const recipientUserIds = Array.from(new Set([trip.loadConfirmedBy, user.id, siteAdministratorUserId, vehicle.driverUserId].filter((value): value is number => typeof value === "number" && value > 0)));
    const notificationTime = new Date();
    await Promise.all(recipientUserIds.map(recipientUserId => db.insert(notificationRecords).values({
      eventCode: "transport_unload_completed",
      idempotencyKey: `inapp:transport-unload:${event.id}:${recipientUserId}`,
      recipientUserId,
      title: "运输卸土成功",
      content: `车辆 ${vehicle.plateNo} 已完成卸土确认，运单 ${trip.tripNo} 已形成运输闭环，请进入系统查看受控详情。`,
      deepLink: "/mobile/transport",
      status: "sent",
      sentAt: notificationTime,
      channel: "in_app",
    }).onDuplicateKeyUpdate({ set: { status: "sent", sentAt: notificationTime } })));
  }
  const nextActionText = eventType === "load"
    ? options.singleScanClose ? "本项目已启用刷卡发票即完成闭环，本次运输已直接进入待核验。" : "请按调度前往卸土点。"
    : "运输闭环已记录，等待后续核验。";
  const driverNotificationQueued = eventType === "load"
    ? await notifyBoundDriverInApp(db, {
      driverUserId: vehicle.driverUserId,
      eventCode: "transport_load_driver_notice",
      idempotencyKey: `inapp:transport-load:${event.id}:${vehicle.driverUserId ?? 0}`,
      title: "装土刷卡成功",
      content: `车辆 ${vehicle.plateNo}${siteName ? ` 已在${siteName}` : ""}完成装土刷卡确认，运单 ${trip.tripNo}。${nextActionText}`,
      deepLink: "/mobile/transport",
    })
    : Boolean(vehicle.driverUserId);
  void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: `transport_${eventType}_card_confirmed`, targetType: "transport_card_event", targetId: String(event.id), title: `运输${eventLabel}刷卡已确认`, content: `${tripFinancialSummary} ${nextActionText}`, deepLink: "/mobile/transport" }).catch(() => undefined);
  return { success: true, duplicate: false, needsReview: false, eventId: event.id, validationStatus: "accepted" as const, driverNotificationQueued };
}

/**
 * 双设备闭环入口：装土点读卡设备的首次刷卡创建唯一在途 NFC 票据；卸土点设备只匹配并关闭同一车辆当前在途票据。
 * 设备、地点、管理员和卡片均由服务端复核，浏览器无权指定趟次、路线、方量或价格。
 */
async function recordTransportNfcReaderScan(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof transportNfcReaderScanInput>) {
  const user = requireAuthenticatedUser(ctx);
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const occurredAt = new Date(input.occurredAt);

  const [replayedEvent] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
  if (replayedEvent) {
    if (replayedEvent.projectId !== input.projectId || replayedEvent.cardFingerprint !== input.cardFingerprint || replayedEvent.deviceId !== input.readerDeviceCode) {
      throw new TRPCError({ code: "CONFLICT", message: "该读卡幂等键已用于其他事件，已拒绝重放" });
    }
    const [replayedTrip] = replayedEvent.tripId ? await db.select({ routeSnapshot: transportTrips.routeSnapshot }).from(transportTrips).where(eq(transportTrips.id, replayedEvent.tripId)).limit(1) : [];
    const singleScanClosed = replayedEvent.eventType === "load" && Boolean(replayedTrip && getRouteSnapshot(replayedTrip.routeSnapshot).nfcSingleScanClosed);
    return { success: replayedEvent.validationStatus === "accepted" || replayedEvent.validationStatus === "duplicate", duplicate: true, needsReview: replayedEvent.validationStatus === "needs_review", stage: replayedEvent.eventType === "load" ? singleScanClosed ? "completed" as const : "in_transit" as const : "completed" as const, singleScanClosed, tripId: replayedEvent.tripId, eventId: replayedEvent.id, reason: replayedEvent.validationReason ?? undefined };
  }

  const [reader] = await db.select().from(transportReaderDevices).where(and(eq(transportReaderDevices.projectId, input.projectId), eq(transportReaderDevices.deviceCode, input.readerDeviceCode))).limit(1);
  if (!reader || reader.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前读卡设备未登记、未启用或不属于该项目" });
  const [site] = await db.select().from(transportSites).where(eq(transportSites.id, reader.siteId)).limit(1);
  if (!site || site.projectId !== input.projectId || site.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "读卡设备绑定的现场地点不存在或已停用" });
  const isTransportManager = roleCodes.includes("ALL") || roleCodes.some(role => ["TRANSPORT_MANAGER", "PROJECT_MANAGER"].includes(role));
  if (site.administratorUserId && site.administratorUserId !== user.id && !isTransportManager) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是该地点指定的现场刷卡管理员" });
  }

  const [card] = await db.select().from(transportVehicleRfidCards).where(and(eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.cardUidFingerprint, input.cardFingerprint), eq(transportVehicleRfidCards.status, "active"))).limit(1);
  if (!card || !card.vehicleId) throw new TRPCError({ code: "BAD_REQUEST", message: "当前卡未绑定有效车辆、已停用或不属于本项目" });
  const { vehicle } = await getScopedVehicle(ctx, card.vehicleId, input.projectId, roleCodes);
  if (vehicle.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆未处于可调度状态，不能进入运输闭环" });
  const transitKey = `nfc:${input.projectId}:${card.id}`;
  const [activeTrip] = await db.select().from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), eq(transportTrips.nfcTransitKey, transitKey), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled"))).orderBy(desc(transportTrips.id)).limit(1);

  if (site.siteType === "load") {
    if (activeTrip) throw new TRPCError({ code: "CONFLICT", message: `车辆 ${vehicle.plateNo} 已有在途票据 ${activeTrip.tripNo}，请在对应卸土点完成第二次刷卡后再发车` });
    await assertNoOpenTransportTrip(db, input.projectId, vehicle.id, vehicle.plateNo);
    const [route] = await db.select().from(transportRoutePresets).where(and(eq(transportRoutePresets.projectId, input.projectId), eq(transportRoutePresets.loadSiteId, site.id), eq(transportRoutePresets.status, "active"))).orderBy(desc(transportRoutePresets.isDefault), desc(transportRoutePresets.updatedAt)).limit(1);
    if (!route) throw new TRPCError({ code: "BAD_REQUEST", message: "当前装土点未配置启用的装卸路线，不能发车" });
    const [[unloadSite], [rule]] = await Promise.all([
      db.select().from(transportSites).where(eq(transportSites.id, route.unloadSiteId)).limit(1),
      db.select().from(freightRateRules).where(eq(freightRateRules.id, route.freightRuleId)).limit(1),
    ]);
	    if (!unloadSite || unloadSite.projectId !== input.projectId || unloadSite.siteType !== "unload" || unloadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "路线卸土点不存在或已停用" });
	    if (!rule || rule.projectId !== input.projectId || rule.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "路线运价不存在或未生效" });
	    if (rule.settlementUnit === "ton") throw new TRPCError({ code: "BAD_REQUEST", message: "按吨结算路线须录入实际过磅重量，暂不能由首次刷卡自动发车" });
	    const singleScanCloseEnabled = await getTransportNfcSingleScanCloseEnabled(db, input.projectId);
	    if (singleScanCloseEnabled) await assertVehicleMinimumNfcInvoiceInterval(db, { projectId: input.projectId, vehicleId: vehicle.id, plateNo: vehicle.plateNo, occurredAt, minimumTransitMinutes: route.minimumTransitMinutes });
	    let theoreticalVolume: number;
    try { theoreticalVolume = calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)); } catch (error) { throwDomainAsBadRequest(error); }
    const settlementQuantity = rule.settlementUnit === "cubic_meter" ? theoreticalVolume : 1;
    let price;
    try { price = calculateTieredFreightAmount({ actualDistanceKm: Number(route.presetDistanceKm), startDistanceKm: Number(rule.startDistanceKm), basePricePerUnit: Number(rule.basePricePerUnit), stepMeters: rule.stepMeters, stepIncreasePerUnit: Number(rule.stepIncreasePerUnit), settlementQuantity }); } catch (error) { throwDomainAsBadRequest(error); }
    const tripNo = createTransportTripNo(input.projectId);
    const routeSnapshot = { source: "nfc_dual_reader", routePresetId: route.id, invoiceMode: "nfc_card", settlementUnit: rule.settlementUnit, theoreticalVolumeCubicMeters: theoreticalVolume, billableSteps: price.billableSteps, loadSite: { id: site.id, name: site.name, administratorUserId: site.administratorUserId, readerDeviceCode: reader.deviceCode }, unloadSite: { id: unloadSite.id, name: unloadSite.name, administratorUserId: unloadSite.administratorUserId }, startLatitude: input.latitude ?? null, startLongitude: input.longitude ?? null };
    try {
      await db.insert(transportTrips).values({ tripNo, vehicleId: vehicle.id, projectId: input.projectId, freightRuleId: rule.id, invoiceMode: "nfc_card", loadSiteId: site.id, unloadSiteId: unloadSite.id, startAt: occurredAt, actualDistanceKm: String(route.presetDistanceKm), volumeCubicMeters: String(theoreticalVolume), calculatedUnitPrice: String(price.unitPrice), calculatedAmount: String(price.totalAmount), routeSnapshot, status: "draft", nfcTransitKey: transitKey, activeVehicleTransitKey: createActiveVehicleTransitKey(input.projectId, vehicle.id) });
    } catch (error) {
      throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
    }
    const [createdTrip] = await db.select().from(transportTrips).where(eq(transportTrips.tripNo, tripNo)).limit(1);
    if (!createdTrip) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "装土刷卡运输票据创建失败" });
    const event = await recordTransportCardEvent(ctx, { tripId: createdTrip.id, projectId: input.projectId, siteId: site.id, idempotencyKey: input.idempotencyKey, deviceId: reader.deviceCode, cardFingerprint: input.cardFingerprint, latitude: input.latitude ?? null, longitude: input.longitude ?? null, occurredAt: input.occurredAt }, "load", { singleScanClose: singleScanCloseEnabled });
    const singleScanClosed = singleScanCloseEnabled && event.success && !event.needsReview;
    if (singleScanClosed) await completeNfcTripBySingleScan(db, { tripId: createdTrip.id, userId: user.id, occurredAt, routeSnapshot });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: singleScanClosed ? "nfc_load_create_and_close_trip" : "nfc_load_create_transit_trip", targetType: "transport_trip", targetId: String(createdTrip.id), summary: singleScanClosed ? `装土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 创建并完成单次刷卡闭环票据 ${tripNo}` : `装土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 创建在途票据 ${tripNo}` });
	    const loadRecipientUserIds = Array.from(new Set([site.administratorUserId, unloadSite.administratorUserId, vehicle.driverUserId].filter((value): value is number => typeof value === "number" && value > 0)));
    void notifyOfficialAccountBusinessEventSafely({
      userId: user.id,
      recipientUserIds: loadRecipientUserIds,
      projectId: input.projectId,
      module: "transport",
      eventCode: singleScanClosed ? "transport_nfc_single_scan_completed" : "transport_nfc_load_departed",
	      targetType: "transport_trip",
	      targetId: String(createdTrip.id),
      title: singleScanClosed ? "运输刷卡发票已完成闭环" : "运输车辆已装土发车",
      content: singleScanClosed ? `车辆 ${vehicle.plateNo} 已在 ${site.name} 完成刷卡发票，系统已按管理员设置直接形成整车运输闭环，运单 ${tripNo} 进入待核验。` : `车辆 ${vehicle.plateNo} 已在 ${site.name} 完成装土刷卡，请按路线前往 ${unloadSite.name} 完成卸土闭环。`,
	      deepLink: "/mobile/transport",
	    }).catch(() => undefined);
	    if (event.success && !event.needsReview) triggerTransportRiskScan(input.projectId);
    return { ...event, stage: singleScanClosed ? "completed" as const : "in_transit" as const, singleScanClosed, tripId: createdTrip.id, tripNo, vehiclePlateNo: vehicle.plateNo, loadSiteName: site.name, unloadSiteName: unloadSite.name };
	  }

  if (!activeTrip) throw new TRPCError({ code: "BAD_REQUEST", message: `车辆 ${vehicle.plateNo} 当前没有可在本卸土点闭环的在途票据，请先在装土点完成首次刷卡` });
  if (activeTrip.unloadSiteId !== site.id) throw new TRPCError({ code: "BAD_REQUEST", message: "当前卸土设备与在途票据的路线卸土点不一致，已拒绝闭环" });
  const event = await recordTransportCardEvent(ctx, { tripId: activeTrip.id, projectId: input.projectId, siteId: site.id, idempotencyKey: input.idempotencyKey, deviceId: reader.deviceCode, cardFingerprint: input.cardFingerprint, latitude: input.latitude ?? null, longitude: input.longitude ?? null, occurredAt: input.occurredAt }, "unload");
  if (event.success && !event.needsReview) {
    await db.update(transportTrips).set({ nfcTransitKey: null, activeVehicleTransitKey: null, endAt: occurredAt, status: "submitted" }).where(and(eq(transportTrips.id, activeTrip.id), eq(transportTrips.nfcTransitKey, transitKey)));
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "nfc_unload_close_transit_trip", targetType: "transport_trip", targetId: String(activeTrip.id), summary: `卸土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 闭环运输票据 ${activeTrip.tripNo}` });
    const loadAdministratorUserId = (activeTrip.routeSnapshot as { loadSite?: { administratorUserId?: number | null } } | null)?.loadSite?.administratorUserId ?? null;
    const unloadRecipientUserIds = Array.from(new Set([loadAdministratorUserId, site.administratorUserId, vehicle.driverUserId].filter((value): value is number => typeof value === "number" && value > 0)));
    void notifyOfficialAccountBusinessEventSafely({
      userId: user.id,
      recipientUserIds: unloadRecipientUserIds,
      projectId: input.projectId,
      module: "transport",
      eventCode: "transport_nfc_unload_completed",
      targetType: "transport_trip",
      targetId: String(activeTrip.id),
      title: "运输卸土刷卡已完成",
      content: `车辆 ${vehicle.plateNo} 已在 ${site.name} 完成卸土刷卡，运输票据 ${activeTrip.tripNo} 已进入待核验状态。`,
      deepLink: "/mobile/transport",
    }).catch(() => undefined);
    triggerTransportRiskScan(input.projectId);
  }
  return { ...event, stage: "completed" as const, singleScanClosed: false, tripId: activeTrip.id, tripNo: activeTrip.tripNo, vehiclePlateNo: vehicle.plateNo, loadSiteName: (activeTrip.routeSnapshot as { loadSite?: { name?: string } } | null)?.loadSite?.name ?? "装土点", unloadSiteName: site.name };
}

/** 将手机触碰卡片 URL 的签名令牌转换为同一套双设备扫描输入；原始 UID 不会进入手机 URL 或服务端日志。 */
async function recordTransportNfcLinkScan(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof transportNfcLinkScanInput>) {
  const parsed = verifyTransportNfcDeepLinkToken(input.token);
  if (!parsed) throw new TRPCError({ code: "BAD_REQUEST", message: "NFC 卡片入口无效或已被篡改，请重新读取有效车辆卡" });
  await assertProjectInCurrentScope(ctx, parsed.projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, parsed.cardId)).limit(1);
  if (!card || card.projectId !== parsed.projectId || card.status !== "active" || card.payloadVersion !== parsed.payloadVersion) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "车辆卡已停用、补写或不属于当前项目，请使用最新有效卡" });
  }
  return recordTransportNfcReaderScan(ctx, { projectId: parsed.projectId, readerDeviceCode: input.readerDeviceCode, idempotencyKey: input.idempotencyKey, cardFingerprint: card.cardUidFingerprint, latitude: input.latitude ?? null, longitude: input.longitude ?? null, occurredAt: input.occurredAt });
}

/** 手机开票页只解析签名卡和候选路线，不创建票据；实际开票必须由后续确认操作完成。 */
async function resolveMobileNfcInvoice(ctx: Parameters<typeof requireAuthenticatedUser>[0], token: string) {
  const parsed = verifyTransportNfcDeepLinkToken(token);
  if (!parsed) throw new TRPCError({ code: "BAD_REQUEST", message: "NFC 卡片入口无效或已被篡改，请重新读取有效车辆卡" });
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, parsed.projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, parsed.cardId)).limit(1);
  if (!card || card.projectId !== parsed.projectId || card.status !== "active" || card.payloadVersion !== parsed.payloadVersion || !card.vehicleId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "车辆卡已停用、已解除绑定、已补写或不属于当前项目，请使用最新有效卡" });
  }
  const { vehicle } = await getScopedVehicle(ctx, card.vehicleId, parsed.projectId, roleCodes);
  if (vehicle.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆未处于可调度状态，不能开具运输发票" });
  const transitKey = `nfc:${parsed.projectId}:${card.id}`;
  const [activeTrip] = await db.select().from(transportTrips).where(and(eq(transportTrips.projectId, parsed.projectId), eq(transportTrips.nfcTransitKey, transitKey), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled"))).orderBy(desc(transportTrips.id)).limit(1);
  const routeRows = activeTrip ? [] : await db.select().from(transportRoutePresets).where(and(eq(transportRoutePresets.projectId, parsed.projectId), eq(transportRoutePresets.status, "active"))).orderBy(desc(transportRoutePresets.isDefault), desc(transportRoutePresets.updatedAt));
  const siteIds = Array.from(new Set([...routeRows.flatMap(route => [route.loadSiteId, route.unloadSiteId]), activeTrip?.loadSiteId ?? 0, activeTrip?.unloadSiteId ?? 0].filter(Boolean)));
  const sites = siteIds.length ? (await Promise.all(siteIds.map(async id => (await db.select().from(transportSites).where(eq(transportSites.id, id)).limit(1))[0]))).filter((site): site is typeof transportSites.$inferSelect => Boolean(site)) : [];
  const siteById = new Map(sites.map(site => [site.id, site]));
  return {
    projectId: parsed.projectId,
    cardId: card.id,
    cardFingerprint: card.cardUidFingerprint,
    vehicle: { id: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? null, driverPhoneMasked: null },
    routes: routeRows.map(route => ({ id: route.id, isDefault: route.isDefault, distanceKm: route.presetDistanceKm, loadSiteName: siteById.get(route.loadSiteId)?.name ?? "装土点", unloadSiteName: siteById.get(route.unloadSiteId)?.name ?? "卸土点" })),
    activeTrip: activeTrip ? { id: activeTrip.id, tripNo: activeTrip.tripNo, loadSiteName: siteById.get(activeTrip.loadSiteId ?? 0)?.name ?? "装土点", unloadSiteName: siteById.get(activeTrip.unloadSiteId ?? 0)?.name ?? "卸土点" } : null,
  };
}

/** 手机已识别车辆后，选择路线一次确认发车；存在在途票据时同一确认动作完成卸土闭环。 */
async function confirmMobileNfcInvoice(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof mobileNfcInvoiceConfirmInput>) {
  const user = requireAuthenticatedUser(ctx);
  const resolved = await resolveMobileNfcInvoice(ctx, input.token);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const occurredAt = new Date(input.occurredAt);
  const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, resolved.cardId)).limit(1);
  if (!card) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆卡已失效，请重新刷卡" });
  if (resolved.activeTrip) {
    const [trip] = await db.select().from(transportTrips).where(eq(transportTrips.id, resolved.activeTrip.id)).limit(1);
    if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "当前在途运单不存在" });
    const event = await recordTransportCardEvent(ctx, { tripId: trip.id, projectId: resolved.projectId, siteId: trip.unloadSiteId, idempotencyKey: input.idempotencyKey, deviceId: "MOBILE-NFC", cardFingerprint: card.cardUidFingerprint, latitude: input.latitude, longitude: input.longitude, occurredAt: input.occurredAt }, "unload");
    if (!event.success || event.needsReview) {
      throw new TRPCError({ code: "BAD_REQUEST", message: event.reason || "卸土异常，当前运单仍在运输中，不能显示卸土成功" });
    }
    const updateResult = await db.update(transportTrips).set({ nfcTransitKey: null, activeVehicleTransitKey: null, endAt: occurredAt, status: "submitted" }).where(and(eq(transportTrips.id, trip.id), eq(transportTrips.nfcTransitKey, `nfc:${resolved.projectId}:${card.id}`)));
    if (!didConditionalWriteApply(updateResult)) {
      throw new TRPCError({ code: "CONFLICT", message: "卸土状态未能最终写入，当前运单仍在运输中，请刷新后核验" });
    }
    triggerTransportRiskScan(resolved.projectId);
    return { ...event, stage: "completed" as const, singleScanClosed: false, tripNo: trip.tripNo, vehiclePlateNo: resolved.vehicle.plateNo };
  }
  if (!input.routePresetId) throw new TRPCError({ code: "BAD_REQUEST", message: "请先选择运输线路" });
  const [route] = await db.select().from(transportRoutePresets).where(eq(transportRoutePresets.id, input.routePresetId)).limit(1);
  if (!route || route.projectId !== resolved.projectId || route.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "选择的运输线路不存在、已停用或不属于当前项目" });
  const [[vehicle], [loadSite], [unloadSite], [rule]] = await Promise.all([
    db.select().from(transportVehicles).where(eq(transportVehicles.id, resolved.vehicle.id)).limit(1),
    db.select().from(transportSites).where(eq(transportSites.id, route.loadSiteId)).limit(1),
    db.select().from(transportSites).where(eq(transportSites.id, route.unloadSiteId)).limit(1),
    db.select().from(freightRateRules).where(eq(freightRateRules.id, route.freightRuleId)).limit(1),
  ]);
	  if (!vehicle || vehicle.status !== "active" || !loadSite || loadSite.status !== "active" || !unloadSite || unloadSite.status !== "active" || !rule || rule.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "车辆、路线地点或运价已变更，请重新刷卡后开票" });
	  await assertNoOpenTransportTrip(db, resolved.projectId, vehicle.id, vehicle.plateNo);
	  if (rule.settlementUnit === "ton") throw new TRPCError({ code: "BAD_REQUEST", message: "按吨结算路线须录入实际过磅重量，不能自动开票" });
	  const singleScanCloseEnabled = await getTransportNfcSingleScanCloseEnabled(db, resolved.projectId);
	  if (singleScanCloseEnabled) await assertVehicleMinimumNfcInvoiceInterval(db, { projectId: resolved.projectId, vehicleId: vehicle.id, plateNo: vehicle.plateNo, occurredAt, minimumTransitMinutes: route.minimumTransitMinutes });
  let theoreticalVolume: number;
  try { theoreticalVolume = calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)); } catch (error) { throwDomainAsBadRequest(error); }
  let price;
  try { price = calculateTieredFreightAmount({ actualDistanceKm: Number(route.presetDistanceKm), startDistanceKm: Number(rule.startDistanceKm), basePricePerUnit: Number(rule.basePricePerUnit), stepMeters: rule.stepMeters, stepIncreasePerUnit: Number(rule.stepIncreasePerUnit), settlementQuantity: rule.settlementUnit === "cubic_meter" ? theoreticalVolume : 1 }); } catch (error) { throwDomainAsBadRequest(error); }
  const tripNo = createTransportTripNo(resolved.projectId, occurredAt);
  const transitKey = `nfc:${resolved.projectId}:${card.id}`;
  try {
    await db.insert(transportTrips).values({ tripNo, vehicleId: vehicle.id, projectId: resolved.projectId, freightRuleId: rule.id, invoiceMode: "nfc_card", loadSiteId: loadSite.id, unloadSiteId: unloadSite.id, startAt: occurredAt, actualDistanceKm: String(route.presetDistanceKm), volumeCubicMeters: String(theoreticalVolume), calculatedUnitPrice: String(price.unitPrice), calculatedAmount: String(price.totalAmount), routeSnapshot: { source: "mobile_nfc_invoice", routePresetId: route.id, invoiceMode: "nfc_card", settlementUnit: rule.settlementUnit, theoreticalVolumeCubicMeters: theoreticalVolume, billableSteps: price.billableSteps, loadSite: { id: loadSite.id, name: loadSite.name, administratorUserId: loadSite.administratorUserId }, unloadSite: { id: unloadSite.id, name: unloadSite.name, administratorUserId: unloadSite.administratorUserId } }, status: "draft", nfcTransitKey: transitKey, activeVehicleTransitKey: createActiveVehicleTransitKey(resolved.projectId, vehicle.id) });
  } catch (error) {
    throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
  }
  const [createdTrip] = await db.select().from(transportTrips).where(eq(transportTrips.tripNo, tripNo)).limit(1);
  if (!createdTrip) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "运输开票保存失败" });
  const event = await recordTransportCardEvent(ctx, { tripId: createdTrip.id, projectId: resolved.projectId, siteId: loadSite.id, idempotencyKey: input.idempotencyKey, deviceId: "MOBILE-NFC", cardFingerprint: card.cardUidFingerprint, occurredAt: input.occurredAt }, "load", { singleScanClose: singleScanCloseEnabled });
  const singleScanClosed = singleScanCloseEnabled && event.success && !event.needsReview;
  if (singleScanClosed) await completeNfcTripBySingleScan(db, { tripId: createdTrip.id, userId: user.id, occurredAt, routeSnapshot: createdTrip.routeSnapshot });
  void notifyOfficialAccountBusinessEventSafely({ userId: user.id, recipientUserIds: Array.from(new Set([loadSite.administratorUserId, unloadSite.administratorUserId, vehicle.driverUserId].filter((value): value is number => typeof value === "number" && value > 0))), projectId: resolved.projectId, module: "transport", eventCode: singleScanClosed ? "transport_mobile_nfc_invoice_completed" : "transport_mobile_nfc_invoice_departed", targetType: "transport_trip", targetId: String(createdTrip.id), title: singleScanClosed ? "运输 NFC 发票已完成闭环" : "运输 NFC 发票已开具", content: singleScanClosed ? `车辆 ${vehicle.plateNo} 已开具运单 ${tripNo}，系统已按管理员设置直接完成整车运输闭环。` : `车辆 ${vehicle.plateNo} 已开具运单 ${tripNo}，请按路线从 ${loadSite.name} 前往 ${unloadSite.name}。`, deepLink: "/mobile/transport" }).catch(() => undefined);
  notifyExternalDriverWechat({ vehicleId: vehicle.id, projectId: resolved.projectId, eventCode: singleScanClosed ? "transport_mobile_nfc_invoice_completed" : "transport_mobile_nfc_invoice_departed", targetType: "transport_trip", targetId: String(createdTrip.id), title: singleScanClosed ? "运输 NFC 发票已完成闭环" : "运输 NFC 发票已开具", content: singleScanClosed ? `车辆 ${vehicle.plateNo} 已开具运单 ${tripNo}，系统已按管理员设置直接完成整车运输闭环。` : `车辆 ${vehicle.plateNo} 已开具运单 ${tripNo}，请按路线从 ${loadSite.name} 前往 ${unloadSite.name}。`, deepLink: "/mobile/transport" });
  if (event.success && !event.needsReview) triggerTransportRiskScan(resolved.projectId);
  await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "mobile_nfc_invoice_created", targetType: "transport_trip", targetId: String(createdTrip.id), summary: `手机刷 NFC 卡开具运输发票 ${tripNo}：${vehicle.plateNo}，${loadSite.name} → ${unloadSite.name}` });
  return { ...event, stage: singleScanClosed ? "completed" as const : "in_transit" as const, singleScanClosed, tripNo, vehiclePlateNo: vehicle.plateNo };
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
  const hasUserSpecificReadPermission = await hasUserSpecificOperationPermission(ctx, "MACHINERY", "read");
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role)) && !hasUserSpecificReadPermission) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获机械管理数据访问授权" });
  }
  return roleCodes;
}

/** 运输模块允许的岗位；司机角色只可操作分配给本人的车辆及趟次。 */
async function assertTransportAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "TRANSPORT");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["TRANSPORT_MANAGER", "DRIVER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"];
  const hasUserSpecificReadPermission = await hasUserSpecificOperationPermission(ctx, "TRANSPORT", "read");
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role)) && !hasUserSpecificReadPermission) {
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

/** 复用会计模板的月度明细预览，避免保存接口通过路由自身调用而产生循环类型依赖。 */
async function buildMachineMonthlyStatementPreview(ctx: Parameters<typeof requireAuthenticatedUser>[0], input: z.infer<typeof machineMonthlyStatementInput>) {
  const { db, machine } = await getScopedMachine(ctx, input.machineId, input.projectId);
  const range = getMonthRange(input.period);
  const rules = await db.select().from(machineLeaseRules).where(and(eq(machineLeaseRules.machineId, input.machineId), eq(machineLeaseRules.projectId, input.projectId), eq(machineLeaseRules.status, "active"))).orderBy(desc(machineLeaseRules.effectiveFrom));
  const rule = rules.find(item => new Date(item.effectiveFrom).getTime() < range.endExclusive.getTime() && (!item.effectiveTo || new Date(item.effectiveTo).getTime() >= range.start.getTime()));
  if (!rule) throw new TRPCError({ code: "BAD_REQUEST", message: "当前结算期间未找到生效的机械租赁/计价规则" });
  const [costRows, maintenanceRows] = await Promise.all([
    db.select().from(machineCostRecords).where(and(eq(machineCostRecords.machineId, input.machineId), eq(machineCostRecords.projectId, input.projectId), ne(machineCostRecords.status, "void"), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive))),
    db.select().from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.assetType, "machine"), eq(assetMaintenanceRecords.assetId, input.machineId), eq(assetMaintenanceRecords.projectId, input.projectId), ne(assetMaintenanceRecords.status, "void"), gte(assetMaintenanceRecords.occurredAt, range.start), lt(assetMaintenanceRecords.occurredAt, range.endExclusive))),
  ]);
  const repairAmount = costRows.filter(item => item.costType === "repair").reduce((sum, item) => sum + Number(item.amount), 0) + maintenanceRows.filter(item => item.costCategory === "repair").reduce((sum, item) => sum + Number(item.amount), 0);
  const fuelRows = costRows.filter(item => item.costType === "fuel");
  const fuelLiters = fuelRows.reduce((sum, item) => sum + Number(item.quantity), 0);
  const fuelAmount = fuelRows.reduce((sum, item) => sum + Number(item.amount), 0);
  const statement = calculateMonthlyMachineStatement({ billingType: rule.billingType, rate: Number(rule.rate), overtimeHourlyRate: Number(rule.overtimeHourlyRate), machineWorkDays: input.machineWorkDays, machineOvertimeHours: input.machineOvertimeHours, driverMonthlyWage: input.driverMonthlyWage, driverWorkDays: input.driverWorkDays, driverOvertimeHours: input.driverOvertimeHours, repairAmount, fuelLiters, fuelAmount });
  const driverUserId = input.driverUserId ?? machine.operatorUserId;
  const [driver] = driverUserId ? await db.select({ name: users.name }).from(users).where(eq(users.id, driverUserId)).limit(1) : [];
  return { machine: { id: machine.id, code: machine.code, name: machine.name, model: machine.model, ownerName: machine.ownership === "leased" ? machine.supplierName ?? "未登记出租方" : "公司自有", driverUserId, driverName: driver?.name ?? "未分配" }, rule: { billingType: rule.billingType, rate: Number(rule.rate), overtimeHourlyRate: Number(rule.overtimeHourlyRate), effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo }, statement, source: { costRecordCount: costRows.length, maintenanceRecordCount: maintenanceRows.length } };
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

  /** 费用录入仅展示当前项目、当前加油发生时间有效的指导价；保存时仍会重新匹配。 */
  fuelCostDefault: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), occurredAt: isoDateTimeSchema })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "加油发生时间无效" });
    const matched = await getEffectiveDieselGuidelinePrice(db, input.projectId, occurredAt);
    return { occurredOn: matched.businessDate, guidelinePrice: matched.price?.pricePerLiter ?? null, guidelinePriceId: matched.price?.id ?? null, effectiveFrom: matched.price?.effectiveFrom ?? null, effectiveTo: matched.price?.effectiveTo ?? null };
  }),

  listMachines: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(machines).where(eq(machines.projectId, input.projectId)).orderBy(desc(machines.updatedAt));
    return Promise.all(rows.map(async machine => {
      const rules = await db.select().from(machineLeaseRules).where(eq(machineLeaseRules.machineId, machine.id)).orderBy(desc(machineLeaseRules.createdAt));
      const activeRule = rules.find(rule => rule.projectId === input.projectId && rule.status === "active");
      const [operator] = machine.operatorUserId ? await db.select({ name: users.name }).from(users).where(eq(users.id, machine.operatorUserId)).limit(1) : [];
      const { driverPhoneEncrypted, ...machineSafe } = machine;
      return {
        ...machineSafe,
        operatorName: operator?.name ?? null,
        driverPhone: driverPhoneEncrypted ? decryptSecret(driverPhoneEncrypted) : null,
        leaseTerms: activeRule ? { billingType: activeRule.billingType, rate: activeRule.rate, effectiveFrom: activeRule.effectiveFrom, effectiveTo: activeRule.effectiveTo } : null,
      };
    }));
  }),

  /** 新建或维护机械台账；跨项目编辑时需同时校验原项目和目标项目授权。 */
  saveMachine: protectedProcedure.input(machineInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    let existing: typeof machines.$inferSelect | undefined;
    if (input.id) {
      const [row] = await db.select().from(machines).where(eq(machines.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "机械台账不存在" });
      if (row.projectId) await assertProjectInCurrentScope(ctx, row.projectId);
      existing = row;
    }
    const values = {
      projectId: input.projectId,
      operatorUserId: input.operatorUserId ?? null,
      driverName: input.driverName ?? null,
      driverPhoneEncrypted: input.driverPhone === undefined ? existing?.driverPhoneEncrypted ?? null : input.driverPhone ? encryptSecret(input.driverPhone) : null,
      driverPhoneMasked: input.driverPhone === undefined ? existing?.driverPhoneMasked ?? null : input.driverPhone ? maskSecret(input.driverPhone) : null,
      code: input.code,
      name: input.name,
      model: input.model ?? null,
      ownership: input.ownership,
      supplierName: input.supplierName ?? null,
      plateOrAssetNo: input.plateOrAssetNo ?? null,
      fuelTankCapacityLiters: input.fuelTankCapacityLiters === null || input.fuelTankCapacityLiters === undefined ? null : String(input.fuelTankCapacityLiters),
      status: input.status,
    };
    let machineId = input.id;
    if (input.id) {
      await db.update(machines).set(values).where(eq(machines.id, input.id));
    } else {
      await db.insert(machines).values(values);
      const [created] = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, input.code)).limit(1);
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "机械台账保存后未找到记录" });
      machineId = created.id;
    }
    if (!machineId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "机械台账标识无效" });

    const existingRules = await db.select().from(machineLeaseRules).where(eq(machineLeaseRules.machineId, machineId)).orderBy(desc(machineLeaseRules.createdAt));
    const activeRule = existingRules.find(rule => rule.projectId === input.projectId && rule.status === "active");
    if (input.leaseTerms) {
      const leaseValues = {
        machineId,
        projectId: input.projectId,
        billingType: input.leaseTerms.billingType,
        rate: String(roundMoney(input.leaseTerms.rate)),
        overtimeHourlyRate: "0",
        effectiveFrom: toBusinessDate(input.leaseTerms.effectiveFrom),
        effectiveTo: input.leaseTerms.effectiveTo ? toBusinessDate(input.leaseTerms.effectiveTo) : null,
        status: "active" as const,
      };
      if (activeRule) await db.update(machineLeaseRules).set(leaseValues).where(eq(machineLeaseRules.id, activeRule.id));
      else await db.insert(machineLeaseRules).values(leaseValues);
    } else if (activeRule) {
      await db.update(machineLeaseRules).set({ status: "disabled" }).where(eq(machineLeaseRules.id, activeRule.id));
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: input.id ? "update_machine" : "create_machine", targetType: "machine", targetId: String(machineId), summary: `${input.id ? "维护" : "新建"}机械台账：${input.name}${input.leaseTerms ? `，已维护${input.ownership === "leased" ? "外租" : "会计产值"}计价规则` : ""}` });
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

  /**
   * 机械成本汇总打印按项目和自然月读取真实成本记录。默认排除作废记录；
   * 明确选择“已作废”时才输出其审计明细，避免无效金额混入正常合计。
   */
  printSummary: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    period: settlementPeriodSchema,
    machineId: z.number().int().positive().nullable().optional(),
    status: z.enum(["all", "draft", "approved", "settled", "void"]).default("all"),
  })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (input.machineId) await getScopedMachine(ctx, input.machineId, input.projectId);
    const db = await getDb();
    if (!db) return { records: [], summary: { recordCount: 0, machineCount: 0, quantity: 0, amount: 0 } };
    const range = getMonthRange(input.period);
    const predicates = [eq(machineCostRecords.projectId, input.projectId), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive)];
    if (input.machineId) predicates.push(eq(machineCostRecords.machineId, input.machineId));
    if (input.status === "all") predicates.push(ne(machineCostRecords.status, "void"));
    else predicates.push(eq(machineCostRecords.status, input.status));
    const [rows, machineRows] = await Promise.all([
      db.select().from(machineCostRecords).where(and(...predicates)).orderBy(desc(machineCostRecords.occurredAt)),
      db.select({ id: machines.id, name: machines.name, code: machines.code, model: machines.model }).from(machines).where(eq(machines.projectId, input.projectId)),
    ]);
    const labels = new Map(machineRows.map(row => [row.id, `${row.name}${row.code ? ` · ${row.code}` : ""}`]));
    const records = rows.map(row => ({
      id: row.id,
      machineId: row.machineId,
      machineLabel: labels.get(row.machineId) ?? "机械已停用/删除",
      costType: row.costType,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitPrice),
      amount: Number(row.amount),
      occurredAt: row.occurredAt,
      remarks: row.remarks,
      status: row.status,
    }));
    return {
      records,
      summary: {
        recordCount: records.length,
        machineCount: new Set(records.map(row => row.machineId)).size,
        quantity: records.reduce((sum, row) => sum + row.quantity, 0),
        amount: records.reduce((sum, row) => sum + row.amount, 0),
      },
    };
  }),

  /** 统一机械台账仅汇总当前已授权项目内的真实成本；作废记录不计入金额但仍保留于单机详情审计。 */
  listCostSummaries: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(machineCostRecords).where(eq(machineCostRecords.projectId, input.projectId)).orderBy(desc(machineCostRecords.occurredAt));
    const summaries = new Map<number, { machineId: number; totalAmount: number; repairAmount: number; recordCount: number; lastOccurredAt: Date | null }>();
    rows.filter(row => row.status !== "void").forEach(row => {
      const current = summaries.get(row.machineId) ?? { machineId: row.machineId, totalAmount: 0, repairAmount: 0, recordCount: 0, lastOccurredAt: null };
      const amount = Number(row.amount);
      current.totalAmount += amount;
      if (row.costType === "repair") current.repairAmount += amount;
      current.recordCount += 1;
      if (!current.lastOccurredAt || new Date(row.occurredAt).getTime() > current.lastOccurredAt.getTime()) current.lastOccurredAt = new Date(row.occurredAt);
      summaries.set(row.machineId, current);
    });
    return Array.from(summaries.values());
  }),

  /** 按会计模板读取当前项目、期间的已保存月度明细快照；不返回其他项目或作废以外的隐藏数据。 */
  listMonthlyStatements: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: settlementPeriodSchema })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(machineMonthlyStatements).where(and(eq(machineMonthlyStatements.projectId, input.projectId), eq(machineMonthlyStatements.period, input.period))).orderBy(desc(machineMonthlyStatements.updatedAt));
  }),

  /** 单台机械详情的月度快照和当期逐日收支分析；仅以原始日作业、成本、维保和柴油凭证聚合。 */
  getMachineAnalysis: protectedProcedure.input(z.object({ machineId: z.number().int().positive(), projectId: z.number().int().positive(), period: settlementPeriodSchema })).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    const { db, machine } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const range = getMonthRange(input.period);
    const [monthlyStatements, dailyOperations, costRows, maintenanceRows, refuelRows] = await Promise.all([
      db.select().from(machineMonthlyStatements).where(and(eq(machineMonthlyStatements.machineId, input.machineId), eq(machineMonthlyStatements.projectId, input.projectId))).orderBy(desc(machineMonthlyStatements.period)),
      db.select().from(machineDailyOperations).where(and(eq(machineDailyOperations.machineId, input.machineId), eq(machineDailyOperations.projectId, input.projectId), gte(machineDailyOperations.occurredOn, range.start), lt(machineDailyOperations.occurredOn, range.endExclusive))).orderBy(desc(machineDailyOperations.occurredOn)),
      db.select().from(machineCostRecords).where(and(eq(machineCostRecords.machineId, input.machineId), eq(machineCostRecords.projectId, input.projectId), ne(machineCostRecords.status, "void"), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive))),
      db.select().from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.assetType, "machine"), eq(assetMaintenanceRecords.assetId, input.machineId), eq(assetMaintenanceRecords.projectId, input.projectId), ne(assetMaintenanceRecords.status, "void"), gte(assetMaintenanceRecords.occurredAt, range.start), lt(assetMaintenanceRecords.occurredAt, range.endExclusive))),
      db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.assetType, "machine"), eq(dieselRefuelRecords.machineId, input.machineId), eq(dieselRefuelRecords.projectId, input.projectId), ne(dieselRefuelRecords.status, "void"), gte(dieselRefuelRecords.refueledAt, range.start), lt(dieselRefuelRecords.refueledAt, range.endExclusive))),
    ]);
    const dayKey = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
    type DailyAggregate = { date: string; operation: (typeof dailyOperations)[number] | null; repairAmount: number; maintenanceAmount: number; fuelLiters: number; fuelAmount: number; otherExpenseAmount: number; sourceCounts: { cost: number; maintenance: number; refuel: number } };
    const days = new Map<string, DailyAggregate>();
    const ensureDay = (date: string) => {
      const existing = days.get(date);
      if (existing) return existing;
      const created: DailyAggregate = { date, operation: null, repairAmount: 0, maintenanceAmount: 0, fuelLiters: 0, fuelAmount: 0, otherExpenseAmount: 0, sourceCounts: { cost: 0, maintenance: 0, refuel: 0 } };
      days.set(date, created);
      return created;
    };
    dailyOperations.forEach(row => { const target = ensureDay(dayKey(row.occurredOn)); target.operation = row; });
    costRows.forEach(row => {
      const target = ensureDay(dayKey(row.occurredAt));
      target.sourceCounts.cost += 1;
      if (row.costType === "repair") target.repairAmount += Number(row.amount);
      else if (row.costType !== "fuel") target.otherExpenseAmount += Number(row.amount);
      else {
        target.fuelLiters += Number(row.quantity);
        target.fuelAmount += Number(row.amount);
      }
    });
    maintenanceRows.forEach(row => {
      const target = ensureDay(dayKey(row.occurredAt));
      target.sourceCounts.maintenance += 1;
      if (row.costCategory === "repair") target.repairAmount += Number(row.amount);
      else target.maintenanceAmount += Number(row.amount);
    });
    refuelRows.forEach(row => {
      const target = ensureDay(dayKey(row.refueledAt));
      target.sourceCounts.refuel += 1;
      /** 柴油领用台账为当日油耗的优先来源，避免与历史 fuel 成本行重复累计。 */
      target.fuelLiters = Number(row.liters);
      target.fuelAmount = Number(row.amount);
    });
    const daily = Array.from(days.values()).map(item => {
      const activeOperation = item.operation && item.operation.status !== "void" ? item.operation : null;
      const outputAmount = activeOperation ? Number(activeOperation.outputAmount) : 0;
      const driverWageAmount = activeOperation ? Number(activeOperation.driverWageAmount) : 0;
      const totalExpense = roundMoney(driverWageAmount + item.repairAmount + item.maintenanceAmount + item.fuelAmount + item.otherExpenseAmount);
      return { ...item, outputAmount, driverWageAmount, totalExpense, netIncome: roundMoney(outputAmount - totalExpense), workHours: activeOperation ? Number(activeOperation.workHours) : 0, overtimeHours: activeOperation ? Number(activeOperation.overtimeHours) : 0, operationStatus: item.operation?.status ?? null, remarks: item.operation?.remarks ?? null };
    }).sort((left, right) => right.date.localeCompare(left.date));
    return { machine: { id: machine.id, name: machine.name, code: machine.code, model: machine.model }, period: input.period, monthly: monthlyStatements.map(item => ({ ...item, totalOutput: Number(item.totalOutput), driverTotalWage: Number(item.driverTotalWage), repairAmount: Number(item.repairAmount), fuelAmount: Number(item.fuelAmount), fuelLiters: Number(item.fuelLiters), otherExpenseAmount: 0, netIncome: roundMoney(Number(item.totalOutput) - Number(item.driverTotalWage) - Number(item.repairAmount) - Number(item.fuelAmount)) })), daily };
  }),

  /** 保存单机日作业；已提交、审核或结算记录禁止直接修改。 */
  saveDailyOperation: protectedProcedure.input(machineDailyOperationInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    const { db, machine } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const [existing] = input.id
      ? await db.select().from(machineDailyOperations).where(eq(machineDailyOperations.id, input.id)).limit(1)
      : await db.select().from(machineDailyOperations).where(and(eq(machineDailyOperations.machineId, input.machineId), eq(machineDailyOperations.projectId, input.projectId), eq(machineDailyOperations.occurredOn, toBusinessDate(input.occurredOn)))).limit(1);
    if (existing && (existing.machineId !== input.machineId || existing.projectId !== input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "机械日作业记录不存在或不属于当前项目" });
    if (existing && existing.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "已提交、审核或结算的机械日作业不得直接修改" });
    const values = { projectId: input.projectId, machineId: input.machineId, occurredOn: toBusinessDate(input.occurredOn), operatorUserId: input.operatorUserId ?? machine.operatorUserId ?? null, workHours: String(roundMoney(input.workHours)), overtimeHours: String(roundMoney(input.overtimeHours)), outputAmount: String(roundMoney(input.outputAmount)), driverWageAmount: String(roundMoney(input.driverWageAmount)), remarks: input.remarks?.trim() || null };
    if (existing) await db.update(machineDailyOperations).set(values).where(eq(machineDailyOperations.id, existing.id));
    else await db.insert(machineDailyOperations).values({ ...values, status: "draft", createdBy: user.id });
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: existing ? "update_daily_operation" : "create_daily_operation", targetType: "machine_daily_operation", targetId: `${input.machineId}:${input.occurredOn}`, summary: `${existing ? "更新" : "录入"}机械日作业：${machine.name} ${input.occurredOn}，产值 ¥${roundMoney(input.outputAmount)}` });
    return { success: true };
  }),

  /** 日作业沿用机械会计状态机，审核和结算仍只允许会计或财务负责人办理。 */
  transitionDailyOperation: protectedProcedure.input(machineDailyOperationTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(machineDailyOperations).where(eq(machineDailyOperations.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械日作业不存在或不属于当前项目" });
    const allowed: Record<typeof record.status, readonly string[]> = { draft: ["submitted", "void"], submitted: ["approved", "void"], approved: ["settled", "void"], settled: [], void: [] };
    if (!allowed[record.status].includes(input.nextStatus)) throw new TRPCError({ code: "BAD_REQUEST", message: "当前机械日作业状态不允许执行该操作" });
    if (["approved", "settled"].includes(input.nextStatus) && !canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅财务负责人或会计可审核、结算机械日作业" });
    if (!["approved", "settled"].includes(input.nextStatus) && !canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权提交或作废机械日作业" });
    const result = await db.update(machineDailyOperations).set({ status: input.nextStatus }).where(and(eq(machineDailyOperations.id, input.id), eq(machineDailyOperations.status, record.status)));
    assertConditionalStatusWrite(result, "机械日作业");
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: "transition_daily_operation", targetType: "machine_daily_operation", targetId: String(input.id), summary: `机械日作业状态变更为：${input.nextStatus}` });
    return { success: true };
  }),

  /** 实时预览一行机械会计明细；只读取当前已授权项目的租赁规则、成本和维修记录，不创建或改变状态。 */
  previewMonthlyStatement: protectedProcedure.input(machineMonthlyStatementInput).query(async ({ ctx, input }) => {
    await assertMachineryAccess(ctx);
    const { db, machine } = await getScopedMachine(ctx, input.machineId, input.projectId);
    const range = getMonthRange(input.period);
    const rules = await db.select().from(machineLeaseRules).where(and(eq(machineLeaseRules.machineId, input.machineId), eq(machineLeaseRules.projectId, input.projectId), eq(machineLeaseRules.status, "active"))).orderBy(desc(machineLeaseRules.effectiveFrom));
    const rule = rules.find(item => new Date(item.effectiveFrom).getTime() < range.endExclusive.getTime() && (!item.effectiveTo || new Date(item.effectiveTo).getTime() >= range.start.getTime()));
    if (!rule) throw new TRPCError({ code: "BAD_REQUEST", message: "当前结算期间未找到生效的机械租赁/计价规则" });
    const [costRows, maintenanceRows] = await Promise.all([
      db.select().from(machineCostRecords).where(and(eq(machineCostRecords.machineId, input.machineId), eq(machineCostRecords.projectId, input.projectId), ne(machineCostRecords.status, "void"), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive))),
      db.select().from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.assetType, "machine"), eq(assetMaintenanceRecords.assetId, input.machineId), eq(assetMaintenanceRecords.projectId, input.projectId), ne(assetMaintenanceRecords.status, "void"), gte(assetMaintenanceRecords.occurredAt, range.start), lt(assetMaintenanceRecords.occurredAt, range.endExclusive))),
    ]);
    const repairAmount = costRows.filter(item => item.costType === "repair").reduce((sum, item) => sum + Number(item.amount), 0) + maintenanceRows.filter(item => item.costCategory === "repair").reduce((sum, item) => sum + Number(item.amount), 0);
    const fuelRows = costRows.filter(item => item.costType === "fuel");
    const fuelLiters = fuelRows.reduce((sum, item) => sum + Number(item.quantity), 0);
    const fuelAmount = fuelRows.reduce((sum, item) => sum + Number(item.amount), 0);
    const statement = calculateMonthlyMachineStatement({ billingType: rule.billingType, rate: Number(rule.rate), overtimeHourlyRate: Number(rule.overtimeHourlyRate), machineWorkDays: input.machineWorkDays, machineOvertimeHours: input.machineOvertimeHours, driverMonthlyWage: input.driverMonthlyWage, driverWorkDays: input.driverWorkDays, driverOvertimeHours: input.driverOvertimeHours, repairAmount, fuelLiters, fuelAmount });
    const driverUserId = input.driverUserId ?? machine.operatorUserId;
    const [driver] = driverUserId ? await db.select({ name: users.name }).from(users).where(eq(users.id, driverUserId)).limit(1) : [];
    return { machine: { id: machine.id, code: machine.code, name: machine.name, model: machine.model, ownerName: machine.ownership === "leased" ? machine.supplierName ?? "未登记出租方" : "公司自有", driverUserId, driverName: driver?.name ?? "未分配" }, rule: { billingType: rule.billingType, rate: Number(rule.rate), overtimeHourlyRate: Number(rule.overtimeHourlyRate), effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo }, statement, source: { costRecordCount: costRows.length, maintenanceRecordCount: maintenanceRows.length } };
  }),

  /** 保存或更新单台机械当期会计明细快照；非草稿快照必须经状态流转处理，避免改写已审核或已结算数据。 */
  saveMonthlyStatement: protectedProcedure.input(machineMonthlyStatementInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    const preview = await buildMachineMonthlyStatementPreview(ctx, input);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(machineMonthlyStatements).where(and(eq(machineMonthlyStatements.machineId, input.machineId), eq(machineMonthlyStatements.projectId, input.projectId), eq(machineMonthlyStatements.period, input.period))).limit(1);
    if (existing && existing.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "已提交、已审核或已结算的月度机械明细不得直接修改；请按状态流转或作废后重新建立" });
    const values = {
      projectId: input.projectId, machineId: input.machineId, period: input.period, driverUserId: preview.machine.driverUserId ?? null,
      driverNameSnapshot: preview.machine.driverName, ownerNameSnapshot: preview.machine.ownerName, machineModelSnapshot: preview.machine.model ?? null,
      leaseBillingType: preview.rule.billingType, leaseRate: String(roundMoney(preview.rule.rate)), machineOvertimeRate: String(roundMoney(preview.rule.overtimeHourlyRate > 0 ? preview.rule.overtimeHourlyRate : preview.rule.billingType === "monthly" ? preview.rule.rate / 30 / 10 : 0)),
      machineWorkDays: String(input.machineWorkDays), machineOvertimeHours: String(input.machineOvertimeHours), driverMonthlyWage: String(roundMoney(input.driverMonthlyWage)), driverWorkDays: String(input.driverWorkDays), driverOvertimeHours: String(input.driverOvertimeHours),
      machineBaseOutput: String(preview.statement.machineBaseOutput), machineOvertimeOutput: String(preview.statement.machineOvertimeOutput), totalOutput: String(preview.statement.totalOutput), driverOvertimeWage: String(preview.statement.driverOvertimeWage), driverTotalWage: String(preview.statement.driverTotalWage), repairAmount: String(preview.statement.repairAmount), fuelLiters: String(preview.statement.fuelLiters), fuelAmount: String(preview.statement.fuelAmount), deductionAmount: String(preview.statement.deductionAmount), shareBaseAmount: String(preview.statement.shareBaseAmount), machineShareAmount: String(preview.statement.machineShareAmount), signatureName: input.signatureName?.trim() || null, signedAt: input.signatureName?.trim() ? new Date() : null, remarks: input.remarks?.trim() || null,
    };
    if (existing) await db.update(machineMonthlyStatements).set(values).where(eq(machineMonthlyStatements.id, existing.id));
    else await db.insert(machineMonthlyStatements).values({ ...values, status: "draft", createdBy: user.id });
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: existing ? "update_monthly_statement" : "create_monthly_statement", targetType: "machine_monthly_statement", targetId: `${input.machineId}:${input.period}`, summary: `${existing ? "更新" : "生成"}会计机械月度明细：${preview.machine.name} ${input.period}，总产值 ¥${preview.statement.totalOutput}` });
    return { success: true, preview };
  }),

  /** 月度机械明细按草稿、提交、审核、结算、作废顺序流转；财务岗位才可审核或结算。 */
  transitionMonthlyStatement: protectedProcedure.input(machineMonthlyStatementTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(machineMonthlyStatements).where(eq(machineMonthlyStatements.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械月度明细不存在或不属于当前项目" });
    const allowed: Record<typeof record.status, readonly string[]> = { draft: ["submitted", "void"], submitted: ["approved", "void"], approved: ["void"], settled: [], void: [] };
    if (!allowed[record.status].includes(input.nextStatus)) throw new TRPCError({ code: "BAD_REQUEST", message: "当前月度机械明细状态不允许执行该操作" });
    if (input.nextStatus === "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "机械月结不得直接标记为已结算，请创建机械付款结算单并按会计审核、付款流程完成" });
    if (input.nextStatus === "approved" && !canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅财务负责人或会计可审核机械月度明细" });
    if (input.nextStatus !== "approved" && !canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权提交或作废机械月度明细" });
    const result = await db.update(machineMonthlyStatements).set({ status: input.nextStatus }).where(and(eq(machineMonthlyStatements.id, input.id), eq(machineMonthlyStatements.status, record.status)));
    assertConditionalStatusWrite(result, "机械月度明细");
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: "transition_monthly_statement", targetType: "machine_monthly_statement", targetId: String(input.id), summary: `机械月度明细状态变更为：${input.nextStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "machinery", eventCode: `machine_monthly_statement_${input.nextStatus}`, targetType: "machine_monthly_statement", targetId: String(input.id), title: `机械月度明细已${input.nextStatus}`, deepLink: "/mobile/machinery" }).catch(() => undefined);
    return { success: true };
  }),

  /** 外租机械付款结算台账；账户仅向财务岗位返回完整值，其他岗位仅可查看掩码。 */
  listPaymentSettlements: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), machineId: z.number().int().positive().optional(), status: transportSettlementStatusSchema.optional() })).query(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    let rows = await db.select().from(machinePaymentSettlements).where(eq(machinePaymentSettlements.projectId, input.projectId)).orderBy(desc(machinePaymentSettlements.createdAt));
    if (input.machineId) rows = rows.filter(item => item.machineId === input.machineId);
    if (input.status) rows = rows.filter(item => item.status === input.status);
    const [machineRows, statementRows] = await Promise.all([
      db.select({ id: machines.id, code: machines.code, name: machines.name, model: machines.model, ownership: machines.ownership, supplierName: machines.supplierName }).from(machines).where(eq(machines.projectId, input.projectId)),
      rows.length ? db.select({ id: machineMonthlyStatements.id, machineShareAmount: machineMonthlyStatements.machineShareAmount, totalOutput: machineMonthlyStatements.totalOutput, driverTotalWage: machineMonthlyStatements.driverTotalWage }).from(machineMonthlyStatements).where(inArray(machineMonthlyStatements.id, rows.map(item => item.monthlyStatementId))) : Promise.resolve([]),
    ]);
    const machineById = new Map(machineRows.map(item => [item.id, item]));
    const statementById = new Map(statementRows.map(item => [item.id, item]));
    const canReadFullAccount = canSettleFinancialRecord(roleCodes);
    if (canReadFullAccount && rows.some(item => Boolean(item.payeeAccount))) {
      await recordSensitiveDataAccess(db, { userId: user.id, projectId: input.projectId, module: "machinery", dataCategory: "full_payment_account", accessPurpose: "机械付款结算台账核对与人工转账准备", targetType: "machine_payment_settlement", targetId: input.machineId ? String(input.machineId) : null, recordCount: rows.filter(item => Boolean(item.payeeAccount)).length, result: "granted" });
    }
    return rows.map(item => ({ ...item, machine: machineById.get(item.machineId) ?? null, statement: statementById.get(item.monthlyStatementId) ?? null, payeeAccount: canReadFullAccount ? item.payeeAccount : maskPaymentAccount(item.payeeAccount), accountMasked: !canReadFullAccount }));
  }),

  /** 从已审核外租机械月结生成付款结算草稿；公司自有机械不虚构外部收款人。 */
  createPaymentSettlement: protectedProcedure.input(machinePaymentSettlementDraftInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    if (!canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权创建机械付款结算单" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [statement] = await db.select().from(machineMonthlyStatements).where(eq(machineMonthlyStatements.id, input.monthlyStatementId)).limit(1);
    if (!statement || statement.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械月结明细不存在或不属于当前项目" });
    if (!["approved", "settled"].includes(statement.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "仅已审核的机械月结明细可以创建付款结算单" });
    const { machine } = await getScopedMachine(ctx, statement.machineId, input.projectId);
    if (machine.ownership !== "leased") throw new TRPCError({ code: "BAD_REQUEST", message: "公司自有机械不生成对外付款结算单；其工资和采购费用仍按各自财务流程办理" });
    const grossPayableAmount = roundMoney(Number(statement.machineShareAmount));
    const manualDeductionAmount = roundMoney(input.manualDeductionAmount);
    const netPayableAmount = roundMoney(grossPayableAmount - manualDeductionAmount);
    if (grossPayableAmount <= 0 || netPayableAmount < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "机械应付金额必须大于等于人工扣款，请核对已审核月结明细和扣款金额" });
    const [existing] = await db.select().from(machinePaymentSettlements).where(eq(machinePaymentSettlements.monthlyStatementId, statement.id)).limit(1);
    if (existing && existing.status !== "void") throw new TRPCError({ code: "CONFLICT", message: "该机械月结已生成付款结算单，不能重复创建" });
    const settlementNo = existing?.settlementNo ?? createMachinePaymentSettlementNo(input.projectId);
    const values = { projectId: input.projectId, machineId: machine.id, monthlyStatementId: statement.id, period: statement.period, grossPayableAmount: String(grossPayableAmount), fuelCostAmount: String(roundMoney(Number(statement.fuelAmount))), repairCostAmount: String(roundMoney(Number(statement.repairAmount))), manualDeductionAmount: String(manualDeductionAmount), netPayableAmount: String(netPayableAmount), payeeName: input.payeeName.trim(), payeeAccount: input.payeeAccount?.trim() || null, paymentMethod: input.paymentMethod, paymentDate: null, paymentReference: null, remarks: input.remarks?.trim() || null, status: "draft" as const, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, paidBy: null, paidAt: null };
    await db.transaction(async tx => {
      if (existing) await tx.update(machinePaymentSettlements).set(values).where(and(eq(machinePaymentSettlements.id, existing.id), eq(machinePaymentSettlements.status, "void")));
      else await tx.insert(machinePaymentSettlements).values({ settlementNo, ...values, createdBy: user.id });
      if (statement.status === "approved") await tx.update(machineMonthlyStatements).set({ status: "settled" }).where(and(eq(machineMonthlyStatements.id, statement.id), eq(machineMonthlyStatements.status, "approved")));
    });
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: existing ? "recreate_payment_settlement" : "create_payment_settlement", targetType: "machine_payment_settlement", targetId: settlementNo, summary: `${existing ? "重新生成" : "创建"}机械付款结算单：${machine.name} ${statement.period}，净应付 ¥${netPayableAmount.toFixed(2)}` });
    return { success: true, settlementNo, netPayableAmount };
  }),

  /** 机械付款结算严格依次提交、会计审核、付款登记；付款完成后禁止作废或回退。 */
  transitionPaymentSettlement: protectedProcedure.input(machinePaymentSettlementActionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMachineryAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [settlement] = await db.select().from(machinePaymentSettlements).where(eq(machinePaymentSettlements.id, input.id)).limit(1);
    if (!settlement || settlement.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "机械付款结算单不存在或不属于当前项目" });
    if (settlement.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "该机械结算单已完成付款，依据业务规则不能作废或回退" });
    const expectedStatus = input.action === "submit" ? "draft" : input.action === "approve" ? "submitted" : input.action === "pay" ? "approved" : settlement.status;
    if (input.action === "void" && !["draft", "submitted", "approved"].includes(settlement.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "当前机械结算状态不允许作废" });
    if (["submit", "void"].includes(input.action) && !canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权提交或作废机械付款结算单" });
    if (["approve", "pay"].includes(input.action) && !canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅会计、财务负责人或系统管理员可审核与付款" });
    const nextStatus: "submitted" | "approved" | "paid" | "void" = input.action === "submit" ? "submitted" : input.action === "approve" ? "approved" : input.action === "pay" ? "paid" : "void";
    await db.transaction(async tx => {
      const values: Partial<typeof machinePaymentSettlements.$inferInsert> = input.action === "submit" ? { status: nextStatus, submittedBy: user.id, submittedAt: new Date() }
        : input.action === "approve" ? { status: nextStatus, approvedBy: user.id, approvedAt: new Date() }
          : input.action === "pay" ? { status: nextStatus, paymentDate: toBusinessDate(input.paymentDate!), paymentReference: input.paymentReference?.trim() || null, remarks: input.remarks?.trim() || settlement.remarks, paidBy: user.id, paidAt: new Date() }
            : { status: nextStatus, remarks: input.remarks?.trim() || settlement.remarks };
      const result = await tx.update(machinePaymentSettlements).set(values).where(and(eq(machinePaymentSettlements.id, settlement.id), eq(machinePaymentSettlements.status, expectedStatus)));
      assertConditionalStatusWrite(result, "机械付款结算单");
      if (input.action === "void") await tx.update(machineMonthlyStatements).set({ status: "approved" }).where(and(eq(machineMonthlyStatements.id, settlement.monthlyStatementId), eq(machineMonthlyStatements.status, "settled")));
    });
    const actionLabel = input.action === "submit" ? "提交会计审核" : input.action === "approve" ? "审核通过" : input.action === "pay" ? "完成付款登记" : "作废";
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: `payment_settlement_${input.action}`, targetType: "machine_payment_settlement", targetId: settlement.settlementNo, summary: `机械付款结算单已${actionLabel}：净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "machinery", eventCode: `machine_payment_settlement_${input.action}`, targetType: "machine_payment_settlement", targetId: settlement.settlementNo, title: "机械费用结算状态更新", content: `${settlement.settlementNo} 已${actionLabel}，净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`, deepLink: "/mobile/machinery" }).catch(() => undefined);
    return { success: true, status: nextStatus };
  }),

  /** 录入油料、维修、加班、进退场等成本；金额始终由服务端计算。 */
  saveCost: protectedProcedure.input(machineCostInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMachineryAccess(ctx);
    const { db } = await getScopedMachine(ctx, input.machineId, input.projectId);
    if (input.evidenceId) {
      const [evidence] = await db.select({ id: evidenceRecords.id, projectId: evidenceRecords.projectId }).from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1);
      if (!evidence || evidence.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "费用水印照片不存在或不属于当前项目" });
    }
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "费用发生时间无效" });
    const guideline = input.costType === "fuel" ? await getEffectiveDieselGuidelinePrice(db, input.projectId, occurredAt) : null;
    if (input.costType === "fuel" && !guideline?.price) throw new TRPCError({ code: "BAD_REQUEST", message: "当前加油发生时间未匹配到有效柴油指导价，请先在柴油管理维护指导价" });
    const appliedUnitPrice = input.costType === "fuel" ? guideline!.price!.pricePerLiter : input.unitPrice;
    const amount = roundMoney(input.quantity * appliedUnitPrice);
    const result = await db.insert(machineCostRecords).values({
      machineId: input.machineId,
      projectId: input.projectId,
      costType: input.costType,
      quantity: String(input.quantity),
      unitPrice: String(roundMoney(appliedUnitPrice)),
      amount: String(amount),
      occurredAt,
      evidenceId: input.evidenceId ?? null,
      remarks: input.remarks?.trim() || null,
      status: "draft",
    });
    const costId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
    if (input.evidenceId && costId) await db.update(evidenceRecords).set({ sourceId: `machine-cost-${costId}` }).where(and(eq(evidenceRecords.id, input.evidenceId), eq(evidenceRecords.projectId, input.projectId)));
    const priceSource = guideline?.price ? `，引用柴油指导价 ¥${guideline.price.pricePerLiter}/L（${guideline.businessDate}，规则 #${guideline.price.id}）` : "";
    await db.insert(auditLogs).values({ userId: user.id, module: "machinery", action: "create_cost", targetType: "machine_cost", targetId: String(costId || `${input.machineId}:${input.occurredAt}`), summary: `录入机械${input.costType}成本，金额由系统核算${priceSource}${input.evidenceId ? "，已关联水印照片" : ""}` });
    return { success: true, id: costId || null, amount, unitPrice: appliedUnitPrice, guidelinePriceId: guideline?.price?.id ?? null };
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
    const canViewDriverPhone = !isDriverOnly && roleCodes.some(role => ["ALL", "SUPER_ADMIN", "TRANSPORT_MANAGER", "PROJECT_MANAGER"].includes(role));
    return scopedRows.map(vehicle => {
      const { driverPhoneEncrypted, ...safeVehicle } = vehicle;
      return {
        ...safeVehicle,
        driverPhone: canViewDriverPhone && driverPhoneEncrypted ? decryptSecret(driverPhoneEncrypted) : null,
        theoreticalVolumeCubicMeters: calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)),
      };
    });
  }),

  /** 车辆统一台账按项目与期间返回真实运输、柴油、维修及租赁汇总；收入始终以运输毛收入计算，避免与柴油扣运费快照重复扣减。 */
  listVehicleSummaries: protectedProcedure.input(z.object({ projectId: z.number().int().positive().optional(), period: settlementPeriodSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    const db = await getDb();
    if (!db) return [];
    const user = requireAuthenticatedUser(ctx);
    const allowedProjects = input.projectId
      ? (await assertProjectInCurrentScope(ctx, input.projectId), [{ id: input.projectId }])
      : await listScopedProjects(ctx);
    const projectIds = allowedProjects.map(project => project.id);
    if (!projectIds.length) return [];
    const range = getMonthRange(input.period);
    const [allVehicles, allTrips, allRefuels, allMaintenance, allLeaseRules] = await Promise.all([
      db.select().from(transportVehicles),
      db.select().from(transportTrips),
      db.select().from(dieselRefuelRecords),
      db.select().from(assetMaintenanceRecords),
      db.select().from(transportVehicleLeaseRules),
    ]);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    const vehicles = allVehicles.filter(vehicle => projectIds.includes(vehicle.projectId) && (!isDriverOnly || vehicle.driverUserId === user.id));
    const activeTrips = allTrips.filter(item => item.status !== "void" && item.startAt >= range.start && item.startAt < range.endExclusive);
    const activeRefuels = allRefuels.filter(item => item.status !== "void" && item.assetType === "vehicle" && item.refueledAt >= range.start && item.refueledAt < range.endExclusive);
    const activeMaintenance = allMaintenance.filter(item => item.status !== "void" && item.assetType === "vehicle" && item.occurredAt >= range.start && item.occurredAt < range.endExclusive);
    const daysInPeriod = Math.max(1, Math.round((range.endExclusive.getTime() - range.start.getTime()) / 86_400_000));
    return vehicles.map(vehicle => {
      const trips = activeTrips.filter(item => item.vehicleId === vehicle.id && item.projectId === vehicle.projectId);
      const refuels = activeRefuels.filter(item => item.vehicleId === vehicle.id && item.projectId === vehicle.projectId);
      const maintenance = activeMaintenance.filter(item => item.assetId === vehicle.id && item.projectId === vehicle.projectId);
      const rule = vehicle.ownership === "leased" ? allLeaseRules.filter(item => item.vehicleId === vehicle.id && item.projectId === vehicle.projectId && item.status === "active").sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime()).find(item => new Date(item.effectiveFrom).getTime() < range.endExclusive.getTime() && (!item.effectiveTo || new Date(item.effectiveTo).getTime() >= range.start.getTime())) : undefined;
      const grossIncome = roundMoney(trips.reduce((sum, item) => sum + Number(item.calculatedAmount ?? 0), 0));
      const settlementIncome = roundMoney(trips.reduce((sum, item) => sum + Number(item.netSettlementAmount ?? item.calculatedAmount ?? 0), 0));
      const fuelLiters = roundMoney(refuels.reduce((sum, item) => sum + Number(item.liters), 0));
      const fuelAmount = roundMoney(refuels.reduce((sum, item) => sum + Number(item.amount), 0));
      const repairAmount = roundMoney(maintenance.filter(item => item.costCategory === "repair").reduce((sum, item) => sum + Number(item.amount), 0));
      const maintenanceAmount = roundMoney(maintenance.filter(item => item.costCategory === "maintenance").reduce((sum, item) => sum + Number(item.amount), 0));
      const leaseEstimatedAmount = rule?.billingType === "monthly" ? roundMoney(Number(rule.rate) * daysInPeriod / 30) : rule?.billingType === "daily" ? roundMoney(Number(rule.rate) * daysInPeriod) : 0;
      const totalExpense = roundMoney(fuelAmount + repairAmount + maintenanceAmount + leaseEstimatedAmount);
      return {
        vehicleId: vehicle.id,
        projectId: vehicle.projectId,
        period: input.period,
        tripCount: trips.length,
        grossIncome,
        settlementIncome,
        fuelLiters,
        fuelAmount,
        repairAmount,
        maintenanceAmount,
        leaseEstimatedAmount,
        leaseBillingType: rule?.billingType ?? null,
        leaseRate: rule ? Number(rule.rate) : null,
        leaseEstimatePending: Boolean(rule && ["hourly", "shift"].includes(rule.billingType)),
        totalExpense,
        netIncome: roundMoney(grossIncome - totalExpense),
        fuelCostRatio: grossIncome > 0 ? roundMoney(fuelAmount / grossIncome * 100) : null,
      };
    });
  }),

  /** 单车详情按日及按月分析真实趟次、柴油和维修凭证，不接受客户端提交的金额或比例。 */
  getVehicleAnalysis: protectedProcedure.input(z.object({ vehicleId: z.number().int().positive(), projectId: z.number().int().positive(), period: settlementPeriodSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const user = requireAuthenticatedUser(ctx);
    const [vehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.vehicleId)).limit(1);
    if (!vehicle || vehicle.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "车辆不存在或不属于当前项目" });
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly && vehicle.driverUserId !== user.id) throw new TRPCError({ code: "FORBIDDEN", message: "司机仅可查看本人车辆分析" });
    const range = getMonthRange(input.period);
    const [tripRows, refuelRows, maintenanceRows, leaseRules] = await Promise.all([
      db.select().from(transportTrips).where(and(eq(transportTrips.vehicleId, input.vehicleId), eq(transportTrips.projectId, input.projectId))),
      db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.vehicleId, input.vehicleId), eq(dieselRefuelRecords.assetType, "vehicle"), eq(dieselRefuelRecords.projectId, input.projectId), ne(dieselRefuelRecords.status, "void"))),
      db.select().from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.assetType, "vehicle"), eq(assetMaintenanceRecords.assetId, input.vehicleId), eq(assetMaintenanceRecords.projectId, input.projectId), ne(assetMaintenanceRecords.status, "void"))),
      vehicle.ownership === "leased" ? db.select().from(transportVehicleLeaseRules).where(and(eq(transportVehicleLeaseRules.vehicleId, input.vehicleId), eq(transportVehicleLeaseRules.projectId, input.projectId), eq(transportVehicleLeaseRules.status, "active"))) : Promise.resolve([]),
    ]);
    const dayKey = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
    type Aggregate = { date: string; tripCount: number; tripNos: string[]; distanceKm: number; grossIncome: number; settlementIncome: number; fuelLiters: number; fuelAmount: number; repairAmount: number; maintenanceAmount: number; sourceCounts: { trips: number; refuels: number; maintenance: number } };
    const dailyMap = new Map<string, Aggregate>();
    const ensure = (date: string) => {
      const current = dailyMap.get(date);
      if (current) return current;
      const next: Aggregate = { date, tripCount: 0, tripNos: [], distanceKm: 0, grossIncome: 0, settlementIncome: 0, fuelLiters: 0, fuelAmount: 0, repairAmount: 0, maintenanceAmount: 0, sourceCounts: { trips: 0, refuels: 0, maintenance: 0 } };
      dailyMap.set(date, next);
      return next;
    };
    tripRows.filter(item => item.status !== "void").forEach(item => { const row = ensure(dayKey(item.startAt)); row.tripCount += 1; row.tripNos.push(item.tripNo); row.distanceKm += Number(item.actualDistanceKm ?? 0); row.grossIncome += Number(item.calculatedAmount ?? 0); row.settlementIncome += Number(item.netSettlementAmount ?? item.calculatedAmount ?? 0); row.sourceCounts.trips += 1; });
    refuelRows.forEach(item => { const row = ensure(dayKey(item.refueledAt)); row.fuelLiters += Number(item.liters); row.fuelAmount += Number(item.amount); row.sourceCounts.refuels += 1; });
    maintenanceRows.forEach(item => { const row = ensure(dayKey(item.occurredAt)); if (item.costCategory === "repair") row.repairAmount += Number(item.amount); else row.maintenanceAmount += Number(item.amount); row.sourceCounts.maintenance += 1; });
    const decorate = (item: Aggregate) => {
      const totalExpense = roundMoney(item.fuelAmount + item.repairAmount + item.maintenanceAmount);
      return {
        ...item,
        distanceKm: roundMoney(item.distanceKm),
        grossIncome: roundMoney(item.grossIncome),
        settlementIncome: roundMoney(item.settlementIncome),
        fuelLiters: roundMoney(item.fuelLiters),
        fuelAmount: roundMoney(item.fuelAmount),
        repairAmount: roundMoney(item.repairAmount),
        maintenanceAmount: roundMoney(item.maintenanceAmount),
        totalExpense,
        netIncome: roundMoney(item.grossIncome - totalExpense),
        fuelCostRatio: item.grossIncome > 0 ? roundMoney(item.fuelAmount / item.grossIncome * 100) : null,
        fuelCostPerTrip: item.tripCount > 0 ? roundMoney(item.fuelAmount / item.tripCount) : null,
        fuelLitersPerTrip: item.tripCount > 0 ? roundMoney(item.fuelLiters / item.tripCount) : null,
        fuelCostPerKm: item.distanceKm > 0 ? roundMoney(item.fuelAmount / item.distanceKm) : null,
        fuelLitersPerKm: item.distanceKm > 0 ? roundMoney(item.fuelLiters / item.distanceKm) : null,
        grossIncomePerTrip: item.tripCount > 0 ? roundMoney(item.grossIncome / item.tripCount) : null,
        grossIncomePerKm: item.distanceKm > 0 ? roundMoney(item.grossIncome / item.distanceKm) : null,
      };
    };
    const daily = Array.from(dailyMap.values()).filter(item => item.date >= input.period && item.date < `${input.period}-32`).map(decorate).sort((left, right) => right.date.localeCompare(left.date));
    const monthlyMap = new Map<string, Aggregate>();
    Array.from(dailyMap.values()).forEach(item => { const period = item.date.slice(0, 7); const current = monthlyMap.get(period) ?? { ...item, date: period, tripNos: [], sourceCounts: { trips: 0, refuels: 0, maintenance: 0 } }; if (!monthlyMap.has(period)) { monthlyMap.set(period, current); return; } current.tripCount += item.tripCount; current.distanceKm += item.distanceKm; current.grossIncome += item.grossIncome; current.settlementIncome += item.settlementIncome; current.fuelLiters += item.fuelLiters; current.fuelAmount += item.fuelAmount; current.repairAmount += item.repairAmount; current.maintenanceAmount += item.maintenanceAmount; current.sourceCounts.trips += item.sourceCounts.trips; current.sourceCounts.refuels += item.sourceCounts.refuels; current.sourceCounts.maintenance += item.sourceCounts.maintenance; });
    const currentSummary = daily.reduce((sum, item) => ({ ...sum, tripCount: sum.tripCount + item.tripCount, distanceKm: sum.distanceKm + item.distanceKm, grossIncome: sum.grossIncome + item.grossIncome, settlementIncome: sum.settlementIncome + item.settlementIncome, fuelLiters: sum.fuelLiters + item.fuelLiters, fuelAmount: sum.fuelAmount + item.fuelAmount, repairAmount: sum.repairAmount + item.repairAmount, maintenanceAmount: sum.maintenanceAmount + item.maintenanceAmount }), { tripCount: 0, distanceKm: 0, grossIncome: 0, settlementIncome: 0, fuelLiters: 0, fuelAmount: 0, repairAmount: 0, maintenanceAmount: 0 });
    const leaseRule = leaseRules.sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime()).find(item => new Date(item.effectiveFrom).getTime() < range.endExclusive.getTime() && (!item.effectiveTo || new Date(item.effectiveTo).getTime() >= range.start.getTime()));
    const daysInPeriod = Math.max(1, Math.round((range.endExclusive.getTime() - range.start.getTime()) / 86_400_000));
    const leaseEstimatedAmount = leaseRule?.billingType === "monthly" ? roundMoney(Number(leaseRule.rate) * daysInPeriod / 30) : leaseRule?.billingType === "daily" ? roundMoney(Number(leaseRule.rate) * daysInPeriod) : 0;
    const operatingSummary = decorate({ date: input.period, tripNos: [], sourceCounts: { trips: 0, refuels: 0, maintenance: 0 }, ...currentSummary });
    const summary = { ...operatingSummary, leaseEstimatedAmount, totalExpense: roundMoney(operatingSummary.totalExpense + leaseEstimatedAmount), netIncome: roundMoney(operatingSummary.grossIncome - operatingSummary.totalExpense - leaseEstimatedAmount) };
    const cumulative = decorate(Array.from(dailyMap.values()).reduce((sum, item) => ({ ...sum, tripCount: sum.tripCount + item.tripCount, distanceKm: sum.distanceKm + item.distanceKm, grossIncome: sum.grossIncome + item.grossIncome, settlementIncome: sum.settlementIncome + item.settlementIncome, fuelLiters: sum.fuelLiters + item.fuelLiters, fuelAmount: sum.fuelAmount + item.fuelAmount, repairAmount: sum.repairAmount + item.repairAmount, maintenanceAmount: sum.maintenanceAmount + item.maintenanceAmount }), { date: "累计", tripCount: 0, tripNos: [], distanceKm: 0, grossIncome: 0, settlementIncome: 0, fuelLiters: 0, fuelAmount: 0, repairAmount: 0, maintenanceAmount: 0, sourceCounts: { trips: 0, refuels: 0, maintenance: 0 } }));
    return { vehicle: { id: vehicle.id, plateNo: vehicle.plateNo, vehicleType: vehicle.vehicleType, ownership: vehicle.ownership, ownerName: vehicle.ownerName, status: vehicle.status }, period: input.period, leaseRule: leaseRule ? { billingType: leaseRule.billingType, rate: Number(leaseRule.rate), effectiveFrom: leaseRule.effectiveFrom, effectiveTo: leaseRule.effectiveTo, estimatePending: ["hourly", "shift"].includes(leaseRule.billingType) } : null, summary, cumulative, monthly: Array.from(monthlyMap.values()).map(decorate).sort((left, right) => right.date.localeCompare(left.date)), daily };
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
    const existing = input.id ? (await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.id)).limit(1))[0] : null;
    const values = { projectId: input.projectId, plateNo: input.plateNo, ownership: input.ownership, ownerName: input.ownerName ?? null, driverUserId: null, driverName: input.driverName?.trim() || null, driverPhoneEncrypted: input.driverPhone === undefined ? existing?.driverPhoneEncrypted ?? null : input.driverPhone ? encryptSecret(input.driverPhone) : null, driverPhoneMasked: input.driverPhone === undefined ? existing?.driverPhoneMasked ?? null : input.driverPhone ? maskSecret(input.driverPhone) : null, boxLengthMeters: String(input.boxLengthMeters), boxWidthMeters: String(input.boxWidthMeters), boxHeightMeters: String(input.boxHeightMeters), loadFactor: String(input.loadFactor), payloadTons: input.payloadTons === null || input.payloadTons === undefined ? null : String(input.payloadTons), status: input.status };
    if (input.id) {
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
      managementCode: transportVehicleRfidCards.managementCode,
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
      .leftJoin(transportVehicles, eq(transportVehicleRfidCards.vehicleId, transportVehicles.id))
      .leftJoin(rfidWriterDevices, eq(transportVehicleRfidCards.writerDeviceId, rfidWriterDevices.id))
      .where(eq(transportVehicleRfidCards.projectId, input.projectId))
      .orderBy(desc(transportVehicleRfidCards.updatedAt));
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    return isDriverOnly ? rows.filter(row => row.driverUserId === user.id) : rows;
  }),

  revokeVehicleRfidCard: protectedProcedure.input(rfidCardManagementInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [card] = await db.select().from(transportVehicleRfidCards).where(and(eq(transportVehicleRfidCards.id, input.cardId), eq(transportVehicleRfidCards.projectId, input.projectId))).limit(1);
    if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "车辆射频卡不存在或不属于当前项目" });
    if (card.status === "revoked") throw new TRPCError({ code: "CONFLICT", message: "该车辆射频卡已经挂失停用" });
    await db.update(transportVehicleRfidCards).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(transportVehicleRfidCards.id, input.cardId), eq(transportVehicleRfidCards.projectId, input.projectId), ne(transportVehicleRfidCards.status, "revoked")));
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "revoke_vehicle_rfid_card", targetType: "transport_vehicle_rfid_card", targetId: String(card.id), summary: `挂失停用车辆射频卡：${card.cardUidMasked}${input.reason ? `；原因：${input.reason}` : ""}` });
    return { success: true };
  }),

  unbindVehicleRfidCard: protectedProcedure.input(rfidCardManagementInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [card] = await db.select().from(transportVehicleRfidCards).where(and(eq(transportVehicleRfidCards.id, input.cardId), eq(transportVehicleRfidCards.projectId, input.projectId))).limit(1);
    if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "车辆射频卡不存在或不属于当前项目" });
    if (!card.vehicleId) throw new TRPCError({ code: "CONFLICT", message: "该车辆射频卡已经解除绑定" });
    const [openTrip] = await db.select({ id: transportTrips.id, tripNo: transportTrips.tripNo }).from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), eq(transportTrips.vehicleId, card.vehicleId), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled"))).limit(1);
    if (openTrip) throw new TRPCError({ code: "CONFLICT", message: `车辆存在未闭环运输趟次 ${openTrip.tripNo}，完成闭环后再解除绑定` });
    await db.update(transportVehicleRfidCards).set({ vehicleId: null, status: "revoked", revokedAt: new Date() }).where(and(eq(transportVehicleRfidCards.id, input.cardId), eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.vehicleId, card.vehicleId)));
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "unbind_vehicle_rfid_card", targetType: "transport_vehicle_rfid_card", targetId: String(card.id), summary: `解除车辆射频卡绑定：${card.cardUidMasked}${input.reason ? `；原因：${input.reason}` : ""}` });
    return { success: true };
  }),

  /** 为车辆绑定射频卡时，原始 UID 与电话仅在当前请求中使用，随后以指纹/密文和掩码保存。 */
  saveVehicleRfidCard: protectedProcedure.input(rfidCardBindingInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    const { db, vehicle } = await getScopedVehicle(ctx, input.vehicleId, input.projectId, roleCodes);
    if (!vehicle.driverName?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "请先在车辆台账录入外部司机姓名，再创建射频卡绑定" });
    if (input.writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目可用的写卡器" });
    }
    const cardUidFingerprint = fingerprintRfidCardUid(input.cardUid);
    const [existing] = input.id
      ? await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, input.id)).limit(1)
      : [];
    if (input.id && (!existing || existing.projectId !== input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "车辆射频卡绑定不存在或不属于当前项目" });
    const reusingRevokedUnboundCard = Boolean(input.reuseRevokedUnboundCard && existing && existing.status === "revoked" && !existing.vehicleId && existing.cardUidFingerprint === cardUidFingerprint);
    if (input.reuseRevokedUnboundCard && !reusingRevokedUnboundCard) throw new TRPCError({ code: "BAD_REQUEST", message: "仅已挂失、已解绑且 UID 未变化的历史车辆卡可重新绑定" });
    const [existingByUid] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.cardUidFingerprint, cardUidFingerprint)).limit(1);
    if (existingByUid && existingByUid.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "该射频卡仍由其他车辆卡台账占用，请先在对应台账完成挂失和解除绑定" });
    if (reusingRevokedUnboundCard) {
      const [activeCardForVehicle] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards).where(and(
        eq(transportVehicleRfidCards.projectId, input.projectId),
        eq(transportVehicleRfidCards.vehicleId, input.vehicleId),
        eq(transportVehicleRfidCards.status, "active"),
      )).limit(1);
      if (activeCardForVehicle && activeCardForVehicle.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "所选车辆已有已启用车辆卡，请先确认原卡状态后再重新绑定" });
      const [preparedJob] = await db.select({ id: rfidCardWriteJobs.id }).from(rfidCardWriteJobs).where(and(eq(rfidCardWriteJobs.cardId, input.id!), eq(rfidCardWriteJobs.status, "prepared"))).limit(1);
      if (preparedJob) throw new TRPCError({ code: "CONFLICT", message: "该历史车辆卡仍有处理中写卡任务，请等待任务结束后再重新绑定" });
    }
    const managementCode = input.managementCode?.trim() || existing?.managementCode || createRfidCardManagementCode();
    const [existingByManagementCode] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards).where(and(
      eq(transportVehicleRfidCards.projectId, input.projectId),
      eq(transportVehicleRfidCards.managementCode, managementCode),
    )).limit(1);
    if (existingByManagementCode && existingByManagementCode.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "当前项目已使用该车辆卡管理编号，请更换编号后保存" });
    const values = {
      projectId: input.projectId,
      vehicleId: input.vehicleId,
      writerDeviceId: input.writerDeviceId ?? null,
      managementCode,
      cardUidFingerprint,
      cardUidMasked: maskRfidCardUid(input.cardUid),
      driverPhoneEncrypted: encryptSecret(input.driverPhone),
      driverPhoneMasked: maskSecret(input.driverPhone),
    };
    if (input.id) {
      // 未完成过实体写入的卡不能通过普通维护接口提前启用；已挂失卡也不能借编辑绕过换卡/补写流程恢复。
      const nextStatus = reusingRevokedUnboundCard
        ? "suspended"
        : existing.status === "revoked"
        ? "revoked"
        : existing.lastWrittenAt
          ? input.status
          : input.status === "revoked" ? "revoked" : "suspended";
      await db.update(transportVehicleRfidCards).set({
        ...values,
        status: nextStatus,
        revokedAt: nextStatus === "revoked" ? existing.revokedAt ?? new Date() : null,
        lastWrittenAt: reusingRevokedUnboundCard ? null : existing.lastWrittenAt,
        payloadVersion: reusingRevokedUnboundCard ? existing.payloadVersion + 1 : existing.payloadVersion,
      }).where(eq(transportVehicleRfidCards.id, input.id));
    } else {
      // 新卡先建立“待写入”逻辑绑定；只有实体写入、逐字节回读和服务端确认全部成功后才转为 active。
      await db.insert(transportVehicleRfidCards).values({ ...values, status: "suspended", revokedAt: null, createdBy: user.id, issuedAt: new Date() });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: reusingRevokedUnboundCard ? "rebind_revoked_unbound_vehicle_rfid_card" : input.id ? "update_vehicle_rfid_card" : "bind_vehicle_rfid_card", targetType: "transport_vehicle_rfid_card", targetId: String(input.id ?? input.vehicleId), summary: `${reusingRevokedUnboundCard ? "重新绑定已解绑" : input.id ? "维护" : "绑定"}车辆 ${vehicle.plateNo} 的射频卡（管理编号 ${managementCode}）` });
    return { success: true };
  }),

  /**
   * 手机首次发卡候选由服务端统一判定，避免前端因司机手机号脱敏、卡片查询延迟或缓存状态把
   * 实际可发卡车辆错误置灰。返回的是最小化车辆识别信息与业务原因，不返回司机手机号明文。
   */
  listMobileNfcInitialIssueCandidates: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertCanIssueMobileNfcCards(ctx, roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const [projectVehicles, projectCards] = await Promise.all([
      db.select().from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)).orderBy(desc(transportVehicles.updatedAt)),
      db.select({ vehicleId: transportVehicleRfidCards.vehicleId }).from(transportVehicleRfidCards).where(and(eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.status, "active"))),
    ]);
    const activeCardVehicleIds = new Set(projectCards.map(card => card.vehicleId));
    return projectVehicles.map(vehicle => {
      const reason = vehicle.status !== "active"
        ? "车辆已停用，请先在车辆台账启用"
        : !vehicle.driverName?.trim()
          ? "未录入司机姓名"
          : !vehicle.driverPhoneEncrypted
            ? "未录入司机手机号"
            : activeCardVehicleIds.has(vehicle.id)
              ? "已有启用车辆卡，请使用补写或换卡流程"
              : null;
      return { id: vehicle.id, plateNo: vehicle.plateNo, driverName: vehicle.driverName ?? "未录入", vehicleStatus: vehicle.status, eligible: !reason, reason };
    });
  }),

  /**
   * 全新空白 NTAG216 的手机首次发卡入口。先创建“待写入”车辆卡和受控任务，再将签名载荷
   * 返回给当前 Android Chrome 交互；只有 confirmRfidCardWrite 成功确认后卡片才变为 active。
   * 这样现场不需要先在 PC 端手工读取 UID 或建立空卡绑定。
   */
  prepareMobileNfcInitialIssue: protectedProcedure.input(mobileNfcInitialIssueInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    await assertCanIssueMobileNfcCards(ctx, roleCodes);
    const { db, vehicle } = await getScopedVehicle(ctx, input.vehicleId, input.projectId, roleCodes);
    if (vehicle.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆未启用，不能发放 NFC 车辆卡" });
    if (!vehicle.driverName?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "请先在车辆台账录入外部司机姓名，再进行手机首次发卡" });
    const driverPhone = vehicle.driverPhoneEncrypted ? decryptSecret(vehicle.driverPhoneEncrypted) : "";
    if (!driverPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "请先在车辆台账录入司机手机号，再进行手机首次发卡" });

    const [activeCard] = await db.select({ id: transportVehicleRfidCards.id }).from(transportVehicleRfidCards)
      .where(and(eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.vehicleId, vehicle.id), eq(transportVehicleRfidCards.status, "active")))
      .limit(1);
    if (activeCard) throw new TRPCError({ code: "CONFLICT", message: "该车辆已有已启用 NFC 卡；如需替换或补写，请在车辆卡台账中执行受控操作" });

    // 写入失败的首次任务保留为 suspended，下一次手机发卡复用同一逻辑卡绑定，避免产生无主卡记录。
    let [card] = await db.select().from(transportVehicleRfidCards)
      .where(and(eq(transportVehicleRfidCards.projectId, input.projectId), eq(transportVehicleRfidCards.vehicleId, vehicle.id), eq(transportVehicleRfidCards.status, "suspended"), isNull(transportVehicleRfidCards.lastWrittenAt)))
      .orderBy(desc(transportVehicleRfidCards.updatedAt))
      .limit(1);
    if (!card) {
      const logicalCardReference = `mobile-ndef:${randomUUID()}`;
      const cardUidFingerprint = fingerprintRfidCardUid(logicalCardReference);
      const cardUidMasked = `MOB-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      await db.insert(transportVehicleRfidCards).values({
        projectId: input.projectId,
        vehicleId: vehicle.id,
        writerDeviceId: null,
        cardUidFingerprint,
        cardUidMasked,
        managementCode: createRfidCardManagementCode(),
        driverPhoneEncrypted: encryptSecret(driverPhone),
        driverPhoneMasked: maskSecret(driverPhone),
        payloadVersion: 3,
        status: "suspended",
        issuedAt: new Date(),
        createdBy: user.id,
      });
      [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.cardUidFingerprint, cardUidFingerprint)).limit(1);
    }
    if (!card) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "首次发卡绑定创建失败" });

    const payload = buildTransportNfcCardPayload({ cardId: card.id, projectId: input.projectId, payloadVersion: card.payloadVersion, plateNo: vehicle.plateNo, driverName: vehicle.driverName, driverPhone });
    const payloadFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const jobNo = createRfidWriteJobNo(input.projectId);
    const nfcEntryUrl = buildTransportNfcDeepLink({ cardId: card.id, projectId: input.projectId, payloadVersion: card.payloadVersion });
    await db.insert(rfidCardWriteJobs).values({
      jobNo,
      projectId: input.projectId,
      vehicleId: vehicle.id,
      cardId: card.id,
      writerDeviceId: null,
      action: "issue",
      payloadFingerprint,
      payloadEncrypted: encryptSecret(JSON.stringify({ payload, nfcEntryUrl })),
      executionMode: "mobile_web_nfc",
      payloadVersion: card.payloadVersion,
      preparedBy: user.id,
    });
    const [job] = await db.select({ id: rfidCardWriteJobs.id }).from(rfidCardWriteJobs).where(eq(rfidCardWriteJobs.jobNo, jobNo)).limit(1);
    if (!job) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "手机首次发卡任务创建失败" });
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: "prepare_mobile_nfc_initial_issue",
      targetType: "transport_vehicle_rfid_card",
      targetId: String(card.id),
      summary: `准备手机首次发卡：车辆 ${vehicle.plateNo}，系统卡号 ${card.cardUidMasked}`,
    });
    return { success: true, jobId: job.id, jobNo, cardId: card.id, cardCode: card.cardUidMasked, payload, nfcEntryUrl, payloadFingerprint, hardwareMode: "mobile_web_nfc" as const };
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
    if (!card.vehicleId) throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆卡已解除绑定，不能进入写卡流程" });
    if (card.status === "revoked") throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆卡已挂失停用，不能再生成写卡任务" });
    if (input.action === "issue") {
      if (card.lastWrittenAt) throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆卡已完成首次写入，请使用补写流程" });
      // 兼容历史版本中已被提前标记 active、但从未完成实体写入确认的卡；新记录正常为 suspended。
      if (card.status !== "suspended" && card.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆卡状态不能执行首次写入" });
    }
    if (input.action === "rewrite" && (card.status !== "active" || !card.lastWrittenAt)) throw new TRPCError({ code: "BAD_REQUEST", message: "仅已成功写入且仍启用的车辆卡可执行补写" });
    const now = new Date();
    const preparedJobs = await db.select({
      id: rfidCardWriteJobs.id,
      jobNo: rfidCardWriteJobs.jobNo,
      executionMode: rfidCardWriteJobs.executionMode,
      bridgeTokenExpiresAt: rfidCardWriteJobs.bridgeTokenExpiresAt,
    }).from(rfidCardWriteJobs).where(and(
      eq(rfidCardWriteJobs.cardId, card.id),
      eq(rfidCardWriteJobs.status, "prepared"),
    )).limit(20);
    const expiredPcBridgeJobs = preparedJobs.filter(job => job.executionMode === "pc_bridge" && (!job.bridgeTokenExpiresAt || job.bridgeTokenExpiresAt.getTime() <= now.getTime()));
    if (expiredPcBridgeJobs.length) {
      await db.transaction(async tx => {
        for (const expiredJob of expiredPcBridgeJobs) {
          const jobWrite = await tx.update(rfidCardWriteJobs).set({ status: "cancelled", failureReason: "bridge_token_expired_before_start" }).where(and(eq(rfidCardWriteJobs.id, expiredJob.id), eq(rfidCardWriteJobs.status, "prepared")));
          if (!didConditionalWriteApply(jobWrite)) continue;
          await tx.insert(auditLogs).values({ userId: user.id, module: "transport", action: "cancel_expired_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(expiredJob.id), summary: `一次性桥接授权已到期，已安全作废车辆卡写卡任务 ${expiredJob.jobNo}` });
        }
      });
    }
    const preparedJob = preparedJobs.find(job => !expiredPcBridgeJobs.some(expiredJob => expiredJob.id === job.id));
    if (preparedJob) {
      if (!input.replacePreparedPcBridgeJob) throw new TRPCError({ code: "CONFLICT", message: "该车辆卡仍有未完成写卡任务，请确认结束原任务后重新生成" });
      await db.transaction(async tx => {
        const jobWrite = await tx.update(rfidCardWriteJobs).set({ status: "cancelled", failureReason: "administrator_replaced_before_write" }).where(and(eq(rfidCardWriteJobs.id, preparedJob.id), eq(rfidCardWriteJobs.status, "prepared")));
        assertConditionalStatusWrite(jobWrite, "原写卡任务");
        await tx.insert(auditLogs).values({ userId: user.id, module: "transport", action: "replace_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(preparedJob.id), summary: `管理员确认结束原车辆卡写卡任务 ${preparedJob.jobNo} 并重新生成任务` });
      });
    }
    const { vehicle } = await getScopedVehicle(ctx, card.vehicleId, input.projectId, roleCodes);
    if (!vehicle.driverName?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "车辆未录入外部司机姓名，不能生成写卡载荷" });
    // undefined 沿用历史写卡器；null 明确表示由手机 Web NFC 发卡，不关联 Windows 写卡器。
    const writerDeviceId = input.writerDeviceId === undefined ? card.writerDeviceId : input.writerDeviceId;
    if (writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "写卡器不存在、未启用或不属于当前项目" });
    }
    const driverPhone = card.driverPhoneEncrypted ? decryptSecret(card.driverPhoneEncrypted) : "";
    if (!driverPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "该车辆射频卡未保存司机电话，不能生成现场可核对的写卡载荷" });
    const payload = buildTransportNfcCardPayload({ cardId: card.id, projectId: input.projectId, payloadVersion: card.payloadVersion, plateNo: vehicle.plateNo, driverName: vehicle.driverName, driverPhone });
    const payloadFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const jobNo = createRfidWriteJobNo(input.projectId);
    const nfcEntryUrl = buildTransportNfcDeepLink({ cardId: card.id, projectId: input.projectId, payloadVersion: card.payloadVersion });
    const bridgeToken = input.executionMode === "pc_bridge" ? createRfidBridgeToken() : null;
    const bridgeTokenExpiresAt = bridgeToken ? new Date(Date.now() + RFID_BRIDGE_TOKEN_TTL_MS) : null;
    await db.insert(rfidCardWriteJobs).values({ jobNo, projectId: input.projectId, vehicleId: vehicle.id, cardId: card.id, writerDeviceId: writerDeviceId ?? null, action: input.action, payloadFingerprint, payloadEncrypted: encryptSecret(JSON.stringify({ payload, nfcEntryUrl })), executionMode: input.executionMode, bridgeTokenHash: bridgeToken ? hashRfidBridgeToken(bridgeToken) : null, bridgeTokenExpiresAt, payloadVersion: card.payloadVersion, preparedBy: user.id });
    const [job] = await db.select({ id: rfidCardWriteJobs.id }).from(rfidCardWriteJobs).where(eq(rfidCardWriteJobs.jobNo, jobNo)).limit(1);
    if (!job) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "写卡任务创建失败" });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "prepare_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: `准备${input.action === "rewrite" ? "补写" : input.action === "revoke" ? "挂失" : "写入"}车辆 ${vehicle.plateNo} 的射频卡任务` });
    return input.executionMode === "pc_bridge"
      ? { success: true, jobId: job.id, jobNo, payloadFingerprint, bridgeToken, bridgeTokenExpiresAt: bridgeTokenExpiresAt?.toISOString() ?? null, hardwareMode: "pc_bridge" as const }
      : { success: true, jobId: job.id, jobNo, payload, nfcEntryUrl, payloadFingerprint, hardwareMode: "manual_confirmation" as const };
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
    if (job.executionMode === "pc_bridge") throw new TRPCError({ code: "FORBIDDEN", message: "本地 uTrust 写卡任务必须由桥接完成 UID 校验与回读确认，不能手工确认成功" });
    const now = new Date();
    await db.transaction(async tx => {
      const jobWrite = await tx.update(rfidCardWriteJobs).set({ status: input.success ? "confirmed" : "failed", failureReason: input.success ? null : input.failureReason ?? "现场写卡未成功", confirmedBy: user.id, confirmedAt: now }).where(and(eq(rfidCardWriteJobs.id, job.id), eq(rfidCardWriteJobs.status, "prepared")));
      assertConditionalStatusWrite(jobWrite, "写卡任务");
      if (input.success) {
        const cardStateCondition = job.action === "issue"
          ? and(eq(transportVehicleRfidCards.id, job.cardId), isNull(transportVehicleRfidCards.lastWrittenAt), inArray(transportVehicleRfidCards.status, ["suspended", "active"]))
          : job.action === "rewrite"
            ? and(eq(transportVehicleRfidCards.id, job.cardId), eq(transportVehicleRfidCards.status, "active"), isNotNull(transportVehicleRfidCards.lastWrittenAt))
            : and(eq(transportVehicleRfidCards.id, job.cardId), ne(transportVehicleRfidCards.status, "revoked"));
        const cardWrite = await tx.update(transportVehicleRfidCards).set({ lastWrittenAt: now, status: job.action === "revoke" ? "revoked" : "active", revokedAt: job.action === "revoke" ? now : null }).where(cardStateCondition);
        assertConditionalStatusWrite(cardWrite, "车辆卡");
        if (job.writerDeviceId) await tx.update(rfidWriterDevices).set({ lastConfirmedAt: now }).where(eq(rfidWriterDevices.id, job.writerDeviceId));
      }
      await tx.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.success ? "confirm_rfid_card_write" : "fail_rfid_card_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: input.success ? "确认射频写卡任务成功" : "记录射频写卡任务失败" });
    });
    return { success: true, status: input.success ? "confirmed" as const : "failed" as const };
  }),

  /** 本地 uTrust 测试桥接只登记结果与不可逆 UID 指纹，不得将测试成功直接转化为正式车辆卡已签发。 */
  recordRfidHardwareTest: protectedProcedure.input(rfidHardwareTestInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目已启用的写卡器" });
      if (input.success) await db.update(rfidWriterDevices).set({ lastConfirmedAt: new Date() }).where(eq(rfidWriterDevices.id, input.writerDeviceId));
    }
    const fingerprintSummary = input.cardUidFingerprint ? `，测试卡指纹 ${input.cardUidFingerprint.slice(0, 10)}…` : "";
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: input.success ? "rfid_hardware_test_success" : "rfid_hardware_test_failed",
      targetType: "rfid_writer_hardware_test",
      targetId: String(input.writerDeviceId ?? input.projectId),
      summary: input.success ? `uTrust 本地测试写卡与回读通过${fingerprintSummary}` : `uTrust 本地测试写卡失败：${input.failureReason ?? "未返回原因"}`,
    });
    return { success: true };
  }),

  /** 已启用车辆卡恢复初卡前必须先受控停用，避免物理擦除成功后仍有可用卡状态。 */
  prepareRfidInitialErase: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    cardId: z.number().int().positive(),
    writerDeviceId: z.number().int().positive().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, input.cardId)).limit(1);
    if (!card || card.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "待恢复初卡的车辆卡不存在或不属于当前项目" });
    if (input.writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "所选写卡器不可用或不属于当前项目" });
    }
    const wasActive = card.status === "active";
    if (wasActive) {
      await db.update(transportVehicleRfidCards).set({ status: "suspended" }).where(and(eq(transportVehicleRfidCards.id, card.id), eq(transportVehicleRfidCards.status, "active")));
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "rfid_initial_erase_suspended",
        targetType: "transport_vehicle_rfid_card",
        targetId: String(card.id),
        summary: `已停用车辆卡 ${card.cardUidMasked}，准备擦除并恢复初卡；擦除未完成前该卡不得继续用于运输票据。`,
      });
    }
    return { success: true, cardId: card.id, wasActive, cardStatus: wasActive ? "suspended" as const : card.status };
  }),

  /**
   * 初卡擦除的服务端审计终结。物理擦除由本地桥接固定清空 NDEF 用户区完成；
   * 已启用卡须先经 prepareRfidInitialErase 停用，随后才能写入最终已停用状态。
   */
  finalizeRfidInitialErase: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    cardId: z.number().int().positive(),
    cardUidFingerprint: z.string().min(16).max(256),
    writerDeviceId: z.number().int().positive().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, input.cardId)).limit(1);
    if (!card || card.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "待恢复初卡的车辆卡不存在或不属于当前项目" });
    if (card.status === "active") throw new TRPCError({ code: "BAD_REQUEST", message: "正在使用的车辆卡须先执行停用并擦除恢复初卡" });
    if (!["revoked", "suspended"].includes(card.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "当前卡状态不允许恢复初卡，请先停止该卡的业务使用" });
    if (card.cardUidFingerprint !== input.cardUidFingerprint) throw new TRPCError({ code: "CONFLICT", message: "感应卡 UID 与所选车辆卡不一致，已拒绝登记擦除结果" });
    if (input.writerDeviceId) {
      const [writer] = await db.select().from(rfidWriterDevices).where(eq(rfidWriterDevices.id, input.writerDeviceId)).limit(1);
      if (!writer || writer.projectId !== input.projectId || writer.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "所选写卡器不可用或不属于当前项目" });
      await db.update(rfidWriterDevices).set({ lastConfirmedAt: new Date() }).where(eq(rfidWriterDevices.id, input.writerDeviceId));
    }
    const now = new Date();
    await db.update(transportVehicleRfidCards).set({ status: "revoked", revokedAt: now }).where(eq(transportVehicleRfidCards.id, card.id));
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: "rfid_initial_card_erased",
      targetType: "transport_vehicle_rfid_card",
      targetId: String(card.id),
      summary: `已擦除并恢复初卡：卡 ${card.cardUidMasked}，UID 指纹 ${input.cardUidFingerprint.slice(0, 10)}…；仅 NDEF 用户区，原绑定保持已停用。`,
    });
    return { success: true, cardId: card.id, cardStatus: "revoked" as const };
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

  /** 返回当前项目已配置的装土点、卸土点及其现场刷卡管理员。 */
  listSites: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(transportSites).where(eq(transportSites.projectId, input.projectId)).orderBy(transportSites.siteType, transportSites.name);
    const administratorIds = Array.from(new Set(rows.map(item => item.administratorUserId).filter((id): id is number => Boolean(id))));
    const administrators = administratorIds.length
      ? await Promise.all(administratorIds.map(async id => (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).limit(1))[0]))
      : [];
    const nameById = new Map(administrators.filter(Boolean).map(item => [item!.id, item!.name]));
    return rows.map(({ latitude, longitude, ...site }) => ({
      ...site,
      /** 坐标仅用于服务端围栏计算；业务端只显示中文详细地址与解析状态。 */
      addressResolved: latitude !== null && longitude !== null,
      administratorName: site.administratorUserId ? nameById.get(site.administratorUserId) ?? "未找到用户" : "未配置",
    }));
  }),

  /** 供手机端在项目范围内收敛地点维护入口；写入过程仍会重复执行相同校验。 */
  siteManagementAccess: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    return { canManage: await canManageTransportSites(ctx, roleCodes) };
  }),

  /** 现场地点和刷卡管理员只允许运输负责人、项目负责人或系统管理员维护。 */
  saveSite: protectedProcedure.input(transportSiteInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    if (!await canManageTransportSites(ctx, roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未被授予运输地点新增或编辑权限，请联系超级管理员配置运输创建/编辑权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.administratorUserId) {
      const [administrator] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.administratorUserId)).limit(1);
      if (!administrator) throw new TRPCError({ code: "BAD_REQUEST", message: "指定的现场管理员账号不存在" });
    }
    const rawAddress = input.address?.trim() || null;
    const addressResolution = rawAddress ? await resolveTransportSiteAddress(rawAddress) : null;
    const values = {
      projectId: input.projectId,
      siteType: input.siteType,
      name: input.name,
      address: addressResolution?.address ?? rawAddress,
      latitude: addressResolution ? String(addressResolution.latitude) : (input.latitude === null || input.latitude === undefined ? null : String(input.latitude)),
      longitude: addressResolution ? String(addressResolution.longitude) : (input.longitude === null || input.longitude === undefined ? null : String(input.longitude)),
      administratorUserId: input.administratorUserId ?? null,
      minimumTransitMinutes: input.siteType === "unload" ? input.minimumTransitMinutes : 10,
      minimumTransitEnabled: input.siteType === "unload" ? input.minimumTransitEnabled : true,
      unloadGeofenceMeters: input.siteType === "unload" ? input.unloadGeofenceMeters : 300,
      unloadGeofenceEnabled: input.siteType === "unload" ? input.unloadGeofenceEnabled : true,
      status: input.status,
    };
    if (input.id) {
      const [existing] = await db.select().from(transportSites).where(eq(transportSites.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "运输现场地点不存在或不属于当前项目" });
      await db.update(transportSites).set(values).where(eq(transportSites.id, input.id));
    } else {
      await db.insert(transportSites).values({ ...values, createdBy: user.id });
    }
    const unloadSafetySummary = input.siteType === "unload"
      ? `；最短 ${input.minimumTransitMinutes} 分钟（${input.minimumTransitEnabled ? "硬拦截" : "仅提示"}），定位容差 ${input.unloadGeofenceMeters} 米（${input.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}）`
      : "";
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_transport_site" : "create_transport_site", targetType: "transport_site", targetId: String(input.id ?? input.name), summary: `${input.id ? "维护" : "配置"}${input.siteType === "load" ? "装土" : "卸土"}点：${input.name}${unloadSafetySummary}` });
    const siteId = input.id ?? (await db.select({ id: transportSites.id }).from(transportSites).where(and(eq(transportSites.projectId, input.projectId), eq(transportSites.siteType, input.siteType), eq(transportSites.name, input.name))).limit(1))[0]?.id;
    return { success: true, id: siteId ?? null };
  }),

  /** 返回当前项目已登记的装卸点读卡设备，供现场终端选择并对双设备刷卡事件留痕。 */
  listReaderDevices: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: transportReaderDevices.id,
      projectId: transportReaderDevices.projectId,
      siteId: transportReaderDevices.siteId,
      deviceCode: transportReaderDevices.deviceCode,
      displayName: transportReaderDevices.displayName,
      status: transportReaderDevices.status,
      remarks: transportReaderDevices.remarks,
      siteName: transportSites.name,
      siteType: transportSites.siteType,
      administratorUserId: transportSites.administratorUserId,
    }).from(transportReaderDevices)
      .innerJoin(transportSites, eq(transportReaderDevices.siteId, transportSites.id))
      .where(eq(transportReaderDevices.projectId, input.projectId))
      .orderBy(transportSites.siteType, transportReaderDevices.displayName);
  }),

  /** 运输负责人维护装土/卸土读卡设备，设备必须归属当前项目下的启用地点。 */
  saveReaderDevice: protectedProcedure.input(transportReaderDeviceInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    assertCanManageTransportResources(roleCodes);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [site] = await db.select().from(transportSites).where(eq(transportSites.id, input.siteId)).limit(1);
    if (!site || site.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "读卡设备必须绑定当前项目下的装土点或卸土点" });
    const values = { projectId: input.projectId, siteId: input.siteId, deviceCode: input.deviceCode, displayName: input.displayName, status: input.status, remarks: input.remarks?.trim() || null };
    if (input.id) {
      const [existing] = await db.select().from(transportReaderDevices).where(eq(transportReaderDevices.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "读卡设备不存在或不属于当前项目" });
      await db.update(transportReaderDevices).set(values).where(eq(transportReaderDevices.id, input.id));
    } else {
      await db.insert(transportReaderDevices).values({ ...values, createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_transport_reader_device" : "create_transport_reader_device", targetType: "transport_reader_device", targetId: String(input.id ?? `${input.siteId}-${input.deviceCode}`), summary: `${input.id ? "维护" : "登记"}${site.siteType === "load" ? "装土" : "卸土"}读卡设备：${input.displayName}` });
    return { success: true };
  }),

  /** 读取项目路线预设；票据端仅选择启用路线，不手填公里数或运价。 */
  listRoutePresets: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(transportRoutePresets).where(eq(transportRoutePresets.projectId, input.projectId)).orderBy(desc(transportRoutePresets.isDefault), desc(transportRoutePresets.updatedAt));
  }),

  /** 特殊场景开关：首次 NFC 刷卡发票可直接结束运单，但仍按路线最短时间拦截同车连续开票。 */
  getNfcSingleScanCloseSetting: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { enabled: false, minimumIntervalPolicy: "route_minimum_transit_minutes" as const };
    return { enabled: await getTransportNfcSingleScanCloseEnabled(db, input.projectId), minimumIntervalPolicy: "route_minimum_transit_minutes" as const };
  }),

  /** 单次刷卡闭环会改变项目运输控制策略，仅超级管理员可在后台切换。 */
  setNfcSingleScanCloseSetting: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
    if (!isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可在后台维护刷卡发票运输闭环设置" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await saveTransportNfcSingleScanCloseEnabled(db, { ...input, userId: user.id });
    return { success: true, enabled: input.enabled };
  }),

  /** 运输负责人维护路线的装卸点、预设里程和有效阶梯运价。 */
  saveRoutePreset: protectedProcedure.input(transportRoutePresetInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [loadSite, unloadSite, rule] = await Promise.all([
      db.select().from(transportSites).where(eq(transportSites.id, input.loadSiteId)).limit(1).then(rows => rows[0]),
      db.select().from(transportSites).where(eq(transportSites.id, input.unloadSiteId)).limit(1).then(rows => rows[0]),
      db.select().from(freightRateRules).where(eq(freightRateRules.id, input.freightRuleId)).limit(1).then(rows => rows[0]),
    ]);
    if (!loadSite || loadSite.projectId !== input.projectId || loadSite.siteType !== "load" || loadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "路线装土点不存在或未启用" });
    if (!unloadSite || unloadSite.projectId !== input.projectId || unloadSite.siteType !== "unload" || unloadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "路线卸土点不存在或未启用" });
    if (!rule || rule.projectId !== input.projectId || rule.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "路线必须选择项目内生效的阶梯运价" });
    const [existingRoute] = input.id ? await db.select().from(transportRoutePresets).where(eq(transportRoutePresets.id, input.id)).limit(1) : [null];
    if (input.id && (!existingRoute || existingRoute.projectId !== input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "运输路线不存在或不属于当前项目" });
    const isDefaultSafety = input.minimumTransitMinutes === 10 && input.minimumTransitEnabled && input.unloadGeofenceMeters === 300 && input.unloadGeofenceEnabled;
    const changesSafety = Boolean(existingRoute && (existingRoute.minimumTransitMinutes !== input.minimumTransitMinutes || existingRoute.minimumTransitEnabled !== input.minimumTransitEnabled || existingRoute.unloadGeofenceMeters !== input.unloadGeofenceMeters || existingRoute.unloadGeofenceEnabled !== input.unloadGeofenceEnabled));
    if (!isSuperAdmin && (changesSafety || (!existingRoute && !isDefaultSafety))) throw new TRPCError({ code: "FORBIDDEN", message: "运输安全阈值仅超级管理员可在后台维护" });
    const values = { projectId: input.projectId, loadSiteId: input.loadSiteId, unloadSiteId: input.unloadSiteId, freightRuleId: input.freightRuleId, presetDistanceKm: String(input.presetDistanceKm), minimumTransitMinutes: input.minimumTransitMinutes, minimumTransitEnabled: input.minimumTransitEnabled, unloadGeofenceMeters: input.unloadGeofenceMeters, unloadGeofenceEnabled: input.unloadGeofenceEnabled, isDefault: input.isDefault, status: input.status };
    if (input.isDefault) await db.update(transportRoutePresets).set({ isDefault: false }).where(eq(transportRoutePresets.projectId, input.projectId));
    if (input.id) await db.update(transportRoutePresets).set(values).where(eq(transportRoutePresets.id, input.id));
    else await db.insert(transportRoutePresets).values({ ...values, createdBy: user.id });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: input.id ? "update_route_preset" : "create_route_preset", targetType: "transport_route_preset", targetId: String(input.id ?? `${input.loadSiteId}-${input.unloadSiteId}`), summary: `维护运输路线预设：${loadSite.name} → ${unloadSite.name}，${input.presetDistanceKm} km，最短 ${input.minimumTransitMinutes} 分钟（${input.minimumTransitEnabled ? "拦截" : "提示"}），卸土容差 ${input.unloadGeofenceMeters} 米（${input.unloadGeofenceEnabled ? "拦截" : "提示"}）` });
    return { success: true };
  }),

  listTrips: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    date: businessDateSchema.optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    dateFrom: businessDateSchema.optional(),
    dateTo: businessDateSchema.optional(),
    vehicleId: z.number().int().positive().optional(),
    status: z.enum(["draft", "submitted", "verified", "settled", "void"]).optional(),
    routePresetId: z.number().int().positive().optional(),
  }).superRefine((value, issue) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) issue.addIssue({ code: "custom", path: ["dateTo"], message: "结束日期不能早于开始日期" });
  })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const predicates = [eq(transportTrips.projectId, input.projectId)];
    if (input.date) {
      const { start, end } = getChinaBusinessDateRange(input.date);
      predicates.push(gte(transportTrips.startAt, start), lt(transportTrips.startAt, end));
    }
    let rows = await db.select().from(transportTrips).where(and(...predicates)).orderBy(desc(transportTrips.startAt));
    const { month, dateFrom, dateTo, vehicleId, status, routePresetId } = input;
    if (dateFrom) {
      const { start } = getChinaBusinessDateRange(dateFrom);
      rows = rows.filter(trip => new Date(trip.startAt) >= start);
    }
    if (dateTo) {
      const { end } = getChinaBusinessDateRange(dateTo);
      rows = rows.filter(trip => new Date(trip.startAt) < end);
    }
    if (month) rows = rows.filter(trip => formatChinaBusinessDate(new Date(trip.startAt)).slice(0, 7) === month);
    if (dateFrom) rows = rows.filter(trip => formatChinaBusinessDate(new Date(trip.startAt)) >= dateFrom);
    if (dateTo) rows = rows.filter(trip => formatChinaBusinessDate(new Date(trip.startAt)) <= dateTo);
    if (vehicleId) rows = rows.filter(trip => trip.vehicleId === vehicleId);
    if (status) rows = rows.filter(trip => trip.status === status);
    if (routePresetId) rows = rows.filter(trip => {
      const snapshot = trip.routeSnapshot && typeof trip.routeSnapshot === "object" ? trip.routeSnapshot as Record<string, unknown> : {};
      return Number(snapshot.routePresetId ?? 0) === routePresetId;
    });
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) {
      const vehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), eq(transportVehicles.driverUserId, user.id)));
      const vehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
      rows = rows.filter(trip => vehicleIds.has(trip.vehicleId));
    }
    const [vehicleRows, siteRows, eventRows, operatorRows] = await Promise.all([
      db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo, vehicleType: transportVehicles.vehicleType, ownership: transportVehicles.ownership, driverName: transportVehicles.driverName, ownerName: transportVehicles.ownerName, boxLengthMeters: transportVehicles.boxLengthMeters, boxWidthMeters: transportVehicles.boxWidthMeters, boxHeightMeters: transportVehicles.boxHeightMeters, loadFactor: transportVehicles.loadFactor }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      db.select({ id: transportSites.id, name: transportSites.name, address: transportSites.address, siteType: transportSites.siteType, administratorUserId: transportSites.administratorUserId }).from(transportSites).where(eq(transportSites.projectId, input.projectId)),
      rows.length ? db.select({ tripId: transportCardEvents.tripId, eventType: transportCardEvents.eventType, occurredAt: transportCardEvents.occurredAt, deviceId: transportCardEvents.deviceId, siteId: transportCardEvents.siteId, operatorUserId: transportCardEvents.operatorUserId, validationStatus: transportCardEvents.validationStatus, validationReason: transportCardEvents.validationReason }).from(transportCardEvents).where(eq(transportCardEvents.projectId, input.projectId)) : Promise.resolve([]),
      db.select({ id: users.id, name: users.name }).from(users),
    ]);
    const vehiclesById = new Map(vehicleRows.map(vehicle => [vehicle.id, vehicle]));
    const sitesById = new Map(siteRows.map(site => [site.id, site]));
    const operatorsById = new Map(operatorRows.map(operator => [operator.id, operator.name]));
    const tripIds = new Set(rows.map(trip => trip.id));
    const evidenceIds = Array.from(new Set(rows.flatMap(trip => {
      const snapshot = trip.routeSnapshot && typeof trip.routeSnapshot === "object" ? trip.routeSnapshot as Record<string, unknown> : {};
      const unloadEvidenceId = Number(snapshot.unloadPhotoEvidenceId ?? 0) || null;
      return [trip.evidenceId, unloadEvidenceId];
    }).filter((id): id is number => typeof id === "number" && id > 0)));
    const evidenceRows = evidenceIds.length ? await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType }).from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), inArray(evidenceRecords.id, evidenceIds))) : [];
    const evidenceById = new Map(await Promise.all(evidenceRows.map(async evidence => {
      const url = await storageGetSignedUrl(evidence.fileKey);
      return [evidence.id, { fileName: evidence.fileName, mimeType: evidence.mimeType || "application/octet-stream", url }] as const;
    })));
    const eventsByTrip = new Map<number, typeof eventRows>();
    eventRows.filter(event => tripIds.has(Number(event.tripId))).forEach(event => eventsByTrip.set(Number(event.tripId), [...(eventsByTrip.get(Number(event.tripId)) ?? []), event]));
    const siteAddress = (siteId: number | null, snapshotSite: unknown) => {
      const snapshot = snapshotSite && typeof snapshotSite === "object" ? snapshotSite as { name?: unknown; address?: unknown } : null;
      const liveSite = siteId ? sitesById.get(siteId) : undefined;
      return { name: typeof snapshot?.name === "string" ? snapshot.name : liveSite?.name ?? "未设置", address: typeof snapshot?.address === "string" && snapshot.address.trim() ? snapshot.address : liveSite?.address?.trim() || liveSite?.name || "未登记中文地址" };
    };
    /** 台账仅展示中文业务结果，内部校验枚举与上游错误细节不透传至移动端或后台表格。 */
    const cardValidationLabel = (status: unknown) => ({ accepted: "校验通过", duplicate: "重复刷卡已识别", needs_review: "待人工核验", rejected: "校验未通过" }[String(status)] ?? "待人工核验");
    const safeCardValidationReason = (reason: unknown) => {
      if (typeof reason !== "string" || !reason.trim()) return null;
      return /[A-Za-z]{3,}/.test(reason) ? "请由管理员核对车辆卡、地点与时间。" : reason.trim();
    };
    return rows.map(trip => {
      const routeSnapshot = trip.routeSnapshot && typeof trip.routeSnapshot === "object" ? trip.routeSnapshot as Record<string, unknown> : {};
      const vehicle = vehiclesById.get(trip.vehicleId);
      const events = (eventsByTrip.get(trip.id) ?? []).map(event => ({ eventType: event.eventType, occurredAt: event.occurredAt, deviceId: event.deviceId, siteName: event.siteId ? sitesById.get(event.siteId)?.name ?? "未登记地点" : "未登记地点", operatorName: event.operatorUserId ? operatorsById.get(event.operatorUserId) ?? "未登记确认人" : "未登记确认人", validationStatus: cardValidationLabel(event.validationStatus), validationReason: safeCardValidationReason(event.validationReason) }));
      const unloadEvidenceId = Number(routeSnapshot.unloadPhotoEvidenceId ?? 0) || null;
      return {
        ...trip,
        loadInvoiceEvidence: trip.evidenceId ? evidenceById.get(trip.evidenceId) ?? null : null,
        unloadSiteEvidence: unloadEvidenceId ? evidenceById.get(unloadEvidenceId) ?? null : null,
        routeSnapshot: { routePresetId: Number(routeSnapshot.routePresetId ?? 0) || null, settlementUnit: routeSnapshot.settlementUnit ?? null, invoiceMode: routeSnapshot.invoiceMode ?? trip.invoiceMode ?? "nfc_card" },
        vehiclePlateNo: vehicle?.plateNo ?? `车辆 #${trip.vehicleId}`,
        vehicle: vehicle ? { plateNo: vehicle.plateNo, vehicleType: vehicle.vehicleType, ownership: vehicle.ownership, driverName: vehicle.driverName ?? null, ownerName: vehicle.ownerName ?? null, theoreticalVolumeCubicMeters: Math.round(Number(vehicle.boxLengthMeters) * Number(vehicle.boxWidthMeters) * Number(vehicle.boxHeightMeters) * Number(vehicle.loadFactor) * 1000) / 1000 } : null,
        loadLocation: { ...siteAddress(trip.loadSiteId, routeSnapshot.loadSite), administratorName: trip.loadSiteId ? operatorsById.get(sitesById.get(trip.loadSiteId)?.administratorUserId ?? 0) ?? "未指定" : "未指定" },
        unloadLocation: { ...siteAddress(trip.unloadSiteId, routeSnapshot.unloadSite), administratorName: trip.unloadSiteId ? operatorsById.get(sitesById.get(trip.unloadSiteId)?.administratorUserId ?? 0) ?? "未指定" : "未指定" },
        loadConfirmation: { administratorName: trip.loadConfirmedBy ? operatorsById.get(trip.loadConfirmedBy) ?? "未登记确认人" : "未确认", confirmedAt: trip.loadConfirmedAt },
        unloadConfirmation: { administratorName: trip.unloadConfirmedBy ? operatorsById.get(trip.unloadConfirmedBy) ?? "未登记确认人" : "未确认", confirmedAt: trip.unloadConfirmedAt },
        cardEvents: events,
        anomalies: calculateTransportAnomalies(trip),
      };
    });
  }),

  /** 录入运输趟次并把当时运价和原始载货参数写入快照，后续修改价格规则不影响历史金额。 */
  saveTrip: protectedProcedure.input(tripInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    const { db, vehicle } = await getScopedVehicle(ctx, input.vehicleId, input.projectId, roleCodes);
    if (vehicle.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "当前车辆未处于可调度状态" });
    let loadSiteId = input.loadSiteId ?? null;
    let unloadSiteId = input.unloadSiteId ?? null;
    let freightRuleId = input.freightRuleId;
    let actualDistanceKm = input.actualDistanceKm;
    let routePreset: typeof transportRoutePresets.$inferSelect | null = null;
    const selectedRoutePresetId = input.routePresetId;
    if (selectedRoutePresetId) {
      const [preset] = await db.select().from(transportRoutePresets).where(eq(transportRoutePresets.id, selectedRoutePresetId)).limit(1);
      if (!preset || preset.projectId !== input.projectId || preset.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "选择的运输路线不存在、已停用或不属于当前项目" });
      routePreset = preset;
      loadSiteId = preset.loadSiteId;
      unloadSiteId = preset.unloadSiteId;
      freightRuleId = preset.freightRuleId;
      actualDistanceKm = Number(preset.presetDistanceKm);
    }
    if (!freightRuleId) {
      const [legacyRule] = await db.select().from(freightRateRules).where(and(eq(freightRateRules.projectId, input.projectId), eq(freightRateRules.status, "active"))).limit(1);
      if (!legacyRule) throw new TRPCError({ code: "BAD_REQUEST", message: "请先配置有效运输路线和阶梯运价" });
      freightRuleId = legacyRule.id;
    }
    if (Boolean(loadSiteId) !== Boolean(unloadSiteId)) throw new TRPCError({ code: "BAD_REQUEST", message: "运输票据必须同时选择装土点和卸土点" });
    let loadSite: typeof transportSites.$inferSelect | null = null;
    let unloadSite: typeof transportSites.$inferSelect | null = null;
    if (loadSiteId && unloadSiteId) {
      [loadSite, unloadSite] = await Promise.all([
        db.select().from(transportSites).where(eq(transportSites.id, loadSiteId)).limit(1).then(rows => rows[0] ?? null),
        db.select().from(transportSites).where(eq(transportSites.id, unloadSiteId)).limit(1).then(rows => rows[0] ?? null),
      ]);
      if (!loadSite || loadSite.projectId !== input.projectId || loadSite.siteType !== "load" || loadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "装土点不存在、已停用或不属于当前项目" });
      if (!unloadSite || unloadSite.projectId !== input.projectId || unloadSite.siteType !== "unload" || unloadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "卸土点不存在、已停用或不属于当前项目" });
    }
    if (input.evidenceId) {
      const [evidence] = await db.select().from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1);
      if (!evidence || evidence.projectId !== input.projectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "现场影像不存在或不属于当前项目，不能关联到运输趟次" });
      }
    }
    const [rule] = await db.select().from(freightRateRules).where(eq(freightRateRules.id, freightRuleId)).limit(1);
    if (!rule || rule.projectId !== input.projectId || rule.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "未找到当前项目下可用的生效运价规则" });
    if (actualDistanceKm === undefined || actualDistanceKm === null) actualDistanceKm = Number(rule.startDistanceKm);
    const tripStart = new Date(input.startAt);
    const ruleStart = new Date(rule.effectiveFrom);
    const ruleEnd = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
    if (tripStart.getTime() < ruleStart.getTime() || (ruleEnd && tripStart.getTime() > new Date(ruleEnd.getTime() + 24 * 60 * 60 * 1000).getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "趟次发生日期不在当前运价规则有效期内" });
    }
    let theoreticalVolume: number;
    try { theoreticalVolume = calculateTheoreticalVolume(Number(vehicle.boxLengthMeters), Number(vehicle.boxWidthMeters), Number(vehicle.boxHeightMeters), Number(vehicle.loadFactor)); } catch (error) { throwDomainAsBadRequest(error); }
    const volume = theoreticalVolume;
    const settlementQuantity = rule.settlementUnit === "cubic_meter" ? volume : rule.settlementUnit === "ton" ? input.weightTons : 1;
    if (!settlementQuantity || settlementQuantity <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: rule.settlementUnit === "ton" ? "按吨结算必须填写有效载重" : "请填写有效结算数量" });
    let price;
    try {
      price = calculateTieredFreightAmount({ actualDistanceKm, startDistanceKm: Number(rule.startDistanceKm), basePricePerUnit: Number(rule.basePricePerUnit), stepMeters: rule.stepMeters, stepIncreasePerUnit: Number(rule.stepIncreasePerUnit), settlementQuantity });
    } catch (error) { throwDomainAsBadRequest(error); }
    const tripNo = input.tripNo ?? createTransportTripNo(input.projectId);
    if (input.invoiceMode === "plate_photo" && !input.evidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "拍照车牌发票必须关联现场直拍的车牌水印照片" });
    if (!input.endAt) await assertNoOpenTransportTrip(db, input.projectId, vehicle.id, vehicle.plateNo);
    const routeSnapshot = { source: "mobile", routePresetId: routePreset?.id ?? null, invoiceMode: input.invoiceMode, settlementUnit: rule.settlementUnit, theoreticalVolumeCubicMeters: theoreticalVolume, billableSteps: price.billableSteps, loadSite: loadSite ? { id: loadSite.id, name: loadSite.name, address: loadSite.address, administratorUserId: loadSite.administratorUserId } : null, unloadSite: unloadSite ? { id: unloadSite.id, name: unloadSite.name, address: unloadSite.address, administratorUserId: unloadSite.administratorUserId } : null, platePhotoEvidenceId: input.invoiceMode === "plate_photo" ? input.evidenceId ?? null : null, startLatitude: input.startLatitude ?? null, startLongitude: input.startLongitude ?? null, endLatitude: input.endLatitude ?? null, endLongitude: input.endLongitude ?? null };
    try {
      await db.insert(transportTrips).values({
      tripNo,
      vehicleId: input.vehicleId,
      projectId: input.projectId,
      freightRuleId,
      invoiceMode: input.invoiceMode,
      loadSiteId,
      unloadSiteId,
      startAt: tripStart,
      endAt: input.endAt ? new Date(input.endAt) : null,
      actualDistanceKm: String(actualDistanceKm),
      volumeCubicMeters: String(volume),
      weightTons: input.weightTons === null || input.weightTons === undefined ? null : String(input.weightTons),
      calculatedUnitPrice: String(price.unitPrice),
      calculatedAmount: String(price.totalAmount),
      routeSnapshot,
      evidenceId: input.evidenceId ?? null,
        status: input.invoiceMode === "plate_photo" ? "submitted" : "draft",
        loadConfirmedAt: input.invoiceMode === "plate_photo" ? tripStart : null,
        loadConfirmedBy: input.invoiceMode === "plate_photo" ? user.id : null,
        activeVehicleTransitKey: input.endAt ? null : createActiveVehicleTransitKey(input.projectId, input.vehicleId),
      });
    } catch (error) {
      throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
    }
    if (input.evidenceId) {
      await db.update(evidenceRecords).set({ sourceId: `transport-trip-${tripNo}` }).where(and(eq(evidenceRecords.id, input.evidenceId), eq(evidenceRecords.projectId, input.projectId)));
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "create_trip", targetType: "transport_trip", targetId: tripNo, summary: `录入${input.invoiceMode === "plate_photo" ? "拍照车牌" : "NFC 刷卡"}运输票据，运费由合同规则快照计算${input.invoiceMode === "plate_photo" ? "并进入人工核验" : ""}` });
    if (input.invoiceMode === "plate_photo") {
      void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: "transport_plate_photo_ticket_submitted", targetType: "transport_trip", targetId: tripNo, title: "拍照车牌运输票据待核验", content: `车辆 ${vehicle.plateNo} 的车牌直拍运输票据已提交，待核验后进入结算流程。`, deepLink: "/mobile/transport" }).catch(() => undefined);
      notifyExternalDriverWechat({ vehicleId: vehicle.id, projectId: input.projectId, eventCode: "transport_plate_photo_ticket_submitted", targetType: "transport_trip", targetId: tripNo, title: "拍照车牌运输票据待核验", content: `车辆 ${vehicle.plateNo} 的车牌直拍运输票据已提交，待核验后进入结算流程。`, deepLink: "/mobile/transport" });
    }
    const anomalies = calculateTransportAnomalies({ evidenceId: input.evidenceId ?? null, startAt: tripStart, endAt: input.endAt ? new Date(input.endAt) : null, actualDistanceKm: String(actualDistanceKm), volumeCubicMeters: String(volume), routeSnapshot });
    return { success: true, tripNo, unitPrice: price.unitPrice, amount: price.totalAmount, theoreticalVolumeCubicMeters: theoreticalVolume, anomalies };
  }),

  /** 装土读卡成功后确认趟次起始环节；重复上报按幂等键安全返回，乱序事件留痕进入人工复核。 */
  recordLoadEvent: protectedProcedure.input(transportCardEventInput).mutation(async ({ ctx, input }) => recordTransportCardEvent(ctx, input, "load")),

  /** 卸土读卡成功后确认运输闭环，并向已绑定服务号的司机发送即时提醒。 */
  recordUnloadEvent: protectedProcedure.input(transportCardEventInput).mutation(async ({ ctx, input }) => recordTransportCardEvent(ctx, input, "unload")),

  /** 车牌直拍在装土时已开票并进入在途；卸土现场通过定位确认，不允许补写 NFC 事件。 */
  confirmPlatePhotoUnload: protectedProcedure.input(platePhotoUnloadConfirmationInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [trip] = await db.select().from(transportTrips).where(eq(transportTrips.id, input.tripId)).limit(1);
    if (!trip || trip.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "直拍运输票据不存在或不属于当前项目" });
    if (trip.invoiceMode !== "plate_photo") throw new TRPCError({ code: "BAD_REQUEST", message: "该运单应通过 NFC 刷卡闭环，不适用直拍卸土确认" });
    if (trip.status === "void" || trip.status === "settled") throw new TRPCError({ code: "BAD_REQUEST", message: "已关闭运单不能再确认卸土" });
    if (!trip.loadConfirmedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "直拍装土开票尚未完成，不能确认卸土" });
    const [unloadEvidence] = await db.select().from(evidenceRecords).where(and(eq(evidenceRecords.id, input.unloadEvidenceId), eq(evidenceRecords.projectId, input.projectId))).limit(1);
    if (!unloadEvidence || unloadEvidence.sourceType !== "transport") throw new TRPCError({ code: "BAD_REQUEST", message: "请先使用后置相机拍摄并上传卸土现场照片" });
    const occurredAt = new Date(input.occurredAt);
    const [existing] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      if (existing.tripId !== trip.id || existing.eventType !== "unload") throw new TRPCError({ code: "CONFLICT", message: "该卸土确认编号已用于其他业务事件" });
      return { success: existing.validationStatus === "accepted", duplicate: true, needsReview: existing.validationStatus === "needs_review" };
    }
    if (trip.unloadConfirmedAt) return { success: true, duplicate: true, needsReview: false };
    const routePresetId = Number((trip.routeSnapshot as { routePresetId?: number } | null)?.routePresetId || 0);
    const [[route], [unloadSite]] = await Promise.all([
      routePresetId ? db.select().from(transportRoutePresets).where(eq(transportRoutePresets.id, routePresetId)).limit(1) : Promise.resolve([]),
      trip.unloadSiteId ? db.select().from(transportSites).where(eq(transportSites.id, trip.unloadSiteId)).limit(1) : Promise.resolve([]),
    ]);
    if (!route || !unloadSite || unloadSite.projectId !== input.projectId || unloadSite.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "卸土路线或地点配置无效，不能确认卸土" });
    const elapsedMinutes = Math.max(0, Math.floor((occurredAt.getTime() - new Date(trip.loadConfirmedAt).getTime()) / 60_000));
    if (elapsedMinutes < unloadSite.minimumTransitMinutes && unloadSite.minimumTransitEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: `卸土异常：已运输 ${elapsedMinutes} 分钟，未达到最短运输时间 ${unloadSite.minimumTransitMinutes} 分钟` });
    if (unloadSite.latitude === null || unloadSite.longitude === null) throw new TRPCError({ code: "BAD_REQUEST", message: "卸土点中文详细地址尚未完成地图定位校验，不能直接确认卸土" });
    const distanceMeters = Math.round(calculateCoordinateDistanceMeters(input.latitude, input.longitude, Number(unloadSite.latitude), Number(unloadSite.longitude)));
    if (distanceMeters > unloadSite.unloadGeofenceMeters && unloadSite.unloadGeofenceEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: `未达到卸土点：当前距卸土点约 ${distanceMeters} 米，允许偏差 ${unloadSite.unloadGeofenceMeters} 米` });
    const payloadFingerprint = createHash("sha256").update(`plate-unload:${trip.id}:${input.latitude.toFixed(6)}:${input.longitude.toFixed(6)}:${input.occurredAt}`).digest("hex");
    await db.insert(transportCardEvents).values({ tripId: trip.id, vehicleId: trip.vehicleId, projectId: input.projectId, eventType: "unload", siteId: unloadSite.id, operatorUserId: user.id, source: "manual_review", idempotencyKey: input.idempotencyKey, latitude: String(input.latitude), longitude: String(input.longitude), payloadFingerprint, occurredAt, validationStatus: "accepted", validationReason: "车牌直拍票据卸土现场确认" });
    const [event] = await db.select().from(transportCardEvents).where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey)).limit(1);
    if (!event) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "卸土确认审计记录创建失败" });
    const routeSnapshot = { ...((trip.routeSnapshot as Record<string, unknown> | null) ?? {}), unloadPhotoEvidenceId: input.unloadEvidenceId, unloadPhotoConfirmedAt: occurredAt.toISOString(), unloadPhotoConfirmedBy: user.id };
    const result = await db.update(transportTrips).set({ unloadConfirmedAt: occurredAt, unloadConfirmedBy: user.id, unloadEventId: event.id, activeVehicleTransitKey: null, routeSnapshot }).where(and(eq(transportTrips.id, trip.id), isNull(transportTrips.unloadConfirmedAt), ne(transportTrips.status, "void"), ne(transportTrips.status, "settled")));
    if (!didConditionalWriteApply(result)) throw new TRPCError({ code: "CONFLICT", message: "运单已被其他卸土确认更新，请刷新后查看" });
    await db.update(evidenceRecords).set({ sourceId: `transport-unload-${trip.tripNo}` }).where(and(eq(evidenceRecords.id, input.unloadEvidenceId), eq(evidenceRecords.projectId, input.projectId)));
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "confirm_plate_photo_unload", targetType: "transport_trip", targetId: trip.tripNo, summary: `车牌直拍票据在卸土点完成现场拍照与确认：${unloadSite.name}，影像 #${input.unloadEvidenceId}` });
    const recipientUserIds = Array.from(new Set([trip.loadConfirmedBy, user.id, unloadSite.administratorUserId].filter((value): value is number => typeof value === "number" && value > 0)));
    await Promise.all(recipientUserIds.map(recipientUserId => db.insert(notificationRecords).values({ eventCode: "transport_unload_completed", idempotencyKey: `inapp:transport-plate-unload:${event.id}:${recipientUserId}`, recipientUserId, title: "运输卸土成功", content: `车辆已完成直拍票据卸土确认，运单 ${trip.tripNo} 已形成运输闭环，请进入系统查看受控详情。`, deepLink: "/mobile/transport", status: "sent", sentAt: occurredAt, channel: "in_app" }).onDuplicateKeyUpdate({ set: { status: "sent", sentAt: occurredAt } })));
    notifyExternalDriverWechat({ vehicleId: trip.vehicleId, projectId: input.projectId, eventCode: "transport_plate_photo_unload_confirmed", targetType: "transport_card_event", targetId: String(event.id), title: "运输卸土成功", content: `车辆已完成直拍票据卸土确认，运单 ${trip.tripNo} 已形成运输闭环。`, deepLink: "/mobile/transport" });
    return { success: true, duplicate: false, needsReview: false };
  }),

  /** 装土/卸土现场注册设备统一入口：首次刷卡创建在途票据，第二次刷同卡按路线卸土点闭环。 */
  scanNfcReader: protectedProcedure.input(transportNfcReaderScanInput).mutation(async ({ ctx, input }) => recordTransportNfcReaderScan(ctx, input)),

  /** 手机 NFC 触碰签名车辆卡后的受控入口；卡片 URL 不携带业务明细，由服务端实时解析并校验。 */
  scanNfcLink: protectedProcedure.input(transportNfcLinkScanInput).mutation(async ({ ctx, input }) => recordTransportNfcLinkScan(ctx, input)),

  /** 刷 NFC 卡发票页面的只读车辆预览；只返回已签发车辆和可选线路，不创建任何票据。 */
  previewMobileNfcInvoice: protectedProcedure.input(mobileNfcInvoicePreviewInput).query(async ({ ctx, input }) => resolveMobileNfcInvoice(ctx, input.token)),

  /** 管理员确认路线后，服务端以签名卡和项目台账创建运单或完成在途运单卸土闭环。 */
  confirmMobileNfcInvoice: protectedProcedure.input(mobileNfcInvoiceConfirmInput).mutation(async ({ ctx, input }) => confirmMobileNfcInvoice(ctx, input)),

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
    const approvedFuelRecords = input.nextStatus === "settled"
      ? await db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.transportTripId, input.id), eq(dieselRefuelRecords.status, "approved")))
      : [];
    const deductibleFuelRecords = approvedFuelRecords.filter(record => record.deductFromFreight);
    const fuelDeductionAmount = deductibleFuelRecords.reduce((total, record) => total + Number(record.amount), 0);
    const grossAmount = Number(trip.calculatedAmount ?? 0);
    const settlementValues = input.nextStatus === "settled"
      ? {
          status: input.nextStatus,
          activeVehicleTransitKey: null,
          fuelDeductionAmount: String(fuelDeductionAmount),
          netSettlementAmount: String(Number((grossAmount - fuelDeductionAmount).toFixed(2))),
          fuelSettlementSnapshot: {
            grossFreightAmount: grossAmount,
            fuelDeductionAmount,
            netSettlementAmount: Number((grossAmount - fuelDeductionAmount).toFixed(2)),
            records: deductibleFuelRecords.map(record => ({ id: record.id, recordNo: record.recordNo, liters: Number(record.liters), unitPrice: Number(record.appliedUnitPrice), amount: Number(record.amount), supplyMethod: record.supplyMethod })),
          },
        }
      : {
          status: input.nextStatus,
          ...(input.nextStatus === "void"
            ? { activeVehicleTransitKey: null, nfcTransitKey: null, endAt: new Date() }
            : {}),
        };
    const updateResult = await db.update(transportTrips)
      .set(settlementValues)
      .where(and(eq(transportTrips.id, input.id), eq(transportTrips.status, trip.status)));
    assertConditionalStatusWrite(updateResult, "运输趟次");
    if (input.nextStatus === "settled" && approvedFuelRecords.length) {
      await db.update(dieselRefuelRecords).set({ status: "settled" }).where(and(eq(dieselRefuelRecords.transportTripId, input.id), eq(dieselRefuelRecords.status, "approved")));
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "transition_trip", targetType: "transport_trip", targetId: String(input.id), summary: `运输趟次状态变更为：${input.nextStatus}${input.nextStatus === "settled" ? `；总运费¥${grossAmount.toFixed(2)}，油款扣减¥${fuelDeductionAmount.toFixed(2)}，净结算¥${(grossAmount - fuelDeductionAmount).toFixed(2)}` : ""}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: `transport_trip_${input.nextStatus}`, targetType: "transport_trip", targetId: String(input.id), title: `运输趟次已${input.nextStatus}`, deepLink: "/mobile/transport" }).catch(() => undefined);
    notifyExternalDriverWechat({ vehicleId: trip.vehicleId, projectId: input.projectId, eventCode: `transport_trip_${input.nextStatus}`, targetType: "transport_trip", targetId: String(input.id), title: `运输趟次已${input.nextStatus}`, content: `运单 ${trip.tripNo} 状态已更新为 ${input.nextStatus}${input.nextStatus === "settled" ? `，净结算 ¥${(grossAmount - fuelDeductionAmount).toFixed(2)}` : ""}。`, deepLink: "/mobile/transport" });
    return { success: true };
  }),

  /** 按车辆和业务日汇总真实运单，供运输日结、付款候选和服务号通知共同使用。 */
  dailyVehicleSettlementSummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { date: input.date, vehicleSummaries: [] as { vehicleId: number; plateNo: string; ownership: string; tripCount: number; totalVolumeCubicMeters: number; grossFreightAmount: number; fuelDeductionAmount: number; netPayableAmount: number; verifiedTripCount: number; settledTripCount: number; paymentStatus: string }[] };
    const start = toBusinessDate(input.date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    let trips = await db.select().from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), gte(transportTrips.startAt, start), lt(transportTrips.startAt, end), ne(transportTrips.status, "void")));
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) {
      const ownVehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), eq(transportVehicles.driverUserId, user.id)));
      const ownIds = new Set(ownVehicles.map(item => item.id));
      trips = trips.filter(item => ownIds.has(item.vehicleId));
    }
    const tripIds = trips.map(item => item.id);
    const [vehicles, items] = await Promise.all([
      db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo, ownership: transportVehicles.ownership }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      tripIds.length ? db.select({ tripId: transportVehicleSettlementItems.tripId, settlementId: transportVehicleSettlementItems.settlementId }).from(transportVehicleSettlementItems).where(inArray(transportVehicleSettlementItems.tripId, tripIds)) : Promise.resolve([]),
    ]);
    const settlementIds = Array.from(new Set(items.map(item => item.settlementId)));
    const settlements = settlementIds.length ? await db.select({ id: transportVehicleSettlements.id, status: transportVehicleSettlements.status }).from(transportVehicleSettlements).where(inArray(transportVehicleSettlements.id, settlementIds)) : [];
    const settlementStatusByTrip = new Map(items.map(item => [Number(item.tripId), settlements.find(settlement => settlement.id === item.settlementId)?.status ?? "draft"]));
    const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    const summaryByVehicle = new Map<number, { vehicleId: number; plateNo: string; ownership: string; tripCount: number; totalVolumeCubicMeters: number; grossFreightAmount: number; fuelDeductionAmount: number; netPayableAmount: number; verifiedTripCount: number; settledTripCount: number; paymentStatus: string }>();
    trips.forEach(trip => {
      const vehicle = vehicleById.get(trip.vehicleId);
      const current = summaryByVehicle.get(trip.vehicleId) ?? { vehicleId: trip.vehicleId, plateNo: vehicle?.plateNo ?? `车辆 #${trip.vehicleId}`, ownership: vehicle?.ownership ?? "owned", tripCount: 0, totalVolumeCubicMeters: 0, grossFreightAmount: 0, fuelDeductionAmount: 0, netPayableAmount: 0, verifiedTripCount: 0, settledTripCount: 0, paymentStatus: settlementStatusByTrip.get(trip.id) ?? "未生成结算" };
      current.tripCount += 1;
      current.totalVolumeCubicMeters += Number(trip.volumeCubicMeters ?? 0);
      current.grossFreightAmount += Number(trip.calculatedAmount ?? 0);
      current.fuelDeductionAmount += Number(trip.fuelDeductionAmount ?? 0);
      current.netPayableAmount += Number(trip.netSettlementAmount ?? trip.calculatedAmount ?? 0) - (trip.netSettlementAmount ? 0 : Number(trip.fuelDeductionAmount ?? 0));
      if (trip.status === "verified") current.verifiedTripCount += 1;
      if (trip.status === "settled") current.settledTripCount += 1;
      const settlementStatus = settlementStatusByTrip.get(trip.id);
      if (settlementStatus) current.paymentStatus = settlementStatus;
      summaryByVehicle.set(trip.vehicleId, current);
    });
    return { date: input.date, vehicleSummaries: Array.from(summaryByVehicle.values()).map(item => ({ ...item, totalVolumeCubicMeters: Math.round(item.totalVolumeCubicMeters * 1000) / 1000, grossFreightAmount: roundMoney(item.grossFreightAmount), fuelDeductionAmount: roundMoney(item.fuelDeductionAmount), netPayableAmount: roundMoney(item.netPayableAmount) })).sort((left, right) => right.tripCount - left.tripCount || left.plateNo.localeCompare(right.plateNo, "zh-CN")) };
  }),

  /**
   * 司机移动端的柴油扣款明细：纯司机仅可读取本人绑定车辆的有效运输扣油记录，
   * 不复用项目级柴油台账，避免暴露其他车辆、机械或未扣运费的加油数据。
   */
  driverFuelDeductionDetails: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { date: input.date, totalAmount: 0, totalLiters: 0, recordCount: 0, records: [] as Array<{ id: number; recordNo: string; vehicleId: number | null; vehiclePlateNo: string; transportTripId: number | null; refueledAt: Date; liters: number; amount: number; appliedUnitPrice: number; supplyMethod: string; stationOrSupplierName: string | null; meterReading: number | null; receiptNo: string | null; remarks: string | null; evidence: { fileName: string; mimeType: string; url: string } | null }> };
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    const vehicleRows = await db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo, driverUserId: transportVehicles.driverUserId })
      .from(transportVehicles)
      .where(eq(transportVehicles.projectId, input.projectId));
    const scopedVehicles = isDriverOnly ? vehicleRows.filter(vehicle => vehicle.driverUserId === user.id) : vehicleRows;
    const vehicleIds = scopedVehicles.map(vehicle => vehicle.id);
    if (!vehicleIds.length) return { date: input.date, totalAmount: 0, totalLiters: 0, recordCount: 0, records: [] };
    const { start, end } = getChinaBusinessDateRange(input.date);
    const rows = await db.select().from(dieselRefuelRecords).where(and(
      eq(dieselRefuelRecords.projectId, input.projectId),
      eq(dieselRefuelRecords.assetType, "vehicle"),
      eq(dieselRefuelRecords.deductFromFreight, true),
      ne(dieselRefuelRecords.status, "void"),
      inArray(dieselRefuelRecords.vehicleId, vehicleIds),
      gte(dieselRefuelRecords.refueledAt, start),
      lt(dieselRefuelRecords.refueledAt, end),
    )).orderBy(desc(dieselRefuelRecords.refueledAt));
    const vehicleById = new Map(scopedVehicles.map(vehicle => [vehicle.id, vehicle]));
    const safeRows = rows.filter(row => row.assetType === "vehicle" && row.deductFromFreight && row.status !== "void" && row.vehicleId !== null && vehicleById.has(row.vehicleId));
    const evidenceIds = Array.from(new Set(safeRows.map(row => row.evidenceId).filter((id): id is number => typeof id === "number" && id > 0)));
    const evidenceRows = evidenceIds.length
      ? await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType }).from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), inArray(evidenceRecords.id, evidenceIds), eq(evidenceRecords.status, "active")))
      : [];
    const evidenceById = new Map(await Promise.all(evidenceRows.map(async evidence => [evidence.id, { fileName: evidence.fileName, mimeType: evidence.mimeType || "application/octet-stream", url: await storageGetSignedUrl(evidence.fileKey) }] as const)));
    const records = safeRows.map(row => ({
      id: row.id,
      recordNo: row.recordNo,
      vehicleId: row.vehicleId,
      vehiclePlateNo: row.vehicleId ? vehicleById.get(row.vehicleId)?.plateNo ?? `车辆 #${row.vehicleId}` : "未登记车辆",
      transportTripId: row.transportTripId,
      refueledAt: row.refueledAt,
      liters: Number(row.liters),
      amount: Number(row.amount),
      appliedUnitPrice: Number(row.appliedUnitPrice),
      supplyMethod: row.supplyMethod,
      stationOrSupplierName: row.stationOrSupplierName,
      meterReading: row.meterReading === null ? null : Number(row.meterReading),
      receiptNo: row.receiptNo,
      remarks: row.remarks,
      evidence: row.evidenceId ? evidenceById.get(row.evidenceId) ?? null : null,
    }));
    return {
      date: input.date,
      totalAmount: roundMoney(records.reduce((total, row) => total + row.amount, 0)),
      totalLiters: Math.round(records.reduce((total, row) => total + row.liters, 0) * 1000) / 1000,
      recordCount: records.length,
      records,
    };
  }),

  /** 将某日真实车辆趟次汇总投递给已绑定的项目责任收件人；模板未发布或投递失败不影响汇总查询。 */
  sendDailyVehicleSettlementSummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    if (!canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权发送运输日结通知" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const start = toBusinessDate(input.date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const trips = await db.select({ vehicleId: transportTrips.vehicleId, calculatedAmount: transportTrips.calculatedAmount }).from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), gte(transportTrips.startAt, start), lt(transportTrips.startAt, end), ne(transportTrips.status, "void")));
    const totalAmount = roundMoney(trips.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0));
    const content = `${input.date} 共 ${trips.length} 趟，涉及 ${new Set(trips.map(trip => trip.vehicleId)).size} 台车，应付总运费 ¥${totalAmount.toFixed(2)}。请在运输管理查看按车牌日结并办理核验、结算与付款。`;
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: "transport_daily_vehicle_settlement_summary", targetType: "transport_daily_vehicle_summary", targetId: `${input.projectId}-${input.date}`, title: "渣土车运输日结汇总", content, deepLink: "/mobile/transport" }).catch(() => undefined);
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "send_daily_vehicle_settlement_summary", targetType: "transport_daily_vehicle_summary", targetId: `${input.projectId}-${input.date}`, summary: `发起 ${input.date} 渣土车运单日结通知：${trips.length} 趟，应付总额 ¥${totalAmount.toFixed(2)}` });
    return { success: true, tripCount: trips.length, totalAmount };
  }),

  /** 读取车辆结算单；完整收款账户仅向财务负责人、会计或系统管理员返回。 */
  listVehicleSettlements: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), vehicleId: z.number().int().positive().optional(), status: transportSettlementStatusSchema.optional() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    let rows = await db.select().from(transportVehicleSettlements).where(eq(transportVehicleSettlements.projectId, input.projectId)).orderBy(desc(transportVehicleSettlements.createdAt));
    if (input.vehicleId) rows = rows.filter(item => item.vehicleId === input.vehicleId);
    if (input.status) rows = rows.filter(item => item.status === input.status);
    const user = requireAuthenticatedUser(ctx);
    const isDriverOnly = roleCodes.includes("DRIVER") && !roleCodes.some(role => ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
    if (isDriverOnly) {
      const ownVehicles = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), eq(transportVehicles.driverUserId, user.id)));
      const ids = new Set(ownVehicles.map(item => item.id));
      rows = rows.filter(item => ids.has(item.vehicleId));
    }
    const [vehicles, items] = await Promise.all([
      db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo, ownership: transportVehicles.ownership, ownerName: transportVehicles.ownerName, driverName: transportVehicles.driverName }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      rows.length ? db.select({ settlementId: transportVehicleSettlementItems.settlementId, tripId: transportVehicleSettlementItems.tripId, tripNo: transportVehicleSettlementItems.tripNo }).from(transportVehicleSettlementItems).where(inArray(transportVehicleSettlementItems.settlementId, rows.map(item => item.id))) : Promise.resolve([]),
    ]);
    const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    const itemBySettlement = new Map<number, { tripId: number; tripNo: string }[]>();
    items.forEach(item => itemBySettlement.set(Number(item.settlementId), [...(itemBySettlement.get(Number(item.settlementId)) ?? []), { tripId: Number(item.tripId), tripNo: item.tripNo }]));
    const canReadFullAccount = canSettleFinancialRecord(roleCodes);
    if (canReadFullAccount && rows.some(item => Boolean(item.payeeAccount))) {
      await recordSensitiveDataAccess(db, { userId: user.id, projectId: input.projectId, module: "transport", dataCategory: "full_payment_account", accessPurpose: "渣土车按趟结算台账核对与人工转账准备", targetType: "transport_vehicle_settlement", targetId: input.vehicleId ? String(input.vehicleId) : null, recordCount: rows.filter(item => Boolean(item.payeeAccount)).length, result: "granted" });
    }
    return rows.map(item => ({ ...item, vehicle: vehicleById.get(item.vehicleId) ?? null, payeeAccount: canReadFullAccount ? item.payeeAccount : maskPaymentAccount(item.payeeAccount), accountMasked: !canReadFullAccount, itemCount: itemBySettlement.get(item.id)?.length ?? 0, tripNos: itemBySettlement.get(item.id)?.map(detail => detail.tripNo) ?? [] }));
  }),

  /** 由已核验的渣土车真实趟次生成付款前结算草稿；每趟只能进入一张结算单。 */
  createVehicleSettlement: protectedProcedure.input(transportVehicleSettlementDraftInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    if (!canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权创建渣土车费用结算单" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [vehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.vehicleId)).limit(1);
    if (!vehicle || vehicle.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "车辆不存在或不属于当前项目" });
    if (vehicle.ownership !== "trip_settlement") throw new TRPCError({ code: "BAD_REQUEST", message: "仅“渣土车（按趟结算）”可使用本费用结算台账，外租车辆请继续使用租金管理" });
    const start = toBusinessDate(input.periodStart);
    const endExclusive = new Date(toBusinessDate(input.periodEnd));
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const verifiedTrips = await db.select().from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), eq(transportTrips.vehicleId, input.vehicleId), eq(transportTrips.status, "verified"), gte(transportTrips.startAt, start), lt(transportTrips.startAt, endExclusive)));
    if (!verifiedTrips.length) throw new TRPCError({ code: "BAD_REQUEST", message: "所选期间没有可结算的已核验运输趟次" });
    const tripIds = verifiedTrips.map(item => item.id);
    const [existingItems, fuelRecords] = await Promise.all([
      db.select({ tripId: transportVehicleSettlementItems.tripId }).from(transportVehicleSettlementItems).where(inArray(transportVehicleSettlementItems.tripId, tripIds)),
      db.select().from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, input.projectId), eq(dieselRefuelRecords.vehicleId, input.vehicleId), eq(dieselRefuelRecords.status, "approved"), eq(dieselRefuelRecords.deductFromFreight, true), lt(dieselRefuelRecords.refueledAt, endExclusive))),
    ]);
    const existingTripIds = new Set(existingItems.map(item => Number(item.tripId)));
    const candidates = verifiedTrips.filter(trip => !existingTripIds.has(trip.id));
    if (!candidates.length) throw new TRPCError({ code: "CONFLICT", message: "所选期间的已核验趟次均已生成结算单，不能重复结算" });
    const fuelByTrip = new Map<number, number>();
    const eligibleFuelRecords = fuelRecords.filter(record => record.transportTripId === null || !tripIds.includes(Number(record.transportTripId)));
    const pooledFuelRecords = eligibleFuelRecords.filter(record => !record.transportTripId);
    eligibleFuelRecords.filter(record => record.transportTripId).forEach(record => fuelByTrip.set(Number(record.transportTripId), (fuelByTrip.get(Number(record.transportTripId)) ?? 0) + Number(record.amount)));
    const pooledFuelDeductionAmount = roundMoney(pooledFuelRecords.reduce((sum, record) => sum + Number(record.amount), 0));
    const grossFreightTotal = roundMoney(candidates.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0));
    const linkedFuelDeductionAmount = roundMoney(Array.from(fuelByTrip.values()).reduce((sum, amount) => sum + amount, 0));
    if (pooledFuelDeductionAmount + linkedFuelDeductionAmount > grossFreightTotal) throw new TRPCError({ code: "BAD_REQUEST", message: `该车辆待扣柴油 ¥${roundMoney(pooledFuelDeductionAmount + linkedFuelDeductionAmount).toFixed(2)} 超过本期可结算运输总额 ¥${grossFreightTotal.toFixed(2)}；请调整结算期间或先核对柴油记录` });
    let remainingPooledFuelDeduction = pooledFuelDeductionAmount;
    const details = candidates.map(trip => {
      const grossFreightAmount = roundMoney(Number(trip.calculatedAmount ?? 0));
      const linkedFuelDeduction = roundMoney(fuelByTrip.get(trip.id) ?? 0);
      const pooledFuelDeduction = roundMoney(Math.min(Math.max(0, grossFreightAmount - linkedFuelDeduction), remainingPooledFuelDeduction));
      remainingPooledFuelDeduction = roundMoney(remainingPooledFuelDeduction - pooledFuelDeduction);
      const fuelDeductionAmount = roundMoney(linkedFuelDeduction + pooledFuelDeduction);
      return { trip, tripDate: new Date(trip.startAt).toISOString().slice(0, 10), volumeCubicMeters: Number(trip.volumeCubicMeters ?? 0), grossFreightAmount, fuelDeductionAmount, netPayableAmount: roundMoney(grossFreightAmount - fuelDeductionAmount) };
    });
    const settlementNo = createTransportVehicleSettlementNo(input.projectId);
    const summary = { tripCount: details.length, totalVolumeCubicMeters: Math.round(details.reduce((sum, item) => sum + item.volumeCubicMeters, 0) * 1000) / 1000, grossFreightAmount: roundMoney(details.reduce((sum, item) => sum + item.grossFreightAmount, 0)), fuelDeductionAmount: roundMoney(details.reduce((sum, item) => sum + item.fuelDeductionAmount, 0)), netPayableAmount: roundMoney(details.reduce((sum, item) => sum + item.netPayableAmount, 0)) };
    let settlementId = 0;
    try {
      await db.transaction(async tx => {
        await tx.insert(transportVehicleSettlements).values({ settlementNo, projectId: input.projectId, vehicleId: input.vehicleId, periodStart: start, periodEnd: toBusinessDate(input.periodEnd), tripCount: summary.tripCount, totalVolumeCubicMeters: String(summary.totalVolumeCubicMeters), grossFreightAmount: String(summary.grossFreightAmount), fuelDeductionAmount: String(summary.fuelDeductionAmount), netPayableAmount: String(summary.netPayableAmount), payeeName: input.payeeName.trim(), payeeAccount: input.payeeAccount?.trim() || null, paymentMethod: input.paymentMethod, remarks: input.remarks?.trim() || null, createdBy: user.id });
        const [created] = await tx.select({ id: transportVehicleSettlements.id }).from(transportVehicleSettlements).where(eq(transportVehicleSettlements.settlementNo, settlementNo)).limit(1);
        if (!created) throw new Error("结算单写入后未找到主记录");
        settlementId = created.id;
        await tx.insert(transportVehicleSettlementItems).values(details.map(item => ({ settlementId, tripId: item.trip.id, tripNo: item.trip.tripNo, tripDate: toBusinessDate(item.tripDate), volumeCubicMeters: String(item.volumeCubicMeters), grossFreightAmount: String(item.grossFreightAmount), fuelDeductionAmount: String(item.fuelDeductionAmount), netPayableAmount: String(item.netPayableAmount) })));
        if (pooledFuelRecords.length) await tx.update(dieselRefuelRecords).set({ status: "settled" }).where(inArray(dieselRefuelRecords.id, pooledFuelRecords.map(record => record.id)));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("transport_vehicle_settlement_items_trip_unique")) throw new TRPCError({ code: "CONFLICT", message: "部分运单已被其他结算单占用，请刷新后重新生成" });
      throw error;
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: "create_vehicle_settlement", targetType: "transport_vehicle_settlement", targetId: settlementNo, summary: `生成渣土车按趟结算草稿：${vehicle.plateNo}，${input.periodStart} 至 ${input.periodEnd}，${summary.tripCount} 趟，车辆归集柴油扣款 ¥${summary.fuelDeductionAmount.toFixed(2)}，净应付 ¥${summary.netPayableAmount.toFixed(2)}` });
    return { success: true, id: settlementId, settlementNo, ...summary };
  }),

  /** 结算草稿提交、会计审核、付款登记和作废；paid 为终态，付款完成后绝不允许作废。 */
  transitionVehicleSettlement: protectedProcedure.input(transportVehicleSettlementActionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [settlement] = await db.select().from(transportVehicleSettlements).where(eq(transportVehicleSettlements.id, input.id)).limit(1);
    if (!settlement || settlement.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "渣土车结算单不存在或不属于当前项目" });
    if (settlement.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "该结算单已完成付款，依据业务规则不能作废或回退" });
    const expectedStatus = input.action === "submit" ? "draft" : input.action === "approve" ? "submitted" : input.action === "pay" ? "approved" : settlement.status;
    if (input.action === "void" && !["draft", "submitted", "approved"].includes(settlement.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "当前结算状态不允许作废" });
    if (input.action === "submit" || input.action === "void") { if (!canManageSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权提交或作废渣土车结算单" }); }
    if (input.action === "approve" || input.action === "pay") { if (!canSettleFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅会计、财务负责人或系统管理员可审核与付款" }); }
    const nextStatus: "submitted" | "approved" | "paid" | "void" = input.action === "submit" ? "submitted" : input.action === "approve" ? "approved" : input.action === "pay" ? "paid" : "void";
    const items = await db.select().from(transportVehicleSettlementItems).where(eq(transportVehicleSettlementItems.settlementId, settlement.id));
    await db.transaction(async tx => {
      const values: Partial<typeof transportVehicleSettlements.$inferInsert> = input.action === "submit" ? { status: nextStatus, submittedBy: user.id, submittedAt: new Date() }
        : input.action === "approve" ? { status: nextStatus, approvedBy: user.id, approvedAt: new Date() }
          : input.action === "pay" ? { status: nextStatus, paymentDate: toBusinessDate(input.paymentDate!), paymentReference: input.paymentReference?.trim() || null, remarks: input.remarks?.trim() || settlement.remarks, paidBy: user.id, paidAt: new Date() }
            : { status: nextStatus, remarks: input.remarks?.trim() || settlement.remarks };
      const result = await tx.update(transportVehicleSettlements).set(values).where(and(eq(transportVehicleSettlements.id, settlement.id), eq(transportVehicleSettlements.status, expectedStatus)));
      assertConditionalStatusWrite(result, "渣土车结算单");
      if (input.action === "approve") {
        for (const item of items) await tx.update(transportTrips).set({ status: "settled", fuelDeductionAmount: item.fuelDeductionAmount, netSettlementAmount: item.netPayableAmount, activeVehicleTransitKey: null }).where(and(eq(transportTrips.id, item.tripId), eq(transportTrips.status, "verified")));
      }
      if (input.action === "void") {
        if (settlement.status === "approved") for (const item of items) await tx.update(transportTrips).set({ status: "verified", fuelDeductionAmount: "0", netSettlementAmount: null }).where(and(eq(transportTrips.id, item.tripId), eq(transportTrips.status, "settled")));
        await tx.delete(transportVehicleSettlementItems).where(eq(transportVehicleSettlementItems.settlementId, settlement.id));
      }
    });
    await db.insert(auditLogs).values({ userId: user.id, module: "transport", action: `vehicle_settlement_${input.action}`, targetType: "transport_vehicle_settlement", targetId: settlement.settlementNo, summary: `渣土车结算单${input.action === "submit" ? "已提交会计审核" : input.action === "approve" ? "已审核通过" : input.action === "pay" ? `已登记付款日期 ${input.paymentDate}` : "已作废"}：净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "transport", eventCode: `transport_vehicle_settlement_${input.action}`, targetType: "transport_vehicle_settlement", targetId: settlement.settlementNo, title: "渣土车费用结算状态更新", content: `${settlement.settlementNo} 已${input.action === "submit" ? "提交会计审核" : input.action === "approve" ? "审核通过" : input.action === "pay" ? "完成付款登记" : "作废"}，净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`, deepLink: "/mobile/transport" }).catch(() => undefined);
    notifyExternalDriverWechat({ vehicleId: settlement.vehicleId, projectId: input.projectId, eventCode: `transport_vehicle_settlement_${input.action}`, targetType: "transport_vehicle_settlement", targetId: settlement.settlementNo, title: "渣土车费用结算状态更新", content: `${settlement.settlementNo} 已${input.action === "submit" ? "提交会计审核" : input.action === "approve" ? "审核通过" : input.action === "pay" ? "完成付款登记" : "作废"}，净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`, deepLink: "/mobile/transport" });
    return { success: true, status: nextStatus };
  }),

  /** 按自然日汇总趟次、方量、吨位和可结算运费，供日报与打印视图统一使用。 */
  dailySummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), date: businessDateSchema })).query(async ({ ctx, input }) => {
    const roleCodes = await assertTransportAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { tripCount: 0, nfcCardTicketCount: 0, platePhotoTicketCount: 0, submittedCount: 0, verifiedCount: 0, settledCount: 0, volumeCubicMeters: 0, weightTons: 0, amount: 0, alertTripCount: 0, alertCount: 0, vehicleSummaries: [] as { vehicleId: number; plateNo: string; ticketCount: number; nfcCardTicketCount: number; platePhotoTicketCount: number; volumeCubicMeters: number; amount: number; verifiedCount: number; pendingReviewCount: number }[] };
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
    const vehicleRows = await db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId));
    const vehiclePlates = new Map(vehicleRows.map(vehicle => [vehicle.id, vehicle.plateNo]));
    const vehicleSummaryMap = new Map<number, { vehicleId: number; plateNo: string; ticketCount: number; nfcCardTicketCount: number; platePhotoTicketCount: number; volumeCubicMeters: number; amount: number; verifiedCount: number; pendingReviewCount: number }>();
    activeRows.forEach(trip => {
      const current = vehicleSummaryMap.get(trip.vehicleId) ?? { vehicleId: trip.vehicleId, plateNo: vehiclePlates.get(trip.vehicleId) ?? `车辆 #${trip.vehicleId}`, ticketCount: 0, nfcCardTicketCount: 0, platePhotoTicketCount: 0, volumeCubicMeters: 0, amount: 0, verifiedCount: 0, pendingReviewCount: 0 };
      current.ticketCount += 1;
      if ((trip.invoiceMode ?? "nfc_card") === "plate_photo") current.platePhotoTicketCount += 1; else current.nfcCardTicketCount += 1;
      current.volumeCubicMeters += Number(trip.volumeCubicMeters ?? 0);
      current.amount += Number(trip.calculatedAmount ?? 0);
      if (["verified", "settled"].includes(trip.status)) current.verifiedCount += 1;
      if (trip.status === "submitted") current.pendingReviewCount += 1;
      vehicleSummaryMap.set(trip.vehicleId, current);
    });
    return {
      tripCount: activeRows.length,
      nfcCardTicketCount: activeRows.filter(trip => (trip.invoiceMode ?? "nfc_card") === "nfc_card").length,
      platePhotoTicketCount: activeRows.filter(trip => trip.invoiceMode === "plate_photo").length,
      submittedCount: activeRows.filter(trip => trip.status === "submitted").length,
      verifiedCount: activeRows.filter(trip => trip.status === "verified").length,
      settledCount: activeRows.filter(trip => trip.status === "settled").length,
      volumeCubicMeters: Math.round(activeRows.reduce((sum, trip) => sum + Number(trip.volumeCubicMeters ?? 0), 0) * 1000) / 1000,
      weightTons: Math.round(activeRows.reduce((sum, trip) => sum + Number(trip.weightTons ?? 0), 0) * 1000) / 1000,
      amount: roundMoney(activeRows.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0)),
      alertTripCount: anomalyMatrix.filter(items => items.length > 0).length,
      alertCount: anomalyMatrix.reduce((sum, items) => sum + items.length, 0),
      vehicleSummaries: Array.from(vehicleSummaryMap.values()).map(item => ({ ...item, volumeCubicMeters: roundMoney(item.volumeCubicMeters), amount: roundMoney(item.amount) })).sort((left, right) => right.ticketCount - left.ticketCount || left.plateNo.localeCompare(right.plateNo, "zh-CN")),
    };
  }),
});
