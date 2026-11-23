import { z } from "zod";

/** All timestamps in this contract are UTC ISO-8601 strings; business dates use Asia/Shanghai. */
export const siteProjectInput = z
  .object({ projectId: z.number().int().positive() })
  .strict();
export const siteDashboardInput = siteProjectInput
  .extend({ businessDate: z.string().date() })
  .strict();
export const siteTransportDetailsInput = siteDashboardInput
  .extend({
    metric: z.enum([
      "departures",
      "normalCompletions",
      "currentInTransitVehicles",
      "pendingReview",
      "specialClosures",
    ]),
  })
  .strict();
export type SiteTransportMetric = z.infer<
  typeof siteTransportDetailsInput
>["metric"];
export type SiteTransportDetails = {
  projectId: number;
  businessDate: string;
  metric: SiteTransportMetric;
  count: number;
  vehicleCount: number;
  rows: {
    tripId: number;
    tripNo: string;
    vehicleId: number;
    plate: string;
    occurredAt: string;
    route: { load: string | null; unload: string | null };
  }[];
};
const publicVideoUrl = z
  .string()
  .max(2048)
  .url()
  .refine(value => {
    try {
      const u = new URL(value),
        h = u.hostname.toLowerCase();
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        (!u.port || u.port === "443") &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(h) &&
        h.includes(".") &&
        !/^\d+(?:\.\d+)*$/.test(h) &&
        !/(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(h) &&
        !/(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(h) &&
        !u.hash
      );
    } catch {
      return false;
    }
  }, "视频仅允许无凭据的公开 HTTPS 域名，不允许 IP、本机、内网或 RTSP");
export const siteVideoSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().trim().min(1).max(100),
    pointLabel: z.string().trim().min(1).max(100),
    kind: z.enum(["recorded", "sample"]),
    url: publicVideoUrl.optional(),
    storageReference: z.number().int().positive().optional(),
    sampleAsset: z.literal("excavator_cc_by_sa_4").optional(),
    recordedAt: z.string().datetime({ offset: true }).nullable(),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
    default: z.boolean(),
  })
  .strict()
  .refine(
    x =>
      [x.url, x.storageReference, x.sampleAsset].filter(Boolean).length === 1,
    "必须且只能提供公开地址、受控上传引用或固定授权样片"
  )
  .refine(
    x => !x.sampleAsset || x.kind === "sample",
    "固定授权素材必须标记示例录像"
  );
export const SITE_MET_NORWAY_TERMS_URL =
  "https://api.met.no/doc/TermsOfService";
