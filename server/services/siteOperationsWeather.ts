import type { SiteConfiguration, SiteWeather } from "../../shared/siteOperations";
import { DEFAULT_SITE_CONFIGURATION } from "../../shared/siteOperations";
import { parseSiteConfiguration, readSiteSetting, requireSiteDb, requireSiteProject, siteConfigurationKey, WEATHER_CREDENTIAL_KEY } from "./siteOperationsConfiguration";
import { decryptSecret } from "./secretVault";
import { chinaBusinessDate } from "./chinaBusinessTime";
const CACHE_MS = 180000;
const cache = new Map<string, { expires: number; value: SiteWeather }>();
export function clearSiteWeatherCache() { cache.clear(); }
export function emptySiteWeather(status: SiteWeather["status"]): SiteWeather {
  return { status, source: "open_meteo_commercial", sourceKind: "model", timezone: "Asia/Shanghai", fetchedAt: null, updatedAt: null, expiresAt: null, stale: false, officialAlerts: { status: "not_connected" }, units: { temperature: "°C", wind: "km/h", precipitation: "mm", probability: "%", visibility: "m" }, current: null, hourly: [], daily: null, workHints: [] };
}
function value(n: unknown): number | null { return typeof n === "number" && Number.isFinite(n) ? n : null; }
function modelTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) return null;
  const time = new Date(`${value}+08:00`);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}
export function projectSiteWeather(raw: unknown, configuration: SiteConfiguration, now: Date): SiteWeather {
  const r = raw as { current?: Record<string, unknown>; hourly?: Record<string, unknown>; daily?: Record<string, unknown>; utc_offset_seconds?: number };
  const current = r?.current, time = modelTime(current?.time);
  if (!current || !time || r.utc_offset_seconds !== 28800) return emptySiteWeather("unavailable");
  const currentData: NonNullable<SiteWeather["current"]> = { time, temperatureC: value(current.temperature_2m), apparentTemperatureC: value(current.apparent_temperature), humidityPercent: value(current.relative_humidity_2m), weatherCode: value(current.weather_code), windKmh: value(current.wind_speed_10m), windDirectionDegrees: value(current.wind_direction_10m), gustKmh: value(current.wind_gusts_10m), precipitationMm: value(current.precipitation) };
  if (Object.entries(currentData).filter(([k]) => k !== "time").every(([,v]) => v === null)) return emptySiteWeather("unavailable");
  const hourly: SiteWeather["hourly"] = [];
  const ht = Array.isArray(r.hourly?.time) ? r.hourly!.time : [];
  const at = (key: string, index: number) => value(Array.isArray(r.hourly?.[key]) ? (r.hourly![key] as unknown[])[index] : null);
  for (let i = 0; i < ht.length && hourly.length < 12; i++) {
    const hour = modelTime(ht[i]);
    if (!hour || new Date(hour).getTime() < now.getTime() - 3600000) continue;
    hourly.push({ time: hour, temperatureC: at("temperature_2m", i), precipitationProbability: at("precipitation_probability", i), visibilityMeters: at("visibility", i), windKmh: at("wind_speed_10m", i), precipitationMm: at("precipitation", i) });
  }
  const today = chinaBusinessDate(now);
  const dailyTime = Array.isArray(r.daily?.time) ? r.daily!.time : [], index = dailyTime.indexOf(today);
  const daily = index < 0 ? null : { date: today, maximumC: value(Array.isArray(r.daily?.temperature_2m_max) ? r.daily!.temperature_2m_max[index] : null), minimumC: value(Array.isArray(r.daily?.temperature_2m_min) ? r.daily!.temperature_2m_min[index] : null) };
  const age = now.getTime() - new Date(time).getTime(), stale = age > 3600000 || age < -900000;
  const threshold = configuration.weather.thresholds, workHints: SiteWeather["workHints"] = [];
  const hint = (code: string, label: string) => workHints.push({ code, label, source: "system_work_hint" });
  if (!stale) {
    if ((currentData.windKmh ?? -1) >= threshold.windKmh || (currentData.gustKmh ?? -1) >= threshold.gustKmh) hint("wind", "模型风速达到项目提示阈值，关注露天作业；由现场负责人按制度判断。");
    if ((currentData.precipitationMm ?? -1) >= threshold.precipitationMm) hint("rain", "模型降水达到提示阈值，注意道路湿滑与排水。");
    if (hourly.some(h => h.visibilityMeters !== null && h.visibilityMeters < threshold.visibilityMeters)) hint("visibility", "预报能见度低于项目提示阈值，关注交通与现场照明。");
    if (currentData.temperatureC !== null && currentData.temperatureC >= threshold.heatC) hint("heat", "模型气温达到高温提示阈值，注意防暑与轮换作业。");
    if (currentData.temperatureC !== null && currentData.temperatureC <= threshold.coldC) hint("cold", "模型气温达到低温提示阈值，注意低温防护。");
  }
  return { ...emptySiteWeather(stale ? "stale" : "ready"), fetchedAt: now.toISOString(), updatedAt: time, expiresAt: new Date(now.getTime() + CACHE_MS).toISOString(), stale, current: currentData, hourly, daily, workHints };
}
export async function querySiteWeather(input: { projectId: number; configuration: SiteConfiguration; configurationVersion: number | null; credentialVersion: number | null; encryptedKey: string | null; now?: Date; fetcher?: typeof fetch }): Promise<SiteWeather> {
  const { configuration } = input, now = input.now ?? new Date();
  // No commercial authorization => never call the free/public endpoint.
  if (!input.encryptedKey || !configuration.location) return emptySiteWeather("not_configured");
  if (configuration.weather.provider === "disabled") return emptySiteWeather("disabled");
  const key = `${input.projectId}:${input.configurationVersion}:${input.credentialVersion}`;
  const entry = cache.get(key);
  if (entry && entry.expires > now.getTime()) return structuredClone(entry.value);
  try {
    const apiKey = decryptSecret(input.encryptedKey);
    const url = new URL("https://customer-api.open-meteo.com/v1/forecast");
    const params = { apikey: apiKey, latitude: String(configuration.location.latitude), longitude: String(configuration.location.longitude), timezone: "Asia/Shanghai", wind_speed_unit: "kmh", forecast_days: "2", current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation", hourly: "temperature_2m,precipitation_probability,visibility,wind_speed_10m,precipitation", daily: "temperature_2m_max,temperature_2m_min" };
    for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    const response = await (input.fetcher ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw Error("provider_failure");
    const result = projectSiteWeather(await response.json(), configuration, now);
    if (cache.size > 250) cache.clear();
    cache.set(key, { expires: now.getTime() + (result.status === "unavailable" ? 15000 : CACHE_MS), value: result });
    return result;
  } catch {
    const result = emptySiteWeather("unavailable");
    cache.set(key, { expires: now.getTime() + 15000, value: result });
    return result;
  }
}
export async function getSiteWeather(projectId: number) {
  const db = await requireSiteDb(); await requireSiteProject(db, projectId);
  const [row, credential] = await Promise.all([readSiteSetting(db, siteConfigurationKey(projectId)), readSiteSetting(db, WEATHER_CREDENTIAL_KEY)]);
  const configuration = row?.status === "published" ? parseSiteConfiguration(row.valueJson) : structuredClone(DEFAULT_SITE_CONFIGURATION);
  return querySiteWeather({ projectId, configuration, configurationVersion: row?.version ?? null, credentialVersion: credential?.version ?? null, encryptedKey: credential?.status === "published" ? credential.secretEncrypted : null });
}
