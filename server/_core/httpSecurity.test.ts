import { describe, expect, it, vi } from "vitest";
import { applyBaselineSecurityHeaders, createMemoryRateLimiter, isLargeTrpcBodyRequest } from "./httpSecurity";

function request(path: string, address = "203.0.113.8") {
  return { path, socket: { remoteAddress: address }, headers: {} } as never;
}

describe("HTTP 安全边界", () => {
  it("仅允许明确影像写入接口使用大请求体解析器", () => {
    expect(isLargeTrpcBodyRequest(request("/evidence.upload"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/finance.uploadInvoiceEvidence"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/admin.employee.uploadInsurancePolicy"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/settlementPayment.uploadProof"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/personnel.uploadDocument"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/personnel.uploadDocument.other"))).toBe(false);
    expect(isLargeTrpcBodyRequest(request("/personnel.save"))).toBe(false);
    expect(isLargeTrpcBodyRequest(request("/vehicleManagement.uploadDocument"))).toBe(true);
    expect(isLargeTrpcBodyRequest(request("/vehicleManagement.uploadDocument.other"))).toBe(false);
    expect(isLargeTrpcBodyRequest(request("/vehicleManagement.saveProfile"))).toBe(false);
    expect(isLargeTrpcBodyRequest(request("/operations.recordTransportCardEvent"))).toBe(false);
  });

  it("基础安全响应头不影响相机和定位，但拒绝无关敏感能力", () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    applyBaselineSecurityHeaders(request("/"), { setHeader } as never, next);
    expect(setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "SAMEORIGIN");
    expect(setHeader).toHaveBeenCalledWith("Permissions-Policy", expect.stringContaining("camera=(self)"));
    expect(next).toHaveBeenCalledOnce();
  });

  it("超过窗口阈值会阻止同一来源继续请求", () => {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 2, message: "过于频繁" });
    const next = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const response = { status, json } as never;
    limiter(request("/api/trpc/auth.localAdminLogin"), response, next);
    limiter(request("/api/trpc/auth.localAdminLogin"), response, next);
    limiter(request("/api/trpc/auth.localAdminLogin"), response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({ error: "过于频繁" });
  });
});
