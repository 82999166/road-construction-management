import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const financeSource = readFileSync(new URL("./routers/finance.ts", import.meta.url), "utf8");
const evidenceSource = readFileSync(new URL("./routers/evidence.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");

describe("库存流水凭证安全契约", () => {
  it("库存输入、存储和列表均受控支持凭证关联", () => {
    expect(financeSource).toContain("evidenceId: z.number().int().positive().nullable().optional()");
    expect(financeSource).toContain("入库凭证不存在、已失效或不属于当前项目，请重新上传或选择");
    expect(financeSource).toContain("evidence.sourceType !== \"purchase\"");
    expect(financeSource).toContain("evidence.status !== \"active\"");
    expect(financeSource).toContain("evidenceId: input.evidenceId ?? null");
    expect(financeSource).toContain("url: await storageGetSignedUrl(evidence.fileKey)");
    expect(schemaSource).toContain('evidenceId: bigint("evidenceId", { mode: "number" })');
    expect(schemaSource).toContain('inventory_transactions_evidence_index');
  });

  it("已关联到库存流水的凭证不能通过取证删除接口移除", () => {
    expect(evidenceSource).toContain("inventoryTransactions");
    expect(evidenceSource).toContain("eq(inventoryTransactions.evidenceId, evidence.id)");
  });
});

describe("施工日报照片授权契约", () => {
  it("施工岗位在其施工项目范围内可上传日报 site_photo，但不扩大其他通用取证权限", () => {
    expect(evidenceSource).toContain("assertConstructionSitePhotoAccess");
    expect(evidenceSource).toContain('if (sourceType !== "site_photo") throw error;');
    expect(evidenceSource).toContain('assertDepartmentBusinessAccess(ctx, "CONSTRUCTION")');
    expect(evidenceSource).toContain("当前岗位未获施工日报现场照片上传授权");
  });
});
