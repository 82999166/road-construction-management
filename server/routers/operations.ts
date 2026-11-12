import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assetMaintenanceRecords,
  auditLogs,
  dieselGuidelinePrices,
  dieselRefuelRecords,
  dailyAccountingClosures,
  evidenceRecords,
  financialRecords,
  freightRateRules,
  machineCostRecords,
  machineDailyOperations,
  machineLeaseRules,
  machineMonthlyStatements,
  machinePaymentSettlements,
  machines,
  notificationRecords,
  purchaseOrders,
  projects,
  rfidCardWriteJobs,
  rfidWriterDevices,
  settlementPaymentRecords,
  systemSettings,
  transportCardEvents,
  transportReaderDevices,
  transportRoutePresets,
  transportSites,
  transportTrips,
  transportVehicleCarryForwardOffsets,
  transportVehicleLeaseRules,
  transportVehiclePayeeAccounts,
  transportVehicleRfidCards,
  transportVehicleSettlementItems,
  transportVehicleSettlements,
  transportVehicleUsageRecords,
  transportVehicles,
  vehicleFleetProfiles,
  userProfiles,
  users,
} from "../../drizzle/schema";
import {
  assertMachineCostStatusTransition,
  assertTransportTripStatusTransition,
  calculateMachineSettlement,
  calculateTheoreticalVolume,
  calculateTieredFreightAmount,
  ConstructionDomainError,
  getBusinessStatusLabel,
  getCardValidationStatusLabel,
  getSafeCardValidationReason,
} from "../../shared/domain";
import { calculateVehicleRegistryVolume } from "../../shared/vehicleCargo";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getCurrentDataScope,
  getEffectiveRoleCodes,
  getRoleOperationPermissionDecision,
  getSuperAdminAccess,
  hasUserSpecificOperationPermission,
  requireAuthenticatedUser,
} from "../access";
import {
  canUseVehicleTripSettlement,
  projectVehicleFinance,
  vehicleFinanceDate,
  vehicleFinanceHasProject,
} from "../services/vehicleFinance";
import { assertFleetDayWritable } from "../services/vehicleManagementPolicy";
import { initialFleetProfile } from "../services/vehicleManagementCore";
import { assertVehicleDispatchable } from "../services/vehicleManagementPolicy";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { makeRequest, type GeocodingResult } from "../_core/map";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { sendOfficialAccountDriverNotification } from "../services/officialAccountDriverBinding";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../services/secretVault";
import {
  formatChinaSmsTime,
  notifyAliyunSmsSafely,
} from "../services/smsNotifier";
import {
  buildTransportNfcCardPayload,
  buildTransportNfcDeepLink,
  createTransportNfcCardPayloadContract,
  verifyTransportNfcDeepLinkToken,
} from "../services/rfidCardPayload";
import {
  createRfidBridgeToken,
  hashRfidBridgeToken,
  RFID_BRIDGE_TOKEN_TTL_MS,
} from "../services/rfidBridge";
import {
  isRfidConfirmationRecoveryEligible,
  RFID_CONFIRMATION_RECEIPT_FAILURE,
} from "../services/rfidConfirmationRecovery";
import { recordSensitiveDataAccess } from "../services/auditIntegrity";
import { storageGetSignedUrl } from "../storage";
import {
  classifyTransportSettlement,
  effectiveTransportSafety,
  getTransportReviewEligibility,
  projectTransportSafetySnapshot,
} from "../services/transportWorkspace";
import { buildTransportSettlementBasis } from "../services/transportSettlementBasis";
import { getEligibleAssetPurchaseDeductions } from "../services/transportPurchaseDeduction";
import {
  selectVehicleSettlementTrips,
  vehicleSettlementEvidenceIds,
  vehicleSettlementSelectionValidationReason,
  vehicleSettlementTripIdsMatch,
  type VehicleSettlementSelectionInput,
} from "../services/vehicleSettlementSelection";
import {
  saveResourceBinding,
  resolveResourcePerson,
} from "../services/personnelLegacyBridge";
import { chinaBusinessDate } from "../services/chinaBusinessTime";
import {
  assertNoOpenTransportTrip,
  assertVehicleMinimumNfcInvoiceInterval,
  assertVehicleMinimumUnloadOnlyScanInterval,
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
const settlementPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "结算期间格式应为 YYYY-MM");
const businessDateSchema = z.string().date("日期格式应为 YYYY-MM-DD");
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "时间必须使用 ISO 8601 格式" });
const transportSettlementPaymentMethodSchema = z.enum([
  "bank_transfer",
  "corporate_account",
  "cash",
  "wechat",
  "alipay",
  "other",
]);
const transportSettlementStatusSchema = z.enum([
  "draft",
  "submitted",
  "approved",
  "partial",
  "paid",
  "receivable",
  "offset",
  "void",
]);
const TRANSPORT_NFC_SINGLE_SCAN_CLOSE_KEY_PREFIX =
  "TRANSPORT_NFC_SINGLE_SCAN_CLOSE_PROJECT";

function getTransportNfcSingleScanCloseSettingKey(projectId: number) {
  return `${TRANSPORT_NFC_SINGLE_SCAN_CLOSE_KEY_PREFIX}:${projectId}`;
}

async function getTransportNfcSingleScanCloseEnabled(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number
) {
  const [setting] = await db
    .select({
      valueJson: systemSettings.valueJson,
      status: systemSettings.status,
    })
    .from(systemSettings)
    .where(
      eq(
        systemSettings.settingKey,
        getTransportNfcSingleScanCloseSettingKey(projectId)
      )
    )
    .limit(1);
  return setting?.status === "published" && setting.valueJson === "true";
}

async function saveTransportNfcSingleScanCloseEnabled(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: { projectId: number; enabled: boolean; userId: number }
) {
  const settingKey = getTransportNfcSingleScanCloseSettingKey(input.projectId);
  const valueJson = input.enabled ? "true" : "false";
  const valuePreview = input.enabled
    ? "开启：刷卡发票即完成整车运输闭环"
    : "关闭：仍需卸土刷卡或卸土确认完成闭环";
  const displayName = "刷卡发票即完成整车运输闭环";
  const remarks =
    "特殊运输场景使用。开启后，NFC 刷卡发票创建运单时形成特殊单次闭环，不代表实际卸土；同车重复开票最小间隔仍按卸土地点安全阈值硬拦截。";
  const [existing] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, settingKey))
    .limit(1);
  if (existing) {
    await db
      .update(systemSettings)
      .set({
        category: "运输管理",
        displayName,
        valueJson,
        valuePreview,
        isSensitive: false,
        status: "published",
        version: existing.version + 1,
        publishedAt: new Date(),
        remarks,
        updatedBy: input.userId,
      })
      .where(eq(systemSettings.id, existing.id));
  } else {
    await db.insert(systemSettings).values({
      category: "运输管理",
      settingKey,
      displayName,
      valueJson,
      valuePreview,
      isSensitive: false,
      status: "published",
      version: 1,
      publishedAt: new Date(),
      remarks,
      updatedBy: input.userId,
    });
  }
  await db.insert(auditLogs).values({
    userId: input.userId,
    module: "transport",
    action: "set_nfc_single_scan_close",
    targetType: "system_setting",
    targetId: settingKey,
    summary: input.enabled
      ? "开启刷卡发票即完成整车运输闭环"
      : "关闭刷卡发票即完成整车运输闭环，恢复卸土闭环要求",
  });
}

/** 业务人员维护中文详细地址；服务端仅为围栏计算解析并保存内部坐标，不向页面返回。 */
async function resolveTransportSiteAddress(address: string) {
  try {
    const result = await makeRequest<GeocodingResult>(
      "/maps/api/geocode/json",
      { address, language: "zh-CN", region: "cn" }
    );
    const first = result.results?.[0];
    if (result.status !== "OK" || !first)
      throw new Error(result.status || "ZERO_RESULTS");
    return {
      address: first.formatted_address,
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
    };
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "未能定位该中文详细地址，请补充省、市、区县、道路/桩号或地标后重试",
    });
  }
}

/** 外租资源保存时必须同时记录可结算的租金、计费方式与租期。 */
const assetLeaseTermsInput = z
  .object({
    billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
    rate: z.number().gt(0, "租金必须大于 0").max(999999999999.99),
    effectiveFrom: businessDateSchema,
    effectiveTo: businessDateSchema.nullable().optional(),
  })
  .refine(
    value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "租赁截止日期不得早于起租日期",
      path: ["effectiveTo"],
    }
  );

/** 机械台账写入输入。项目不可为空，避免无归属设备绕开数据范围控制。 */
const machineInput = z
  .object({
    id: z.number().int().positive().optional(),
    projectId: z.number().int().positive(),
    operatorUserId: z.number().int().positive().nullable().optional(),
    operatorPersonId: z.number().int().positive().nullable().optional(),
    ownerUserId: z.number().int().positive().nullable().optional(),
    driverName: z.string().trim().max(128).nullable().optional(),
    driverPhone: z
      .string()
      .trim()
      .regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效驾驶员联系电话")
      .nullable()
      .optional(),
    code: z.string().trim().min(2, "请填写机械编号").max(64),
    name: z.string().trim().min(2, "请填写机械名称").max(128),
    model: z.string().trim().max(128).nullable().optional(),
    ownership: z.enum(["owned", "leased"]),
    supplierName: z.string().trim().max(200).nullable().optional(),
    plateOrAssetNo: z.string().trim().max(64).nullable().optional(),
    fuelTankCapacityLiters: z.number().gt(0).max(99999).nullable().optional(),
    status: z.enum(["idle", "working", "repairing", "offsite", "retired"]),
    leaseTerms: assetLeaseTermsInput.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.ownership !== "leased") return;
    if (!value.supplierName?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["supplierName"],
        message: "外租机械必须填写出租方",
      });
    if (!value.leaseTerms)
      ctx.addIssue({
        code: "custom",
        path: ["leaseTerms"],
        message: "外租机械必须填写租金、计费方式和租赁起止时间",
      });
  });

/** 机械合同计价规则由后台录入，所有金额最终仅在服务端参与核算。 */
const machineLeaseRuleInput = z
  .object({
    id: z.number().int().positive().optional(),
    machineId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
    rate: z.number().min(0).max(999999999999.99),
    overtimeHourlyRate: z.number().min(0).max(999999999999.99).default(0),
    effectiveFrom: businessDateSchema,
    effectiveTo: businessDateSchema.nullable().optional(),
    status: z.enum(["active", "disabled"]),
  })
  .refine(
    value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "计价规则截止日期不得早于生效日期",
      path: ["effectiveTo"],
    }
  );

/** 机械成本金额通过数量乘单价服务端计算，客户端不允许直接写入应结金额。 */
const machineCostInput = z.object({
  machineId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  costType: z.enum(["fuel", "repair", "overtime", "mobilization", "other"]),
  costName: z.string().trim().min(1, "请填写费用名称").max(128),
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

/** 单台机械日作业保存台班、加班和司机快照；金额统一由服务端核算。 */
const machineDailyOperationInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  machineId: z.number().int().positive(),
  occurredOn: businessDateSchema,
  operatorUserId: z.number().int().positive().nullable().optional(),
  shiftCount: z.number().min(0).max(31),
  shiftRate: z.number().min(0).max(999999999999.99),
  workHours: z.number().min(0).max(24),
  overtimeHours: z.number().min(0).max(24),
  overtimeHourlyRate: z.number().min(0).max(999999999999.99),
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
  driverPersonId: z.number().int().positive().nullable().optional(),
  plateNo: z
    .string()
    .trim()
    .min(4, "请填写车牌号")
    .max(32)
    .transform(value => value.toUpperCase()),
  ownership: z.enum(["owned", "leased", "trip_settlement"]).default("owned"),
  ownerName: z.string().trim().max(128).nullable().optional(),
  driverUserId: z.number().int().positive().nullable().optional(),
  driverName: z.string().trim().max(128).nullable().optional(),
  driverPhone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机手机号")
    .nullable()
    .optional(),
  boxLengthMeters: z.number().gt(0).max(100),
  boxWidthMeters: z.number().gt(0).max(20),
  boxHeightMeters: z.number().gt(0).max(20),
  loadFactor: z.number().gt(0).max(1.5).default(1),
  payloadTons: z.number().gt(0).max(9999).nullable().optional(),
  status: z.enum(["active", "suspended", "disabled"]),
});

/** 阶梯运价规则。每 500 米的步长可按合同调整，基础价格按结算单位而非趟次硬编码。 */
const freightRuleInput = z
  .object({
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
  })
  .refine(
    value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "运价规则截止日期不得早于生效日期",
      path: ["effectiveTo"],
    }
  );

/** 趟次录入只接收原始里程与载货参数，单价和金额必须由规则快照在服务端计算。 */
const tripInput = z
  .object({
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
  })
  .refine(
    value =>
      !value.endAt ||
      new Date(value.endAt).getTime() >= new Date(value.startAt).getTime(),
    {
      message: "结束时间不得早于开始时间",
      path: ["endAt"],
    }
  );

/** 读卡设备只上传不可逆卡片指纹；服务端以幂等键和载荷摘要识别重传或冲突重放。 */
const transportCardEventInput = z.object({
  tripId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  siteId: z.number().int().positive().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  deviceId: z.string().trim().min(1).max(128).optional(),
  cardFingerprint: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "卡片标识必须是 SHA-256 指纹")
    .optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

/** 任一发票方式进入在途后，卸土现场都可通过后置相机和当前位置完成受控闭环。 */
const platePhotoUnloadConfirmationInput = z.object({
  tripId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  unloadEvidenceId: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

/** 现场读卡设备只提交已派生的卡片指纹；服务端根据设备绑定地点决定本次是装土发车还是卸土闭环。 */
const transportNfcReaderScanInput = z.object({
  projectId: z.number().int().positive(),
  readerDeviceCode: z
    .string()
    .trim()
    .min(2)
    .max(128)
    .transform(value => value.toUpperCase()),
  idempotencyKey: z.string().trim().min(8).max(160),
  cardFingerprint: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "卡片标识必须是 SHA-256 指纹"),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});

const transportNfcLinkScanInput = z.object({
  token: z.string().trim().min(12).max(1024),
  readerDeviceCode: z
    .string()
    .trim()
    .min(2)
    .max(128)
    .transform(value => value.toUpperCase()),
  idempotencyKey: z.string().trim().min(8).max(160),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: isoDateTimeSchema,
});
const mobileNfcInvoicePreviewInput = z.object({
  token: z.string().trim().min(12).max(1024),
});
const mobileNfcInvoiceConfirmInput = mobileNfcInvoicePreviewInput.extend({
  routePresetId: z.number().int().positive().optional(),
  expectedUnloadTripId: z.number().int().positive().optional(),
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
  minimumTransitMinutes: z
    .number()
    .int()
    .min(1, "最短运输时间至少 1 分钟")
    .max(1440, "最短运输时间不能超过 24 小时")
    .optional(),
  minimumTransitEnabled: z.boolean().optional(),
  unloadGeofenceMeters: z
    .number()
    .int()
    .min(30, "卸土点定位容差至少 30 米")
    .max(5000, "卸土点定位容差不能超过 5000 米")
    .optional(),
  unloadGeofenceEnabled: z.boolean().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

/** 装卸点读卡设备须登记到具体地点；设备编号由现场终端稳定保存，用于双设备刷卡事件审计。 */
const transportReaderDeviceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  siteId: z.number().int().positive(),
  deviceCode: z
    .string()
    .trim()
    .min(2, "请填写读卡设备编号")
    .max(128)
    .transform(value => value.toUpperCase()),
  displayName: z.string().trim().min(2, "请填写读卡设备名称").max(128),
  status: z.enum(["active", "disabled", "maintenance"]).default("active"),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 项目路线将装卸点、预设公里数与生效的每方阶梯运价绑定，发票端不得手工覆盖。 */
const transportRoutePresetInput = z
  .object({
    id: z.number().int().positive().optional(),
    projectId: z.number().int().positive(),
    loadSiteId: z.number().int().positive(),
    unloadSiteId: z.number().int().positive(),
    freightRuleId: z.number().int().positive(),
    presetDistanceKm: z.number().gt(0).max(9999),
    minimumTransitMinutes: z
      .number()
      .int()
      .min(1, "最短运输时间至少 1 分钟")
      .max(1440, "最短运输时间不能超过 24 小时")
      .default(10),
    minimumTransitEnabled: z.boolean().default(true),
    unloadGeofenceMeters: z
      .number()
      .int()
      .min(30, "卸土点定位容差至少 30 米")
      .max(5000, "卸土点定位容差不能超过 5000 米")
      .default(300),
    unloadGeofenceEnabled: z.boolean().default(true),
    unloadOnlyCloseEnabled: z.boolean().default(false),
    isDefault: z.boolean().default(false),
    status: z.enum(["active", "disabled"]),
  })
  .refine(value => value.loadSiteId !== value.unloadSiteId, {
    message: "装土点和卸土点不能相同",
    path: ["unloadSiteId"],
  });

const vehicleSettlementSelectionFields = {
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  periodStart: businessDateSchema,
  periodEnd: businessDateSchema,
  selectionMode: z.enum(["day", "period", "trip_count"]).optional(),
  tripCount: z.number().int().min(1).max(1000).optional(),
};
const transportVehicleSettlementSelectionInput = z
  .object({
    ...vehicleSettlementSelectionFields,
    selectionMode: z.enum(["day", "period", "trip_count"]),
  })
  .superRefine((value, issue) => {
    const reason = vehicleSettlementSelectionValidationReason(value);
    if (reason) issue.addIssue({ code: "custom", message: reason });
  });

/** Read persisted eligibility facts in batches; locking reads are only used by creation inside its original scope lock. */
async function readVehicleSettlementSelection(
  db: SettlementQueryClient,
  input: VehicleSettlementSelectionInput,
  locking = false
) {
  const { start } = getChinaBusinessDateRange(input.periodStart);
  const { end } = getChinaBusinessDateRange(input.periodEnd);
  const tripQuery = db
    .select()
    .from(transportTrips)
    .where(
      and(
        eq(transportTrips.projectId, input.projectId),
        eq(transportTrips.vehicleId, input.vehicleId),
        eq(transportTrips.status, "verified"),
        gte(transportTrips.startAt, start),
        lt(transportTrips.startAt, end)
      )
    );
  const trips = await (locking ? tripQuery.for("update") : tripQuery);
  if (!trips.length)
    return selectVehicleSettlementTrips(input, trips, {
      occupiedTripIds: [],
      events: [],
      evidence: [],
    });
  const tripIds = trips.map(trip => trip.id);
  const evidenceIds = vehicleSettlementEvidenceIds(trips);
  const occupiedQuery = db
    .select({ tripId: transportVehicleSettlementItems.tripId })
    .from(transportVehicleSettlementItems)
    .where(inArray(transportVehicleSettlementItems.tripId, tripIds));
  const eventQuery = db
    .select()
    .from(transportCardEvents)
    .where(
      and(
        eq(transportCardEvents.projectId, input.projectId),
        inArray(transportCardEvents.tripId, tripIds)
      )
    );
  const evidenceQuery = evidenceIds.length
    ? db
        .select()
        .from(evidenceRecords)
        .where(
          and(
            eq(evidenceRecords.projectId, input.projectId),
            eq(evidenceRecords.sourceType, "transport"),
            eq(evidenceRecords.status, "active"),
            inArray(evidenceRecords.id, evidenceIds)
          )
        )
    : null;
  const [occupied, events, evidence] = await Promise.all([
    locking ? occupiedQuery.for("update") : occupiedQuery,
    locking ? eventQuery.for("update") : eventQuery,
    evidenceQuery
      ? locking
        ? evidenceQuery.for("update")
        : evidenceQuery
      : [],
  ]);
  return selectVehicleSettlementTrips(input, trips, {
    occupiedTripIds: occupied.map(item => item.tripId),
    events,
    evidence,
  });
}

/** 合并已核验渣土车运单，金额只能由服务端快照汇总，浏览器不能传入金额。 */
const transportVehicleSettlementDraftInput = z
  .object({
    ...vehicleSettlementSelectionFields,
    payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
    payeeAccount: z.string().trim().max(160).nullable().optional(),
    paymentMethod:
      transportSettlementPaymentMethodSchema.default("bank_transfer"),
    remarks: z.string().trim().max(500).nullable().optional(),
    tripIds: z.array(z.number().int().positive()).min(1).max(1000).optional(),
    legacyTripIds: z.array(z.number().int().positive()).max(1000).default([]),
    legacyConfirmation: z.string().trim().min(4).max(500).optional(),
  })
  .superRefine((value, issue) => {
    const selectionReason = vehicleSettlementSelectionValidationReason(value);
    if (selectionReason)
      issue.addIssue({ code: "custom", message: selectionReason });
    if (value.tripIds && new Set(value.tripIds).size !== value.tripIds.length)
      issue.addIssue({
        code: "custom",
        path: ["tripIds"],
        message: "运单 ID 不得重复",
      });
    if (new Set(value.legacyTripIds).size !== value.legacyTripIds.length)
      issue.addIssue({
        code: "custom",
        path: ["legacyTripIds"],
        message: "历史运单 ID 不得重复",
      });
    if (value.selectionMode && value.legacyTripIds.length)
      issue.addIssue({
        code: "custom",
        path: ["legacyTripIds"],
        message: "合并选择模式不纳入历史已结算运单，请使用财务逐单历史核对流程",
      });
    if (value.legacyTripIds.length && !value.legacyConfirmation)
      issue.addIssue({
        code: "custom",
        path: ["legacyConfirmation"],
        message: "历史未关联结算运单须逐单确认并填写核对依据；不得视为已付款",
      });
    if (value.periodEnd < value.periodStart)
      issue.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "结束日期不能早于开始日期",
      });
    if (
      ["bank_transfer", "corporate_account", "wechat", "alipay"].includes(
        value.paymentMethod
      ) &&
      !value.payeeAccount?.trim()
    )
      issue.addIssue({
        code: "custom",
        path: ["payeeAccount"],
        message: "该收款方式必须填写收款账户或收款账号",
      });
  });

/** 车辆收款资料可设置一个默认项；账号按用户明确要求保存，但只在受权限保护的付款场景显示。 */
const transportVehiclePayeeAccountInput = z
  .object({
    id: z.number().int().positive().optional(),
    projectId: z.number().int().positive(),
    vehicleId: z.number().int().positive(),
    payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
    paymentMethod: transportSettlementPaymentMethodSchema,
    accountName: z.string().trim().max(128).nullable().optional(),
    accountNo: z.string().trim().max(160).nullable().optional(),
    isDefault: z.boolean().default(false),
    status: z.enum(["active", "disabled"]).default("active"),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (
      ["bank_transfer", "corporate_account", "wechat", "alipay"].includes(
        value.paymentMethod
      ) &&
      !value.accountNo?.trim()
    ) {
      issue.addIssue({
        code: "custom",
        path: ["accountNo"],
        message: "银行卡、对公、微信或支付宝方式必须填写收款账号",
      });
    }
  });

/** 非按趟车辆的日租、小时租、台班使用依据；已经进入结算单的记录不允许直接修改或作废。 */
const transportVehicleUsageRecordInput = z.object({
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  usageDate: businessDateSchema,
  usageType: z.enum(["daily", "hourly", "shift"]),
  quantity: z.number().gt(0, "使用数量必须大于 0").max(999999.99),
  description: z.string().trim().min(2, "请填写使用部位或作业说明").max(500),
  evidenceId: z.number().int().positive().nullable().optional(),
});

/** 无运输趟次的车辆结算仍须基于外租合同使用量或明确调整依据；金额由服务端取合同单价或受控调整金额快照。 */
const transportVehicleNonTripSettlementInput = z
  .object({
    projectId: z.number().int().positive(),
    vehicleId: z.number().int().positive(),
    settlementKind: z.enum(["lease", "adjustment"]),
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
    payeeAccount: z.string().trim().max(160).nullable().optional(),
    paymentMethod:
      transportSettlementPaymentMethodSchema.default("bank_transfer"),
    /** 调整结算可填写经审核的正数应付；租赁结算由合同与使用记录计算，客户端金额不会生效。 */
    adjustmentAmount: z
      .number()
      .positive()
      .max(999999999999.99)
      .nullable()
      .optional(),
    basisDescription: z
      .string()
      .trim()
      .min(4, "请填写合同、签证或调整结算依据")
      .max(500),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (value.periodEnd < value.periodStart)
      issue.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "结束日期不能早于开始日期",
      });
    if (value.settlementKind === "adjustment" && !value.adjustmentAmount)
      issue.addIssue({
        code: "custom",
        path: ["adjustmentAmount"],
        message: "调整结算必须填写经审核的应付金额",
      });
    if (value.settlementKind === "lease" && value.adjustmentAmount)
      issue.addIssue({
        code: "custom",
        path: ["adjustmentAmount"],
        message: "租赁结算金额由合同与使用依据计算，不可手工填写",
      });
    if (
      ["bank_transfer", "corporate_account", "wechat", "alipay"].includes(
        value.paymentMethod
      ) &&
      !value.payeeAccount?.trim()
    )
      issue.addIssue({
        code: "custom",
        path: ["payeeAccount"],
        message: "该收款方式必须填写收款账户或收款账号",
      });
  });

const transportVehicleSettlementActionInput = z
  .object({
    id: z.number().int().positive(),
    projectId: z.number().int().positive(),
    action: z.enum(["submit", "approve", "pay", "void"]),
    paymentDate: businessDateSchema.optional(),
    paymentReference: z.string().trim().max(128).nullable().optional(),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (value.action === "pay" && !value.paymentDate)
      issue.addIssue({
        code: "custom",
        path: ["paymentDate"],
        message: "登记付款必须填写付款日期",
      });
  });

/** 外租机械只能从已审核的月结快照创建付款结算，金额由月结快照和受控扣款组成。 */
const machinePaymentSettlementDraftInput = z
  .object({
    projectId: z.number().int().positive(),
    monthlyStatementId: z.number().int().positive(),
    payeeName: z.string().trim().min(2, "请填写收款人姓名或单位名称").max(128),
    payeeAccount: z.string().trim().max(160).nullable().optional(),
    paymentMethod:
      transportSettlementPaymentMethodSchema.default("bank_transfer"),
    manualDeductionAmount: z.number().min(0).max(999999999999.99).default(0),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (
      ["bank_transfer", "corporate_account", "wechat", "alipay"].includes(
        value.paymentMethod
      ) &&
      !value.payeeAccount?.trim()
    )
      issue.addIssue({
        code: "custom",
        path: ["payeeAccount"],
        message: "该收款方式必须填写收款账户或收款账号",
      });
  });

const machinePaymentSettlementActionInput = z
  .object({
    id: z.number().int().positive(),
    projectId: z.number().int().positive(),
    action: z.enum(["submit", "approve", "pay", "void"]),
    paymentDate: businessDateSchema.optional(),
    paymentReference: z.string().trim().max(128).nullable().optional(),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (value.action === "pay" && !value.paymentDate)
      issue.addIssue({
        code: "custom",
        path: ["paymentDate"],
        message: "登记付款必须填写付款日期",
      });
  });

/** 写卡器型号先以台账方式预留，未接入硬件协议时仅允许生成并人工确认受控写卡任务。 */
const rfidWriterDeviceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  deviceCode: z
    .string()
    .trim()
    .min(2, "请填写写卡器编号")
    .max(64)
    .transform(value => value.toUpperCase()),
  displayName: z.string().trim().min(2, "请填写写卡器名称").max(128),
  model: z.string().trim().max(128).nullable().optional(),
  connectionMode: z
    .enum(["manual_placeholder", "usb", "serial", "network"])
    .default("manual_placeholder"),
  status: z.enum(["active", "disabled", "maintenance"]).default("active"),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 原始卡 UID 与司机电话仅在本次绑定请求中出现；持久化后分别只保留指纹/密文与掩码。 */
const rfidCardBindingInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  managementCode: z
    .string()
    .trim()
    .min(2, "请填写至少 2 位车辆卡管理编号")
    .max(64, "车辆卡管理编号不能超过 64 位")
    .transform(value => value.toUpperCase())
    .nullable()
    .optional(),
  cardUid: z.string().trim().min(4, "请读取有效射频卡 UID").max(128),
  driverPhone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,32}$/, "请填写有效司机联系电话"),
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
  executionMode: z
    .enum(["manual_confirmation", "pc_bridge"])
    .default("manual_confirmation"),
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

const rfidConfirmationRecoveryInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
});

/** 本地环回桥接仅返回 UID 指纹；后台不接收或持久化测试卡的原始 UID。 */
const rfidHardwareTestInput = z.object({
  projectId: z.number().int().positive(),
  writerDeviceId: z.number().int().positive().nullable().optional(),
  success: z.boolean(),
  cardUidFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "卡 UID 指纹格式无效")
    .nullable()
    .optional(),
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/**
 * 现场人员看到的“第 N 车”按项目、车辆和中国业务日分别计算，且装土、卸土各自独立排序。
 * 当前成功事件使用本次确认时间直接并入排序，避免读取到更新前快照而把第一车误报为第二车。
 */
async function getDailyVehicleStageOrdinal(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: {
    projectId: number;
    vehicleId: number;
    tripId: number;
    eventType: "load" | "unload";
    occurredAt: Date;
  }
) {
  const sameVehicleTrips = await db
    .select({
      id: transportTrips.id,
      status: transportTrips.status,
      loadConfirmedAt: transportTrips.loadConfirmedAt,
      unloadConfirmedAt: transportTrips.unloadConfirmedAt,
    })
    .from(transportTrips)
    .where(
      and(
        eq(transportTrips.projectId, input.projectId),
        eq(transportTrips.vehicleId, input.vehicleId),
        ne(transportTrips.status, "void")
      )
    );
  const businessDate = formatChinaBusinessDate(input.occurredAt);
  const stageTimestamp =
    input.eventType === "load" ? "loadConfirmedAt" : "unloadConfirmedAt";
  const completedStages = sameVehicleTrips
    .filter(
      row =>
        row.id !== input.tripId && row.status !== "void" && row[stageTimestamp]
    )
    .map(row => ({
      id: row.id,
      occurredAt: new Date(row[stageTimestamp] as Date),
    }))
    .filter(row => formatChinaBusinessDate(row.occurredAt) === businessDate);
  completedStages.push({ id: input.tripId, occurredAt: input.occurredAt });
  completedStages.sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.id - right.id
  );
  return completedStages.findIndex(row => row.id === input.tripId) + 1;
}

/** 机械油料费用与柴油领用共用同一项目指导价口径，避免前端手填单价绕开有效期控制。 */
async function getEffectiveDieselGuidelinePrice(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number,
  occurredAt: Date
) {
  const businessDate = formatChinaBusinessDate(occurredAt);
  const prices = await db
    .select()
    .from(dieselGuidelinePrices)
    .where(eq(dieselGuidelinePrices.projectId, projectId))
    .orderBy(desc(dieselGuidelinePrices.effectiveFrom));
  const price = prices.find(
    item =>
      item.status === "active" &&
      formatChinaBusinessDate(new Date(item.effectiveFrom)) <= businessDate &&
      (!item.effectiveTo ||
        formatChinaBusinessDate(new Date(item.effectiveTo)) >= businessDate)
  );
  return {
    businessDate,
    price: price
      ? {
          id: price.id,
          pricePerLiter: Number(price.pricePerLiter),
          effectiveFrom: formatChinaBusinessDate(new Date(price.effectiveFrom)),
          effectiveTo: price.effectiveTo
            ? formatChinaBusinessDate(new Date(price.effectiveTo))
            : null,
        }
      : null,
  };
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
    endExclusive: toBusinessDate(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
    ),
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
  const machineBaseOutput =
    input.billingType === "monthly"
      ? roundMoney((input.rate / 30) * input.machineWorkDays)
      : roundMoney(input.rate * input.machineWorkDays);
  const machineOvertimeRate =
    input.overtimeHourlyRate > 0
      ? input.overtimeHourlyRate
      : input.billingType === "monthly"
        ? input.rate / 30 / 10
        : 0;
  const machineOvertimeOutput = roundMoney(
    machineOvertimeRate * input.machineOvertimeHours
  );
  const totalOutput = roundMoney(machineBaseOutput + machineOvertimeOutput);
  const driverBaseWage = roundMoney(
    (input.driverMonthlyWage / 30) * input.driverWorkDays
  );
  const driverOvertimeWage = roundMoney(
    (input.driverMonthlyWage / 30 / 10) * input.driverOvertimeHours
  );
  const driverTotalWage = roundMoney(driverBaseWage + driverOvertimeWage);
  /** 会计模板的“机械分成”口径不扣油费： (总产值 - 司机总工资 - 维修费) ÷ 2。油耗和油费单列审计。 */
  const shareBaseAmount = roundMoney(
    totalOutput - driverTotalWage - input.repairAmount
  );
  const machineShareAmount = roundMoney(shareBaseAmount / 2);
  const deductionAmount = roundMoney(
    driverTotalWage + input.repairAmount + input.fuelAmount
  );
  return {
    machineBaseOutput,
    machineOvertimeOutput,
    totalOutput,
    driverOvertimeWage,
    driverTotalWage,
    repairAmount: roundMoney(input.repairAmount),
    fuelLiters: roundMoney(input.fuelLiters),
    fuelAmount: roundMoney(input.fuelAmount),
    deductionAmount,
    shareBaseAmount,
    machineShareAmount,
  };
}

/** 运单号以日期、时间、秒为主体；同一进程同秒并发时只追加短序号避免冲突。 */
let latestTripSecond = "";
let latestTripSecondSequence = 0;
function createTransportTripNo(projectId: number, occurredAt = new Date()) {
  const values = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(occurredAt)
    .reduce<Record<string, string>>(
      (current, part) => ({ ...current, [part.type]: part.value }),
      {}
    );
  const secondKey = `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
  latestTripSecondSequence =
    latestTripSecond === secondKey ? latestTripSecondSequence + 1 : 1;
  latestTripSecond = secondKey;
  return `TR-${projectId}-${secondKey}-${String(latestTripSecondSequence).padStart(2, "0")}`;
}

/** 渣土车结算号与运单号分离，避免付款单因重算或补审混同运输票据。 */
function createTransportVehicleSettlementNo(
  projectId: number,
  occurredAt = new Date()
) {
  const date = getChinaBusinessDate(occurredAt).replaceAll("-", "");
  return `TS-${projectId}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 机械付款结算号独立于月结快照编号，区分已生成结算和实际付款终态。 */
function createMachinePaymentSettlementNo(
  projectId: number,
  occurredAt = new Date()
) {
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
  code:
    | "MISSING_EVIDENCE"
    | "MISSING_GPS"
    | "MISSING_END_TIME"
    | "MISSING_LOAD_CARD"
    | "ABNORMAL_DISTANCE"
    | "ABNORMAL_VOLUME"
    | "ABNORMAL_DURATION"
    | "CARD_EVENT_EXCEPTION";
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
  const hasStartGps =
    typeof snapshot.startLatitude === "number" &&
    typeof snapshot.startLongitude === "number";
  const hasEndGps =
    typeof snapshot.endLatitude === "number" &&
    typeof snapshot.endLongitude === "number";
  const anomalies: TransportAnomaly[] = [];
  if (snapshot.unloadOnlyCardClose)
    anomalies.push({
      code: "MISSING_LOAD_CARD",
      severity: "notice",
      label: "未记录装土刷卡，实际运输起点待核验",
    });
  if (!trip.evidenceId)
    anomalies.push({
      code: "MISSING_EVIDENCE",
      severity: "notice",
      label: "未关联现场影像",
    });
  if (!hasStartGps || !hasEndGps)
    anomalies.push({
      code: "MISSING_GPS",
      severity: "notice",
      label: "GPS 定位信息不完整",
    });
  if (!trip.endAt)
    anomalies.push({
      code: "MISSING_END_TIME",
      severity: "notice",
      label: "未填写收工时间",
    });
  if (Number(trip.actualDistanceKm ?? 0) <= 0.1)
    anomalies.push({
      code: "ABNORMAL_DISTANCE",
      severity: "warning",
      label: "申报里程过低，请核对",
    });
  const theoreticalVolume = Number(snapshot.theoreticalVolumeCubicMeters ?? 0);
  if (
    theoreticalVolume > 0 &&
    Number(trip.volumeCubicMeters ?? 0) > theoreticalVolume * 1.1
  ) {
    anomalies.push({
      code: "ABNORMAL_VOLUME",
      severity: "warning",
      label: "申报方量高于理论方量 10%",
    });
  }
  if (
    !snapshot.unloadOnlyCardClose &&
    trip.endAt &&
    trip.endAt.getTime() - trip.startAt.getTime() < 2 * 60 * 1000
  ) {
    anomalies.push({
      code: "ABNORMAL_DURATION",
      severity: "warning",
      label: "运输时长不足 2 分钟，请核验",
    });
  }
  if (trip.exceptionStatus === "open")
    anomalies.push({
      code: "CARD_EVENT_EXCEPTION",
      severity: "warning",
      label: "刷卡事件存在待复核异常",
    });
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
  if (
    header &&
    typeof header === "object" &&
    "affectedRows" in header &&
    Number((header as { affectedRows?: unknown }).affectedRows) === 0
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${recordName}状态已被其他用户更新，请刷新后重试`,
    });
  }
}

/** Bulk source claims must write every snapshotted source or roll back the settlement. */
function assertSettlementSourceWrites(
  result: unknown,
  expected: number,
  label: string
) {
  const header = Array.isArray(result) ? result[0] : result;
  if (
    !header ||
    typeof header !== "object" ||
    !("affectedRows" in header) ||
    Number(header.affectedRows) !== expected
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: `${label}来源已被其他操作更新，请刷新后重试`,
    });
}
function createCardEventPayloadFingerprint(
  input: {
    tripId: number;
    projectId: number;
    siteId?: number | null;
    idempotencyKey: string;
    deviceId?: string;
    cardFingerprint?: string;
    latitude?: number | null;
    longitude?: number | null;
    occurredAt: string;
  },
  eventType: "load" | "unload"
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventType,
        tripId: input.tripId,
        projectId: input.projectId,
        siteId: input.siteId ?? null,
        idempotencyKey: input.idempotencyKey,
        deviceId: input.deviceId ?? null,
        cardFingerprint: input.cardFingerprint ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        occurredAt: new Date(input.occurredAt).toISOString(),
      })
    )
    .digest("hex");
}

/** 卡 UID 只用于本次绑定并立即派生不可逆指纹，避免原始设备标识进入数据库或审计记录。 */
function fingerprintRfidCardUid(cardUid: string) {
  return createHash("sha256")
    .update(`road-rfid-card:v1:${cardUid.trim().toUpperCase()}`)
    .digest("hex");
}

function maskRfidCardUid(cardUid: string) {
  const normalized = cardUid.trim().toUpperCase();
  return normalized.length <= 4
    ? "****"
    : `${"*".repeat(Math.min(12, normalized.length - 4))}${normalized.slice(-4)}`;
}

function createRfidWriteJobNo(projectId: number) {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `CARD-${projectId}-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 写卡模型与运费模型均只能由运输负责人、项目负责人、财务或系统管理员维护。 */
function assertCanManageTransportResources(roleCodes: readonly string[]) {
  if (
    !roleCodes.includes("ALL") &&
    !roleCodes.some(role =>
      [
        "TRANSPORT_MANAGER",
        "PROJECT_MANAGER",
        "FINANCE_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    )
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位无权维护射频写卡设备或车辆卡绑定",
    });
  }
}

function notifyExternalDriverWechat(input: {
  vehicleId: number;
  projectId: number;
  eventCode: string;
  targetType: string;
  targetId: string;
  title: string;
  content: string;
  deepLink?: string;
}) {
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
async function notifyBoundDriverInApp(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: {
    driverUserId: number | null;
    eventCode: string;
    idempotencyKey: string;
    title: string;
    content: string;
    deepLink: string;
  }
) {
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
  }) as unknown as {
    onDuplicateKeyUpdate?: (input: {
      set: { status: "sent"; sentAt: Date };
    }) => Promise<unknown>;
  };
  if (typeof write.onDuplicateKeyUpdate === "function") {
    await write.onDuplicateKeyUpdate({ set: { status: "sent", sentAt } });
  } else {
    // 仅供单元测试中的最小数据库桩使用；真实 MySQL 分支始终使用上方唯一键更新。
    await (write as unknown as Promise<unknown>);
  }
  return true;
}

/** 装卸土点属于现场调度基础资料：运输负责人可维护，项目管理员也可通过明确的运输创建/编辑授权办理。 */
async function canManageTransportSites(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  roleCodes: readonly string[]
) {
  if (
    roleCodes.includes("ALL") ||
    roleCodes.some(role =>
      [
        "TRANSPORT_MANAGER",
        "PROJECT_MANAGER",
        "FINANCE_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    )
  )
    return true;
  const [createDecision, editDecision] = await Promise.all([
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create"),
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit"),
  ]);
  return createDecision.allowed || editDecision.allowed;
}

/** 手机首次发卡可由超级管理员、运输管理岗位或具备明确运输新增/维护权限的项目管理员办理；只读专属权限不得签发车辆卡。 */
async function assertCanIssueMobileNfcCards(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  roleCodes: readonly string[]
) {
  if (
    roleCodes.includes("ALL") ||
    roleCodes.some(role =>
      [
        "TRANSPORT_MANAGER",
        "PROJECT_MANAGER",
        "FINANCE_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    )
  )
    return;
  const [createDecision, editDecision] = await Promise.all([
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create"),
    getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit"),
  ]);
  if (createDecision.allowed || editDecision.allowed) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "当前账号仅有运输查看权限，未获车辆卡签发或维护授权",
  });
}

function getPhotoUnloadSafetyNotices(snapshot: unknown): string[] {
  const notices = getRouteSnapshot(snapshot).unloadSafetyNotices;
  return Array.isArray(notices)
    ? notices.filter((notice): notice is string => typeof notice === "string")
    : [];
}

async function recordTransportCardEvent(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof transportCardEventInput>,
  eventType: "load" | "unload",
  options: {
    singleScanClose?: boolean;
    unloadOnlyClose?: boolean;
    initialSafetyNotice?: string;
  } = {}
) {
  const user = requireAuthenticatedUser(ctx);
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const [trip] = await db
    .select()
    .from(transportTrips)
    .where(eq(transportTrips.id, input.tripId))
    .limit(1);
  if (!trip || trip.projectId !== input.projectId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "运输趟次不存在或不属于当前项目",
    });
  if (eventType === "load" && (trip.invoiceMode ?? "nfc_card") !== "nfc_card")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "拍照车牌发票不进入 NFC 刷卡流程，请由主管按影像和车辆信息核验",
    });
  if (
    eventType === "unload" &&
    trip.invoiceMode === "plate_photo" &&
    !input.cardFingerprint
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "拍照开票运单刷卡卸土必须读取并核验当前车辆有效绑定卡",
    });
  const { vehicle } = await getScopedVehicle(
    ctx,
    trip.vehicleId,
    input.projectId,
    roleCodes
  );
  const occurredAt = new Date(input.occurredAt);
  const payloadFingerprint = createCardEventPayloadFingerprint(
    input,
    eventType
  );
  const expectedSiteId =
    eventType === "load" ? trip.loadSiteId : trip.unloadSiteId;
  let siteName: string | null = null;
  let siteAdministratorUserId: number | null = null;
  if (expectedSiteId || input.siteId) {
    if (!expectedSiteId || input.siteId !== expectedSiteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${eventType === "load" ? "装土" : "卸土"}刷卡地点与运输票据不一致`,
      });
    }
    const [site] = await db
      .select()
      .from(transportSites)
      .where(eq(transportSites.id, expectedSiteId))
      .limit(1);
    if (
      !site ||
      site.projectId !== input.projectId ||
      site.siteType !== eventType ||
      site.status !== "active"
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "现场地点不存在、已停用或地点类型不匹配",
      });
    }
    // 现场管理员仅作可选责任人留档；具备运输模块权限且在项目范围内的用户均可完成刷卡。
    siteName = site.name;
    siteAdministratorUserId = site.administratorUserId;
  }
  const [existing] = await db
    .select()
    .from(transportCardEvents)
    .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    if (
      existing.tripId !== input.tripId ||
      existing.eventType !== eventType ||
      existing.payloadFingerprint !== payloadFingerprint
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该刷卡幂等键已用于其他事件，已拒绝重复写入",
      });
    }
    if (
      eventType === "unload" &&
      existing.validationStatus === "accepted" &&
      trip.unloadEventId !== existing.id
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "卸土刷卡确认尚未完成，请刷新后核验",
      });
    return {
      success:
        existing.validationStatus === "accepted" ||
        existing.validationStatus === "duplicate",
      duplicate: true,
      needsReview: existing.validationStatus === "needs_review",
      eventId: existing.id,
      validationStatus: existing.validationStatus,
      reason: existing.validationReason ?? undefined,
      driverNotificationQueued: Boolean(vehicle.driverUserId),
    };
  }
  // 已由任一通道完成卸土时，新确认也只返回原闭环；不新增事件、车数或短信。
  if (
    eventType === "unload" &&
    trip.unloadConfirmedAt &&
    trip.status !== "void"
  ) {
    if (input.cardFingerprint) {
      const [boundCard] = await db
        .select({ id: transportVehicleRfidCards.id })
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.vehicleId, trip.vehicleId),
            eq(transportVehicleRfidCards.projectId, input.projectId),
            eq(
              transportVehicleRfidCards.cardUidFingerprint,
              input.cardFingerprint
            ),
            eq(transportVehicleRfidCards.status, "active")
          )
        )
        .limit(1);
      if (!boundCard)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "读取的射频卡未与当前车辆完成有效绑定，或该卡已被停用/挂失",
        });
    }
    return {
      success: true,
      duplicate: true,
      needsReview: false,
      eventId: trip.unloadEventId,
      validationStatus: "accepted" as const,
      vehiclePlateNo: vehicle.plateNo,
      driverNotificationQueued: Boolean(vehicle.driverUserId),
    };
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
      latitude:
        input.latitude === null || input.latitude === undefined
          ? null
          : String(input.latitude),
      longitude:
        input.longitude === null || input.longitude === undefined
          ? null
          : String(input.longitude),
      cardFingerprint: input.cardFingerprint ?? null,
      payloadFingerprint,
      occurredAt,
      validationStatus: "accepted",
    });
  } catch {
    const [concurrent] = await db
      .select()
      .from(transportCardEvents)
      .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (
      concurrent &&
      concurrent.tripId === input.tripId &&
      concurrent.eventType === eventType &&
      concurrent.payloadFingerprint === payloadFingerprint
    ) {
      if (
        eventType === "unload" &&
        concurrent.validationStatus === "accepted"
      ) {
        const [currentTrip] = await db
          .select()
          .from(transportTrips)
          .where(eq(transportTrips.id, trip.id))
          .limit(1);
        if (!currentTrip || currentTrip.unloadEventId !== concurrent.id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "卸土刷卡确认尚未完成，请刷新后核验",
          });
      }
      return {
        success:
          concurrent.validationStatus === "accepted" ||
          concurrent.validationStatus === "duplicate",
        duplicate: true,
        needsReview: concurrent.validationStatus === "needs_review",
        eventId: concurrent.id,
        validationStatus: concurrent.validationStatus,
        reason: concurrent.validationReason ?? undefined,
        driverNotificationQueued: Boolean(vehicle.driverUserId),
      };
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: "刷卡事件写入冲突，请使用新的读卡事件重试",
    });
  }
  const [event] = await db
    .select()
    .from(transportCardEvents)
    .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!event)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "刷卡事件审计记录创建失败",
    });

  const markNeedsReview = async (reason: string) => {
    await db
      .update(transportCardEvents)
      .set({ validationStatus: "needs_review", validationReason: reason })
      .where(eq(transportCardEvents.id, event.id));
    await db
      .update(transportTrips)
      .set({ exceptionStatus: "open" })
      .where(eq(transportTrips.id, trip.id));
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: "record_card_event_needs_review",
      targetType: "transport_card_event",
      targetId: String(event.id),
      summary: `运输${eventType === "load" ? "装土" : "卸土"}刷卡事件进入人工复核：${reason}`,
    });
    const driverNotificationQueued = await notifyBoundDriverInApp(db, {
      driverUserId: vehicle.driverUserId,
      eventCode: "transport_card_event_exception",
      idempotencyKey: `inapp:transport-card-review:${event.id}:${vehicle.driverUserId ?? 0}`,
      title: "运输刷卡异常待复核",
      content: `车辆 ${vehicle.plateNo} 的${eventType === "load" ? "装土" : "卸土"}刷卡需要人工复核：${reason}`,
      deepLink: "/mobile/transport",
    });
    void notifyAliyunSmsSafely({
      actorUserId: user.id,
      projectId: input.projectId,
      module: "transport",
      eventCode: "transport_scan_exception",
      recipientPhone: vehicle.driverPhoneEncrypted
        ? decryptSecret(vehicle.driverPhoneEncrypted)
        : null,
      targetType: "transport_card_event",
      targetId: String(event.id),
      templateParams: {
        vehicle: vehicle.plateNo,
        time: formatChinaSmsTime(occurredAt),
      },
    });
    void notifyOfficialAccountBusinessEventSafely({
      userId: user.id,
      projectId: input.projectId,
      module: "transport",
      eventCode: "transport_card_event_exception",
      targetType: "transport_card_event",
      targetId: String(event.id),
      title: "运输刷卡异常待复核",
      content: `一笔运输${eventType === "load" ? "装土" : "卸土"}刷卡事件需要人工复核。`,
      deepLink: "/mobile/transport",
    }).catch(() => undefined);
    return {
      success: false,
      duplicate: false,
      needsReview: true,
      eventId: event.id,
      validationStatus: "needs_review" as const,
      reason,
      driverNotificationQueued,
    };
  };

  if (input.cardFingerprint) {
    const [boundCard] = await db
      .select({ id: transportVehicleRfidCards.id })
      .from(transportVehicleRfidCards)
      .where(
        and(
          eq(transportVehicleRfidCards.vehicleId, trip.vehicleId),
          eq(transportVehicleRfidCards.projectId, input.projectId),
          eq(
            transportVehicleRfidCards.cardUidFingerprint,
            input.cardFingerprint
          ),
          eq(transportVehicleRfidCards.status, "active")
        )
      )
      .limit(1);
    if (!boundCard)
      return markNeedsReview(
        "读取的射频卡未与当前车辆完成有效绑定，或该卡已被停用/挂失"
      );
  }

  if (trip.status === "void" || trip.status === "settled")
    return markNeedsReview("趟次已关闭，不能再确认刷卡事件");
  if (eventType === "load" && trip.unloadConfirmedAt)
    return markNeedsReview("检测到卸土已确认后的装土刷卡，疑似乱序事件");
  if (eventType === "load" && trip.loadConfirmedAt)
    return markNeedsReview("该趟次已存在装土确认，疑似重复刷卡事件");
  const snapshot = getRouteSnapshot(trip.routeSnapshot);
  // No request field can grant the missing-load exception. Only a server-created,
  // still-pending unload-only trip may retry via reader, signed link or mobile NFC.
  const unloadOnlyClose =
    eventType === "unload" &&
    !trip.loadConfirmedAt &&
    !trip.loadEventId &&
    trip.invoiceMode === "nfc_card" &&
    snapshot.source === "nfc_unload_only_reader" &&
    snapshot.unloadOnlyCardClose === true &&
    snapshot.loadCardRecorded === false;
  if (eventType === "unload" && !trip.loadConfirmedAt && !unloadOnlyClose)
    return markNeedsReview("卸土刷卡早于装土确认，疑似乱序事件");
  if (eventType === "unload" && trip.unloadConfirmedAt)
    return markNeedsReview("该趟次已存在卸土确认，疑似重复刷卡事件");
  if (eventType === "unload") {
    const routePresetId = Number(
      (trip.routeSnapshot as { routePresetId?: number } | null)
        ?.routePresetId || 0
    );
    if (!routePresetId)
      return markNeedsReview(
        "当前运单缺少路线安全参数，不能直接确认卸土，请人工核验"
      );
    const [[route], [unloadSite]] = await Promise.all([
      db
        .select()
        .from(transportRoutePresets)
        .where(eq(transportRoutePresets.id, routePresetId))
        .limit(1),
      expectedSiteId
        ? db
            .select()
            .from(transportSites)
            .where(eq(transportSites.id, expectedSiteId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    if (!route || route.projectId !== input.projectId || !unloadSite)
      return markNeedsReview(
        "当前卸土路线或地点配置已失效，不能直接确认卸土，请人工核验"
      );
    const safety = effectiveTransportSafety(unloadSite, route);
    const safetyNotices: string[] = options.initialSafetyNotice
      ? [options.initialSafetyNotice]
      : [];
    if (unloadOnlyClose) {
      const [[loadSite], [rule], activeTrip] = await Promise.all([
        db
          .select()
          .from(transportSites)
          .where(eq(transportSites.id, trip.loadSiteId!))
          .limit(1),
        db
          .select()
          .from(freightRateRules)
          .where(eq(freightRateRules.id, route.freightRuleId))
          .limit(1),
        findActiveVehicleTransportTrip(db, input.projectId, vehicle.id),
      ]);
      if (
        !input.cardFingerprint ||
        activeTrip?.id !== trip.id ||
        trip.activeVehicleTransitKey !==
          createActiveVehicleTransitKey(input.projectId, vehicle.id) ||
        route.status !== "active" ||
        route.unloadOnlyCloseEnabled !== true ||
        route.loadSiteId !== trip.loadSiteId ||
        route.unloadSiteId !== trip.unloadSiteId ||
        route.freightRuleId !== trip.freightRuleId ||
        !loadSite ||
        loadSite.projectId !== input.projectId ||
        loadSite.siteType !== "load" ||
        loadSite.status !== "active" ||
        !rule ||
        rule.projectId !== input.projectId ||
        rule.status !== "active" ||
        rule.settlementUnit === "ton" ||
        rule.settlementUnit !== snapshot.settlementUnit
      )
        return markNeedsReview(
          "卸土补刷卡的持久标识、车辆在途状态或启用路线配置已失效，请人工核验"
        );
      if (occurredAt.getTime() < new Date(trip.startAt).getTime())
        return markNeedsReview("卸土补刷卡重试时间不得早于首次服务端记录");
      // Re-evaluate with current site policy; a failed GPS attempt must not let a
      // later retry bypass newly enabled minimum consecutive-trip intervals.
      try {
        await assertVehicleMinimumUnloadOnlyScanInterval(db, {
          projectId: input.projectId,
          vehicleId: vehicle.id,
          plateNo: vehicle.plateNo,
          occurredAt,
          minimumTransitMinutes: safety.minimumTransitMinutes,
        });
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "BAD_REQUEST")
          throw error;
        if (safety.minimumTransitEnabled) return markNeedsReview(error.message);
        const notice =
          "卸土点补刷卡的同车连续间隔未达到路线最短时间（时间硬拦截已关闭，已留待核验）";
        if (!safetyNotices.includes(notice)) safetyNotices.push(notice);
      }
    } else {
      const transitStartAt = trip.loadConfirmedAt ?? trip.startAt;
      const elapsedMinutes = Math.max(
        0,
        Math.floor(
          (occurredAt.getTime() - new Date(transitStartAt).getTime()) / 60_000
        )
      );
      if (elapsedMinutes < safety.minimumTransitMinutes) {
        const reason = `卸土异常：运途时间不符合。当前已运输 ${elapsedMinutes} 分钟，本路线最短运输时间为 ${safety.minimumTransitMinutes} 分钟`;
        if (safety.minimumTransitEnabled)
          return markNeedsReview(`${reason}；未达到时间不能完成卸土`);
        safetyNotices.push(`${reason}（最短运输时间拦截已关闭，已留待核验）`);
      }
    }
    const hasMobileCoordinates =
      input.latitude !== null &&
      input.latitude !== undefined &&
      input.longitude !== null &&
      input.longitude !== undefined;
    const hasUnloadSiteCoordinates =
      unloadSite.latitude !== null &&
      unloadSite.latitude !== undefined &&
      unloadSite.longitude !== null &&
      unloadSite.longitude !== undefined;
    if (!hasMobileCoordinates || !hasUnloadSiteCoordinates) {
      const reason = !hasMobileCoordinates
        ? "卸土异常：未取得现场定位"
        : "卸土点中文详细地址尚未完成地图定位校验";
      if (safety.unloadGeofenceEnabled)
        return markNeedsReview(`${reason}，不能直接确认卸土`);
      safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
    } else {
      const distanceMeters = Math.round(
        calculateCoordinateDistanceMeters(
          Number(input.latitude),
          Number(input.longitude),
          Number(unloadSite.latitude),
          Number(unloadSite.longitude)
        )
      );
      if (distanceMeters > safety.unloadGeofenceMeters) {
        const reason = `卸土异常：未达到卸土点，当前定位距卸土点约 ${distanceMeters} 米，允许偏差 ${safety.unloadGeofenceMeters} 米`;
        if (safety.unloadGeofenceEnabled)
          return markNeedsReview(`${reason}，不能完成卸土`);
        safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
      }
    }
    if (safetyNotices.length) {
      await db
        .update(transportCardEvents)
        .set({ validationReason: safetyNotices.join("；") })
        .where(eq(transportCardEvents.id, event.id));
      await db
        .update(transportTrips)
        .set({ exceptionStatus: "open" })
        .where(eq(transportTrips.id, trip.id));
    }
  }

  let safetyPolicy: ReturnType<typeof effectiveTransportSafety> | undefined;
  if (eventType === "unload" && expectedSiteId) {
    const [policySite] = await db
      .select()
      .from(transportSites)
      .where(eq(transportSites.id, expectedSiteId))
      .limit(1);
    if (policySite) safetyPolicy = effectiveTransportSafety(policySite, {});
  }
  const updateResult =
    eventType === "load"
      ? await db
          .update(transportTrips)
          .set({
            loadConfirmedAt: occurredAt,
            loadEventId: event.id,
            loadConfirmedBy: user.id,
          })
          .where(
            and(
              eq(transportTrips.id, trip.id),
              isNull(transportTrips.loadConfirmedAt),
              isNull(transportTrips.unloadConfirmedAt),
              ne(transportTrips.status, "void"),
              ne(transportTrips.status, "settled")
            )
          )
      : await db
          .update(transportTrips)
          .set({
            unloadConfirmedAt: occurredAt,
            unloadEventId: event.id,
            unloadConfirmedBy: user.id,
            nfcTransitKey: null,
            activeVehicleTransitKey: null,
            endAt: occurredAt,
            status: trip.status === "draft" ? "submitted" : trip.status,
            routeSnapshot: {
              ...getRouteSnapshot(trip.routeSnapshot),
              unloadConfirmationMode: "nfc_card",
              safetyPolicy,
              ...(unloadOnlyClose
                ? {
                    unloadOnlyCardClosedAt: occurredAt.toISOString(),
                    endLatitude: input.latitude ?? null,
                    endLongitude: input.longitude ?? null,
                  }
                : {}),
            },
          })
          .where(
            and(
              eq(transportTrips.id, trip.id),
              eq(transportTrips.projectId, input.projectId),
              eq(transportTrips.vehicleId, vehicle.id),
              eq(transportTrips.status, trip.status),
              unloadOnlyClose
                ? and(
                    isNull(transportTrips.loadConfirmedAt),
                    isNull(transportTrips.loadEventId),
                    eq(
                      transportTrips.activeVehicleTransitKey,
                      trip.activeVehicleTransitKey!
                    )
                  )
                : isNotNull(transportTrips.loadConfirmedAt),
              isNull(transportTrips.unloadConfirmedAt),
              ne(transportTrips.status, "void"),
              ne(transportTrips.status, "settled")
            )
          );
  if (!didConditionalWriteApply(updateResult))
    return markNeedsReview("趟次已被其他刷卡事件更新，请人工核验事件顺序");
  const dailyVehicleTripOrdinal = await getDailyVehicleStageOrdinal(db, {
    projectId: input.projectId,
    vehicleId: trip.vehicleId,
    tripId: trip.id,
    eventType,
    occurredAt,
  });

  await db.insert(auditLogs).values({
    userId: user.id,
    module: "transport",
    action: `record_${eventType}_card_event`,
    targetType: "transport_card_event",
    targetId: String(event.id),
    summary: `运输${eventType === "load" ? "装土" : "卸土"}刷卡确认成功${siteName ? `：${siteName}` : ""}`,
  });
  const eventLabel = eventType === "load" ? "装土" : "卸土";
  const tripFinancialSummary = `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车${eventLabel}成功${siteName ? `，地点 ${siteName}` : ""}；里程 ${trip.actualDistanceKm ? `${Number(trip.actualDistanceKm).toFixed(3)} km` : "待补录"}，运费 ${trip.calculatedAmount ? `¥${Number(trip.calculatedAmount).toFixed(2)}` : "待核算"}。`;
  if (eventType === "unload") {
    // 站内通知只记录必要的闭环结果，不暴露定位坐标、司机电话或结算账户等敏感字段。
    const recipientUserIds = Array.from(
      new Set(
        [
          trip.loadConfirmedBy,
          user.id,
          siteAdministratorUserId,
          vehicle.driverUserId,
        ].filter(
          (value): value is number => typeof value === "number" && value > 0
        )
      )
    );
    const notificationTime = new Date();
    await Promise.all(
      recipientUserIds.map(recipientUserId =>
        db
          .insert(notificationRecords)
          .values({
            eventCode: "transport_unload_completed",
            idempotencyKey: `inapp:transport-unload:${event.id}:${recipientUserId}`,
            recipientUserId,
            title: unloadOnlyClose ? "卸土点补刷卡闭环完成" : "运输卸土成功",
            content: unloadOnlyClose
              ? `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车卸土成功；未记录装土刷卡，已按路线补刷卡规则在卸土点完成运单 ${trip.tripNo} 的受控闭环，仍请进入系统核验。`
              : `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车卸土成功，运单 ${trip.tripNo} 已形成运输闭环，请进入系统查看受控详情。`,
            deepLink: "/mobile/transport",
            status: "sent",
            sentAt: notificationTime,
            channel: "in_app",
          })
          .onDuplicateKeyUpdate({
            set: { status: "sent", sentAt: notificationTime },
          })
      )
    );
  }
  const nextActionText =
    eventType === "load"
      ? options.singleScanClose
        ? "本项目已启用刷卡发票即完成闭环，本次运输已直接进入待核验。"
        : "请按调度前往卸土点。"
      : unloadOnlyClose
        ? "运输闭环已按卸土点补刷卡规则记录，实际装土起点仍待核验。"
        : "运输闭环已记录，等待后续核验。";
  const driverNotificationQueued =
    eventType === "load"
      ? await notifyBoundDriverInApp(db, {
          driverUserId: vehicle.driverUserId,
          eventCode: "transport_load_driver_notice",
          idempotencyKey: `inapp:transport-load:${event.id}:${vehicle.driverUserId ?? 0}`,
          title: "装土刷卡成功",
          content: `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车装土成功${siteName ? `，地点 ${siteName}` : ""}，运单 ${trip.tripNo}。${nextActionText}`,
          deepLink: "/mobile/transport",
        })
      : Boolean(vehicle.driverUserId);
  void notifyAliyunSmsSafely({
    actorUserId: user.id,
    projectId: input.projectId,
    module: "transport",
    eventCode:
      eventType === "load"
        ? "transport_load_completed"
        : "transport_unload_completed",
    recipientPhone: vehicle.driverPhoneEncrypted
      ? decryptSecret(vehicle.driverPhoneEncrypted)
      : null,
    targetType: "transport_card_event",
    targetId: String(event.id),
    templateParams: {
      vehicle: vehicle.plateNo,
      place: siteName ?? "运输现场",
      tripOrdinal: dailyVehicleTripOrdinal,
      time: formatChinaSmsTime(occurredAt),
    },
  });
  void notifyOfficialAccountBusinessEventSafely({
    userId: user.id,
    projectId: input.projectId,
    module: "transport",
    eventCode: `transport_${eventType}_card_confirmed`,
    targetType: "transport_card_event",
    targetId: String(event.id),
    title: `运输${eventLabel}刷卡已确认`,
    content: `${tripFinancialSummary} ${nextActionText}`,
    deepLink: "/mobile/transport",
  }).catch(() => undefined);
  return {
    success: true,
    duplicate: false,
    needsReview: false,
    eventId: event.id,
    validationStatus: "accepted" as const,
    vehiclePlateNo: vehicle.plateNo,
    dailyVehicleTripOrdinal,
    driverNotificationQueued,
    unloadOnlyClosed: unloadOnlyClose,
  };
}

/** 查找项目内真实车辆的在途票据，兼容尚未回填锁字段的历史票据，不以开票方式或卡会话键分流。 */
async function findActiveVehicleTransportTrip(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number,
  vehicleId: number
) {
  const rows = await db
    .select()
    .from(transportTrips)
    .where(
      and(
        eq(transportTrips.projectId, projectId),
        eq(transportTrips.vehicleId, vehicleId),
        isNull(transportTrips.unloadConfirmedAt),
        ne(transportTrips.status, "void"),
        ne(transportTrips.status, "settled")
      )
    )
    .orderBy(desc(transportTrips.id))
    .limit(2);
  if (rows.length > 1)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "当前车辆存在多张未卸土运单，不能安全判断本趟运输，请先由主管核验",
    });
  return rows[0] ?? null;
}

/**
 * 双设备闭环入口：装土点读卡设备的首次刷卡创建唯一在途 NFC 票据；卸土点设备只匹配并关闭同一车辆当前在途票据。
 * 设备、地点、管理员和卡片均由服务端复核，浏览器无权指定趟次、路线、方量或价格。
 */
async function recordTransportNfcReaderScan(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof transportNfcReaderScanInput>
) {
  const user = requireAuthenticatedUser(ctx);
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, input.projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const occurredAt = new Date(input.occurredAt);

  const [replayedEvent] = await db
    .select()
    .from(transportCardEvents)
    .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  const [reader] = await db
    .select()
    .from(transportReaderDevices)
    .where(
      and(
        eq(transportReaderDevices.projectId, input.projectId),
        eq(transportReaderDevices.deviceCode, input.readerDeviceCode)
      )
    )
    .limit(1);
  if (!reader || reader.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前读卡设备未登记、未启用或不属于该项目",
    });
  const [site] = await db
    .select()
    .from(transportSites)
    .where(eq(transportSites.id, reader.siteId))
    .limit(1);
  if (!site || site.projectId !== input.projectId || site.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "读卡设备绑定的现场地点不存在或已停用",
    });
  const isTransportManager =
    roleCodes.includes("ALL") ||
    roleCodes.some(role =>
      ["TRANSPORT_MANAGER", "PROJECT_MANAGER"].includes(role)
    );
  if (
    site.administratorUserId &&
    site.administratorUserId !== user.id &&
    !isTransportManager
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号不是该地点指定的现场刷卡管理员",
    });
  }

  const [card] = await db
    .select()
    .from(transportVehicleRfidCards)
    .where(
      and(
        eq(transportVehicleRfidCards.projectId, input.projectId),
        eq(transportVehicleRfidCards.cardUidFingerprint, input.cardFingerprint),
        eq(transportVehicleRfidCards.status, "active")
      )
    )
    .limit(1);
  if (!card || !card.vehicleId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前卡未绑定有效车辆、已停用或不属于本项目",
    });
  const { vehicle } = await getScopedVehicle(
    ctx,
    card.vehicleId,
    input.projectId,
    roleCodes
  );
  if (vehicle.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前车辆未处于可调度状态，不能进入运输闭环",
    });
  if (replayedEvent) {
    const [replayedTrip] = await db
      .select()
      .from(transportTrips)
      .where(eq(transportTrips.id, replayedEvent.tripId))
      .limit(1);
    const replayInput = {
      tripId: replayedEvent.tripId,
      projectId: input.projectId,
      siteId: site.id,
      idempotencyKey: input.idempotencyKey,
      deviceId: reader.deviceCode,
      cardFingerprint: input.cardFingerprint,
      latitude: input.latitude,
      longitude: input.longitude,
      occurredAt: input.occurredAt,
    };
    if (
      !replayedTrip ||
      replayedTrip.projectId !== input.projectId ||
      replayedTrip.vehicleId !== vehicle.id ||
      site.siteType !== replayedEvent.eventType ||
      replayedEvent.payloadFingerprint !==
        createCardEventPayloadFingerprint(replayInput, replayedEvent.eventType)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "该读卡幂等键已用于其他事件，已拒绝重放",
      });
    if (
      replayedEvent.validationStatus === "accepted" &&
      (replayedEvent.eventType === "load"
        ? replayedTrip.loadEventId
        : replayedTrip.unloadEventId) !== replayedEvent.id
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "读卡确认尚未完成，请刷新后核验",
      });
    const singleScanClosed =
      replayedEvent.eventType === "load" &&
      Boolean(getRouteSnapshot(replayedTrip.routeSnapshot).nfcSingleScanClosed);
    return {
      success:
        replayedEvent.validationStatus === "accepted" ||
        replayedEvent.validationStatus === "duplicate",
      duplicate: true,
      needsReview: replayedEvent.validationStatus === "needs_review",
      stage:
        replayedTrip.unloadConfirmedAt || singleScanClosed
          ? ("completed" as const)
          : ("in_transit" as const),
      singleScanClosed,
      unloadOnlyClosed:
        getRouteSnapshot(replayedTrip.routeSnapshot).unloadOnlyCardClose ===
          true &&
        Boolean(replayedTrip.unloadConfirmedAt) &&
        replayedEvent.validationStatus === "accepted",
      tripId: replayedEvent.tripId,
      eventId: replayedEvent.id,
      reason: replayedEvent.validationReason ?? undefined,
    };
  }
  const transitKey = `nfc:${input.projectId}:${card.id}`;
  const activeTrip = await findActiveVehicleTransportTrip(
    db,
    input.projectId,
    vehicle.id
  );

  if (site.siteType === "load") {
    if (activeTrip)
      throw new TRPCError({
        code: "CONFLICT",
        message: `车辆 ${vehicle.plateNo} 已有在途票据 ${activeTrip.tripNo}，请在对应卸土点完成第二次刷卡后再发车`,
      });
    await assertNewFleetTrip(db, input.projectId, vehicle.id, vehicle.plateNo);
    const [route] = await db
      .select()
      .from(transportRoutePresets)
      .where(
        and(
          eq(transportRoutePresets.projectId, input.projectId),
          eq(transportRoutePresets.loadSiteId, site.id),
          eq(transportRoutePresets.status, "active")
        )
      )
      .orderBy(
        desc(transportRoutePresets.isDefault),
        desc(transportRoutePresets.updatedAt)
      )
      .limit(1);
    if (!route)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "当前装土点未配置启用的装卸路线，不能发车",
      });
    const [[unloadSite], [rule]] = await Promise.all([
      db
        .select()
        .from(transportSites)
        .where(eq(transportSites.id, route.unloadSiteId))
        .limit(1),
      db
        .select()
        .from(freightRateRules)
        .where(eq(freightRateRules.id, route.freightRuleId))
        .limit(1),
    ]);
    if (
      !unloadSite ||
      unloadSite.projectId !== input.projectId ||
      unloadSite.siteType !== "unload" ||
      unloadSite.status !== "active"
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "路线卸土点不存在或已停用",
      });
    if (!rule || rule.projectId !== input.projectId || rule.status !== "active")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "路线运价不存在或未生效",
      });
    if (rule.settlementUnit === "ton")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "按吨结算路线须录入实际过磅重量，暂不能由首次刷卡自动发车",
      });
    const singleScanCloseEnabled = await getTransportNfcSingleScanCloseEnabled(
      db,
      input.projectId
    );
    if (singleScanCloseEnabled)
      await assertVehicleMinimumNfcInvoiceInterval(db, {
        projectId: input.projectId,
        vehicleId: vehicle.id,
        plateNo: vehicle.plateNo,
        occurredAt,
        minimumTransitMinutes: effectiveTransportSafety(unloadSite, route)
          .minimumTransitMinutes,
      });
    let theoreticalVolume: number;
    try {
      theoreticalVolume = calculateTheoreticalVolume(
        Number(vehicle.boxLengthMeters),
        Number(vehicle.boxWidthMeters),
        Number(vehicle.boxHeightMeters),
        Number(vehicle.loadFactor)
      );
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    const settlementQuantity =
      rule.settlementUnit === "cubic_meter" ? theoreticalVolume : 1;
    let price;
    try {
      price = calculateTieredFreightAmount({
        actualDistanceKm: Number(route.presetDistanceKm),
        startDistanceKm: Number(rule.startDistanceKm),
        basePricePerUnit: Number(rule.basePricePerUnit),
        stepMeters: rule.stepMeters,
        stepIncreasePerUnit: Number(rule.stepIncreasePerUnit),
        settlementQuantity,
      });
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    const tripNo = createTransportTripNo(input.projectId);
    const routeSnapshot = {
      source: "nfc_dual_reader",
      routePresetId: route.id,
      invoiceMode: "nfc_card",
      settlementUnit: rule.settlementUnit,
      theoreticalVolumeCubicMeters: theoreticalVolume,
      billableSteps: price.billableSteps,
      loadSite: {
        id: site.id,
        name: site.name,
        administratorUserId: site.administratorUserId,
        readerDeviceCode: reader.deviceCode,
      },
      unloadSite: {
        id: unloadSite.id,
        name: unloadSite.name,
        administratorUserId: unloadSite.administratorUserId,
      },
      startLatitude: input.latitude ?? null,
      startLongitude: input.longitude ?? null,
    };
    try {
      await db.insert(transportTrips).values({
        tripNo,
        vehicleId: vehicle.id,
        projectId: input.projectId,
        freightRuleId: rule.id,
        invoiceMode: "nfc_card",
        loadSiteId: site.id,
        unloadSiteId: unloadSite.id,
        startAt: occurredAt,
        actualDistanceKm: String(route.presetDistanceKm),
        volumeCubicMeters: String(theoreticalVolume),
        calculatedUnitPrice: String(price.unitPrice),
        calculatedAmount: String(price.totalAmount),
        routeSnapshot,
        status: "draft",
        nfcTransitKey: transitKey,
        activeVehicleTransitKey: createActiveVehicleTransitKey(
          input.projectId,
          vehicle.id
        ),
      });
    } catch (error) {
      throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
    }
    const [createdTrip] = await db
      .select()
      .from(transportTrips)
      .where(eq(transportTrips.tripNo, tripNo))
      .limit(1);
    if (!createdTrip)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "装土刷卡运输票据创建失败",
      });
    const event = await recordTransportCardEvent(
      ctx,
      {
        tripId: createdTrip.id,
        projectId: input.projectId,
        siteId: site.id,
        idempotencyKey: input.idempotencyKey,
        deviceId: reader.deviceCode,
        cardFingerprint: input.cardFingerprint,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        occurredAt: input.occurredAt,
      },
      "load",
      { singleScanClose: singleScanCloseEnabled }
    );
    const singleScanClosed =
      singleScanCloseEnabled && event.success && !event.needsReview;
    if (singleScanClosed)
      await completeNfcTripBySingleScan(db, {
        tripId: createdTrip.id,
        userId: user.id,
        occurredAt,
        routeSnapshot,
      });
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: singleScanClosed
        ? "nfc_load_create_and_close_trip"
        : "nfc_load_create_transit_trip",
      targetType: "transport_trip",
      targetId: String(createdTrip.id),
      summary: singleScanClosed
        ? `装土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 创建并完成单次刷卡闭环票据 ${tripNo}`
        : `装土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 创建在途票据 ${tripNo}`,
    });
    const loadRecipientUserIds = Array.from(
      new Set(
        [
          site.administratorUserId,
          unloadSite.administratorUserId,
          vehicle.driverUserId,
        ].filter(
          (value): value is number => typeof value === "number" && value > 0
        )
      )
    );
    void notifyOfficialAccountBusinessEventSafely({
      userId: user.id,
      recipientUserIds: loadRecipientUserIds,
      projectId: input.projectId,
      module: "transport",
      eventCode: singleScanClosed
        ? "transport_nfc_single_scan_completed"
        : "transport_nfc_load_departed",
      targetType: "transport_trip",
      targetId: String(createdTrip.id),
      title: singleScanClosed ? "运输刷卡发票已完成闭环" : "运输车辆已装土发车",
      content: singleScanClosed
        ? `车辆 ${vehicle.plateNo} 已在 ${site.name} 完成刷卡发票，系统已按管理员设置直接形成整车运输闭环，运单 ${tripNo} 进入待核验。`
        : `车辆 ${vehicle.plateNo} 已在 ${site.name} 完成装土刷卡，请按路线前往 ${unloadSite.name} 完成卸土闭环。`,
      deepLink: "/mobile/transport",
    }).catch(() => undefined);
    if (event.success && !event.needsReview)
      triggerTransportRiskScan(input.projectId);
    return {
      ...event,
      stage: singleScanClosed
        ? ("completed" as const)
        : ("in_transit" as const),
      singleScanClosed,
      tripId: createdTrip.id,
      tripNo,
      vehiclePlateNo: vehicle.plateNo,
      loadSiteName: site.name,
      unloadSiteName: unloadSite.name,
    };
  }

  if (!activeTrip) {
    const unloadOnlyRoutes = await db
      .select()
      .from(transportRoutePresets)
      .where(
        and(
          eq(transportRoutePresets.projectId, input.projectId),
          eq(transportRoutePresets.unloadSiteId, site.id),
          eq(transportRoutePresets.status, "active"),
          eq(transportRoutePresets.unloadOnlyCloseEnabled, true)
        )
      )
      .orderBy(
        desc(transportRoutePresets.isDefault),
        desc(transportRoutePresets.updatedAt)
      );
    if (!unloadOnlyRoutes.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `车辆 ${vehicle.plateNo} 当前没有可在本卸土点闭环的在途票据；本路线未开启“卸土点补刷卡完成闭环”，请先在装土点刷卡或由超级管理员开启该路线规则`,
      });
    if (unloadOnlyRoutes.length > 1)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "当前卸土点存在多条开启补刷卡的路线，无法安全判断装土路线；请仅保留一条启用规则后再刷卡",
      });
    const route = unloadOnlyRoutes[0];
    const [[loadSite], [rule]] = await Promise.all([
      db
        .select()
        .from(transportSites)
        .where(eq(transportSites.id, route.loadSiteId))
        .limit(1),
      db
        .select()
        .from(freightRateRules)
        .where(eq(freightRateRules.id, route.freightRuleId))
        .limit(1),
    ]);
    if (
      !loadSite ||
      loadSite.projectId !== input.projectId ||
      loadSite.siteType !== "load" ||
      loadSite.status !== "active"
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "补刷卡路线的装土点不存在或已停用，不能自动完成闭环",
      });
    if (!rule || rule.projectId !== input.projectId || rule.status !== "active")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "补刷卡路线的运价不存在或未生效，不能自动完成闭环",
      });
    if (rule.settlementUnit === "ton")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "按吨结算路线须录入实际过磅重量，不能通过卸土补刷卡自动完成",
      });
    await assertNewFleetTrip(db, input.projectId, vehicle.id, vehicle.plateNo);
    let initialSafetyNotice: string | undefined;
    try {
      await assertVehicleMinimumUnloadOnlyScanInterval(db, {
        projectId: input.projectId,
        vehicleId: vehicle.id,
        plateNo: vehicle.plateNo,
        occurredAt,
        minimumTransitMinutes: effectiveTransportSafety(site, route)
          .minimumTransitMinutes,
      });
    } catch (error) {
      if (
        effectiveTransportSafety(site, route).minimumTransitEnabled ||
        !(error instanceof TRPCError) ||
        error.code !== "BAD_REQUEST"
      )
        throw error;
      initialSafetyNotice =
        "卸土点补刷卡的同车连续间隔未达到路线最短时间（时间硬拦截已关闭，已留待核验）";
    }
    let theoreticalVolume: number;
    try {
      theoreticalVolume = calculateTheoreticalVolume(
        Number(vehicle.boxLengthMeters),
        Number(vehicle.boxWidthMeters),
        Number(vehicle.boxHeightMeters),
        Number(vehicle.loadFactor)
      );
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    let price;
    try {
      price = calculateTieredFreightAmount({
        actualDistanceKm: Number(route.presetDistanceKm),
        startDistanceKm: Number(rule.startDistanceKm),
        basePricePerUnit: Number(rule.basePricePerUnit),
        stepMeters: rule.stepMeters,
        stepIncreasePerUnit: Number(rule.stepIncreasePerUnit),
        settlementQuantity: theoreticalVolume,
      });
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    const tripNo = createTransportTripNo(input.projectId, occurredAt);
    const routeSnapshot = {
      source: "nfc_unload_only_reader",
      routePresetId: route.id,
      invoiceMode: "nfc_card",
      settlementUnit: rule.settlementUnit,
      theoreticalVolumeCubicMeters: theoreticalVolume,
      billableSteps: price.billableSteps,
      unloadOnlyCardClose: true,
      unloadOnlyCardClosedAt: occurredAt.toISOString(),
      loadCardRecorded: false,
      loadSite: {
        id: loadSite.id,
        name: loadSite.name,
        administratorUserId: loadSite.administratorUserId,
      },
      unloadSite: {
        id: site.id,
        name: site.name,
        administratorUserId: site.administratorUserId,
        readerDeviceCode: reader.deviceCode,
      },
      endLatitude: input.latitude ?? null,
      endLongitude: input.longitude ?? null,
    };
    const transitKeyForNewTrip = `nfc:${input.projectId}:${card.id}`;
    try {
      await db.insert(transportTrips).values({
        tripNo,
        vehicleId: vehicle.id,
        projectId: input.projectId,
        freightRuleId: rule.id,
        invoiceMode: "nfc_card",
        loadSiteId: loadSite.id,
        unloadSiteId: site.id,
        startAt: occurredAt,
        actualDistanceKm: String(route.presetDistanceKm),
        volumeCubicMeters: String(theoreticalVolume),
        calculatedUnitPrice: String(price.unitPrice),
        calculatedAmount: String(price.totalAmount),
        routeSnapshot,
        status: "draft",
        nfcTransitKey: transitKeyForNewTrip,
        activeVehicleTransitKey: createActiveVehicleTransitKey(
          input.projectId,
          vehicle.id
        ),
      });
    } catch (error) {
      throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
    }
    const [createdTrip] = await db
      .select()
      .from(transportTrips)
      .where(eq(transportTrips.tripNo, tripNo))
      .limit(1);
    if (!createdTrip)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "卸土补刷卡运输票据创建失败",
      });
    const event = await recordTransportCardEvent(
      ctx,
      {
        tripId: createdTrip.id,
        projectId: input.projectId,
        siteId: site.id,
        idempotencyKey: input.idempotencyKey,
        deviceId: reader.deviceCode,
        cardFingerprint: input.cardFingerprint,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        occurredAt: input.occurredAt,
      },
      "unload",
      { unloadOnlyClose: true, initialSafetyNotice }
    );
    if (event.success && !event.needsReview && !event.duplicate) {
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "nfc_unload_only_create_and_close_trip",
        targetType: "transport_trip",
        targetId: String(createdTrip.id),
        summary: `卸土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 按补刷卡规则创建并闭环票据 ${tripNo}；未记录装土刷卡`,
      });
      triggerTransportRiskScan(input.projectId);
    }
    return {
      ...event,
      stage:
        event.success && !event.needsReview
          ? ("completed" as const)
          : ("in_transit" as const),
      singleScanClosed: false,
      unloadOnlyClosed: event.success && !event.needsReview,
      tripId: createdTrip.id,
      tripNo,
      vehiclePlateNo: vehicle.plateNo,
      loadSiteName: loadSite.name,
      unloadSiteName: site.name,
    };
  }
  if (activeTrip.unloadSiteId !== site.id)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前卸土设备与在途票据的路线卸土点不一致，已拒绝闭环",
    });
  const event = await recordTransportCardEvent(
    ctx,
    {
      tripId: activeTrip.id,
      projectId: input.projectId,
      siteId: site.id,
      idempotencyKey: input.idempotencyKey,
      deviceId: reader.deviceCode,
      cardFingerprint: input.cardFingerprint,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      occurredAt: input.occurredAt,
    },
    "unload"
  );
  if (event.success && !event.needsReview && !event.duplicate) {
    await db.insert(auditLogs).values({
      userId: user.id,
      module: "transport",
      action: "nfc_unload_close_transit_trip",
      targetType: "transport_trip",
      targetId: String(activeTrip.id),
      summary: `卸土点设备 ${reader.displayName} 为车辆 ${vehicle.plateNo} 闭环运输票据 ${activeTrip.tripNo}`,
    });
    const loadAdministratorUserId =
      (
        activeTrip.routeSnapshot as {
          loadSite?: { administratorUserId?: number | null };
        } | null
      )?.loadSite?.administratorUserId ?? null;
    const unloadRecipientUserIds = Array.from(
      new Set(
        [
          loadAdministratorUserId,
          site.administratorUserId,
          vehicle.driverUserId,
        ].filter(
          (value): value is number => typeof value === "number" && value > 0
        )
      )
    );
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
  return {
    ...event,
    stage:
      event.success && !event.needsReview
        ? ("completed" as const)
        : ("in_transit" as const),
    singleScanClosed: false,
    tripId: activeTrip.id,
    tripNo: activeTrip.tripNo,
    vehiclePlateNo: vehicle.plateNo,
    loadSiteName:
      (activeTrip.routeSnapshot as { loadSite?: { name?: string } } | null)
        ?.loadSite?.name ?? "装土点",
    unloadSiteName: site.name,
  };
}

/** 将手机触碰卡片 URL 的签名令牌转换为同一套双设备扫描输入；原始 UID 不会进入手机 URL 或服务端日志。 */
async function recordTransportNfcLinkScan(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof transportNfcLinkScanInput>
) {
  const parsed = verifyTransportNfcDeepLinkToken(input.token);
  if (!parsed)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "NFC 卡片入口无效或已被篡改，请重新读取有效车辆卡",
    });
  await assertProjectInCurrentScope(ctx, parsed.projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const [card] = await db
    .select()
    .from(transportVehicleRfidCards)
    .where(eq(transportVehicleRfidCards.id, parsed.cardId))
    .limit(1);
  if (
    !card ||
    card.projectId !== parsed.projectId ||
    card.status !== "active" ||
    card.payloadVersion !== parsed.payloadVersion
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "车辆卡已停用、补写或不属于当前项目，请使用最新有效卡",
    });
  }
  return recordTransportNfcReaderScan(ctx, {
    projectId: parsed.projectId,
    readerDeviceCode: input.readerDeviceCode,
    idempotencyKey: input.idempotencyKey,
    cardFingerprint: card.cardUidFingerprint,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    occurredAt: input.occurredAt,
  });
}

/** 手机开票页只解析签名卡和候选路线，不创建票据；实际开票必须由后续确认操作完成。 */
async function resolveMobileNfcInvoice(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  token: string
) {
  const parsed = verifyTransportNfcDeepLinkToken(token);
  if (!parsed)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "NFC 卡片入口无效或已被篡改，请重新读取有效车辆卡",
    });
  const roleCodes = await assertTransportAccess(ctx);
  await assertProjectInCurrentScope(ctx, parsed.projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const [card] = await db
    .select()
    .from(transportVehicleRfidCards)
    .where(eq(transportVehicleRfidCards.id, parsed.cardId))
    .limit(1);
  if (
    !card ||
    card.projectId !== parsed.projectId ||
    card.status !== "active" ||
    card.payloadVersion !== parsed.payloadVersion ||
    !card.vehicleId
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "车辆卡已停用、已解除绑定、已补写或不属于当前项目，请使用最新有效卡",
    });
  }
  const { vehicle } = await getScopedVehicle(
    ctx,
    card.vehicleId,
    parsed.projectId,
    roleCodes
  );
  if (vehicle.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前车辆未处于可调度状态，不能开具运输发票",
    });
  const activeTrip = await findActiveVehicleTransportTrip(
    db,
    parsed.projectId,
    vehicle.id
  );
  const activeRoutePresetId = activeTrip
    ? Number(
        (activeTrip.routeSnapshot as { routePresetId?: unknown } | null)
          ?.routePresetId
      )
    : 0;
  const [activeRoute] =
    activeTrip &&
    Number.isInteger(activeRoutePresetId) &&
    activeRoutePresetId > 0
      ? await db
          .select()
          .from(transportRoutePresets)
          .where(
            and(
              eq(transportRoutePresets.id, activeRoutePresetId),
              eq(transportRoutePresets.projectId, parsed.projectId),
              eq(transportRoutePresets.status, "active")
            )
          )
          .limit(1)
      : [];
  const routeRows = activeTrip
    ? []
    : await db
        .select()
        .from(transportRoutePresets)
        .where(
          and(
            eq(transportRoutePresets.projectId, parsed.projectId),
            eq(transportRoutePresets.status, "active")
          )
        )
        .orderBy(
          desc(transportRoutePresets.isDefault),
          desc(transportRoutePresets.updatedAt)
        );
  const siteIds = Array.from(
    new Set(
      [
        ...routeRows.flatMap(route => [route.loadSiteId, route.unloadSiteId]),
        activeTrip?.loadSiteId ?? 0,
        activeTrip?.unloadSiteId ?? 0,
      ].filter(Boolean)
    )
  );
  const sites = siteIds.length
    ? (
        await Promise.all(
          siteIds.map(
            async id =>
              (
                await db
                  .select()
                  .from(transportSites)
                  .where(eq(transportSites.id, id))
                  .limit(1)
              )[0]
          )
        )
      ).filter((site): site is typeof transportSites.$inferSelect =>
        Boolean(site)
      )
    : [];
  const siteById = new Map(sites.map(site => [site.id, site]));
  return {
    projectId: parsed.projectId,
    cardId: card.id,
    cardFingerprint: card.cardUidFingerprint,
    vehicle: {
      id: vehicle.id,
      plateNo: vehicle.plateNo,
      driverName: vehicle.driverName ?? null,
      driverPhoneMasked: null,
    },
    routes: routeRows.map(route => ({
      id: route.id,
      isDefault: route.isDefault,
      distanceKm: route.presetDistanceKm,
      loadSiteName: siteById.get(route.loadSiteId)?.name ?? "装土点",
      unloadSiteName: siteById.get(route.unloadSiteId)?.name ?? "卸土点",
    })),
    activeTrip: activeTrip
      ? {
          id: activeTrip.id,
          tripNo: activeTrip.tripNo,
          invoiceMode: activeTrip.invoiceMode ?? "nfc_card",
          loadConfirmed: Boolean(activeTrip.loadConfirmedAt),
          loadSiteName:
            siteById.get(activeTrip.loadSiteId ?? 0)?.name ?? "装土点",
          unloadSiteName:
            siteById.get(activeTrip.unloadSiteId ?? 0)?.name ?? "卸土点",
          unloadOnlyCloseEnabled: Boolean(activeRoute?.unloadOnlyCloseEnabled),
        }
      : null,
  };
}

/** 手机已识别车辆后，选择路线一次确认发车；存在在途票据时同一确认动作完成卸土闭环。 */
async function confirmMobileNfcInvoice(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof mobileNfcInvoiceConfirmInput>
) {
  const user = requireAuthenticatedUser(ctx);
  const resolved = await resolveMobileNfcInvoice(ctx, input.token);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const occurredAt = new Date(input.occurredAt);
  const [card] = await db
    .select()
    .from(transportVehicleRfidCards)
    .where(eq(transportVehicleRfidCards.id, resolved.cardId))
    .limit(1);
  if (
    !card ||
    card.projectId !== resolved.projectId ||
    card.vehicleId !== resolved.vehicle.id ||
    card.status !== "active" ||
    card.cardUidFingerprint !== resolved.cardFingerprint
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "车辆卡已失效或绑定已变更，请重新刷卡",
    });
  // 先识别该确认的重放，再决定开票/卸土；已闭环重试不能落入创建下一趟的分支。
  const [replayedEvent] = await db
    .select()
    .from(transportCardEvents)
    .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (replayedEvent) {
    const [replayedTrip] = await db
      .select()
      .from(transportTrips)
      .where(eq(transportTrips.id, replayedEvent.tripId))
      .limit(1);
    const replayInput = {
      tripId: replayedEvent.tripId,
      projectId: resolved.projectId,
      siteId: replayedEvent.siteId,
      idempotencyKey: input.idempotencyKey,
      deviceId: "MOBILE-NFC",
      cardFingerprint: card.cardUidFingerprint,
      latitude:
        replayedEvent.eventType === "unload" ? input.latitude : undefined,
      longitude:
        replayedEvent.eventType === "unload" ? input.longitude : undefined,
      occurredAt: input.occurredAt,
    };
    if (
      !replayedTrip ||
      replayedTrip.projectId !== resolved.projectId ||
      replayedTrip.vehicleId !== resolved.vehicle.id ||
      (input.expectedUnloadTripId !== undefined &&
        (input.expectedUnloadTripId !== replayedTrip.id ||
          replayedEvent.eventType !== "unload")) ||
      replayedEvent.payloadFingerprint !==
        createCardEventPayloadFingerprint(replayInput, replayedEvent.eventType)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该刷卡幂等键已用于其他确认，已拒绝重放",
      });
    }
    if (replayedEvent.validationStatus === "needs_review")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          replayedEvent.validationReason || "刷卡异常，当前运单仍需人工核验",
      });
    if (
      replayedTrip.status === "void" ||
      (replayedEvent.eventType === "unload"
        ? replayedTrip.unloadEventId
        : replayedTrip.loadEventId) !== replayedEvent.id
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "刷卡确认尚未完成或状态已变更，请刷新后核验",
      });
    const singleScanClosed =
      replayedEvent.eventType === "load" &&
      Boolean(getRouteSnapshot(replayedTrip.routeSnapshot).nfcSingleScanClosed);
    return {
      success: true,
      duplicate: true,
      needsReview: false,
      eventId: replayedEvent.id,
      stage:
        replayedEvent.eventType === "unload" || singleScanClosed
          ? ("completed" as const)
          : ("in_transit" as const),
      singleScanClosed,
      tripNo: replayedTrip.tripNo,
      vehiclePlateNo: resolved.vehicle.plateNo,
    };
  }
  if (
    input.expectedUnloadTripId !== undefined &&
    resolved.activeTrip?.id !== input.expectedUnloadTripId
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "读取车辆卡与待卸土运单不一致，或该运单已完成卸土，请刷新后重新确认",
    });
  if (resolved.activeTrip) {
    const [trip] = await db
      .select()
      .from(transportTrips)
      .where(eq(transportTrips.id, resolved.activeTrip.id))
      .limit(1);
    if (
      !trip ||
      trip.projectId !== resolved.projectId ||
      trip.vehicleId !== resolved.vehicle.id
    )
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "当前在途运单不存在或车辆绑定已变更",
      });
    const event = await recordTransportCardEvent(
      ctx,
      {
        tripId: trip.id,
        projectId: resolved.projectId,
        siteId: trip.unloadSiteId,
        idempotencyKey: input.idempotencyKey,
        deviceId: "MOBILE-NFC",
        cardFingerprint: card.cardUidFingerprint,
        latitude: input.latitude,
        longitude: input.longitude,
        occurredAt: input.occurredAt,
      },
      "unload"
    );
    if (!event.success || event.needsReview) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          event.reason || "卸土异常，当前运单仍在运输中，不能显示卸土成功",
      });
    }
    if (!event.duplicate) triggerTransportRiskScan(resolved.projectId);
    return {
      ...event,
      stage: "completed" as const,
      singleScanClosed: false,
      tripNo: trip.tripNo,
      vehiclePlateNo: resolved.vehicle.plateNo,
    };
  }
  if (!input.routePresetId)
    throw new TRPCError({ code: "BAD_REQUEST", message: "请先选择运输线路" });
  const [route] = await db
    .select()
    .from(transportRoutePresets)
    .where(eq(transportRoutePresets.id, input.routePresetId))
    .limit(1);
  if (
    !route ||
    route.projectId !== resolved.projectId ||
    route.status !== "active"
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "选择的运输线路不存在、已停用或不属于当前项目",
    });
  const [[vehicle], [loadSite], [unloadSite], [rule]] = await Promise.all([
    db
      .select()
      .from(transportVehicles)
      .where(eq(transportVehicles.id, resolved.vehicle.id))
      .limit(1),
    db
      .select()
      .from(transportSites)
      .where(eq(transportSites.id, route.loadSiteId))
      .limit(1),
    db
      .select()
      .from(transportSites)
      .where(eq(transportSites.id, route.unloadSiteId))
      .limit(1),
    db
      .select()
      .from(freightRateRules)
      .where(eq(freightRateRules.id, route.freightRuleId))
      .limit(1),
  ]);
  if (
    !vehicle ||
    vehicle.status !== "active" ||
    !loadSite ||
    loadSite.status !== "active" ||
    !unloadSite ||
    unloadSite.status !== "active" ||
    !rule ||
    rule.status !== "active"
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "车辆、路线地点或运价已变更，请重新刷卡后开票",
    });
  await assertNewFleetTrip(db, resolved.projectId, vehicle.id, vehicle.plateNo);
  if (rule.settlementUnit === "ton")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "按吨结算路线须录入实际过磅重量，不能自动开票",
    });
  const singleScanCloseEnabled = await getTransportNfcSingleScanCloseEnabled(
    db,
    resolved.projectId
  );
  if (singleScanCloseEnabled)
    await assertVehicleMinimumNfcInvoiceInterval(db, {
      projectId: resolved.projectId,
      vehicleId: vehicle.id,
      plateNo: vehicle.plateNo,
      occurredAt,
      minimumTransitMinutes: effectiveTransportSafety(unloadSite, route)
        .minimumTransitMinutes,
    });
  let theoreticalVolume: number;
  try {
    theoreticalVolume = calculateTheoreticalVolume(
      Number(vehicle.boxLengthMeters),
      Number(vehicle.boxWidthMeters),
      Number(vehicle.boxHeightMeters),
      Number(vehicle.loadFactor)
    );
  } catch (error) {
    throwDomainAsBadRequest(error);
  }
  let price;
  try {
    price = calculateTieredFreightAmount({
      actualDistanceKm: Number(route.presetDistanceKm),
      startDistanceKm: Number(rule.startDistanceKm),
      basePricePerUnit: Number(rule.basePricePerUnit),
      stepMeters: rule.stepMeters,
      stepIncreasePerUnit: Number(rule.stepIncreasePerUnit),
      settlementQuantity:
        rule.settlementUnit === "cubic_meter" ? theoreticalVolume : 1,
    });
  } catch (error) {
    throwDomainAsBadRequest(error);
  }
  const tripNo = createTransportTripNo(resolved.projectId, occurredAt);
  const transitKey = `nfc:${resolved.projectId}:${card.id}`;
  try {
    await db.insert(transportTrips).values({
      tripNo,
      vehicleId: vehicle.id,
      projectId: resolved.projectId,
      freightRuleId: rule.id,
      invoiceMode: "nfc_card",
      loadSiteId: loadSite.id,
      unloadSiteId: unloadSite.id,
      startAt: occurredAt,
      actualDistanceKm: String(route.presetDistanceKm),
      volumeCubicMeters: String(theoreticalVolume),
      calculatedUnitPrice: String(price.unitPrice),
      calculatedAmount: String(price.totalAmount),
      routeSnapshot: {
        source: "mobile_nfc_invoice",
        routePresetId: route.id,
        invoiceMode: "nfc_card",
        settlementUnit: rule.settlementUnit,
        theoreticalVolumeCubicMeters: theoreticalVolume,
        billableSteps: price.billableSteps,
        loadSite: {
          id: loadSite.id,
          name: loadSite.name,
          administratorUserId: loadSite.administratorUserId,
        },
        unloadSite: {
          id: unloadSite.id,
          name: unloadSite.name,
          administratorUserId: unloadSite.administratorUserId,
        },
      },
      status: "draft",
      nfcTransitKey: transitKey,
      activeVehicleTransitKey: createActiveVehicleTransitKey(
        resolved.projectId,
        vehicle.id
      ),
    });
  } catch (error) {
    throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
  }
  const [createdTrip] = await db
    .select()
    .from(transportTrips)
    .where(eq(transportTrips.tripNo, tripNo))
    .limit(1);
  if (!createdTrip)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "运输开票保存失败",
    });
  const event = await recordTransportCardEvent(
    ctx,
    {
      tripId: createdTrip.id,
      projectId: resolved.projectId,
      siteId: loadSite.id,
      idempotencyKey: input.idempotencyKey,
      deviceId: "MOBILE-NFC",
      cardFingerprint: card.cardUidFingerprint,
      occurredAt: input.occurredAt,
    },
    "load",
    { singleScanClose: singleScanCloseEnabled }
  );
  const singleScanClosed =
    singleScanCloseEnabled && event.success && !event.needsReview;
  const mobileNfcTripOrdinal =
    event.success && !event.needsReview && "dailyVehicleTripOrdinal" in event
      ? event.dailyVehicleTripOrdinal
      : null;
  const mobileNfcTripText = mobileNfcTripOrdinal
    ? `车辆 ${vehicle.plateNo} 今日第 ${mobileNfcTripOrdinal} 车装土成功，`
    : `车辆 ${vehicle.plateNo} `;
  if (singleScanClosed)
    await completeNfcTripBySingleScan(db, {
      tripId: createdTrip.id,
      userId: user.id,
      occurredAt,
      routeSnapshot: createdTrip.routeSnapshot,
    });
  void notifyOfficialAccountBusinessEventSafely({
    userId: user.id,
    recipientUserIds: Array.from(
      new Set(
        [
          loadSite.administratorUserId,
          unloadSite.administratorUserId,
          vehicle.driverUserId,
        ].filter(
          (value): value is number => typeof value === "number" && value > 0
        )
      )
    ),
    projectId: resolved.projectId,
    module: "transport",
    eventCode: singleScanClosed
      ? "transport_mobile_nfc_invoice_completed"
      : "transport_mobile_nfc_invoice_departed",
    targetType: "transport_trip",
    targetId: String(createdTrip.id),
    title: singleScanClosed ? "运输 NFC 发票已完成闭环" : "运输 NFC 发票已开具",
    content: singleScanClosed
      ? `${mobileNfcTripText}已开具运单 ${tripNo}，系统已按管理员设置直接完成整车运输闭环。`
      : `${mobileNfcTripText}已开具运单 ${tripNo}，请按路线从 ${loadSite.name} 前往 ${unloadSite.name}。`,
    deepLink: "/mobile/transport",
  }).catch(() => undefined);
  notifyExternalDriverWechat({
    vehicleId: vehicle.id,
    projectId: resolved.projectId,
    eventCode: singleScanClosed
      ? "transport_mobile_nfc_invoice_completed"
      : "transport_mobile_nfc_invoice_departed",
    targetType: "transport_trip",
    targetId: String(createdTrip.id),
    title: singleScanClosed ? "运输 NFC 发票已完成闭环" : "运输 NFC 发票已开具",
    content: singleScanClosed
      ? `${mobileNfcTripText}已开具运单 ${tripNo}，系统已按管理员设置直接完成整车运输闭环。`
      : `${mobileNfcTripText}已开具运单 ${tripNo}，请按路线从 ${loadSite.name} 前往 ${unloadSite.name}。`,
    deepLink: "/mobile/transport",
  });
  if (event.success && !event.needsReview)
    triggerTransportRiskScan(resolved.projectId);
  await db.insert(auditLogs).values({
    userId: user.id,
    module: "transport",
    action: "mobile_nfc_invoice_created",
    targetType: "transport_trip",
    targetId: String(createdTrip.id),
    summary: `手机刷 NFC 卡开具运输发票 ${tripNo}：${vehicle.plateNo}，${loadSite.name} → ${unloadSite.name}`,
  });
  return {
    ...event,
    stage: singleScanClosed ? ("completed" as const) : ("in_transit" as const),
    singleScanClosed,
    tripNo,
    vehiclePlateNo: vehicle.plateNo,
  };
}

/** 返回用户有权访问的项目选项，项目/组织范围均以服务端授权记录为准。 */
async function listScopedProjects(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  const scope = await getCurrentDataScope(ctx);
  const db = await getDb();
  if (!db) return [];
  const allProjects = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      status: projects.status,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .orderBy(projects.sortOrder, projects.id);
  if (scope.hasAllProjects) return allProjects;
  return allProjects.filter(
    project =>
      scope.projectIds.includes(project.id) ||
      (project.organizationId !== null &&
        scope.organizationIds.includes(project.organizationId))
  );
}

/** 机械模块允许的岗位；管理员角色对应 ALL，可覆盖初始化和应急处置。 */
async function assertMachineryAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  await assertDepartmentBusinessAccess(ctx, "MACHINERY");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["MACHINERY_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"];
  const hasUserSpecificReadPermission =
    await hasUserSpecificOperationPermission(ctx, "MACHINERY", "read");
  if (
    !roleCodes.includes("ALL") &&
    !roleCodes.some(role => allowed.includes(role)) &&
    !hasUserSpecificReadPermission
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位未获机械管理数据访问授权",
    });
  }
  return roleCodes;
}

/**
 * 机械老板只读门户仅以机械档案 ownerUserId 显式绑定为边界。
 * 不要求或授予机械部门、项目、录入、审核和付款权限。
 */
async function getMachineOwnerPortalRows(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  const user = requireAuthenticatedUser(ctx);
  if (user.loginMethod === "local_driver") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "司机手机号账号仅能查看本人操作机械或绑定车辆，不能作为机械老板查询",
    });
  }
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const ownedMachines = await db
    .select()
    .from(machines)
    .where(eq(machines.ownerUserId, user.id))
    .orderBy(desc(machines.updatedAt));
  return { db, ownedMachines };
}

/** 运输模块允许的岗位；司机角色只可操作分配给本人的车辆及趟次。 */
async function assertTransportAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0]
) {
  const user = requireAuthenticatedUser(ctx);
  if (user.loginMethod === "local_driver") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "司机手机号账号仅可进入本人绑定车辆的运费账单，不提供运输管理功能",
    });
  }
  await assertDepartmentBusinessAccess(ctx, "TRANSPORT");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = [
    "TRANSPORT_MANAGER",
    "DRIVER",
    "PROJECT_MANAGER",
    "FINANCE_MANAGER",
    "ACCOUNTANT",
  ];
  const hasUserSpecificReadPermission =
    await hasUserSpecificOperationPermission(ctx, "TRANSPORT", "read");
  if (
    !roleCodes.includes("ALL") &&
    !roleCodes.some(role => allowed.includes(role)) &&
    !hasUserSpecificReadPermission
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位未获运输管理数据访问授权",
    });
  }
  return roleCodes;
}

/** 结算状态变更仅由机械/运输负责人、项目负责人、财务或系统管理员处理。 */
function canManageSettlement(roleCodes: readonly string[]) {
  return (
    roleCodes.includes("ALL") ||
    roleCodes.some(role =>
      [
        "MACHINERY_MANAGER",
        "TRANSPORT_MANAGER",
        "PROJECT_MANAGER",
        "FINANCE_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    )
  );
}

/** 财务结算确认只能由财务负责人、会计或系统管理员完成。 */
function canSettleFinancialRecord(roleCodes: readonly string[]) {
  return (
    roleCodes.includes("ALL") ||
    roleCodes.includes("FINANCE_MANAGER") ||
    roleCodes.includes("ACCOUNTANT")
  );
}

/** 按项目读取机械并校验数据范围；防止客户端以机械 ID 越权修改别的项目台账。 */
async function getScopedMachine(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  machineId: number,
  projectId: number
) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const [machine] = await db
    .select()
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);
  if (!machine || machine.projectId !== projectId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到指定项目下的机械台账",
    });
  }
  return { db, machine };
}

/** 复用会计模板的月度明细预览，避免保存接口通过路由自身调用而产生循环类型依赖。 */
async function buildMachineMonthlyStatementPreview(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  input: z.infer<typeof machineMonthlyStatementInput>
) {
  const { db, machine } = await getScopedMachine(
    ctx,
    input.machineId,
    input.projectId
  );
  const range = getMonthRange(input.period);
  const rules = await db
    .select()
    .from(machineLeaseRules)
    .where(
      and(
        eq(machineLeaseRules.machineId, input.machineId),
        eq(machineLeaseRules.projectId, input.projectId),
        eq(machineLeaseRules.status, "active")
      )
    )
    .orderBy(desc(machineLeaseRules.effectiveFrom));
  const rule = rules.find(
    item =>
      new Date(item.effectiveFrom).getTime() < range.endExclusive.getTime() &&
      (!item.effectiveTo ||
        new Date(item.effectiveTo).getTime() >= range.start.getTime())
  );
  if (!rule)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前结算期间未找到生效的机械租赁/计价规则",
    });
  const [costRows, maintenanceRows] = await Promise.all([
    db
      .select()
      .from(machineCostRecords)
      .where(
        and(
          eq(machineCostRecords.machineId, input.machineId),
          eq(machineCostRecords.projectId, input.projectId),
          ne(machineCostRecords.status, "void"),
          gte(machineCostRecords.occurredAt, range.start),
          lt(machineCostRecords.occurredAt, range.endExclusive)
        )
      ),
    db
      .select()
      .from(assetMaintenanceRecords)
      .where(
        and(
          eq(assetMaintenanceRecords.assetType, "machine"),
          eq(assetMaintenanceRecords.assetId, input.machineId),
          eq(assetMaintenanceRecords.projectId, input.projectId),
          ne(assetMaintenanceRecords.status, "void"),
          gte(assetMaintenanceRecords.occurredAt, range.start),
          lt(assetMaintenanceRecords.occurredAt, range.endExclusive)
        )
      ),
  ]);
  const repairAmount =
    costRows
      .filter(item => item.costType === "repair")
      .reduce((sum, item) => sum + Number(item.amount), 0) +
    maintenanceRows
      .filter(item => item.costCategory === "repair")
      .reduce((sum, item) => sum + Number(item.amount), 0);
  const fuelRows = costRows.filter(item => item.costType === "fuel");
  const fuelLiters = fuelRows.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  );
  const fuelAmount = fuelRows.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const statement = calculateMonthlyMachineStatement({
    billingType: rule.billingType,
    rate: Number(rule.rate),
    overtimeHourlyRate: Number(rule.overtimeHourlyRate),
    machineWorkDays: input.machineWorkDays,
    machineOvertimeHours: input.machineOvertimeHours,
    driverMonthlyWage: input.driverMonthlyWage,
    driverWorkDays: input.driverWorkDays,
    driverOvertimeHours: input.driverOvertimeHours,
    repairAmount,
    fuelLiters,
    fuelAmount,
  });
  const driverUserId = input.driverUserId ?? machine.operatorUserId;
  const [driver] = driverUserId
    ? await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, driverUserId))
        .limit(1)
    : [];
  return {
    machine: {
      id: machine.id,
      code: machine.code,
      name: machine.name,
      model: machine.model,
      ownerName:
        machine.ownership === "leased"
          ? (machine.supplierName ?? "未登记出租方")
          : "公司自有",
      driverUserId,
      driverName: driver?.name ?? "未分配",
    },
    rule: {
      billingType: rule.billingType,
      rate: Number(rule.rate),
      overtimeHourlyRate: Number(rule.overtimeHourlyRate),
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
    },
    statement,
    source: {
      costRecordCount: costRows.length,
      maintenanceRecordCount: maintenanceRows.length,
    },
  };
}

/** 读取并校验车辆归属项目，司机还需满足本人被绑定到该车辆的最小权限要求。 */
async function getScopedVehicle(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  vehicleId: number,
  projectId: number,
  roleCodes: readonly string[]
) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
  const [vehicle] = await db
    .select()
    .from(transportVehicles)
    .where(eq(transportVehicles.id, vehicleId))
    .limit(1);
  if (!vehicle || vehicle.projectId !== projectId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "未找到指定项目下的运输车辆",
    });
  }
  const user = requireAuthenticatedUser(ctx);
  const isDriverOnly =
    roleCodes.includes("DRIVER") &&
    !roleCodes.some(role =>
      [
        "ALL",
        "TRANSPORT_MANAGER",
        "PROJECT_MANAGER",
        "FINANCE_MANAGER",
        "ACCOUNTANT",
      ].includes(role)
    );
  if (isDriverOnly && vehicle.driverUserId !== user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "司机仅可操作分配给本人的运输车辆",
    });
  }
  return { db, vehicle };
}

/** 机械台账、租赁计价、成本记录和月度结算预览。 */
export const machineryRouter = router({
  /** 只读能力投影：部门、项目、现有岗位和详细操作权限共同收口；不能替代 mutation 鉴权。 */
  workspaceCapabilities: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const [create, edit, submit, review, settle, voidDecision] =
        await Promise.all(
          (
            ["create", "edit", "submit", "review", "settle", "void"] as const
          ).map(action =>
            getRoleOperationPermissionDecision(ctx, "MACHINERY", action)
          )
        );
      let canPay = false;
      if (canSettleFinancialRecord(roleCodes)) {
        try {
          await assertDepartmentBusinessAccess(ctx, "FINANCE", "create");
          await assertProjectInCurrentScope(ctx, input.projectId);
          canPay = true;
        } catch (error) {
          if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN")
            throw error;
        } finally {
          await assertDepartmentBusinessAccess(ctx, "MACHINERY");
        }
      }
      return {
        canCreate: create.allowed,
        canEdit: edit.allowed,
        canManage:
          canManageSettlement(roleCodes) &&
          submit.allowed &&
          voidDecision.allowed,
        canApprove: canSettleFinancialRecord(roleCodes) && review.allowed,
        canSettle: canSettleFinancialRecord(roleCodes) && settle.allowed,
        canPay,
      };
    }),

  /** 司机加班列表为当前授权项目和自然月的全量安全业务字段，不返回账户或存储链接。 */
  listDailyOperations: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
        machineId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (input.machineId)
        await getScopedMachine(ctx, input.machineId, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const range = getMonthRange(input.period);
      const predicates = [
        eq(machineDailyOperations.projectId, input.projectId),
        gte(machineDailyOperations.occurredOn, range.start),
        lt(machineDailyOperations.occurredOn, range.endExclusive),
      ];
      if (input.machineId)
        predicates.push(eq(machineDailyOperations.machineId, input.machineId));
      const [rows, machineRows] = await Promise.all([
        db
          .select()
          .from(machineDailyOperations)
          .where(and(...predicates))
          .orderBy(
            desc(machineDailyOperations.occurredOn),
            desc(machineDailyOperations.id)
          ),
        db
          .select({ id: machines.id, name: machines.name, code: machines.code })
          .from(machines)
          .where(eq(machines.projectId, input.projectId)),
      ]);
      const names = new Map(machineRows.map(row => [row.id, row]));
      return rows.map(row => ({
        id: row.id,
        machineId: row.machineId,
        projectId: row.projectId,
        date: chinaBusinessDate(row.occurredOn),
        machineName: names.get(row.machineId)?.name ?? "机械已归档",
        machineCode: names.get(row.machineId)?.code ?? "",
        driverName: row.driverNameSnapshot,
        overtimeHours: Number(row.overtimeHours),
        overtimeHourlyRate: Number(row.overtimeHourlyRate),
        overtimeAmount: Number(row.overtimeAmount),
        status: row.status,
        remarks: row.remarks ?? null,
        legacyShiftCount: Number(row.shiftCount),
      }));
    }),
  /** 机械老板专属只读门户：只返回机械档案显式绑定给当前账号的设备与费用清单。 */
  ownerExpensePortal: protectedProcedure.query(async ({ ctx }) => {
    const { db, ownedMachines } = await getMachineOwnerPortalRows(ctx);
    if (!ownedMachines.length)
      return { status: "unbound" as const, machines: [] };
    const projectIds = Array.from(
      new Set(
        ownedMachines.flatMap(machine =>
          machine.projectId ? [machine.projectId] : []
        )
      )
    );
    const projectRows = projectIds.length
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [];
    const projectNameById = new Map(
      projectRows.map(project => [project.id, project.name])
    );
    const result = await Promise.all(
      ownedMachines.map(async machine => {
        const projectId = machine.projectId ?? -1;
        const [costRows, activeRules, statementRows, paymentRows] =
          await Promise.all([
            db
              .select()
              .from(machineCostRecords)
              .where(
                and(
                  eq(machineCostRecords.machineId, machine.id),
                  eq(machineCostRecords.projectId, projectId),
                  ne(machineCostRecords.status, "void")
                )
              )
              .orderBy(desc(machineCostRecords.occurredAt))
              .limit(100),
            db
              .select()
              .from(machineLeaseRules)
              .where(
                and(
                  eq(machineLeaseRules.machineId, machine.id),
                  eq(machineLeaseRules.projectId, projectId),
                  eq(machineLeaseRules.status, "active")
                )
              )
              .orderBy(desc(machineLeaseRules.effectiveFrom))
              .limit(1),
            db
              .select()
              .from(machineMonthlyStatements)
              .where(
                and(
                  eq(machineMonthlyStatements.machineId, machine.id),
                  eq(machineMonthlyStatements.projectId, projectId)
                )
              )
              .orderBy(desc(machineMonthlyStatements.period))
              .limit(24),
            db
              .select()
              .from(machinePaymentSettlements)
              .where(
                and(
                  eq(machinePaymentSettlements.machineId, machine.id),
                  eq(machinePaymentSettlements.projectId, projectId),
                  ne(machinePaymentSettlements.status, "void")
                )
              )
              .orderBy(desc(machinePaymentSettlements.period))
              .limit(24),
          ]);
        const expenses = costRows.map(row => ({
          id: row.id,
          costType: row.costType,
          costName: row.costName ?? "未命名费用",
          quantity: Number(row.quantity),
          unitPrice: Number(row.unitPrice),
          amount: Number(row.amount),
          occurredAt: row.occurredAt,
          remarks: row.remarks ?? null,
          status: row.status,
        }));
        const activeRule = activeRules[0] ?? null;
        const settlementIds = paymentRows.map(row => row.id);
        const paymentRecordRows = settlementIds.length
          ? await db
              .select()
              .from(settlementPaymentRecords)
              .where(
                and(
                  eq(settlementPaymentRecords.projectId, projectId),
                  eq(settlementPaymentRecords.settlementType, "machine"),
                  eq(settlementPaymentRecords.direction, "expense"),
                  eq(settlementPaymentRecords.status, "active"),
                  inArray(settlementPaymentRecords.settlementId, settlementIds)
                )
              )
              .orderBy(desc(settlementPaymentRecords.paymentDate))
          : [];
        const paidBySettlementId = new Map<number, number>();
        for (const row of paymentRecordRows) {
          paidBySettlementId.set(
            row.settlementId,
            Math.round(
              ((paidBySettlementId.get(row.settlementId) ?? 0) +
                Number(row.amount)) *
                100
            ) / 100
          );
        }
        const monthlyStatements = statementRows.map(row => ({
          id: row.id,
          period: row.period,
          totalOutput: Number(row.totalOutput),
          repairAmount: Number(row.repairAmount),
          fuelAmount: Number(row.fuelAmount),
          machineShareAmount: Number(row.machineShareAmount),
          status: row.status,
        }));
        const settlements = paymentRows.map(row => {
          const paidAmount = paidBySettlementId.get(row.id) ?? 0;
          return {
            id: row.id,
            settlementNo: row.settlementNo,
            period: row.period,
            grossPayableAmount: Number(row.grossPayableAmount),
            fuelCostAmount: Number(row.fuelCostAmount),
            repairCostAmount: Number(row.repairCostAmount),
            manualDeductionAmount: Number(row.manualDeductionAmount),
            netPayableAmount: Number(row.netPayableAmount),
            paidAmount,
            outstandingAmount: Math.max(
              0,
              Math.round((Number(row.netPayableAmount) - paidAmount) * 100) /
                100
            ),
            paymentMethod: row.paymentMethod,
            paymentDate: row.paymentDate,
            paymentReference: row.paymentReference,
            status: row.status,
          };
        });
        const sumByType = (
          costType: typeof machineCostRecords.$inferSelect.costType
        ) =>
          Math.round(
            expenses
              .filter(item => item.costType === costType)
              .reduce((sum, item) => sum + item.amount, 0) * 100
          ) / 100;
        return {
          machine: {
            id: machine.id,
            projectId: machine.projectId,
            projectName: machine.projectId
              ? (projectNameById.get(machine.projectId) ?? "项目已归档")
              : "未分配项目",
            code: machine.code,
            name: machine.name,
            model: machine.model ?? null,
            plateOrAssetNo: machine.plateOrAssetNo ?? null,
            ownership: machine.ownership,
            supplierName: machine.supplierName ?? null,
            status: machine.status,
            leaseRule: activeRule
              ? {
                  billingType: activeRule.billingType,
                  rate: Number(activeRule.rate),
                  overtimeHourlyRate: Number(activeRule.overtimeHourlyRate),
                }
              : null,
          },
          summary: {
            expenseCount: expenses.length,
            totalExpense:
              Math.round(
                expenses.reduce((sum, item) => sum + item.amount, 0) * 100
              ) / 100,
            fuelExpense: sumByType("fuel"),
            repairExpense: sumByType("repair"),
            overtimeExpense: sumByType("overtime"),
            statementCount: monthlyStatements.length,
            settlementCount: settlements.length,
            settlementAmount:
              Math.round(
                settlements.reduce(
                  (sum, item) => sum + item.netPayableAmount,
                  0
                ) * 100
              ) / 100,
            paidAmount:
              Math.round(
                settlements.reduce((sum, item) => sum + item.paidAmount, 0) *
                  100
              ) / 100,
            outstandingAmount:
              Math.round(
                settlements.reduce(
                  (sum, item) => sum + item.outstandingAmount,
                  0
                ) * 100
              ) / 100,
          },
          expenses,
          monthlyStatements,
          settlements,
        };
      })
    );
    return { status: "ready" as const, machines: result };
  }),

  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertMachineryAccess(ctx);
    return listScopedProjects(ctx);
  }),

  /** 费用录入仅展示当前项目、当前加油发生时间有效的指导价；保存时仍会重新匹配。 */
  fuelCostDefault: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        occurredAt: isoDateTimeSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const occurredAt = new Date(input.occurredAt);
      if (Number.isNaN(occurredAt.getTime()))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "加油发生时间无效",
        });
      const matched = await getEffectiveDieselGuidelinePrice(
        db,
        input.projectId,
        occurredAt
      );
      return {
        occurredOn: matched.businessDate,
        guidelinePrice: matched.price?.pricePerLiter ?? null,
        guidelinePriceId: matched.price?.id ?? null,
        effectiveFrom: matched.price?.effectiveFrom ?? null,
        effectiveTo: matched.price?.effectiveTo ?? null,
      };
    }),

  listMachines: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(machines)
        .where(eq(machines.projectId, input.projectId))
        .orderBy(desc(machines.updatedAt));
      return Promise.all(
        rows.map(async machine => {
          const rules = await db
            .select()
            .from(machineLeaseRules)
            .where(eq(machineLeaseRules.machineId, machine.id))
            .orderBy(desc(machineLeaseRules.createdAt));
          const activeRule = rules.find(
            rule =>
              rule.projectId === input.projectId && rule.status === "active"
          );
          const [operator] = machine.operatorUserId
            ? await db
                .select({ name: users.name })
                .from(users)
                .where(eq(users.id, machine.operatorUserId))
                .limit(1)
            : [];
          const [owner] = machine.ownerUserId
            ? await db
                .select({ name: users.name })
                .from(users)
                .where(eq(users.id, machine.ownerUserId))
                .limit(1)
            : [];
          const { driverPhoneEncrypted, ...machineSafe } = machine;
          return {
            ...machineSafe,
            operatorName: operator?.name ?? null,
            ownerName: owner?.name ?? null,
            driverPhone: driverPhoneEncrypted
              ? decryptSecret(driverPhoneEncrypted)
              : null,
            leaseTerms: activeRule
              ? {
                  billingType: activeRule.billingType,
                  rate: activeRule.rate,
                  effectiveFrom: activeRule.effectiveFrom,
                  effectiveTo: activeRule.effectiveTo,
                }
              : null,
          };
        })
      );
    }),

  /** 新建或维护机械台账；跨项目编辑时需同时校验原项目和目标项目授权。 */
  saveMachine: protectedProcedure
    .input(machineInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.id ? "edit" : "create"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      return db.transaction(async db => {
        let existing: typeof machines.$inferSelect | undefined;
        if (input.id) {
          const [row] = await db
            .select()
            .from(machines)
            .where(eq(machines.id, input.id))
            .limit(1)
            .for("update");
          if (!row)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "机械台账不存在",
            });
          if (row.projectId)
            await assertProjectInCurrentScope(ctx, row.projectId);
          existing = row;
        }
        const ownerUserId =
          input.ownerUserId === undefined
            ? (existing?.ownerUserId ?? null)
            : input.ownerUserId;
        if (ownerUserId) {
          const [owner] = await db
            .select({
              id: users.id,
              loginMethod: users.loginMethod,
              localAccountStatus: users.localAccountStatus,
            })
            .from(users)
            .where(eq(users.id, ownerUserId))
            .limit(1);
          if (!owner || owner.localAccountStatus !== "active") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "请选择启用中的机械老板账号",
            });
          }
          if (owner.loginMethod === "local_driver") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "司机手机号账号只能查看本人操作机械，不能绑定为机械老板",
            });
          }
        }
        const targetPersonId =
          input.operatorPersonId === undefined
            ? (existing?.operatorPersonId ?? null)
            : input.operatorPersonId;
        if (targetPersonId)
          await resolveResourcePerson(db, {
            personId: targetPersonId,
            assetType: "machine",
            projectId: input.projectId,
            previousUserId: existing?.operatorUserId ?? null,
            requestedUserId: input.operatorUserId,
          });
        const values = {
          projectId: input.projectId,
          operatorUserId:
            targetPersonId !== null || existing?.operatorPersonId
              ? (existing?.operatorUserId ?? null)
              : input.operatorUserId === undefined
                ? (existing?.operatorUserId ?? null)
                : input.operatorUserId,
          ownerUserId,
          driverName:
            input.driverName === undefined || input.driverName === ""
              ? (existing?.driverName ?? null)
              : input.driverName,
          driverPhoneEncrypted:
            input.driverPhone === undefined || input.driverPhone === ""
              ? (existing?.driverPhoneEncrypted ?? null)
              : input.driverPhone
                ? encryptSecret(input.driverPhone)
                : null,
          driverPhoneMasked:
            input.driverPhone === undefined || input.driverPhone === ""
              ? (existing?.driverPhoneMasked ?? null)
              : input.driverPhone
                ? maskSecret(input.driverPhone)
                : null,
          code: input.code,
          name: input.name,
          model: input.model ?? null,
          ownership: input.ownership,
          supplierName: input.supplierName ?? null,
          plateOrAssetNo: input.plateOrAssetNo ?? null,
          fuelTankCapacityLiters:
            input.fuelTankCapacityLiters === null ||
            input.fuelTankCapacityLiters === undefined
              ? null
              : String(input.fuelTankCapacityLiters),
          status: input.status,
        };
        let machineId = input.id;
        if (input.id) {
          await db
            .update(machines)
            .set(values)
            .where(eq(machines.id, input.id));
        } else {
          await db.insert(machines).values(values);
          const [created] = await db
            .select({ id: machines.id })
            .from(machines)
            .where(eq(machines.code, input.code))
            .limit(1);
          if (!created)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "机械台账保存后未找到记录",
            });
          machineId = created.id;
        }
        if (!machineId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "机械台账标识无效",
          });

        if (targetPersonId !== null || existing?.operatorPersonId)
          await saveResourceBinding(db, {
            personId: targetPersonId,
            assetType: "machine",
            assetId: machineId,
            projectId: input.projectId,
            actorUserId: user.id,
            effectiveFrom: chinaBusinessDate(new Date()),
            requestedUserId: input.operatorUserId,
          });
        const existingRules = await db
          .select()
          .from(machineLeaseRules)
          .where(eq(machineLeaseRules.machineId, machineId))
          .orderBy(desc(machineLeaseRules.createdAt));
        const activeRule = existingRules.find(
          rule => rule.projectId === input.projectId && rule.status === "active"
        );
        if (input.leaseTerms) {
          const leaseValues = {
            machineId,
            projectId: input.projectId,
            billingType: input.leaseTerms.billingType,
            rate: String(roundMoney(input.leaseTerms.rate)),
            overtimeHourlyRate: "0",
            effectiveFrom: toBusinessDate(input.leaseTerms.effectiveFrom),
            effectiveTo: input.leaseTerms.effectiveTo
              ? toBusinessDate(input.leaseTerms.effectiveTo)
              : null,
            status: "active" as const,
          };
          if (activeRule)
            await db
              .update(machineLeaseRules)
              .set(leaseValues)
              .where(eq(machineLeaseRules.id, activeRule.id));
          else await db.insert(machineLeaseRules).values(leaseValues);
        } else if (activeRule) {
          await db
            .update(machineLeaseRules)
            .set({ status: "disabled" })
            .where(eq(machineLeaseRules.id, activeRule.id));
        }
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "machinery",
          action: input.id ? "update_machine" : "create_machine",
          targetType: "machine",
          targetId: String(machineId),
          summary: `${input.id ? "维护" : "新建"}机械台账：${input.name}${input.leaseTerms ? `，已维护${input.ownership === "leased" ? "外租" : "会计产值"}计价规则` : ""}`,
        });
        return { success: true };
      });
    }),

  listLeaseRules: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        projectId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      const { db } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      return db
        .select()
        .from(machineLeaseRules)
        .where(
          and(
            eq(machineLeaseRules.machineId, input.machineId),
            eq(machineLeaseRules.projectId, input.projectId)
          )
        )
        .orderBy(desc(machineLeaseRules.effectiveFrom));
    }),

  /** 保存外租机械的月租、日租、小时或台班合同规则，规则本身不包含实际成本。 */
  saveLeaseRule: protectedProcedure
    .input(machineLeaseRuleInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertMachineryAccess(ctx);
      const { db } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const values = {
        machineId: input.machineId,
        projectId: input.projectId,
        billingType: input.billingType,
        rate: String(roundMoney(input.rate)),
        overtimeHourlyRate: String(roundMoney(input.overtimeHourlyRate)),
        effectiveFrom: toBusinessDate(input.effectiveFrom),
        effectiveTo: input.effectiveTo
          ? toBusinessDate(input.effectiveTo)
          : null,
        status: input.status,
      };
      if (input.id) {
        const [existing] = await db
          .select()
          .from(machineLeaseRules)
          .where(eq(machineLeaseRules.id, input.id))
          .limit(1);
        if (
          !existing ||
          existing.machineId !== input.machineId ||
          existing.projectId !== input.projectId
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "机械计价规则不存在或不属于当前机械",
          });
        }
        await db
          .update(machineLeaseRules)
          .set(values)
          .where(eq(machineLeaseRules.id, input.id));
      } else {
        await db.insert(machineLeaseRules).values(values);
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: input.id ? "update_lease_rule" : "create_lease_rule",
        targetType: "machine_lease_rule",
        targetId: String(input.id ?? input.machineId),
        summary: `维护机械计价规则：${input.billingType}`,
      });
      return { success: true };
    }),

  listCosts: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      const { db } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const range = input.period ? getMonthRange(input.period) : null;
      const predicates = [
        eq(machineCostRecords.machineId, input.machineId),
        eq(machineCostRecords.projectId, input.projectId),
      ];
      if (range)
        predicates.push(
          gte(machineCostRecords.occurredAt, range.start),
          lt(machineCostRecords.occurredAt, range.endExclusive)
        );
      return db
        .select()
        .from(machineCostRecords)
        .where(and(...predicates))
        .orderBy(desc(machineCostRecords.occurredAt));
    }),

  /**
   * 机械成本汇总打印按项目和自然月读取真实成本记录。默认排除作废记录；
   * 明确选择“已作废”时才输出其审计明细，避免无效金额混入正常合计。
   */
  printSummary: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
        machineId: z.number().int().positive().nullable().optional(),
        status: z
          .enum(["all", "draft", "approved", "settled", "void"])
          .default("all"),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (input.machineId)
        await getScopedMachine(ctx, input.machineId, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          records: [],
          summary: { recordCount: 0, machineCount: 0, quantity: 0, amount: 0 },
        };
      const range = getMonthRange(input.period);
      const predicates = [
        eq(machineCostRecords.projectId, input.projectId),
        gte(machineCostRecords.occurredAt, range.start),
        lt(machineCostRecords.occurredAt, range.endExclusive),
      ];
      if (input.machineId)
        predicates.push(eq(machineCostRecords.machineId, input.machineId));
      if (input.status === "all")
        predicates.push(ne(machineCostRecords.status, "void"));
      else predicates.push(eq(machineCostRecords.status, input.status));
      const [rows, machineRows] = await Promise.all([
        db
          .select()
          .from(machineCostRecords)
          .where(and(...predicates))
          .orderBy(desc(machineCostRecords.occurredAt)),
        db
          .select({
            id: machines.id,
            name: machines.name,
            code: machines.code,
            model: machines.model,
          })
          .from(machines)
          .where(eq(machines.projectId, input.projectId)),
      ]);
      const labels = new Map(
        machineRows.map(row => [
          row.id,
          `${row.name}${row.code ? ` · ${row.code}` : ""}`,
        ])
      );
      const records = rows.map(row => ({
        id: row.id,
        machineId: row.machineId,
        machineLabel: labels.get(row.machineId) ?? "机械已停用/删除",
        costType: row.costType,
        costName: row.costName,
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
  listCostSummaries: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(machineCostRecords)
        .where(eq(machineCostRecords.projectId, input.projectId))
        .orderBy(desc(machineCostRecords.occurredAt));
      const summaries = new Map<
        number,
        {
          machineId: number;
          totalAmount: number;
          repairAmount: number;
          recordCount: number;
          lastOccurredAt: Date | null;
        }
      >();
      rows
        .filter(row => row.status !== "void")
        .forEach(row => {
          const current = summaries.get(row.machineId) ?? {
            machineId: row.machineId,
            totalAmount: 0,
            repairAmount: 0,
            recordCount: 0,
            lastOccurredAt: null,
          };
          const amount = Number(row.amount);
          current.totalAmount += amount;
          if (row.costType === "repair") current.repairAmount += amount;
          current.recordCount += 1;
          if (
            !current.lastOccurredAt ||
            new Date(row.occurredAt).getTime() >
              current.lastOccurredAt.getTime()
          )
            current.lastOccurredAt = new Date(row.occurredAt);
          summaries.set(row.machineId, current);
        });
      return Array.from(summaries.values());
    }),

  /** 按会计模板读取当前项目、期间的已保存月度明细快照；不返回其他项目或作废以外的隐藏数据。 */
  listMonthlyStatements: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(machineMonthlyStatements)
        .where(
          and(
            eq(machineMonthlyStatements.projectId, input.projectId),
            eq(machineMonthlyStatements.period, input.period)
          )
        )
        .orderBy(desc(machineMonthlyStatements.updatedAt));
    }),

  /** 单台机械详情的月度快照和当期逐日收支分析；仅以原始日作业、成本、维保和柴油凭证聚合。 */
  getMachineAnalysis: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      const { db, machine } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const range = getMonthRange(input.period);
      const [
        monthlyStatements,
        dailyOperations,
        costRows,
        maintenanceRows,
        refuelRows,
        partsPurchaseRows,
        leaseRules,
      ] = await Promise.all([
        db
          .select()
          .from(machineMonthlyStatements)
          .where(
            and(
              eq(machineMonthlyStatements.machineId, input.machineId),
              eq(machineMonthlyStatements.projectId, input.projectId)
            )
          )
          .orderBy(desc(machineMonthlyStatements.period)),
        db
          .select()
          .from(machineDailyOperations)
          .where(
            and(
              eq(machineDailyOperations.machineId, input.machineId),
              eq(machineDailyOperations.projectId, input.projectId),
              gte(machineDailyOperations.occurredOn, range.start),
              lt(machineDailyOperations.occurredOn, range.endExclusive)
            )
          )
          .orderBy(desc(machineDailyOperations.occurredOn)),
        db
          .select()
          .from(machineCostRecords)
          .where(
            and(
              eq(machineCostRecords.machineId, input.machineId),
              eq(machineCostRecords.projectId, input.projectId),
              ne(machineCostRecords.status, "void"),
              gte(machineCostRecords.occurredAt, range.start),
              lt(machineCostRecords.occurredAt, range.endExclusive)
            )
          ),
        db
          .select()
          .from(assetMaintenanceRecords)
          .where(
            and(
              eq(assetMaintenanceRecords.assetType, "machine"),
              eq(assetMaintenanceRecords.assetId, input.machineId),
              eq(assetMaintenanceRecords.projectId, input.projectId),
              ne(assetMaintenanceRecords.status, "void"),
              gte(assetMaintenanceRecords.occurredAt, range.start),
              lt(assetMaintenanceRecords.occurredAt, range.endExclusive)
            )
          ),
        db
          .select()
          .from(dieselRefuelRecords)
          .where(
            and(
              eq(dieselRefuelRecords.assetType, "machine"),
              eq(dieselRefuelRecords.machineId, input.machineId),
              eq(dieselRefuelRecords.projectId, input.projectId),
              ne(dieselRefuelRecords.status, "void"),
              gte(dieselRefuelRecords.refueledAt, range.start),
              lt(dieselRefuelRecords.refueledAt, range.endExclusive)
            )
          ),
        db
          .select()
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.assetType, "machine"),
              eq(purchaseOrders.assetId, input.machineId),
              eq(purchaseOrders.projectId, input.projectId),
              eq(purchaseOrders.status, "closed"),
              gte(purchaseOrders.orderedAt, range.start),
              lt(purchaseOrders.orderedAt, range.endExclusive)
            )
          ),
        db
          .select()
          .from(machineLeaseRules)
          .where(
            and(
              eq(machineLeaseRules.machineId, input.machineId),
              eq(machineLeaseRules.projectId, input.projectId),
              eq(machineLeaseRules.status, "active")
            )
          )
          .orderBy(desc(machineLeaseRules.effectiveFrom)),
      ]);
      const dayKey = (value: Date | string) => chinaBusinessDate(value);
      type DailyAggregate = {
        date: string;
        operation: (typeof dailyOperations)[number] | null;
        repairAmount: number;
        maintenanceAmount: number;
        partsAmount: number;
        fuelLiters: number;
        fuelAmount: number;
        otherExpenseAmount: number;
        sourceCounts: {
          cost: number;
          maintenance: number;
          refuel: number;
          partsPurchase: number;
        };
      };
      const days = new Map<string, DailyAggregate>();
      const ensureDay = (date: string) => {
        const existing = days.get(date);
        if (existing) return existing;
        const created: DailyAggregate = {
          date,
          operation: null,
          repairAmount: 0,
          maintenanceAmount: 0,
          partsAmount: 0,
          fuelLiters: 0,
          fuelAmount: 0,
          otherExpenseAmount: 0,
          sourceCounts: {
            cost: 0,
            maintenance: 0,
            refuel: 0,
            partsPurchase: 0,
          },
        };
        days.set(date, created);
        return created;
      };
      dailyOperations.forEach(row => {
        const target = ensureDay(dayKey(row.occurredOn));
        target.operation = row;
      });
      costRows.forEach(row => {
        const target = ensureDay(dayKey(row.occurredAt));
        target.sourceCounts.cost += 1;
        if (row.costType === "repair")
          target.repairAmount += Number(row.amount);
        else if (row.costType !== "fuel")
          target.otherExpenseAmount += Number(row.amount);
        else {
          target.fuelLiters += Number(row.quantity);
          target.fuelAmount += Number(row.amount);
        }
      });
      maintenanceRows.forEach(row => {
        const target = ensureDay(dayKey(row.occurredAt));
        target.sourceCounts.maintenance += 1;
        if (row.costCategory === "repair")
          target.repairAmount += Number(row.amount);
        else target.maintenanceAmount += Number(row.amount);
      });
      refuelRows.forEach(row => {
        const target = ensureDay(dayKey(row.refueledAt));
        target.sourceCounts.refuel += 1;
        /** 柴油领用台账为当日油耗的优先来源，避免与历史 fuel 成本行重复累计。 */
        if (target.sourceCounts.refuel === 1) {
          target.fuelLiters = 0;
          target.fuelAmount = 0;
        }
        target.fuelLiters += Number(row.liters);
        target.fuelAmount += Number(row.amount);
      });
      partsPurchaseRows.forEach(row => {
        const target = ensureDay(dayKey(row.orderedAt));
        target.partsAmount += Number(row.amount);
        target.sourceCounts.partsPurchase += 1;
      });
      const daily = Array.from(days.values())
        .map(item => {
          const activeOperation =
            item.operation && item.operation.status !== "void"
              ? item.operation
              : null;
          const outputAmount = activeOperation
            ? Number(activeOperation.outputAmount)
            : 0;
          const driverWageAmount = activeOperation
            ? Number(activeOperation.driverWageAmount)
            : 0;
          const totalExpense = roundMoney(
            driverWageAmount +
              item.repairAmount +
              item.maintenanceAmount +
              item.partsAmount +
              item.fuelAmount +
              item.otherExpenseAmount
          );
          return {
            ...item,
            outputAmount,
            driverWageAmount,
            totalExpense,
            netIncome: roundMoney(outputAmount - totalExpense),
            shiftCount: activeOperation
              ? Number(activeOperation.shiftCount)
              : 0,
            shiftRate: activeOperation ? Number(activeOperation.shiftRate) : 0,
            shiftAmount: activeOperation
              ? Number(activeOperation.shiftAmount)
              : 0,
            workHours: activeOperation ? Number(activeOperation.workHours) : 0,
            overtimeHours: activeOperation
              ? Number(activeOperation.overtimeHours)
              : 0,
            overtimeHourlyRate: activeOperation
              ? Number(activeOperation.overtimeHourlyRate)
              : 0,
            overtimeAmount: activeOperation
              ? Number(activeOperation.overtimeAmount)
              : 0,
            driverName: activeOperation?.driverNameSnapshot ?? null,
            operationStatus: item.operation?.status ?? null,
            remarks: item.operation?.remarks ?? null,
          };
        })
        .sort((left, right) => right.date.localeCompare(left.date));
      const activeRule =
        leaseRules.find(
          rule =>
            new Date(rule.effectiveFrom).getTime() <
              range.endExclusive.getTime() &&
            (!rule.effectiveTo ||
              new Date(rule.effectiveTo).getTime() >= range.start.getTime())
        ) ?? null;
      const periodDays = Math.round(
        (range.endExclusive.getTime() - range.start.getTime()) / 86_400_000
      );
      const activeOperationDays = daily.filter(
        item => item.operationStatus && item.operationStatus !== "void"
      ).length;
      const overtimeHours = roundMoney(
        daily.reduce((sum, item) => sum + item.overtimeHours, 0)
      );
      const overtimeOperationAmount = roundMoney(
        daily.reduce((sum, item) => sum + item.overtimeAmount, 0)
      );
      const overtimeCostRecordAmount = roundMoney(
        costRows
          .filter(item => item.costType === "overtime")
          .reduce((sum, item) => sum + Number(item.amount), 0)
      );
      const rental = activeRule
        ? {
            billingType: activeRule.billingType,
            monthlyRate:
              activeRule.billingType === "monthly"
                ? Number(activeRule.rate)
                : null,
            /** 月租按本自然月实际天数折算，仅为日成本查看口径，不改变合同或结算。 */
            dailyRate:
              activeRule.billingType === "monthly"
                ? roundMoney(Number(activeRule.rate) / periodDays)
                : activeRule.billingType === "daily"
                  ? Number(activeRule.rate)
                  : null,
            hourlyRate:
              activeRule.billingType === "hourly"
                ? Number(activeRule.rate)
                : null,
            shiftRate:
              activeRule.billingType === "shift"
                ? Number(activeRule.rate)
                : null,
            overtimeHourlyRate: Number(activeRule.overtimeHourlyRate),
            effectiveFrom: activeRule.effectiveFrom,
            effectiveTo: activeRule.effectiveTo,
            activeOperationDays,
            accruedRental:
              activeRule.billingType === "monthly"
                ? Number(activeRule.rate)
                : activeRule.billingType === "daily"
                  ? roundMoney(Number(activeRule.rate) * activeOperationDays)
                  : null,
          }
        : null;
      return {
        machine: {
          id: machine.id,
          name: machine.name,
          code: machine.code,
          model: machine.model,
        },
        period: input.period,
        monthly: monthlyStatements.map(item => ({
          ...item,
          totalOutput: Number(item.totalOutput),
          driverTotalWage: Number(item.driverTotalWage),
          repairAmount: Number(item.repairAmount),
          fuelAmount: Number(item.fuelAmount),
          fuelLiters: Number(item.fuelLiters),
          otherExpenseAmount: 0,
          netIncome: roundMoney(
            Number(item.totalOutput) -
              Number(item.driverTotalWage) -
              Number(item.repairAmount) -
              Number(item.fuelAmount)
          ),
        })),
        rental,
        overtime: {
          hours: overtimeHours,
          operationAmount: overtimeOperationAmount,
          costRecordAmount: overtimeCostRecordAmount,
        },
        daily,
        partsPurchases: partsPurchaseRows.map(item => ({
          id: item.id,
          orderNo: item.orderNo,
          itemDescription: item.itemDescription || "未填写配件说明",
          amount: Number(item.amount),
          orderedAt: item.orderedAt,
          hasInvoice: item.hasInvoice,
          status: item.status,
        })),
      };
    }),

  /** 保存单机日作业；已提交、审核或结算记录禁止直接修改。 */
  saveDailyOperation: protectedProcedure
    .input(machineDailyOperationInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.id ? "edit" : "create"
      );
      if (
        input.shiftCount !== 0 ||
        input.shiftRate !== 0 ||
        input.workHours !== 0 ||
        input.outputAmount !== 0 ||
        input.driverWageAmount !== 0 ||
        input.overtimeHours <= 0
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "当前入口仅登记司机加班，不录入历史合同作业、产值或重复司机工资",
        });
      const { db, machine } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const [existing] = input.id
        ? await db
            .select()
            .from(machineDailyOperations)
            .where(eq(machineDailyOperations.id, input.id))
            .limit(1)
        : await db
            .select()
            .from(machineDailyOperations)
            .where(
              and(
                eq(machineDailyOperations.machineId, input.machineId),
                eq(machineDailyOperations.projectId, input.projectId),
                eq(
                  machineDailyOperations.occurredOn,
                  toBusinessDate(input.occurredOn)
                )
              )
            )
            .limit(1);
      if (
        existing &&
        (existing.machineId !== input.machineId ||
          existing.projectId !== input.projectId)
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械日作业记录不存在或不属于当前项目",
        });
      if (existing && existing.status !== "draft")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "已提交、审核或结算的机械日作业不得直接修改",
        });
      if (
        existing &&
        (Number(existing.shiftCount) !== 0 ||
          Number(existing.shiftRate) !== 0 ||
          Number(existing.outputAmount) !== 0 ||
          Number(existing.driverWageAmount) !== 0)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该日含历史合同作业或工资快照，禁止以新加班录入覆盖历史金额",
        });
      if (existing && !input.id)
        await assertDepartmentBusinessAccess(ctx, "MACHINERY", "edit");
      const operatorUserId =
        input.operatorUserId ?? machine.operatorUserId ?? null;
      const [operator] = operatorUserId
        ? await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, operatorUserId))
            .limit(1)
        : [];
      const shiftCount = roundMoney(input.shiftCount);
      const shiftRate = roundMoney(input.shiftRate);
      const overtimeHourlyRate = roundMoney(input.overtimeHourlyRate);
      const shiftAmount = roundMoney(shiftCount * shiftRate);
      const overtimeAmount = roundMoney(
        input.overtimeHours * overtimeHourlyRate
      );
      const values = {
        projectId: input.projectId,
        machineId: input.machineId,
        occurredOn: toBusinessDate(input.occurredOn),
        operatorUserId,
        shiftCount: String(shiftCount),
        shiftRate: String(shiftRate),
        workHours: String(roundMoney(input.workHours)),
        overtimeHours: String(roundMoney(input.overtimeHours)),
        overtimeHourlyRate: String(overtimeHourlyRate),
        shiftAmount: String(shiftAmount),
        overtimeAmount: String(overtimeAmount),
        outputAmount: String(roundMoney(input.outputAmount)),
        driverWageAmount: String(roundMoney(input.driverWageAmount)),
        driverNameSnapshot: operator?.name ?? machine.driverName ?? null,
        remarks: input.remarks?.trim() || null,
      };
      if (existing)
        await db
          .update(machineDailyOperations)
          .set(values)
          .where(eq(machineDailyOperations.id, existing.id));
      else
        await db
          .insert(machineDailyOperations)
          .values({ ...values, status: "draft", createdBy: user.id });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: existing ? "update_daily_operation" : "create_daily_operation",
        targetType: "machine_daily_operation",
        targetId: `${input.machineId}:${input.occurredOn}`,
        summary: `${existing ? "更新" : "录入"}机械日作业：${machine.name} ${input.occurredOn}，产值 ¥${roundMoney(input.outputAmount)}`,
      });
      return { success: true };
    }),

  /** 日作业沿用机械会计状态机，审核和结算仍只允许会计或财务负责人办理。 */
  transitionDailyOperation: protectedProcedure
    .input(machineDailyOperationTransitionInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.nextStatus === "approved"
          ? "review"
          : input.nextStatus === "settled"
            ? "settle"
            : input.nextStatus === "void"
              ? "void"
              : "submit"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [record] = await db
        .select()
        .from(machineDailyOperations)
        .where(eq(machineDailyOperations.id, input.id))
        .limit(1);
      if (!record || record.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械日作业不存在或不属于当前项目",
        });
      const allowed: Record<typeof record.status, readonly string[]> = {
        draft: ["submitted", "void"],
        submitted: ["approved", "void"],
        approved: ["settled", "void"],
        settled: [],
        void: [],
      };
      if (!allowed[record.status].includes(input.nextStatus))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前机械日作业状态不允许执行该操作",
        });
      if (
        ["approved", "settled"].includes(input.nextStatus) &&
        !canSettleFinancialRecord(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅财务负责人或会计可审核、结算机械日作业",
        });
      if (
        !["approved", "settled"].includes(input.nextStatus) &&
        !canManageSettlement(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权提交或作废机械日作业",
        });
      const result = await db
        .update(machineDailyOperations)
        .set({ status: input.nextStatus })
        .where(
          and(
            eq(machineDailyOperations.id, input.id),
            eq(machineDailyOperations.status, record.status)
          )
        );
      assertConditionalStatusWrite(result, "机械日作业");
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: "transition_daily_operation",
        targetType: "machine_daily_operation",
        targetId: String(input.id),
        summary: `机械日作业状态变更为：${getBusinessStatusLabel(input.nextStatus)}`,
      });
      return { success: true };
    }),

  /** 实时预览一行机械会计明细；只读取当前已授权项目的租赁规则、成本和维修记录，不创建或改变状态。 */
  previewMonthlyStatement: protectedProcedure
    .input(machineMonthlyStatementInput)
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      const { db, machine } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const range = getMonthRange(input.period);
      const rules = await db
        .select()
        .from(machineLeaseRules)
        .where(
          and(
            eq(machineLeaseRules.machineId, input.machineId),
            eq(machineLeaseRules.projectId, input.projectId),
            eq(machineLeaseRules.status, "active")
          )
        )
        .orderBy(desc(machineLeaseRules.effectiveFrom));
      const rule = rules.find(
        item =>
          new Date(item.effectiveFrom).getTime() <
            range.endExclusive.getTime() &&
          (!item.effectiveTo ||
            new Date(item.effectiveTo).getTime() >= range.start.getTime())
      );
      if (!rule)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前结算期间未找到生效的机械租赁/计价规则",
        });
      const [costRows, maintenanceRows] = await Promise.all([
        db
          .select()
          .from(machineCostRecords)
          .where(
            and(
              eq(machineCostRecords.machineId, input.machineId),
              eq(machineCostRecords.projectId, input.projectId),
              ne(machineCostRecords.status, "void"),
              gte(machineCostRecords.occurredAt, range.start),
              lt(machineCostRecords.occurredAt, range.endExclusive)
            )
          ),
        db
          .select()
          .from(assetMaintenanceRecords)
          .where(
            and(
              eq(assetMaintenanceRecords.assetType, "machine"),
              eq(assetMaintenanceRecords.assetId, input.machineId),
              eq(assetMaintenanceRecords.projectId, input.projectId),
              ne(assetMaintenanceRecords.status, "void"),
              gte(assetMaintenanceRecords.occurredAt, range.start),
              lt(assetMaintenanceRecords.occurredAt, range.endExclusive)
            )
          ),
      ]);
      const repairAmount =
        costRows
          .filter(item => item.costType === "repair")
          .reduce((sum, item) => sum + Number(item.amount), 0) +
        maintenanceRows
          .filter(item => item.costCategory === "repair")
          .reduce((sum, item) => sum + Number(item.amount), 0);
      const fuelRows = costRows.filter(item => item.costType === "fuel");
      const fuelLiters = fuelRows.reduce(
        (sum, item) => sum + Number(item.quantity),
        0
      );
      const fuelAmount = fuelRows.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      );
      const statement = calculateMonthlyMachineStatement({
        billingType: rule.billingType,
        rate: Number(rule.rate),
        overtimeHourlyRate: Number(rule.overtimeHourlyRate),
        machineWorkDays: input.machineWorkDays,
        machineOvertimeHours: input.machineOvertimeHours,
        driverMonthlyWage: input.driverMonthlyWage,
        driverWorkDays: input.driverWorkDays,
        driverOvertimeHours: input.driverOvertimeHours,
        repairAmount,
        fuelLiters,
        fuelAmount,
      });
      const driverUserId = input.driverUserId ?? machine.operatorUserId;
      const [driver] = driverUserId
        ? await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, driverUserId))
            .limit(1)
        : [];
      return {
        machine: {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          model: machine.model,
          ownerName:
            machine.ownership === "leased"
              ? (machine.supplierName ?? "未登记出租方")
              : "公司自有",
          driverUserId,
          driverName: driver?.name ?? "未分配",
        },
        rule: {
          billingType: rule.billingType,
          rate: Number(rule.rate),
          overtimeHourlyRate: Number(rule.overtimeHourlyRate),
          effectiveFrom: rule.effectiveFrom,
          effectiveTo: rule.effectiveTo,
        },
        statement,
        source: {
          costRecordCount: costRows.length,
          maintenanceRecordCount: maintenanceRows.length,
        },
      };
    }),

  /** 保存或更新单台机械当期会计明细快照；非草稿快照必须经状态流转处理，避免改写已审核或已结算数据。 */
  saveMonthlyStatement: protectedProcedure
    .input(machineMonthlyStatementInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(ctx, "MACHINERY", "create");
      const preview = await buildMachineMonthlyStatementPreview(ctx, input);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [existing] = await db
        .select()
        .from(machineMonthlyStatements)
        .where(
          and(
            eq(machineMonthlyStatements.machineId, input.machineId),
            eq(machineMonthlyStatements.projectId, input.projectId),
            eq(machineMonthlyStatements.period, input.period)
          )
        )
        .limit(1);
      if (existing && existing.status !== "draft")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "已提交、已审核或已结算的月度机械明细不得直接修改；请按状态流转或作废后重新建立",
        });
      const values = {
        projectId: input.projectId,
        machineId: input.machineId,
        period: input.period,
        driverUserId: preview.machine.driverUserId ?? null,
        driverNameSnapshot: preview.machine.driverName,
        ownerNameSnapshot: preview.machine.ownerName,
        machineModelSnapshot: preview.machine.model ?? null,
        leaseBillingType: preview.rule.billingType,
        leaseRate: String(roundMoney(preview.rule.rate)),
        machineOvertimeRate: String(
          roundMoney(
            preview.rule.overtimeHourlyRate > 0
              ? preview.rule.overtimeHourlyRate
              : preview.rule.billingType === "monthly"
                ? preview.rule.rate / 30 / 10
                : 0
          )
        ),
        machineWorkDays: String(input.machineWorkDays),
        machineOvertimeHours: String(input.machineOvertimeHours),
        driverMonthlyWage: String(roundMoney(input.driverMonthlyWage)),
        driverWorkDays: String(input.driverWorkDays),
        driverOvertimeHours: String(input.driverOvertimeHours),
        machineBaseOutput: String(preview.statement.machineBaseOutput),
        machineOvertimeOutput: String(preview.statement.machineOvertimeOutput),
        totalOutput: String(preview.statement.totalOutput),
        driverOvertimeWage: String(preview.statement.driverOvertimeWage),
        driverTotalWage: String(preview.statement.driverTotalWage),
        repairAmount: String(preview.statement.repairAmount),
        fuelLiters: String(preview.statement.fuelLiters),
        fuelAmount: String(preview.statement.fuelAmount),
        deductionAmount: String(preview.statement.deductionAmount),
        shareBaseAmount: String(preview.statement.shareBaseAmount),
        machineShareAmount: String(preview.statement.machineShareAmount),
        signatureName: input.signatureName?.trim() || null,
        signedAt: input.signatureName?.trim() ? new Date() : null,
        remarks: input.remarks?.trim() || null,
      };
      if (existing)
        await db
          .update(machineMonthlyStatements)
          .set(values)
          .where(eq(machineMonthlyStatements.id, existing.id));
      else
        await db
          .insert(machineMonthlyStatements)
          .values({ ...values, status: "draft", createdBy: user.id });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: existing
          ? "update_monthly_statement"
          : "create_monthly_statement",
        targetType: "machine_monthly_statement",
        targetId: `${input.machineId}:${input.period}`,
        summary: `${existing ? "更新" : "生成"}会计机械月度明细：${preview.machine.name} ${input.period}，总产值 ¥${preview.statement.totalOutput}`,
      });
      return { success: true, preview };
    }),

  /** 月度机械明细按草稿、提交、审核、结算、作废顺序流转；财务岗位才可审核或结算。 */
  transitionMonthlyStatement: protectedProcedure
    .input(machineMonthlyStatementTransitionInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.nextStatus === "approved"
          ? "review"
          : input.nextStatus === "settled"
            ? "settle"
            : input.nextStatus === "void"
              ? "void"
              : "submit"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [record] = await db
        .select()
        .from(machineMonthlyStatements)
        .where(eq(machineMonthlyStatements.id, input.id))
        .limit(1);
      if (!record || record.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械月度明细不存在或不属于当前项目",
        });
      const allowed: Record<typeof record.status, readonly string[]> = {
        draft: ["submitted", "void"],
        submitted: ["approved", "void"],
        approved: ["void"],
        settled: [],
        void: [],
      };
      if (!allowed[record.status].includes(input.nextStatus))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前月度机械明细状态不允许执行该操作",
        });
      if (input.nextStatus === "settled")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "机械月结不得直接标记为已结算，请创建机械付款结算单并按会计审核、付款流程完成",
        });
      if (
        input.nextStatus === "approved" &&
        !canSettleFinancialRecord(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅财务负责人或会计可审核机械月度明细",
        });
      if (input.nextStatus !== "approved" && !canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权提交或作废机械月度明细",
        });
      const result = await db
        .update(machineMonthlyStatements)
        .set({ status: input.nextStatus })
        .where(
          and(
            eq(machineMonthlyStatements.id, input.id),
            eq(machineMonthlyStatements.status, record.status)
          )
        );
      assertConditionalStatusWrite(result, "机械月度明细");
      const monthlyStatementStatusLabel = getBusinessStatusLabel(
        input.nextStatus
      );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: "transition_monthly_statement",
        targetType: "machine_monthly_statement",
        targetId: String(input.id),
        summary: `机械月度明细状态变更为：${monthlyStatementStatusLabel}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "machinery",
        eventCode: `machine_monthly_statement_${input.nextStatus}`,
        targetType: "machine_monthly_statement",
        targetId: String(input.id),
        title: `机械月度明细${monthlyStatementStatusLabel}`,
        deepLink: "/mobile/machinery",
      }).catch(() => undefined);
      return { success: true };
    }),

  /** 外租机械付款结算台账；账户仅向财务岗位返回完整值，其他岗位仅可查看掩码。 */
  listPaymentSettlements: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        machineId: z.number().int().positive().optional(),
        status: transportSettlementStatusSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      let rows = await db
        .select()
        .from(machinePaymentSettlements)
        .where(eq(machinePaymentSettlements.projectId, input.projectId))
        .orderBy(desc(machinePaymentSettlements.createdAt));
      if (input.machineId)
        rows = rows.filter(item => item.machineId === input.machineId);
      if (input.status)
        rows = rows.filter(item => item.status === input.status);
      const [machineRows, statementRows] = await Promise.all([
        db
          .select({
            id: machines.id,
            code: machines.code,
            name: machines.name,
            model: machines.model,
            ownership: machines.ownership,
            supplierName: machines.supplierName,
          })
          .from(machines)
          .where(eq(machines.projectId, input.projectId)),
        rows.length
          ? db
              .select({
                id: machineMonthlyStatements.id,
                leaseBillingType: machineMonthlyStatements.leaseBillingType,
                machineShareAmount: machineMonthlyStatements.machineShareAmount,
                totalOutput: machineMonthlyStatements.totalOutput,
                driverTotalWage: machineMonthlyStatements.driverTotalWage,
              })
              .from(machineMonthlyStatements)
              .where(
                inArray(
                  machineMonthlyStatements.id,
                  rows.map(item => item.monthlyStatementId)
                )
              )
          : Promise.resolve([]),
      ]);
      const payments = rows.length
        ? await db
            .select({
              settlementId: settlementPaymentRecords.settlementId,
              amount: settlementPaymentRecords.amount,
            })
            .from(settlementPaymentRecords)
            .where(
              and(
                eq(settlementPaymentRecords.projectId, input.projectId),
                eq(settlementPaymentRecords.settlementType, "machine"),
                eq(settlementPaymentRecords.direction, "expense"),
                eq(settlementPaymentRecords.status, "active"),
                inArray(
                  settlementPaymentRecords.settlementId,
                  rows.map(item => item.id)
                )
              )
            )
        : [];
      const actualPaidById = new Map<number, number>();
      payments.forEach(row =>
        actualPaidById.set(
          row.settlementId,
          roundMoney(
            (actualPaidById.get(row.settlementId) ?? 0) + Number(row.amount)
          )
        )
      );
      const machineById = new Map(machineRows.map(item => [item.id, item]));
      const statementById = new Map(statementRows.map(item => [item.id, item]));
      const canReadFullAccount = canSettleFinancialRecord(roleCodes);
      if (canReadFullAccount && rows.some(item => Boolean(item.payeeAccount))) {
        await recordSensitiveDataAccess(db, {
          userId: user.id,
          projectId: input.projectId,
          module: "machinery",
          dataCategory: "full_payment_account",
          accessPurpose: "机械付款结算台账核对与人工转账准备",
          targetType: "machine_payment_settlement",
          targetId: input.machineId ? String(input.machineId) : null,
          recordCount: rows.filter(item => Boolean(item.payeeAccount)).length,
          result: "granted",
        });
      }
      return rows.map(item => {
        // Historical paid flags are not a substitute for active expense payment evidence.
        // Keep their status for audit, but neither fabricate actual payment nor assert a zero balance.
        const legacyFinalized =
          item.status === "paid" && !actualPaidById.has(item.id);
        const actualPaidAmount = legacyFinalized
          ? null
          : (actualPaidById.get(item.id) ?? 0);
        const remainingAmount = legacyFinalized
          ? null
          : roundMoney(
              Math.max(
                0,
                Number(item.netPayableAmount) - (actualPaidAmount ?? 0)
              )
            );
        return {
          ...item,
          actualPaidAmount,
          remainingAmount,
          legacyFinalized,
          legacyPaymentUnconfirmed: legacyFinalized,
          machine: machineById.get(item.machineId) ?? null,
          statement: statementById.get(item.monthlyStatementId) ?? null,
          payeeAccount: canReadFullAccount
            ? item.payeeAccount
            : maskPaymentAccount(item.payeeAccount),
          accountMasked: !canReadFullAccount,
        };
      });
    }),

  /** 从已审核外租机械月结生成付款结算草稿；公司自有机械不虚构外部收款人。 */
  createPaymentSettlement: protectedProcedure
    .input(machinePaymentSettlementDraftInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(ctx, "MACHINERY", "create");
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权创建机械付款结算单",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [statement] = await db
        .select()
        .from(machineMonthlyStatements)
        .where(eq(machineMonthlyStatements.id, input.monthlyStatementId))
        .limit(1);
      if (!statement || statement.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械月结明细不存在或不属于当前项目",
        });
      if (!["approved", "settled"].includes(statement.status))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅已审核的机械月结明细可以创建付款结算单",
        });
      const { machine } = await getScopedMachine(
        ctx,
        statement.machineId,
        input.projectId
      );
      if (machine.ownership !== "leased")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "公司自有机械不生成对外付款结算单；其工资和采购费用仍按各自财务流程办理",
        });
      const periodRange = getMonthRange(statement.period);
      const partsPurchaseRows = await getEligibleAssetPurchaseDeductions(
        db,
        input.projectId,
        "machine",
        machine.id,
        periodRange.start,
        periodRange.endExclusive
      );
      const partsDeductionAmount = roundMoney(
        partsPurchaseRows.reduce((sum, item) => sum + Number(item.amount), 0)
      );
      const grossPayableAmount = roundMoney(
        Number(statement.machineShareAmount)
      );
      const manualDeductionAmount = roundMoney(input.manualDeductionAmount);
      const netPayableAmount = roundMoney(
        grossPayableAmount - manualDeductionAmount - partsDeductionAmount
      );
      if (grossPayableAmount <= 0 || netPayableAmount < 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "机械应付金额不足以扣除人工扣款和关联配件费用，请先核对月结金额或将配件费用分期处理",
        });
      const [existing] = await db
        .select()
        .from(machinePaymentSettlements)
        .where(eq(machinePaymentSettlements.monthlyStatementId, statement.id))
        .limit(1);
      if (existing && existing.status !== "void")
        throw new TRPCError({
          code: "CONFLICT",
          message: "该机械月结已生成付款结算单，不能重复创建",
        });
      const settlementNo =
        existing?.settlementNo ??
        createMachinePaymentSettlementNo(input.projectId);
      const values = {
        projectId: input.projectId,
        machineId: machine.id,
        monthlyStatementId: statement.id,
        period: statement.period,
        grossPayableAmount: String(grossPayableAmount),
        fuelCostAmount: String(roundMoney(Number(statement.fuelAmount))),
        repairCostAmount: String(roundMoney(Number(statement.repairAmount))),
        manualDeductionAmount: String(manualDeductionAmount),
        netPayableAmount: String(netPayableAmount),
        payeeName: input.payeeName.trim(),
        payeeAccount: input.payeeAccount?.trim() || null,
        paymentMethod: input.paymentMethod,
        paymentDate: null,
        paymentReference: null,
        remarks: input.remarks?.trim() || null,
        status: "draft" as const,
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
        paidBy: null,
        paidAt: null,
      };
      await db.transaction(async tx => {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .for("update");
        if (partsPurchaseRows.length) {
          await tx
            .select()
            .from(purchaseOrders)
            .where(
              inArray(
                purchaseOrders.id,
                partsPurchaseRows.map(row => row.id)
              )
            )
            .for("update");
          const freshParts = await getEligibleAssetPurchaseDeductions(
            tx,
            input.projectId,
            "machine",
            machine.id,
            periodRange.start,
            periodRange.endExclusive
          );
          if (
            partsPurchaseRows.some(
              old =>
                !freshParts.some(
                  row => row.id === old.id && row.amount === old.amount
                )
            )
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "配件扣款来源或实际付款依据已变更，请刷新",
            });
        }
        if (existing)
          await tx
            .update(machinePaymentSettlements)
            .set(values)
            .where(
              and(
                eq(machinePaymentSettlements.id, existing.id),
                eq(machinePaymentSettlements.status, "void")
              )
            );
        else
          await tx
            .insert(machinePaymentSettlements)
            .values({ settlementNo, ...values, createdBy: user.id });
        if (statement.status === "approved")
          await tx
            .update(machineMonthlyStatements)
            .set({ status: "settled" })
            .where(
              and(
                eq(machineMonthlyStatements.id, statement.id),
                eq(machineMonthlyStatements.status, "approved")
              )
            );
        if (partsPurchaseRows.length)
          assertSettlementSourceWrites(
            await tx
              .update(purchaseOrders)
              .set({
                assetDeductionReference: settlementNo,
                assetDeductedAt: new Date(),
              })
              .where(
                and(
                  inArray(
                    purchaseOrders.id,
                    partsPurchaseRows.map(item => item.id)
                  ),
                  isNull(purchaseOrders.assetDeductionReference)
                )
              ),
            partsPurchaseRows.length,
            "结算扣款/使用依据"
          );
      });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: existing
          ? "recreate_payment_settlement"
          : "create_payment_settlement",
        targetType: "machine_payment_settlement",
        targetId: settlementNo,
        summary: `${existing ? "重新生成" : "创建"}机械付款结算单：${machine.name} ${statement.period}，配件扣款 ¥${partsDeductionAmount.toFixed(2)}，净应付 ¥${netPayableAmount.toFixed(2)}`,
      });
      return {
        success: true,
        settlementNo,
        partsDeductionAmount,
        netPayableAmount,
      };
    }),

  /** 机械付款结算严格依次提交、会计审核；实际付款仅可由带凭证的统一资金台账登记。 */
  transitionPaymentSettlement: protectedProcedure
    .input(machinePaymentSettlementActionInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.action === "approve"
          ? "review"
          : input.action === "void"
            ? "void"
            : "submit"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (input.action === "pay")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "请使用“登记付款”上传本次凭证并按实际金额办理，旧的一次性付款入口已停用",
        });
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [settlement] = await db
        .select()
        .from(machinePaymentSettlements)
        .where(eq(machinePaymentSettlements.id, input.id))
        .limit(1);
      if (!settlement || settlement.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械付款结算单不存在或不属于当前项目",
        });
      if (settlement.status === "paid")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该机械结算单已完成付款，依据业务规则不能作废或回退",
        });
      const expectedStatus =
        input.action === "submit"
          ? "draft"
          : input.action === "approve"
            ? "submitted"
            : settlement.status;
      if (
        input.action === "void" &&
        !["draft", "submitted", "approved"].includes(settlement.status)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前机械结算状态不允许作废",
        });
      if (
        ["submit", "void"].includes(input.action) &&
        !canManageSettlement(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权提交或作废机械付款结算单",
        });
      if (input.action === "approve" && !canSettleFinancialRecord(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅会计、财务负责人或系统管理员可审核结算单",
        });
      const nextStatus: "submitted" | "approved" | "void" =
        input.action === "submit"
          ? "submitted"
          : input.action === "approve"
            ? "approved"
            : "void";
      await db.transaction(async tx => {
        const values: Partial<typeof machinePaymentSettlements.$inferInsert> =
          input.action === "submit"
            ? {
                status: nextStatus,
                submittedBy: user.id,
                submittedAt: new Date(),
              }
            : input.action === "approve"
              ? {
                  status: nextStatus,
                  approvedBy: user.id,
                  approvedAt: new Date(),
                }
              : {
                  status: nextStatus,
                  remarks: input.remarks?.trim() || settlement.remarks,
                };
        const result = await tx
          .update(machinePaymentSettlements)
          .set(values)
          .where(
            and(
              eq(machinePaymentSettlements.id, settlement.id),
              eq(machinePaymentSettlements.status, expectedStatus)
            )
          );
        assertConditionalStatusWrite(result, "机械付款结算单");
        if (input.action === "void") {
          await tx
            .update(machineMonthlyStatements)
            .set({ status: "approved" })
            .where(
              and(
                eq(machineMonthlyStatements.id, settlement.monthlyStatementId),
                eq(machineMonthlyStatements.status, "settled")
              )
            );
          await tx
            .update(purchaseOrders)
            .set({ assetDeductionReference: null, assetDeductedAt: null })
            .where(
              eq(
                purchaseOrders.assetDeductionReference,
                settlement.settlementNo
              )
            );
        }
      });
      const actionLabel =
        input.action === "submit"
          ? "提交会计审核"
          : input.action === "approve"
            ? "审核通过，待上传付款凭证"
            : "作废";
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: `payment_settlement_${input.action}`,
        targetType: "machine_payment_settlement",
        targetId: settlement.settlementNo,
        summary: `机械付款结算单已${actionLabel}：净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "machinery",
        eventCode: `machine_payment_settlement_${input.action}`,
        targetType: "machine_payment_settlement",
        targetId: settlement.settlementNo,
        title: "机械费用结算状态更新",
        content: `${settlement.settlementNo} 已${actionLabel}，净应付 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`,
        deepLink: "/mobile/machinery",
      }).catch(() => undefined);
      return { success: true, status: nextStatus };
    }),

  /** 录入油料、维修、加班、进退场等成本；金额始终由服务端计算。 */
  saveCost: protectedProcedure
    .input(machineCostInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(ctx, "MACHINERY", "create");
      const { db, machine } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      if (input.evidenceId) {
        const [evidence] = await db
          .select({
            id: evidenceRecords.id,
            projectId: evidenceRecords.projectId,
          })
          .from(evidenceRecords)
          .where(eq(evidenceRecords.id, input.evidenceId))
          .limit(1);
        if (!evidence || evidence.projectId !== input.projectId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "费用水印照片不存在或不属于当前项目",
          });
      }
      const occurredAt = new Date(input.occurredAt);
      if (Number.isNaN(occurredAt.getTime()))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "费用发生时间无效",
        });
      const guideline =
        input.costType === "fuel"
          ? await getEffectiveDieselGuidelinePrice(
              db,
              input.projectId,
              occurredAt
            )
          : null;
      if (input.costType === "fuel" && !guideline?.price)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "当前加油发生时间未匹配到有效柴油指导价，请先在柴油管理维护指导价",
        });
      const appliedUnitPrice =
        input.costType === "fuel"
          ? guideline!.price!.pricePerLiter
          : input.unitPrice;
      const amount = roundMoney(input.quantity * appliedUnitPrice);
      const result = await db.insert(machineCostRecords).values({
        machineId: input.machineId,
        projectId: input.projectId,
        costType: input.costType,
        costName: input.costName.trim(),
        quantity: String(input.quantity),
        unitPrice: String(roundMoney(appliedUnitPrice)),
        amount: String(amount),
        occurredAt,
        evidenceId: input.evidenceId ?? null,
        remarks: input.remarks?.trim() || null,
        status: "draft",
      });
      const costId = Number(
        (result[0] as { insertId?: number } | undefined)?.insertId ?? 0
      );
      if (input.evidenceId && costId)
        await db
          .update(evidenceRecords)
          .set({ sourceId: `machine-cost-${costId}` })
          .where(
            and(
              eq(evidenceRecords.id, input.evidenceId),
              eq(evidenceRecords.projectId, input.projectId)
            )
          );
      const priceSource = guideline?.price
        ? `，引用柴油指导价 ¥${guideline.price.pricePerLiter}/L（${guideline.businessDate}，规则 #${guideline.price.id}）`
        : "";
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: "create_cost",
        targetType: "machine_cost",
        targetId: String(costId || `${input.machineId}:${input.occurredAt}`),
        summary: `录入机械${input.costType}成本：${input.costName.trim()}，金额由系统核算${priceSource}${input.evidenceId ? "，已关联水印照片" : ""}`,
      });
      const [ownerProfile] = machine.ownerUserId
        ? await db
            .select({ phoneEncrypted: userProfiles.phoneEncrypted })
            .from(userProfiles)
            .where(eq(userProfiles.userId, machine.ownerUserId))
            .limit(1)
        : [];
      const recipientPhoneEncrypted =
        ownerProfile?.phoneEncrypted ?? machine.driverPhoneEncrypted;
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "machinery",
        eventCode: "machine_cost_submitted",
        targetType: "machine_cost",
        targetId: String(costId || `${input.machineId}:${input.occurredAt}`),
        title: "机械费用已录入",
        content: `${machine.name}${machine.code ? `（${machine.code}）` : ""}新增一笔${input.costName.trim()}费用，金额 ¥${amount.toFixed(2)}，请进入系统核对。`,
        deepLink: "/mobile/machinery",
      }).catch(() => undefined);
      void notifyAliyunSmsSafely({
        actorUserId: user.id,
        projectId: input.projectId,
        module: "machinery",
        eventCode: "machine_expense_recorded",
        recipientPhone: recipientPhoneEncrypted
          ? decryptSecret(recipientPhoneEncrypted)
          : null,
        targetType: "machine_cost",
        targetId: String(costId || `${input.machineId}:${input.occurredAt}`),
        templateParams: {
          vehicle: `${machine.name}${machine.code ? `（${machine.code}）` : ""}`,
          category: input.costName.trim(),
          amount: amount.toFixed(2),
          time: formatChinaSmsTime(occurredAt),
        },
      }).catch(() => undefined);
      return {
        success: true,
        id: costId || null,
        amount,
        unitPrice: appliedUnitPrice,
        guidelinePriceId: guideline?.price?.id ?? null,
      };
    }),

  /** 审批、结算或作废机械成本；已结算记录不可回退，结算操作限定财务岗位。 */
  transitionCost: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        nextStatus: z.enum(["approved", "settled", "void"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertMachineryAccess(ctx);
      await assertDepartmentBusinessAccess(
        ctx,
        "MACHINERY",
        input.nextStatus === "settled"
          ? "settle"
          : input.nextStatus === "void"
            ? "void"
            : "review"
      );
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权处理机械成本状态",
        });
      if (
        input.nextStatus === "settled" &&
        !canSettleFinancialRecord(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅财务负责人或会计可确认机械成本结算",
        });
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [record] = await db
        .select()
        .from(machineCostRecords)
        .where(eq(machineCostRecords.id, input.id))
        .limit(1);
      if (!record || record.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "机械成本记录不存在",
        });
      try {
        assertMachineCostStatusTransition(record.status, input.nextStatus);
      } catch (error) {
        throwDomainAsBadRequest(error);
      }
      const updateResult = await db
        .update(machineCostRecords)
        .set({ status: input.nextStatus })
        .where(
          and(
            eq(machineCostRecords.id, input.id),
            eq(machineCostRecords.status, record.status)
          )
        );
      assertConditionalStatusWrite(updateResult, "机械成本记录");
      const machineCostStatusLabel = getBusinessStatusLabel(input.nextStatus);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "machinery",
        action: "transition_cost",
        targetType: "machine_cost",
        targetId: String(input.id),
        summary: `机械成本状态变更为：${machineCostStatusLabel}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        module: "machinery",
        eventCode: `machine_cost_${input.nextStatus}`,
        targetType: "machine_cost",
        targetId: String(input.id),
        title: `机械成本${machineCostStatusLabel}`,
        deepLink: "/mobile/machinery",
      }).catch(() => undefined);
      return { success: true };
    }),

  /**
   * 生成月度机械结算预览。租赁用量由管理人员输入，油料、加班、维修和进退场费均来自不可篡改的成本记录。
   * 本接口仅预览，不自动改变任何成本记录状态；最终结算必须逐笔经过状态流转。
   */
  settlementPreview: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
        leaseUsageUnits: z.number().min(0).max(100000).default(1),
        deductionAmount: z.number().min(0).max(999999999999.99).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMachineryAccess(ctx);
      const { db, machine } = await getScopedMachine(
        ctx,
        input.machineId,
        input.projectId
      );
      const range = getMonthRange(input.period);
      const rules = await db
        .select()
        .from(machineLeaseRules)
        .where(
          and(
            eq(machineLeaseRules.machineId, input.machineId),
            eq(machineLeaseRules.projectId, input.projectId),
            eq(machineLeaseRules.status, "active")
          )
        )
        .orderBy(desc(machineLeaseRules.effectiveFrom));
      const selectedRule = rules.find(
        rule =>
          new Date(rule.effectiveFrom).getTime() <
            range.endExclusive.getTime() &&
          (!rule.effectiveTo ||
            new Date(rule.effectiveTo).getTime() >= range.start.getTime())
      );
      if (!selectedRule)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前结算期间未找到生效的机械计价规则",
        });
      const costs = await db
        .select()
        .from(machineCostRecords)
        .where(
          and(
            eq(machineCostRecords.machineId, input.machineId),
            eq(machineCostRecords.projectId, input.projectId),
            ne(machineCostRecords.status, "void"),
            gte(machineCostRecords.occurredAt, range.start),
            lt(machineCostRecords.occurredAt, range.endExclusive)
          )
        );
      const sumByType = (
        type: (typeof machineCostRecords.$inferSelect)["costType"]
      ) =>
        costs
          .filter(item => item.costType === type)
          .reduce((sum, item) => sum + Number(item.amount), 0);
      const fuelRows = costs.filter(item => item.costType === "fuel");
      const overtimeRows = costs.filter(item => item.costType === "overtime");
      const fuelQuantity = fuelRows.reduce(
        (sum, item) => sum + Number(item.quantity),
        0
      );
      const fuelAmount = sumByType("fuel");
      const overtimeHours = overtimeRows.reduce(
        (sum, item) => sum + Number(item.quantity),
        0
      );
      const overtimeAmount = sumByType("overtime");
      const leaseAmount =
        selectedRule.billingType === "monthly"
          ? Number(selectedRule.rate)
          : roundMoney(Number(selectedRule.rate) * input.leaseUsageUnits);
      let settlement;
      try {
        settlement = calculateMachineSettlement({
          leaseAmount,
          dieselLiters: fuelQuantity,
          dieselUnitPrice: fuelQuantity > 0 ? fuelAmount / fuelQuantity : 0,
          overtimeHours,
          overtimeHourlyRate:
            overtimeHours > 0
              ? overtimeAmount / overtimeHours
              : Number(selectedRule.overtimeHourlyRate),
          repairAmount: sumByType("repair"),
          mobilizationAmount: sumByType("mobilization"),
          deductionAmount: input.deductionAmount,
          otherAmount: sumByType("other"),
        });
      } catch (error) {
        throwDomainAsBadRequest(error);
      }
      return {
        machine: {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          ownership: machine.ownership,
        },
        period: input.period,
        rule: {
          id: selectedRule.id,
          billingType: selectedRule.billingType,
          rate: Number(selectedRule.rate),
          overtimeHourlyRate: Number(selectedRule.overtimeHourlyRate),
        },
        leaseUsageUnits: input.leaseUsageUnits,
        costRecordCount: costs.length,
        costBreakdown: {
          fuelAmount: roundMoney(fuelAmount),
          overtimeAmount: roundMoney(overtimeAmount),
          repairAmount: roundMoney(sumByType("repair")),
          mobilizationAmount: roundMoney(sumByType("mobilization")),
          otherAmount: roundMoney(sumByType("other")),
          deductionAmount: roundMoney(input.deductionAmount),
        },
        settlement,
      };
    }),
});

/**
 * 车辆柴油或资产扣款超过本期应付时形成待收补款。后期抵扣前必须同时扣除已实际收回金额与已分配抵扣额，
 * 不能仅依据主单状态判断，避免同一补款被重复使用。
 */
async function getOutstandingVehicleRecoveries(
  db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">,
  projectId: number,
  vehicleId: number
) {
  const settlements = await db
    .select()
    .from(transportVehicleSettlements)
    .where(
      and(
        eq(transportVehicleSettlements.projectId, projectId),
        eq(transportVehicleSettlements.vehicleId, vehicleId)
      )
    );
  const sources = settlements.filter(
    item =>
      ["receivable", "partial", "offset"].includes(item.status) &&
      Number(item.netPayableAmount) < 0
  );
  if (!sources.length)
    return [] as Array<{
      settlementId: number;
      settlementNo: string;
      remainingAmount: number;
    }>;
  const sourceIds = sources.map(item => item.id);
  const [payments, offsets] = await Promise.all([
    db
      .select({
        settlementId: settlementPaymentRecords.settlementId,
        amount: settlementPaymentRecords.amount,
      })
      .from(settlementPaymentRecords)
      .where(
        and(
          eq(settlementPaymentRecords.projectId, projectId),
          eq(settlementPaymentRecords.settlementType, "transport_vehicle"),
          eq(settlementPaymentRecords.direction, "income"),
          eq(settlementPaymentRecords.status, "active")
        )
      ),
    db
      .select({
        sourceSettlementId:
          transportVehicleCarryForwardOffsets.sourceSettlementId,
        amount: transportVehicleCarryForwardOffsets.amount,
      })
      .from(transportVehicleCarryForwardOffsets)
      .where(
        and(
          inArray(
            transportVehicleCarryForwardOffsets.sourceSettlementId,
            sourceIds
          ),
          eq(transportVehicleCarryForwardOffsets.status, "active")
        )
      ),
  ]);
  return sources
    .map(source => {
      const paid = payments
        .filter(item => Number(item.settlementId) === source.id)
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const offset = offsets
        .filter(item => Number(item.sourceSettlementId) === source.id)
        .reduce((sum, item) => sum + Number(item.amount), 0);
      return {
        settlementId: source.id,
        settlementNo: source.settlementNo,
        remainingAmount: roundMoney(
          Math.max(0, Math.abs(Number(source.netPayableAmount)) - paid - offset)
        ),
      };
    })
    .filter(item => item.remainingAmount > 0.009);
}

/** Serialize source claims in one project, matching purchasing's lock before reading payment facts. */
type SettlementQueryClient = Pick<
  NonNullable<Awaited<ReturnType<typeof getDb>>>,
  "select"
>;
type CarryForwardAllocation = {
  settlementId: number;
  remainingAmount: number;
  amount: number;
};
async function lockVehicleSettlementScope(
  tx: SettlementQueryClient,
  projectId: number,
  vehicleId: number
) {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  await tx
    .select({ id: transportVehicles.id })
    .from(transportVehicles)
    .where(
      and(
        eq(transportVehicles.id, vehicleId),
        eq(transportVehicles.projectId, projectId)
      )
    )
    .for("update");
}
async function assertVehicleDeductionSources(
  tx: SettlementQueryClient,
  projectId: number,
  vehicleId: number,
  fuel: readonly (typeof dieselRefuelRecords.$inferSelect)[],
  parts: readonly (typeof purchaseOrders.$inferSelect)[],
  allocations: readonly CarryForwardAllocation[],
  start: Date,
  end: Date
) {
  if (fuel.length) {
    const locked = await tx
      .select()
      .from(dieselRefuelRecords)
      .where(
        inArray(
          dieselRefuelRecords.id,
          fuel.map(row => row.id)
        )
      )
      .for("update");
    if (
      locked.length !== fuel.length ||
      locked.some(row => {
        const old = fuel.find(item => item.id === row.id);
        return (
          !old ||
          row.status !== "approved" ||
          row.amount !== old.amount ||
          row.transportTripId !== old.transportTripId ||
          row.vehicleId !== vehicleId ||
          row.projectId !== projectId ||
          !row.deductFromFreight
        );
      })
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "柴油扣款来源已被占用或变更，请刷新后重新生成",
      });
  }
  if (parts.length) {
    await tx
      .select()
      .from(purchaseOrders)
      .where(
        inArray(
          purchaseOrders.id,
          parts.map(row => row.id)
        )
      )
      .for("update");
    const fresh = await getEligibleAssetPurchaseDeductions(
      tx,
      projectId,
      "vehicle",
      vehicleId,
      start,
      end
    );
    if (
      parts.some(
        old =>
          !fresh.some(row => row.id === old.id && row.amount === old.amount)
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "配件订单已扣款或实际付款依据变更，请刷新后重试",
      });
  }
  const sources = allocations.length
    ? await tx
        .select()
        .from(transportVehicleSettlements)
        .where(
          inArray(
            transportVehicleSettlements.id,
            allocations.map(row => row.settlementId).sort((a, b) => a - b)
          )
        )
        .for("update")
    : [];
  if (allocations.length) {
    const outstanding = await getOutstandingVehicleRecoveries(
      tx,
      projectId,
      vehicleId
    );
    if (
      allocations.some(
        old =>
          !outstanding.some(
            row =>
              row.settlementId === old.settlementId &&
              row.remainingAmount === old.remainingAmount
          )
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "前期补款余额已收回或被其他结算抵扣，请刷新后重新生成",
      });
  }
  return sources.map(row => ({ id: row.id, status: row.status }));
}
async function assertVerifiedTransportEvidence(
  db: SettlementQueryClient,
  projectId: number,
  trips: readonly (typeof transportTrips.$inferSelect)[]
) {
  for (const trip of trips.filter(row => row.status === "verified")) {
    const events = await db
      .select()
      .from(transportCardEvents)
      .where(
        and(
          eq(transportCardEvents.projectId, projectId),
          eq(transportCardEvents.tripId, trip.id)
        )
      );
    const snapshot = getRouteSnapshot(trip.routeSnapshot);
    const ids = [
      trip.evidenceId,
      Number(snapshot.unloadPhotoEvidenceId) || null,
    ].filter(
      (id): id is number =>
        typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );
    const evidence = ids.length
      ? await db
          .select()
          .from(evidenceRecords)
          .where(
            and(
              eq(evidenceRecords.projectId, projectId),
              eq(evidenceRecords.sourceType, "transport"),
              eq(evidenceRecords.status, "active"),
              inArray(evidenceRecords.id, ids)
            )
          )
      : [];
    const eligibility = getTransportReviewEligibility(trip, events, {
      load: evidence.some(
        row => row.id === trip.evidenceId && row.mimeType?.startsWith("image/")
      ),
      unload: evidence.some(
        row =>
          row.id === Number(snapshot.unloadPhotoEvidenceId) &&
          row.mimeType?.startsWith("image/")
      ),
    });
    if (!eligibility.eligible || eligibility.requiresExceptionReview)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `运单 ${trip.tripNo} 缺少真实闭环核验资格：${eligibility.reasons.join("；")}`,
      });
  }
}

/** 运输车辆、运价规则、趟次记录与日报结算。 */
/** 通用管理财务分析不向司机/车主身份开放整车历史；专属账单由独立授权路由处理。 */
function assertVehicleFinanceReader(roleCodes: readonly string[]) {
  if (
    roleCodes.length &&
    roleCodes.every(role => ["DRIVER", "VEHICLE_OWNER"].includes(role))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "司机或车主请通过专属授权账单查看，不开放整车管理财务分析",
    });
}
/** 仅在已授权项目内查询；维修/配件明确 vehicle，所有历史合同包含 disabled。 */
async function readVehicleFinanceSources(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectIds: number[],
  vehicleId?: number
) {
  const [
    trips,
    refuels,
    maintenance,
    leaseRules,
    purchases,
    usage,
    settlements,
    payments,
    offsets,
  ] = await Promise.all([
    db
      .select()
      .from(transportTrips)
      .where(
        and(
          inArray(transportTrips.projectId, projectIds),
          ...(vehicleId ? [eq(transportTrips.vehicleId, vehicleId)] : [])
        )
      ),
    db
      .select()
      .from(dieselRefuelRecords)
      .where(
        and(
          inArray(dieselRefuelRecords.projectId, projectIds),
          eq(dieselRefuelRecords.assetType, "vehicle"),
          ...(vehicleId ? [eq(dieselRefuelRecords.vehicleId, vehicleId)] : [])
        )
      ),
    db
      .select()
      .from(assetMaintenanceRecords)
      .where(
        and(
          inArray(assetMaintenanceRecords.projectId, projectIds),
          eq(assetMaintenanceRecords.assetType, "vehicle"),
          ...(vehicleId ? [eq(assetMaintenanceRecords.assetId, vehicleId)] : [])
        )
      ),
    db
      .select()
      .from(transportVehicleLeaseRules)
      .where(
        and(
          inArray(transportVehicleLeaseRules.projectId, projectIds),
          ...(vehicleId
            ? [eq(transportVehicleLeaseRules.vehicleId, vehicleId)]
            : [])
        )
      ),
    db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.projectId, projectIds),
          eq(purchaseOrders.assetType, "vehicle"),
          ...(vehicleId ? [eq(purchaseOrders.assetId, vehicleId)] : [])
        )
      ),
    db
      .select()
      .from(transportVehicleUsageRecords)
      .where(
        and(
          inArray(transportVehicleUsageRecords.projectId, projectIds),
          ...(vehicleId
            ? [eq(transportVehicleUsageRecords.vehicleId, vehicleId)]
            : [])
        )
      ),
    db
      .select()
      .from(transportVehicleSettlements)
      .where(
        and(
          inArray(transportVehicleSettlements.projectId, projectIds),
          ...(vehicleId
            ? [eq(transportVehicleSettlements.vehicleId, vehicleId)]
            : [])
        )
      ),
    db
      .select()
      .from(settlementPaymentRecords)
      .where(
        and(
          inArray(settlementPaymentRecords.projectId, projectIds),
          eq(settlementPaymentRecords.settlementType, "transport_vehicle")
        )
      ),
    db
      .select()
      .from(transportVehicleCarryForwardOffsets)
      .where(
        and(
          inArray(transportVehicleCarryForwardOffsets.projectId, projectIds),
          ...(vehicleId
            ? [eq(transportVehicleCarryForwardOffsets.vehicleId, vehicleId)]
            : [])
        )
      ),
  ]);
  const verified = trips.filter(t => t.status === "verified");
  const evidenceIds = Array.from(
    new Set(
      verified
        .flatMap(t => [
          t.evidenceId,
          Number(getRouteSnapshot(t.routeSnapshot).unloadPhotoEvidenceId),
        ])
        .filter(
          (v): v is number =>
            typeof v === "number" && Number.isSafeInteger(v) && v > 0
        )
    )
  );
  const events = verified.length
    ? await db
        .select()
        .from(transportCardEvents)
        .where(
          and(
            inArray(transportCardEvents.projectId, projectIds),
            inArray(
              transportCardEvents.tripId,
              verified.map(t => t.id)
            )
          )
        )
    : [];
  const evidence = evidenceIds.length
    ? await db
        .select({
          id: evidenceRecords.id,
          projectId: evidenceRecords.projectId,
          mimeType: evidenceRecords.mimeType,
        })
        .from(evidenceRecords)
        .where(
          and(
            inArray(evidenceRecords.projectId, projectIds),
            eq(evidenceRecords.sourceType, "transport"),
            eq(evidenceRecords.status, "active"),
            inArray(evidenceRecords.id, evidenceIds)
          )
        )
    : [];
  const checkedTrips = trips.map(t => {
    if (t.status !== "verified")
      return { ...t, reviewEligible: t.status === "settled" };
    const snap = getRouteSnapshot(t.routeSnapshot);
    const result = getTransportReviewEligibility(
      t,
      events.filter(e => e.tripId === t.id && e.projectId === t.projectId),
      {
        load: evidence.some(
          e =>
            e.id === t.evidenceId &&
            e.projectId === t.projectId &&
            e.mimeType?.startsWith("image/")
        ),
        unload: evidence.some(
          e =>
            e.id === Number(snap.unloadPhotoEvidenceId) &&
            e.projectId === t.projectId &&
            e.mimeType?.startsWith("image/")
        ),
      }
    );
    return {
      ...t,
      reviewEligible: result.eligible && !result.requiresExceptionReview,
    };
  });
  return {
    trips: checkedTrips,
    refuels,
    maintenance,
    leaseRules,
    purchases,
    usage,
    settlements,
    payments,
    offsets,
  };
}

async function assertNewFleetTrip(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number,
  vehicleId: number,
  plateNo: string
) {
  await assertVehicleDispatchable(db, vehicleId, projectId);
  await assertNoOpenTransportTrip(db, projectId, vehicleId, plateNo);
}
export const transportRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertTransportAccess(ctx);
    return listScopedProjects(ctx);
  }),

  listVehicles: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const user = requireAuthenticatedUser(ctx);
      const rows = await db
        .select()
        .from(transportVehicles)
        .where(eq(transportVehicles.projectId, input.projectId))
        .orderBy(desc(transportVehicles.updatedAt));
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      const scopedRows = isDriverOnly
        ? rows.filter(vehicle => vehicle.driverUserId === user.id)
        : rows;
      const canViewDriverPhone =
        !isDriverOnly &&
        roleCodes.some(role =>
          [
            "ALL",
            "SUPER_ADMIN",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
          ].includes(role)
        );
      return scopedRows.map(vehicle => {
        const { driverPhoneEncrypted, ...safeVehicle } = vehicle;
        return {
          ...safeVehicle,
          driverPhone:
            canViewDriverPhone && driverPhoneEncrypted
              ? decryptSecret(driverPhoneEncrypted)
              : null,
          theoreticalVolumeCubicMeters: calculateVehicleRegistryVolume(
            vehicle.vehicleType,
            Number(vehicle.boxLengthMeters),
            Number(vehicle.boxWidthMeters),
            Number(vehicle.boxHeightMeters),
            Number(vehicle.loadFactor)
          ),
        };
      });
    }),

  /** 车辆默认收款资料仅向运输负责人、项目负责人、会计、财务或系统管理员显示完整账号。 */
  listVehiclePayeeAccounts: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        vehicleId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      const { db } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      const rows = await db
        .select()
        .from(transportVehiclePayeeAccounts)
        .where(
          and(
            eq(transportVehiclePayeeAccounts.projectId, input.projectId),
            eq(transportVehiclePayeeAccounts.vehicleId, input.vehicleId)
          )
        )
        .orderBy(
          desc(transportVehiclePayeeAccounts.isDefault),
          desc(transportVehiclePayeeAccounts.updatedAt)
        );
      const mayViewAccount = roleCodes.some(role =>
        [
          "ALL",
          "TRANSPORT_MANAGER",
          "PROJECT_MANAGER",
          "ACCOUNTANT",
          "FINANCE_MANAGER",
        ].includes(role)
      );
      return rows.map(row => ({
        ...row,
        accountNo: mayViewAccount
          ? row.accountNo
          : maskPaymentAccount(row.accountNo),
        accountMasked: !mayViewAccount,
      }));
    }),

  /** 新增或维护默认收款资料；同一车辆启用新的默认项时自动撤销旧默认标识但不删除历史资料。 */
  saveVehiclePayeeAccount: protectedProcedure
    .input(transportVehiclePayeeAccountInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      const { db } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      if (input.id) {
        const [existing] = await db
          .select()
          .from(transportVehiclePayeeAccounts)
          .where(eq(transportVehiclePayeeAccounts.id, input.id))
          .limit(1);
        if (
          !existing ||
          existing.projectId !== input.projectId ||
          existing.vehicleId !== input.vehicleId
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "车辆收款资料不存在或不属于当前车辆",
          });
      }
      const values = {
        projectId: input.projectId,
        vehicleId: input.vehicleId,
        payeeName: input.payeeName.trim(),
        paymentMethod: input.paymentMethod,
        accountName: input.accountName?.trim() || null,
        accountNo: input.accountNo?.trim() || null,
        isDefault: input.isDefault,
        status: input.status,
        remarks: input.remarks?.trim() || null,
        createdBy: user.id,
      };
      await db.transaction(async tx => {
        if (input.isDefault && input.status === "active")
          await tx
            .update(transportVehiclePayeeAccounts)
            .set({ isDefault: false })
            .where(
              and(
                eq(transportVehiclePayeeAccounts.projectId, input.projectId),
                eq(transportVehiclePayeeAccounts.vehicleId, input.vehicleId),
                eq(transportVehiclePayeeAccounts.isDefault, true)
              )
            );
        if (input.id)
          await tx
            .update(transportVehiclePayeeAccounts)
            .set({ ...values, createdBy: undefined })
            .where(eq(transportVehiclePayeeAccounts.id, input.id));
        else await tx.insert(transportVehiclePayeeAccounts).values(values);
      });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id
          ? "update_vehicle_payee_account"
          : "create_vehicle_payee_account",
        targetType: "transport_vehicle_payee_account",
        targetId: String(input.id ?? input.vehicleId),
        summary: `${input.id ? "维护" : "新增"}车辆收款资料：${input.payeeName.trim()} · ${input.paymentMethod}`,
      });
      return { success: true };
    }),

  /** 外租车辆实际使用依据，按日、小时或台班记录；进入结算单后仅能通过受控作废结算释放。 */
  listVehicleUsageRecords: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        vehicleId: z.number().int().positive(),
        startDate: businessDateSchema.optional(),
        endDate: businessDateSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      const { db } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      let rows = await db
        .select()
        .from(transportVehicleUsageRecords)
        .where(
          and(
            eq(transportVehicleUsageRecords.projectId, input.projectId),
            eq(transportVehicleUsageRecords.vehicleId, input.vehicleId)
          )
        )
        .orderBy(
          desc(transportVehicleUsageRecords.usageDate),
          desc(transportVehicleUsageRecords.id)
        );
      if (input.startDate)
        rows = rows.filter(
          item => String(item.usageDate).slice(0, 10) >= input.startDate!
        );
      if (input.endDate)
        rows = rows.filter(
          item => String(item.usageDate).slice(0, 10) <= input.endDate!
        );
      return rows;
    }),

  saveVehicleUsageRecord: protectedProcedure
    .input(transportVehicleUsageRecordInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      const { db, vehicle } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      if (vehicle.ownership !== "leased")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "车辆使用依据仅适用于外租车辆；按趟渣土车请使用运输结算",
        });
      if (input.evidenceId) {
        const [evidence] = await db
          .select({
            id: evidenceRecords.id,
            projectId: evidenceRecords.projectId,
            status: evidenceRecords.status,
          })
          .from(evidenceRecords)
          .where(eq(evidenceRecords.id, input.evidenceId))
          .limit(1);
        if (
          !evidence ||
          evidence.projectId !== input.projectId ||
          evidence.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "关联使用依据附件不存在、已失效或不属于当前项目",
          });
      }
      await db.insert(transportVehicleUsageRecords).values({
        projectId: input.projectId,
        vehicleId: input.vehicleId,
        usageDate: toBusinessDate(input.usageDate),
        usageType: input.usageType,
        quantity: String(roundMoney(input.quantity)),
        description: input.description.trim(),
        evidenceId: input.evidenceId ?? null,
        settlementId: null,
        status: "confirmed",
        createdBy: user.id,
        voidedBy: null,
        voidedAt: null,
        voidReason: null,
      });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "create_vehicle_usage_record",
        targetType: "transport_vehicle_usage",
        targetId: String(input.vehicleId),
        summary: `登记外租车辆使用依据：${input.usageDate} · ${input.usageType} ${input.quantity}`,
      });
      return { success: true };
    }),

  voidVehicleUsageRecord: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        reason: z.string().trim().min(1, "请填写作废原因").max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [row] = await db
        .select()
        .from(transportVehicleUsageRecords)
        .where(eq(transportVehicleUsageRecords.id, input.id))
        .limit(1);
      if (!row || row.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆使用依据不存在或不属于当前项目",
        });
      if (row.status !== "confirmed" || row.settlementId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "已结算或已作废的车辆使用依据不能直接作废",
        });
      await db
        .update(transportVehicleUsageRecords)
        .set({
          status: "void",
          voidedBy: user.id,
          voidedAt: new Date(),
          voidReason: input.reason.trim(),
        })
        .where(
          and(
            eq(transportVehicleUsageRecords.id, row.id),
            eq(transportVehicleUsageRecords.status, "confirmed"),
            isNull(transportVehicleUsageRecords.settlementId)
          )
        );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "void_vehicle_usage_record",
        targetType: "transport_vehicle_usage",
        targetId: String(row.id),
        summary: `作废外租车辆使用依据：${input.reason.trim()}`,
      });
      return { success: true };
    }),
  /** 本期与截至月末累计共用统一财务投影；历史项目按真实凭证关联读取。 */
  listVehicleSummaries: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        period: settlementPeriodSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      assertVehicleFinanceReader(roleCodes);
      const projectIds = input.projectId
        ? (await assertProjectInCurrentScope(ctx, input.projectId),
          [input.projectId])
        : (await listScopedProjects(ctx)).map(project => project.id);
      if (!projectIds.length) return [];
      const db = await getDb();
      if (!db) return [];
      const sources = await readVehicleFinanceSources(db, projectIds);
      const vehicleIds = Array.from(
        new Set(
          [
            ...sources.trips.map(row => row.vehicleId),
            ...sources.refuels.map(row => row.vehicleId),
            ...sources.maintenance.map(row => row.assetId),
            ...sources.purchases.map(row => row.assetId),
            ...sources.leaseRules.map(row => row.vehicleId),
            ...sources.usage.map(row => row.vehicleId),
            ...sources.settlements.map(row => row.vehicleId),
          ].filter((id): id is number => id !== null)
        )
      );
      const vehicles = await db
        .select()
        .from(transportVehicles)
        .where(
          or(
            inArray(transportVehicles.projectId, projectIds),
            ...(vehicleIds.length
              ? [inArray(transportVehicles.id, vehicleIds)]
              : [])
          )
        );
      const profiles = vehicles.length
        ? await db
            .select()
            .from(vehicleFleetProfiles)
            .where(
              inArray(
                vehicleFleetProfiles.vehicleId,
                vehicles.map(v => v.id)
              )
            )
        : [];
      return vehicles.flatMap(vehicle =>
        projectIds
          .filter(projectId =>
            vehicleFinanceHasProject(vehicle, projectId, sources)
          )
          .map(projectId => {
            const analysis = projectVehicleFinance(
              vehicle,
              projectId,
              input.period,
              sources,
              profiles.find(p => p.vehicleId === vehicle.id)
            );
            return {
              vehicleId: vehicle.id,
              projectId,
              currentProjectId: vehicle.projectId,
              period: input.period,
              ...analysis.summary,
              summary: analysis.summary,
              cumulative: analysis.cumulative,
              leaseBillingType: analysis.leaseRule?.billingType ?? null,
              leaseRate: analysis.leaseRule?.rate ?? null,
            };
          })
      );
    }),

  /** 所有金额由真实台账在服务器计算；仅授权管理角色读取，司机账单走独立授权服务。 */
  getVehicleAnalysis: protectedProcedure
    .input(
      z.object({
        vehicleId: z.number().int().positive(),
        projectId: z.number().int().positive(),
        period: settlementPeriodSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      assertVehicleFinanceReader(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [vehicle] = await db
        .select()
        .from(transportVehicles)
        .where(eq(transportVehicles.id, input.vehicleId))
        .limit(1);
      if (!vehicle)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆不存在或不属于当前项目",
        });
      const sources = await readVehicleFinanceSources(
        db,
        [input.projectId],
        input.vehicleId
      );
      if (!vehicleFinanceHasProject(vehicle, input.projectId, sources))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆在该项目没有档案或历史业务依据",
        });
      const [profile] = await db
        .select()
        .from(vehicleFleetProfiles)
        .where(eq(vehicleFleetProfiles.vehicleId, vehicle.id))
        .limit(1);
      const analysis = projectVehicleFinance(
        vehicle,
        input.projectId,
        input.period,
        sources,
        profile
      );
      return {
        vehicle: {
          id: vehicle.id,
          plateNo: vehicle.plateNo,
          vehicleType: vehicle.vehicleType,
          ownership: vehicle.ownership,
          ownerName: vehicle.ownerName,
          status: vehicle.status,
          projectId: input.projectId,
          currentProjectId: vehicle.projectId,
        },
        period: input.period,
        ...analysis,
        partsPurchases: sources.purchases
          .filter(
            item =>
              ["confirmed", "received", "closed"].includes(item.status) &&
              vehicleFinanceDate(item.orderedAt).startsWith(`${input.period}-`)
          )
          .map(item => ({
            id: item.id,
            orderNo: item.orderNo,
            itemDescription: item.itemDescription || "未填写配件说明",
            amount: Number(item.amount),
            orderedAt: item.orderedAt,
            hasInvoice: item.hasInvoice,
            status: item.status,
          })),
      };
    }),

  /** 新建或维护运输车辆档案；司机角色不得修改车辆主数据。 */
  saveVehicle: protectedProcedure
    .input(vehicleInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "司机无权维护运输车辆档案",
        });
      }
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      await assertDepartmentBusinessAccess(
        ctx,
        "TRANSPORT",
        input.id ? "edit" : "create"
      );
      return db.transaction(async db => {
        await assertFleetDayWritable(db, input.projectId, new Date());
        const existing = input.id
          ? (
              await db
                .select()
                .from(transportVehicles)
                .where(eq(transportVehicles.id, input.id))
                .limit(1)
                .for("update")
            )[0]
          : null;
        if (
          existing &&
          (input.projectId !== existing.projectId ||
            input.ownership !== existing.ownership ||
            (input.driverPersonId !== undefined &&
              input.driverPersonId !== existing.driverPersonId) ||
            (input.driverUserId !== undefined &&
              input.driverUserId !== existing.driverUserId))
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "车辆历史项目、产权与司机责任不得覆盖，请在车辆管理办理版本与交接",
          });
        if (
          existing &&
          input.status !== "active" &&
          existing.status === "active"
        ) {
          const trips = await db
            .select({ status: transportTrips.status })
            .from(transportTrips)
            .where(eq(transportTrips.vehicleId, existing.id));
          if (
            trips.some(t =>
              ["draft", "submitted", "verified"].includes(t.status)
            )
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "车辆仍有在途票据，请先卸土或作废",
            });
        }
        const targetPersonId =
          input.driverPersonId === undefined
            ? (existing?.driverPersonId ?? null)
            : input.driverPersonId;
        if (targetPersonId)
          await resolveResourcePerson(db, {
            personId: targetPersonId,
            assetType: "vehicle",
            projectId: input.projectId,
            previousUserId: existing?.driverUserId ?? null,
          });
        const values = {
          projectId: input.projectId,
          plateNo: input.plateNo,
          ownership: input.ownership,
          ownerName: input.ownerName ?? null,
          driverUserId: existing?.driverUserId ?? null,
          driverName:
            input.driverName === undefined || input.driverName === ""
              ? (existing?.driverName ?? null)
              : input.driverName,
          driverPhoneEncrypted:
            input.driverPhone === undefined || input.driverPhone === ""
              ? (existing?.driverPhoneEncrypted ?? null)
              : input.driverPhone
                ? encryptSecret(input.driverPhone)
                : null,
          driverPhoneMasked:
            input.driverPhone === undefined || input.driverPhone === ""
              ? (existing?.driverPhoneMasked ?? null)
              : input.driverPhone
                ? maskSecret(input.driverPhone)
                : null,
          boxLengthMeters: String(input.boxLengthMeters),
          boxWidthMeters: String(input.boxWidthMeters),
          boxHeightMeters: String(input.boxHeightMeters),
          loadFactor: String(input.loadFactor),
          payloadTons:
            input.payloadTons === null || input.payloadTons === undefined
              ? null
              : String(input.payloadTons),
          status: input.status,
        };
        if (input.id) {
          if (!existing)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "运输车辆不存在",
            });
          await assertProjectInCurrentScope(ctx, existing.projectId);
          await db
            .update(transportVehicles)
            .set(values)
            .where(eq(transportVehicles.id, input.id));
        } else {
          await db.insert(transportVehicles).values(values);
        }
        const [saved] = await db
          .select({ id: transportVehicles.id })
          .from(transportVehicles)
          .where(eq(transportVehicles.plateNo, input.plateNo))
          .limit(1);
        if (!saved)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "车辆保存未返回记录",
          });
        if (!existing) {
          const [newVehicle] = await db
            .select()
            .from(transportVehicles)
            .where(eq(transportVehicles.id, saved.id))
            .limit(1);
          await db.insert(vehicleFleetProfiles).values({
            ...initialFleetProfile(newVehicle, user.id),
            projectStatus: "pending",
            dispatchStatus: "paused",
          });
        }
        if (targetPersonId !== null || existing?.driverPersonId)
          await saveResourceBinding(db, {
            personId: targetPersonId,
            assetType: "vehicle",
            assetId: saved.id,
            projectId: input.projectId,
            actorUserId: user.id,
            effectiveFrom: chinaBusinessDate(new Date()),
          });
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "transport",
          action: input.id ? "update_vehicle" : "create_vehicle",
          targetType: "transport_vehicle",
          targetId: String(input.id ?? input.plateNo),
          summary: `${input.id ? "维护" : "新建"}运输车辆：${input.plateNo}`,
        });
        return {
          success: true,
          vehicleId: saved.id,
          theoreticalVolumeCubicMeters: calculateTheoreticalVolume(
            input.boxLengthMeters,
            input.boxWidthMeters,
            input.boxHeightMeters,
            input.loadFactor
          ),
        };
      });
    }),

  /** 写卡器台账仅为受控硬件适配预留；现场人员不可绕过后台直接登记或修改设备。 */
  listRfidWriterDevices: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly) return [];
      return db
        .select()
        .from(rfidWriterDevices)
        .where(eq(rfidWriterDevices.projectId, input.projectId))
        .orderBy(desc(rfidWriterDevices.updatedAt));
    }),

  saveRfidWriterDevice: protectedProcedure
    .input(rfidWriterDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const values = {
        projectId: input.projectId,
        deviceCode: input.deviceCode,
        displayName: input.displayName,
        model: input.model ?? null,
        connectionMode: input.connectionMode,
        status: input.status,
        remarks: input.remarks ?? null,
      };
      if (input.id) {
        const [existing] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, input.id))
          .limit(1);
        if (!existing || existing.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "写卡器不存在或不属于当前项目",
          });
        await db
          .update(rfidWriterDevices)
          .set(values)
          .where(eq(rfidWriterDevices.id, input.id));
      } else {
        await db
          .insert(rfidWriterDevices)
          .values({ ...values, createdBy: user.id });
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id
          ? "update_rfid_writer_device"
          : "create_rfid_writer_device",
        targetType: "rfid_writer_device",
        targetId: String(input.id ?? input.deviceCode),
        summary: `${input.id ? "维护" : "登记"}射频写卡器：${input.displayName}（${input.deviceCode}）`,
      });
      return { success: true };
    }),

  /** 卡列表永不返回原始 UID 或司机电话；仅管理员可查看掩码与写卡状态，司机仅可看到本人车辆是否已绑定。 */
  listVehicleRfidCards: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const user = requireAuthenticatedUser(ctx);
      const rows = await db
        .select({
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
        })
        .from(transportVehicleRfidCards)
        .leftJoin(
          transportVehicles,
          eq(transportVehicleRfidCards.vehicleId, transportVehicles.id)
        )
        .leftJoin(
          rfidWriterDevices,
          eq(transportVehicleRfidCards.writerDeviceId, rfidWriterDevices.id)
        )
        .where(eq(transportVehicleRfidCards.projectId, input.projectId))
        .orderBy(desc(transportVehicleRfidCards.updatedAt));
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly)
        return rows
          .filter(row => row.driverUserId === user.id)
          .map(row => ({ ...row, confirmationRecoveryJobId: null }));
      const recoveryJobs = await db
        .select({ id: rfidCardWriteJobs.id, cardId: rfidCardWriteJobs.cardId })
        .from(rfidCardWriteJobs)
        .where(
          and(
            eq(rfidCardWriteJobs.projectId, input.projectId),
            eq(rfidCardWriteJobs.executionMode, "pc_bridge"),
            eq(rfidCardWriteJobs.status, "failed"),
            eq(
              rfidCardWriteJobs.failureReason,
              RFID_CONFIRMATION_RECEIPT_FAILURE
            )
          )
        )
        .orderBy(desc(rfidCardWriteJobs.id))
        .limit(100);
      const latestRecoveryJobByCardId = new Map<number, number>();
      for (const job of recoveryJobs)
        if (!latestRecoveryJobByCardId.has(job.cardId))
          latestRecoveryJobByCardId.set(job.cardId, job.id);
      return rows.map(row => ({
        ...row,
        confirmationRecoveryJobId:
          latestRecoveryJobByCardId.get(row.id) ?? null,
      }));
    }),

  revokeVehicleRfidCard: protectedProcedure
    .input(rfidCardManagementInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.id, input.cardId),
            eq(transportVehicleRfidCards.projectId, input.projectId)
          )
        )
        .limit(1);
      if (!card)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆射频卡不存在或不属于当前项目",
        });
      if (card.status === "revoked")
        throw new TRPCError({
          code: "CONFLICT",
          message: "该车辆射频卡已经挂失停用",
        });
      await db
        .update(transportVehicleRfidCards)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(transportVehicleRfidCards.id, input.cardId),
            eq(transportVehicleRfidCards.projectId, input.projectId),
            ne(transportVehicleRfidCards.status, "revoked")
          )
        );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "revoke_vehicle_rfid_card",
        targetType: "transport_vehicle_rfid_card",
        targetId: String(card.id),
        summary: `挂失停用车辆射频卡：${card.cardUidMasked}${input.reason ? `；原因：${input.reason}` : ""}`,
      });
      return { success: true };
    }),

  unbindVehicleRfidCard: protectedProcedure
    .input(rfidCardManagementInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.id, input.cardId),
            eq(transportVehicleRfidCards.projectId, input.projectId)
          )
        )
        .limit(1);
      if (!card)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆射频卡不存在或不属于当前项目",
        });
      if (!card.vehicleId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "该车辆射频卡已经解除绑定",
        });
      const [openTrip] = await db
        .select({ id: transportTrips.id, tripNo: transportTrips.tripNo })
        .from(transportTrips)
        .where(
          and(
            eq(transportTrips.projectId, input.projectId),
            eq(transportTrips.vehicleId, card.vehicleId),
            isNull(transportTrips.unloadConfirmedAt),
            ne(transportTrips.status, "void"),
            ne(transportTrips.status, "settled")
          )
        )
        .limit(1);
      if (openTrip)
        throw new TRPCError({
          code: "CONFLICT",
          message: `车辆存在未闭环运输趟次 ${openTrip.tripNo}，完成闭环后再解除绑定`,
        });
      await db
        .update(transportVehicleRfidCards)
        .set({ vehicleId: null, status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(transportVehicleRfidCards.id, input.cardId),
            eq(transportVehicleRfidCards.projectId, input.projectId),
            eq(transportVehicleRfidCards.vehicleId, card.vehicleId)
          )
        );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "unbind_vehicle_rfid_card",
        targetType: "transport_vehicle_rfid_card",
        targetId: String(card.id),
        summary: `解除车辆射频卡绑定：${card.cardUidMasked}${input.reason ? `；原因：${input.reason}` : ""}`,
      });
      return { success: true };
    }),

  /** 为车辆绑定射频卡时，原始 UID 与电话仅在当前请求中使用，随后以指纹/密文和掩码保存。 */
  saveVehicleRfidCard: protectedProcedure
    .input(rfidCardBindingInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      const { db, vehicle } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      if (!vehicle.driverName?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先在车辆台账录入外部司机姓名，再创建射频卡绑定",
        });
      if (input.writerDeviceId) {
        const [writer] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, input.writerDeviceId))
          .limit(1);
        if (
          !writer ||
          writer.projectId !== input.projectId ||
          writer.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请选择当前项目可用的写卡器",
          });
      }
      const cardUidFingerprint = fingerprintRfidCardUid(input.cardUid);
      const [existing] = input.id
        ? await db
            .select()
            .from(transportVehicleRfidCards)
            .where(eq(transportVehicleRfidCards.id, input.id))
            .limit(1)
        : [];
      if (input.id && (!existing || existing.projectId !== input.projectId))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆射频卡绑定不存在或不属于当前项目",
        });
      const reusingRevokedUnboundCard = Boolean(
        input.reuseRevokedUnboundCard &&
          existing &&
          existing.status === "revoked" &&
          !existing.vehicleId &&
          existing.cardUidFingerprint === cardUidFingerprint
      );
      if (input.reuseRevokedUnboundCard && !reusingRevokedUnboundCard)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅已挂失、已解绑且 UID 未变化的历史车辆卡可重新绑定",
        });
      const [existingByUid] = await db
        .select({ id: transportVehicleRfidCards.id })
        .from(transportVehicleRfidCards)
        .where(
          eq(transportVehicleRfidCards.cardUidFingerprint, cardUidFingerprint)
        )
        .limit(1);
      if (existingByUid && existingByUid.id !== input.id)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "该射频卡仍由其他车辆卡台账占用，请先在对应台账完成挂失和解除绑定",
        });
      if (reusingRevokedUnboundCard) {
        const [activeCardForVehicle] = await db
          .select({ id: transportVehicleRfidCards.id })
          .from(transportVehicleRfidCards)
          .where(
            and(
              eq(transportVehicleRfidCards.projectId, input.projectId),
              eq(transportVehicleRfidCards.vehicleId, input.vehicleId),
              eq(transportVehicleRfidCards.status, "active")
            )
          )
          .limit(1);
        if (activeCardForVehicle && activeCardForVehicle.id !== input.id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "所选车辆已有已启用车辆卡，请先确认原卡状态后再重新绑定",
          });
        const [preparedJob] = await db
          .select({ id: rfidCardWriteJobs.id })
          .from(rfidCardWriteJobs)
          .where(
            and(
              eq(rfidCardWriteJobs.cardId, input.id!),
              eq(rfidCardWriteJobs.status, "prepared")
            )
          )
          .limit(1);
        if (preparedJob)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "该历史车辆卡仍有处理中写卡任务，请等待任务结束后再重新绑定",
          });
      }
      const managementCode =
        input.managementCode?.trim() ||
        existing?.managementCode ||
        createRfidCardManagementCode();
      const [existingByManagementCode] = await db
        .select({ id: transportVehicleRfidCards.id })
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.projectId, input.projectId),
            eq(transportVehicleRfidCards.managementCode, managementCode)
          )
        )
        .limit(1);
      if (existingByManagementCode && existingByManagementCode.id !== input.id)
        throw new TRPCError({
          code: "CONFLICT",
          message: "当前项目已使用该车辆卡管理编号，请更换编号后保存",
        });
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
              : input.status === "revoked"
                ? "revoked"
                : "suspended";
        await db
          .update(transportVehicleRfidCards)
          .set({
            ...values,
            status: nextStatus,
            revokedAt:
              nextStatus === "revoked"
                ? (existing.revokedAt ?? new Date())
                : null,
            lastWrittenAt: reusingRevokedUnboundCard
              ? null
              : existing.lastWrittenAt,
            payloadVersion: reusingRevokedUnboundCard
              ? existing.payloadVersion + 1
              : existing.payloadVersion,
          })
          .where(eq(transportVehicleRfidCards.id, input.id));
      } else {
        // 新卡先建立“待写入”逻辑绑定；只有实体写入、逐字节回读和服务端确认全部成功后才转为 active。
        await db.insert(transportVehicleRfidCards).values({
          ...values,
          status: "suspended",
          revokedAt: null,
          createdBy: user.id,
          issuedAt: new Date(),
        });
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: reusingRevokedUnboundCard
          ? "rebind_revoked_unbound_vehicle_rfid_card"
          : input.id
            ? "update_vehicle_rfid_card"
            : "bind_vehicle_rfid_card",
        targetType: "transport_vehicle_rfid_card",
        targetId: String(input.id ?? input.vehicleId),
        summary: `${reusingRevokedUnboundCard ? "重新绑定已解绑" : input.id ? "维护" : "绑定"}车辆 ${vehicle.plateNo} 的射频卡（管理编号 ${managementCode}）`,
      });
      return { success: true };
    }),

  /**
   * 手机首次发卡候选由服务端统一判定，避免前端因司机手机号脱敏、卡片查询延迟或缓存状态把
   * 实际可发卡车辆错误置灰。返回的是最小化车辆识别信息与业务原因，不返回司机手机号明文。
   */
  listMobileNfcInitialIssueCandidates: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertCanIssueMobileNfcCards(ctx, roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const [projectVehicles, projectCards] = await Promise.all([
        db
          .select()
          .from(transportVehicles)
          .where(eq(transportVehicles.projectId, input.projectId))
          .orderBy(desc(transportVehicles.updatedAt)),
        db
          .select({ vehicleId: transportVehicleRfidCards.vehicleId })
          .from(transportVehicleRfidCards)
          .where(
            and(
              eq(transportVehicleRfidCards.projectId, input.projectId),
              eq(transportVehicleRfidCards.status, "active")
            )
          ),
      ]);
      const activeCardVehicleIds = new Set(
        projectCards.map(card => card.vehicleId)
      );
      return projectVehicles.map(vehicle => {
        const reason =
          vehicle.status !== "active"
            ? "车辆已停用，请先在车辆台账启用"
            : !vehicle.driverName?.trim()
              ? "未录入司机姓名"
              : !vehicle.driverPhoneEncrypted
                ? "未录入司机手机号"
                : activeCardVehicleIds.has(vehicle.id)
                  ? "已有启用车辆卡，请使用补写或换卡流程"
                  : null;
        return {
          id: vehicle.id,
          plateNo: vehicle.plateNo,
          driverName: vehicle.driverName ?? "未录入",
          vehicleStatus: vehicle.status,
          eligible: !reason,
          reason,
        };
      });
    }),

  /**
   * 全新空白 NTAG216 的手机首次发卡入口。先创建“待写入”车辆卡和受控任务，再将签名载荷
   * 返回给当前 Android Chrome 交互；只有 confirmRfidCardWrite 成功确认后卡片才变为 active。
   * 这样现场不需要先在 PC 端手工读取 UID 或建立空卡绑定。
   */
  prepareMobileNfcInitialIssue: protectedProcedure
    .input(mobileNfcInitialIssueInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      await assertCanIssueMobileNfcCards(ctx, roleCodes);
      const { db, vehicle } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      if (vehicle.status !== "active")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前车辆未启用，不能发放 NFC 车辆卡",
        });
      if (!vehicle.driverName?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先在车辆台账录入外部司机姓名，再进行手机首次发卡",
        });
      const driverPhone = vehicle.driverPhoneEncrypted
        ? decryptSecret(vehicle.driverPhoneEncrypted)
        : "";
      if (!driverPhone)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先在车辆台账录入司机手机号，再进行手机首次发卡",
        });

      const [activeCard] = await db
        .select({ id: transportVehicleRfidCards.id })
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.projectId, input.projectId),
            eq(transportVehicleRfidCards.vehicleId, vehicle.id),
            eq(transportVehicleRfidCards.status, "active")
          )
        )
        .limit(1);
      if (activeCard)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "该车辆已有已启用 NFC 卡；如需替换或补写，请在车辆卡台账中执行受控操作",
        });

      // 写入失败的首次任务保留为 suspended，下一次手机发卡复用同一逻辑卡绑定，避免产生无主卡记录。
      let [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(
          and(
            eq(transportVehicleRfidCards.projectId, input.projectId),
            eq(transportVehicleRfidCards.vehicleId, vehicle.id),
            eq(transportVehicleRfidCards.status, "suspended"),
            isNull(transportVehicleRfidCards.lastWrittenAt)
          )
        )
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
        [card] = await db
          .select()
          .from(transportVehicleRfidCards)
          .where(
            eq(transportVehicleRfidCards.cardUidFingerprint, cardUidFingerprint)
          )
          .limit(1);
      }
      if (!card)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "首次发卡绑定创建失败",
        });

      const payload = buildTransportNfcCardPayload({
        cardId: card.id,
        projectId: input.projectId,
        payloadVersion: card.payloadVersion,
        plateNo: vehicle.plateNo,
        driverName: vehicle.driverName,
        driverPhone,
      });
      const payloadContract = createTransportNfcCardPayloadContract(payload);
      const jobNo = createRfidWriteJobNo(input.projectId);
      const nfcEntryUrl = buildTransportNfcDeepLink({
        cardId: card.id,
        projectId: input.projectId,
        payloadVersion: card.payloadVersion,
      });
      await db.insert(rfidCardWriteJobs).values({
        jobNo,
        projectId: input.projectId,
        vehicleId: vehicle.id,
        cardId: card.id,
        writerDeviceId: null,
        action: "issue",
        payloadFingerprint: payloadContract.payloadFingerprint,
        payloadEncrypted: encryptSecret(
          JSON.stringify({
            payloadJson: payloadContract.payloadJson,
            nfcEntryUrl,
          })
        ),
        executionMode: "mobile_web_nfc",
        payloadVersion: card.payloadVersion,
        preparedBy: user.id,
      });
      const [job] = await db
        .select({ id: rfidCardWriteJobs.id })
        .from(rfidCardWriteJobs)
        .where(eq(rfidCardWriteJobs.jobNo, jobNo))
        .limit(1);
      if (!job)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "手机首次发卡任务创建失败",
        });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "prepare_mobile_nfc_initial_issue",
        targetType: "transport_vehicle_rfid_card",
        targetId: String(card.id),
        summary: `准备手机首次发卡：车辆 ${vehicle.plateNo}，系统卡号 ${card.cardUidMasked}`,
      });
      return {
        success: true,
        jobId: job.id,
        jobNo,
        cardId: card.id,
        cardCode: card.cardUidMasked,
        payload,
        nfcEntryUrl,
        payloadFingerprint: payloadContract.payloadFingerprint,
        hardwareMode: "mobile_web_nfc" as const,
      };
    }),

  /** 管理员准备一次写卡任务。返回的载荷只在本次受控响应中提供，数据库仅保存其摘要以防止卡片内容被静态导出。 */
  prepareRfidCardWrite: protectedProcedure
    .input(rfidWritePrepareInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(eq(transportVehicleRfidCards.id, input.cardId))
        .limit(1);
      if (!card || card.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆射频卡绑定不存在或不属于当前项目",
        });
      if (!card.vehicleId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该车辆卡已解除绑定，不能进入写卡流程",
        });
      if (card.status === "revoked")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该车辆卡已挂失停用，不能再生成写卡任务",
        });
      if (input.action === "issue") {
        if (card.lastWrittenAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该车辆卡已完成首次写入，请使用补写流程",
          });
        // 兼容历史版本中已被提前标记 active、但从未完成实体写入确认的卡；新记录正常为 suspended。
        if (card.status !== "suspended" && card.status !== "active")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "当前车辆卡状态不能执行首次写入",
          });
      }
      if (
        input.action === "rewrite" &&
        (card.status !== "active" || !card.lastWrittenAt)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅已成功写入且仍启用的车辆卡可执行补写",
        });
      const now = new Date();
      const preparedJobs = await db
        .select({
          id: rfidCardWriteJobs.id,
          jobNo: rfidCardWriteJobs.jobNo,
          executionMode: rfidCardWriteJobs.executionMode,
          bridgeTokenExpiresAt: rfidCardWriteJobs.bridgeTokenExpiresAt,
        })
        .from(rfidCardWriteJobs)
        .where(
          and(
            eq(rfidCardWriteJobs.cardId, card.id),
            eq(rfidCardWriteJobs.status, "prepared")
          )
        )
        .limit(20);
      const expiredPcBridgeJobs = preparedJobs.filter(
        job =>
          job.executionMode === "pc_bridge" &&
          (!job.bridgeTokenExpiresAt ||
            job.bridgeTokenExpiresAt.getTime() <= now.getTime())
      );
      if (expiredPcBridgeJobs.length) {
        await db.transaction(async tx => {
          for (const expiredJob of expiredPcBridgeJobs) {
            const jobWrite = await tx
              .update(rfidCardWriteJobs)
              .set({
                status: "cancelled",
                failureReason: "bridge_token_expired_before_start",
              })
              .where(
                and(
                  eq(rfidCardWriteJobs.id, expiredJob.id),
                  eq(rfidCardWriteJobs.status, "prepared")
                )
              );
            if (!didConditionalWriteApply(jobWrite)) continue;
            await tx.insert(auditLogs).values({
              userId: user.id,
              module: "transport",
              action: "cancel_expired_rfid_card_write",
              targetType: "rfid_card_write_job",
              targetId: String(expiredJob.id),
              summary: `一次性桥接授权已到期，已安全作废车辆卡写卡任务 ${expiredJob.jobNo}`,
            });
          }
        });
      }
      const preparedJob = preparedJobs.find(
        job => !expiredPcBridgeJobs.some(expiredJob => expiredJob.id === job.id)
      );
      if (preparedJob) {
        if (!input.replacePreparedPcBridgeJob)
          throw new TRPCError({
            code: "CONFLICT",
            message: "该车辆卡仍有未完成写卡任务，请确认结束原任务后重新生成",
          });
        await db.transaction(async tx => {
          const jobWrite = await tx
            .update(rfidCardWriteJobs)
            .set({
              status: "cancelled",
              failureReason: "administrator_replaced_before_write",
            })
            .where(
              and(
                eq(rfidCardWriteJobs.id, preparedJob.id),
                eq(rfidCardWriteJobs.status, "prepared")
              )
            );
          assertConditionalStatusWrite(jobWrite, "原写卡任务");
          await tx.insert(auditLogs).values({
            userId: user.id,
            module: "transport",
            action: "replace_rfid_card_write",
            targetType: "rfid_card_write_job",
            targetId: String(preparedJob.id),
            summary: `管理员确认结束原车辆卡写卡任务 ${preparedJob.jobNo} 并重新生成任务`,
          });
        });
      }
      const { vehicle } = await getScopedVehicle(
        ctx,
        card.vehicleId,
        input.projectId,
        roleCodes
      );
      if (!vehicle.driverName?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "车辆未录入外部司机姓名，不能生成写卡载荷",
        });
      // undefined 沿用历史写卡器；null 明确表示由手机 Web NFC 发卡，不关联 Windows 写卡器。
      const writerDeviceId =
        input.writerDeviceId === undefined
          ? card.writerDeviceId
          : input.writerDeviceId;
      if (writerDeviceId) {
        const [writer] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, writerDeviceId))
          .limit(1);
        if (
          !writer ||
          writer.projectId !== input.projectId ||
          writer.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "写卡器不存在、未启用或不属于当前项目",
          });
      }
      const driverPhone = card.driverPhoneEncrypted
        ? decryptSecret(card.driverPhoneEncrypted)
        : "";
      if (!driverPhone)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该车辆射频卡未保存司机电话，不能生成现场可核对的写卡载荷",
        });
      const payload = buildTransportNfcCardPayload({
        cardId: card.id,
        projectId: input.projectId,
        payloadVersion: card.payloadVersion,
        plateNo: vehicle.plateNo,
        driverName: vehicle.driverName,
        driverPhone,
      });
      const payloadContract = createTransportNfcCardPayloadContract(payload);
      const jobNo = createRfidWriteJobNo(input.projectId);
      const nfcEntryUrl = buildTransportNfcDeepLink({
        cardId: card.id,
        projectId: input.projectId,
        payloadVersion: card.payloadVersion,
      });
      const bridgeToken =
        input.executionMode === "pc_bridge" ? createRfidBridgeToken() : null;
      const bridgeTokenExpiresAt = bridgeToken
        ? new Date(Date.now() + RFID_BRIDGE_TOKEN_TTL_MS)
        : null;
      await db.insert(rfidCardWriteJobs).values({
        jobNo,
        projectId: input.projectId,
        vehicleId: vehicle.id,
        cardId: card.id,
        writerDeviceId: writerDeviceId ?? null,
        action: input.action,
        payloadFingerprint: payloadContract.payloadFingerprint,
        payloadEncrypted: encryptSecret(
          JSON.stringify({
            payloadJson: payloadContract.payloadJson,
            nfcEntryUrl,
          })
        ),
        executionMode: input.executionMode,
        bridgeTokenHash: bridgeToken ? hashRfidBridgeToken(bridgeToken) : null,
        bridgeTokenExpiresAt,
        payloadVersion: card.payloadVersion,
        preparedBy: user.id,
      });
      const [job] = await db
        .select({ id: rfidCardWriteJobs.id })
        .from(rfidCardWriteJobs)
        .where(eq(rfidCardWriteJobs.jobNo, jobNo))
        .limit(1);
      if (!job)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "写卡任务创建失败",
        });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "prepare_rfid_card_write",
        targetType: "rfid_card_write_job",
        targetId: String(job.id),
        summary: `准备${input.action === "rewrite" ? "补写" : input.action === "revoke" ? "挂失" : "写入"}车辆 ${vehicle.plateNo} 的射频卡任务`,
      });
      return input.executionMode === "pc_bridge"
        ? {
            success: true,
            jobId: job.id,
            jobNo,
            payloadFingerprint: payloadContract.payloadFingerprint,
            bridgeToken,
            bridgeTokenExpiresAt: bridgeTokenExpiresAt?.toISOString() ?? null,
            hardwareMode: "pc_bridge" as const,
          }
        : {
            success: true,
            jobId: job.id,
            jobNo,
            payload,
            nfcEntryUrl,
            payloadFingerprint: payloadContract.payloadFingerprint,
            hardwareMode: "manual_confirmation" as const,
          };
    }),

  /**
   * 本机已完成写入、逐字节回读和摘要一致，但 DPAPI 收据保存失败时，仅重新签发一次短时令牌。
   * 该接口绝不直接确认成功；桥接仍须读取同一实体卡并以只读方式逐字节复核完整 NDEF 后调用 complete。
   */
  recoverRfidCardConfirmation: protectedProcedure
    .input(rfidConfirmationRecoveryInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [job] = await db
        .select()
        .from(rfidCardWriteJobs)
        .where(eq(rfidCardWriteJobs.id, input.id))
        .limit(1);
      if (!job || job.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "待恢复的写卡任务不存在或不属于当前项目",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(eq(transportVehicleRfidCards.id, job.cardId))
        .limit(1);
      const [latestJob] = await db
        .select({ id: rfidCardWriteJobs.id })
        .from(rfidCardWriteJobs)
        .where(eq(rfidCardWriteJobs.cardId, job.cardId))
        .orderBy(desc(rfidCardWriteJobs.id))
        .limit(1);
      if (
        !card ||
        !latestJob ||
        !isRfidConfirmationRecoveryEligible({
          job,
          card,
          latestJobIdForCard: latestJob.id,
        })
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该任务不符合只读复核恢复条件，请勿重新写卡",
        });
      }
      const bridgeToken = createRfidBridgeToken();
      const bridgeTokenExpiresAt = new Date(
        Date.now() + RFID_BRIDGE_TOKEN_TTL_MS
      );
      await db.transaction(async tx => {
        const jobWrite = await tx
          .update(rfidCardWriteJobs)
          .set({
            status: "prepared",
            failureReason: "confirmation_recovery_prepared",
            bridgeTokenHash: hashRfidBridgeToken(bridgeToken),
            bridgeTokenExpiresAt,
            confirmedBy: null,
            confirmedAt: null,
          })
          .where(
            and(
              eq(rfidCardWriteJobs.id, job.id),
              eq(rfidCardWriteJobs.status, "failed"),
              eq(
                rfidCardWriteJobs.failureReason,
                RFID_CONFIRMATION_RECEIPT_FAILURE
              )
            )
          );
        assertConditionalStatusWrite(jobWrite, "写卡确认恢复任务");
        await tx.insert(auditLogs).values({
          userId: user.id,
          module: "transport",
          action: "recover_rfid_card_confirmation",
          targetType: "rfid_card_write_job",
          targetId: String(job.id),
          summary: `重新签发车辆卡任务 ${job.jobNo} 的只读复核确认授权；不再次写入实体卡`,
        });
      });
      return {
        success: true,
        jobId: job.id,
        jobNo: job.jobNo,
        bridgeToken,
        bridgeTokenExpiresAt: bridgeTokenExpiresAt.toISOString(),
      };
    }),

  /** 物理写卡器接入前由现场管理员确认结果；失败和确认均保留任务审计，不能通过前端静默修改卡状态。 */
  confirmRfidCardWrite: protectedProcedure
    .input(rfidWriteConfirmInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [job] = await db
        .select()
        .from(rfidCardWriteJobs)
        .where(eq(rfidCardWriteJobs.id, input.id))
        .limit(1);
      if (!job || job.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "写卡任务不存在或不属于当前项目",
        });
      if (job.status !== "prepared")
        throw new TRPCError({
          code: "CONFLICT",
          message: "该写卡任务已处理，请勿重复确认",
        });
      if (job.executionMode === "pc_bridge")
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "本地 uTrust 写卡任务必须由桥接完成 UID 校验与回读确认，不能手工确认成功",
        });
      const now = new Date();
      await db.transaction(async tx => {
        const jobWrite = await tx
          .update(rfidCardWriteJobs)
          .set({
            status: input.success ? "confirmed" : "failed",
            failureReason: input.success
              ? null
              : (input.failureReason ?? "现场写卡未成功"),
            confirmedBy: user.id,
            confirmedAt: now,
          })
          .where(
            and(
              eq(rfidCardWriteJobs.id, job.id),
              eq(rfidCardWriteJobs.status, "prepared")
            )
          );
        assertConditionalStatusWrite(jobWrite, "写卡任务");
        if (input.success) {
          const cardStateCondition =
            job.action === "issue"
              ? and(
                  eq(transportVehicleRfidCards.id, job.cardId),
                  isNull(transportVehicleRfidCards.lastWrittenAt),
                  inArray(transportVehicleRfidCards.status, [
                    "suspended",
                    "active",
                  ])
                )
              : job.action === "rewrite"
                ? and(
                    eq(transportVehicleRfidCards.id, job.cardId),
                    eq(transportVehicleRfidCards.status, "active"),
                    isNotNull(transportVehicleRfidCards.lastWrittenAt)
                  )
                : and(
                    eq(transportVehicleRfidCards.id, job.cardId),
                    ne(transportVehicleRfidCards.status, "revoked")
                  );
          const cardWrite = await tx
            .update(transportVehicleRfidCards)
            .set({
              lastWrittenAt: now,
              status: job.action === "revoke" ? "revoked" : "active",
              revokedAt: job.action === "revoke" ? now : null,
            })
            .where(cardStateCondition);
          assertConditionalStatusWrite(cardWrite, "车辆卡");
          if (job.writerDeviceId)
            await tx
              .update(rfidWriterDevices)
              .set({ lastConfirmedAt: now })
              .where(eq(rfidWriterDevices.id, job.writerDeviceId));
        }
        await tx.insert(auditLogs).values({
          userId: user.id,
          module: "transport",
          action: input.success
            ? "confirm_rfid_card_write"
            : "fail_rfid_card_write",
          targetType: "rfid_card_write_job",
          targetId: String(job.id),
          summary: input.success
            ? "确认射频写卡任务成功"
            : "记录射频写卡任务失败",
        });
      });
      return {
        success: true,
        status: input.success ? ("confirmed" as const) : ("failed" as const),
      };
    }),

  /** 本地 uTrust 测试桥接只登记结果与不可逆 UID 指纹，不得将测试成功直接转化为正式车辆卡已签发。 */
  recordRfidHardwareTest: protectedProcedure
    .input(rfidHardwareTestInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      if (input.writerDeviceId) {
        const [writer] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, input.writerDeviceId))
          .limit(1);
        if (
          !writer ||
          writer.projectId !== input.projectId ||
          writer.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请选择当前项目已启用的写卡器",
          });
        if (input.success)
          await db
            .update(rfidWriterDevices)
            .set({ lastConfirmedAt: new Date() })
            .where(eq(rfidWriterDevices.id, input.writerDeviceId));
      }
      const fingerprintSummary = input.cardUidFingerprint
        ? `，测试卡指纹 ${input.cardUidFingerprint.slice(0, 10)}…`
        : "";
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.success
          ? "rfid_hardware_test_success"
          : "rfid_hardware_test_failed",
        targetType: "rfid_writer_hardware_test",
        targetId: String(input.writerDeviceId ?? input.projectId),
        summary: input.success
          ? `uTrust 本地测试写卡与回读通过${fingerprintSummary}`
          : `uTrust 本地测试写卡失败：${input.failureReason ?? "未返回原因"}`,
      });
      return { success: true };
    }),

  /** 已启用车辆卡恢复初卡前必须先受控停用，避免物理擦除成功后仍有可用卡状态。 */
  prepareRfidInitialErase: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        cardId: z.number().int().positive(),
        writerDeviceId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(eq(transportVehicleRfidCards.id, input.cardId))
        .limit(1);
      if (!card || card.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "待恢复初卡的车辆卡不存在或不属于当前项目",
        });
      if (input.writerDeviceId) {
        const [writer] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, input.writerDeviceId))
          .limit(1);
        if (
          !writer ||
          writer.projectId !== input.projectId ||
          writer.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "所选写卡器不可用或不属于当前项目",
          });
      }
      const wasActive = card.status === "active";
      if (wasActive) {
        await db
          .update(transportVehicleRfidCards)
          .set({ status: "suspended" })
          .where(
            and(
              eq(transportVehicleRfidCards.id, card.id),
              eq(transportVehicleRfidCards.status, "active")
            )
          );
        await db.insert(auditLogs).values({
          userId: user.id,
          module: "transport",
          action: "rfid_initial_erase_suspended",
          targetType: "transport_vehicle_rfid_card",
          targetId: String(card.id),
          summary: `已停用车辆卡 ${card.cardUidMasked}，准备擦除并恢复初卡；擦除未完成前该卡不得继续用于运输票据。`,
        });
      }
      return {
        success: true,
        cardId: card.id,
        wasActive,
        cardStatus: wasActive ? ("suspended" as const) : card.status,
      };
    }),

  /**
   * 初卡擦除的服务端审计终结。物理擦除由本地桥接固定清空 NDEF 用户区完成；
   * 已启用卡须先经 prepareRfidInitialErase 停用，随后才能写入最终已停用状态。
   */
  finalizeRfidInitialErase: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        cardId: z.number().int().positive(),
        cardUidFingerprint: z.string().min(16).max(256),
        writerDeviceId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [card] = await db
        .select()
        .from(transportVehicleRfidCards)
        .where(eq(transportVehicleRfidCards.id, input.cardId))
        .limit(1);
      if (!card || card.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "待恢复初卡的车辆卡不存在或不属于当前项目",
        });
      if (card.status === "active")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "正在使用的车辆卡须先执行停用并擦除恢复初卡",
        });
      if (!["revoked", "suspended"].includes(card.status))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前卡状态不允许恢复初卡，请先停止该卡的业务使用",
        });
      if (card.cardUidFingerprint !== input.cardUidFingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message: "感应卡 UID 与所选车辆卡不一致，已拒绝登记擦除结果",
        });
      if (input.writerDeviceId) {
        const [writer] = await db
          .select()
          .from(rfidWriterDevices)
          .where(eq(rfidWriterDevices.id, input.writerDeviceId))
          .limit(1);
        if (
          !writer ||
          writer.projectId !== input.projectId ||
          writer.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "所选写卡器不可用或不属于当前项目",
          });
        await db
          .update(rfidWriterDevices)
          .set({ lastConfirmedAt: new Date() })
          .where(eq(rfidWriterDevices.id, input.writerDeviceId));
      }
      const now = new Date();
      await db
        .update(transportVehicleRfidCards)
        .set({ status: "revoked", revokedAt: now })
        .where(eq(transportVehicleRfidCards.id, card.id));
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

  listFreightRules: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(freightRateRules)
        .where(eq(freightRateRules.projectId, input.projectId))
        .orderBy(desc(freightRateRules.effectiveFrom));
    }),

  /** 保存项目运输阶梯运价。司机无权维护合同价格，以防绕过审核调整运费。 */
  saveFreightRule: protectedProcedure
    .input(freightRuleInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "司机无权维护运输运价规则",
        });
      }
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const values = {
        projectId: input.projectId,
        materialName: input.materialName ?? null,
        settlementUnit: input.settlementUnit,
        startDistanceKm: String(input.startDistanceKm),
        basePricePerUnit: String(roundMoney(input.basePricePerUnit)),
        stepMeters: input.stepMeters,
        stepIncreasePerUnit: String(roundMoney(input.stepIncreasePerUnit)),
        effectiveFrom: toBusinessDate(input.effectiveFrom),
        effectiveTo: input.effectiveTo
          ? toBusinessDate(input.effectiveTo)
          : null,
        status: input.status,
      };
      if (input.id) {
        const [existing] = await db
          .select()
          .from(freightRateRules)
          .where(eq(freightRateRules.id, input.id))
          .limit(1);
        if (!existing || existing.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "运输运价规则不存在",
          });
        await db
          .update(freightRateRules)
          .set(values)
          .where(eq(freightRateRules.id, input.id));
      } else {
        await db.insert(freightRateRules).values(values);
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id ? "update_freight_rule" : "create_freight_rule",
        targetType: "freight_rate_rule",
        targetId: String(input.id ?? input.projectId),
        summary: `维护运输阶梯运价规则：${input.settlementUnit}`,
      });
      return { success: true };
    }),

  /** 返回当前项目已配置的装土点、卸土点及其现场刷卡管理员。 */
  listSites: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(transportSites)
        .where(eq(transportSites.projectId, input.projectId))
        .orderBy(transportSites.siteType, transportSites.name);
      const administratorIds = Array.from(
        new Set(
          rows
            .map(item => item.administratorUserId)
            .filter((id): id is number => Boolean(id))
        )
      );
      const administrators = administratorIds.length
        ? await Promise.all(
            administratorIds.map(
              async id =>
                (
                  await db
                    .select({ id: users.id, name: users.name })
                    .from(users)
                    .where(eq(users.id, id))
                    .limit(1)
                )[0]
            )
          )
        : [];
      const nameById = new Map(
        administrators.filter(Boolean).map(item => [item!.id, item!.name])
      );
      return rows.map(({ latitude, longitude, ...site }) => ({
        ...site,
        /** 坐标仅用于服务端围栏计算；业务端只显示中文详细地址与解析状态。 */
        addressResolved: latitude !== null && longitude !== null,
        administratorName: site.administratorUserId
          ? (nameById.get(site.administratorUserId) ?? "未找到用户")
          : "未配置",
      }));
    }),

  /** 供手机端在项目范围内收敛地点维护入口；写入过程仍会重复执行相同校验。 */
  siteManagementAccess: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      return { canManage: await canManageTransportSites(ctx, roleCodes) };
    }),

  /** 现场地点和刷卡管理员只允许运输负责人、项目负责人或系统管理员维护。 */
  saveSite: protectedProcedure
    .input(transportSiteInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (!(await canManageTransportSites(ctx, roleCodes)))
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "当前账号未被授予运输地点新增或编辑权限，请联系超级管理员配置运输创建/编辑权限",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      if (input.administratorUserId) {
        const [administrator] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.administratorUserId))
          .limit(1);
        if (!administrator)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "指定的现场管理员账号不存在",
          });
      }
      const [existingSite] = input.id
        ? await db
            .select()
            .from(transportSites)
            .where(eq(transportSites.id, input.id))
            .limit(1)
        : [null];
      if (
        input.id &&
        (!existingSite || existingSite.projectId !== input.projectId)
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "运输现场地点不存在或不属于当前项目",
        });
      const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
      const previousSafety = effectiveTransportSafety(existingSite, {});
      // Omitted safety fields are edits, not a request to restore defaults.
      const requestedSafety = effectiveTransportSafety(input, previousSafety);
      if (
        !isSuperAdmin &&
        JSON.stringify(previousSafety) !== JSON.stringify(requestedSafety)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "运输安全阈值仅超级管理员可在后台维护",
        });
      const rawAddress =
        input.address === undefined
          ? (existingSite?.address ?? null)
          : input.address?.trim() || null;
      const addressResolution =
        rawAddress && rawAddress !== existingSite?.address
          ? await resolveTransportSiteAddress(rawAddress)
          : null;
      const values = {
        projectId: input.projectId,
        siteType: input.siteType,
        name: input.name,
        address: addressResolution?.address ?? rawAddress,
        latitude: addressResolution
          ? String(addressResolution.latitude)
          : input.latitude === undefined
            ? (existingSite?.latitude ?? null)
            : input.latitude === null
              ? null
              : String(input.latitude),
        longitude: addressResolution
          ? String(addressResolution.longitude)
          : input.longitude === undefined
            ? (existingSite?.longitude ?? null)
            : input.longitude === null
              ? null
              : String(input.longitude),
        administratorUserId:
          input.administratorUserId === undefined
            ? (existingSite?.administratorUserId ?? null)
            : input.administratorUserId,
        ...requestedSafety,
        status: input.status ?? existingSite?.status ?? "active",
      };
      if (input.id) {
        const [existing] = await db
          .select()
          .from(transportSites)
          .where(eq(transportSites.id, input.id))
          .limit(1);
        if (!existing || existing.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "运输现场地点不存在或不属于当前项目",
          });
        await db
          .update(transportSites)
          .set(values)
          .where(eq(transportSites.id, input.id));
      } else {
        await db
          .insert(transportSites)
          .values({ ...values, createdBy: user.id });
      }
      const unloadSafetySummary =
        input.siteType === "unload"
          ? `；最短 ${values.minimumTransitMinutes} 分钟（${values.minimumTransitEnabled ? "硬拦截" : "仅提示"}），定位容差 ${values.unloadGeofenceMeters} 米（${values.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}）`
          : "";
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id ? "update_transport_site" : "create_transport_site",
        targetType: "transport_site",
        targetId: String(input.id ?? input.name),
        summary: `${input.id ? "维护" : "配置"}${input.siteType === "load" ? "装土" : "卸土"}点：${input.name}${unloadSafetySummary}`,
      });
      const siteId =
        input.id ??
        (
          await db
            .select({ id: transportSites.id })
            .from(transportSites)
            .where(
              and(
                eq(transportSites.projectId, input.projectId),
                eq(transportSites.siteType, input.siteType),
                eq(transportSites.name, input.name)
              )
            )
            .limit(1)
        )[0]?.id;
      return { success: true, id: siteId ?? null };
    }),

  /** 返回当前项目已登记的装卸点读卡设备，供现场终端选择并对双设备刷卡事件留痕。 */
  listReaderDevices: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
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
        })
        .from(transportReaderDevices)
        .innerJoin(
          transportSites,
          eq(transportReaderDevices.siteId, transportSites.id)
        )
        .where(eq(transportReaderDevices.projectId, input.projectId))
        .orderBy(transportSites.siteType, transportReaderDevices.displayName);
    }),

  /** 运输负责人维护装土/卸土读卡设备，设备必须归属当前项目下的启用地点。 */
  saveReaderDevice: protectedProcedure
    .input(transportReaderDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      assertCanManageTransportResources(roleCodes);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [site] = await db
        .select()
        .from(transportSites)
        .where(eq(transportSites.id, input.siteId))
        .limit(1);
      if (!site || site.projectId !== input.projectId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "读卡设备必须绑定当前项目下的装土点或卸土点",
        });
      const values = {
        projectId: input.projectId,
        siteId: input.siteId,
        deviceCode: input.deviceCode,
        displayName: input.displayName,
        status: input.status,
        remarks: input.remarks?.trim() || null,
      };
      if (input.id) {
        const [existing] = await db
          .select()
          .from(transportReaderDevices)
          .where(eq(transportReaderDevices.id, input.id))
          .limit(1);
        if (!existing || existing.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "读卡设备不存在或不属于当前项目",
          });
        await db
          .update(transportReaderDevices)
          .set(values)
          .where(eq(transportReaderDevices.id, input.id));
      } else {
        await db
          .insert(transportReaderDevices)
          .values({ ...values, createdBy: user.id });
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id
          ? "update_transport_reader_device"
          : "create_transport_reader_device",
        targetType: "transport_reader_device",
        targetId: String(input.id ?? `${input.siteId}-${input.deviceCode}`),
        summary: `${input.id ? "维护" : "登记"}${site.siteType === "load" ? "装土" : "卸土"}读卡设备：${input.displayName}`,
      });
      return { success: true };
    }),

  /** 读取项目路线预设；票据端仅选择启用路线，不手填公里数或运价。 */
  listRoutePresets: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const [routes, sites] = await Promise.all([
        db
          .select()
          .from(transportRoutePresets)
          .where(eq(transportRoutePresets.projectId, input.projectId))
          .orderBy(
            desc(transportRoutePresets.isDefault),
            desc(transportRoutePresets.updatedAt)
          ),
        db
          .select()
          .from(transportSites)
          .where(eq(transportSites.projectId, input.projectId)),
      ]);
      return routes.map(route => ({
        ...route,
        ...effectiveTransportSafety(
          sites.find(site => site.id === route.unloadSiteId),
          route
        ),
        safetySource: "unload_site" as const,
      }));
    }),

  /** 特殊场景开关：首次 NFC 刷卡发票可直接结束运单，但仍按路线最短时间拦截同车连续开票。 */
  getNfcSingleScanCloseSetting: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          enabled: false,
          minimumIntervalPolicy: "route_minimum_transit_minutes" as const,
        };
      return {
        enabled: await getTransportNfcSingleScanCloseEnabled(
          db,
          input.projectId
        ),
        minimumIntervalPolicy: "route_minimum_transit_minutes" as const,
      };
    }),

  /** 单次刷卡闭环会改变项目运输控制策略，仅超级管理员可在后台切换。 */
  setNfcSingleScanCloseSetting: protectedProcedure
    .input(
      z.object({ projectId: z.number().int().positive(), enabled: z.boolean() })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
      if (!isSuperAdmin)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅超级管理员可在后台维护刷卡发票运输闭环设置",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      await saveTransportNfcSingleScanCloseEnabled(db, {
        ...input,
        userId: user.id,
      });
      return { success: true, enabled: input.enabled };
    }),

  /** 运输负责人维护路线的装卸点、预设里程和有效阶梯运价。 */
  saveRoutePreset: protectedProcedure
    .input(transportRoutePresetInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [loadSite, unloadSite, rule] = await Promise.all([
        db
          .select()
          .from(transportSites)
          .where(eq(transportSites.id, input.loadSiteId))
          .limit(1)
          .then(rows => rows[0]),
        db
          .select()
          .from(transportSites)
          .where(eq(transportSites.id, input.unloadSiteId))
          .limit(1)
          .then(rows => rows[0]),
        db
          .select()
          .from(freightRateRules)
          .where(eq(freightRateRules.id, input.freightRuleId))
          .limit(1)
          .then(rows => rows[0]),
      ]);
      if (
        !loadSite ||
        loadSite.projectId !== input.projectId ||
        loadSite.siteType !== "load" ||
        loadSite.status !== "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "路线装土点不存在或未启用",
        });
      if (
        !unloadSite ||
        unloadSite.projectId !== input.projectId ||
        unloadSite.siteType !== "unload" ||
        unloadSite.status !== "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "路线卸土点不存在或未启用",
        });
      if (
        !rule ||
        rule.projectId !== input.projectId ||
        rule.status !== "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "路线必须选择项目内生效的阶梯运价",
        });
      const [existingRoute] = input.id
        ? await db
            .select()
            .from(transportRoutePresets)
            .where(eq(transportRoutePresets.id, input.id))
            .limit(1)
        : [null];
      if (
        input.id &&
        (!existingRoute || existingRoute.projectId !== input.projectId)
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "运输路线不存在或不属于当前项目",
        });
      assertCanManageTransportResources(roleCodes);
      if (
        !isSuperAdmin &&
        Boolean(existingRoute?.unloadOnlyCloseEnabled ?? false) !==
          input.unloadOnlyCloseEnabled
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "运输特殊闭环策略仅超级管理员可在后台维护",
        });
      const safety = effectiveTransportSafety(
        unloadSite,
        existingRoute ?? input
      );
      // Route safety columns remain for compatibility, but cannot override the site's authoritative policy.
      const values = {
        projectId: input.projectId,
        loadSiteId: input.loadSiteId,
        unloadSiteId: input.unloadSiteId,
        freightRuleId: input.freightRuleId,
        presetDistanceKm: String(input.presetDistanceKm),
        ...safety,
        unloadOnlyCloseEnabled: input.unloadOnlyCloseEnabled,
        isDefault: input.isDefault,
        status: input.status,
      };
      if (input.isDefault)
        await db
          .update(transportRoutePresets)
          .set({ isDefault: false })
          .where(eq(transportRoutePresets.projectId, input.projectId));
      if (input.id)
        await db
          .update(transportRoutePresets)
          .set(values)
          .where(eq(transportRoutePresets.id, input.id));
      else
        await db
          .insert(transportRoutePresets)
          .values({ ...values, createdBy: user.id });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: input.id ? "update_route_preset" : "create_route_preset",
        targetType: "transport_route_preset",
        targetId: String(
          input.id ?? `${input.loadSiteId}-${input.unloadSiteId}`
        ),
        summary: `维护运输路线预设：${loadSite.name} → ${unloadSite.name}，${input.presetDistanceKm} km，最短 ${safety.minimumTransitMinutes} 分钟（${safety.minimumTransitEnabled ? "拦截" : "提示"}），卸土容差 ${safety.unloadGeofenceMeters} 米（${safety.unloadGeofenceEnabled ? "拦截" : "提示"}），卸土补刷卡闭环${values.unloadOnlyCloseEnabled ? "开启" : "关闭"}`,
      });
      return { success: true };
    }),

  workspaceAccess: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const { canAccess: canConfigureSafety } = await getSuperAdminAccess(ctx);
      return {
        canReview: canManageSettlement(roleCodes),
        canCreateSettlement: canManageSettlement(roleCodes),
        canSettle: canSettleFinancialRecord(roleCodes),
        canConfigureSafety,
        canManageSites: await canManageTransportSites(ctx, roleCodes),
        canManageResources: roleCodes.some(role =>
          ["ALL", "TRANSPORT_MANAGER", "PROJECT_MANAGER"].includes(role)
        ),
      };
    }),

  listTrips: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().int().positive(),
          date: businessDateSchema.optional(),
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
          dateFrom: businessDateSchema.optional(),
          dateTo: businessDateSchema.optional(),
          vehicleId: z.number().int().positive().optional(),
          status: z
            .enum(["draft", "submitted", "verified", "settled", "void"])
            .optional(),
          routePresetId: z.number().int().positive().optional(),
          reviewView: z.enum(["all", "pending", "exceptions"]).optional(),
        })
        .superRefine((value, issue) => {
          if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
            issue.addIssue({
              code: "custom",
              path: ["dateTo"],
              message: "结束日期不能早于开始日期",
            });
        })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const predicates = [eq(transportTrips.projectId, input.projectId)];
      if (input.date) {
        const { start, end } = getChinaBusinessDateRange(input.date);
        predicates.push(
          gte(transportTrips.startAt, start),
          lt(transportTrips.startAt, end)
        );
      }
      let rows = await db
        .select()
        .from(transportTrips)
        .where(and(...predicates))
        .orderBy(desc(transportTrips.startAt));
      const { month, dateFrom, dateTo, vehicleId, status, routePresetId } =
        input;
      if (dateFrom) {
        const { start } = getChinaBusinessDateRange(dateFrom);
        rows = rows.filter(trip => new Date(trip.startAt) >= start);
      }
      if (dateTo) {
        const { end } = getChinaBusinessDateRange(dateTo);
        rows = rows.filter(trip => new Date(trip.startAt) < end);
      }
      if (month)
        rows = rows.filter(
          trip =>
            formatChinaBusinessDate(new Date(trip.startAt)).slice(0, 7) ===
            month
        );
      if (dateFrom)
        rows = rows.filter(
          trip => formatChinaBusinessDate(new Date(trip.startAt)) >= dateFrom
        );
      if (dateTo)
        rows = rows.filter(
          trip => formatChinaBusinessDate(new Date(trip.startAt)) <= dateTo
        );
      if (vehicleId) rows = rows.filter(trip => trip.vehicleId === vehicleId);
      if (status) rows = rows.filter(trip => trip.status === status);
      else rows = rows.filter(trip => trip.status !== "void");
      if (input.reviewView === "pending")
        rows = rows.filter(trip => trip.status === "submitted");
      if (input.reviewView === "exceptions")
        rows = rows.filter(
          trip =>
            trip.exceptionStatus === "open" ||
            calculateTransportAnomalies(trip).length > 0
        );
      if (routePresetId)
        rows = rows.filter(trip => {
          const snapshot =
            trip.routeSnapshot && typeof trip.routeSnapshot === "object"
              ? (trip.routeSnapshot as Record<string, unknown>)
              : {};
          return Number(snapshot.routePresetId ?? 0) === routePresetId;
        });
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly) {
        const vehicles = await db
          .select({ id: transportVehicles.id })
          .from(transportVehicles)
          .where(
            and(
              eq(transportVehicles.projectId, input.projectId),
              eq(transportVehicles.driverUserId, user.id)
            )
          );
        const vehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
        rows = rows.filter(trip => vehicleIds.has(trip.vehicleId));
      }
      const [vehicleRows, siteRows, eventRows, operatorRows] =
        await Promise.all([
          db
            .select({
              id: transportVehicles.id,
              plateNo: transportVehicles.plateNo,
              vehicleType: transportVehicles.vehicleType,
              ownership: transportVehicles.ownership,
              driverName: transportVehicles.driverName,
              ownerName: transportVehicles.ownerName,
              boxLengthMeters: transportVehicles.boxLengthMeters,
              boxWidthMeters: transportVehicles.boxWidthMeters,
              boxHeightMeters: transportVehicles.boxHeightMeters,
              loadFactor: transportVehicles.loadFactor,
            })
            .from(transportVehicles)
            .where(eq(transportVehicles.projectId, input.projectId)),
          db
            .select({
              id: transportSites.id,
              name: transportSites.name,
              address: transportSites.address,
              siteType: transportSites.siteType,
              administratorUserId: transportSites.administratorUserId,
            })
            .from(transportSites)
            .where(eq(transportSites.projectId, input.projectId)),
          rows.length
            ? db
                .select({
                  id: transportCardEvents.id,
                  tripId: transportCardEvents.tripId,
                  eventType: transportCardEvents.eventType,
                  occurredAt: transportCardEvents.occurredAt,
                  deviceId: transportCardEvents.deviceId,
                  siteId: transportCardEvents.siteId,
                  operatorUserId: transportCardEvents.operatorUserId,
                  validationStatus: transportCardEvents.validationStatus,
                  validationReason: transportCardEvents.validationReason,
                })
                .from(transportCardEvents)
                .where(eq(transportCardEvents.projectId, input.projectId))
            : Promise.resolve([]),
          db.select({ id: users.id, name: users.name }).from(users),
        ]);
      const linkedItems = rows.length
        ? await db
            .select({
              tripId: transportVehicleSettlementItems.tripId,
              settlementId: transportVehicleSettlementItems.settlementId,
            })
            .from(transportVehicleSettlementItems)
            .where(
              inArray(
                transportVehicleSettlementItems.tripId,
                rows.map(row => row.id)
              )
            )
        : [];
      const linkedSettlements = linkedItems.length
        ? await db
            .select({
              id: transportVehicleSettlements.id,
              settlementNo: transportVehicleSettlements.settlementNo,
              status: transportVehicleSettlements.status,
            })
            .from(transportVehicleSettlements)
            .where(
              and(
                eq(transportVehicleSettlements.projectId, input.projectId),
                inArray(
                  transportVehicleSettlements.id,
                  linkedItems.map(item => item.settlementId)
                )
              )
            )
        : [];
      const vehiclesById = new Map(
        vehicleRows.map(vehicle => [vehicle.id, vehicle])
      );
      const sitesById = new Map(siteRows.map(site => [site.id, site]));
      const operatorsById = new Map(
        operatorRows.map(operator => [operator.id, operator.name])
      );
      const tripIds = new Set(rows.map(trip => trip.id));
      const evidenceIds = Array.from(
        new Set(
          rows
            .flatMap(trip => {
              const snapshot =
                trip.routeSnapshot && typeof trip.routeSnapshot === "object"
                  ? (trip.routeSnapshot as Record<string, unknown>)
                  : {};
              const unloadEvidenceId =
                Number(snapshot.unloadPhotoEvidenceId ?? 0) || null;
              return [trip.evidenceId, unloadEvidenceId];
            })
            .filter((id): id is number => typeof id === "number" && id > 0)
        )
      );
      const evidenceRows = evidenceIds.length
        ? await db
            .select({
              id: evidenceRecords.id,
              fileKey: evidenceRecords.fileKey,
              fileName: evidenceRecords.fileName,
              mimeType: evidenceRecords.mimeType,
            })
            .from(evidenceRecords)
            .where(
              and(
                eq(evidenceRecords.projectId, input.projectId),
                inArray(evidenceRecords.id, evidenceIds),
                eq(evidenceRecords.sourceType, "transport"),
                eq(evidenceRecords.status, "active")
              )
            )
        : [];
      const evidenceById = new Map(
        await Promise.all(
          evidenceRows.map(async evidence => {
            const url = await storageGetSignedUrl(evidence.fileKey);
            return [
              evidence.id,
              {
                fileName: evidence.fileName,
                mimeType: evidence.mimeType || "application/octet-stream",
                url,
              },
            ] as const;
          })
        )
      );
      const eventsByTrip = new Map<number, typeof eventRows>();
      eventRows
        .filter(event => tripIds.has(Number(event.tripId)))
        .forEach(event =>
          eventsByTrip.set(Number(event.tripId), [
            ...(eventsByTrip.get(Number(event.tripId)) ?? []),
            event,
          ])
        );
      const siteAddress = (siteId: number | null, snapshotSite: unknown) => {
        const snapshot =
          snapshotSite && typeof snapshotSite === "object"
            ? (snapshotSite as { name?: unknown; address?: unknown })
            : null;
        const liveSite = siteId ? sitesById.get(siteId) : undefined;
        return {
          name:
            typeof snapshot?.name === "string"
              ? snapshot.name
              : (liveSite?.name ?? "未设置"),
          address:
            typeof snapshot?.address === "string" && snapshot.address.trim()
              ? snapshot.address
              : liveSite?.address?.trim() || liveSite?.name || "未登记中文地址",
        };
      };
      /** 台账仅展示中文业务结果，内部校验枚举与上游错误细节不透传至移动端或后台表格。 */
      return rows.map(trip => {
        const routeSnapshot =
          trip.routeSnapshot && typeof trip.routeSnapshot === "object"
            ? (trip.routeSnapshot as Record<string, unknown>)
            : {};
        const vehicle = vehiclesById.get(trip.vehicleId);
        const events = (eventsByTrip.get(trip.id) ?? []).map(event => ({
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          deviceId: event.deviceId,
          siteName: event.siteId
            ? (sitesById.get(event.siteId)?.name ?? "未登记地点")
            : "未登记地点",
          operatorName: event.operatorUserId
            ? (operatorsById.get(event.operatorUserId) ?? "未登记确认人")
            : "未登记确认人",
          validationStatus: getCardValidationStatusLabel(
            event.validationStatus
          ),
          validationReason: getSafeCardValidationReason(event.validationReason),
        }));
        const unloadEvidenceId =
          Number(routeSnapshot.unloadPhotoEvidenceId ?? 0) || null;
        return {
          ...(({
            routeSnapshot: _snapshot,
            fuelSettlementSnapshot: _fuelSnapshot,
            nfcTransitKey: _nfcKey,
            activeVehicleTransitKey: _activeKey,
            ...safeTrip
          }) => safeTrip)(trip),
          ...classifyTransportSettlement(
            trip,
            linkedSettlements.find(
              settlement =>
                settlement.id ===
                linkedItems.find(item => item.tripId === trip.id)?.settlementId
            ),
            vehicle?.ownership
          ),
          reviewEligibility: getTransportReviewEligibility(
            trip,
            eventsByTrip.get(trip.id) ?? [],
            {
              load: Boolean(
                trip.evidenceId && evidenceById.has(trip.evidenceId)
              ),
              unload: Boolean(
                unloadEvidenceId && evidenceById.has(unloadEvidenceId)
              ),
            }
          ),
          loadInvoiceEvidence: trip.evidenceId
            ? (evidenceById.get(trip.evidenceId) ?? null)
            : null,
          unloadSiteEvidence: unloadEvidenceId
            ? (evidenceById.get(unloadEvidenceId) ?? null)
            : null,
          routeSnapshot: projectTransportSafetySnapshot(
            routeSnapshot,
            trip.invoiceMode ?? "nfc_card"
          ),
          vehiclePlateNo: vehicle?.plateNo ?? `车辆 #${trip.vehicleId}`,
          vehicle: vehicle
            ? {
                plateNo: vehicle.plateNo,
                vehicleType: vehicle.vehicleType,
                ownership: vehicle.ownership,
                driverName: vehicle.driverName ?? null,
                ownerName: vehicle.ownerName ?? null,
                theoreticalVolumeCubicMeters:
                  Math.round(
                    Number(vehicle.boxLengthMeters) *
                      Number(vehicle.boxWidthMeters) *
                      Number(vehicle.boxHeightMeters) *
                      Number(vehicle.loadFactor) *
                      1000
                  ) / 1000,
              }
            : null,
          loadLocation: {
            ...siteAddress(trip.loadSiteId, routeSnapshot.loadSite),
            administratorName: trip.loadSiteId
              ? (operatorsById.get(
                  sitesById.get(trip.loadSiteId)?.administratorUserId ?? 0
                ) ?? "未指定")
              : "未指定",
          },
          unloadLocation: {
            ...siteAddress(trip.unloadSiteId, routeSnapshot.unloadSite),
            administratorName: trip.unloadSiteId
              ? (operatorsById.get(
                  sitesById.get(trip.unloadSiteId)?.administratorUserId ?? 0
                ) ?? "未指定")
              : "未指定",
          },
          loadConfirmation: {
            administratorName: trip.loadConfirmedBy
              ? (operatorsById.get(trip.loadConfirmedBy) ?? "未登记确认人")
              : "未确认",
            confirmedAt: trip.loadConfirmedAt,
          },
          unloadConfirmation: {
            administratorName: trip.unloadConfirmedBy
              ? (operatorsById.get(trip.unloadConfirmedBy) ?? "未登记确认人")
              : "未确认",
            confirmedAt: trip.unloadConfirmedAt,
          },
          cardEvents: events,
          anomalies: calculateTransportAnomalies(trip),
        };
      });
    }),

  /** 录入运输趟次并把当时运价和原始载货参数写入快照，后续修改价格规则不影响历史金额。 */
  saveTrip: protectedProcedure
    .input(tripInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      const { db, vehicle } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      if (vehicle.status !== "active")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前车辆未处于可调度状态",
        });
      let loadSiteId = input.loadSiteId ?? null;
      let unloadSiteId = input.unloadSiteId ?? null;
      let freightRuleId = input.freightRuleId;
      let actualDistanceKm = input.actualDistanceKm;
      let routePreset: typeof transportRoutePresets.$inferSelect | null = null;
      const selectedRoutePresetId = input.routePresetId;
      if (selectedRoutePresetId) {
        const [preset] = await db
          .select()
          .from(transportRoutePresets)
          .where(eq(transportRoutePresets.id, selectedRoutePresetId))
          .limit(1);
        if (
          !preset ||
          preset.projectId !== input.projectId ||
          preset.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "选择的运输路线不存在、已停用或不属于当前项目",
          });
        routePreset = preset;
        loadSiteId = preset.loadSiteId;
        unloadSiteId = preset.unloadSiteId;
        freightRuleId = preset.freightRuleId;
        actualDistanceKm = Number(preset.presetDistanceKm);
      }
      if (!freightRuleId) {
        const [legacyRule] = await db
          .select()
          .from(freightRateRules)
          .where(
            and(
              eq(freightRateRules.projectId, input.projectId),
              eq(freightRateRules.status, "active")
            )
          )
          .limit(1);
        if (!legacyRule)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先配置有效运输路线和阶梯运价",
          });
        freightRuleId = legacyRule.id;
      }
      if (Boolean(loadSiteId) !== Boolean(unloadSiteId))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "运输票据必须同时选择装土点和卸土点",
        });
      let loadSite: typeof transportSites.$inferSelect | null = null;
      let unloadSite: typeof transportSites.$inferSelect | null = null;
      if (loadSiteId && unloadSiteId) {
        [loadSite, unloadSite] = await Promise.all([
          db
            .select()
            .from(transportSites)
            .where(eq(transportSites.id, loadSiteId))
            .limit(1)
            .then(rows => rows[0] ?? null),
          db
            .select()
            .from(transportSites)
            .where(eq(transportSites.id, unloadSiteId))
            .limit(1)
            .then(rows => rows[0] ?? null),
        ]);
        if (
          !loadSite ||
          loadSite.projectId !== input.projectId ||
          loadSite.siteType !== "load" ||
          loadSite.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "装土点不存在、已停用或不属于当前项目",
          });
        if (
          !unloadSite ||
          unloadSite.projectId !== input.projectId ||
          unloadSite.siteType !== "unload" ||
          unloadSite.status !== "active"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "卸土点不存在、已停用或不属于当前项目",
          });
      }
      if (input.evidenceId) {
        const [evidence] = await db
          .select()
          .from(evidenceRecords)
          .where(eq(evidenceRecords.id, input.evidenceId))
          .limit(1);
        if (!evidence || evidence.projectId !== input.projectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "现场影像不存在或不属于当前项目，不能关联到运输趟次",
          });
        }
      }
      const [rule] = await db
        .select()
        .from(freightRateRules)
        .where(eq(freightRateRules.id, freightRuleId))
        .limit(1);
      if (
        !rule ||
        rule.projectId !== input.projectId ||
        rule.status !== "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "未找到当前项目下可用的生效运价规则",
        });
      if (actualDistanceKm === undefined || actualDistanceKm === null)
        actualDistanceKm = Number(rule.startDistanceKm);
      const tripStart = new Date(input.startAt);
      const ruleStart = new Date(rule.effectiveFrom);
      const ruleEnd = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
      if (
        tripStart.getTime() < ruleStart.getTime() ||
        (ruleEnd &&
          tripStart.getTime() >
            new Date(ruleEnd.getTime() + 24 * 60 * 60 * 1000).getTime())
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "趟次发生日期不在当前运价规则有效期内",
        });
      }
      let theoreticalVolume: number;
      try {
        theoreticalVolume = calculateTheoreticalVolume(
          Number(vehicle.boxLengthMeters),
          Number(vehicle.boxWidthMeters),
          Number(vehicle.boxHeightMeters),
          Number(vehicle.loadFactor)
        );
      } catch (error) {
        throwDomainAsBadRequest(error);
      }
      const volume = theoreticalVolume;
      const settlementQuantity =
        rule.settlementUnit === "cubic_meter"
          ? volume
          : rule.settlementUnit === "ton"
            ? input.weightTons
            : 1;
      if (!settlementQuantity || settlementQuantity <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            rule.settlementUnit === "ton"
              ? "按吨结算必须填写有效载重"
              : "请填写有效结算数量",
        });
      let price;
      try {
        price = calculateTieredFreightAmount({
          actualDistanceKm,
          startDistanceKm: Number(rule.startDistanceKm),
          basePricePerUnit: Number(rule.basePricePerUnit),
          stepMeters: rule.stepMeters,
          stepIncreasePerUnit: Number(rule.stepIncreasePerUnit),
          settlementQuantity,
        });
      } catch (error) {
        throwDomainAsBadRequest(error);
      }
      const tripNo = input.tripNo ?? createTransportTripNo(input.projectId);
      if (input.invoiceMode === "plate_photo" && !input.evidenceId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "拍照车牌发票必须关联现场直拍的车牌水印照片",
        });
      if (!input.endAt)
        await assertNewFleetTrip(
          db,
          input.projectId,
          vehicle.id,
          vehicle.plateNo
        );
      const routeSnapshot = {
        source: "mobile",
        routePresetId: routePreset?.id ?? null,
        invoiceMode: input.invoiceMode,
        settlementUnit: rule.settlementUnit,
        theoreticalVolumeCubicMeters: theoreticalVolume,
        billableSteps: price.billableSteps,
        loadSite: loadSite
          ? {
              id: loadSite.id,
              name: loadSite.name,
              address: loadSite.address,
              administratorUserId: loadSite.administratorUserId,
            }
          : null,
        unloadSite: unloadSite
          ? {
              id: unloadSite.id,
              name: unloadSite.name,
              address: unloadSite.address,
              administratorUserId: unloadSite.administratorUserId,
            }
          : null,
        platePhotoEvidenceId:
          input.invoiceMode === "plate_photo"
            ? (input.evidenceId ?? null)
            : null,
        startLatitude: input.startLatitude ?? null,
        startLongitude: input.startLongitude ?? null,
        endLatitude: input.endLatitude ?? null,
        endLongitude: input.endLongitude ?? null,
      };
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
          weightTons:
            input.weightTons === null || input.weightTons === undefined
              ? null
              : String(input.weightTons),
          calculatedUnitPrice: String(price.unitPrice),
          calculatedAmount: String(price.totalAmount),
          routeSnapshot,
          evidenceId: input.evidenceId ?? null,
          status: input.invoiceMode === "plate_photo" ? "submitted" : "draft",
          loadConfirmedAt:
            input.invoiceMode === "plate_photo" ? tripStart : null,
          loadConfirmedBy: input.invoiceMode === "plate_photo" ? user.id : null,
          activeVehicleTransitKey: input.endAt
            ? null
            : createActiveVehicleTransitKey(input.projectId, input.vehicleId),
        });
      } catch (error) {
        throwIfDuplicateActiveVehicleTransit(error, vehicle.plateNo);
      }
      if (input.evidenceId) {
        await db
          .update(evidenceRecords)
          .set({ sourceId: `transport-trip-${tripNo}` })
          .where(
            and(
              eq(evidenceRecords.id, input.evidenceId),
              eq(evidenceRecords.projectId, input.projectId)
            )
          );
      }
      let dailyVehicleTripOrdinal: number | null = null;
      if (input.invoiceMode === "plate_photo") {
        const [createdTrip] = await db
          .select({ id: transportTrips.id })
          .from(transportTrips)
          .where(
            and(
              eq(transportTrips.projectId, input.projectId),
              eq(transportTrips.tripNo, tripNo)
            )
          )
          .limit(1);
        if (createdTrip) {
          dailyVehicleTripOrdinal = await getDailyVehicleStageOrdinal(db, {
            projectId: input.projectId,
            vehicleId: vehicle.id,
            tripId: createdTrip.id,
            eventType: "load",
            occurredAt: tripStart,
          });
        }
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "create_trip",
        targetType: "transport_trip",
        targetId: tripNo,
        summary: `录入${input.invoiceMode === "plate_photo" ? "拍照车牌" : "NFC 刷卡"}运输票据，运费由合同规则快照计算${input.invoiceMode === "plate_photo" ? "并进入人工核验" : ""}`,
      });
      if (input.invoiceMode === "plate_photo") {
        void notifyOfficialAccountBusinessEventSafely({
          userId: user.id,
          projectId: input.projectId,
          module: "transport",
          eventCode: "transport_plate_photo_ticket_submitted",
          targetType: "transport_trip",
          targetId: tripNo,
          title: "拍照车牌运输票据待核验",
          content: `车辆 ${vehicle.plateNo} 的车牌直拍运输票据已提交，待核验后进入结算流程。`,
          deepLink: "/mobile/transport",
        }).catch(() => undefined);
        notifyExternalDriverWechat({
          vehicleId: vehicle.id,
          projectId: input.projectId,
          eventCode: "transport_plate_photo_ticket_submitted",
          targetType: "transport_trip",
          targetId: tripNo,
          title: "拍照车牌运输票据待核验",
          content: `车辆 ${vehicle.plateNo} 的车牌直拍运输票据已提交，待核验后进入结算流程。`,
          deepLink: "/mobile/transport",
        });
      }
      const anomalies = calculateTransportAnomalies({
        evidenceId: input.evidenceId ?? null,
        startAt: tripStart,
        endAt: input.endAt ? new Date(input.endAt) : null,
        actualDistanceKm: String(actualDistanceKm),
        volumeCubicMeters: String(volume),
        routeSnapshot,
      });
      return {
        success: true,
        tripNo,
        unitPrice: price.unitPrice,
        amount: price.totalAmount,
        theoreticalVolumeCubicMeters: theoreticalVolume,
        vehiclePlateNo:
          input.invoiceMode === "plate_photo" ? vehicle.plateNo : null,
        dailyVehicleTripOrdinal,
        anomalies,
      };
    }),

  /** 装土读卡成功后确认趟次起始环节；重复上报按幂等键安全返回，乱序事件留痕进入人工复核。 */
  recordLoadEvent: protectedProcedure
    .input(transportCardEventInput)
    .mutation(async ({ ctx, input }) =>
      recordTransportCardEvent(ctx, input, "load")
    ),

  /** 卸土读卡成功后确认运输闭环，并向已绑定服务号的司机发送即时提醒。 */
  recordUnloadEvent: protectedProcedure
    .input(transportCardEventInput)
    .mutation(async ({ ctx, input }) =>
      recordTransportCardEvent(ctx, input, "unload")
    ),

  /** 任一发票方式在装土后进入在途；卸土现场可通过拍照和定位完成受控闭环。 */
  confirmPlatePhotoUnload: protectedProcedure
    .input(platePhotoUnloadConfirmationInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [trip] = await db
        .select()
        .from(transportTrips)
        .where(eq(transportTrips.id, input.tripId))
        .limit(1);
      if (!trip || trip.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "运输票据不存在或不属于当前项目",
        });
      const { vehicle } = await getScopedVehicle(
        ctx,
        trip.vehicleId,
        input.projectId,
        roleCodes
      );
      if (trip.status === "void" || trip.status === "settled")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "已关闭运单不能再确认卸土",
        });
      if (!trip.loadConfirmedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "装土发票尚未完成，不能确认卸土",
        });
      const [unloadEvidence] = await db
        .select()
        .from(evidenceRecords)
        .where(
          and(
            eq(evidenceRecords.id, input.unloadEvidenceId),
            eq(evidenceRecords.projectId, input.projectId)
          )
        )
        .limit(1);
      if (!unloadEvidence || unloadEvidence.sourceType !== "transport")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先使用后置相机拍摄并上传卸土现场照片",
        });
      const occurredAt = new Date(input.occurredAt);
      const payloadFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            source: "photo-unload",
            tripId: trip.id,
            projectId: input.projectId,
            unloadEvidenceId: input.unloadEvidenceId,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            occurredAt: occurredAt.toISOString(),
          })
        )
        .digest("hex");
      const [existing] = await db
        .select()
        .from(transportCardEvents)
        .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) {
        if (
          existing.tripId !== trip.id ||
          existing.eventType !== "unload" ||
          existing.source !== "manual_review" ||
          existing.payloadFingerprint !== payloadFingerprint
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "该卸土确认编号已用于其他业务事件或凭证已变更",
          });
        if (
          existing.validationStatus === "accepted" &&
          trip.unloadEventId !== existing.id
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "卸土确认尚未完成，请刷新后核验",
          });
        const safetyNotices = getPhotoUnloadSafetyNotices(trip.routeSnapshot);
        return {
          success: existing.validationStatus === "accepted",
          duplicate: true,
          needsReview:
            existing.validationStatus === "needs_review" ||
            safetyNotices.length > 0,
          reason: safetyNotices.length ? safetyNotices.join("；") : null,
          safetyNotices,
        };
      }
      if (trip.unloadConfirmedAt) {
        const safetyNotices = getPhotoUnloadSafetyNotices(trip.routeSnapshot);
        return {
          success: true,
          duplicate: true,
          needsReview: safetyNotices.length > 0,
          reason: safetyNotices.length ? safetyNotices.join("；") : null,
          safetyNotices,
        };
      }
      const routePresetId = Number(
        (trip.routeSnapshot as { routePresetId?: number } | null)
          ?.routePresetId || 0
      );
      const [[route], [unloadSite]] = await Promise.all([
        routePresetId
          ? db
              .select()
              .from(transportRoutePresets)
              .where(eq(transportRoutePresets.id, routePresetId))
              .limit(1)
          : Promise.resolve([]),
        trip.unloadSiteId
          ? db
              .select()
              .from(transportSites)
              .where(eq(transportSites.id, trip.unloadSiteId))
              .limit(1)
          : Promise.resolve([]),
      ]);
      if (
        !route ||
        route.projectId !== input.projectId ||
        !unloadSite ||
        unloadSite.projectId !== input.projectId ||
        unloadSite.siteType !== "unload" ||
        unloadSite.status !== "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "卸土路线或地点配置无效，不能确认卸土",
        });
      const safety = effectiveTransportSafety(unloadSite, route);
      const safetyNotices: string[] = [];
      const elapsedMinutes = Math.max(
        0,
        Math.floor(
          (occurredAt.getTime() - new Date(trip.loadConfirmedAt).getTime()) /
            60_000
        )
      );
      if (elapsedMinutes < safety.minimumTransitMinutes) {
        const reason = `卸土异常：已运输 ${elapsedMinutes} 分钟，未达到最短运输时间 ${safety.minimumTransitMinutes} 分钟`;
        if (safety.minimumTransitEnabled)
          throw new TRPCError({ code: "BAD_REQUEST", message: reason });
        safetyNotices.push(`${reason}（最短运输时间拦截已关闭，已留待核验）`);
      }
      const hasMobileCoordinates =
        input.latitude != null && input.longitude != null;
      const hasSiteCoordinates =
        unloadSite.latitude != null && unloadSite.longitude != null;
      if (!hasMobileCoordinates || !hasSiteCoordinates) {
        const reason = !hasMobileCoordinates
          ? "卸土异常：未取得现场定位"
          : "卸土点中文详细地址尚未完成地图定位校验";
        if (safety.unloadGeofenceEnabled)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${reason}，不能直接确认卸土`,
          });
        safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
      } else {
        const distanceMeters = Math.round(
          calculateCoordinateDistanceMeters(
            Number(input.latitude),
            Number(input.longitude),
            Number(unloadSite.latitude),
            Number(unloadSite.longitude)
          )
        );
        if (distanceMeters > safety.unloadGeofenceMeters) {
          const reason = `未达到卸土点：当前距卸土点约 ${distanceMeters} 米，允许偏差 ${safety.unloadGeofenceMeters} 米`;
          if (safety.unloadGeofenceEnabled)
            throw new TRPCError({ code: "BAD_REQUEST", message: reason });
          safetyNotices.push(`${reason}（定位范围拦截已关闭，已留待核验）`);
        }
      }
      try {
        await db.insert(transportCardEvents).values({
          tripId: trip.id,
          vehicleId: trip.vehicleId,
          projectId: input.projectId,
          eventType: "unload",
          siteId: unloadSite.id,
          operatorUserId: user.id,
          source: "manual_review",
          idempotencyKey: input.idempotencyKey,
          latitude: input.latitude == null ? null : String(input.latitude),
          longitude: input.longitude == null ? null : String(input.longitude),
          payloadFingerprint,
          occurredAt,
          validationStatus: "accepted",
          validationReason: [
            `${trip.invoiceMode === "plate_photo" ? "车牌直拍" : "NFC 刷卡"}票据拍照卸土现场确认`,
            ...safetyNotices,
          ].join("；"),
        });
      } catch {
        throw new TRPCError({
          code: "CONFLICT",
          message: "卸土确认编号已被其他请求使用，请刷新后核验，不要重复确认",
        });
      }
      const [event] = await db
        .select()
        .from(transportCardEvents)
        .where(eq(transportCardEvents.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (!event)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "卸土确认审计记录创建失败",
        });
      const routeSnapshot = {
        ...((trip.routeSnapshot as Record<string, unknown> | null) ?? {}),
        unloadPhotoEvidenceId: input.unloadEvidenceId,
        unloadPhotoConfirmedAt: occurredAt.toISOString(),
        unloadPhotoConfirmedBy: user.id,
        unloadConfirmationMode: "photo",
        safetyPolicy: safety,
        unloadSafetyNotices: safetyNotices,
        endLatitude: input.latitude ?? null,
        endLongitude: input.longitude ?? null,
      };
      const result = await db
        .update(transportTrips)
        .set({
          unloadConfirmedAt: occurredAt,
          unloadConfirmedBy: user.id,
          unloadEventId: event.id,
          endAt: occurredAt,
          activeVehicleTransitKey: null,
          nfcTransitKey: null,
          status: trip.status === "draft" ? "submitted" : trip.status,
          ...(safetyNotices.length ? { exceptionStatus: "open" as const } : {}),
          routeSnapshot,
        })
        .where(
          and(
            eq(transportTrips.id, trip.id),
            eq(transportTrips.projectId, input.projectId),
            eq(transportTrips.vehicleId, vehicle.id),
            eq(transportTrips.status, trip.status),
            isNotNull(transportTrips.loadConfirmedAt),
            isNull(transportTrips.unloadConfirmedAt),
            ne(transportTrips.status, "void"),
            ne(transportTrips.status, "settled")
          )
        );
      if (!didConditionalWriteApply(result))
        throw new TRPCError({
          code: "CONFLICT",
          message: "运单已被其他卸土确认更新，请刷新后查看",
        });
      const dailyVehicleTripOrdinal = await getDailyVehicleStageOrdinal(db, {
        projectId: input.projectId,
        vehicleId: trip.vehicleId,
        tripId: trip.id,
        eventType: "unload",
        occurredAt,
      });
      await db
        .update(evidenceRecords)
        .set({ sourceId: `transport-unload-${trip.tripNo}` })
        .where(
          and(
            eq(evidenceRecords.id, input.unloadEvidenceId),
            eq(evidenceRecords.projectId, input.projectId)
          )
        );
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "confirm_photo_unload",
        targetType: "transport_trip",
        targetId: trip.tripNo,
        summary: `${trip.invoiceMode === "plate_photo" ? "车牌直拍" : "NFC 刷卡"}票据在卸土点完成现场拍照与确认：${unloadSite.name}，影像 #${input.unloadEvidenceId}${safetyNotices.length ? `；${safetyNotices.join("；")}` : ""}`,
      });
      const recipientUserIds = Array.from(
        new Set(
          [
            trip.loadConfirmedBy,
            user.id,
            unloadSite.administratorUserId,
          ].filter(
            (value): value is number => typeof value === "number" && value > 0
          )
        )
      );
      await Promise.all(
        recipientUserIds.map(recipientUserId =>
          db
            .insert(notificationRecords)
            .values({
              eventCode: "transport_unload_completed",
              idempotencyKey: `inapp:transport-photo-unload:${event.id}:${recipientUserId}`,
              recipientUserId,
              title: "运输卸土成功",
              content: `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车卸土成功，${trip.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票"}已通过卸土现场拍照确认，运单 ${trip.tripNo} 已形成运输闭环，请进入系统查看受控详情。`,
              deepLink: "/mobile/transport",
              status: "sent",
              sentAt: occurredAt,
              channel: "in_app",
            })
            .onDuplicateKeyUpdate({
              set: { status: "sent", sentAt: occurredAt },
            })
        )
      );
      notifyExternalDriverWechat({
        vehicleId: trip.vehicleId,
        projectId: input.projectId,
        eventCode: "transport_photo_unload_confirmed",
        targetType: "transport_card_event",
        targetId: String(event.id),
        title: "运输卸土成功",
        content: `车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车卸土成功，${trip.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票"}已通过卸土现场拍照确认，运单 ${trip.tripNo} 已形成运输闭环。`,
        deepLink: "/mobile/transport",
      });
      return {
        success: true,
        duplicate: false,
        needsReview: safetyNotices.length > 0,
        reason: safetyNotices.length ? safetyNotices.join("；") : null,
        safetyNotices,
        vehiclePlateNo: vehicle.plateNo,
        dailyVehicleTripOrdinal,
      };
    }),

  /** 装土/卸土现场注册设备统一入口：首次刷卡创建在途票据，第二次刷同卡按路线卸土点闭环。 */
  scanNfcReader: protectedProcedure
    .input(transportNfcReaderScanInput)
    .mutation(async ({ ctx, input }) =>
      recordTransportNfcReaderScan(ctx, input)
    ),

  /** 手机 NFC 触碰签名车辆卡后的受控入口；卡片 URL 不携带业务明细，由服务端实时解析并校验。 */
  scanNfcLink: protectedProcedure
    .input(transportNfcLinkScanInput)
    .mutation(async ({ ctx, input }) => recordTransportNfcLinkScan(ctx, input)),

  /** 刷 NFC 卡发票页面的只读车辆预览；只返回已签发车辆和可选线路，不创建任何票据。 */
  previewMobileNfcInvoice: protectedProcedure
    .input(mobileNfcInvoicePreviewInput)
    .query(async ({ ctx, input }) => resolveMobileNfcInvoice(ctx, input.token)),

  /** 管理员确认路线后，服务端以签名卡和项目台账创建运单或完成在途运单卸土闭环。 */
  confirmMobileNfcInvoice: protectedProcedure
    .input(mobileNfcInvoiceConfirmInput)
    .mutation(async ({ ctx, input }) => confirmMobileNfcInvoice(ctx, input)),

  /** 提交、核验、结算或作废运输趟次，确保历史运价快照与已结算金额不可回退。 */
  transitionTrip: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        nextStatus: z.enum(["submitted", "verified", "settled", "void"]),
        reviewRemarks: z.string().trim().min(4).max(500).optional(),
        reviewConfirmed: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [trip] = await db
        .select()
        .from(transportTrips)
        .where(eq(transportTrips.id, input.id))
        .limit(1);
      if (!trip || trip.projectId !== input.projectId)
        throw new TRPCError({ code: "NOT_FOUND", message: "运输趟次不存在" });
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly && input.nextStatus !== "submitted")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "司机仅可提交本人录入的运输趟次",
        });
      if (isDriverOnly)
        await getScopedVehicle(ctx, trip.vehicleId, input.projectId, roleCodes);
      if (
        ["verified", "void"].includes(input.nextStatus) &&
        !canManageSettlement(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权核验或作废运输趟次",
        });
      if (
        input.nextStatus === "settled" &&
        !canSettleFinancialRecord(roleCodes)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅财务负责人或会计可确认运输结算",
        });
      if (input.nextStatus === "settled") {
        const [vehicle] = await db
          .select({ ownership: transportVehicles.ownership })
          .from(transportVehicles)
          .where(eq(transportVehicles.id, trip.vehicleId))
          .limit(1);
        if (vehicle?.ownership === "trip_settlement")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "按趟运单不能直接标记已结算，请使用生成按趟结算入口建立真实结算单；未付款不代表已付清",
          });
      }
      if (input.nextStatus === "verified" || input.nextStatus === "void") {
        const [linked] = await db
          .select({
            settlementId: transportVehicleSettlementItems.settlementId,
          })
          .from(transportVehicleSettlementItems)
          .where(eq(transportVehicleSettlementItems.tripId, trip.id))
          .limit(1);
        if (linked)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "运单已进入真实结算单，请先在结算台账受控处理，不可直接作废或重复核验",
          });
      }
      if (input.nextStatus === "verified") {
        const events = await db
          .select()
          .from(transportCardEvents)
          .where(
            and(
              eq(transportCardEvents.projectId, input.projectId),
              eq(transportCardEvents.tripId, trip.id)
            )
          );
        const snapshot = getRouteSnapshot(trip.routeSnapshot);
        const ids = [
          trip.evidenceId,
          Number(snapshot.unloadPhotoEvidenceId) || null,
        ].filter((id): id is number => Boolean(id));
        const evidence = ids.length
          ? await db
              .select({
                id: evidenceRecords.id,
                mimeType: evidenceRecords.mimeType,
              })
              .from(evidenceRecords)
              .where(
                and(
                  eq(evidenceRecords.projectId, input.projectId),
                  eq(evidenceRecords.sourceType, "transport"),
                  eq(evidenceRecords.status, "active"),
                  inArray(evidenceRecords.id, ids)
                )
              )
          : [];
        const eligibility = getTransportReviewEligibility(trip, events, {
          load: evidence.some(
            item =>
              item.id === trip.evidenceId && item.mimeType?.startsWith("image/")
          ),
          unload: evidence.some(
            item =>
              item.id === Number(snapshot.unloadPhotoEvidenceId) &&
              item.mimeType?.startsWith("image/")
          ),
        });
        if (!eligibility.eligible)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: eligibility.reasons.join("；"),
          });
        if (
          (eligibility.requiresExceptionReview ||
            eligibility.closureKind !== "normal") &&
          !input.reviewRemarks &&
          input.reviewConfirmed !== true
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "特殊闭环或异常须勾选确认已核对现场资料，或填写现场核对依据后核验；系统不会补造装卸事实",
          });
      }
      try {
        assertTransportTripStatusTransition(trip.status, input.nextStatus);
      } catch (error) {
        throwDomainAsBadRequest(error);
      }
      const approvedFuelRecords =
        input.nextStatus === "settled"
          ? await db
              .select()
              .from(dieselRefuelRecords)
              .where(
                and(
                  eq(dieselRefuelRecords.transportTripId, input.id),
                  eq(dieselRefuelRecords.status, "approved")
                )
              )
          : [];
      const deductibleFuelRecords = approvedFuelRecords.filter(
        record => record.deductFromFreight
      );
      const fuelDeductionAmount = deductibleFuelRecords.reduce(
        (total, record) => total + Number(record.amount),
        0
      );
      const grossAmount = Number(trip.calculatedAmount ?? 0);
      const settlementValues =
        input.nextStatus === "settled"
          ? {
              status: input.nextStatus,
              activeVehicleTransitKey: null,
              fuelDeductionAmount: String(fuelDeductionAmount),
              netSettlementAmount: String(
                Number((grossAmount - fuelDeductionAmount).toFixed(2))
              ),
              fuelSettlementSnapshot: {
                grossFreightAmount: grossAmount,
                fuelDeductionAmount,
                netSettlementAmount: Number(
                  (grossAmount - fuelDeductionAmount).toFixed(2)
                ),
                records: deductibleFuelRecords.map(record => ({
                  id: record.id,
                  recordNo: record.recordNo,
                  liters: Number(record.liters),
                  unitPrice: Number(record.appliedUnitPrice),
                  amount: Number(record.amount),
                  supplyMethod: record.supplyMethod,
                })),
              },
            }
          : {
              status: input.nextStatus,
              ...(input.nextStatus === "verified" &&
              trip.exceptionStatus === "open"
                ? { exceptionStatus: "resolved" as const }
                : {}),
              ...(input.nextStatus === "void"
                ? {
                    activeVehicleTransitKey: null,
                    nfcTransitKey: null,
                    endAt: new Date(),
                  }
                : {}),
            };
      const updateResult = await db
        .update(transportTrips)
        .set(settlementValues)
        .where(
          and(
            eq(transportTrips.id, input.id),
            eq(transportTrips.status, trip.status)
          )
        );
      assertConditionalStatusWrite(updateResult, "运输趟次");
      if (input.nextStatus === "settled" && approvedFuelRecords.length) {
        await db
          .update(dieselRefuelRecords)
          .set({ status: "settled" })
          .where(
            and(
              eq(dieselRefuelRecords.transportTripId, input.id),
              eq(dieselRefuelRecords.status, "approved")
            )
          );
      }
      const transportStatusLabel = getBusinessStatusLabel(input.nextStatus);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "transition_trip",
        targetType: "transport_trip",
        targetId: String(input.id),
        summary: `运输趟次状态变更为：${transportStatusLabel}${input.nextStatus === "verified" && input.reviewConfirmed === true ? "；核验依据：管理员勾选确认已核对现场装卸资料及异常/特殊闭环情况；未补造装卸事实" : ""}${input.reviewRemarks ? `；核验依据：${input.reviewRemarks}` : ""}${input.nextStatus === "settled" ? `；总运费¥${grossAmount.toFixed(2)}，油款扣减¥${fuelDeductionAmount.toFixed(2)}，净结算¥${(grossAmount - fuelDeductionAmount).toFixed(2)}` : ""}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "transport",
        eventCode: `transport_trip_${input.nextStatus}`,
        targetType: "transport_trip",
        targetId: String(input.id),
        title: `运输趟次${transportStatusLabel}`,
        deepLink: "/mobile/transport",
      }).catch(() => undefined);
      notifyExternalDriverWechat({
        vehicleId: trip.vehicleId,
        projectId: input.projectId,
        eventCode: `transport_trip_${input.nextStatus}`,
        targetType: "transport_trip",
        targetId: String(input.id),
        title: `运输趟次${transportStatusLabel}`,
        content: `运单 ${trip.tripNo} 状态已更新为${transportStatusLabel}${input.nextStatus === "settled" ? `，净结算 ¥${(grossAmount - fuelDeductionAmount).toFixed(2)}` : ""}。`,
        deepLink: "/mobile/transport",
      });
      return { success: true };
    }),

  /** 按车辆和业务日汇总真实运单，供运输日结、付款候选和服务号通知共同使用。 */
  dailyVehicleSettlementSummary: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        date: businessDateSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          date: input.date,
          vehicleSummaries: [] as {
            vehicleId: number;
            plateNo: string;
            ownership: string;
            tripCount: number;
            totalVolumeCubicMeters: number;
            grossFreightAmount: number;
            fuelDeductionAmount: number;
            netPayableAmount: number;
            verifiedTripCount: number;
            settledTripCount: number;
            paymentStatus: string;
          }[],
        };
      const { start, end } = getChinaBusinessDateRange(input.date);
      let trips = await db
        .select()
        .from(transportTrips)
        .where(
          and(
            eq(transportTrips.projectId, input.projectId),
            gte(transportTrips.startAt, start),
            lt(transportTrips.startAt, end),
            ne(transportTrips.status, "void")
          )
        );
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly) {
        const ownVehicles = await db
          .select({ id: transportVehicles.id })
          .from(transportVehicles)
          .where(
            and(
              eq(transportVehicles.projectId, input.projectId),
              eq(transportVehicles.driverUserId, user.id)
            )
          );
        const ownIds = new Set(ownVehicles.map(item => item.id));
        trips = trips.filter(item => ownIds.has(item.vehicleId));
      }
      const tripIds = trips.map(item => item.id);
      const [vehicles, items] = await Promise.all([
        db
          .select({
            id: transportVehicles.id,
            plateNo: transportVehicles.plateNo,
            ownership: transportVehicles.ownership,
          })
          .from(transportVehicles)
          .where(eq(transportVehicles.projectId, input.projectId)),
        tripIds.length
          ? db
              .select({
                tripId: transportVehicleSettlementItems.tripId,
                settlementId: transportVehicleSettlementItems.settlementId,
              })
              .from(transportVehicleSettlementItems)
              .where(inArray(transportVehicleSettlementItems.tripId, tripIds))
          : Promise.resolve([]),
      ]);
      const settlementIds = Array.from(
        new Set(items.map(item => item.settlementId))
      );
      const settlements = settlementIds.length
        ? await db
            .select({
              id: transportVehicleSettlements.id,
              status: transportVehicleSettlements.status,
            })
            .from(transportVehicleSettlements)
            .where(inArray(transportVehicleSettlements.id, settlementIds))
        : [];
      const settlementStatusByTrip = new Map(
        items.map(item => [
          Number(item.tripId),
          settlements.find(settlement => settlement.id === item.settlementId)
            ?.status ?? "draft",
        ])
      );
      const vehicleById = new Map(
        vehicles.map(vehicle => [vehicle.id, vehicle])
      );
      const summaryByVehicle = new Map<
        number,
        {
          vehicleId: number;
          plateNo: string;
          ownership: string;
          tripCount: number;
          totalVolumeCubicMeters: number;
          grossFreightAmount: number;
          fuelDeductionAmount: number;
          netPayableAmount: number;
          verifiedTripCount: number;
          settledTripCount: number;
          paymentStatus: string;
        }
      >();
      trips.forEach(trip => {
        const vehicle = vehicleById.get(trip.vehicleId);
        const current = summaryByVehicle.get(trip.vehicleId) ?? {
          vehicleId: trip.vehicleId,
          plateNo: vehicle?.plateNo ?? `车辆 #${trip.vehicleId}`,
          ownership: vehicle?.ownership ?? "owned",
          tripCount: 0,
          totalVolumeCubicMeters: 0,
          grossFreightAmount: 0,
          fuelDeductionAmount: 0,
          netPayableAmount: 0,
          verifiedTripCount: 0,
          settledTripCount: 0,
          paymentStatus: settlementStatusByTrip.get(trip.id) ?? "未生成结算",
        };
        current.tripCount += 1;
        current.totalVolumeCubicMeters += Number(trip.volumeCubicMeters ?? 0);
        current.grossFreightAmount += Number(trip.calculatedAmount ?? 0);
        current.fuelDeductionAmount += Number(trip.fuelDeductionAmount ?? 0);
        current.netPayableAmount +=
          Number(trip.netSettlementAmount ?? trip.calculatedAmount ?? 0) -
          (trip.netSettlementAmount
            ? 0
            : Number(trip.fuelDeductionAmount ?? 0));
        if (trip.status === "verified") current.verifiedTripCount += 1;
        if (trip.status === "settled") current.settledTripCount += 1;
        const settlementStatus = settlementStatusByTrip.get(trip.id);
        if (settlementStatus && current.paymentStatus !== settlementStatus)
          current.paymentStatus = "多笔结算状态（请查看结算台账）";
        summaryByVehicle.set(trip.vehicleId, current);
      });
      return {
        date: input.date,
        vehicleSummaries: Array.from(summaryByVehicle.values())
          .map(item => ({
            ...item,
            totalVolumeCubicMeters:
              Math.round(item.totalVolumeCubicMeters * 1000) / 1000,
            grossFreightAmount: roundMoney(item.grossFreightAmount),
            fuelDeductionAmount: roundMoney(item.fuelDeductionAmount),
            netPayableAmount: roundMoney(item.netPayableAmount),
          }))
          .sort(
            (left, right) =>
              right.tripCount - left.tripCount ||
              left.plateNo.localeCompare(right.plateNo, "zh-CN")
          ),
      };
    }),

  /**
   * 司机移动端的柴油扣款明细：纯司机仅可读取本人绑定车辆的有效运输扣油记录，
   * 不复用项目级柴油台账，避免暴露其他车辆、机械或未扣运费的加油数据。
   */
  driverFuelDeductionDetails: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        date: businessDateSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          date: input.date,
          totalAmount: 0,
          totalLiters: 0,
          recordCount: 0,
          records: [] as Array<{
            id: number;
            recordNo: string;
            vehicleId: number | null;
            vehiclePlateNo: string;
            transportTripId: number | null;
            refueledAt: Date;
            liters: number;
            amount: number;
            appliedUnitPrice: number;
            supplyMethod: string;
            stationOrSupplierName: string | null;
            meterReading: number | null;
            receiptNo: string | null;
            remarks: string | null;
            evidence: {
              fileName: string;
              mimeType: string;
              url: string;
            } | null;
          }>,
        };
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      const vehicleRows = await db
        .select({
          id: transportVehicles.id,
          plateNo: transportVehicles.plateNo,
          driverUserId: transportVehicles.driverUserId,
        })
        .from(transportVehicles)
        .where(eq(transportVehicles.projectId, input.projectId));
      const scopedVehicles = isDriverOnly
        ? vehicleRows.filter(vehicle => vehicle.driverUserId === user.id)
        : vehicleRows;
      const vehicleIds = scopedVehicles.map(vehicle => vehicle.id);
      if (!vehicleIds.length)
        return {
          date: input.date,
          totalAmount: 0,
          totalLiters: 0,
          recordCount: 0,
          records: [],
        };
      const { start, end } = getChinaBusinessDateRange(input.date);
      const rows = await db
        .select()
        .from(dieselRefuelRecords)
        .where(
          and(
            eq(dieselRefuelRecords.projectId, input.projectId),
            eq(dieselRefuelRecords.assetType, "vehicle"),
            eq(dieselRefuelRecords.deductFromFreight, true),
            ne(dieselRefuelRecords.status, "void"),
            inArray(dieselRefuelRecords.vehicleId, vehicleIds),
            gte(dieselRefuelRecords.refueledAt, start),
            lt(dieselRefuelRecords.refueledAt, end)
          )
        )
        .orderBy(desc(dieselRefuelRecords.refueledAt));
      const vehicleById = new Map(
        scopedVehicles.map(vehicle => [vehicle.id, vehicle])
      );
      const safeRows = rows.filter(
        row =>
          row.assetType === "vehicle" &&
          row.deductFromFreight &&
          row.status !== "void" &&
          row.vehicleId !== null &&
          vehicleById.has(row.vehicleId)
      );
      const evidenceIds = Array.from(
        new Set(
          safeRows
            .map(row => row.evidenceId)
            .filter((id): id is number => typeof id === "number" && id > 0)
        )
      );
      const evidenceRows = evidenceIds.length
        ? await db
            .select({
              id: evidenceRecords.id,
              fileKey: evidenceRecords.fileKey,
              fileName: evidenceRecords.fileName,
              mimeType: evidenceRecords.mimeType,
            })
            .from(evidenceRecords)
            .where(
              and(
                eq(evidenceRecords.projectId, input.projectId),
                inArray(evidenceRecords.id, evidenceIds),
                eq(evidenceRecords.status, "active")
              )
            )
        : [];
      const evidenceById = new Map(
        await Promise.all(
          evidenceRows.map(
            async evidence =>
              [
                evidence.id,
                {
                  fileName: evidence.fileName,
                  mimeType: evidence.mimeType || "application/octet-stream",
                  url: await storageGetSignedUrl(evidence.fileKey),
                },
              ] as const
          )
        )
      );
      const records = safeRows.map(row => ({
        id: row.id,
        recordNo: row.recordNo,
        vehicleId: row.vehicleId,
        vehiclePlateNo: row.vehicleId
          ? (vehicleById.get(row.vehicleId)?.plateNo ??
            `车辆 #${row.vehicleId}`)
          : "未登记车辆",
        transportTripId: row.transportTripId,
        refueledAt: row.refueledAt,
        liters: Number(row.liters),
        amount: Number(row.amount),
        appliedUnitPrice: Number(row.appliedUnitPrice),
        supplyMethod: row.supplyMethod,
        stationOrSupplierName: row.stationOrSupplierName,
        meterReading:
          row.meterReading === null ? null : Number(row.meterReading),
        receiptNo: row.receiptNo,
        remarks: row.remarks,
        evidence: row.evidenceId
          ? (evidenceById.get(row.evidenceId) ?? null)
          : null,
      }));
      return {
        date: input.date,
        totalAmount: roundMoney(
          records.reduce((total, row) => total + row.amount, 0)
        ),
        totalLiters:
          Math.round(
            records.reduce((total, row) => total + row.liters, 0) * 1000
          ) / 1000,
        recordCount: records.length,
        records,
      };
    }),

  /** 将某日真实车辆趟次汇总投递给已绑定的项目责任收件人；模板未发布或投递失败不影响汇总查询。 */
  sendDailyVehicleSettlementSummary: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        date: businessDateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权发送运输日结通知",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const start = toBusinessDate(input.date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const trips = await db
        .select({
          vehicleId: transportTrips.vehicleId,
          calculatedAmount: transportTrips.calculatedAmount,
        })
        .from(transportTrips)
        .where(
          and(
            eq(transportTrips.projectId, input.projectId),
            gte(transportTrips.startAt, start),
            lt(transportTrips.startAt, end),
            ne(transportTrips.status, "void")
          )
        );
      const totalAmount = roundMoney(
        trips.reduce((sum, trip) => sum + Number(trip.calculatedAmount ?? 0), 0)
      );
      const content = `${input.date} 共 ${trips.length} 趟，涉及 ${new Set(trips.map(trip => trip.vehicleId)).size} 台车，应付总运费 ¥${totalAmount.toFixed(2)}。请在运输管理查看按车牌日结并办理核验、结算与付款。`;
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "transport",
        eventCode: "transport_daily_vehicle_settlement_summary",
        targetType: "transport_daily_vehicle_summary",
        targetId: `${input.projectId}-${input.date}`,
        title: "渣土车运输日结汇总",
        content,
        deepLink: "/mobile/transport",
      }).catch(() => undefined);
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "send_daily_vehicle_settlement_summary",
        targetType: "transport_daily_vehicle_summary",
        targetId: `${input.projectId}-${input.date}`,
        summary: `发起 ${input.date} 渣土车运单日结通知：${trips.length} 趟，应付总额 ¥${totalAmount.toFixed(2)}`,
      });
      return { success: true, tripCount: trips.length, totalAmount };
    }),

  /** 读取车辆结算单；完整收款账户仅向财务负责人、会计或系统管理员返回。 */
  listVehicleSettlements: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        vehicleId: z.number().int().positive().optional(),
        status: transportSettlementStatusSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      let rows = await db
        .select()
        .from(transportVehicleSettlements)
        .where(eq(transportVehicleSettlements.projectId, input.projectId))
        .orderBy(desc(transportVehicleSettlements.createdAt));
      if (input.vehicleId)
        rows = rows.filter(item => item.vehicleId === input.vehicleId);
      if (input.status)
        rows = rows.filter(item => item.status === input.status);
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly) {
        const ownVehicles = await db
          .select({ id: transportVehicles.id })
          .from(transportVehicles)
          .where(
            and(
              eq(transportVehicles.projectId, input.projectId),
              eq(transportVehicles.driverUserId, user.id)
            )
          );
        const ids = new Set(ownVehicles.map(item => item.id));
        rows = rows.filter(item => ids.has(item.vehicleId));
      }
      const [vehicles, items] = await Promise.all([
        db
          .select({
            id: transportVehicles.id,
            plateNo: transportVehicles.plateNo,
            ownership: transportVehicles.ownership,
            ownerName: transportVehicles.ownerName,
            driverName: transportVehicles.driverName,
          })
          .from(transportVehicles)
          .where(eq(transportVehicles.projectId, input.projectId)),
        rows.length
          ? db
              .select({
                settlementId: transportVehicleSettlementItems.settlementId,
                tripId: transportVehicleSettlementItems.tripId,
                tripNo: transportVehicleSettlementItems.tripNo,
              })
              .from(transportVehicleSettlementItems)
              .where(
                inArray(
                  transportVehicleSettlementItems.settlementId,
                  rows.map(item => item.id)
                )
              )
          : Promise.resolve([]),
      ]);
      const vehicleById = new Map(
        vehicles.map(vehicle => [vehicle.id, vehicle])
      );
      const itemBySettlement = new Map<
        number,
        { tripId: number; tripNo: string }[]
      >();
      items.forEach(item =>
        itemBySettlement.set(Number(item.settlementId), [
          ...(itemBySettlement.get(Number(item.settlementId)) ?? []),
          { tripId: Number(item.tripId), tripNo: item.tripNo },
        ])
      );
      const canReadFullAccount = canSettleFinancialRecord(roleCodes);
      if (canReadFullAccount && rows.some(item => Boolean(item.payeeAccount))) {
        await recordSensitiveDataAccess(db, {
          userId: user.id,
          projectId: input.projectId,
          module: "transport",
          dataCategory: "full_payment_account",
          accessPurpose: "渣土车按趟结算台账核对与人工转账准备",
          targetType: "transport_vehicle_settlement",
          targetId: input.vehicleId ? String(input.vehicleId) : null,
          recordCount: rows.filter(item => Boolean(item.payeeAccount)).length,
          result: "granted",
        });
      }
      const payments = rows.length
        ? await db
            .select({
              settlementId: settlementPaymentRecords.settlementId,
              amount: settlementPaymentRecords.amount,
              direction: settlementPaymentRecords.direction,
            })
            .from(settlementPaymentRecords)
            .where(
              and(
                eq(settlementPaymentRecords.projectId, input.projectId),
                eq(
                  settlementPaymentRecords.settlementType,
                  "transport_vehicle"
                ),
                eq(settlementPaymentRecords.status, "active"),
                inArray(
                  settlementPaymentRecords.settlementId,
                  rows.map(item => item.id)
                )
              )
            )
        : [];
      const offsets = rows.length
        ? await db
            .select({
              sourceSettlementId:
                transportVehicleCarryForwardOffsets.sourceSettlementId,
              amount: transportVehicleCarryForwardOffsets.amount,
            })
            .from(transportVehicleCarryForwardOffsets)
            .where(
              and(
                eq(
                  transportVehicleCarryForwardOffsets.projectId,
                  input.projectId
                ),
                eq(transportVehicleCarryForwardOffsets.status, "active"),
                inArray(
                  transportVehicleCarryForwardOffsets.sourceSettlementId,
                  rows.map(item => item.id)
                )
              )
            )
        : [];
      const paymentFacts = (
        item: typeof transportVehicleSettlements.$inferSelect
      ) => {
        const actualPaidAmount = roundMoney(
          payments
            .filter(
              row => row.settlementId === item.id && row.direction === "expense"
            )
            .reduce((sum, row) => sum + Number(row.amount), 0)
        );
        const actualReceivedAmount = roundMoney(
          payments
            .filter(
              row => row.settlementId === item.id && row.direction === "income"
            )
            .reduce((sum, row) => sum + Number(row.amount), 0)
        );
        const recoveredOffsetAmount = roundMoney(
          offsets
            .filter(row => row.sourceSettlementId === item.id)
            .reduce((sum, row) => sum + Number(row.amount), 0)
        );
        const remainingAmount =
          item.status === "void"
            ? 0
            : roundMoney(
                Math.max(
                  0,
                  Math.abs(Number(item.netPayableAmount)) -
                    (Number(item.netPayableAmount) < 0
                      ? actualReceivedAmount + recoveredOffsetAmount
                      : actualPaidAmount)
                )
              );
        return {
          actualPaidAmount,
          actualReceivedAmount,
          recoveredOffsetAmount,
          remainingAmount,
          legacyPaymentUnconfirmed:
            item.status === "paid" &&
            actualPaidAmount + actualReceivedAmount === 0,
        };
      };
      return rows.map(item => ({
        ...item,
        ...paymentFacts(item),
        vehicle: vehicleById.get(item.vehicleId) ?? null,
        payeeAccount: canReadFullAccount
          ? item.payeeAccount
          : maskPaymentAccount(item.payeeAccount),
        accountMasked: !canReadFullAccount,
        itemCount: itemBySettlement.get(item.id)?.length ?? 0,
        tripNos:
          itemBySettlement.get(item.id)?.map(detail => detail.tripNo) ?? [],
      }));
    }),

  /** 只预览真实运费候选，不估算柴油/资产扣款、抵扣余额或最终付款。 */
  previewVehicleSettlementSelection: protectedProcedure
    .input(transportVehicleSettlementSelectionInput)
    .query(async ({ ctx, input }) => {
      requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权预览渣土车费用结算候选",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [vehicle] = await db
        .select()
        .from(transportVehicles)
        .where(eq(transportVehicles.id, input.vehicleId))
        .limit(1);
      if (!vehicle || vehicle.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆不存在或不属于当前项目",
        });
      const [classification] = await db
        .select()
        .from(vehicleFleetProfiles)
        .where(eq(vehicleFleetProfiles.vehicleId, vehicle.id))
        .limit(1);
      if (!canUseVehicleTripSettlement(vehicle, classification))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅渣土车按趟/吨/方结算分类可使用运单合并结算",
        });
      return (await readVehicleSettlementSelection(db, input)).preview;
    }),

  /** 由已核验的渣土车真实趟次生成付款前结算草稿；每趟只能进入一张结算单。 */
  createVehicleSettlement: protectedProcedure
    .input(transportVehicleSettlementDraftInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权创建渣土车费用结算单",
        });
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [vehicle] = await db
        .select()
        .from(transportVehicles)
        .where(eq(transportVehicles.id, input.vehicleId))
        .limit(1);
      if (!vehicle || vehicle.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "车辆不存在或不属于当前项目",
        });
      const [classification] = await db
        .select()
        .from(vehicleFleetProfiles)
        .where(eq(vehicleFleetProfiles.vehicleId, vehicle.id))
        .limit(1);
      if (!canUseVehicleTripSettlement(vehicle, classification))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "仅“渣土车（按趟结算）”可使用本费用结算台账，外租车辆请继续使用租金管理",
        });
      const outstandingRecoveries = await getOutstandingVehicleRecoveries(
        db,
        input.projectId,
        input.vehicleId
      );
      const { start } = getChinaBusinessDateRange(input.periodStart);
      const { end: endExclusive } = getChinaBusinessDateRange(input.periodEnd);
      const modeSelection = input.selectionMode
        ? await readVehicleSettlementSelection(db, input)
        : null;
      if (
        modeSelection &&
        input.tripIds &&
        !vehicleSettlementTripIdsMatch(
          modeSelection.preview.tripIds,
          input.tripIds
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "所选运单与当前结算模式候选不一致，候选可能已新增、占用或变更，请刷新预览；不能静默忽略",
        });
      if (modeSelection && !modeSelection.preview.eligible)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: modeSelection.preview.reason!,
        });
      const verifiedTrips = modeSelection
        ? modeSelection.selectedTrips
        : await db
            .select()
            .from(transportTrips)
            .where(
              and(
                eq(transportTrips.projectId, input.projectId),
                eq(transportTrips.vehicleId, input.vehicleId),
                or(
                  eq(transportTrips.status, "verified"),
                  ...(input.legacyTripIds.length
                    ? [
                        and(
                          eq(transportTrips.status, "settled"),
                          inArray(transportTrips.id, input.legacyTripIds)
                        ),
                      ]
                    : [])
                ),
                gte(transportTrips.startAt, start),
                lt(transportTrips.startAt, endExclusive)
              )
            );
      if (!verifiedTrips.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "所选期间没有可结算的已核验运输趟次",
        });
      if (input.legacyTripIds.length && !canSettleFinancialRecord(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "历史未关联结算单的运单须由财务逐单核对确认",
        });
      const requestedIds = input.tripIds;
      const selectedTrips = requestedIds
        ? verifiedTrips.filter(trip => requestedIds.includes(trip.id))
        : verifiedTrips;
      if (requestedIds && selectedTrips.length !== new Set(requestedIds).size)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "所选运单不属于该车辆期间、未核验或缺少历史确认，不能静默忽略",
        });
      if (
        input.legacyTripIds.some(
          id =>
            !selectedTrips.some(
              trip => trip.id === id && trip.status === "settled"
            )
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "历史确认清单不属于本次候选，请重新核对",
        });
      const tripIds = selectedTrips.map(item => item.id);
      const [existingItems, fuelRecords, partsPurchaseRows] = await Promise.all(
        [
          db
            .select({ tripId: transportVehicleSettlementItems.tripId })
            .from(transportVehicleSettlementItems)
            .where(inArray(transportVehicleSettlementItems.tripId, tripIds)),
          db
            .select()
            .from(dieselRefuelRecords)
            .where(
              and(
                eq(dieselRefuelRecords.projectId, input.projectId),
                eq(dieselRefuelRecords.vehicleId, input.vehicleId),
                eq(dieselRefuelRecords.status, "approved"),
                eq(dieselRefuelRecords.deductFromFreight, true),
                lt(dieselRefuelRecords.refueledAt, endExclusive)
              )
            ),
          getEligibleAssetPurchaseDeductions(
            db,
            input.projectId,
            "vehicle",
            input.vehicleId,
            start,
            endExclusive
          ),
        ]
      );
      const existingTripIds = new Set(
        existingItems.map(item => Number(item.tripId))
      );
      const candidates = selectedTrips.filter(
        trip => !existingTripIds.has(trip.id)
      );
      if (requestedIds && candidates.length !== selectedTrips.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "所选运单已被其他结算单占用，请刷新后重新选择",
        });
      if (!candidates.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "所选期间的已核验趟次均已生成结算单，不能重复结算",
        });
      const fuelByTrip = new Map<number, number>();
      const eligibleFuelRecords = fuelRecords.filter(
        record =>
          record.transportTripId === null ||
          candidates.some(
            trip =>
              trip.id === Number(record.transportTripId) &&
              trip.status === "verified"
          )
      );
      const hasNewVerifiedTrips = candidates.some(
        trip => trip.status === "verified"
      );
      const pooledFuelRecords = hasNewVerifiedTrips
        ? eligibleFuelRecords.filter(record => !record.transportTripId)
        : [];
      eligibleFuelRecords
        .filter(record => record.transportTripId)
        .forEach(record =>
          fuelByTrip.set(
            Number(record.transportTripId),
            (fuelByTrip.get(Number(record.transportTripId)) ?? 0) +
              Number(record.amount)
          )
        );
      const pooledFuelDeductionAmount = roundMoney(
        pooledFuelRecords.reduce(
          (sum, record) => sum + Number(record.amount),
          0
        )
      );
      const grossFreightTotal = roundMoney(
        candidates.reduce(
          (sum, trip) => sum + Number(trip.calculatedAmount ?? 0),
          0
        )
      );
      const linkedFuelDeductionAmount = roundMoney(
        Array.from(fuelByTrip.values()).reduce((sum, amount) => sum + amount, 0)
      );
      const partsDeductionAmount = hasNewVerifiedTrips
        ? roundMoney(
            partsPurchaseRows.reduce(
              (sum, item) => sum + Number(item.amount),
              0
            )
          )
        : 0;
      const { details, consumedFuelIds } = buildTransportSettlementBasis(
        candidates,
        fuelRecords
      );
      const settlementNo = createTransportVehicleSettlementNo(input.projectId);
      const amountBeforeCarryForward = roundMoney(
        details.reduce((sum, item) => sum + item.netPayableAmount, 0) -
          partsDeductionAmount
      );
      let remainingForCarryForward = Math.max(0, amountBeforeCarryForward);
      const carryForwardAllocations = outstandingRecoveries
        .map(source => {
          const amount = roundMoney(
            Math.min(source.remainingAmount, remainingForCarryForward)
          );
          remainingForCarryForward = roundMoney(
            Math.max(0, remainingForCarryForward - amount)
          );
          return { ...source, amount };
        })
        .filter(item => item.amount > 0);
      const carryForwardDeductionAmount = roundMoney(
        carryForwardAllocations.reduce((sum, item) => sum + item.amount, 0)
      );
      const summary = {
        tripCount: details.length,
        totalVolumeCubicMeters:
          Math.round(
            details.reduce((sum, item) => sum + item.volumeCubicMeters, 0) *
              1000
          ) / 1000,
        grossFreightAmount: roundMoney(
          details.reduce((sum, item) => sum + item.grossFreightAmount, 0)
        ),
        fuelDeductionAmount: roundMoney(
          details.reduce((sum, item) => sum + item.fuelDeductionAmount, 0)
        ),
        assetDeductionAmount: partsDeductionAmount,
        carryForwardDeductionAmount,
        netPayableAmount: roundMoney(
          amountBeforeCarryForward - carryForwardDeductionAmount
        ),
      };
      let settlementId = 0;
      try {
        await db.transaction(async tx => {
          await lockVehicleSettlementScope(
            tx,
            input.projectId,
            input.vehicleId
          );
          if (input.selectionMode) {
            const currentSelection = await readVehicleSettlementSelection(
              tx,
              input,
              true
            );
            if (
              !currentSelection.preview.eligible ||
              !vehicleSettlementTripIdsMatch(
                currentSelection.preview.tripIds,
                candidates.map(trip => trip.id)
              )
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "结算候选已新增、占用或变更，请刷新预览后重新生成",
              });
          }
          const locked = await tx
            .select()
            .from(transportTrips)
            .where(
              and(
                eq(transportTrips.projectId, input.projectId),
                inArray(
                  transportTrips.id,
                  candidates.map(trip => trip.id)
                )
              )
            )
            .for("update");
          if (
            locked.length !== candidates.length ||
            locked.some(row => {
              const candidate = candidates.find(trip => trip.id === row.id);
              return (
                row.status !== candidate?.status ||
                row.vehicleId !== candidate?.vehicleId ||
                row.projectId !== candidate?.projectId ||
                row.startAt.getTime() !== candidate?.startAt.getTime() ||
                row.calculatedUnitPrice !== candidate?.calculatedUnitPrice ||
                row.volumeCubicMeters !== candidate?.volumeCubicMeters ||
                row.weightTons !== candidate?.weightTons ||
                JSON.stringify(row.routeSnapshot) !==
                  JSON.stringify(candidate?.routeSnapshot) ||
                row.calculatedAmount !== candidate?.calculatedAmount ||
                row.fuelDeductionAmount !== candidate?.fuelDeductionAmount ||
                row.netSettlementAmount !== candidate?.netSettlementAmount
              );
            })
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "运单状态已变更，请刷新后生成结算",
            });
          const occupied = await tx
            .select()
            .from(transportVehicleSettlementItems)
            .where(
              inArray(
                transportVehicleSettlementItems.tripId,
                candidates.map(row => row.id)
              )
            )
            .for("update");
          if (occupied.length)
            throw new TRPCError({
              code: "CONFLICT",
              message: "所选运单已被其他结算单占用，请刷新",
            });
          await assertVerifiedTransportEvidence(tx, input.projectId, locked);
          const offsetSources = await assertVehicleDeductionSources(
            tx,
            input.projectId,
            input.vehicleId,
            fuelRecords.filter(row => consumedFuelIds.includes(row.id)),
            hasNewVerifiedTrips ? partsPurchaseRows : [],
            carryForwardAllocations,
            start,
            endExclusive
          );
          await tx.insert(transportVehicleSettlements).values({
            settlementNo,
            projectId: input.projectId,
            vehicleId: input.vehicleId,
            periodStart: start,
            periodEnd: toBusinessDate(input.periodEnd),
            settlementKind: "trip",
            basisDescription: input.legacyTripIds.length
              ? `已核验趟次及财务逐单核对历史运单：${input.legacyConfirmation}`
              : "已核验运输趟次汇总",
            tripCount: summary.tripCount,
            totalVolumeCubicMeters: String(summary.totalVolumeCubicMeters),
            grossFreightAmount: String(summary.grossFreightAmount),
            fuelDeductionAmount: String(summary.fuelDeductionAmount),
            assetDeductionAmount: String(summary.assetDeductionAmount),
            carryForwardDeductionAmount: String(
              summary.carryForwardDeductionAmount
            ),
            netPayableAmount: String(summary.netPayableAmount),
            payeeName: input.payeeName.trim(),
            payeeAccount: input.payeeAccount?.trim() || null,
            paymentMethod: input.paymentMethod,
            remarks:
              `${input.remarks?.trim() || ""}${partsDeductionAmount ? `${input.remarks?.trim() ? "；" : ""}关联配件扣款 ¥${partsDeductionAmount.toFixed(2)}` : ""}${summary.carryForwardDeductionAmount ? `${input.remarks?.trim() || partsDeductionAmount ? "；" : ""}抵扣前期待收补款 ¥${summary.carryForwardDeductionAmount.toFixed(2)}` : ""}` ||
              null,
            createdBy: user.id,
          });
          const [created] = await tx
            .select({ id: transportVehicleSettlements.id })
            .from(transportVehicleSettlements)
            .where(eq(transportVehicleSettlements.settlementNo, settlementNo))
            .limit(1);
          if (!created) throw new Error("结算单写入后未找到主记录");
          settlementId = created.id;
          await tx.insert(auditLogs).values({
            userId: user.id,
            module: "transport",
            action: "vehicle_settlement_basis_v1",
            targetType: "transport_vehicle_settlement",
            targetId: settlementNo,
            summary: "固化逐趟结算依据与扣款来源；作废仅恢复本结算确切关联快照",
            beforeJson: JSON.stringify({
              version: 1,
              trips: candidates.map(trip => ({
                id: trip.id,
                status: trip.status,
                fuelDeductionAmount: trip.fuelDeductionAmount,
                netSettlementAmount: trip.netSettlementAmount,
              })),
              fuelIds: consumedFuelIds,
              fuelSources: fuelRecords
                .filter(row => consumedFuelIds.includes(row.id))
                .map(row => ({
                  id: row.id,
                  amount: row.amount,
                  transportTripId: row.transportTripId,
                })),
              partsIds: hasNewVerifiedTrips
                ? partsPurchaseRows.map(row => row.id)
                : [],
              offsetSources,
              legacyConfirmation: input.legacyConfirmation ?? null,
            }),
          });
          await tx.insert(transportVehicleSettlementItems).values(
            details.map(item => ({
              settlementId,
              tripId: item.trip.id,
              tripNo: item.trip.tripNo,
              tripDate: toBusinessDate(item.tripDate),
              volumeCubicMeters: String(item.volumeCubicMeters),
              grossFreightAmount: String(item.grossFreightAmount),
              fuelDeductionAmount: String(item.fuelDeductionAmount),
              netPayableAmount: String(item.netPayableAmount),
            }))
          );
          if (carryForwardAllocations.length) {
            await tx.insert(transportVehicleCarryForwardOffsets).values(
              carryForwardAllocations.map(item => ({
                projectId: input.projectId,
                vehicleId: input.vehicleId,
                sourceSettlementId: item.settlementId,
                targetSettlementId: settlementId,
                amount: String(item.amount),
                status: "active" as const,
                createdBy: user.id,
                reversedBy: null,
                reversedAt: null,
                reversalReason: null,
              }))
            );
            for (const allocation of carryForwardAllocations)
              if (
                roundMoney(allocation.amount - allocation.remainingAmount) === 0
              )
                await tx
                  .update(transportVehicleSettlements)
                  .set({ status: "offset" })
                  .where(
                    and(
                      eq(
                        transportVehicleSettlements.id,
                        allocation.settlementId
                      ),
                      ne(transportVehicleSettlements.status, "void")
                    )
                  );
          }
          if (consumedFuelIds.length)
            assertSettlementSourceWrites(
              await tx
                .update(dieselRefuelRecords)
                .set({ status: "settled" })
                .where(
                  and(
                    inArray(dieselRefuelRecords.id, consumedFuelIds),
                    eq(dieselRefuelRecords.status, "approved")
                  )
                ),
              consumedFuelIds.length,
              "结算扣款/使用依据"
            );
          if (hasNewVerifiedTrips && partsPurchaseRows.length)
            assertSettlementSourceWrites(
              await tx
                .update(purchaseOrders)
                .set({
                  assetDeductionReference: settlementNo,
                  assetDeductedAt: new Date(),
                })
                .where(
                  and(
                    inArray(
                      purchaseOrders.id,
                      partsPurchaseRows.map(item => item.id)
                    ),
                    isNull(purchaseOrders.assetDeductionReference)
                  )
                ),
              partsPurchaseRows.length,
              "结算扣款/使用依据"
            );
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("transport_vehicle_settlement_items_trip_unique"))
          throw new TRPCError({
            code: "CONFLICT",
            message: "部分运单已被其他结算单占用，请刷新后重新生成",
          });
        throw error;
      }
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: "create_vehicle_settlement",
        targetType: "transport_vehicle_settlement",
        targetId: settlementNo,
        summary: `生成渣土车按趟结算草稿：${vehicle.plateNo}${input.legacyTripIds.length ? `；逐单历史核对 ${input.legacyTripIds.join(",")}，依据 ${input.legacyConfirmation}` : ""}，${input.periodStart} 至 ${input.periodEnd}，${summary.tripCount} 趟，车辆归集柴油扣款 ¥${summary.fuelDeductionAmount.toFixed(2)}，资产扣款 ¥${summary.assetDeductionAmount.toFixed(2)}，前期抵扣 ¥${summary.carryForwardDeductionAmount.toFixed(2)}，净应付 ¥${summary.netPayableAmount.toFixed(2)}`,
      });
      return { success: true, id: settlementId, settlementNo, ...summary };
    }),

  /**
   * 无运输趟次时的车辆结算：外租车辆按有效租赁规则和已确认使用记录取数；
   * 其他已核准应付使用调整结算并强制填写依据。两者均可归集尚未结算的车辆柴油、配件和前期待收补款。
   */
  createNonTripVehicleSettlement: protectedProcedure
    .input(transportVehicleNonTripSettlementInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      if (!canManageSettlement(roleCodes))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前岗位无权创建车辆结算单",
        });
      const { db, vehicle } = await getScopedVehicle(
        ctx,
        input.vehicleId,
        input.projectId,
        roleCodes
      );
      const { start } = getChinaBusinessDateRange(input.periodStart);
      const end = toBusinessDate(input.periodEnd);
      const { end: endExclusive } = getChinaBusinessDateRange(input.periodEnd);
      const [
        fuelRecords,
        partsPurchaseRows,
        usageRows,
        leaseRules,
        outstandingRecoveries,
      ] = await Promise.all([
        db
          .select()
          .from(dieselRefuelRecords)
          .where(
            and(
              eq(dieselRefuelRecords.projectId, input.projectId),
              eq(dieselRefuelRecords.vehicleId, input.vehicleId),
              eq(dieselRefuelRecords.status, "approved"),
              eq(dieselRefuelRecords.deductFromFreight, true),
              isNull(dieselRefuelRecords.transportTripId),
              gte(dieselRefuelRecords.refueledAt, start),
              lt(dieselRefuelRecords.refueledAt, endExclusive)
            )
          ),
        getEligibleAssetPurchaseDeductions(
          db,
          input.projectId,
          "vehicle",
          input.vehicleId,
          start,
          endExclusive
        ),
        db
          .select()
          .from(transportVehicleUsageRecords)
          .where(
            and(
              eq(transportVehicleUsageRecords.projectId, input.projectId),
              eq(transportVehicleUsageRecords.vehicleId, input.vehicleId),
              eq(transportVehicleUsageRecords.status, "confirmed"),
              isNull(transportVehicleUsageRecords.settlementId),
              gte(transportVehicleUsageRecords.usageDate, start),
              lt(transportVehicleUsageRecords.usageDate, endExclusive)
            )
          ),
        db
          .select()
          .from(transportVehicleLeaseRules)
          .where(
            and(
              eq(transportVehicleLeaseRules.projectId, input.projectId),
              eq(transportVehicleLeaseRules.vehicleId, input.vehicleId),
              eq(transportVehicleLeaseRules.status, "active")
            )
          ),
        getOutstandingVehicleRecoveries(db, input.projectId, input.vehicleId),
      ]);
      let grossPayableAmount = 0;
      let basisDescription = input.basisDescription.trim();
      let usedUsageRows: typeof usageRows = [];
      if (input.settlementKind === "lease") {
        const [classification] = await db
          .select()
          .from(vehicleFleetProfiles)
          .where(eq(vehicleFleetProfiles.vehicleId, vehicle.id))
          .limit(1);
        if (
          vehicle.ownership !== "leased" &&
          classification?.propertyType !== "rented"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "租赁结算仅适用于外租车辆；其他车辆请使用有依据的调整结算",
          });
        const rule = leaseRules
          .sort(
            (left, right) =>
              new Date(right.effectiveFrom).getTime() -
              new Date(left.effectiveFrom).getTime()
          )
          .find(
            item =>
              new Date(item.effectiveFrom).getTime() < endExclusive.getTime() &&
              (!item.effectiveTo ||
                new Date(item.effectiveTo).getTime() >= start.getTime())
          );
        if (!rule)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "所选期间没有生效的车辆租赁计价规则，请先维护合同租金与起止日期",
          });
        if (rule.billingType === "monthly") {
          const effectiveStart = new Date(
            Math.max(start.getTime(), new Date(rule.effectiveFrom).getTime())
          );
          const effectiveEnd = new Date(
            Math.min(
              end.getTime(),
              rule.effectiveTo
                ? new Date(rule.effectiveTo).getTime()
                : end.getTime()
            )
          );
          const coveredDays = Math.max(
            0,
            Math.floor(
              (effectiveEnd.getTime() - effectiveStart.getTime()) / 86_400_000
            ) + 1
          );
          grossPayableAmount = roundMoney(
            (Number(rule.rate) * coveredDays) / 30
          );
          basisDescription = `${basisDescription}；月租合同 ${coveredDays} 天 ÷ 30 天 × ¥${Number(rule.rate).toFixed(2)}`;
        } else {
          const usageType =
            rule.billingType === "daily"
              ? "daily"
              : rule.billingType === "hourly"
                ? "hourly"
                : "shift";
          usedUsageRows = usageRows.filter(row => row.usageType === usageType);
          if (!usedUsageRows.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `该车辆按${rule.billingType === "daily" ? "天" : rule.billingType === "hourly" ? "小时" : "台班"}计费，所选期间须至少录入一条未结算的实际使用依据`,
            });
          const quantity = roundMoney(
            usedUsageRows.reduce((sum, row) => sum + Number(row.quantity), 0)
          );
          grossPayableAmount = roundMoney(quantity * Number(rule.rate));
          basisDescription = `${basisDescription}；${rule.billingType === "daily" ? "日租" : rule.billingType === "hourly" ? "小时租" : "台班"}使用量 ${quantity} × ¥${Number(rule.rate).toFixed(2)}`;
        }
      } else {
        grossPayableAmount = roundMoney(input.adjustmentAmount || 0);
      }
      if (grossPayableAmount <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "按合同或调整依据计算后的应付金额必须大于 0",
        });
      const fuelDeductionAmount = roundMoney(
        fuelRecords.reduce((sum, item) => sum + Number(item.amount), 0)
      );
      const assetDeductionAmount = roundMoney(
        partsPurchaseRows.reduce((sum, item) => sum + Number(item.amount), 0)
      );
      const amountBeforeCarryForward = roundMoney(
        grossPayableAmount - fuelDeductionAmount - assetDeductionAmount
      );
      let remainingForCarryForward = Math.max(0, amountBeforeCarryForward);
      const carryForwardAllocations = outstandingRecoveries
        .map(source => {
          const amount = roundMoney(
            Math.min(source.remainingAmount, remainingForCarryForward)
          );
          remainingForCarryForward = roundMoney(
            Math.max(0, remainingForCarryForward - amount)
          );
          return { ...source, amount };
        })
        .filter(item => item.amount > 0);
      const carryForwardDeductionAmount = roundMoney(
        carryForwardAllocations.reduce((sum, item) => sum + item.amount, 0)
      );
      const netPayableAmount = roundMoney(
        amountBeforeCarryForward - carryForwardDeductionAmount
      );
      const settlementNo = createTransportVehicleSettlementNo(input.projectId);
      let settlementId = 0;
      await db.transaction(async tx => {
        await lockVehicleSettlementScope(tx, input.projectId, input.vehicleId);
        const offsetSources = await assertVehicleDeductionSources(
          tx,
          input.projectId,
          input.vehicleId,
          fuelRecords,
          partsPurchaseRows,
          carryForwardAllocations,
          start,
          endExclusive
        );
        if (usedUsageRows.length) {
          const lockedUsage = await tx
            .select()
            .from(transportVehicleUsageRecords)
            .where(
              inArray(
                transportVehicleUsageRecords.id,
                usedUsageRows.map(row => row.id)
              )
            )
            .for("update");
          if (
            lockedUsage.length !== usedUsageRows.length ||
            lockedUsage.some(
              row =>
                row.status !== "confirmed" ||
                row.settlementId !== null ||
                row.quantity !==
                  usedUsageRows.find(old => old.id === row.id)?.quantity
            )
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "车辆租赁使用依据已被结算或变更，请刷新",
            });
        }
        if (input.settlementKind === "lease") {
          const otherLeases = await tx
            .select()
            .from(transportVehicleSettlements)
            .where(
              and(
                eq(transportVehicleSettlements.projectId, input.projectId),
                eq(transportVehicleSettlements.vehicleId, input.vehicleId),
                eq(transportVehicleSettlements.settlementKind, "lease"),
                ne(transportVehicleSettlements.status, "void"),
                lt(transportVehicleSettlements.periodStart, endExclusive),
                gte(transportVehicleSettlements.periodEnd, start)
              )
            );
          if (otherLeases.length)
            throw new TRPCError({
              code: "CONFLICT",
              message: "该车辆租赁期间已有结算单，不能重复计租",
            });
        }
        await tx.insert(transportVehicleSettlements).values({
          settlementNo,
          projectId: input.projectId,
          vehicleId: input.vehicleId,
          periodStart: start,
          periodEnd: end,
          settlementKind: input.settlementKind,
          basisDescription,
          tripCount: 0,
          totalVolumeCubicMeters: "0",
          grossFreightAmount: String(grossPayableAmount),
          fuelDeductionAmount: String(fuelDeductionAmount),
          assetDeductionAmount: String(assetDeductionAmount),
          carryForwardDeductionAmount: String(carryForwardDeductionAmount),
          netPayableAmount: String(netPayableAmount),
          payeeName: input.payeeName.trim(),
          payeeAccount: input.payeeAccount?.trim() || null,
          paymentMethod: input.paymentMethod,
          paymentDate: null,
          paymentReference: null,
          remarks: input.remarks?.trim() || null,
          status: "draft",
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
          paidBy: null,
          paidAt: null,
          createdBy: user.id,
        });
        const [created] = await tx
          .select({ id: transportVehicleSettlements.id })
          .from(transportVehicleSettlements)
          .where(eq(transportVehicleSettlements.settlementNo, settlementNo))
          .limit(1);
        if (!created) throw new Error("结算单写入后未找到主记录");
        settlementId = created.id;
        await tx.insert(auditLogs).values({
          userId: user.id,
          module: "transport",
          action: "vehicle_settlement_basis_v1",
          targetType: "transport_vehicle_settlement",
          targetId: settlementNo,
          summary: "固化非按趟结算柴油、配件与抵扣来源；不猜测历史扣款",
          beforeJson: JSON.stringify({
            version: 1,
            trips: [],
            fuelIds: fuelRecords.map(row => row.id),
            fuelSources: fuelRecords.map(row => ({
              id: row.id,
              amount: row.amount,
              transportTripId: row.transportTripId,
            })),
            partsIds: partsPurchaseRows.map(row => row.id),
            offsetSources,
          }),
        });
        if (usedUsageRows.length)
          assertSettlementSourceWrites(
            await tx
              .update(transportVehicleUsageRecords)
              .set({ settlementId })
              .where(
                and(
                  inArray(
                    transportVehicleUsageRecords.id,
                    usedUsageRows.map(item => item.id)
                  ),
                  isNull(transportVehicleUsageRecords.settlementId),
                  eq(transportVehicleUsageRecords.status, "confirmed")
                )
              ),
            usedUsageRows.length,
            "结算扣款/使用依据"
          );
        if (fuelRecords.length)
          assertSettlementSourceWrites(
            await tx
              .update(dieselRefuelRecords)
              .set({ status: "settled" })
              .where(
                and(
                  inArray(
                    dieselRefuelRecords.id,
                    fuelRecords.map(item => item.id)
                  ),
                  eq(dieselRefuelRecords.status, "approved")
                )
              ),
            fuelRecords.length,
            "结算扣款/使用依据"
          );
        if (partsPurchaseRows.length)
          assertSettlementSourceWrites(
            await tx
              .update(purchaseOrders)
              .set({
                assetDeductionReference: settlementNo,
                assetDeductedAt: new Date(),
              })
              .where(
                and(
                  inArray(
                    purchaseOrders.id,
                    partsPurchaseRows.map(item => item.id)
                  ),
                  isNull(purchaseOrders.assetDeductionReference)
                )
              ),
            partsPurchaseRows.length,
            "结算扣款/使用依据"
          );
        if (carryForwardAllocations.length) {
          await tx.insert(transportVehicleCarryForwardOffsets).values(
            carryForwardAllocations.map(item => ({
              projectId: input.projectId,
              vehicleId: input.vehicleId,
              sourceSettlementId: item.settlementId,
              targetSettlementId: settlementId,
              amount: String(item.amount),
              status: "active" as const,
              createdBy: user.id,
              reversedBy: null,
              reversedAt: null,
              reversalReason: null,
            }))
          );
          for (const allocation of carryForwardAllocations)
            if (
              roundMoney(allocation.amount - allocation.remainingAmount) === 0
            )
              await tx
                .update(transportVehicleSettlements)
                .set({ status: "offset" })
                .where(
                  and(
                    eq(transportVehicleSettlements.id, allocation.settlementId),
                    ne(transportVehicleSettlements.status, "void")
                  )
                );
        }
      });
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action:
          input.settlementKind === "lease"
            ? "create_vehicle_lease_settlement"
            : "create_vehicle_adjustment_settlement",
        targetType: "transport_vehicle_settlement",
        targetId: settlementNo,
        summary: `生成${input.settlementKind === "lease" ? "车辆租赁" : "车辆调整"}结算草稿：${vehicle.plateNo}，应付 ¥${grossPayableAmount.toFixed(2)}，柴油扣款 ¥${fuelDeductionAmount.toFixed(2)}，资产扣款 ¥${assetDeductionAmount.toFixed(2)}，前期抵扣 ¥${carryForwardDeductionAmount.toFixed(2)}，净额 ¥${netPayableAmount.toFixed(2)}`,
      });
      return {
        success: true,
        id: settlementId,
        settlementNo,
        grossPayableAmount,
        fuelDeductionAmount,
        assetDeductionAmount,
        carryForwardDeductionAmount,
        netPayableAmount,
      };
    }),

  /** 结算草稿提交、会计审核和作废；实际付款/补款必须走 settlementPayment 路由并上传凭证。 */
  transitionVehicleSettlement: protectedProcedure
    .input(transportVehicleSettlementActionInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      const [settlement] = await db
        .select()
        .from(transportVehicleSettlements)
        .where(eq(transportVehicleSettlements.id, input.id))
        .limit(1);
      if (!settlement || settlement.projectId !== input.projectId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "渣土车结算单不存在或不属于当前项目",
        });
      if (input.action === "void") {
        const [payment] = await db
          .select({ id: settlementPaymentRecords.id })
          .from(settlementPaymentRecords)
          .where(
            and(
              eq(settlementPaymentRecords.projectId, input.projectId),
              eq(settlementPaymentRecords.settlementType, "transport_vehicle"),
              eq(settlementPaymentRecords.settlementId, input.id),
              eq(settlementPaymentRecords.status, "active")
            )
          )
          .limit(1);
        if (payment)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该结算单已有实际收付凭证，不能作废",
          });
      }
      if (input.action === "pay")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "请使用“登记付款/补款”上传本次凭证并按实际金额办理，旧的一次性付款入口已停用",
        });
      if (
        ["paid", "partial", "receivable", "offset"].includes(settlement.status)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该结算单已进入实际收付、待收补款或抵扣流程，不能作废或回退",
        });
      const expectedStatus =
        input.action === "submit"
          ? "draft"
          : input.action === "approve"
            ? "submitted"
            : settlement.status;
      if (
        input.action === "void" &&
        !["draft", "submitted", "approved"].includes(settlement.status)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前结算状态不允许作废",
        });
      if (input.action === "submit" || input.action === "void") {
        if (!canManageSettlement(roleCodes))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "当前岗位无权提交或作废渣土车结算单",
          });
      }
      if (input.action === "approve") {
        if (!canSettleFinancialRecord(roleCodes))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "仅会计、财务负责人或系统管理员可审核结算单",
          });
      }
      const nextStatus:
        | "submitted"
        | "approved"
        | "receivable"
        | "offset"
        | "void" =
        input.action === "submit"
          ? "submitted"
          : input.action === "approve"
            ? Number(settlement.netPayableAmount) < 0
              ? "receivable"
              : Number(settlement.netPayableAmount) === 0
                ? "offset"
                : "approved"
            : "void";
      const items = await db
        .select()
        .from(transportVehicleSettlementItems)
        .where(eq(transportVehicleSettlementItems.settlementId, settlement.id));
      const [basisAudit] = await db
        .select({ beforeJson: auditLogs.beforeJson })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.module, "transport"),
            eq(auditLogs.action, "vehicle_settlement_basis_v1"),
            eq(auditLogs.targetId, settlement.settlementNo)
          )
        )
        .limit(1);
      let basis: {
        version?: number;
        trips?: Array<{
          id: number;
          status: "verified" | "settled";
          fuelDeductionAmount: string;
          netSettlementAmount: string | null;
        }>;
        fuelIds?: number[];
        fuelSources?: Array<{
          id: number;
          amount: string;
          transportTripId: number | null;
        }>;
        partsIds?: number[];
        offsetSources?: Array<{ id: number; status: string }>;
      } | null = null;
      try {
        basis = basisAudit?.beforeJson
          ? JSON.parse(basisAudit.beforeJson)
          : null;
      } catch {
        /* Historical audit absent or invalid: do not infer original state. */
      }
      if (
        input.action === "void" &&
        (items.length ||
          Number(settlement.fuelDeductionAmount) ||
          Number(settlement.assetDeductionAmount) ||
          Number(settlement.carryForwardDeductionAmount)) &&
        (basis?.version !== 1 ||
          !Array.isArray(basis.trips) ||
          !Array.isArray(basis.fuelIds) ||
          !Array.isArray(basis.partsIds) ||
          !Array.isArray(basis.offsetSources))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "历史结算缺少原状态与扣款来源快照，不能猜测恢复；请财务核对原始凭据后受控调整",
        });
      if (
        basis &&
        (basis.trips?.length !== items.length ||
          items.some(
            item => !basis!.trips?.some(row => row.id === item.tripId)
          ))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "结算依据快照不完整，不能猜测恢复运单",
        });
      await db.transaction(async tx => {
        await lockVehicleSettlementScope(
          tx,
          input.projectId,
          settlement.vehicleId
        );
        const [lockedSettlement] = await tx
          .select()
          .from(transportVehicleSettlements)
          .where(eq(transportVehicleSettlements.id, settlement.id))
          .for("update");
        if (
          lockedSettlement?.status !== expectedStatus ||
          lockedSettlement.netPayableAmount !== settlement.netPayableAmount
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "结算状态已变更，请刷新后重试",
          });
        if (input.action === "void") {
          const [payment] = await tx
            .select({ id: settlementPaymentRecords.id })
            .from(settlementPaymentRecords)
            .where(
              and(
                eq(settlementPaymentRecords.projectId, input.projectId),
                eq(
                  settlementPaymentRecords.settlementType,
                  "transport_vehicle"
                ),
                eq(settlementPaymentRecords.settlementId, settlement.id),
                eq(settlementPaymentRecords.status, "active")
              )
            )
            .limit(1);
          if (payment)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "结算已有实际收付，不能作废",
            });
        }
        const values: Partial<typeof transportVehicleSettlements.$inferInsert> =
          input.action === "submit"
            ? {
                status: nextStatus,
                submittedBy: user.id,
                submittedAt: new Date(),
              }
            : input.action === "approve"
              ? {
                  status: nextStatus,
                  approvedBy: user.id,
                  approvedAt: new Date(),
                }
              : {
                  status: nextStatus,
                  remarks: input.remarks?.trim() || settlement.remarks,
                };
        const result = await tx
          .update(transportVehicleSettlements)
          .set(values)
          .where(
            and(
              eq(transportVehicleSettlements.id, settlement.id),
              eq(transportVehicleSettlements.status, expectedStatus)
            )
          );
        assertConditionalStatusWrite(result, "渣土车结算单");
        if (input.action === "approve") {
          const lockedTrips = items.length
            ? await tx
                .select()
                .from(transportTrips)
                .where(
                  inArray(
                    transportTrips.id,
                    items.map(row => row.tripId)
                  )
                )
                .for("update")
            : [];
          await assertVerifiedTransportEvidence(
            tx,
            input.projectId,
            lockedTrips
          );
          for (const item of items) {
            const original = basis?.trips?.find(row => row.id === item.tripId);
            const current = lockedTrips.find(row => row.id === item.tripId);
            if (
              !current ||
              current.projectId !== input.projectId ||
              current.vehicleId !== settlement.vehicleId
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "结算关联运单已变更，请刷新",
              });
            if (original?.status === "settled") {
              if (
                current.status !== "settled" ||
                current.fuelDeductionAmount !== original.fuelDeductionAmount ||
                current.netSettlementAmount !== original.netSettlementAmount
              )
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "历史运单快照已变更，不可覆盖",
                });
              continue;
            }
            if (
              current.status !== "verified" ||
              (original &&
                (current.fuelDeductionAmount !== original.fuelDeductionAmount ||
                  current.netSettlementAmount !== original.netSettlementAmount))
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "已核验运单状态或金额已变更，不可覆盖",
              });
            const write = await tx
              .update(transportTrips)
              .set({
                status: "settled",
                fuelDeductionAmount: item.fuelDeductionAmount,
                netSettlementAmount: item.netPayableAmount,
                activeVehicleTransitKey: null,
              })
              .where(
                and(
                  eq(transportTrips.id, item.tripId),
                  eq(transportTrips.status, "verified"),
                  eq(
                    transportTrips.fuelDeductionAmount,
                    current.fuelDeductionAmount
                  ),
                  current.netSettlementAmount === null
                    ? isNull(transportTrips.netSettlementAmount)
                    : eq(
                        transportTrips.netSettlementAmount,
                        current.netSettlementAmount
                      )
                )
              );
            assertConditionalStatusWrite(write, "结算关联运单");
          }
        }
        if (input.action === "void") {
          if (basis?.trips)
            for (const item of items) {
              const original = basis.trips.find(
                trip => trip.id === item.tripId
              );
              if (!original)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "结算依据快照不完整，不能猜测恢复运单",
                });
              // Only trips originally verified were changed on approval. Legacy settled trips are never rewritten.
              if (
                settlement.status === "approved" &&
                original.status === "verified"
              ) {
                const write = await tx
                  .update(transportTrips)
                  .set({
                    status: "verified",
                    fuelDeductionAmount: original.fuelDeductionAmount,
                    netSettlementAmount: original.netSettlementAmount,
                  })
                  .where(
                    and(
                      eq(transportTrips.id, item.tripId),
                      eq(transportTrips.projectId, input.projectId),
                      eq(transportTrips.vehicleId, settlement.vehicleId),
                      eq(transportTrips.status, "settled"),
                      eq(
                        transportTrips.fuelDeductionAmount,
                        item.fuelDeductionAmount
                      ),
                      eq(
                        transportTrips.netSettlementAmount,
                        item.netPayableAmount
                      )
                    )
                  );
                assertConditionalStatusWrite(write, "待恢复运单金额快照");
              }
            }
          if (basis?.fuelIds?.length) {
            const fuelRows = await tx
              .select()
              .from(dieselRefuelRecords)
              .where(
                and(
                  inArray(dieselRefuelRecords.id, basis.fuelIds),
                  eq(dieselRefuelRecords.projectId, input.projectId),
                  eq(dieselRefuelRecords.vehicleId, settlement.vehicleId)
                )
              )
              .for("update");
            if (
              fuelRows.length !== basis.fuelIds.length ||
              fuelRows.some(
                row =>
                  row.status !== "settled" ||
                  (basis?.fuelSources &&
                    !basis.fuelSources.some(
                      old =>
                        old.id === row.id &&
                        old.amount === row.amount &&
                        old.transportTripId === row.transportTripId
                    ))
              )
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "柴油原扣款来源已变更，不能猜测恢复",
              });
            // Refuse restoration if another active settlement claims the same historical source.
            const sourceAudits = await tx
              .select({
                targetId: auditLogs.targetId,
                beforeJson: auditLogs.beforeJson,
              })
              .from(auditLogs)
              .where(
                and(
                  eq(auditLogs.module, "transport"),
                  eq(auditLogs.action, "vehicle_settlement_basis_v1")
                )
              );
            const activeSettlements = await tx
              .select()
              .from(transportVehicleSettlements)
              .where(
                and(
                  eq(transportVehicleSettlements.projectId, input.projectId),
                  ne(transportVehicleSettlements.status, "void"),
                  ne(transportVehicleSettlements.id, settlement.id)
                )
              );
            if (
              sourceAudits.some(audit => {
                if (
                  !activeSettlements.some(
                    row => row.settlementNo === audit.targetId
                  )
                )
                  return false;
                try {
                  return JSON.parse(audit.beforeJson || "{}").fuelIds?.some(
                    (id: number) => basis!.fuelIds!.includes(id)
                  );
                } catch {
                  return false;
                }
              })
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "柴油来源已被其他有效结算引用，不可恢复",
              });
            for (const row of fuelRows)
              assertConditionalStatusWrite(
                await tx
                  .update(dieselRefuelRecords)
                  .set({ status: "approved" })
                  .where(
                    and(
                      eq(dieselRefuelRecords.id, row.id),
                      eq(dieselRefuelRecords.status, "settled"),
                      eq(dieselRefuelRecords.amount, row.amount)
                    )
                  ),
                "柴油原扣款来源"
              );
          }
          await tx
            .update(transportVehicleCarryForwardOffsets)
            .set({
              status: "reversed",
              reversedBy: user.id,
              reversedAt: new Date(),
              reversalReason: "目标结算单作废",
            })
            .where(
              and(
                eq(
                  transportVehicleCarryForwardOffsets.targetSettlementId,
                  settlement.id
                ),
                eq(transportVehicleCarryForwardOffsets.status, "active")
              )
            );
          if (basis?.offsetSources?.length) {
            await tx
              .select()
              .from(transportVehicleSettlements)
              .where(
                inArray(
                  transportVehicleSettlements.id,
                  basis.offsetSources.map(row => row.id).sort((a, b) => a - b)
                )
              )
              .for("update");
            const outstanding = await getOutstandingVehicleRecoveries(
              tx,
              input.projectId,
              settlement.vehicleId
            );
            for (const original of basis.offsetSources)
              if (outstanding.some(row => row.settlementId === original.id))
                await tx
                  .update(transportVehicleSettlements)
                  .set({
                    status:
                      original.status === "partial" ? "partial" : "receivable",
                  })
                  .where(
                    and(
                      eq(transportVehicleSettlements.id, original.id),
                      eq(transportVehicleSettlements.status, "offset")
                    )
                  );
          }
          if (settlement.settlementKind === "lease")
            await tx
              .update(transportVehicleUsageRecords)
              .set({ settlementId: null })
              .where(
                eq(transportVehicleUsageRecords.settlementId, settlement.id)
              );
          await tx
            .delete(transportVehicleSettlementItems)
            .where(
              eq(transportVehicleSettlementItems.settlementId, settlement.id)
            );
          if (basis?.partsIds?.length) {
            const claimedParts = await tx
              .select()
              .from(purchaseOrders)
              .where(
                and(
                  inArray(purchaseOrders.id, basis.partsIds),
                  eq(purchaseOrders.projectId, input.projectId),
                  eq(
                    purchaseOrders.assetDeductionReference,
                    settlement.settlementNo
                  )
                )
              )
              .for("update");
            if (claimedParts.length !== basis.partsIds.length)
              throw new TRPCError({
                code: "CONFLICT",
                message: "配件原扣款引用已变更，不可猜测恢复",
              });
            for (const row of claimedParts)
              assertConditionalStatusWrite(
                await tx
                  .update(purchaseOrders)
                  .set({ assetDeductionReference: null, assetDeductedAt: null })
                  .where(
                    and(
                      eq(purchaseOrders.id, row.id),
                      eq(
                        purchaseOrders.assetDeductionReference,
                        settlement.settlementNo
                      )
                    )
                  ),
                "配件原扣款引用"
              );
          }
        }
      });
      const transitionLabel =
        input.action === "submit"
          ? "已提交会计审核"
          : input.action === "approve"
            ? nextStatus === "receivable"
              ? "已审核，待收补款"
              : nextStatus === "offset"
                ? "已审核，已抵扣结清"
                : "已审核，待付款"
            : "已作废";
      await db.insert(auditLogs).values({
        userId: user.id,
        module: "transport",
        action: `vehicle_settlement_${input.action}`,
        targetType: "transport_vehicle_settlement",
        targetId: settlement.settlementNo,
        summary: `车辆结算单${transitionLabel}：净额 ¥${Number(settlement.netPayableAmount).toFixed(2)}`,
      });
      void notifyOfficialAccountBusinessEventSafely({
        userId: user.id,
        projectId: input.projectId,
        module: "transport",
        eventCode: `transport_vehicle_settlement_${input.action}`,
        targetType: "transport_vehicle_settlement",
        targetId: settlement.settlementNo,
        title: "车辆费用结算状态更新",
        content: `${settlement.settlementNo} ${transitionLabel}，净额 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`,
        deepLink: "/mobile/transport",
      }).catch(() => undefined);
      notifyExternalDriverWechat({
        vehicleId: settlement.vehicleId,
        projectId: input.projectId,
        eventCode: `transport_vehicle_settlement_${input.action}`,
        targetType: "transport_vehicle_settlement",
        targetId: settlement.settlementNo,
        title: "车辆费用结算状态更新",
        content: `${settlement.settlementNo} ${transitionLabel}，净额 ¥${Number(settlement.netPayableAmount).toFixed(2)}。`,
        deepLink: "/mobile/transport",
      });
      return { success: true, status: nextStatus };
    }),

  /** 按自然日汇总趟次、方量、吨位和可结算运费，供日报与打印视图统一使用。 */
  dailySummary: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        date: businessDateSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const roleCodes = await assertTransportAccess(ctx);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        return {
          tripCount: 0,
          nfcCardTicketCount: 0,
          platePhotoTicketCount: 0,
          submittedCount: 0,
          verifiedCount: 0,
          settledCount: 0,
          volumeCubicMeters: 0,
          weightTons: 0,
          amount: 0,
          alertTripCount: 0,
          alertCount: 0,
          vehicleSummaries: [] as {
            vehicleId: number;
            plateNo: string;
            ticketCount: number;
            nfcCardTicketCount: number;
            platePhotoTicketCount: number;
            volumeCubicMeters: number;
            amount: number;
            verifiedCount: number;
            pendingReviewCount: number;
          }[],
        };
      const start = toBusinessDate(input.date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      let rows = await db
        .select()
        .from(transportTrips)
        .where(
          and(
            eq(transportTrips.projectId, input.projectId),
            gte(transportTrips.startAt, start),
            lt(transportTrips.startAt, end)
          )
        );
      const user = requireAuthenticatedUser(ctx);
      const isDriverOnly =
        roleCodes.includes("DRIVER") &&
        !roleCodes.some(role =>
          [
            "ALL",
            "TRANSPORT_MANAGER",
            "PROJECT_MANAGER",
            "FINANCE_MANAGER",
            "ACCOUNTANT",
          ].includes(role)
        );
      if (isDriverOnly) {
        const vehicles = await db
          .select({ id: transportVehicles.id })
          .from(transportVehicles)
          .where(
            and(
              eq(transportVehicles.projectId, input.projectId),
              eq(transportVehicles.driverUserId, user.id)
            )
          );
        const ownVehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
        rows = rows.filter(trip => ownVehicleIds.has(trip.vehicleId));
      }
      const activeRows = rows.filter(trip => trip.status !== "void");
      const anomalyMatrix = activeRows.map(trip =>
        calculateTransportAnomalies(trip)
      );
      const vehicleRows = await db
        .select({
          id: transportVehicles.id,
          plateNo: transportVehicles.plateNo,
        })
        .from(transportVehicles)
        .where(eq(transportVehicles.projectId, input.projectId));
      const vehiclePlates = new Map(
        vehicleRows.map(vehicle => [vehicle.id, vehicle.plateNo])
      );
      const vehicleSummaryMap = new Map<
        number,
        {
          vehicleId: number;
          plateNo: string;
          ticketCount: number;
          nfcCardTicketCount: number;
          platePhotoTicketCount: number;
          volumeCubicMeters: number;
          amount: number;
          verifiedCount: number;
          pendingReviewCount: number;
        }
      >();
      activeRows.forEach(trip => {
        const current = vehicleSummaryMap.get(trip.vehicleId) ?? {
          vehicleId: trip.vehicleId,
          plateNo:
            vehiclePlates.get(trip.vehicleId) ?? `车辆 #${trip.vehicleId}`,
          ticketCount: 0,
          nfcCardTicketCount: 0,
          platePhotoTicketCount: 0,
          volumeCubicMeters: 0,
          amount: 0,
          verifiedCount: 0,
          pendingReviewCount: 0,
        };
        current.ticketCount += 1;
        if ((trip.invoiceMode ?? "nfc_card") === "plate_photo")
          current.platePhotoTicketCount += 1;
        else current.nfcCardTicketCount += 1;
        current.volumeCubicMeters += Number(trip.volumeCubicMeters ?? 0);
        current.amount += Number(trip.calculatedAmount ?? 0);
        if (["verified", "settled"].includes(trip.status))
          current.verifiedCount += 1;
        if (trip.status === "submitted") current.pendingReviewCount += 1;
        vehicleSummaryMap.set(trip.vehicleId, current);
      });
      return {
        tripCount: activeRows.length,
        nfcCardTicketCount: activeRows.filter(
          trip => (trip.invoiceMode ?? "nfc_card") === "nfc_card"
        ).length,
        platePhotoTicketCount: activeRows.filter(
          trip => trip.invoiceMode === "plate_photo"
        ).length,
        submittedCount: activeRows.filter(trip => trip.status === "submitted")
          .length,
        verifiedCount: activeRows.filter(trip => trip.status === "verified")
          .length,
        settledCount: activeRows.filter(trip => trip.status === "settled")
          .length,
        volumeCubicMeters:
          Math.round(
            activeRows.reduce(
              (sum, trip) => sum + Number(trip.volumeCubicMeters ?? 0),
              0
            ) * 1000
          ) / 1000,
        weightTons:
          Math.round(
            activeRows.reduce(
              (sum, trip) => sum + Number(trip.weightTons ?? 0),
              0
            ) * 1000
          ) / 1000,
        amount: roundMoney(
          activeRows.reduce(
            (sum, trip) => sum + Number(trip.calculatedAmount ?? 0),
            0
          )
        ),
        alertTripCount: anomalyMatrix.filter(items => items.length > 0).length,
        alertCount: anomalyMatrix.reduce((sum, items) => sum + items.length, 0),
        vehicleSummaries: Array.from(vehicleSummaryMap.values())
          .map(item => ({
            ...item,
            volumeCubicMeters: roundMoney(item.volumeCubicMeters),
            amount: roundMoney(item.amount),
          }))
          .sort(
            (left, right) =>
              right.ticketCount - left.ticketCount ||
              left.plateNo.localeCompare(right.plateNo, "zh-CN")
          ),
      };
    }),
});
