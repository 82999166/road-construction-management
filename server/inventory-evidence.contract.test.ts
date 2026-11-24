import { getTableName } from "drizzle-orm";
import { EVIDENCE_REFERENCE_REGISTRY } from "./services/evidenceIntegrity";
import { inventoryTransactions } from "../drizzle/schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const financeSource = readFileSync(
  new URL("./routers/finance.ts", import.meta.url),
  "utf8"
);
const evidenceSource = readFileSync(
  new URL("./routers/evidence.ts", import.meta.url),
  "utf8"
);
const schemaSource = readFileSync(
  new URL("../drizzle/schema.ts", import.meta.url),
  "utf8"
);

describe("库存流水凭证安全契约", () => {
  it("库存输入、存储和列表均受控支持凭证关联", () => {
    expect(financeSource).toContain(
      "evidenceId: z.number().int().positive().nullable().optional()"
    );
    expect(financeSource).toContain(
      "入库凭证不存在、已失效或不属于当前项目，请重新上传或选择"
    );
    expect(financeSource).toContain('evidence.sourceType !== "purchase"');
    expect(financeSource).toContain('evidence.status !== "active"');
    expect(financeSource).toContain("evidenceId: input.evidenceId ?? null");
    expect(financeSource).toContain(
      "url: await storageGetSignedUrl(evidence.fileKey)"
    );
    const inventoryProcedure = financeSource.slice(
      financeSource.indexOf("  saveInventoryTransaction:"),
      financeSource.indexOf("/** 工程计量主张")
    );
    expect(inventoryProcedure).toContain(
      "eq(evidenceRecords.projectId, input.projectId)"
    );
    expect(inventoryProcedure).toContain(
      'eq(evidenceRecords.sourceType, "purchase")'
    );
    expect(inventoryProcedure).toContain(
      'eq(evidenceRecords.status, "active")'
    );
    expect(schemaSource).toContain(
      'evidenceId: bigint("evidenceId", { mode: "number" })'
    );
    expect(schemaSource).toContain("inventory_transactions_evidence_index");
  });

  it("已关联到库存流水的凭证不能通过取证删除接口移除", () => {
    const entry = EVIDENCE_REFERENCE_REGISTRY.find(item => item.table === inventoryTransactions);
    expect(entry).toBeDefined();
    expect(getTableName(entry!.table)).toBe("inventory_transactions");
    expect(entry!.direct).toContainEqual(["evidenceId", inventoryTransactions.evidenceId]);
    expect(entry!.sensitive).toBe(false); // 通用库存引用仍阻断删除，不误归专用财务附件
    expect(evidenceSource).toContain("collectEvidenceReferences");
  });
});

describe("施工日报照片授权契约", () => {
  it("施工岗位在其施工项目范围内可上传日报 site_photo，但不扩大其他通用取证权限", () => {
    expect(evidenceSource).toContain("assertConstructionSitePhotoAccess");
    expect(evidenceSource).toContain(
      'if (sourceType !== "site_photo") throw error;'
    );
    expect(evidenceSource).toContain(
      'assertDepartmentBusinessAccess(ctx, "CONSTRUCTION")'
    );
    expect(evidenceSource).toContain("当前岗位未获施工日报现场照片上传授权");
  });
});
