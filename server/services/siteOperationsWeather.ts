import type {
  SiteConfiguration,
  SiteWeather,
} from "../../shared/siteOperations";
import {
  DEFAULT_SITE_CONFIGURATION,
  isValidSiteWeatherContact,
  SITE_MET_NORWAY_ATTRIBUTION,
} from "../../shared/siteOperations";
import {
  parseSiteConfiguration,
  readSiteSetting,
  requireSiteDb,
  requireSiteProject,
  siteConfigurationKey,
  WEATHER_CREDENTIAL_KEY,
} from "./siteOperationsConfiguration";
import { decryptSecret } from "./secretVault";
import { chinaBusinessDate } from "./chinaBusinessTime";
const CACHE_MS = 180000;
const MAX_CACHE_ENTRIES = 250;
// Conservative global-region minimum, including China. Also safe for Nordic projects.
const MET_MIN_INTERVAL_MS = 3 * 3600000;
const cache = new Map<string, { expires: number; value: SiteWeather }>();
const commercialPending = new Map<string, Promise<SiteWeather>>();
type MetEntry = {
  nextRequestAt: number;
  raw?: unknown;
  fetchedAt?: string;
  lastModified?: string;
  failures: number;
  failed: boolean;
  pending?: Promise<void>;
};
const metCache = new Map<string, MetEntry>();
let metThrottleUntil = 0;
let metRequestStarts: number[] = [];
export function clearSiteWeatherCache() {
  cache.clear();
  commercialPending.clear();
  metCache.clear();
  metThrottleUntil = 0;
  metRequestStarts = [];
}
export function emptySiteWeather(
  status: SiteWeather["status"],
  source: SiteWeather["source"] = "open_meteo_commercial"
): SiteWeather {
  return {
    status,
    source,
    sourceKind: "model",
    ...(source === "met_norway"
      ? { attribution: SITE_MET_NORWAY_ATTRIBUTION, weatherDescription: null }
      : {}),
    timezone: "Asia/Shanghai",
    fetchedAt: null,
    updatedAt: null,
    expiresAt: null,
    stale: false,
    officialAlerts: { status: "not_connected" },
    units: {
      temperature: "°C",
      wind: "km/h",
      precipitation: "mm",
      probability: "%",
      visibility: "m",
    },
    current: null,
    hourly: [],
    daily: null,
    workHints: [],
  };
}
function value(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function modelTime(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)
  )
    return null;
  const time = new Date(`${value}+08:00`);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}
function utcTime(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
  )
    return null;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}
