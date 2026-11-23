import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { systemSettings, configPublishLogs, auditLogs, projects, evidenceRecords } from "../../drizzle/schema";
import { DEFAULT_SITE_CONFIGURATION, siteConfigurationSchema, type SiteConfiguration, type SiteConfigurationResult, type SiteVideo, SITE_SAMPLE_METADATA } from "../../shared/siteOperations";
import { getDb } from "../db";
import { encryptSecret } from "./secretVault";

export const SITE_SETTING_PREFIX = "SITE_OPERATIONS_";
export const WEATHER_CREDENTIAL_KEY = `${SITE_SETTING_PREFIX}WEATHER_CREDENTIAL`;
export const siteConfigurationKey = (projectId: number) => `${SITE_SETTING_PREFIX}PROJECT_${projectId}`;
export const isSiteOperationsSetting = (key: string) => key.toUpperCase().startsWith(SITE_SETTING_PREFIX);
export async function requireSiteDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  return db;
}
type Database = Awaited<ReturnType<typeof requireSiteDb>>;
type Executor = Pick<Database, "select" | "insert" | "update">;
export async function requireSiteProject(db: Executor, projectId: number) {
  const [p] = await db.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  return p;
}
export async function readSiteSetting(db: Executor, settingKey: string) {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, settingKey)).limit(1);
  return row;
}
export function parseSiteConfiguration(value: string | null): SiteConfiguration {
  try { return siteConfigurationSchema.parse(JSON.parse(value ?? "null")); }
  catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "现场大屏配置无效，请管理员修正" }); }
}
export function assertSiteVersion(existing: { version: number } | undefined, expectedVersion?: number) {
  if (existing ? expectedVersion !== existing.version : expectedVersion !== undefined)
    throw new TRPCError({ code: "CONFLICT", message: "配置版本已变化或未提供版本，请刷新后保存" });
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0|10|20):/i.test(address);
}
export async function assertPublicVideoUrl(url: string) {
  // Schema rejects IP literals, userinfo, aliases and non-HTTPS before DNS resolution.
  const parsed = siteConfigurationSchema.shape.videos.element.safeParse({ id: "validate", name: "validate", pointLabel: "validate", kind: "recorded", url, recordedAt: null, enabled: true, sortOrder: 0, default: false });
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "视频地址必须为公开 HTTPS 域名" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([lookup(new URL(url).hostname, { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 1500); })]);
    if (!records.length || records.some(r => !isPublicAddress(r.address))) throw Error("private");
  } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "视频域名无法验证为公开网络地址" }); }
  finally { if (timer) clearTimeout(timer); }
}
export async function requireSiteVideoReference(db: Executor, projectId: number, id: number) {
  const [record] = await db.select({ id: evidenceRecords.id, projectId: evidenceRecords.projectId, fileKey: evidenceRecords.fileKey, mimeType: evidenceRecords.mimeType, contentBytes: evidenceRecords.contentBytes, contentSha256: evidenceRecords.contentSha256 })
    .from(evidenceRecords).where(and(eq(evidenceRecords.id, id), eq(evidenceRecords.projectId, projectId), eq(evidenceRecords.sourceType, "site_operations_video"), eq(evidenceRecords.status, "active"))).limit(1);
  if (!record || !record.fileKey.startsWith(`site-operations-private/${projectId}/`) || !["video/mp4", "video/webm"].includes(record.mimeType ?? "") || !record.contentBytes || record.contentBytes > 16 * 1024 * 1024)
    throw new TRPCError({ code: "FORBIDDEN", message: "视频引用不属于该项目的受控附件" });
  return record;
}
async function writePublishedSetting(tx: Executor, input: { key: string; value: string | null; encrypted: string | null; sensitive: boolean; expectedVersion?: number; actorId: number }) {
  const existing = await readSiteSetting(tx, input.key);
  assertSiteVersion(existing, input.expectedVersion);
  const version = (existing?.version ?? 0) + 1;
  const values = { category: "现场运行大屏", displayName: input.sensitive ? "现场天气商业凭据" : "现场项目配置", valueJson: input.value, secretEncrypted: input.encrypted, isSensitive: input.sensitive, valuePreview: input.sensitive ? (input.encrypted ? "[已配置]" : "[未配置]") : "[专用配置]", status: "published" as const, version, publishedAt: new Date(), updatedBy: input.actorId };
  let id: number;
  if (existing) {
    const result = await tx.update(systemSettings).set(values).where(and(eq(systemSettings.id, existing.id), eq(systemSettings.version, existing.version)));
    if (Number((result[0] as { affectedRows?: number }).affectedRows) !== 1) throw new TRPCError({ code: "CONFLICT", message: "配置被并发修改，请刷新" });
    id = existing.id;
  } else {
    try { const result = await tx.insert(systemSettings).values({ settingKey: input.key, ...values }); id = Number(result[0].insertId); }
    catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if ([e.code, e.cause?.code].includes("ER_DUP_ENTRY")) throw new TRPCError({ code: "CONFLICT", message: "配置已被其他管理员创建，请刷新" });
      throw error;
    }
  }
  // Secrets never enter snapshots or audit, including ciphertext. Non-secret prior config stays recoverable internally.
  const before = input.sensitive ? { version: existing?.version ?? null, keyConfigured: Boolean(existing?.secretEncrypted) } : { version: existing?.version ?? null, configuration: existing?.valueJson ? parseSiteConfiguration(existing.valueJson) : null };
  const after = input.sensitive ? { version, keyConfigured: Boolean(input.encrypted) } : { version, configuration: parseSiteConfiguration(input.value) };
  await tx.insert(configPublishLogs).values({ settingId: id, operation: "publish", version, operatorId: input.actorId, snapshotJson: JSON.stringify(before) });
  await tx.insert(auditLogs).values({ userId: input.actorId, module: "siteOperations", action: input.sensitive ? "save_weather_credential" : "save_configuration", targetType: "setting", targetId: input.key, summary: input.sensitive ? "发布天气凭据状态；不记录密钥" : "发布现场运行大屏项目配置", beforeJson: JSON.stringify(input.sensitive ? before : { version: existing?.version ?? null }), afterJson: JSON.stringify(input.sensitive ? after : { version }) });
  return version;
}
export async function saveSiteConfiguration(actorId: number, input: { projectId: number; expectedVersion?: number; configuration: SiteConfiguration }) {
  const db = await requireSiteDb();
  const configuration = siteConfigurationSchema.parse(input.configuration);
  await requireSiteProject(db, input.projectId);
  for (const video of configuration.videos) if (video.url) await assertPublicVideoUrl(video.url);
  return db.transaction(async tx => {
    await requireSiteProject(tx, input.projectId);
    for (const video of configuration.videos) if (video.storageReference) await requireSiteVideoReference(tx, input.projectId, video.storageReference);
    const version = await writePublishedSetting(tx, { key: siteConfigurationKey(input.projectId), value: JSON.stringify(configuration), encrypted: null, sensitive: false, expectedVersion: input.expectedVersion, actorId });
    return { success: true as const, version };
  });
}
export async function saveSiteWeatherCredential(actorId: number, input: { apiKey?: string; clear?: boolean; expectedVersion?: number }) {
  const db = await requireSiteDb();
  return db.transaction(async tx => {
    const existing = await readSiteSetting(tx, WEATHER_CREDENTIAL_KEY);
    assertSiteVersion(existing, input.expectedVersion);
    // Omitted key preserves, explicit clear deletes; an empty string is rejected by input schema.
    if (!input.apiKey && !input.clear) return { success: true as const, version: existing?.version ?? null, keyConfigured: Boolean(existing?.secretEncrypted) };
    const encrypted = input.clear ? null : encryptSecret(input.apiKey!);
    const version = await writePublishedSetting(tx, { key: WEATHER_CREDENTIAL_KEY, value: null, encrypted, sensitive: true, expectedVersion: input.expectedVersion, actorId });
    return { success: true as const, version, keyConfigured: Boolean(encrypted) };
  });
}
export async function getSiteWeatherCredential() {
  const db = await requireSiteDb(), row = await readSiteSetting(db, WEATHER_CREDENTIAL_KEY);
  return { version: row?.version ?? null, keyConfigured: Boolean(row?.status === "published" && row.secretEncrypted) };
}
export async function getSiteConfiguration(projectId: number): Promise<SiteConfigurationResult> {
  const db = await requireSiteDb(); await requireSiteProject(db, projectId);
  const row = await readSiteSetting(db, siteConfigurationKey(projectId));
  const configuration = row ? parseSiteConfiguration(row.valueJson) : structuredClone(DEFAULT_SITE_CONFIGURATION);
  const videos: SiteConfigurationResult["videos"] = await Promise.all(configuration.videos.map(async (video: SiteVideo) => {
    try {
      if (video.storageReference) await requireSiteVideoReference(db, projectId, video.storageReference);
      else if (video.url) await assertPublicVideoUrl(video.url);
      return { ...video, playbackUrl: video.storageReference ? `/api/site-operations/videos/${projectId}/${video.storageReference}` : video.sampleAsset ? "/manus-storage/excavator-sample_f339c2da.mp4" : video.url!, playbackStatus: "ready" as const, attribution: video.sampleAsset ? SITE_SAMPLE_METADATA : null };
    } catch { return { ...video, playbackUrl: null, playbackStatus: "unavailable" as const, attribution: video.sampleAsset ? SITE_SAMPLE_METADATA : null }; }
  }));
  return { projectId, version: row?.version ?? null, configuration, updatedAt: row?.updatedAt.toISOString() ?? null, videoStatus: videos.some(v => v.enabled) ? "recorded_or_sample" : "not_configured", videos, weatherCredential: await getSiteWeatherCredential() };
}
