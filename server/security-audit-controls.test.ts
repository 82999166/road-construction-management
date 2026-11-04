import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const readProjectFile = (path: string) =>
  readFileSync(new URL(path, root), "utf8");

describe("敏感数据、证据留存与审计完整性控制", () => {
  it("为敏感访问、审计链和证据内容留存建立了持久化模型", () => {
    const schema = readProjectFile("drizzle/schema.ts");
    expect(schema).toContain('"sensitive_data_access_logs"');
    expect(schema).toContain('"audit_log_chain_state"');
    expect(schema).toContain('"audit_log_integrity_events"');
    expect(schema).toContain("contentSha256");
    expect(schema).toContain("deletionReason");
    expect(schema).toContain("checkInAddress");
    expect(schema).toContain("checkoutAddress");
  });

  it("现场证据由服务端计算哈希，默认隐藏原始坐标并执行有理由的软删除", () => {
    const source = readProjectFile("server/routers/evidence.ts");
    expect(source).toContain(
      'createHash("sha256").update(imageBytes).digest("hex")'
    );
    expect(source).toContain("locationProtection: row.longitude !== null");
    expect(source).toContain("deletionReason: z.string().trim().min(5");
    expect(source).toContain('status: "deleted"');
    expect(source).toContain("appendIntegrityProtectedAudit");
    expect(source).not.toContain("await db.delete(evidenceRecords)");
  });

  it("考勤列表只提供中文地址，原始坐标仅在有用途说明的争议核验接口中返回", () => {
    const source = readProjectFile("server/routers/labor.ts");
    expect(source).toContain("resolveAttendanceAddress");
    expect(source).toContain(
      "checkInAddress: attendanceCheckIns.checkInAddress"
    );
    expect(source).toContain(
      "checkoutAddress: attendanceCheckIns.checkoutAddress"
    );
    expect(source).toContain("getDisputeCoordinates");
    expect(source).toContain("purpose: z.string().trim().min(10");
    expect(source).toContain('dataCategory: "raw_location_coordinate"');
  });

  it("付款专用完整账号利用和审计链校验均有受控服务端入口", () => {
    const operations = readProjectFile("server/routers/operations.ts");
    const auditService = readProjectFile("server/services/auditIntegrity.ts");
    const admin = readProjectFile("server/routers/admin.ts");
    expect(operations).toContain("recordSensitiveDataAccess");
    expect(operations).toContain('dataCategory: "full_payment_account"');
    expect(auditService).toContain("appendIntegrityProtectedAudit");
    expect(auditService).toContain("sealUnchainedAuditLogs");
    expect(auditService).toContain("verifyAuditIntegrityChain");
    expect(admin).toContain("integrity: protectedProcedure.query");
    expect(admin).toContain("completeSeal");
    expect(admin).toContain("sensitiveAccesses: protectedProcedure");
  });

  it("审计链允许空库迁移后的创世锚点自愈，但拒绝非空链缺锚点写入", () => {
    const auditService = readProjectFile("server/services/auditIntegrity.ts");
    expect(auditService).toContain(
      'AUDIT_CHAIN_GENESIS_SEED = "audit-chain-v1:genesis:2026-08-21"'
    );
    expect(auditService).toContain("buildAuditChainGenesisHash");
    expect(auditService).toContain("existingEventCount");
    expect(auditService).toContain("existingEventCount > 0");
    expect(auditService).toContain(
      "tx.insert(auditLogChainState).values({ id: 1, lastSequence: 0, lastHash: buildAuditChainGenesisHash() })"
    );
  });

  it("采购、电子发票与劳务证照上传均保留服务端内容指纹、字节数和完整性审计", () => {
    const finance = readProjectFile("server/routers/finance.ts");
    const labor = readProjectFile("server/routers/labor.ts");
    expect(finance).toContain('sourceType: "purchase"');
    expect(finance).toContain('sourceType: "financial_invoice"');
    expect(finance).toMatch(/contentSha256,\s*contentBytes: bytes\.length/);
    expect(labor).toContain("sourceType: LABOR_CERTIFICATE_SOURCE_TYPE");
    expect(labor).toContain("contentSha256, contentBytes: bytes.length");
    expect(finance).toContain("appendIntegrityProtectedAudit(tx");
    expect(labor).toContain("appendIntegrityProtectedAudit(tx");
  });
});