function workHints(
  configuration: SiteConfiguration,
  current: NonNullable<SiteWeather["current"]>,
  hourly: SiteWeather["hourly"],
  stale: boolean,
  nextHourRain?: number | null
): SiteWeather["workHints"] {
  if (stale) return [];
  const t = configuration.weather.thresholds,
    hints: SiteWeather["workHints"] = [];
  const hint = (code: string, label: string) =>
    hints.push({ code, label, source: "system_work_hint" });
  if (
    (current.windKmh ?? -1) >= t.windKmh ||
    (current.gustKmh ?? -1) >= t.gustKmh
  )
    hint(
      "wind",
      "模型风速达到项目提示阈值，关注露天作业；由现场负责人按制度判断。"
    );
  if ((nextHourRain ?? current.precipitationMm ?? -1) >= t.precipitationMm)
    hint(
      "rain",
      nextHourRain !== undefined
        ? "未来1小时模型降水达到项目提示阈值，注意道路湿滑与排水；非现场实测、非官方预警。"
        : "模型降水达到提示阈值，注意道路湿滑与排水。"
    );
  if (
    hourly.some(
      h =>
        h.visibilityMeters !== null && h.visibilityMeters < t.visibilityMeters
    )
  )
    hint("visibility", "预报能见度低于项目提示阈值，关注交通与现场照明。");
  if (current.temperatureC !== null && current.temperatureC >= t.heatC)
    hint("heat", "模型气温达到高温提示阈值，注意防暑与轮换作业。");
  if (current.temperatureC !== null && current.temperatureC <= t.coldC)
    hint("cold", "模型气温达到低温提示阈值，注意低温防护。");
  return hints;
}
export function projectSiteWeather(
  raw: unknown,
  configuration: SiteConfiguration,
  now: Date
): SiteWeather {
  const r = raw as {
    current?: Record<string, unknown>;
    hourly?: Record<string, unknown>;
    daily?: Record<string, unknown>;
    utc_offset_seconds?: number;
  };
  const current = r?.current,
    time = modelTime(current?.time);
  if (!current || !time || r.utc_offset_seconds !== 28800)
    return emptySiteWeather("unavailable");
  const currentData: NonNullable<SiteWeather["current"]> = {
    time,
    temperatureC: value(current.temperature_2m),
    apparentTemperatureC: value(current.apparent_temperature),
    humidityPercent: value(current.relative_humidity_2m),
    weatherCode: value(current.weather_code),
    windKmh: value(current.wind_speed_10m),
    windDirectionDegrees: value(current.wind_direction_10m),
    gustKmh: value(current.wind_gusts_10m),
    precipitationMm: value(current.precipitation),
  };
  if (
    Object.entries(currentData)
      .filter(([k]) => k !== "time")
      .every(([, v]) => v === null)
  )
    return emptySiteWeather("unavailable");
  const hourly: SiteWeather["hourly"] = [];
  const ht = Array.isArray(r.hourly?.time) ? r.hourly!.time : [];
  const at = (key: string, index: number) =>
    value(
      Array.isArray(r.hourly?.[key])
        ? (r.hourly![key] as unknown[])[index]
        : null
    );
  for (let i = 0; i < ht.length && hourly.length < 12; i++) {
    const hour = modelTime(ht[i]);
    if (!hour || new Date(hour).getTime() < now.getTime() - 3600000) continue;
    hourly.push({
      time: hour,
      temperatureC: at("temperature_2m", i),
      precipitationProbability: at("precipitation_probability", i),
      visibilityMeters: at("visibility", i),
      windKmh: at("wind_speed_10m", i),
      precipitationMm: at("precipitation", i),
    });
  }
  const today = chinaBusinessDate(now);
  const dailyTime = Array.isArray(r.daily?.time) ? r.daily!.time : [],
    index = dailyTime.indexOf(today);
  const daily =
    index < 0
      ? null
      : {
          date: today,
          maximumC: value(
            Array.isArray(r.daily?.temperature_2m_max)
              ? r.daily!.temperature_2m_max[index]
              : null
          ),
          minimumC: value(
            Array.isArray(r.daily?.temperature_2m_min)
              ? r.daily!.temperature_2m_min[index]
              : null
          ),
        };
  const age = now.getTime() - new Date(time).getTime(),
    stale = age > 3600000 || age < -900000;
  return {
    ...emptySiteWeather(stale ? "stale" : "ready"),
    fetchedAt: now.toISOString(),
    updatedAt: time,
    expiresAt: new Date(now.getTime() + CACHE_MS).toISOString(),
    stale,
    current: currentData,
    hourly,
    daily,
    workHints: workHints(configuration, currentData, hourly, stale),
  };
}
type MetPoint = {
  time?: unknown;
  data?: {
    instant?: { details?: Record<string, unknown> };
    next_1_hours?: {
      details?: Record<string, unknown>;
      summary?: { symbol_code?: unknown };
    };
  };
};
function describeMetSymbol(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const code = symbol.replace(/_(day|night|polartwilight)$/, "");
  const basic: Record<string, string> = {
    clearsky: "晴",
    fair: "晴间多云",
    partlycloudy: "局部多云",
    cloudy: "阴",
    fog: "雾",
    lightrain: "小雨",
    rain: "雨",
    heavyrain: "大雨",
    lightsleet: "轻微雨夹雪",
    sleet: "雨夹雪",
    heavysleet: "较强雨夹雪",
    lightsnow: "小雪",
    snow: "雪",
    heavysnow: "大雪",
    lightrainshowers: "小阵雨",
    rainshowers: "阵雨",
    heavyrainshowers: "强阵雨",
    lightsleetshowers: "轻微雨夹雪阵雨",
    sleetshowers: "雨夹雪阵雨",
    heavysleetshowers: "较强雨夹雪阵雨",
    lightsnowshowers: "小阵雪",
    snowshowers: "阵雪",
    heavysnowshowers: "强阵雪",
  };
  if (code.endsWith("andthunder")) {
    const description =
      basic[code.replace(/andthunder$/, "").replace(/^lightss/, "lights")];
    return description ? `${description}伴雷电` : null;
  }
  return basic[code] ?? null;
}
export function projectMetNorwayWeather(
  raw: unknown,
  configuration: SiteConfiguration,
  now: Date
): SiteWeather {
  const r = raw as {
    properties?: {
      meta?: { updated_at?: unknown; units?: Record<string, unknown> };
      timeseries?: MetPoint[];
    };
  } | null;
  const unavailable = () => emptySiteWeather("unavailable", "met_norway");
  if (!Array.isArray(r?.properties?.timeseries)) return unavailable();
  const units = r.properties.meta?.units;
  const points = r.properties.timeseries
    .map(p => ({ point: p, time: utcTime(p?.time) }))
    .filter((p): p is { point: MetPoint; time: string } => p.time !== null)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const nearest = points.reduce<(typeof points)[number] | undefined>(
    (best, p) =>
      !best ||
      Math.abs(Date.parse(p.time) - now.getTime()) <
        Math.abs(Date.parse(best.time) - now.getTime())
        ? p
        : best,
    undefined
  );
  if (!nearest) return unavailable();
  const details = nearest.point.data?.instant?.details;
  const at = (field: string, unit: string, d?: Record<string, unknown>) =>
    units?.[field] === unit ? value(d?.[field]) : null;
  const wind = (d?: Record<string, unknown>) => {
    const n = at("wind_speed", "m/s", d);
    return n === null ? null : Math.round(n * 3.6 * 10) / 10;
  };
  const current: NonNullable<SiteWeather["current"]> = {
    time: nearest.time,
    temperatureC: at("air_temperature", "celsius", details),
    apparentTemperatureC: null,
    humidityPercent: at("relative_humidity", "%", details),
    weatherCode: null,
    windKmh: wind(details),
    windDirectionDegrees: at("wind_from_direction", "degrees", details),
    gustKmh: null,
    precipitationMm: null,
  };
  if (
    [
      current.temperatureC,
      current.humidityPercent,
      current.windKmh,
      current.windDirectionDegrees,
    ].every(v => v === null)
  )
    return unavailable();
  const rain = (p: MetPoint) =>
    at("precipitation_amount", "mm", p.data?.next_1_hours?.details);
  const hourly: SiteWeather["hourly"] = points
    .filter(p => Date.parse(p.time) >= now.getTime())
    .slice(0, 12)
    .map(p => ({
      time: p.time,
      temperatureC: at(
        "air_temperature",
        "celsius",
        p.point.data?.instant?.details
      ),
      windKmh: wind(p.point.data?.instant?.details),
      precipitationMm: rain(p.point),
      precipitationProbability: null,
      visibilityMeters: null,
    }));
  const temperatures = points
    .filter(
      p =>
        Date.parse(p.time) >= now.getTime() &&
        chinaBusinessDate(new Date(p.time)) === chinaBusinessDate(now)
    )
    .map(p => at("air_temperature", "celsius", p.point.data?.instant?.details))
    .filter((t): t is number => t !== null);
  const stale = Math.abs(now.getTime() - Date.parse(nearest.time)) > 3600000;
  const precipitationMm = rain(nearest.point);
  return {
    ...emptySiteWeather(stale ? "stale" : "ready", "met_norway"),
    stale,
    current,
    hourly,
    updatedAt: utcTime(r.properties.meta?.updated_at),
    fetchedAt: now.toISOString(),
    weatherDescription: describeMetSymbol(
      nearest.point.data?.next_1_hours?.summary?.symbol_code
    ),
    predictive: {
      label: "模型预报·非现场实测",
      precipitationPeriod: "next_1_hour",
      precipitationMm,
      periodStart: nearest.point.data?.next_1_hours ? nearest.time : null,
      periodEnd: nearest.point.data?.next_1_hours
        ? new Date(Date.parse(nearest.time) + 3600000).toISOString()
        : null,
      dailyBasis: "remaining_forecast_points",
    },
    daily: temperatures.length
      ? {
          date: chinaBusinessDate(now),
          maximumC: Math.max(...temperatures),
          minimumC: Math.min(...temperatures),
        }
      : null,
    workHints: workHints(
      configuration,
      current,
      hourly,
      stale,
      precipitationMm
    ),
  };
}
function touch<K, V>(map: Map<K, V>, key: K, entry: V) {
  map.delete(key);
  map.set(key, entry);
}
/** Do not evict unexpired records: doing so would let a new project repeat the same MET URL too early. Fail closed at capacity. */
function reserveMetEntry(key: string, now: number): MetEntry | null {
  const old = metCache.get(key);
  if (old) {
    touch(metCache, key, old);
    return old;
  }
  if (metCache.size >= MAX_CACHE_ENTRIES) {
    const victim = Array.from(metCache).find(
      ([, e]) => !e.pending && e.nextRequestAt <= now
    );
    if (!victim) return null;
    metCache.delete(victim[0]);
  }
  const entry: MetEntry = { nextRequestAt: 0, failures: 0, failed: false };
  metCache.set(key, entry);
  return entry;
}
// Fixed HTTPS origin, manual same-origin redirects only. Node fetch transparently decompresses gzip/deflate.
async function fetchMet(
  url: URL,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  now: number
): Promise<Response> {
  const signal = AbortSignal.timeout(6000);
  const visited = new Set<string>();
  for (let i = 0; i <= 3; i++) {
    if (visited.has(url.toString())) throw Error("redirect_loop");
    visited.add(url.toString());
    // Leave headroom below the provider's application-wide 20 requests/s ceiling; fail closed, no queued retry storms.
    metRequestStarts = metRequestStarts.filter(t => t > now - 1000);
    if (metRequestStarts.length >= 10) throw Error("local_rate_limit");
    metRequestStarts.push(now);
    const response = await fetcher(url, {
      headers,
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || i === 3) throw Error("invalid_redirect");
    const next = new URL(location, url);
    if (next.origin !== "https://api.met.no" || next.username || next.password)
      throw Error("invalid_redirect");
    url = next;
  }
  throw Error("redirect_limit");
}
function headerDate(header: string | null): number {
  const n = header ? Date.parse(header) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function retryAt(header: string | null, now: number): number {
  if (!header) return 0;
  if (/^\d+$/.test(header.trim())) {
    const n = Number(header);
    return Number.isSafeInteger(n) ? now + n * 1000 : 0;
  }
  return headerDate(header);
}
type WeatherInput = {
  projectId: number;
  configuration: SiteConfiguration;
  configurationVersion: number | null;
  credentialVersion: number | null;
  encryptedKey: string | null;
  now?: Date;
  fetcher?: typeof fetch;
};
async function queryMetWeather(
  input: WeatherInput,
  now: Date
): Promise<SiteWeather> {
  const met = input.configuration.weather.metNorway;
  if (
    !met?.termsAccepted ||
    !isValidSiteWeatherContact(met.contact) ||
    !input.configuration.location
  )
    return emptySiteWeather("not_configured", "met_norway");
  const url = new URL(
    "https://api.met.no/weatherapi/locationforecast/2.0/compact"
  );
  const coordinate = (n: number) => String(Math.trunc(n * 10000) / 10000);
  url.searchParams.set(
    "lat",
    coordinate(input.configuration.location.latitude)
  );
  url.searchParams.set(
    "lon",
    coordinate(input.configuration.location.longitude)
  );
  // URL-based raw cache intentionally spans projects and config revisions; per-project thresholds are applied at read time.
  const entry = reserveMetEntry(url.toString(), now.getTime());
  if (!entry) return emptySiteWeather("unavailable", "met_norway");
  if (entry.pending) await entry.pending;
  else if (
    entry.nextRequestAt <= now.getTime() &&
    metThrottleUntil <= now.getTime()
  ) {
    const run = async () => {
      entry.nextRequestAt = now.getTime() + MET_MIN_INTERVAL_MS;
      try {
        const headers: Record<string, string> = {
          "User-Agent": `https://yx.maomaoyx.com SiteOperations/1.0 ${met.contact}`,
          "Accept-Encoding": "gzip, deflate",
        };
        if (entry.lastModified)
          headers["If-Modified-Since"] = entry.lastModified;
        const response = await fetchMet(
          url,
          headers,
          input.fetcher ?? fetch,
          now.getTime()
        );
        entry.nextRequestAt = Math.max(
          entry.nextRequestAt,
          headerDate(response.headers.get("Expires"))
        );
        if (response.status === 429) {
          metThrottleUntil = Math.max(
            metThrottleUntil,
            retryAt(response.headers.get("Retry-After"), now.getTime()),
            entry.nextRequestAt
          );
          throw Error("throttled");
        }
        if (response.status === 304) {
          if (!entry.raw) throw Error("missing_cached_body");
        } else {
          if (!response.ok || response.status === 203)
            throw Error("provider_failure");
          const raw = await response.json();
          if (
            projectMetNorwayWeather(raw, input.configuration, now).status ===
            "unavailable"
          )
            throw Error("invalid_model");
          entry.raw = raw;
          const modified = response.headers.get("Last-Modified");
          entry.lastModified =
            modified &&
            headerDate(modified) <= now.getTime() &&
            headerDate(modified) > 0
              ? modified
              : undefined;
        }
        entry.fetchedAt = now.toISOString();
        entry.failed = false;
        entry.failures = 0;
      } catch {
        entry.failed = true;
        entry.failures++;
        entry.nextRequestAt = Math.max(
          entry.nextRequestAt,
          now.getTime() +
            Math.min(
              24 * 3600000,
              MET_MIN_INTERVAL_MS * 2 ** Math.min(entry.failures - 1, 3)
            )
        );
      }
    };
    const pending = run();
    entry.pending = pending;
    try {
      await pending;
    } finally {
      entry.pending = undefined;
    }
  }
  if (entry.failed || !entry.raw)
    return {
      ...emptySiteWeather("unavailable", "met_norway"),
      expiresAt: new Date(
        Math.max(entry.nextRequestAt, metThrottleUntil)
      ).toISOString(),
    };
  // Re-project the raw forecast on every read: cache age is not the valid time of the nearest forecast.
  const result = projectMetNorwayWeather(entry.raw, input.configuration, now);
  return {
    ...result,
    fetchedAt: entry.fetchedAt ?? null,
    expiresAt: new Date(entry.nextRequestAt).toISOString(),
  };
}
export async function querySiteWeather(
  input: WeatherInput
): Promise<SiteWeather> {
  const { configuration } = input,
    now = input.now ?? new Date();
  if (configuration.weather.provider === "disabled")
    return emptySiteWeather("disabled");
  if (configuration.weather.provider === "met_norway")
    return queryMetWeather(input, now);
  // Commercial authorization is independent of the free MET provider; never fall back to public Open-Meteo.
  if (!input.encryptedKey || !configuration.location)
    return emptySiteWeather("not_configured");
  const key = `open_meteo_commercial:${input.projectId}:${input.configurationVersion}:${input.credentialVersion}`;
  const entry = cache.get(key);
  if (entry && entry.expires > now.getTime()) {
    touch(cache, key, entry);
    return structuredClone(entry.value);
  }
  const pending = commercialPending.get(key);
  if (pending) return structuredClone(await pending);
  if (commercialPending.size >= MAX_CACHE_ENTRIES)
    return emptySiteWeather("unavailable");
  const run = async () => {
    let result: SiteWeather;
    try {
      const apiKey = decryptSecret(input.encryptedKey!);
      const url = new URL("https://customer-api.open-meteo.com/v1/forecast");
      const params = {
        apikey: apiKey,
        latitude: String(configuration.location!.latitude),
        longitude: String(configuration.location!.longitude),
        timezone: "Asia/Shanghai",
        wind_speed_unit: "kmh",
        forecast_days: "2",
        current:
          "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
        hourly:
          "temperature_2m,precipitation_probability,visibility,wind_speed_10m,precipitation",
        daily: "temperature_2m_max,temperature_2m_min",
      };
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const response = await (input.fetcher ?? fetch)(url, {
        redirect: "error",
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw Error("provider_failure");
      result = projectSiteWeather(await response.json(), configuration, now);
    } catch {
      result = emptySiteWeather("unavailable");
    }
    cache.delete(key);
    if (cache.size >= MAX_CACHE_ENTRIES)
      cache.delete(cache.keys().next().value!);
    cache.set(key, {
      expires:
        now.getTime() + (result.status === "unavailable" ? 15000 : CACHE_MS),
      value: result,
    });
    return structuredClone(result);
  };
  const promise = run();
  commercialPending.set(key, promise);
  try {
    return await promise;
  } finally {
    commercialPending.delete(key);
  }
}
export async function getSiteWeather(projectId: number) {
  const db = await requireSiteDb();
  await requireSiteProject(db, projectId);
  const [row, credential] = await Promise.all([
    readSiteSetting(db, siteConfigurationKey(projectId)),
    readSiteSetting(db, WEATHER_CREDENTIAL_KEY),
  ]);
  const configuration =
    row?.status === "published"
      ? parseSiteConfiguration(row.valueJson)
      : structuredClone(DEFAULT_SITE_CONFIGURATION);
  return querySiteWeather({
    projectId,
    configuration,
    configurationVersion: row?.version ?? null,
    credentialVersion: credential?.version ?? null,
    encryptedKey:
      credential?.status === "published" ? credential.secretEncrypted : null,
  });
}
