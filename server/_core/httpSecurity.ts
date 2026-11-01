import type { NextFunction, Request, Response } from "express";

const LARGE_TRPC_BODY_PROCEDURES = new Set([
  "evidence.upload",
  "finance.uploadInvoiceEvidence",
  "labor.uploadWorkerCertificate",
  "admin.employee.uploadInsurancePolicy",
  "settlementPayment.uploadProof",
]);

export function isLargeTrpcBodyRequest(req: Request) {
  const procedurePath = req.path.replace(/^\/+/, "");
  return procedurePath.split(",").some(procedure => LARGE_TRPC_BODY_PROCEDURES.has(procedure));
}

function trustedClientAddress(req: Request) {
  const peer = req.socket.remoteAddress ?? "unknown";
  const isLocalReverseProxy = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  if (!isLocalReverseProxy) return peer;
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() || peer : peer;
}

/**
 * 轻量应用层保护，用于单实例下阻止高频撞库或资源消耗；核心登录锁定仍由数据库持久化。
 * 环境扩容后可无缝改为 Redis 等共享存储，接口调用方无需改变。
 */
export function createMemoryRateLimiter(input: { windowMs: number; max: number; message: string }) {
  const requests = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = trustedClientAddress(req);
    const recent = (requests.get(key) ?? []).filter(time => now - time < input.windowMs);
    recent.push(now);
    requests.set(key, recent);
    if (recent.length > input.max) {
      res.status(429).json({ error: input.message });
      return;
    }
    next();
  };
}

export function applyBaselineSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // 业务需要后置相机和定位；显式拒绝无关的高风险浏览器能力。
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()");
  next();
}