export const SITE_MET_NORWAY_ATTRIBUTION = {
  name: "MET Norway",
  url: "https://www.met.no/en/free-meteorological-data",
  sourceUrl: "https://www.met.no/en/free-meteorological-data",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modification:
    "提取项目坐标模型预报，风速换算为 km/h，中文描述及系统阈值提示由本系统生成",
};
/** Syntax checks only: the administrator must confirm this is a genuine, reachable company contact. Never fetched. */
export function isValidSiteWeatherContact(contact: string): boolean {
  if (!contact || contact.length > 512 || !/^[\x21-\x7e]+$/.test(contact))
    return false;
  const reserved = (host: string) =>
    /(?:^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(
      host
    ) || /(?:^|\.)example\.(com|org|net)$/.test(host);
  if (z.string().email().safeParse(contact).success) {
    const host = contact.slice(contact.lastIndexOf("@") + 1).toLowerCase();
    return !reserved(host) && host.includes(".");
  }
  if (!publicVideoUrl.safeParse(contact).success) return false;
  const host = new URL(contact).hostname.toLowerCase();
  return !reserved(host) && !/(?:^|\.)(github\.com|github\.io)$/.test(host);
}
export const siteConfigurationSchema = z
  .object({
    location: z
      .object({
        label: z.string().trim().min(1).max(120),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .nullable(),
    videos: z
      .array(siteVideoSchema)
      .max(12)
      .refine(
        v => new Set(v.map(x => x.id)).size === v.length,
        "视频标识不能重复"
      )
      .refine(
        v =>
          v.filter(x => x.default).length <= 1 &&
          v.every(x => !x.default || x.enabled),
        "默认项必须启用且最多一项"
      ),
    weather: z
      .object({
        provider: z.enum(["disabled", "met_norway", "open_meteo_commercial"]),
        metNorway: z
          .object({
            termsAccepted: z.boolean(),
            contact: z
              .string()
              .trim()
              .max(512)
              .refine(
                v => v === "" || isValidSiteWeatherContact(v),
                "请填写有效公司邮箱或提供技术支持联系方式的公开 HTTPS 页面，不能使用占位信息或私有仓库"
              ),
          })
          .strict()
          .optional(),
        thresholds: z
          .object({
            windKmh: z.number().min(10).max(150),
            gustKmh: z.number().min(10).max(200),
            precipitationMm: z.number().min(0.1).max(100),
            visibilityMeters: z.number().min(50).max(10000),
            heatC: z.number().min(25).max(50),
            coldC: z.number().min(-40).max(10),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export const siteSaveConfigurationInput = siteProjectInput
  .extend({
    expectedVersion: z.number().int().positive().optional(),
    configuration: siteConfigurationSchema,
  })
  .strict();
export const siteWeatherCredentialInput = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_.-]+$/)
      .optional(),
    clear: z.boolean().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .refine(x => !(x.apiKey && x.clear), "更新和清空不可同时使用");
export const SITE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const siteUploadVideoInput = siteProjectInput
  .extend({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["video/mp4", "video/webm"]),
    base64: z
      .string()
      .min(1)
      .max(Math.ceil(SITE_VIDEO_MAX_BYTES / 3) * 4),
  })
  .strict();
export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>;
export type SiteVideo = z.infer<typeof siteVideoSchema>;
export type SiteProject = {
  id: number;
  name: string;
  status: "planning" | "active" | "suspended" | "completed" | "archived";
};
export const DEFAULT_SITE_CONFIGURATION: SiteConfiguration = {
  location: null,
  videos: [],
  weather: {
    provider: "disabled",
    thresholds: {
      windKmh: 40,
      gustKmh: 60,
      precipitationMm: 5,
      visibilityMeters: 1000,
      heatC: 35,
      coldC: 0,
    },
  },
};
export type SiteRisk = {
  key: string;
  ruleCode: string;
  vehicleId: number;
  plate: string;
  project: { id: number; name: string };
  route: { load: string | null; unload: string | null };
  occurredAt: string;
  severity: "notice" | "warning" | "critical";
  reason: string;
  evidence: {
    type:
      | "transport_trip"
      | "transport_card_event"
      | "diesel_refuel"
      | "transport_vehicle";
    id: number;
  };
  reviewStatus: "pending_review" | "acknowledged" | "in_rectification";
  alertId: number | null;
  basis: "business_day" | "current_snapshot";
  detail: {
    target: "transport" | "diesel";
    projectId: number;
    vehicleId: number;
    tripId: number | null;
    refuelId: number | null;
    eventId: number | null;
  };
};
export type SiteTransportEvent = {
  key: string;
  type: "departure" | "unload" | "review";
  tripId: number;
  eventId: number | null;
  vehicleId: number;
  plate: string;
  route: { load: string | null; unload: string | null };
  occurredAt: string;
  status: "accepted" | "needs_review" | "rejected" | "issued";
  closureKind: "normal" | "single_scan" | "unload_only";
  normalCompletion: boolean;
};
export type SiteDashboard = {
  scope: {
    projectId: number;
    projectName: string;
    businessDate: string;
    timezone: "Asia/Shanghai";
    startAt: string;
    endExclusive: string;
  };
  updatedAt: string;
  transport: {
    departures: number;
    normalCompletions: number;
    currentInTransitVehicles: number;
    pendingReview: number;
    specialClosures: number;
    inTransitBasis: "current_snapshot";
    inTransitAsOf: string;
    pendingReviewBasis: "business_day_related_trips";
    countBasis: "all_matching_records";
    events: SiteTransportEvent[];
    eventTotal: number;
    eventLimit: number;
    eventsTruncated: boolean;
  };
  construction: {
    total: number;
    limit: number;
    truncated: boolean;
    reports: {
      id: number;
      workArea: string;
      workContent: string;
      constructionPlan: string | null;
      issueNotes: string | null;
      issuePriority: "normal" | "urgent" | "ungraded" | "none";
      status: string;
      updatedAt: string;
      issueResolution: "not_tracked";
    }[];
  };
  vehicles: {
    vehicleId: number;
    plate: string;
    registeredFuelLiters: number;
    refuelRecordCount: number;
    pendingFuelRecords: number;
    normalCompletedTrips: number;
    fuelTankCapacityLiters: number | null;
    capacityStatus: "ready" | "data_insufficient";
    evidenceStatus: "ready" | "data_insufficient";
    fuelConsumptionStatus: "data_insufficient";
    tripEfficiencyStatus: "data_insufficient";
  }[];
  risks: {
    enabled: boolean;
    status: "ready" | "disabled";
    items: SiteRisk[];
    total: number;
    limit: number;
    truncated: boolean;
    interpretation: "待核查，不认定偷油或违规；真实油耗和趟数效率缺少基线";
  };
};
export const SITE_SAMPLE_METADATA = {
  asset: "excavator_cc_by_sa_4" as const,
  author: "KaiKemmann",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  sourceUrl:
    "https://commons.wikimedia.org/wiki/File:Excavator_ballet,_Oberlech_321,_6764_Lech_am_Arlberg,_Austria-2.webm",
  recordedDate: "2023-10-03",
  location: "奥地利 Oberlech",
  durationSeconds: 39.27,
  modification: "转码 H.264、移除音轨",
  label: "授权示例录像·非本项目工地·非实时",
};
export type SiteConfigurationResult = {
  projectId: number;
  version: number | null;
  configuration: SiteConfiguration;
  updatedAt: string | null;
  videoStatus: "not_configured" | "recorded_or_sample";
  videos: (SiteVideo & {
    playbackUrl: string | null;
    playbackStatus: "ready" | "unavailable";
    attribution: typeof SITE_SAMPLE_METADATA | null;
  })[];
  weatherCredential: { version: number | null; keyConfigured: boolean };
};
export type SiteWeather = {
  status: "disabled" | "not_configured" | "unavailable" | "ready" | "stale";
  source: "open_meteo_commercial" | "met_norway";
  sourceKind: "model";
  timezone: "Asia/Shanghai";
  attribution?: typeof SITE_MET_NORWAY_ATTRIBUTION;
  weatherDescription?: string | null;
  predictive?: {
    label: "模型预报·非现场实测";
    precipitationPeriod: "next_1_hour";
    precipitationMm: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    dailyBasis: "remaining_forecast_points";
  };
  fetchedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  stale: boolean;
  officialAlerts: { status: "not_connected" };
  units: {
    temperature: "°C";
    wind: "km/h";
    precipitation: "mm";
    probability: "%";
    visibility: "m";
  };
  current: {
    time: string;
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    humidityPercent: number | null;
    weatherCode: number | null;
    windKmh: number | null;
    windDirectionDegrees: number | null;
    gustKmh: number | null;
    precipitationMm: number | null;
  } | null;
  hourly: {
    time: string;
    temperatureC: number | null;
    precipitationProbability: number | null;
    visibilityMeters: number | null;
    windKmh: number | null;
    precipitationMm: number | null;
  }[];
  daily: {
    date: string;
    maximumC: number | null;
    minimumC: number | null;
  } | null;
  workHints: { code: string; label: string; source: "system_work_hint" }[];
};
