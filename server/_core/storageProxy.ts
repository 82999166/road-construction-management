import type { Express } from "express";
import { ENV } from "./env";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
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
