import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isLargeTrpcBodyRequest } from "./_core/httpSecurity";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

describe("收方图片上传HTTP接线", () => {
  it("只有准确的专用上传RPC进入大正文解析，不给读取或保存入口扩权", () => {
    expect(isLargeTrpcBodyRequest({ path: "/measurement.uploadTakeoffAttachment" } as never)).toBe(true);
    for (const path of ["/measurement.uploadTakeoffAttachment.other", "/measurement.getTakeoffDetail", "/measurement.getTakeoffPrint", "/measurement.saveTakeoff", "/measurement.captureConfig"]) {
      expect(isLargeTrpcBodyRequest({ path } as never)).toBe(false);
    }
  });
  it("真实Express解析超过1MB的专用图片载荷，普通保存RPC仍拒绝同样正文", async () => {
    const app = express();
    const standardJsonParser = express.json({ limit: "1mb" });
    const evidenceJsonParser = express.json({ limit: "32mb" });
    app.use("/api/trpc", (req, res, next) => (isLargeTrpcBodyRequest(req) ? evidenceJsonParser(req, res, next) : standardJsonParser(req, res, next)));
    app.post("/api/trpc/:procedure", (req, res) => res.json({ parsedCharacters: req.body.json.base64Data.length }));
    app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ rejected: true }));
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP test port unavailable");
    const base = `http://127.0.0.1:${address.port}/api/trpc/`;
    const body = JSON.stringify({ json: { base64Data: "A".repeat(2 * 1024 * 1024) } });
    const upload = await fetch(base + "measurement.uploadTakeoffAttachment", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(upload.status).toBe(200);
    expect(await upload.json()).toEqual({ parsedCharacters: 2 * 1024 * 1024 });
    const ordinary = await fetch(base + "measurement.saveTakeoff", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(ordinary.status).toBe(413);
    expect(await ordinary.json()).toEqual({ rejected: true });
  });
});
