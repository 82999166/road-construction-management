import OSS from "ali-oss";
import { and, eq, inArray } from "drizzle-orm";
import { isIP } from "node:net";
import { systemSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

export const ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS = {
  enabled: "ALIYUN_OSS_PHOTO_STORAGE_ENABLED",
  region: "ALIYUN_OSS_PHOTO_STORAGE_REGION",
  endpoint: "ALIYUN_OSS_PHOTO_STORAGE_ENDPOINT",
  bucket: "ALIYUN_OSS_PHOTO_STORAGE_BUCKET",
  objectPrefix: "ALIYUN_OSS_PHOTO_STORAGE_PREFIX",
  accessKeyId: "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_ID",
  accessKeySecret: "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_SECRET",
} as const;

const ALIYUN_OSS_PHOTO_KEY_PREFIX = "aliyun-oss/";
const PREVIEW_EXPIRES_SECONDS = 15 * 60;

export type AliyunOssPhotoStorageConfiguration = {
  enabled: boolean;
  region: string;
  endpoint: string;
  bucket: string;
  objectPrefix: string;
  accessKeyId: string;
  accessKeySecret: string;
};

function isBlockedIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
}

/** OSS Endpoint 仅允许公开 HTTPS 地址，避免系统设置被滥用为内网请求通道。 */
export function normalizeAliyunOssEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("OSS Endpoint 地址格式无效");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "::1" || isIP(hostname) === 6 || isBlockedIpv4(hostname)) {
    throw new Error("OSS Endpoint 必须为公开 HTTPS 地址，不能使用本机、内网或带路径参数的地址");
  }
  return url.origin;
}

export function normalizeAliyunOssRegion(value: string) {
  const region = value.trim().toLowerCase();
  if (!/^oss-[a-z0-9-]{3,64}$/.test(region)) throw new Error("OSS 地域格式无效，例如 oss-cn-hangzhou");
  return region;
}

export function normalizeAliyunOssBucket(value: string) {
  const bucket = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("OSS Bucket 名称格式无效");
  return bucket;
}

export function normalizeAliyunOssObjectPrefix(value: string) {
  const prefix = value.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) return "photos";
  if (!/^[A-Za-z0-9/_-]{1,128}$/.test(prefix) || prefix.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("OSS 对象前缀仅支持字母、数字、下划线、连字符和单层目录分隔符");
  }
  return prefix;
}

function createClient(configuration: AliyunOssPhotoStorageConfiguration) {
  return new OSS({
    region: configuration.region,
    endpoint: configuration.endpoint,
    bucket: configuration.bucket,
    accessKeyId: configuration.accessKeyId,
    accessKeySecret: configuration.accessKeySecret,
    authorizationV4: true,
    secure: true,
    timeout: 10_000,
  });
}

function normalizeObjectName(key: string) {
  const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..") || !/^[A-Za-z0-9._()\-\u4e00-\u9fa5/]+$/.test(normalized)) throw new Error("照片对象键无效");
  return normalized;
}

function getObjectName(configuration: AliyunOssPhotoStorageConfiguration, key: string) {
  return `${configuration.objectPrefix}/${normalizeObjectName(key)}`;
}

/** 只有带本模块前缀的文件键才从阿里云 OSS 读取，避免影响既有附件和备份。 */
export function isAliyunOssPhotoStorageKey(key: string) {
  return key.startsWith(ALIYUN_OSS_PHOTO_KEY_PREFIX);
}

/** 读取已发布的加密配置；密钥只在此服务端函数解密，绝不返回给路由或前端。 */
export async function getPublishedAliyunOssPhotoStorageConfiguration(): Promise<AliyunOssPhotoStorageConfiguration | null> {
  const db = await getDb();
  if (!db) return null;
  const keys = Object.values(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS);
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.status, "published"), inArray(systemSettings.settingKey, keys)));
  const byKey = new Map(rows.map(row => [row.settingKey, row]));
  const enabled = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.enabled)?.valueJson === "true";
  const region = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.region)?.valueJson;
  const endpoint = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.endpoint)?.valueJson;
  const bucket = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.bucket)?.valueJson;
  const objectPrefix = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.objectPrefix)?.valueJson;
  const encryptedAccessKeyId = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.accessKeyId)?.secretEncrypted;
  const encryptedAccessKeySecret = byKey.get(ALIYUN_OSS_PHOTO_STORAGE_SETTING_KEYS.accessKeySecret)?.secretEncrypted;
  if (!region || !endpoint || !bucket || !objectPrefix || !encryptedAccessKeyId || !encryptedAccessKeySecret) return null;
  try {
    return {
      enabled,
      region: normalizeAliyunOssRegion(region),
      endpoint: normalizeAliyunOssEndpoint(endpoint),
      bucket: normalizeAliyunOssBucket(bucket),
      objectPrefix: normalizeAliyunOssObjectPrefix(objectPrefix),
      accessKeyId: decryptSecret(encryptedAccessKeyId),
      accessKeySecret: decryptSecret(encryptedAccessKeySecret),
    };
  } catch {
    return null;
  }
}

export async function putAliyunOssPhoto(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<{ key: string; url: string }> {
  const configuration = await getPublishedAliyunOssPhotoStorageConfiguration();
  if (!configuration?.enabled) throw new Error("阿里云 OSS 照片存储未完整启用");
  const objectName = getObjectName(configuration, key);
  try {
    const client = createClient(configuration);
    await client.put(objectName, data, { headers: { "Content-Type": contentType } });
    const url = await client.signatureUrlV4("GET", PREVIEW_EXPIRES_SECONDS, { headers: {} }, objectName);
    return { key: `${ALIYUN_OSS_PHOTO_KEY_PREFIX}${objectName}`, url };
  } catch {
    throw new Error("阿里云 OSS 照片存储失败，请核对系统设置、RAM 权限和 Bucket 网络策略");
  }
}

export async function getAliyunOssPhotoSignedUrl(key: string): Promise<string> {
  const objectName = normalizeObjectName(key.slice(ALIYUN_OSS_PHOTO_KEY_PREFIX.length));
  const configuration = await getPublishedAliyunOssPhotoStorageConfiguration();
  if (!configuration) throw new Error("阿里云 OSS 历史照片配置不可用，请先恢复对应配置");
  try {
    return await createClient(configuration).signatureUrlV4("GET", PREVIEW_EXPIRES_SECONDS, { headers: {} }, objectName);
  } catch {
    throw new Error("阿里云 OSS 照片预览链接生成失败，请核对密钥和 Bucket 读取权限");
  }
}
