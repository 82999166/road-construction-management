import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerIdentityRecoveryRoute } from "../identityRecovery";
import { registerOfficialAccountBindingRoutes } from "../officialAccountBinding";
import { registerDailyProjectDigestHeartbeatRoute } from "../dailyProjectDigestHeartbeat";
import { registerPayrollGenerationHeartbeatRoute } from "../payrollGenerationHeartbeat";
import { registerProjectRiskHeartbeatRoute } from "../projectRiskHeartbeat";
import { registerLocalRfidBridgeRoutes } from "../localRfidBridge";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { applyBaselineSecurityHeaders, createMemoryRateLimiter, isLargeTrpcBodyRequest } from "./httpSecurity";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use(applyBaselineSecurityHeaders);
  app.use("/api/official-account/messages", express.raw({ type: ["text/xml", "application/xml", "*/xml"], limit: "256kb" }));
  // 证据影像通过少数明确的 tRPC 写入接口上传；普通 API 不再继承 50MB 的全局正文上限。
  const standardJsonParser = express.json({ limit: "1mb" });
  const evidenceJsonParser = express.json({ limit: "32mb" });
  app.use("/api/trpc", (req, res, next) => (isLargeTrpcBodyRequest(req) ? evidenceJsonParser(req, res, next) : standardJsonParser(req, res, next)));
  // 本机 RFID 桥接仅接收极小的令牌、UID 指纹与摘要 JSON，不继承全局大正文能力。
  app.use("/api/local-rfid-bridge", standardJsonParser);
  app.use(express.urlencoded({ limit: "256kb", extended: false }));
  registerStorageProxy(app);
  registerIdentityRecoveryRoute(app);
  registerOAuthRoutes(app);
  registerOfficialAccountBindingRoutes(app);
  registerDailyProjectDigestHeartbeatRoute(app);
  registerPayrollGenerationHeartbeatRoute(app);
  registerProjectRiskHeartbeatRoute(app);
  registerLocalRfidBridgeRoutes(app);
  /**
   * 供本机 systemd 与正式发布脚本使用的无鉴权存活探针。
   * 必须在 SPA 静态回退之前注册，避免任意路径返回 index.html 被误判为健康。
   */
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, service: "yx-cloud-management" });
  });
  // 微信服务号网页授权域名校验文件必须在 SPA 静态回退之前从根路径返回。
  app.get("/MP_verify_amDyVeLccZJcmzJL.txt", (_req, res) => {
    res.type("text/plain").send("amDyVeLccZJcmzJL");
  });
  app.get("/MP_verify_ovXYyaGy5gpoUjxo.txt", (_req, res) => {
    res.type("text/plain").send("ovXYyaGy5gpoUjxo");
  });
  // tRPC API
  app.use("/api/trpc/auth.localAdminLogin", createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: "登录请求过于频繁，请稍后再试" }));
  app.use("/api/trpc/auth.localManagerLogin", createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 15, message: "登录请求过于频繁，请稍后再试" }));
  app.use("/api/trpc", createMemoryRateLimiter({ windowMs: 60 * 1000, max: 360, message: "请求过于频繁，请稍后再试" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
