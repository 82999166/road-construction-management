// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import fs from "fs/promises";
import path from "path";
import { ENV } from "./_core/env";
import { getAliyunOssPhotoSignedUrl, isAliyunOssPhotoStorageKey, putAliyunOssPhoto } from "./services/aliyunOssPhotoStorage";

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "").replace(/\\/g, "/");
}

function hasSelfHostStorage() {
  return Boolean(ENV.selfHostStorageDir.trim());
}

function resolveSelfHostStoragePath(key: string) {
  const root = path.resolve(ENV.selfHostStorageDir);
  const filePath = path.resolve(root, key);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key path");
  }
  return filePath;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));

  // 仅 JPEG/PNG 等现场照片可按超级管理员已发布设置写入 OSS；业务文档、数据库备份
  // 和未完成配置的上传仍复用现有存储，避免改变其归档与恢复链路。
  if (contentType.startsWith("image/")) {
    try {
      return await putAliyunOssPhoto(key, data, contentType);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "阿里云 OSS 照片存储未完整启用") throw error;
    }
  }

  if (hasSelfHostStorage()) {
    const filePath = resolveSelfHostStoragePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, typeof data === "string" ? Buffer.from(data) : Buffer.from(data));
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType, key, storedAt: new Date().toISOString() }));
    return { key, url: `/manus-storage/${key}` };
  }

  const { forgeUrl, forgeKey } = getForgeConfig();

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  if (isAliyunOssPhotoStorageKey(key)) return { key, url: await getAliyunOssPhotoSignedUrl(key) };
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  if (isAliyunOssPhotoStorageKey(relKey)) return getAliyunOssPhotoSignedUrl(relKey);
  if (hasSelfHostStorage()) {
    return `/manus-storage/${normalizeKey(relKey)}`;
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}
