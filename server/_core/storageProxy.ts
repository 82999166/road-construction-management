import type { Express } from "express";
import fs from "fs/promises";
import path from "path";
import { ENV } from "./env";

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
        res.set("Content-Type", meta.contentType || "application/octet-stream");
        res.send(fileBuffer);
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
      res.set("Content-Type", contentType);
      if (contentLength) res.set("Content-Length", contentLength);
      res.send(Buffer.from(await objectResp.arrayBuffer()));
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
