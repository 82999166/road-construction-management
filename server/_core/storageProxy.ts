import type { Express, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { ENV } from "./env";
import { isPrivateSiteVideoKey } from "../services/siteOperationsVideo";

export function isPrivateInsuranceStorageKey(key: string) {
  let decoded = key;
  for (let i = 0; i < 5; i++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    catch { return true; }
  }
  // OSS adds bucket/prefix segments; block the namespace anywhere, including
  // dot/backslash aliases, before any local read or managed-storage request.
  return /(?:^|\/)employee-insurance(?:-private)?(?:\/|$)/i.test(decoded.replace(/\\/g, "/"))
    || /(?:^|\/)employee-insurance(?:-private)?(?:\/|$)/i.test(path.posix.normalize(decoded.replace(/\\/g, "/")));
}

function normalizeStorageKey(key: string) {
  return key.replace(/^\/+/, "").replace(/\\/g, "/");
}

function resolveSelfHostStoragePath(key: string) {
  const root = path.resolve(ENV.selfHostStorageDir);
  const filePath = path.resolve(root, normalizeStorageKey(key));
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key path");
  }
  return filePath;
}

type StorageByteRange = { start: number; end: number };

function parseStorageRange(header: string | undefined, size: number): StorageByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error("invalid_range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error("invalid_range");
  return { start, end };
}

function sendStorageBuffer(res: Response, buffer: Buffer, contentType: string, rangeHeader: string | undefined) {
  res.set("Content-Type", contentType);
  res.set("Accept-Ranges", "bytes");
  try {
    const range = parseStorageRange(rangeHeader, buffer.length);
    if (!range) {
      res.set("Content-Length", String(buffer.length));
      res.send(buffer);
      return;
    }
    res.status(206).set({ "Content-Range": `bytes ${range.start}-${range.end}/${buffer.length}`, "Content-Length": String(range.end - range.start + 1) });
    res.send(buffer.subarray(range.start, range.end + 1));
  } catch {
    res.status(416).set("Content-Range", `bytes */${buffer.length}`).end();
  }
}

export function registerStorageProxy(app: Express) {
  /**
   * Express 5 要求通配符具名，且会将通配部分按路径段返回数组；重新拼回
   * 原始对象键后再进入既有的路径规范化与越界保护流程。
   */
  app.get("/manus-storage/*key", async (req, res) => {
    const capturedKey = (req.params as Record<string, string | string[]>).key;
    const key = Array.isArray(capturedKey) ? capturedKey.join("/") : capturedKey;
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (isPrivateInsuranceStorageKey(key) || isPrivateSiteVideoKey(key)) {
      res.set("Cache-Control", "no-store");
      res.status(403).send("Insurance originals require controlled preview");
      return;
    }

    if (ENV.selfHostStorageDir) {
      try {
        const filePath = resolveSelfHostStoragePath(key);
        const metaPath = `${filePath}.meta.json`;
        const [fileBuffer, metaRaw] = await Promise.all([
          fs.readFile(filePath),
          fs.readFile(metaPath, "utf8").catch(() => "{}"),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        res.set("Cache-Control", "private, max-age=300");
        sendStorageBuffer(res, fileBuffer, meta.contentType || "application/octet-stream", req.headers?.range);
        return;
      } catch (err) {
        if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
          console.error("[StorageProxy] self-host storage failed:", err);
          res.status(404).send("Storage object unavailable");
          return;
        }
        console.warn("[StorageProxy] self-host object missing; falling back to managed storage for existing key.");
      }
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      /**
       * 影像在微信内置浏览器等受限环境中可能无法跟随跨域 307 到对象存储域名，
       * 因而表现为数据库记录正常但 `<img>` 只显示 alt 文本。由本应用代理回传
       * 已签名对象字节，可保持图片请求始终位于应用的 HTTPS 域名内。
       */
      const objectResp = await fetch(url);
      if (!objectResp.ok) {
        console.error(`[StorageProxy] object error: ${objectResp.status}`);
        res.status(502).send("Storage object unavailable");
        return;
      }

      const contentType = objectResp.headers.get("content-type") || "application/octet-stream";
      const contentLength = objectResp.headers.get("content-length");
      res.set("Cache-Control", "private, max-age=300");
      const objectBuffer = Buffer.from(await objectResp.arrayBuffer());
      if (!req.headers?.range && contentLength) res.set("Content-Length", contentLength);
      sendStorageBuffer(res, objectBuffer, contentType, req.headers?.range);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
